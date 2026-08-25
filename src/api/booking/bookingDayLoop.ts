import type { Page } from "playwright";

import { logger } from "../../utils/logger.js";
import type { ApiServiceContext } from "../client/apiService.js";
import { checkHourQuota } from "../client/checkHourQuota.js";
import type { ApiQueryParams } from "../client/resolveApiQueryParams.js";
import type { HourQuotaSlotResult } from "../types.js";
import type { CaptchaTokenKeeper } from "./captchaTokenKeeper.js";
import type { BookingRuntimeConfig } from "./bookingConfig.js";
import { selectVerifiedSlotInCalendar } from "./step3CalendarSelect.js";
import type { VerifiedSlot } from "./bookingTypes.js";
import type { AppointmentSettings } from "../../config/settings.js";
import { ensureCalendarView } from "./wizardBookingNav.js";

export interface BookingDayLoopResult {
  ok: boolean;
  verifiedSlot?: VerifiedSlot;
  selectedHourLabel?: string;
  requestsUsed: number;
  probedDays: string[];
  apiEmptyDays: string[];
  uiFailedDays: string[];
  captchaFailed: boolean;
  rateLimited: boolean;
  reason?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickBestSlot(date: string, slots: HourQuotaSlotResult[]): VerifiedSlot | undefined {
  const available = slots.filter((slot) => slot.availableAppointmentCount > 0);
  if (available.length === 0) {
    return undefined;
  }
  const slot = available[0]!;
  return {
    date,
    hourLabel: slot.hourLabel,
    slot,
  };
}

export async function probeDayForAvailableSlot(
  ctx: ApiServiceContext,
  queryParams: ApiQueryParams,
  page: Page | undefined,
  date: string,
  nationalityNumber: string,
  recaptchaToken: string,
): Promise<{
  verifiedSlot?: VerifiedSlot;
  rateLimited: boolean;
  status?: number;
  apiOk: boolean;
}> {
  const result = await checkHourQuota(ctx, queryParams, date, page, {
    nationalityNumber,
    recaptchaToken,
    forceRequest: true,
  });

  if (result.rateLimited) {
    return { rateLimited: true, status: result.status, apiOk: false };
  }

  if (!result.ok && !result.skipped) {
    return { rateLimited: false, apiOk: false };
  }

  if (result.hasAvailableHours && result.slots?.length) {
    const verified = pickBestSlot(date, result.slots);
    if (verified) {
      return { verifiedSlot: verified, rateLimited: false, apiOk: true };
    }
  }

  return { rateLimited: false, apiOk: true };
}

/**
 * Aday günler üzerinde API probe + UI seçim — captcha keeper ile fresh token.
 * UI timeout → sonraki güne geç (L1 fallback).
 */
export async function runBookingDayLoop(
  page: Page,
  ctx: ApiServiceContext,
  queryParams: ApiQueryParams,
  appointmentSettings: AppointmentSettings,
  config: BookingRuntimeConfig,
  candidateDays: string[],
  nationalityNumber: string,
  tokenKeeper: CaptchaTokenKeeper,
  wizardNavLocator: string,
): Promise<BookingDayLoopResult> {
  const probedDays: string[] = [];
  const apiEmptyDays: string[] = [];
  const uiFailedDays: string[] = [];
  let requestsUsed = 0;

  if (candidateDays.length === 0) {
    return {
      ok: false,
      requestsUsed: 0,
      probedDays,
      apiEmptyDays,
      uiFailedDays,
      captchaFailed: false,
      rateLimited: false,
      reason: "Aday gün yok",
    };
  }

  if (!nationalityNumber.trim()) {
    return {
      ok: false,
      requestsUsed: 0,
      probedDays,
      apiEmptyDays,
      uiFailedDays,
      captchaFailed: false,
      rateLimited: false,
      reason: "nationalityNumber yok",
    };
  }

  const initialToken = await tokenKeeper.awaitFresh(config.captchaPatienceMs);
  if (!initialToken) {
    return {
      ok: false,
      requestsUsed: 0,
      probedDays,
      apiEmptyDays,
      uiFailedDays,
      captchaFailed: true,
      rateLimited: false,
      reason: "reCAPTCHA fresh token alınamadı",
    };
  }

  for (const date of candidateDays) {
    if (requestsUsed >= config.hourProbeMaxRequests) {
      logger.info("[booking] Hour probe budget doldu — gün döngüsü durdu.");
      break;
    }

    const token = await tokenKeeper.awaitFresh(config.captchaPatienceMs);
    if (!token) {
      return {
        ok: false,
        requestsUsed,
        probedDays,
        apiEmptyDays,
        uiFailedDays,
        captchaFailed: true,
        rateLimited: false,
        reason: "reCAPTCHA token campaign ortasında yenilenemedi",
      };
    }

    logger.info(`[booking] Gün denemesi: ${date} (${requestsUsed + 1}/${config.hourProbeMaxRequests})`);
    requestsUsed += 1;
    probedDays.push(date);

    const probe = await probeDayForAvailableSlot(
      ctx,
      queryParams,
      page,
      date,
      nationalityNumber,
      token,
    );

    if (probe.rateLimited) {
      return {
        ok: false,
        requestsUsed,
        probedDays,
        apiEmptyDays,
        uiFailedDays,
        captchaFailed: false,
        rateLimited: true,
        reason: `Rate limit (HTTP ${probe.status ?? "?"})`,
      };
    }

    if (!probe.verifiedSlot) {
      apiEmptyDays.push(date);
      if (requestsUsed < config.hourProbeMaxRequests) {
        await sleep(config.hourProbeDelayMs);
      }
      continue;
    }

    logger.info(
      `[booking] API saat: ${probe.verifiedSlot.date} ${probe.verifiedSlot.hourLabel} — UI denenecek`,
    );

    await ensureCalendarView(page, wizardNavLocator);

    const uiResult = await selectVerifiedSlotInCalendar(
      page,
      probe.verifiedSlot,
      appointmentSettings,
      { hourPanelTimeoutMs: config.uiDayAttemptMs },
    );

    if (uiResult.ok) {
      return {
        ok: true,
        verifiedSlot: probe.verifiedSlot,
        selectedHourLabel: uiResult.selectedHourLabel,
        requestsUsed,
        probedDays,
        apiEmptyDays,
        uiFailedDays,
        captchaFailed: false,
        rateLimited: false,
      };
    }

    logger.warn(
      `[booking] UI seçim başarısız (${date}): ${uiResult.reason ?? "—"} — sonraki aday gün`,
    );
    uiFailedDays.push(date);
    await ensureCalendarView(page, wizardNavLocator);

    if (requestsUsed < config.hourProbeMaxRequests) {
      await sleep(config.hourProbeDelayMs);
    }
  }

  return {
    ok: false,
    requestsUsed,
    probedDays,
    apiEmptyDays,
    uiFailedDays,
    captchaFailed: false,
    rateLimited: false,
    reason:
      uiFailedDays.length > 0
        ? "API saat var ama UI seçilemedi — tüm aday günler denendi"
        : "Müsait saat bulunamadı",
  };
}
