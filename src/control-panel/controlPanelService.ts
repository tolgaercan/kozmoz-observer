import { resolve } from "node:path";

import { ApiHealthStore, type ApiHealthRecord } from "./apiHealthStore.js";
import { loadSettings } from "../config/settings.js";
import {
  APPOINTMENT_STYLE_OPTIONS,
  listDealerOffices,
  resolveAppointmentTypeIdFromLabel,
} from "../api/client/portalApiCatalog.js";
import {
  detectPublicIpForWorker,
  resolveChromeProxyServer,
  resolveProxyPublicIp,
} from "../config/proxyResolver.js";
import { measureHomeIpViaChrome } from "../config/chromeIpDetect.js";
import {
  resolveHomePublicIp,
} from "../config/publicIpDetect.js";
import { ProxyPoolStore, type ProxyPanelOption } from "../config/proxyPoolStore.js";
import { ProfileManager } from "../profiles/profileManager.js";
import {
  getChromeStatus,
  launchChromeForProfile,
  detectPublicIp,
} from "./chromeLauncher.js";
import type { ProcessRegistry } from "./processRegistry.js";
import { runMockApiDateValidation, type ApiDateValidationReport } from "../api/validation/apiDateLogicValidation.js";
import {
  normalizeLockedIp,
  WorkerConfigStore,
  type WorkerApiParams,
  type WorkerConfig,
  type WorkerTimingParams,
  type ProxyMode,
} from "./workerConfigStore.js";
import {
  RUNTIME_INTERVAL_OPTIONS_MS,
  WorkerRuntimeStore,
  type WorkerRuntimeConfig,
} from "./workerRuntimeStore.js";
import type { ManagedProcess } from "./processRegistry.js";

export interface NetworkIpInfo {
  mode: ProxyMode;
  displayIp: string;
  homePublicIp: string;
  measuredWanIp?: string;
  warning?: string;
  ipSource?: "measured" | "chrome" | "env" | "cached" | "proxy" | "browser";
  autoLocked?: boolean;
  proxyPool: ProxyPanelOption[];
  selectedProxyId?: string;
  lockedIp: string;
}

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
  runtimeOptionsMs: readonly number[];
  envTimingDefaults: {
    pollIntervalMs: number;
    telegramReportIntervalMs: number;
  };
}

export interface ManagedProcessWithRuntime extends ManagedProcess {
  runtime?: WorkerRuntimeConfig;
  runtimeOptionsMs?: readonly number[];
}

export class ControlPanelService {
  private readonly projectRoot: string;
  private readonly profileManager: ProfileManager;
  private readonly workerStore: WorkerConfigStore;
  private readonly runtimeStore: WorkerRuntimeStore;
  private readonly registry: ProcessRegistry;

  constructor(projectRoot: string, registry: ProcessRegistry) {
    this.projectRoot = projectRoot;
    const settings = loadSettings(projectRoot);
    this.profileManager = new ProfileManager(projectRoot, settings.manifestPath);
    this.workerStore = new WorkerConfigStore(projectRoot);
    this.runtimeStore = new WorkerRuntimeStore(projectRoot);
    this.registry = registry;
  }

  private runtimeDefaults(): {
    pollIntervalMs: number;
    telegramReportIntervalMs: number;
  } {
    const settings = loadSettings(this.projectRoot);
    return {
      pollIntervalMs: settings.apiWatcher.pollIntervalMs,
      telegramReportIntervalMs: settings.apiWatcher.telegramReportIntervalMs,
    };
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
    const timingDefaults = this.runtimeDefaults();
    this.runtimeStore.ensure(profileId, timingDefaults);
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
      worker: this.workerStore.getWorker(profileId, publicIp, timingDefaults),
      runtimeOptionsMs: RUNTIME_INTERVAL_OPTIONS_MS,
      envTimingDefaults: timingDefaults,
    };
  }

  saveWorkerConfig(profileId: string, patch: Partial<WorkerConfig>): WorkerConfig {
    return this.workerStore.updateWorker(profileId, patch, this.runtimeDefaults());
  }

  async getNetworkIp(
    profileId: string,
    draft?: { proxyMode?: ProxyMode; proxyId?: string },
    options?: { measureViaChrome?: boolean; autoLock?: boolean; skipServerMeasure?: boolean },
  ): Promise<NetworkIpInfo> {
    const profile = this.resolveProfile(profileId);
    const worker = this.workerStore.getWorker(profileId, "");
    const mode = draft?.proxyMode ?? worker.proxyMode ?? "direct";
    const proxyId = draft?.proxyId !== undefined ? draft.proxyId : worker.proxyId;
    const draftWorker: WorkerConfig = {
      ...worker,
      proxyMode: mode,
      proxyId: mode === "proxy" ? proxyId : "",
      proxyUrl: mode === "proxy" ? worker.proxyUrl : "",
    };

    const skipServer = options?.skipServerMeasure === true;
    const envHome = process.env.HOME_PUBLIC_IP?.trim();

    let displayIp = "unknown";
    let warning: string | undefined;
    let ipSource: NetworkIpInfo["ipSource"];
    let measuredWanIp: string | undefined;

    if (mode === "proxy") {
      displayIp = await resolveProxyPublicIp(this.projectRoot, profile, draftWorker);
      ipSource = "proxy";
    } else if (skipServer) {
      const pickHome = (ip?: string): string => normalizeLockedIp(ip);
      displayIp =
        pickHome(envHome) ||
        pickHome(worker.lastKnownHomeIp) ||
        pickHome(worker.lockedIp) ||
        "unknown";
      ipSource = pickHome(envHome)
        ? "env"
        : pickHome(worker.lastKnownHomeIp)
          ? "cached"
          : undefined;
      warning =
        displayIp === "unknown"
          ? "Ev IP henüz yok — «Ev IP'yi yeniden ölç» veya HOME_PUBLIC_IP tanımlayın."
          : undefined;
    } else {
      const home = await resolveHomePublicIp(this.projectRoot);
      displayIp = home.ip === "unavailable" ? "unknown" : home.ip;
      warning = home.warning;
      measuredWanIp = home.measuredIp !== "unknown" ? home.measuredIp : undefined;
      ipSource =
        home.source === "env" ? "env" : home.source === "measured" ? "measured" : undefined;

      if (displayIp === "unknown") {
        const cdpPort = profile.browser?.cdpPort ?? 9222;
        const chromeReady =
          options?.measureViaChrome !== false && (await getChromeStatus(cdpPort)).ready;
        if (chromeReady) {
          const chromeIp = await measureHomeIpViaChrome(cdpPort);
          if (chromeIp) {
            displayIp = chromeIp;
            ipSource = "chrome";
          }
        }

        if (displayIp === "unknown" && worker.lastKnownHomeIp) {
          displayIp = worker.lastKnownHomeIp;
          ipSource = "cached";
          warning = `Kayıtlı ev IP: ${worker.lastKnownHomeIp}.`;
        }
      }
    }

    let lockedIp = normalizeLockedIp(worker.lockedIp);
    let autoLocked = false;
    const shouldAutoLock = options?.autoLock !== false && mode === "direct";
    const validDirectIp = displayIp !== "unknown" && displayIp !== "unavailable";

    if (shouldAutoLock && validDirectIp && !lockedIp) {
      const saved = this.workerStore.updateWorker(profileId, {
        lockedIp: displayIp,
        lastKnownHomeIp: displayIp,
      });
      lockedIp = normalizeLockedIp(saved.lockedIp);
      autoLocked = true;
    } else if (validDirectIp && mode === "direct" && !worker.lastKnownHomeIp) {
      this.workerStore.updateWorker(profileId, { lastKnownHomeIp: displayIp });
    }

    const proxyStore = new ProxyPoolStore(this.projectRoot);
    const homePublicIp =
      envHome || (displayIp !== "unknown" && displayIp !== "unavailable" ? displayIp : "unknown");

    return {
      mode,
      displayIp,
      homePublicIp,
      measuredWanIp,
      warning,
      ipSource,
      autoLocked,
      proxyPool: proxyStore.listForPanel(),
      selectedProxyId: proxyId || undefined,
      lockedIp,
    };
  }

  private assertIpNotUsedByOtherWatcher(profileId: string, ip: string): void {
    const healthStore = new ApiHealthStore(this.projectRoot);
    const running = this.registry.list().filter(
      (job) =>
        job.kind === "api-watcher" &&
        job.profileId !== profileId &&
        (job.status === "running" || job.status === "starting"),
    );

    for (const job of running) {
      const otherWorker = this.workerStore.getWorker(job.profileId, "");
      const otherHealth = healthStore.get(job.profileId);
      const otherIp =
        normalizeLockedIp(otherWorker.lockedIp) ||
        normalizeLockedIp(otherHealth?.lockedIp) ||
        normalizeLockedIp(otherHealth?.publicIp);

      if (otherIp && otherIp === ip) {
        throw new Error(
          `IP ${ip} zaten ${job.profileId} watcher'ında kullanılıyor. Önce o watcher'ı durdurun (Kill).`,
        );
      }
    }
  }

  private async validateWatcherStart(profileId: string): Promise<{ worker: WorkerConfig; effectiveIp: string }> {
    let worker = this.workerStore.getWorker(profileId, "");
    let lockedIp = normalizeLockedIp(worker.lockedIp);

    if (worker.proxyMode === "direct" && !lockedIp) {
      await this.ensureDirectHomeIp(profileId);
      worker = this.workerStore.getWorker(profileId, "");
      lockedIp = normalizeLockedIp(worker.lockedIp);
    }

    const network = await this.getNetworkIp(profileId, undefined, {
      skipServerMeasure: true,
      autoLock: false,
    });
    lockedIp = normalizeLockedIp(network.lockedIp) || lockedIp;

    if (!lockedIp) {
      const hint =
        network.displayIp !== "unknown"
          ? network.displayIp
          : "ev IP ölçülemedi — ProxyNet kapatın veya .env HOME_PUBLIC_IP=... yazın";
      throw new Error(
        `IP kilitlemeden watcher başlatılamaz (${hint}). Ev modu: panelde «Ev IP'yi yeniden ölç» deyin (tarayıcı ölçer, antivirüs engellemez).`,
      );
    }

    if (worker.proxyMode === "proxy" && !worker.proxyId && !worker.proxyUrl?.trim()) {
      throw new Error("Proxy modu seçili — listeden statik IP proxy seçin, kaydedin ve IP'yi kilitleyin.");
    }

    if (worker.proxyMode === "proxy" && network.displayIp !== "unknown" && lockedIp !== network.displayIp) {
      throw new Error(
        `Kilitli IP (${lockedIp}) seçili proxy çıkış IP'si (${network.displayIp}) ile uyuşmuyor. IP'yi yeniden kilitleyin.`,
      );
    }

    this.assertIpNotUsedByOtherWatcher(profileId, lockedIp);
    return { worker: this.workerStore.getWorker(profileId, ""), effectiveIp: lockedIp };
  }

  async setManualHomeIp(
    profileId: string,
    ip: string,
    source: "manual" | "browser" = "manual",
  ): Promise<NetworkIpInfo> {
    const trimmed = ip.trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) {
      throw new Error("Geçerli bir IPv4 adresi girin.");
    }
    this.workerStore.updateWorker(profileId, {
      lastKnownHomeIp: trimmed,
      lockedIp: trimmed,
    });
    const base = await this.getNetworkIp(profileId, undefined, {
      skipServerMeasure: true,
      autoLock: false,
    });
    return {
      ...base,
      displayIp: trimmed,
      homePublicIp: trimmed,
      lockedIp: trimmed,
      ipSource: source === "browser" ? "browser" : "cached",
      autoLocked: true,
      warning: undefined,
    };
  }

  /** Tarayıcıdan gelen IP veya kayıtlı/env — sunucu curl/Chrome ölçümü yok (antivirüs dostu) */
  async ensureDirectHomeIpPublic(profileId: string, clientIp?: string): Promise<NetworkIpInfo> {
    if (clientIp?.trim()) {
      return this.setManualHomeIp(profileId, clientIp, "browser");
    }
    return this.getNetworkIp(profileId, undefined, { skipServerMeasure: true, autoLock: true });
  }

  private async ensureDirectHomeIp(profileId: string): Promise<void> {
    await this.getNetworkIp(profileId, undefined, { skipServerMeasure: true, autoLock: true });
  }

  buildApiEnv(profileId: string, api: WorkerApiParams): NodeJS.ProcessEnv {
    const profileKey = profileId.toUpperCase().replace(/-/g, "_");
    const appointmentTypeId = resolveAppointmentTypeIdFromLabel(api.appointmentStyle);
    const env: NodeJS.ProcessEnv = {
      API_DEALER_OFFICE: api.dealerOffice,
      APPOINTMENT_STYLE: api.appointmentStyle,
      [`API_DEALER_OFFICE_${profileKey}`]: api.dealerOffice,
      [`APPOINTMENT_STYLE_${profileKey}`]: api.appointmentStyle,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" "),
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
    const directMode = worker.proxyMode !== "proxy";
    const proxyUrl =
      worker.proxyMode === "proxy"
        ? await resolveChromeProxyServer(this.projectRoot, profile, worker)
        : undefined;
    const launch = await launchChromeForProfile(profile, this.registry, proxyUrl, directMode);
    return { launch };
  }

  stopChrome(profileId: string): { stopped: number; processIds: string[] } {
    const jobs = this.registry
      .findByProfile(profileId, "chrome")
      .filter((job) => job.status === "running" || job.status === "starting");

    const processIds: string[] = [];
    let stopped = 0;
    for (const job of jobs) {
      if (this.registry.kill(job.id)) {
        stopped++;
        processIds.push(job.id);
      }
    }
    return { stopped, processIds };
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

  async startApiWatcherWorkflow(
    profileId: string,
    api: WorkerApiParams,
    timing?: Partial<WorkerTimingParams>,
  ) {
    this.workerStore.updateWorker(
      profileId,
      {
        api,
        ...(timing ? { timing } : {}),
      },
      this.runtimeDefaults(),
    );
    await this.validateWatcherStart(profileId);

    const profile = this.resolveProfile(profileId);
    const cdpPort = profile.browser?.cdpPort ?? 9222;
    const chrome = await getChromeStatus(cdpPort);

    const steps: string[] = [];
    steps.push("API ayarları kaydedildi");

    if (!chrome.ready) {
      throw new Error(
        "Chrome CDP hazır değil. Önce Profil kartından «Chrome Aç» ile tarayıcıyı açın, " +
          "elle portala gidip giriş yapın, sonra API İzlemeyi Başlatın. " +
          "(Watcher artık otomatik yeni Chrome açmaz — açık sekmeleriniz korunur.)",
      );
    }
    steps.push("Chrome CDP zaten hazır");

    const process = await this.startApiWatcher(profileId, api);
    steps.push("API Watcher başlatıldı");

    return { process, steps, chromeReady: true };
  }

  stopApiWatcher(profileId: string): { stopped: number; processIds: string[] } {
    const jobs = this.registry
      .findByProfile(profileId, "api-watcher")
      .filter((job) => job.status === "running" || job.status === "starting");

    const processIds: string[] = [];
    let stopped = 0;
    for (const job of jobs) {
      if (this.registry.kill(job.id)) {
        stopped++;
        processIds.push(job.id);
      }
    }
    return { stopped, processIds };
  }

  runApiDateValidation(): ApiDateValidationReport {
    return runMockApiDateValidation();
  }

  async startApiWatcher(profileId: string, api: WorkerApiParams) {
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

    await this.validateWatcherStart(profileId);

    this.runtimeStore.ensure(profileId, this.runtimeDefaults());

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

  listProcesses(): ManagedProcessWithRuntime[] {
    const defaults = this.runtimeDefaults();
    return this.registry.list().map((proc) => ({
      ...proc,
      runtime:
        proc.kind === "api-watcher" &&
        (proc.status === "running" || proc.status === "starting")
          ? this.runtimeStore.get(proc.profileId, defaults)
          : undefined,
      runtimeOptionsMs: RUNTIME_INTERVAL_OPTIONS_MS,
    }));
  }

  updateProcessRuntimeConfig(
    processId: string,
    patch: { pollIntervalMs?: number; telegramReportIntervalMs?: number },
  ): { runtime: WorkerRuntimeConfig; process: ManagedProcessWithRuntime } {
    const proc = this.registry.get(processId);
    if (!proc) {
      throw new Error("Süreç bulunamadı");
    }
    if (proc.kind !== "api-watcher") {
      throw new Error("Yalnızca api-watcher süreçleri güncellenebilir");
    }
    if (proc.status !== "running" && proc.status !== "starting") {
      throw new Error("Süreç aktif değil");
    }

    const runtime = this.runtimeStore.update(proc.profileId, patch, this.runtimeDefaults());
    const updated = this.listProcesses().find((entry) => entry.id === processId);
    if (!updated) {
      throw new Error("Süreç listesinde bulunamadı");
    }
    return { runtime, process: updated };
  }

  killProcess(processId: string): boolean {
    return this.registry.kill(processId);
  }
}
