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

/**
 * GetAppointmentHourQoutaInfo — tek gün için saat kotası.
 * Varsayılan kapalı: API_HOUR_QUOTA_ENABLED=false iken istek atılmaz.
 */
export async function checkHourQuota(
  ctx: ApiServiceContext,
  queryParams: ApiQueryParams,
  appointmentDate: string,
  page?: Page,
): Promise<HourQuotaPollResult> {
  if (!ctx.settings.hourQuotaEnabled) {
    return buildSkippedResult("Saat kotası kapalı — API_HOUR_QUOTA_ENABLED=false");
  }

  const normalizedDate = appointmentDate.trim();
  if (!normalizedDate) {
    return buildSkippedResult("appointmentDate boş — saat kotası sorgulanamaz");
  }

  const hourParams: ApiQueryParams = {
    ...queryParams,
    appointmentDate: normalizedDate,
  };
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
