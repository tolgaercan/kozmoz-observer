import type { Page } from "playwright";

import type { ApiServiceContext } from "./apiService.js";
import {
  apiFetch,
  apiFetchViaPage,
  buildApiHeaders,
  closedDateUrl,
  resolveAuthorizationForContext,
  resolvePortalReferer,
} from "./apiService.js";
import { computeCalendarDatesFromAllowed } from "./availabilityDates.js";
import { parseResponse } from "./closedDateParser.js";
import type { ApiQueryParams } from "./resolveApiQueryParams.js";
import type { ClosedDatePollResult } from "../types.js";
import { rawJwtFromBearer, resolveBearerToken } from "../auth/tokenProvider.js";

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

function buildPollResult(
  ctx: ApiServiceContext,
  status: number,
  raw: unknown,
  queryParams: ApiQueryParams,
): ClosedDatePollResult {
  const bearer = resolveBearerToken(ctx.projectRoot, ctx.profileId) ?? "";
  const parsed = parseResponse(raw, bearer ? rawJwtFromBearer(bearer) : undefined);
  const calendar = computeCalendarDatesFromAllowed(
    queryParams.date,
    queryParams.maxDate,
    parsed.allowedDates,
  );

  return {
    ok: true,
    status,
    hasOpenSlots: calendar.allowedInRange.length > 0,
    summary:
      `${calendar.allowedInRange.length} seçilebilir gün (API, hafta içi), ` +
      `${calendar.closedInRange.length} kapalı (hesaplanan), ` +
      `aralık ${calendar.bookableStart} → ${calendar.bookableEnd}`,
    raw: parsed.raw,
    allowedDates: parsed.allowedDates,
    closedDates: calendar.closedInRange,
    activeDates: calendar.allowedInRange,
    openDates: calendar.allowedInRange,
    bookableStart: calendar.bookableStart,
    bookableEnd: calendar.bookableEnd,
    closedInRange: calendar.closedInRange,
  };
}

export async function checkAvailability(
  ctx: ApiServiceContext,
  queryParams: ApiQueryParams,
  page?: Page,
): Promise<ClosedDatePollResult> {
  const url = closedDateUrl(ctx, queryParams);

  try {
    const authorization = resolveAuthorizationForContext(ctx);

    if (page && !page.isClosed()) {
      const referer = resolvePortalReferer(page.url(), ctx.settings.referer);
      const headers = buildApiHeaders(ctx, authorization, {}, referer);
      const browserResult = await apiFetchViaPage(page, url, headers, { queryParams });
      const status = browserResult.status;

      if (status === 401 || status === 403) {
        return {
          ok: false,
          status,
          hasOpenSlots: false,
          summary: `Yetkisiz (${status}) — token yenilenmeli`,
          unauthorized: true,
        };
      }

      if (status === 429) {
        return {
          ok: false,
          status,
          hasOpenSlots: false,
          summary: `HTTP 429 — rate limit (poll aralığını artırın)`,
          rateLimited: true,
          raw: browserResult.bodyText,
        };
      }

      const raw = parseBody(browserResult.contentType, browserResult.bodyText);

      if (status < 200 || status >= 300) {
        return {
          ok: false,
          status,
          hasOpenSlots: false,
          summary: `HTTP ${status}`,
          raw,
        };
      }

      return buildPollResult(ctx, status, raw, queryParams);
    }

    const response = await apiFetch(ctx, url, { queryParams });
    const status = response.status;

    if (status === 401 || status === 403) {
      return {
        ok: false,
        status,
        hasOpenSlots: false,
        summary: `Yetkisiz (${status}) — token yenilenmeli`,
        unauthorized: true,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    let raw: unknown;
    if (contentType.includes("json")) {
      raw = await response.json();
    } else {
      raw = await response.text();
    }

    if (status === 429) {
      return {
        ok: false,
        status,
        hasOpenSlots: false,
        summary: `HTTP 429 — rate limit (poll aralığını artırın)`,
        rateLimited: true,
        raw,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status,
        hasOpenSlots: false,
        summary: `HTTP ${status}`,
        raw,
      };
    }

    return buildPollResult(ctx, status, raw, queryParams);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      hasOpenSlots: false,
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}
