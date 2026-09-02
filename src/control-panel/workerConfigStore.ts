import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  normalizeRuntimeIntervalMs,
  type RuntimeIntervalDefaults,
  type WorkerBookingDefaults,
  type WorkerConfigDefaults,
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

/** Randevu ödeme adımı — kart bilgileri (panelden) */
export interface WorkerPaymentParams {
  cardNumber: string;
  cardholderName: string;
  /** 01–12 */
  expireMonth: string;
  /** örn. 2028 */
  expireYear: string;
  cvv: string;
  /** Boşsa portalEmail kullanılır */
  email: string;
  /** Boşsa otpPhone kullanılır (10 hane, 5XXXXXXXXX) */
  phone: string;
}

export interface WorkerTimingParams {
  pollIntervalMs: number;
  telegramReportIntervalMs: number;
}

/** Worker bazlı ödeme otomasyonu — .env varsayılanının üzerine yazar */
export interface WorkerBookingParams {
  paymentAutoSubmit: boolean;
  payment3dsAuto: boolean;
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
  /** Ödeme sayfası kart formu — watcher başlatmak için zorunlu değil */
  payment: WorkerPaymentParams;
  /** Ödeme adımı otomasyon bayrakları (panel checkbox) */
  booking: WorkerBookingParams;
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

const FALLBACK_BOOKING_DEFAULTS: WorkerBookingDefaults = {
  paymentAutoSubmit: true,
  payment3dsAuto: false,
};

const FALLBACK_CONFIG_DEFAULTS: WorkerConfigDefaults = {
  ...FALLBACK_TIMING_DEFAULTS,
  ...FALLBACK_BOOKING_DEFAULTS,
};

function defaultWorkerPayment(): WorkerPaymentParams {
  return {
    cardNumber: "",
    cardholderName: "",
    expireMonth: "",
    expireYear: "",
    cvv: "",
    email: "",
    phone: "",
  };
}

function resolveWorkerPayment(
  payment: Partial<WorkerPaymentParams> | undefined,
): WorkerPaymentParams {
  return {
    cardNumber: payment?.cardNumber ?? "",
    cardholderName: payment?.cardholderName ?? "",
    expireMonth: payment?.expireMonth ?? "",
    expireYear: payment?.expireYear ?? "",
    cvv: payment?.cvv ?? "",
    email: payment?.email ?? "",
    phone: payment?.phone ?? "",
  };
}

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

function resolveWorkerBooking(
  booking: Partial<WorkerBookingParams> | undefined,
  defaults: WorkerBookingDefaults = FALLBACK_BOOKING_DEFAULTS,
): WorkerBookingParams {
  return {
    paymentAutoSubmit: booking?.paymentAutoSubmit ?? defaults.paymentAutoSubmit,
    payment3dsAuto: booking?.payment3dsAuto ?? defaults.payment3dsAuto,
  };
}

function defaultWorkerConfig(
  profileId: string,
  lockedIp: string,
  configDefaults: WorkerConfigDefaults = FALLBACK_CONFIG_DEFAULTS,
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
    payment: defaultWorkerPayment(),
    booking: resolveWorkerBooking(undefined, configDefaults),
    timing: resolveWorkerTiming(undefined, configDefaults),
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

/** .env / loadSettings → panel worker-config varsayılanları */
export function buildWorkerConfigDefaults(input: WorkerConfigDefaults): WorkerConfigDefaults {
  return {
    pollIntervalMs: input.pollIntervalMs,
    telegramReportIntervalMs: input.telegramReportIntervalMs,
    paymentAutoSubmit: input.paymentAutoSubmit,
    payment3dsAuto: input.payment3dsAuto,
  };
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
    configDefaults: Partial<WorkerConfigDefaults> = FALLBACK_CONFIG_DEFAULTS,
  ): WorkerConfig {
    const resolvedDefaults: WorkerConfigDefaults = {
      ...FALLBACK_CONFIG_DEFAULTS,
      ...configDefaults,
    };
    const store = this.load();
    const existing = store.workers[profileId];
    if (!existing) {
      return defaultWorkerConfig(profileId, fallbackIp, resolvedDefaults);
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
      payment: resolveWorkerPayment(existing.payment),
      booking: resolveWorkerBooking(existing.booking, resolvedDefaults),
      timing: resolveWorkerTiming(existing.timing, resolvedDefaults),
      updatedAt: existing.updatedAt,
    };
  }

  updateWorker(
    profileId: string,
    patch: Partial<Omit<WorkerConfig, "profileId" | "timing" | "api" | "payment" | "booking">> & {
      api?: Partial<WorkerApiParams>;
      payment?: Partial<WorkerPaymentParams>;
      booking?: Partial<WorkerBookingParams>;
      timing?: Partial<WorkerTimingParams>;
    },
    configDefaults: Partial<WorkerConfigDefaults> = FALLBACK_CONFIG_DEFAULTS,
  ): WorkerConfig {
    const resolvedDefaults: WorkerConfigDefaults = {
      ...FALLBACK_CONFIG_DEFAULTS,
      ...configDefaults,
    };
    const store = this.load();
    const existing =
      store.workers[profileId] ?? defaultWorkerConfig(profileId, patch.lockedIp ?? "", resolvedDefaults);
    const resolvedTiming = resolveWorkerTiming(existing.timing, resolvedDefaults);
    const resolvedBooking = resolveWorkerBooking(existing.booking, resolvedDefaults);
    const next: WorkerConfig = {
      ...existing,
      ...patch,
      profileId,
      lockedIp: normalizeLockedIp(patch.lockedIp ?? existing.lockedIp),
      api: { ...existing.api, ...patch.api },
      payment: { ...existing.payment, ...patch.payment },
      booking: patch.booking ? { ...resolvedBooking, ...patch.booking } : resolvedBooking,
      timing: patch.timing
        ? {
            pollIntervalMs: normalizeRuntimeIntervalMs(
              patch.timing.pollIntervalMs ?? resolvedTiming.pollIntervalMs,
              resolvedDefaults.pollIntervalMs,
            ),
            telegramReportIntervalMs: normalizeRuntimeIntervalMs(
              patch.timing.telegramReportIntervalMs ?? resolvedTiming.telegramReportIntervalMs,
              resolvedDefaults.telegramReportIntervalMs,
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
