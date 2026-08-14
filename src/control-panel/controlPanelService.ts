import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { ApiHealthStore, type ApiHealthRecord } from "./apiHealthStore.js";
import { loadSettings } from "../config/settings.js";
import {
  APPOINTMENT_STYLE_OPTIONS,
  APPLICATION_TYPE_OPTIONS,
  listDealerOffices,
  resolveApplicationTypeIdFromLabel,
  resolveAppointmentTypeIdFromLabel,
} from "../api/client/portalApiCatalog.js";
import {
  detectPublicIpForWorker,
  detectPublicIpThroughProxy,
  resolveChromeProxyServer,
  resolveProxyPublicIp,
  resolveWorkerProxyDefinition,
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
import { ensureChromeGoogleLoginAfterLaunch, type ChromeGoogleLoginResult } from "./chromeGoogleLoginService.js";
import { allocateCdpPort, suggestPreferredCdpPortSync } from "./cdpPortAllocator.js";
import { killProcessesOnPort } from "./cdpPortKill.js";
import {
  ChromeProfileStore,
  type PanelChromeProfile,
} from "./chromeProfileStore.js";
import { ChromeSessionStore } from "./chromeSessionStore.js";
import { PanelProxyStore, type PanelProxyEntry } from "./panelProxyStore.js";
import { WatcherSessionStore } from "./watcherSessionStore.js";
import {
  buildChromeCredentialEnv,
  importManifestCredentialsIntoStore,
  migrateManifestToChromeProfiles,
  shouldImportManifestCredentials,
  syncManifestFromChromeProfiles,
} from "./profileBridge.js";
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
import { sanitizeWorkerApiParams, validateWorkerApiParams } from "./workerApiValidation.js";
import {
  RUNTIME_INTERVAL_OPTIONS_MS,
  WorkerRuntimeStore,
  type WorkerRuntimeConfig,
} from "./workerRuntimeStore.js";
import type { ManagedProcess } from "./processRegistry.js";
import { logger } from "../utils/logger.js";

export interface NetworkIpInfo {
  mode: ProxyMode;
  displayIp: string;
  homePublicIp: string;
  measuredWanIp?: string;
  warning?: string;
  ipSource?: "measured" | "chrome" | "cached" | "proxy" | "browser";
  autoLocked?: boolean;
  proxyPool: ProxyPanelOption[];
  selectedProxyId?: string;
  lockedIp: string;
  /** Proxy modunda Chrome CDP ile ölçüldüyse hangi profil/port */
  measuredProfileId?: string;
  measuredCdpPort?: number;
}

export interface ProfileOption {
  id: string;
  name: string;
  enabled: boolean;
  cdpPort: number;
  preferredCdpPort?: number | null;
  assignedCdpPort?: number;
  chromeEmail?: string;
  mode: string;
  lifecycleState?: string;
}

export interface ChromeProfilePanelView {
  id: string;
  name: string;
  chromeEmail: string;
  hasPassword: boolean;
  userDataDir: string;
  preferredCdpPort?: number | null;
  assignedCdpPort?: number;
  enabled: boolean;
}

export interface ProxyPoolPanelView {
  id: string;
  label: string;
  host: string;
  port: number;
  protocol: string;
  username?: string;
  exitIp?: string;
  ispStatic: boolean;
  enabled: boolean;
  profiles: string[];
  hasAuth: boolean;
  hasPassword: boolean;
}

export interface ControlPanelBootstrap {
  profiles: ProfileOption[];
  chromeProfiles: ChromeProfilePanelView[];
  dealerOffices: ReturnType<typeof listDealerOffices>;
  appointmentStyles: typeof APPOINTMENT_STYLE_OPTIONS;
  applicationTypes: typeof APPLICATION_TYPE_OPTIONS;
  publicIp: string;
  /** Ev interneti IP (proxy çıkış IP'leri hariç) */
  homePublicIp: string;
  measuredWanIp?: string;
  homeIpWarning?: string;
  connectionMode: "direct" | "proxy";
  proxyPool: ProxyPanelOption[];
  worker: WorkerConfig;
  activeWatcherSession?: boolean;
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
  private readonly manifestPath: string;
  private profileManager: ProfileManager;
  private readonly workerStore: WorkerConfigStore;
  private readonly runtimeStore: WorkerRuntimeStore;
  private readonly chromeProfileStore: ChromeProfileStore;
  private readonly panelProxyStore: PanelProxyStore;
  private readonly chromeSessionStore: ChromeSessionStore;
  private readonly watcherSessionStore: WatcherSessionStore;
  private readonly registry: ProcessRegistry;

  constructor(projectRoot: string, registry: ProcessRegistry) {
    this.projectRoot = projectRoot;
    const settings = loadSettings(projectRoot);
    this.manifestPath = settings.manifestPath;
    this.profileManager = new ProfileManager(projectRoot, settings.manifestPath);
    this.workerStore = new WorkerConfigStore(projectRoot);
    this.runtimeStore = new WorkerRuntimeStore(projectRoot);
    this.chromeProfileStore = new ChromeProfileStore(projectRoot);
    this.panelProxyStore = new PanelProxyStore(projectRoot);
    this.chromeSessionStore = new ChromeSessionStore(projectRoot);
    this.watcherSessionStore = new WatcherSessionStore(projectRoot);
    this.registry = registry;
    this.ensureChromeProfilesReady();
  }

  private ensureChromeProfilesReady(): void {
    if (this.chromeProfileStore.listAll().length === 0) {
      const migrated = migrateManifestToChromeProfiles(this.manifestPath, process.env);
      if (migrated.length > 0) {
        this.chromeProfileStore.replaceAll(migrated, migrated[0]?.id);
      }
    }
    this.importManifestCredentialsIfNeeded();
    this.syncManifestFromPanelProfiles();
    this.importLegacyProxiesIfNeeded();
    this.reconcileStaleWatcherSessions();
  }

  private importLegacyProxiesIfNeeded(): void {
    if (this.panelProxyStore.listAll().length > 0) {
      return;
    }

    const legacyPath = resolve(this.projectRoot, "data/config/proxy-pool.local.json");
    if (!existsSync(legacyPath)) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(legacyPath, "utf-8")) as {
        proxies?: Array<Omit<PanelProxyEntry, "createdAt" | "updatedAt">>;
      };
      const legacy = parsed.proxies ?? [];
      if (legacy.length === 0) {
        return;
      }

      const now = new Date().toISOString();
      const migrated: PanelProxyEntry[] = legacy.map((proxy) => ({
        ...proxy,
        protocol: proxy.protocol ?? "http",
        enabled: proxy.enabled !== false,
        profiles: proxy.profiles ?? [],
        createdAt: now,
        updatedAt: now,
      }));

      this.panelProxyStore.replaceAll(migrated);
      logger.info(`[panel] ${migrated.length} proxy kaydı proxy-pool.local.json → panel store aktarıldı.`);
    } catch (error) {
      logger.warn(
        `[panel] Legacy proxy import: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private toProxyPoolPanelView(entry: PanelProxyEntry): ProxyPoolPanelView {
    return {
      id: entry.id,
      label: entry.label,
      host: entry.host,
      port: entry.port,
      protocol: entry.protocol ?? "http",
      username: entry.username,
      exitIp: entry.exitIp,
      ispStatic: entry.ispStatic === true,
      enabled: entry.enabled !== false,
      profiles: entry.profiles ?? [],
      hasAuth: Boolean(entry.username),
      hasPassword: Boolean(entry.password),
    };
  }

  private importManifestCredentialsIfNeeded(): void {
    const storePath = this.chromeProfileStore.getStorePath();
    if (!shouldImportManifestCredentials(this.manifestPath, storePath)) {
      return;
    }
    const imported = importManifestCredentialsIntoStore(this.manifestPath, this.chromeProfileStore);
    if (imported > 0) {
      logger.info(`[panel] manifest.json'dan ${imported} profil kimlik bilgisi aktarıldı`);
      this.syncManifestFromPanelProfiles();
    }
  }

  private syncManifestFromPanelProfiles(): void {
    const profiles = this.chromeProfileStore.listAll();
    const cdpPortById: Record<string, number> = {};
    for (const profile of profiles) {
      const session = this.chromeSessionStore.get(profile.id);
      cdpPortById[profile.id] =
        session?.assignedCdpPort ?? profile.preferredCdpPort ?? 9222;
    }
    syncManifestFromChromeProfiles(this.projectRoot, this.manifestPath, profiles, cdpPortById);
    this.profileManager.reload(this.manifestPath);
  }

  private toChromeProfilePanelView(profile: PanelChromeProfile): ChromeProfilePanelView {
    const session = this.chromeSessionStore.get(profile.id);
    return {
      id: profile.id,
      name: profile.name,
      chromeEmail: profile.chromeEmail,
      hasPassword: Boolean(profile.chromePassword),
      userDataDir: profile.userDataDir,
      preferredCdpPort: profile.preferredCdpPort ?? null,
      assignedCdpPort: session?.assignedCdpPort,
      enabled: profile.enabled !== false,
    };
  }

  private reconcileStaleWatcherSessions(): void {
    for (const session of this.watcherSessionStore.list()) {
      const running = this.registry
        .findByProfile(session.profileId, "api-watcher")
        .some((job) => job.status === "running" || job.status === "starting");
      if (!running) {
        this.watcherSessionStore.clear(session.profileId);
      }
    }
  }

  private isWatcherRunning(profileId: string): boolean {
    return this.registry
      .findByProfile(profileId, "api-watcher")
      .some((job) => job.status === "running" || job.status === "starting");
  }

  private resolveEffectiveWorker(profileId: string, fallbackIp = ""): WorkerConfig {
    const timingDefaults = this.runtimeDefaults();
    const activeWatcher = this.watcherSessionStore.get(profileId);
    if (activeWatcher && this.isWatcherRunning(profileId)) {
      return {
        profileId,
        proxyMode: activeWatcher.network.proxyMode,
        lockedIp: activeWatcher.network.lockedIp,
        proxyId: activeWatcher.network.proxyId ?? "",
        proxyUrl: activeWatcher.network.proxyUrl ?? "",
        api: activeWatcher.api,
        timing: activeWatcher.timing,
        updatedAt: activeWatcher.updatedAt,
      };
    }

    const chromeSession = this.chromeSessionStore.get(profileId);
    const legacy = this.workerStore.getWorker(profileId, fallbackIp, timingDefaults);
    const timing = chromeSession?.draftTiming ?? legacy.timing;
    const api = chromeSession?.draftApi ?? legacy.api;

    return {
      profileId,
      proxyMode: chromeSession?.proxyMode ?? legacy.proxyMode ?? "direct",
      lockedIp: chromeSession?.lockedIp ?? legacy.lockedIp ?? "",
      lastKnownHomeIp: chromeSession?.lastKnownHomeIp ?? legacy.lastKnownHomeIp,
      proxyId: chromeSession?.proxyId ?? legacy.proxyId ?? "",
      proxyUrl: chromeSession?.proxyUrl ?? legacy.proxyUrl ?? "",
      api,
      timing,
      updatedAt: chromeSession?.updatedAt ?? legacy.updatedAt,
    };
  }

  listChromeProfiles(): ChromeProfilePanelView[] {
    return this.chromeProfileStore.listAll().map((p) => this.toChromeProfilePanelView(p));
  }

  createChromeProfile(input: {
    name: string;
    chromeEmail: string;
    chromePassword: string;
    id?: string;
    preferredCdpPort?: number | null;
  }): ChromeProfilePanelView {
    const claimedPorts = this.chromeProfileStore.listAll().flatMap((profile) => {
      const session = this.chromeSessionStore.get(profile.id);
      return [session?.assignedCdpPort, profile.preferredCdpPort];
    });
    const preferredCdpPort =
      input.preferredCdpPort ?? suggestPreferredCdpPortSync(claimedPorts);

    const created = this.chromeProfileStore.create({
      ...input,
      preferredCdpPort,
    });
    this.syncManifestFromPanelProfiles();
    return this.toChromeProfilePanelView(created);
  }

  updateChromeProfile(
    profileId: string,
    patch: Partial<
      Pick<PanelChromeProfile, "name" | "chromeEmail" | "chromePassword" | "preferredCdpPort" | "enabled">
    >,
  ): ChromeProfilePanelView & { passwordUpdated: boolean; emailUpdated: boolean } {
    const { profile: updated, passwordUpdated, emailUpdated } = this.chromeProfileStore.update(
      profileId,
      patch,
    );
    this.syncManifestFromPanelProfiles();
    return {
      ...this.toChromeProfilePanelView(updated),
      passwordUpdated,
      emailUpdated,
    };
  }

  deleteChromeProfile(profileId: string): void {
    this.stopApiWatcher(profileId);
    this.stopChrome(profileId);
    this.chromeSessionStore.clear(profileId);
    this.watcherSessionStore.clear(profileId);
    this.chromeProfileStore.delete(profileId);
    this.syncManifestFromPanelProfiles();
  }

  listPanelProxies(): ProxyPoolPanelView[] {
    return this.panelProxyStore.listAll().map((entry) => this.toProxyPoolPanelView(entry));
  }

  createPanelProxy(input: {
    label: string;
    host: string;
    port: number;
    id?: string;
    username?: string;
    password?: string;
    protocol?: "http" | "https";
    exitIp?: string;
    ispStatic?: boolean;
    enabled?: boolean;
    profiles?: string[];
  }): ProxyPoolPanelView {
    if (input.username?.trim() && !input.password?.trim()) {
      throw new Error("Kullanıcı adı varsa parola zorunlu.");
    }
    if (!input.username?.trim() && input.password?.trim()) {
      throw new Error("Parola için kullanıcı adı da gerekli.");
    }
    const created = this.panelProxyStore.create(input);
    return this.toProxyPoolPanelView(created);
  }

  updatePanelProxy(
    id: string,
    patch: Partial<
      Pick<
        PanelProxyEntry,
        | "label"
        | "host"
        | "port"
        | "username"
        | "password"
        | "protocol"
        | "exitIp"
        | "ispStatic"
        | "enabled"
        | "profiles"
      >
    >,
  ): ProxyPoolPanelView & { passwordUpdated: boolean } {
    const { entry, passwordUpdated } = this.panelProxyStore.update(id, patch);
    return { ...this.toProxyPoolPanelView(entry), passwordUpdated };
  }

  deletePanelProxy(id: string): void {
    this.panelProxyStore.delete(id);
  }

  async testPanelProxyExitIp(id: string): Promise<{
    exitIp: string;
    updated: boolean;
    previousExitIp?: string;
    ipRotated?: boolean;
    warning?: string;
  }> {
    const entry = this.panelProxyStore.getOrThrow(id);
    const previousExitIp = entry.exitIp?.trim();

    if (entry.ispStatic && previousExitIp) {
      return { exitIp: previousExitIp, updated: false };
    }

    const measured = await detectPublicIpThroughProxy(entry);
    if (measured === "unknown") {
      throw new Error(
        "Çıkış IP ölçülemedi — host/port/kullanıcı/parola kontrol edin (kullanıcı adı kayıtlı mı?).",
      );
    }

    const ipRotated = Boolean(previousExitIp && previousExitIp !== measured);
    let warning: string | undefined;
    if (ipRotated) {
      warning =
        `IP değişti (${previousExitIp} → ${measured}). ProxyNet havuzu dönüyor olabilir — statik ISP için panel desteğine danışın.`;
      logger.warn(`[panel] ${warning}`);
    }

    this.panelProxyStore.updateExitIp(id, measured);
    return {
      exitIp: measured,
      updated: true,
      previousExitIp,
      ipRotated,
      warning,
    };
  }

  savePanelDraft(
    profileId: string,
    patch: {
      proxyMode?: ProxyMode;
      proxyId?: string;
      proxyUrl?: string;
      lockedIp?: string;
      lastKnownHomeIp?: string;
      api?: WorkerApiParams;
      timing?: WorkerTimingParams;
    },
  ): WorkerConfig {
    const existing = this.chromeSessionStore.get(profileId);
    const timingDefaults = this.runtimeDefaults();
    const legacy = this.workerStore.getWorker(profileId, "", timingDefaults);

    const nextProxyMode = patch.proxyMode ?? existing?.proxyMode ?? legacy.proxyMode ?? "direct";
    const nextProxyId =
      nextProxyMode === "direct"
        ? ""
        : patch.proxyId !== undefined
          ? patch.proxyId
          : (existing?.proxyId ?? legacy.proxyId ?? "");
    const nextProxyUrl =
      nextProxyMode === "direct"
        ? ""
        : patch.proxyUrl !== undefined
          ? patch.proxyUrl
          : (existing?.proxyUrl ?? legacy.proxyUrl ?? "");
    const nextLockedIp =
      patch.lockedIp !== undefined ? patch.lockedIp : existing?.lockedIp ?? legacy.lockedIp;
    const nextHomeIp =
      patch.lastKnownHomeIp !== undefined
        ? patch.lastKnownHomeIp
        : patch.lockedIp !== undefined && nextProxyMode === "direct"
          ? patch.lockedIp
          : (existing?.lastKnownHomeIp ?? legacy.lastKnownHomeIp);
    const nextApi = patch.api ?? existing?.draftApi ?? legacy.api;
    const nextTiming = patch.timing ?? existing?.draftTiming ?? legacy.timing;

    this.chromeSessionStore.patch(profileId, {
      profileId,
      assignedCdpPort:
        existing?.assignedCdpPort ??
        this.chromeProfileStore.get(profileId)?.preferredCdpPort ??
        9222,
      proxyMode: nextProxyMode,
      proxyId: nextProxyId,
      proxyUrl: nextProxyUrl,
      lockedIp: nextLockedIp,
      lastKnownHomeIp: nextHomeIp,
      draftApi: nextApi,
      draftTiming: nextTiming,
    });

    this.workerStore.updateWorker(
      profileId,
      {
        proxyMode: nextProxyMode,
        proxyId: nextProxyMode === "proxy" ? nextProxyId : "",
        proxyUrl: nextProxyMode === "proxy" ? nextProxyUrl : "",
        lockedIp: nextLockedIp,
        lastKnownHomeIp: nextHomeIp,
        api: nextApi,
        timing: nextTiming,
      },
      timingDefaults,
    );

    return this.resolveEffectiveWorker(profileId);
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
    return this.chromeProfileStore.list().map((profile) => {
      const session = this.chromeSessionStore.get(profile.id);
      const assigned = session?.assignedCdpPort ?? profile.preferredCdpPort ?? 9222;
      return {
        id: profile.id,
        name: profile.name,
        enabled: profile.enabled !== false,
        cdpPort: assigned,
        preferredCdpPort: profile.preferredCdpPort ?? null,
        assignedCdpPort: session?.assignedCdpPort,
        chromeEmail: profile.chromeEmail,
        mode: "observer",
        lifecycleState: "ready",
      };
    });
  }

  resolveProfile(profileId: string) {
    const settings = loadSettings(this.projectRoot);
    return this.profileManager.resolveProfile(profileId, settings);
  }

  private resolveProfileCdpPort(profileId: string, profile: ReturnType<ControlPanelService["resolveProfile"]>): number {
    const session = this.chromeSessionStore.get(profileId);
    return session?.assignedCdpPort ?? profile.browser?.cdpPort ?? 9222;
  }

  async getBootstrap(profileId: string, options?: { light?: boolean }): Promise<ControlPanelBootstrap> {
    this.importManifestCredentialsIfNeeded();
    this.importLegacyProxiesIfNeeded();
    this.reconcileStaleWatcherSessions();
    this.chromeProfileStore.getOrThrow(profileId);
    const worker = this.resolveEffectiveWorker(profileId);
    const workerHome =
      normalizeLockedIp(worker.lastKnownHomeIp) || normalizeLockedIp(worker.lockedIp);
    let homePublicIp = workerHome || "unknown";
    let measuredWanIp: string | undefined;
    let homeIpWarning: string | undefined;
    let publicIp = homePublicIp;

    if (!options?.light && homePublicIp === "unknown") {
      const home = await resolveHomePublicIp(this.projectRoot);
      homePublicIp = home.ip === "unavailable" ? "unknown" : home.ip;
      measuredWanIp = home.measuredIp !== "unknown" ? home.measuredIp : undefined;
      homeIpWarning = home.warning;
      publicIp = homePublicIp;
    }

    const profile = this.resolveProfile(profileId);
    if (worker.proxyMode === "proxy") {
      if (options?.light) {
        publicIp = worker.lockedIp?.trim() || homePublicIp;
      } else {
        publicIp = await resolveProxyPublicIp(this.projectRoot, profile, worker);
      }
    }

    const proxyStore = new ProxyPoolStore(this.projectRoot);
    const timingDefaults = this.runtimeDefaults();
    this.runtimeStore.ensure(profileId, timingDefaults);
    return {
      profiles: this.listProfiles(),
      chromeProfiles: this.listChromeProfiles(),
      dealerOffices: listDealerOffices(),
      appointmentStyles: APPOINTMENT_STYLE_OPTIONS,
      applicationTypes: APPLICATION_TYPE_OPTIONS,
      publicIp,
      homePublicIp,
      measuredWanIp,
      homeIpWarning,
      connectionMode: worker.proxyMode ?? "direct",
      proxyPool: this.listPanelProxies(),
      worker,
      activeWatcherSession: Boolean(this.watcherSessionStore.get(profileId)),
      runtimeOptionsMs: RUNTIME_INTERVAL_OPTIONS_MS,
      envTimingDefaults: timingDefaults,
    };
  }

  saveWorkerConfig(profileId: string, patch: Partial<WorkerConfig>): WorkerConfig {
    const sanitizedPatch = { ...patch };
    if (patch.api) {
      sanitizedPatch.api = sanitizeWorkerApiParams({ ...this.resolveEffectiveWorker(profileId).api, ...patch.api });
    }
    return this.savePanelDraft(profileId, {
      proxyMode: sanitizedPatch.proxyMode,
      proxyId: sanitizedPatch.proxyId,
      proxyUrl: sanitizedPatch.proxyUrl,
      lockedIp: sanitizedPatch.lockedIp,
      lastKnownHomeIp: sanitizedPatch.lastKnownHomeIp,
      api: sanitizedPatch.api,
      timing: sanitizedPatch.timing,
    });
  }

  async getNetworkIp(
    profileId: string,
    draft?: { proxyMode?: ProxyMode; proxyId?: string },
    options?: { measureViaChrome?: boolean; autoLock?: boolean; skipServerMeasure?: boolean },
  ): Promise<NetworkIpInfo> {
    const profile = this.resolveProfile(profileId);
    const worker = this.resolveEffectiveWorker(profileId);
    const mode = draft?.proxyMode ?? worker.proxyMode ?? "direct";
    const proxyId = draft?.proxyId !== undefined ? draft.proxyId : worker.proxyId;
    const draftWorker: WorkerConfig = {
      ...worker,
      proxyMode: mode,
      proxyId: mode === "proxy" ? proxyId : "",
      proxyUrl: mode === "proxy" ? worker.proxyUrl : "",
    };

    const skipServer = options?.skipServerMeasure === true;
    const workerHome =
      normalizeLockedIp(worker.lastKnownHomeIp) || normalizeLockedIp(worker.lockedIp);

    let displayIp = "unknown";
    let warning: string | undefined;
    let ipSource: NetworkIpInfo["ipSource"];
    let measuredWanIp: string | undefined;
    let measuredProfileId: string | undefined;
    let measuredCdpPort: number | undefined;

    const cdpPort = this.resolveProfileCdpPort(profileId, profile);

    if (mode === "proxy") {
      const poolId = draftWorker.proxyId?.trim();
      const def = poolId ? new ProxyPoolStore(this.projectRoot).getById(poolId) : undefined;
      let chromeIp: string | undefined;

      if (!skipServer && options?.measureViaChrome !== false) {
        const chromeReady = (await getChromeStatus(cdpPort)).ready;
        if (chromeReady) {
          chromeIp = await measureHomeIpViaChrome(cdpPort);
        }
      }

      if (chromeIp) {
        displayIp = chromeIp;
        ipSource = "chrome";
        measuredProfileId = profileId;
        measuredCdpPort = cdpPort;
      } else if (def?.exitIp?.trim() && skipServer) {
        displayIp = def.exitIp.trim();
        ipSource = "cached";
        warning = "Proxy kaydındaki çıkış IP (ölçüm atlandı)";
      } else if (!skipServer) {
        displayIp = await resolveProxyPublicIp(this.projectRoot, profile, draftWorker);
        ipSource = "proxy";
        const chromeReady = (await getChromeStatus(cdpPort)).ready;
        if (!chromeReady) {
          warning =
            `Chrome CDP hazır değil (port ${cdpPort}) — sunucu curl ölçümü (havuz IP'si dönebilir). Önce «Chrome Aç».`;
        } else {
          warning =
            "Chrome IP alınamadı — sunucu curl ölçümü (havuz IP'si her seferinde değişebilir).";
        }
      } else {
        displayIp = def?.exitIp?.trim() || "unknown";
        ipSource = displayIp !== "unknown" ? "cached" : undefined;
        warning = "Chrome kapalı — kayıtlı proxy IP gösteriliyor.";
      }
    } else if (skipServer) {
      displayIp = workerHome || "unknown";
      ipSource = workerHome ? "cached" : undefined;
      warning =
        displayIp === "unknown"
          ? "Ev IP henüz yok — panelden «Ev IP'yi yeniden ölç» veya «Mevcut IP'yi kilitle»."
          : undefined;
    } else {
      if (workerHome) {
        displayIp = workerHome;
        ipSource = "cached";
      } else {
        const home = await resolveHomePublicIp(this.projectRoot);
        displayIp = home.ip === "unavailable" ? "unknown" : home.ip;
        warning = home.warning;
        measuredWanIp = home.measuredIp !== "unknown" ? home.measuredIp : undefined;
        ipSource = home.source === "measured" ? "measured" : undefined;
      }

      if (displayIp === "unknown") {
        const directCdpPort = profile.browser?.cdpPort ?? 9222;
        const chromeReady =
          options?.measureViaChrome !== false && (await getChromeStatus(directCdpPort)).ready;
        if (chromeReady) {
          const chromeIp = await measureHomeIpViaChrome(directCdpPort);
          if (chromeIp) {
            displayIp = chromeIp;
            ipSource = "chrome";
            measuredProfileId = profileId;
            measuredCdpPort = directCdpPort;
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
      this.savePanelDraft(profileId, {
        lockedIp: displayIp,
        lastKnownHomeIp: displayIp,
      });
      lockedIp = displayIp;
      autoLocked = true;
    } else if (validDirectIp && mode === "direct" && !worker.lastKnownHomeIp) {
      this.savePanelDraft(profileId, { lastKnownHomeIp: displayIp });
    }

    const proxyStore = new ProxyPoolStore(this.projectRoot);
    const homePublicIp =
      displayIp !== "unknown" && displayIp !== "unavailable" ? displayIp : "unknown";

    return {
      mode,
      displayIp,
      homePublicIp,
      measuredWanIp,
      warning,
      ipSource,
      autoLocked,
      proxyPool: this.listPanelProxies(),
      selectedProxyId: proxyId || undefined,
      lockedIp,
      measuredProfileId,
      measuredCdpPort,
    };
  }

  private collectClaimedCdpPorts(excludeProfileId?: string): Array<number | null | undefined> {
    return this.chromeProfileStore.listAll().flatMap((profile) => {
      if (excludeProfileId && profile.id === excludeProfileId) {
        return [];
      }
      const session = this.chromeSessionStore.get(profile.id);
      return [session?.assignedCdpPort, profile.preferredCdpPort];
    });
  }

  private async validateWatcherStart(profileId: string): Promise<{ worker: WorkerConfig; effectiveIp: string }> {
    let worker = this.resolveEffectiveWorker(profileId);
    let lockedIp = normalizeLockedIp(worker.lockedIp);

    if (worker.proxyMode === "direct") {
      if (!lockedIp) {
        await this.ensureDirectHomeIp(profileId);
        worker = this.resolveEffectiveWorker(profileId);
        lockedIp = normalizeLockedIp(worker.lockedIp);
      }

      if (!lockedIp) {
        throw new Error(
          "Ev modu: IP kilitlemeden watcher başlatılamaz. «Ev IP'yi yeniden ölç» veya «Mevcut IP'yi kilitle» deyin.",
        );
      }

      worker = { ...worker, lockedIp, proxyId: "", proxyUrl: "" };
      return { worker, effectiveIp: lockedIp };
    }

    const network = await this.getNetworkIp(
      profileId,
      { proxyMode: "proxy", proxyId: worker.proxyId },
      { skipServerMeasure: true, autoLock: false, measureViaChrome: true },
    );
    lockedIp = normalizeLockedIp(network.lockedIp) || lockedIp;

    if (!lockedIp) {
      const hint =
        network.displayIp !== "unknown"
          ? network.displayIp
          : "proxy çıkış IP ölçülemedi";
      throw new Error(
        `IP kilitlemeden watcher başlatılamaz (${hint}). Proxy seçin, IP'yi kilitleyin.`,
      );
    }

    if (!worker.proxyId && !worker.proxyUrl?.trim()) {
      throw new Error("Proxy modu seçili — listeden statik IP proxy seçin, kaydedin ve IP'yi kilitleyin.");
    }

    if (network.displayIp !== "unknown" && lockedIp !== network.displayIp) {
      throw new Error(
        `Kilitli IP (${lockedIp}) seçili proxy çıkış IP'si (${network.displayIp}) ile uyuşmuyor. IP'yi yeniden kilitleyin.`,
      );
    }

    worker = { ...worker, lockedIp };
    return { worker, effectiveIp: lockedIp };
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
    this.savePanelDraft(profileId, {
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
    const applicationTypeId = resolveApplicationTypeIdFromLabel(api.applicationType);
    const env: NodeJS.ProcessEnv = {
      API_DEALER_OFFICE: api.dealerOffice,
      APPOINTMENT_STYLE: api.appointmentStyle,
      APPLICATION_TYPE: api.applicationType,
      [`API_DEALER_OFFICE_${profileKey}`]: api.dealerOffice,
      [`APPOINTMENT_STYLE_${profileKey}`]: api.appointmentStyle,
      [`APPLICATION_TYPE_${profileKey}`]: api.applicationType,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" "),
    };
    if (appointmentTypeId) {
      env.API_APPOINTMENT_TYPE_ID = appointmentTypeId;
      env[`API_APPOINTMENT_TYPE_ID_${profileKey}`] = appointmentTypeId;
    }
    if (applicationTypeId) {
      env.API_APPLICATION_TYPE_ID = applicationTypeId;
      env[`API_APPLICATION_TYPE_ID_${profileKey}`] = applicationTypeId;
    }
    const tc = api.nationalityNumber?.trim();
    if (tc) {
      env.NATIONALITY_NUMBER = tc;
      env[`NATIONALITY_NUMBER_${profileKey}`] = tc;
    }
    const phone = api.otpPhone?.trim();
    if (phone) {
      env.PHONE = phone;
      env[`PHONE_${profileKey}`] = phone;
    }
    const portalEmail = api.portalEmail?.trim();
    if (portalEmail) {
      env.PORTAL_EMAIL = portalEmail;
      env[`REGISTER_EMAIL_${profileKey}`] = portalEmail;
    }
    const passport = api.passportNumber?.trim();
    if (passport) {
      env.PASSPORT_NO = passport;
      env[`PASSPORT_NO_${profileKey}`] = passport;
    }
    return env;
  }

  async startChrome(
    profileId: string,
    launch?: {
      proxyMode?: ProxyMode;
      proxyId?: string;
      proxyUrl?: string;
      cdpPort?: number | null;
      lockedIp?: string;
    },
  ) {
    this.chromeProfileStore.getOrThrow(profileId);
    const chromeProfile = this.chromeProfileStore.getOrThrow(profileId);
    const existingSession = this.chromeSessionStore.get(profileId);

    const proxyMode = launch?.proxyMode ?? existingSession?.proxyMode ?? "direct";
    const proxyId = launch?.proxyId ?? existingSession?.proxyId ?? "";
    const proxyUrl = launch?.proxyUrl ?? existingSession?.proxyUrl ?? "";

    if (proxyMode === "proxy" && !proxyId && !proxyUrl.trim()) {
      throw new Error("Proxy modu için proxy seçin (Chrome Aç öncesi zorunlu).");
    }

    const assignedCdpPort = await allocateCdpPort(
      this.registry,
      launch?.cdpPort ?? existingSession?.assignedCdpPort ?? chromeProfile.preferredCdpPort,
      this.collectClaimedCdpPorts(profileId),
    );

    this.chromeSessionStore.upsert({
      profileId,
      assignedCdpPort,
      proxyMode,
      proxyId: proxyMode === "proxy" ? proxyId : "",
      proxyUrl: proxyMode === "proxy" ? proxyUrl : "",
      lockedIp: launch?.lockedIp ?? existingSession?.lockedIp,
      lastKnownHomeIp: existingSession?.lastKnownHomeIp,
      draftApi: existingSession?.draftApi,
      draftTiming: existingSession?.draftTiming,
      updatedAt: new Date().toISOString(),
    });

    this.syncManifestFromPanelProfiles();
    const profile = this.resolveProfile(profileId);
    const worker = this.resolveEffectiveWorker(profileId);
    const workerForLaunch: WorkerConfig = {
      ...worker,
      proxyMode,
      proxyId: proxyMode === "proxy" ? proxyId : "",
      proxyUrl: proxyMode === "proxy" ? proxyUrl : "",
    };
    const directMode = proxyMode !== "proxy";
    const proxyServer =
      proxyMode === "proxy"
        ? await resolveChromeProxyServer(this.projectRoot, profile, workerForLaunch)
        : undefined;

    if (proxyMode === "proxy" && !proxyServer) {
      const def = resolveWorkerProxyDefinition(this.projectRoot, profile, workerForLaunch);
      if (!def) {
        throw new Error(
          `Proxy kaydı bulunamadı (${proxyId || proxyUrl || "boş"}). «Ağ taslağını kaydet» deyin.`,
        );
      }
      if (def.ispStatic) {
        throw new Error(
          `"${def.label}" WAN statik kayıt — Chrome HTTP gate kullanamaz. «test» gibi gate kaydı seçin.`,
        );
      }
      throw new Error(`Proxy "${def.label}" Chrome için çözülemedi.`);
    }

    const launchResult = await launchChromeForProfile(
      profile,
      this.registry,
      proxyServer,
      directMode,
      { forceFresh: true, cdpPort: assignedCdpPort },
    );

    this.savePanelDraft(profileId, {
      proxyMode,
      proxyId: proxyMode === "proxy" ? proxyId : "",
      proxyUrl: proxyMode === "proxy" ? proxyUrl : "",
      lockedIp: launch?.lockedIp ?? existingSession?.lockedIp ?? worker.lockedIp,
      lastKnownHomeIp:
        directMode && (launch?.lockedIp ?? existingSession?.lockedIp ?? worker.lockedIp)
          ? launch?.lockedIp ?? existingSession?.lockedIp ?? worker.lockedIp
          : existingSession?.lastKnownHomeIp ?? worker.lastKnownHomeIp,
    });

    let googleLogin: ChromeGoogleLoginResult | undefined;
    if (launchResult.ok && !launchResult.reusedExisting) {
      const settings = loadSettings(this.projectRoot);
      googleLogin = await ensureChromeGoogleLoginAfterLaunch(
        profile,
        chromeProfile,
        settings,
        launchResult,
      );
    }

    return { launch: launchResult, assignedCdpPort, googleLogin };
  }

  stopChrome(profileId: string): { stopped: number; processIds: string[]; killedPortPids: number[] } {
    const chromeProfile = this.chromeProfileStore.get(profileId);
    const session = this.chromeSessionStore.get(profileId);
    const cdpPort =
      session?.assignedCdpPort ?? chromeProfile?.preferredCdpPort ?? 9222;

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

    const killedPortPids = cdpPort ? killProcessesOnPort(cdpPort) : [];
    if (killedPortPids.length > 0) {
      stopped += killedPortPids.length;
    }

    return { stopped, processIds, killedPortPids };
  }

  async measureChromeExitIp(profileId: string): Promise<{ ip: string; cdpPort: number }> {
    const session = this.chromeSessionStore.get(profileId);
    const chromeProfile = this.chromeProfileStore.get(profileId);
    const cdpPort =
      session?.assignedCdpPort ?? chromeProfile?.preferredCdpPort ?? 9222;
    const ip = await measureHomeIpViaChrome(cdpPort);
    if (!ip) {
      throw new Error(
        `Chrome çıkış IP ölçülemedi (port ${cdpPort}). Önce «Chrome Aç» deyin; debug penceresinde internet erişimi olduğundan emin olun.`,
      );
    }
    return { ip, cdpPort };
  }

  private enrichHealthRecord(
    record: ApiHealthRecord,
    profiles: ProfileOption[],
    publicIp: string,
  ): ApiHealthRecord {
    const profile = profiles.find((p) => p.id === record.profileId);
    const worker = this.resolveEffectiveWorker(record.profileId, publicIp);
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
      const worker = this.resolveEffectiveWorker(profileOption.id, publicIp);
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
    const cdpPort = this.resolveProfileCdpPort(profileId, profile);
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
    const sanitizedApi = sanitizeWorkerApiParams(api);
    const validation = validateWorkerApiParams(sanitizedApi);
    if (!validation.ok) {
      throw new Error(`Worker ayarları eksik: ${validation.errors.join("; ")}`);
    }

    const timingDefaults = this.runtimeDefaults();
    const resolvedTiming = {
      pollIntervalMs: timing?.pollIntervalMs ?? timingDefaults.pollIntervalMs,
      telegramReportIntervalMs:
        timing?.telegramReportIntervalMs ?? timingDefaults.telegramReportIntervalMs,
    };

    this.savePanelDraft(profileId, { api: sanitizedApi, timing: resolvedTiming });
    const { worker, effectiveIp } = await this.validateWatcherStart(profileId);

    const profile = this.resolveProfile(profileId);
    const cdpPort = this.resolveProfileCdpPort(profileId, profile);
    const chrome = await getChromeStatus(cdpPort);

    const steps: string[] = [];
    steps.push("Watcher oturumu hazırlandı");

    if (!chrome.ready) {
      throw new Error(
        "Chrome CDP hazır değil. Önce «Chrome Aç» ile tarayıcıyı başlatın, ardından API İzlemeyi Başlatın.",
      );
    }
    steps.push(`Chrome CDP hazır (:${cdpPort})`);

    const chromeSession = this.chromeSessionStore.get(profileId);
    this.watcherSessionStore.upsert({
      profileId,
      network: {
        proxyMode: worker.proxyMode,
        proxyId: worker.proxyId,
        proxyUrl: worker.proxyUrl,
        lockedIp: effectiveIp,
        assignedCdpPort: chromeSession?.assignedCdpPort ?? cdpPort,
      },
      api: worker.api,
      timing: worker.timing ?? resolvedTiming,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const process = await this.startApiWatcher(profileId, sanitizedApi);
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

    this.watcherSessionStore.clear(profileId);
    const session = this.chromeSessionStore.get(profileId);
    if (session) {
      this.chromeSessionStore.patch(profileId, {
        draftApi: undefined,
        draftTiming: undefined,
        lockedIp: session.proxyMode === "direct" ? session.lockedIp : "",
      });
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
    const chromeProfile = this.chromeProfileStore.getOrThrow(profileId);
    const tsx = resolve(this.projectRoot, "node_modules/tsx/dist/cli.mjs");
    const script = resolve(this.projectRoot, "src/scenarios/runScenario.ts");
    const env = {
      ...this.buildApiEnv(profileId, api),
      ...buildChromeCredentialEnv(chromeProfile),
      PANEL_MANAGED_PORTAL_FLOW: "true",
      API_WIZARD_AUTO_NAVIGATE: "true",
    };

    return this.registry.spawnManaged(
      "api-watcher",
      profileId,
      `API Watcher — ${api.dealerOffice} / ${api.appointmentStyle}`,
      process.execPath,
      ["--use-system-ca", tsx, script, "--id", "api-watcher-attach", "--profile", profileId, "--no-wait"],
      { cwd: this.projectRoot, env, cdpPort: this.resolveProfileCdpPort(profileId, profile) },
    );
  }

  async listProcesses(): Promise<ManagedProcessWithRuntime[]> {
    await this.registry.reconcile();
    const defaults = this.runtimeDefaults();
    return this.registry
      .listActive()
      .map((proc) => {
        const sessionPort = this.chromeSessionStore.get(proc.profileId)?.assignedCdpPort;
        const cdpPort = proc.cdpPort ?? sessionPort;
        return {
          ...proc,
          cdpPort,
          runtime:
            proc.kind === "api-watcher" &&
            (proc.status === "running" || proc.status === "starting")
              ? this.runtimeStore.get(proc.profileId, defaults)
              : undefined,
          runtimeOptionsMs: RUNTIME_INTERVAL_OPTIONS_MS,
        };
      });
  }

  async updateProcessRuntimeConfig(
    processId: string,
    patch: { pollIntervalMs?: number; telegramReportIntervalMs?: number },
  ): Promise<{ runtime: WorkerRuntimeConfig; process: ManagedProcessWithRuntime }> {
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
    const processes = await this.listProcesses();
    const updated = processes.find((entry) => entry.id === processId);
    if (!updated) {
      throw new Error("Süreç listesinde bulunamadı");
    }
    return { runtime, process: updated };
  }

  async killProcess(processId: string): Promise<{ ok: boolean; message: string }> {
    await this.registry.reconcile();

    const proc = this.registry.get(processId);
    if (!proc) {
      return { ok: true, message: "Süreç zaten listede yok" };
    }

    if (proc.status === "exited" || proc.status === "failed") {
      this.registry.remove(processId);
      return { ok: true, message: "Süreç zaten sonlanmış — listeden kaldırıldı" };
    }

    if (proc.kind === "chrome" && proc.cdpPort) {
      const ready = await getChromeStatus(proc.cdpPort);
      if (!ready.ready) {
        this.registry.markExited(processId, "Chrome zaten kapalı");
        return { ok: true, message: "Chrome zaten kapalı — listeden kaldırıldı" };
      }
    }

    const killed = this.registry.kill(processId);
    if (killed && proc.kind === "api-watcher") {
      this.watcherSessionStore.clear(proc.profileId);
      const session = this.chromeSessionStore.get(proc.profileId);
      if (session) {
        this.chromeSessionStore.patch(proc.profileId, {
          draftApi: undefined,
          draftTiming: undefined,
        });
      }
      return { ok: true, message: "Süreç sonlandırıldı" };
    }

    if (killed) {
      return { ok: true, message: "Süreç sonlandırıldı" };
    }

    this.registry.markExited(processId, "Süreç zaten kapalı");
    return { ok: true, message: "Süreç zaten kapalı — listeden kaldırıldı" };
  }
}
