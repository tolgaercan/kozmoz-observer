import type { Page } from "playwright";

import type { ApiWatcherSettings, AppSettings, TelegramSettings } from "../../config/settings.js";
import { buildApiAvailabilityTextSummary } from "../notifications/apiAvailabilityTelegram.js";
import { listDatesInRange } from "../client/availabilityDates.js";
import { TelegramNotifier } from "../../notifications/telegramNotifier.js";
import { logger } from "../../utils/logger.js";
import type { ApiWatcherHandle, ClosedDatePollResult } from "../types.js";
import { checkAvailability } from "../client/checkAvailability.js";
import type { ApiServiceContext } from "../client/apiService.js";
import type { ApiQueryParams } from "../client/resolveApiQueryParams.js";

export interface AvailabilityWatcherOptions {
  projectRoot: string;
  profileId: string;
  settings: AppSettings;
  queryParams: ApiQueryParams;
  getBearerToken: () => string | null;
  onUnauthorized: () => Promise<string | null>;
  /** Cloudflare bypass — açık portal sekmesinden fetch */
  page?: Page;
  /** Her poll öncesi appointmentForm sekmesini yeniden seç */
  resolvePage?: () => Promise<Page | undefined>;
  /** Her poll'da güncel date/maxDate (bugün) */
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

/**
 * checkAvailability() — varsayılan 2 dk aralıkla (API_POLL_INTERVAL_MS, ~30 istek/saat).
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

  const telegram = new TelegramNotifier(telegramSettings);
  let running = false;
  let stopped = false;
  let lastOpenNotifyAt = 0;
  let previousClosedDates: string[] | null = null;
  let previousActiveDates: string[] | null = null;
  let lastTelegramReportAt = 0;
  let rateLimitUntil = 0;
  let lastRateLimitLogAt = 0;
  const pollMs = apiSettings.pollIntervalMs;
  const rateLimitBackoffMs = Math.max(pollMs * 6, 30_000);
  const telegramReportMs = Math.min(apiSettings.telegramReportIntervalMs, pollMs);

  logger.info(
    `[api-watcher] checkAvailability her ${pollMs}ms — profil: ${options.profileId}`,
  );
  if (apiSettings.telegramReportEnabled) {
    logger.info(
      telegram.isConfigured()
        ? `[api-watcher] Telegram özeti her ${Math.round(telegramReportMs / 1000)}s (poll ile hizalı).`
        : "[api-watcher] Telegram özeti açık ama TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID eksik.",
    );
  }

  const processPollResult = async (
    result: ClosedDatePollResult,
  ): Promise<"done" | "retry-auth"> => {
    if (result.unauthorized) {
      logger.warn("[api-watcher] Yetkisiz yanıt — token geçersiz.");
      return "retry-auth";
    }

    if (!result.ok) {
      if (result.rateLimited) {
        rateLimitUntil = Date.now() + rateLimitBackoffMs;
        const now = Date.now();
        if (now - lastRateLimitLogAt >= rateLimitBackoffMs) {
          lastRateLimitLogAt = now;
          logger.warn(
            `[api-watcher] HTTP 429 — ${Math.round(rateLimitBackoffMs / 1000)}s bekleniyor`,
          );
        }
      } else {
        logger.warn(`[api-watcher] Poll hatası: ${result.summary}`);
      }
      return "done";
    }

    logger.info(`[api-watcher] ${result.summary}`);

    const activeDates = result.activeDates ?? result.openDates ?? [];
    const currentClosed = result.closedDates ?? [];
    const queryParams = options.resolveQueryParams?.() ?? options.queryParams;
    const bookableStart = result.bookableStart ?? queryParams.date;
    const closedInRangeCount = result.closedInRange?.length ?? 0;
    const bookableRangeLen = listDatesInRange(
      bookableStart,
      queryParams.maxDate,
    ).length;
    const suspiciousAllClosed =
      activeDates.length === 0 &&
      closedInRangeCount >= bookableRangeLen &&
      bookableRangeLen > 0;

    if (suspiciousAllClosed) {
      logger.warn(
        `[api-watcher] Tüm randevu aralığı kapalı (${closedInRangeCount}/${bookableRangeLen}) — appointmentForm JWT yenileniyor.`,
      );
      await options.onUnauthorized();
      return "retry-auth";
    }

    if (activeDates.length > 0) {
      logger.info(
        `[api-watcher] Aktif günler (${activeDates.length}, ${bookableStart} → ${queryParams.maxDate}): ${activeDates.join(", ")}`,
      );
    } else {
      logger.info(
        `[api-watcher] Aktif gün yok — ${bookableStart} → ${queryParams.maxDate} aralığında seçilebilir gün kalmadı.`,
      );
    }

    if (currentClosed.length > 0) {
      logger.info(
        `[api-watcher] Kapalı günler (API, ${currentClosed.length}): ${currentClosed.join(", ")}`,
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
        const textSummary = buildApiAvailabilityTextSummary({
          profileId: options.profileId,
          cityLabel: queryParams.cityLabel,
          appointmentStyleLabel: queryParams.appointmentStyleLabel,
          bookableStart,
          maxDate: queryParams.maxDate,
          activeDates,
          closedDates: currentClosed,
        });

        await telegram.notifyApiAvailability({
          profileId: options.profileId,
          city: queryParams.cityLabel,
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

    return "done";
  };

  const runPoll = async (): Promise<void> => {
    if (running || stopped) {
      return;
    }
    running = true;

    try {
      if (Date.now() < rateLimitUntil) {
        return;
      }

      let bearer = options.getBearerToken();
      if (!bearer) {
        bearer = await options.onUnauthorized();
      }
      if (!bearer) {
        logger.warn("[api-watcher] Token yok — poll atlandı.");
        return;
      }

      const queryParams = options.resolveQueryParams?.() ?? options.queryParams;
      const page = options.resolvePage ? await options.resolvePage() : options.page;

      let result = await checkAvailability(
        buildApiContext(options, apiSettings),
        queryParams,
        page,
      );

      for (let attempt = 0; attempt < 2; attempt++) {
        if (result.unauthorized) {
          logger.warn("[api-watcher] 401 — token yenileniyor...");
          await options.onUnauthorized();
        }

        const outcome = await processPollResult(result);
        if (outcome === "retry-auth") {
          const retryPage = options.resolvePage ? await options.resolvePage() : page;
          result = await checkAvailability(
            buildApiContext(options, apiSettings),
            queryParams,
            retryPage,
          );
          continue;
        }
        break;
      }
    } catch (error) {
      logger.warn(
        `[api-watcher] ${error instanceof Error ? error.message : String(error)}`,
      );
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

/** Geriye dönük alias */
export { startAvailabilityWatcher as startClosedDateWatcher };
