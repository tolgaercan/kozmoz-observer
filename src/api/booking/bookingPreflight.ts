import type { ApiServiceContext } from "../client/apiService.js";
import { buildHourQuotaQueryParams } from "../client/checkHourQuota.js";
import type { ApiQueryParams } from "../client/resolveApiQueryParams.js";
import { maskNationalityNumber } from "../../portal/nationalityNumberInput.js";
import { logger } from "../../utils/logger.js";

export interface HourProbePreflightResult {
  ok: boolean;
  reason?: string;
}

/**
 * Hour probe (GetAppointmentHourQoutaInfo) öncesi zorunlu alanlar — istek atmadan doğrula.
 * recaptchaToken Step 3'te captcha keeper ile gelir; burada kontrol edilmez.
 */
export function validateHourProbePreflight(
  ctx: ApiServiceContext,
  queryParams: ApiQueryParams,
  nationalityNumber: string,
  sampleDate: string,
): HourProbePreflightResult {
  const tc = nationalityNumber.trim();
  if (!tc) {
    return { ok: false, reason: "nationalityNumber yok (panel Worker TC)" };
  }
  if (tc.length !== 11) {
    return { ok: false, reason: `nationalityNumber geçersiz uzunluk (${tc.length}, 11 bekleniyor)` };
  }

  if (!queryParams.dealerId?.trim()) {
    return { ok: false, reason: "dealerId yok" };
  }

  if (!queryParams.appointmentTypeId?.trim()) {
    return { ok: false, reason: "appointmentTypeId yok (başvuru şekli)" };
  }

  const appType = (queryParams.applicationType ?? queryParams.applicationTypeId)?.trim();
  if (!appType) {
    return { ok: false, reason: "applicationType yok (Bireysel/Aile)" };
  }

  if (!sampleDate.trim()) {
    return { ok: false, reason: "aday gün (date) yok" };
  }

  const bearer = ctx.bearerToken?.trim();
  if (!bearer) {
    return { ok: false, reason: "JWT/bearer token yok — portal oturumu gerekli" };
  }

  return { ok: true };
}

export function logHourProbePreflight(
  ctx: ApiServiceContext,
  queryParams: ApiQueryParams,
  nationalityNumber: string,
  sampleDate: string,
  candidateCount: number,
  maxRequests: number,
): void {
  const hourParams = buildHourQuotaQueryParams(queryParams, sampleDate, {
    nationalityNumber,
    onlyAvailable: true,
  });

  logger.info(
    `[booking] Hour probe hazirlik OK — dealerId=${hourParams.dealerId}, ` +
      `typeId=${hourParams.appointmentTypeId} (${queryParams.appointmentStyleLabel ?? "?"}), ` +
      `applicationType=${hourParams.applicationType}, ` +
      `TC=${maskNationalityNumber(nationalityNumber)}, ` +
      `ilkGun=${sampleDate}, aday=${candidateCount}, maxIstek=${maxRequests}, JWT=var`,
  );
  logger.debug(
    `[booking] Hour probe (token haric) — date=${hourParams.date}, onlyAvailable=${hourParams.onlyAvailable}`,
  );
}
