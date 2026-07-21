import type { Page } from "playwright";

import { ApiHealthStore } from "../../control-panel/apiHealthStore.js";
import type { ApiWatcherSettings, AppSettings, TelegramSettings } from "../../config/settings.js";
import { buildApiAvailabilityTextSummary } from "../notifications/apiAvailabilityTelegram.js";
import { TelegramNotifier } from "../../notifications/telegramNotifier.js";
import { logger } from "../../utils/logger.js";
import type { ApiWatcherHandle, ClosedDatePollResult } from "../types.js";
import { checkAvailability } from "../client/checkAvailability.js";
import type { ApiServiceContext } from "../client/apiService.js";
import type { ApiQueryParams } from "../client/resolveApiQueryParams.js";
import { formatDurationTr, resolveRateLimitBackoffMs } from "../client/rateLimitPolicy.js";
import { detectPublicIp } from "../../control-panel/chromeLauncher.js";

export interface AvailabilityWatcherOptions {
  projectRoot: string;
  profileId: string;
  profileName?: string;
  lockedIp?: string;
  cdpPort?: number;
  settings: AppSettings;
  queryParams: ApiQueryParams;
  getBearerToken: () => string | null;
  onUnauthorized: () => Promise<string | null>;
  page?: Page;
  resolvePage?: () => Promise<Page | undefined>;
  resolveQueryParams?: () => ApiQueryParams;
}

function buildApiContext(
  options: AvailabilityWatcherOptions,
  apiSettings: ApiWatcherSettings,
): ApiServiceContext {
  return {
    projectRoot: options.projectRoot,
    profileId: options.profileId,
    settings: apiSettings,
    bearerToken: options.getBearerToken(),
  };
}

function activeDatesEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((date) => rightSet.has(date));
}

function rawBodyText(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw && typeof raw === "object") {
    try {
      return JSON.stringify(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * checkAvailability() — varsayılan 2 dk aralıkla.
 * 429/ban: tek istek, uzun backoff, panelde görünür.
 */
export function startAvailabilityWatcher(
  options: AvailabilityWatcherOptions,
  telegramSettings: TelegramSettings,
): ApiWatcherHandle {
  const apiSettings = options.settings.apiWatcher;
  if (!apiSettings.enabled) {
    logger.info("[api-watcher] Kapalı — API_WATCHER_ENABLED=false");
    return { stop: () => undefined };
  }

  const healthStore = new ApiHealthStore(options.projectRoot);
  const telegram = new TelegramNotifier(telegramSettings);
  let running = false;
  let stopped = false;
  let lastOpenNotifyAt = 0;
  let previousClosedDates: string[] | null = null;
  let previousActiveDates: string[] | null = null;
  let lastTelegramReportAt = 0;
  let rateLimitUntil = 0;
  let lastRateLimitLogAt = 0;
  let rateLimitTelegramSentAt = 0;
  let requestsLastHour = 0;
  let hourWindowStart = Date.now();
  const pollMs = apiSettings.pollIntervalMs;
  const telegramReportMs = Math.min(apiSettings.telegramReportIntervalMs, pollMs);
  let watcherPublicIp = options.lockedIp || "unknown";
  void detectPublicIp().then((ip) => {
    if (ip !== "unknown") {
      watcherPublicIp = ip;
    }
  });

  const recordHealth = (patch: Parameters<ApiHealthStore["update"]>[1]): void => {
    healthStore.update(options.profileId, {
      profileName: options.profileName,
      publicIp: watcherPublicIp,
      lockedIp: options.lockedIp,
      cdpPort: options.cdpPort,
      pollIntervalMs: pollMs,
      requestsLastHour,
      dealerOffice: options.queryParams.dealerOfficeLabel,
      appointmentStyle: options.queryParams.appointmentStyleLabel,
      appointmentTypeId: options.queryParams.appointmentTypeId,
      ...patch,
    });
  };

  logger.info(
    `[api-watcher] checkAvailability her ${pollMs}ms — profil: ${options.profileId} (tek istek/poll)`,
  );

  const processPollResult = async (result: ClosedDatePollResult): Promise<void> => {
    const queryParams = options.resolveQueryParams?.() ?? options.queryParams;
    const nowIso = new Date().toISOString();

    if (result.rateLimited) {
      const bodyText = rawBodyText(result.raw);
      const backoffMs = resolveRateLimitBackoffMs({
        pollIntervalMs: pollMs,
        bodyText,
      });
      rateLimitUntil = Date.now() + backoffMs;
      const banUntil = new Date(rateLimitUntil).toISOString();
      const summary =
        backoffMs >= 3_600_000
          ? `Portal ban — ${formatDurationTr(backoffMs)} bekleyin`
          : `HTTP 429 — ${formatDurationTr(backoffMs)} bekleyin`;

      if (Date.now() - lastRateLimitLogAt >= 60_000) {
        lastRateLimitLogAt = Date.now();
        logger.warn(`[api-watcher] ${summary}`);
      }

      recordHealth({
        status: backoffMs >= 3_600_000 ? "banned" : "rate_limited",
        lastPollAt: nowIso,
        lastHttpStatus: result.status,
        lastError: bodyText?.slice(0, 500) ?? result.summary,
        lastSummary: summary,
        backoffUntil: banUntil,
        portalBanUntil: backoffMs >= 3_600_000 ? banUntil : undefined,
      });

      if (telegram.isConfigured() && Date.now() - rateLimitTelegramSentAt >= 3_600_000) {
        rateLimitTelegramSentAt = Date.now();
        const ipNote = watcherPublicIp !== "unknown" ? ` · IP: ${watcherPublicIp}` : "";
        await telegram.notifyManualHelpRequired({
          profileId: options.profileId,
          url: "GetClosedDate API",
          reason: `${summary}${ipNote}`,
        });
      }
      return;
    }

    if (result.unauthorized) {
      logger.warn("[api-watcher] 401 — token yenileme yapıldı, aynı poll'da ikinci istek YOK.");
      recordHealth({
        status: "unauthorized",
        lastPollAt: nowIso,
        lastHttpStatus: result.status,
        lastError: result.summary,
        lastSummary: result.summary,
      });
      return;
    }

    if (!result.ok) {
      logger.warn(`[api-watcher] Poll hatası: ${result.summary}`);
      recordHealth({
        status: "error",
        lastPollAt: nowIso,
        lastHttpStatus: result.status,
        lastError: result.summary,
        lastSummary: result.summary,
      });
      return;
    }

    logger.info(`[api-watcher] ${result.summary}`);

    const activeDates = result.activeDates ?? result.openDates ?? [];
    const currentClosed = result.closedDates ?? [];
    const bookableStart = result.bookableStart ?? queryParams.date;
    const bookableEnd = result.bookableEnd ?? queryParams.maxDate;

    recordHealth({
      status: activeDates.length > 0 ? "ok" : "empty",
      lastPollAt: nowIso,
      lastOkAt: nowIso,
      lastHttpStatus: result.status,
      lastSummary: result.summary,
      lastError: undefined,
      backoffUntil: undefined,
    });

    if (activeDates.length > 0) {
      logger.info(
        `[api-watcher] Aktif günler (${activeDates.length}, ${bookableStart} → ${bookableEnd}): ${activeDates.join(", ")}`,
      );
    } else {
      logger.info(
        `[api-watcher] Aktif gün yok — ${bookableStart} → ${bookableEnd} aralığında seçilebilir gün kalmadı.`,
      );
    }

    const removedClosed =
      previousClosedDates?.filter((date) => !currentClosed.includes(date)) ?? [];
    const hasNewActiveDays =
      removedClosed.length > 0 ||
      (previousActiveDates !== null &&
        activeDates.some((date) => !previousActiveDates!.includes(date)));
    const sameActiveAsPrevious =
      previousActiveDates !== null && activeDatesEqual(activeDates, previousActiveDates);
    const now = Date.now();
    const periodicTelegramDue = now - lastTelegramReportAt >= telegramReportMs;

    if (apiSettings.telegramReportEnabled && telegram.isConfigured()) {
      const shouldSendTelegram =
        previousActiveDates === null ||
        hasNewActiveDays ||
        !sameActiveAsPrevious ||
        periodicTelegramDue;

      if (shouldSendTelegram) {
        const officeLabel = queryParams.dealerOfficeLabel ?? queryParams.cityLabel;
        const textSummary = buildApiAvailabilityTextSummary({
          profileId: options.profileId,
          cityLabel: officeLabel,
          appointmentStyleLabel: queryParams.appointmentStyleLabel,
          bookableStart,
          bookableEnd,
          maxDate: queryParams.maxDate,
          activeDates,
          closedDates: currentClosed,
        });

        await telegram.notifyApiAvailability({
          profileId: options.profileId,
          city: officeLabel,
          appointmentStyle: queryParams.appointmentStyleLabel,
          textSummary,
          activeDates,
          isEmpty: activeDates.length === 0,
          hasNewDays: hasNewActiveDays,
          periodicReport: true,
        });
        lastTelegramReportAt = now;
      }
    }

    previousActiveDates = [...activeDates];
    previousClosedDates = currentClosed;

    if (removedClosed.length > 0) {
      if (now - lastOpenNotifyAt >= apiSettings.openNotifyCooldownMs) {
        lastOpenNotifyAt = now;
        await import("../executor/bookingExecutor.js").then(({ runBookingExecutorStub }) =>
          runBookingExecutorStub({
            profileId: options.profileId,
            settings: apiSettings,
            pollResult: result,
          }),
        );
      }
    }
  };

  const runPoll = async (): Promise<void> => {
    if (running || stopped) {
      return;
    }
    running = true;

    try {
      const blocked = healthStore.isBlocked(options.profileId);
      if (blocked.blocked && blocked.until) {
        rateLimitUntil = Math.max(rateLimitUntil, Date.parse(blocked.until));
      }

      if (Date.now() < rateLimitUntil) {
        return;
      }

      if (Date.now() - hourWindowStart >= 3_600_000) {
        hourWindowStart = Date.now();
        requestsLastHour = 0;
      }

      let bearer = options.getBearerToken();
      if (!bearer) {
        bearer = await options.onUnauthorized();
      }
      if (!bearer) {
        logger.warn("[api-watcher] Token yok — poll atlandı.");
        recordHealth({
          status: "error",
          lastPollAt: new Date().toISOString(),
          lastError: "Token yok",
          lastSummary: "Token yok — poll atlandı",
        });
        return;
      }

      const queryParams = options.resolveQueryParams?.() ?? options.queryParams;
      const page = options.resolvePage ? await options.resolvePage() : options.page;

      const result = await checkAvailability(
        buildApiContext(options, apiSettings),
        queryParams,
        page,
      );
      requestsLastHour += 1;

      if (result.unauthorized) {
        await options.onUnauthorized();
      }

      await processPollResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[api-watcher] ${message}`);
      recordHealth({
        status: "error",
        lastPollAt: new Date().toISOString(),
        lastError: message,
        lastSummary: message,
      });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void runPoll();
  }, pollMs);

  void runPoll();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      logger.info("[api-watcher] Durduruldu.");
    },
  };
}

export { startAvailabilityWatcher as startClosedDateWatcher };
