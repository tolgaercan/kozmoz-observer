import { resolve } from "node:path";

import { ApiHealthStore, type ApiHealthRecord } from "./apiHealthStore.js";
import { loadSettings } from "../config/settings.js";
import {
  APPOINTMENT_STYLE_OPTIONS,
  listDealerOffices,
  resolveAppointmentTypeIdFromLabel,
} from "../api/client/portalApiCatalog.js";
import {
  resolveChromeProxyServer,
  resolveProxyPublicIp,
} from "../config/proxyResolver.js";
import { resolveHomePublicIp } from "../config/publicIpDetect.js";
import { ProxyPoolStore, type ProxyPanelOption } from "../config/proxyPoolStore.js";
import { ProfileManager } from "../profiles/profileManager.js";
import {
  getChromeStatus,
  launchChromeForProfile,
  detectPublicIp,
} from "./chromeLauncher.js";
import type { ProcessRegistry } from "./processRegistry.js";
import { WorkerConfigStore, type WorkerApiParams, type WorkerConfig } from "./workerConfigStore.js";

export interface ProfileOption {
  id: string;
  name: string;
  enabled: boolean;
  cdpPort: number;
  mode: string;
  lifecycleState?: string;
}

export interface ControlPanelBootstrap {
  profiles: ProfileOption[];
  dealerOffices: ReturnType<typeof listDealerOffices>;
  appointmentStyles: typeof APPOINTMENT_STYLE_OPTIONS;
  publicIp: string;
  /** Ev interneti IP (proxy çıkış IP'leri hariç) */
  homePublicIp: string;
  measuredWanIp?: string;
  homeIpWarning?: string;
  connectionMode: "direct" | "proxy";
  proxyPool: ProxyPanelOption[];
  worker: WorkerConfig;
}

export class ControlPanelService {
  private readonly projectRoot: string;
  private readonly profileManager: ProfileManager;
  private readonly workerStore: WorkerConfigStore;
  private readonly registry: ProcessRegistry;

  constructor(projectRoot: string, registry: ProcessRegistry) {
    this.projectRoot = projectRoot;
    const settings = loadSettings(projectRoot);
    this.profileManager = new ProfileManager(projectRoot, settings.manifestPath);
    this.workerStore = new WorkerConfigStore(projectRoot);
    this.registry = registry;
  }

  listProfiles(): ProfileOption[] {
    return this.profileManager.listProfiles().map((profile) => ({
      id: profile.id,
      name: profile.name,
      enabled: profile.enabled !== false,
      cdpPort: profile.browser?.cdpPort ?? 9222,
      mode: profile.mode ?? "observer",
      lifecycleState: profile.lifecycle?.state,
    }));
  }

  resolveProfile(profileId: string) {
    const settings = loadSettings(this.projectRoot);
    return this.profileManager.resolveProfile(profileId, settings);
  }

  async getBootstrap(profileId: string): Promise<ControlPanelBootstrap> {
    const profile = this.resolveProfile(profileId);
    const worker = this.workerStore.getWorker(profileId, "");
    const home = await resolveHomePublicIp(this.projectRoot);
    const homePublicIp = home.ip === "unavailable" ? "unknown" : home.ip;
    let publicIp = homePublicIp;

    if (worker.proxyMode === "proxy") {
      publicIp = await resolveProxyPublicIp(this.projectRoot, profile, worker);
    }

    const proxyStore = new ProxyPoolStore(this.projectRoot);
    return {
      profiles: this.listProfiles(),
      dealerOffices: listDealerOffices(),
      appointmentStyles: APPOINTMENT_STYLE_OPTIONS,
      publicIp,
      homePublicIp,
      measuredWanIp: home.measuredIp !== "unknown" ? home.measuredIp : undefined,
      homeIpWarning: home.warning,
      connectionMode: worker.proxyMode ?? "direct",
      proxyPool: proxyStore.listForPanel(),
      worker: this.workerStore.getWorker(profileId, publicIp),
    };
  }

  saveWorkerConfig(profileId: string, patch: Partial<WorkerConfig>): WorkerConfig {
    return this.workerStore.updateWorker(profileId, patch);
  }

  buildApiEnv(profileId: string, api: WorkerApiParams): NodeJS.ProcessEnv {
    const profileKey = profileId.toUpperCase().replace(/-/g, "_");
    const appointmentTypeId = resolveAppointmentTypeIdFromLabel(api.appointmentStyle);
    const env: NodeJS.ProcessEnv = {
      API_DEALER_OFFICE: api.dealerOffice,
      APPOINTMENT_STYLE: api.appointmentStyle,
      [`API_DEALER_OFFICE_${profileKey}`]: api.dealerOffice,
      [`APPOINTMENT_STYLE_${profileKey}`]: api.appointmentStyle,
    };
    if (appointmentTypeId) {
      env.API_APPOINTMENT_TYPE_ID = appointmentTypeId;
      env[`API_APPOINTMENT_TYPE_ID_${profileKey}`] = appointmentTypeId;
    }
    return env;
  }

  async startChrome(profileId: string) {
    const profile = this.resolveProfile(profileId);
    const worker = this.workerStore.getWorker(profileId, "");
    const proxyUrl =
      worker.proxyMode === "proxy"
        ? await resolveChromeProxyServer(this.projectRoot, profile, worker)
        : undefined;
    const launch = await launchChromeForProfile(profile, this.registry, proxyUrl);
    return { launch };
  }

  private enrichHealthRecord(
    record: ApiHealthRecord,
    profiles: ProfileOption[],
    publicIp: string,
  ): ApiHealthRecord {
    const profile = profiles.find((p) => p.id === record.profileId);
    const worker = this.workerStore.getWorker(record.profileId, publicIp);
    return {
      ...record,
      profileName: record.profileName ?? profile?.name,
      cdpPort: record.cdpPort ?? profile?.cdpPort,
      lockedIp: record.lockedIp || worker.lockedIp || undefined,
      publicIp: record.publicIp || undefined,
    };
  }

  async getAllApiHealth() {
    const profiles = this.listProfiles();
    const publicIp = await detectPublicIp(this.projectRoot);
    const healthStore = new ApiHealthStore(this.projectRoot);
    const healthById = new Map(healthStore.listAll().map((record) => [record.profileId, record]));

    const profilesHealth = profiles.map((profileOption) => {
      const existing = healthById.get(profileOption.id);
      if (existing) {
        return this.enrichHealthRecord(existing, profiles, publicIp);
      }
      const worker = this.workerStore.getWorker(profileOption.id, publicIp);
      return {
        profileId: profileOption.id,
        profileName: profileOption.name,
        cdpPort: profileOption.cdpPort,
        lockedIp: worker.lockedIp || undefined,
        status: "idle" as const,
        updatedAt: new Date().toISOString(),
      } satisfies ApiHealthRecord;
    });

    const blocked = healthStore.listBlocked().map(({ record, until, reason }) => ({
      ...this.enrichHealthRecord(record, profiles, publicIp),
      blockedUntil: until,
      blockedReason: reason,
    }));

    return { publicIp, profiles: profilesHealth, blocked };
  }

  async getProfileStatus(profileId: string) {
    const profile = this.resolveProfile(profileId);
    const cdpPort = profile.browser?.cdpPort ?? 9222;
    const chrome = await getChromeStatus(cdpPort);
    const activeJobs = this.registry.findByProfile(profileId);
    const profiles = this.listProfiles();
    const publicIp = await detectPublicIp(this.projectRoot);
    const healthStore = new ApiHealthStore(this.projectRoot);
    const rawHealth = healthStore.get(profileId);
    const apiHealth = rawHealth
      ? this.enrichHealthRecord(rawHealth, profiles, publicIp)
      : undefined;
    const rateLimit = healthStore.isBlocked(profileId);
    const allApiHealth = await this.getAllApiHealth();
    return { cdpPort, chrome, activeJobs, apiHealth, rateLimit, allApiHealth };
  }

  startApiWatcher(profileId: string, api: WorkerApiParams) {
    const existing = this.registry
      .findByProfile(profileId, "api-watcher")
      .filter((job) => job.status === "running" || job.status === "starting");
    if (existing.length > 0) {
      throw new Error(
        `Bu profil için API Watcher zaten çalışıyor (${existing[0]!.label}). Önce Kill edin.`,
      );
    }

    const healthStore = new ApiHealthStore(this.projectRoot);
    const blocked = healthStore.isBlocked(profileId);
    if (blocked.blocked) {
      const until = blocked.until ? new Date(blocked.until).toLocaleString("tr-TR") : "bilinmiyor";
      throw new Error(`Portal rate limit / ban aktif — ${until} kadar bekleyin. ${blocked.reason ?? ""}`);
    }

    const profile = this.resolveProfile(profileId);
    const tsx = resolve(this.projectRoot, "node_modules/tsx/dist/cli.mjs");
    const script = resolve(this.projectRoot, "src/scenarios/runScenario.ts");
    const env = this.buildApiEnv(profileId, api);

    return this.registry.spawnManaged(
      "api-watcher",
      profileId,
      `API Watcher — ${api.dealerOffice} / ${api.appointmentStyle}`,
      process.execPath,
      ["--use-system-ca", tsx, script, "--id", "api-watcher-attach", "--profile", profileId, "--no-wait"],
      { cwd: this.projectRoot, env, cdpPort: profile.browser?.cdpPort },
    );
  }

  startDomObserver(profileId: string) {
    const profile = this.resolveProfile(profileId);
    const worker = this.workerStore.getWorker(profileId, "");
    const tsx = resolve(this.projectRoot, "node_modules/tsx/dist/cli.mjs");
    const script = resolve(this.projectRoot, "src/scenarios/runScenario.ts");
    const scenarioId =
      profile.id === "profile-2" ? "eea-observe-attach" : "observe-attach";
    const env = this.buildApiEnv(profileId, worker.api);

    return this.registry.spawnManaged(
      "dom-observer",
      profileId,
      `DOM Observer — ${scenarioId}`,
      process.execPath,
      ["--use-system-ca", tsx, script, "--id", scenarioId, "--profile", profileId, "--no-wait"],
      { cwd: this.projectRoot, env, cdpPort: profile.browser?.cdpPort },
    );
  }

  listProcesses() {
    return this.registry.list();
  }

  killProcess(processId: string): boolean {
    return this.registry.kill(processId);
  }
}
