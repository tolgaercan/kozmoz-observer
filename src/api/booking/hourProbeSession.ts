import type { Page } from "playwright";

import { logger } from "../../utils/logger.js";
import type { ApiServiceContext } from "../client/apiService.js";
import { checkHourQuota } from "../client/checkHourQuota.js";
import type { ApiQueryParams } from "../client/resolveApiQueryParams.js";
import type { HourQuotaSlotResult } from "../types.js";
import type { VerifiedSlot } from "./bookingTypes.js";

export interface HourProbeSessionOptions {
  candidateDays: string[];
  recaptchaToken: string;
  nationalityNumber: string;
  maxRequests: number;
  batchSize: number;
  delayMs: number;
}

export interface HourProbeSessionResult {
  ok: boolean;
  verifiedSlot?: VerifiedSlot;
  requestsUsed: number;
  probedDays: string[];
  failedDays: string[];
  reason?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickBestSlot(
  date: string,
  slots: HourQuotaSlotResult[],
): VerifiedSlot | undefined {
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

/**
 * Batch halinde GetHourQuota — ilk gerçek saat bulununca durur.
 */
export async function runHourProbeSession(
  ctx: ApiServiceContext,
  queryParams: ApiQueryParams,
  page: Page | undefined,
  options: HourProbeSessionOptions,
): Promise<HourProbeSessionResult> {
  const {
    candidateDays,
    recaptchaToken,
    nationalityNumber,
    maxRequests,
    batchSize,
    delayMs,
  } = options;

  if (candidateDays.length === 0) {
    return { ok: false, requestsUsed: 0, probedDays: [], failedDays: [], reason: "Aday gün yok" };
  }

  if (!recaptchaToken.trim()) {
    return {
      ok: false,
      requestsUsed: 0,
      probedDays: [],
      failedDays: [],
      reason: "recaptchaToken yok",
    };
  }

  if (!nationalityNumber.trim()) {
    return {
      ok: false,
      requestsUsed: 0,
      probedDays: [],
      failedDays: [],
      reason: "nationalityNumber yok",
    };
  }

  let requestsUsed = 0;
  let remainingBudget = maxRequests;
  const probedDays: string[] = [];
  const failedDays: string[] = [];
  let dayIndex = 0;

  while (remainingBudget > 0 && dayIndex < candidateDays.length) {
    const batch = candidateDays.slice(dayIndex, dayIndex + batchSize);
    dayIndex += batch.length;

    for (const date of batch) {
      if (remainingBudget <= 0) {
        break;
      }

      logger.info(`[booking] Hour probe: ${date} (${requestsUsed + 1}/${maxRequests})`);
      const result = await checkHourQuota(ctx, queryParams, date, page, {
        nationalityNumber,
        recaptchaToken,
        forceRequest: true,
      });

      requestsUsed += 1;
      remainingBudget -= 1;
      probedDays.push(date);

      if (result.rateLimited) {
        return {
          ok: false,
          requestsUsed,
          probedDays,
          failedDays,
          reason: `Rate limit (HTTP ${result.status})`,
        };
      }

      if (!result.ok && !result.skipped) {
        failedDays.push(date);
        if (requestsUsed < maxRequests && dayIndex < candidateDays.length) {
          await sleep(delayMs);
        }
        continue;
      }

      if (result.hasAvailableHours && result.slots?.length) {
        const verified = pickBestSlot(date, result.slots);
        if (verified) {
          logger.info(
            `[booking] Saat doğrulandı: ${verified.date} ${verified.hourLabel}`,
          );
          return { ok: true, verifiedSlot: verified, requestsUsed, probedDays, failedDays };
        }
      }

      failedDays.push(date);
      if (remainingBudget > 0 && (dayIndex < candidateDays.length || batch.indexOf(date) < batch.length - 1)) {
        await sleep(delayMs);
      }
    }
  }

  return {
    ok: false,
    requestsUsed,
    probedDays,
    failedDays,
    reason: "Müsait saat bulunamadı",
  };
}
