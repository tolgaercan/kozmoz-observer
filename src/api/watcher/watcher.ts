import type { Page } from "playwright";

import { ApiHealthStore } from "../../control-panel/apiHealthStore.js";
import type { ApiWatcherSettings, AppSettings, TelegramSettings } from "../../config/settings.js";
import {
  buildApiClosedDateStatusSummary,
  buildApiNewlyOpenedDaysSummary,
  type ApiAvailabilitySummaryInput,
} from "../notifications/apiAvailabilityTelegram.js";
import { TelegramNotifier } from "../../notifications/telegramNotifier.js";
import { logger } from "../../utils/logger.js";
import type { ApiWatcherHandle, ClosedDatePollResult } from "../types.js";
import { formatIsoDateLocal } from "../client/availabilityDates.js";
import { checkAvailability } from "../client/checkAvailability.js";
import type { ApiServiceContext } from "../client/apiService.js";
import type { ApiQueryParams } from "../client/resolveApiQueryParams.js";
import { formatDurationTr, resolveRateLimitBackoffMs } from "../client/rateLimitPolicy.js";
import { resolveClosedDateRangeDays } from "../client/availabilityDates.js";
import { detectPublicIp } from "../../control-panel/chromeLauncher.js";
import { WorkerRuntimeStore } from "../../control-panel/workerRuntimeStore.js";

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

function datesEqual(left: string[], right: string[]): boolean {
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
  let previousAllowedDates: string[] | null = null;
  let lastTelegramReportAt = 0;
  let rateLimitUntil = 0;
  let lastRateLimitLogAt = 0;
  let rateLimitTelegramSentAt = 0;
  let requestsLastHour = 0;
  let hourWindowStart = Date.now();
  let firstPollReportSent = false;
  const runtimeStore = new WorkerRuntimeStore(options.projectRoot);
  const runtimeDefaults = {
    pollIntervalMs: apiSettings.pollIntervalMs,
    telegramReportIntervalMs: apiSettings.telegramReportIntervalMs,
  };
  let currentPollMs = runtimeDefaults.pollIntervalMs;
  let currentTelegramReportMs = runtimeDefaults.telegramReportIntervalMs;
  let telegramEveryPoll = currentTelegramReportMs <= currentPollMs + 2_000;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let watcherPublicIp = options.lockedIp || "unknown";
  void detectPublicIp(options.projectRoot).then((ip) => {
    if (ip !== "unknown") {
      watcherPublicIp = ip;
    }
  });

  const applyRuntimeConfig = (): void => {
    const runtime = runtimeStore.get(options.profileId, runtimeDefaults);
    const prevPoll = currentPollMs;
    const prevTelegram = currentTelegramReportMs;
    currentPollMs = runtime.pollIntervalMs;
    currentTelegramReportMs = runtime.telegramReportIntervalMs;
    telegramEveryPoll = currentTelegramReportMs <= currentPollMs + 2_000;

    if (prevPoll !== currentPollMs || prevTelegram !== currentTelegramReportMs) {
      logger.info(
        `[api-watcher] Canlı ayar — poll: ${Math.round(currentPollMs / 1000)} sn, ` +
          `Telegram: ${Math.round(currentTelegramReportMs / 1000)} sn`,
      );
    }
  };

  applyRuntimeConfig();

  const previousHealth = healthStore.get(options.profileId);
  const initialTypeId = options.queryParams.appointmentTypeId;
  const initialStyle = options.queryParams.appointmentStyleLabel ?? initialTypeId;
  if (
    previousHealth?.appointmentTypeId &&
    previousHealth.appointmentTypeId !== initialTypeId
  ) {
    logger.info(
      `[api-watcher] Başvuru şekli değişti: typeId ${previousHealth.appointmentTypeId} (${previousHealth.appointmentStyle ?? "?"}) → ${initialTypeId} (${initialStyle}) — yeni baseline`,
    );
  }

  const recordHealth = (patch: Parameters<ApiHealthStore["update"]>[1]): void => {
    healthStore.update(options.profileId, {
      profileName: options.profileName,
      publicIp: watcherPublicIp,
      lockedIp: options.lockedIp,
      cdpPort: options.cdpPort,
      pollIntervalMs: currentPollMs,
      requestsLastHour,
      dealerOffice: options.queryParams.dealerOfficeLabel,
      appointmentStyle: options.queryParams.appointmentStyleLabel,
      appointmentTypeId: options.queryParams.appointmentTypeId,
      ...patch,
    });
  };

  logger.info(
    `[api-watcher] checkAvailability her ${currentPollMs}ms — profil: ${options.profileId} (ilk sorgu hemen)`,
  );

  const sendFirstPollTelegram = async (
    ok: boolean,
    summary: string,
    pollContext?: {
      activeCount?: number;
      summaryInput?: ApiAvailabilitySummaryInput;
    },
  ): Promise<void> => {
    if (firstPollReportSent || !telegram.isConfigured()) {
      return;
    }
    if (!ok) {
      return;
    }
    firstPollReportSent = true;
    const detailSummary =
      ok && pollContext?.summaryInput
        ? buildApiClosedDateStatusSummary({
            ...pollContext.summaryInput,
            hasAllowedListChange: false,
          })
        : undefined;

    await telegram.notifyApiWatcherPollResult({
      profileId: options.profileId,
      ok,
      summary,
      activeCount: ok ? pollContext?.activeCount : undefined,
      detailSummary,
      isFirstPoll: true,
    });
  };

  const processPollResult = async (result: ClosedDatePollResult): Promise<void> => {
    const baseParams = options.resolveQueryParams?.() ?? options.queryParams;
    const queryParams: ApiQueryParams = {
      ...baseParams,
      date: result.queryDate ?? baseParams.date,
      maxDate: result.queryMaxDate ?? baseParams.maxDate,
    };
    const nowIso = new Date().toISOString();

    if (result.rateLimited) {
      const bodyText = rawBodyText(result.raw);
      const backoffMs = resolveRateLimitBackoffMs({
        pollIntervalMs: currentPollMs,
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
      await sendFirstPollTelegram(false, summary);
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
      await sendFirstPollTelegram(false, result.summary);
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
      await sendFirstPollTelegram(false, result.summary);
      return;
    }

    logger.info(`[api-watcher] ${result.summary}`);

    const currentAllowed = result.activeDates ?? result.openDates ?? [];
    const currentClosed = result.closedDates ?? [];
    const bookableStart = result.bookableStart ?? queryParams.date;
    const bookableEnd = result.bookableEnd ?? queryParams.maxDate;

    recordHealth({
      status: "ok",
      lastPollAt: nowIso,
      lastOkAt: nowIso,
      lastHttpStatus: result.status,
      lastSummary: result.summary,
      lastError: undefined,
      backoffUntil: undefined,
    });

    logger.info(
      `[api-watcher] Seçilebilir gün (API): ${currentAllowed.length}, kapalı (hesaplanan): ${currentClosed.length} — ${bookableStart} → ${bookableEnd}`,
    );

    const officeLabel = queryParams.dealerOfficeLabel ?? queryParams.cityLabel;
    await sendFirstPollTelegram(true, result.summary, {
      activeCount: currentAllowed.length,
      summaryInput: {
        profileId: options.profileId,
        cityLabel: officeLabel,
        appointmentStyleLabel: queryParams.appointmentStyleLabel,
        appointmentTypeId: queryParams.appointmentTypeId,
        queryDate: queryParams.date,
        queryMaxDate: queryParams.maxDate,
        rangeDays: resolveClosedDateRangeDays(queryParams.date, queryParams.maxDate),
        todayIso: formatIsoDateLocal(new Date()),
        bookableStart,
        bookableEnd,
        maxDate: queryParams.maxDate,
        allowedDates: currentAllowed,
        closedDates: currentClosed,
      },
    });

    const isEstablishingBaseline = previousAllowedDates === null;
    const addedAllowed = isEstablishingBaseline
      ? []
      : currentAllowed.filter((date) => !previousAllowedDates!.includes(date));
    const hasNewlyOpenedDays = addedAllowed.length > 0;
    const sameAllowedAsPrevious =
      previousAllowedDates !== null && datesEqual(currentAllowed, previousAllowedDates);
    const now = Date.now();
    const periodicTelegramDue = telegramEveryPoll
      ? true
      : now - lastTelegramReportAt >= currentTelegramReportMs - 3_000;

    previousAllowedDates = [...currentAllowed];

    if (isEstablishingBaseline) {
      lastTelegramReportAt = now;
      logger.info(
        `[api-watcher] Baseline kaydedildi — ${currentAllowed.length} seçilebilir gün (hafta içi). ` +
          "YENİ uyarısı yok; sonraki poll'larda değişiklik aranır.",
      );
      return;
    }

    if (apiSettings.telegramReportEnabled && telegram.isConfigured()) {
      const shouldSendTelegram =
        hasNewlyOpenedDays ||
        !sameAllowedAsPrevious ||
        periodicTelegramDue;

      if (shouldSendTelegram) {
        const officeLabel = queryParams.dealerOfficeLabel ?? queryParams.cityLabel;
        const summaryInput = {
          profileId: options.profileId,
          cityLabel: officeLabel,
          appointmentStyleLabel: queryParams.appointmentStyleLabel,
          appointmentTypeId: queryParams.appointmentTypeId,
          queryDate: queryParams.date,
          queryMaxDate: queryParams.maxDate,
          rangeDays: resolveClosedDateRangeDays(queryParams.date, queryParams.maxDate),
          todayIso: formatIsoDateLocal(new Date()),
          bookableStart,
          bookableEnd,
          maxDate: queryParams.maxDate,
          allowedDates: currentAllowed,
          closedDates: currentClosed,
          newlyOpenedDates: addedAllowed,
          hasAllowedListChange: !sameAllowedAsPrevious && previousAllowedDates !== null,
        };
        const textSummary = hasNewlyOpenedDays
          ? buildApiNewlyOpenedDaysSummary(summaryInput)
          : buildApiClosedDateStatusSummary({
              ...summaryInput,
              hasAllowedListChange:
                previousAllowedDates !== null ? !sameAllowedAsPrevious : undefined,
            });

        await telegram.notifyApiAvailability({
          profileId: options.profileId,
          city: officeLabel,
          appointmentStyle: queryParams.appointmentStyleLabel,
          textSummary,
          activeDates: addedAllowed.length > 0 ? addedAllowed : currentAllowed,
          isEmpty: currentAllowed.length === 0,
          hasNewDays: hasNewlyOpenedDays,
          periodicReport: !hasNewlyOpenedDays,
        });
        lastTelegramReportAt = now;
      }
    }

    if (addedAllowed.length > 0) {
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
      applyRuntimeConfig();

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
        await sendFirstPollTelegram(false, "Token yok — JWT / portal oturumu gerekli");
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
      await sendFirstPollTelegram(false, message);
    } finally {
      running = false;
    }
  };

  const scheduleNextPoll = (): void => {
    if (stopped) {
      return;
    }
    pollTimer = setTimeout(() => {
      void runPoll().finally(() => {
        if (!stopped) {
          scheduleNextPoll();
        }
      });
    }, currentPollMs);
  };

  void runPoll().finally(() => {
    if (!stopped) {
      scheduleNextPoll();
    }
  });

  return {
    stop: () => {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      logger.info("[api-watcher] Durduruldu.");
    },
  };
}

export { startAvailabilityWatcher as startClosedDateWatcher };
