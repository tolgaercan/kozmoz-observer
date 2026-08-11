import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  normalizeRuntimeIntervalMs,
  type RuntimeIntervalDefaults,
} from "./workerTimingUtils.js";

export type ProxyMode = "direct" | "proxy";

export interface WorkerApiParams {
  dealerOffice: string;
  appointmentStyle: string;
  /** Wizard adım 2 — Bireysel / Aile */
  applicationType: string;
  /** Wizard adım 2 — TC Kimlik No (11 hane) */
  nationalityNumber: string;
  /** OTP / SMS — 10 hane, başında 0 yok (5XXXXXXXXX) */
  otpPhone: string;
  /** Başvuru / OTP popup e-posta */
  portalEmail: string;
  /** Kimlik ve Telefon Doğrulama popup — pasaport no */
  passportNumber: string;
}

export interface WorkerTimingParams {
  pollIntervalMs: number;
  telegramReportIntervalMs: number;
}

export interface WorkerConfig {
  profileId: string;
  proxyMode: ProxyMode;
  /** Ev interneti veya proxy IP — kilitleme için */
  lockedIp: string;
  /** Son başarılı ev IP ölçümü (ProxyNet kapalıyken) */
  lastKnownHomeIp?: string;
  /** İleride: http://user:pass@host:port */
  proxyUrl?: string;
  /** data/config/proxy-pool.local.json içindeki id */
  proxyId?: string;
  api: WorkerApiParams;
  /** Profil bazlı poll / Telegram aralıkları (.env yalnızca varsayılan) */
  timing: WorkerTimingParams;
  updatedAt: string;
}

export interface ControlPanelStore {
  defaultProfileId?: string;
  workers: Record<string, WorkerConfig>;
}

const FALLBACK_TIMING_DEFAULTS: RuntimeIntervalDefaults = {
  pollIntervalMs: 300_000,
  telegramReportIntervalMs: 300_000,
};

function resolveWorkerTiming(
  timing: Partial<WorkerTimingParams> | undefined,
  defaults: RuntimeIntervalDefaults = FALLBACK_TIMING_DEFAULTS,
): WorkerTimingParams {
  return {
    pollIntervalMs: normalizeRuntimeIntervalMs(timing?.pollIntervalMs, defaults.pollIntervalMs),
    telegramReportIntervalMs: normalizeRuntimeIntervalMs(
      timing?.telegramReportIntervalMs,
      defaults.telegramReportIntervalMs,
    ),
  };
}

function defaultWorkerConfig(
  profileId: string,
  lockedIp: string,
  timingDefaults: RuntimeIntervalDefaults = FALLBACK_TIMING_DEFAULTS,
): WorkerConfig {
  return {
    profileId,
    proxyMode: "direct",
    lockedIp,
    api: {
      dealerOffice: "Ankara",
      appointmentStyle: "Standart",
      applicationType: "Bireysel",
      nationalityNumber: "",
      otpPhone: "",
      portalEmail: "",
      passportNumber: "",
    },
    timing: resolveWorkerTiming(undefined, timingDefaults),
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeLockedIp(value?: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "—" || trimmed === "-" || trimmed === "unknown") {
    return "";
  }
  return trimmed;
}

export class WorkerConfigStore {
  private readonly storePath: string;

  constructor(projectRoot: string) {
    this.storePath = resolve(projectRoot, "data/control-panel/worker-config.json");
  }

  load(): ControlPanelStore {
    if (!existsSync(this.storePath)) {
      return { workers: {} };
    }
    try {
      const raw = readFileSync(this.storePath, "utf-8");
      return JSON.parse(raw) as ControlPanelStore;
    } catch {
      return { workers: {} };
    }
  }

  save(store: ControlPanelStore): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    writeFileSync(this.storePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  }

  getWorker(
    profileId: string,
    fallbackIp: string,
    timingDefaults: RuntimeIntervalDefaults = FALLBACK_TIMING_DEFAULTS,
  ): WorkerConfig {
    const store = this.load();
    const existing = store.workers[profileId];
    if (!existing) {
      return defaultWorkerConfig(profileId, fallbackIp, timingDefaults);
    }

    return {
      ...existing,
      profileId,
      lockedIp: normalizeLockedIp(existing.lockedIp),
      api: {
        dealerOffice: existing.api?.dealerOffice ?? "Ankara",
        appointmentStyle: existing.api?.appointmentStyle ?? "Standart",
        applicationType: existing.api?.applicationType ?? "Bireysel",
        nationalityNumber: existing.api?.nationalityNumber ?? "",
        otpPhone: existing.api?.otpPhone ?? "",
        portalEmail: existing.api?.portalEmail ?? "",
        passportNumber: existing.api?.passportNumber ?? "",
      },
      timing: resolveWorkerTiming(existing.timing, timingDefaults),
      updatedAt: existing.updatedAt,
    };
  }

  updateWorker(
    profileId: string,
    patch: Partial<Omit<WorkerConfig, "profileId" | "timing" | "api">> & {
      api?: Partial<WorkerApiParams>;
      timing?: Partial<WorkerTimingParams>;
    },
    timingDefaults: RuntimeIntervalDefaults = FALLBACK_TIMING_DEFAULTS,
  ): WorkerConfig {
    const store = this.load();
    const existing = store.workers[profileId] ?? defaultWorkerConfig(profileId, patch.lockedIp ?? "", timingDefaults);
    const resolvedTiming = resolveWorkerTiming(existing.timing, timingDefaults);
    const next: WorkerConfig = {
      ...existing,
      ...patch,
      profileId,
      lockedIp: normalizeLockedIp(patch.lockedIp ?? existing.lockedIp),
      api: { ...existing.api, ...patch.api },
      timing: patch.timing
        ? {
            pollIntervalMs: normalizeRuntimeIntervalMs(
              patch.timing.pollIntervalMs ?? resolvedTiming.pollIntervalMs,
              timingDefaults.pollIntervalMs,
            ),
            telegramReportIntervalMs: normalizeRuntimeIntervalMs(
              patch.timing.telegramReportIntervalMs ?? resolvedTiming.telegramReportIntervalMs,
              timingDefaults.telegramReportIntervalMs,
            ),
          }
        : resolvedTiming,
      updatedAt: new Date().toISOString(),
    };
    store.workers[profileId] = next;
    store.defaultProfileId = store.defaultProfileId ?? profileId;
    this.save(store);
    return next;
  }
}
