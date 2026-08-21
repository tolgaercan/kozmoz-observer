import type { Page } from "playwright";

import type { HourQuotaPollResult } from "../types.js";
import type { ApiServiceContext } from "./apiService.js";
import {
  apiFetch,
  apiFetchViaPage,
  buildApiHeaders,
  hourQuotaUrl,
  resolveAuthorizationForContext,
} from "./apiService.js";
import { parseHourQuotaResponse } from "./hourQuotaParser.js";
import type { ApiQueryParams } from "./resolveApiQueryParams.js";

function parseBody(contentType: string, bodyText: string): unknown {
  if (contentType.includes("json")) {
    try {
      return JSON.parse(bodyText);
    } catch {
      return bodyText;
    }
  }
  return bodyText;
}

function buildSkippedResult(reason: string): HourQuotaPollResult {
  return {
    ok: false,
    status: 0,
    skipped: true,
    hasAvailableHours: false,
    summary: reason,
  };
}

function buildPollResult(
  status: number,
  raw: unknown,
  appointmentDate: string,
): HourQuotaPollResult {
  const parsed = parseHourQuotaResponse(raw, appointmentDate);

  return {
    ok: true,
    status,
    hasAvailableHours: parsed.hasAvailableHours,
    summary: parsed.summary,
    appointmentDate: parsed.appointmentDate,
    availableHours: parsed.availableHours,
    slots: parsed.slots,
    raw: parsed.raw,
  };
}

function failureResult(
  status: number,
  summary: string,
  extra: Partial<HourQuotaPollResult> = {},
): HourQuotaPollResult {
  return {
    ok: false,
    status,
    hasAvailableHours: false,
    summary,
    ...extra,
  };
}

export interface CheckHourQuotaOptions {
  /** Panel / profil TC — portal `nationalityNumber` */
  nationalityNumber?: string;
  /**
   * Portal takvim reCAPTCHA token — query `recaptchaToken`.
   * Yoksa (enabled iken) istek atılmaz; captcha bypass yok.
   */
  recaptchaToken?: string;
  /** Varsayılan true — portal `onlyAvailable=true` */
  onlyAvailable?: boolean;
}

/**
 * Canlı portal ile aynı query setini üretir (istek atmaz).
 * date = seçilen gün; applicationType = applicationTypeId.
 */
export function buildHourQuotaQueryParams(
  queryParams: ApiQueryParams,
  appointmentDate: string,
  options: CheckHourQuotaOptions = {},
): ApiQueryParams {
  const normalizedDate = appointmentDate.trim();
  const nationalityNumber =
    options.nationalityNumber?.trim() || queryParams.nationalityNumber?.trim() || "";
  const recaptchaToken =
    options.recaptchaToken?.trim() || queryParams.recaptchaToken?.trim() || "";
  const onlyAvailable = options.onlyAvailable === false ? "false" : "true";

  return {
    ...queryParams,
    /** Portal hour URL {date} = seçilen gün (GetClosedDate aralık start değil) */
    date: normalizedDate,
    appointmentDate: normalizedDate,
    nationalityNumber,
    applicationType: queryParams.applicationType ?? queryParams.applicationTypeId,
    onlyAvailable,
    recaptchaToken,
  };
}

/**
 * URL şablonunu portal parametreleriyle doldurur (istek atmaz) — debug / hazırlık.
 */
export function resolveHourQuotaUrl(
  ctx: ApiServiceContext,
  queryParams: ApiQueryParams,
  appointmentDate: string,
  options: CheckHourQuotaOptions = {},
): string {
  return hourQuotaUrl(ctx, buildHourQuotaQueryParams(queryParams, appointmentDate, options));
}

/**
 * GetAppointmentHourQoutaInfo (AppointmentLayouts) — tek gün saat kotası.
 * Varsayılan kapalı: API_HOUR_QUOTA_ENABLED=false iken istek atılmaz.
 * Açıkken nationalityNumber + recaptchaToken zorunlu (token üretimi/bypass yok).
 */
export async function checkHourQuota(
  ctx: ApiServiceContext,
  queryParams: ApiQueryParams,
  appointmentDate: string,
  page?: Page,
  options: CheckHourQuotaOptions = {},
): Promise<HourQuotaPollResult> {
  if (!ctx.settings.hourQuotaEnabled) {
    return buildSkippedResult("Saat kotası kapalı — API_HOUR_QUOTA_ENABLED=false");
  }

  const normalizedDate = appointmentDate.trim();
  if (!normalizedDate) {
    return buildSkippedResult("appointmentDate boş — saat kotası sorgulanamaz");
  }

  const hourParams = buildHourQuotaQueryParams(queryParams, normalizedDate, options);

  if (!hourParams.nationalityNumber) {
    return buildSkippedResult("nationalityNumber yok — hour kota sorgulanamaz");
  }

  if (!hourParams.recaptchaToken) {
    return buildSkippedResult(
      "recaptchaToken yok — hour kota için portal captcha token gerekli (istek atılmadı)",
    );
  }

  const url = hourQuotaUrl(ctx, hourParams);

  try {
    const authorization = resolveAuthorizationForContext(ctx);

    if (page && !page.isClosed()) {
      const headers = buildApiHeaders(ctx, authorization);
      const browserResult = await apiFetchViaPage(page, url, headers, {
        queryParams: hourParams,
      });
      const status = browserResult.status;

      if (status === 401 || status === 403) {
        return failureResult(status, `Yetkisiz (${status}) — token yenilenmeli`, {
          unauthorized: true,
        });
      }

      if (status === 429) {
        return failureResult(status, "HTTP 429 — rate limit", { rateLimited: true });
      }

      const raw = parseBody(browserResult.contentType, browserResult.bodyText);

      if (status < 200 || status >= 300) {
        return failureResult(status, `HTTP ${status}`, { raw });
      }

      return buildPollResult(status, raw, normalizedDate);
    }

    const response = await apiFetch(ctx, url, { queryParams: hourParams });
    const status = response.status;

    if (status === 401 || status === 403) {
      return failureResult(status, `Yetkisiz (${status}) — token yenilenmeli`, {
        unauthorized: true,
      });
    }

    const contentType = response.headers.get("content-type") ?? "";
    let raw: unknown;
    if (contentType.includes("json")) {
      raw = await response.json();
    } else {
      raw = await response.text();
    }

    if (status === 429) {
      return failureResult(status, "HTTP 429 — rate limit", { rateLimited: true, raw });
    }

    if (!response.ok) {
      return failureResult(status, `HTTP ${status}`, { raw });
    }

    return buildPollResult(status, raw, normalizedDate);
  } catch (error) {
    return failureResult(
      0,
      error instanceof Error ? error.message : String(error),
    );
  }
}
