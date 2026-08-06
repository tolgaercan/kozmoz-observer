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
import {
  computeCalendarDatesFromAllowed,
  formatIsoDateLocal,
} from "./availabilityDates.js";
import { parseResponse } from "./closedDateParser.js";
import type { ApiQueryParams } from "./resolveApiQueryParams.js";
import type { ClosedDatePollResult } from "../types.js";
import { rawJwtFromBearer, resolveBearerToken } from "../auth/tokenProvider.js";
import { isBasvuruPortalUrl, isKosmosMarketingHome } from "../../portal/kosmosOrigin.js";
import { logger } from "../../utils/logger.js";

function pageIsOnPortal(page: Page): boolean {
  const url = page.url().trim();
  if (!url || url === "about:blank") {
    return false;
  }
  return isBasvuruPortalUrl(url) || isKosmosMarketingHome(url);
}

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

  const todayIso = formatIsoDateLocal(new Date());
  const excludesTodayNote =
    calendar.bookableStart > queryParams.date ? `, bugün ${todayIso} hariç` : "";

  return {
    ok: true,
    status,
    hasOpenSlots: calendar.allowedInRange.length > 0,
    summary:
      `${calendar.allowedInRange.length} seçilebilir gün (API, hafta içi), ` +
      `${calendar.closedInRange.length} kapalı (hesaplanan), ` +
      `aralık ${calendar.bookableStart} → ${calendar.bookableEnd}${excludesTodayNote}`,
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

function mapHttpFailure(
  status: number,
  raw: unknown,
  bodyText?: string,
): ClosedDatePollResult {
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
      raw: bodyText ?? raw,
    };
  }

  if (status < 200 || status >= 300) {
    return {
      ok: false,
      status,
      hasOpenSlots: false,
      summary: `HTTP ${status}`,
      raw,
    };
  }

  throw new Error(`mapHttpFailure beklenmeyen başarılı status: ${status}`);
}

async function fetchClosedDateViaNode(
  ctx: ApiServiceContext,
  url: string,
  queryParams: ApiQueryParams,
): Promise<ClosedDatePollResult> {
  const response = await apiFetch(ctx, url, { queryParams });
  const status = response.status;
  const contentType = response.headers.get("content-type") ?? "";
  let raw: unknown;
  if (contentType.includes("json")) {
    raw = await response.json();
  } else {
    raw = await response.text();
  }

  if (status < 200 || status >= 300) {
    return mapHttpFailure(status, raw, typeof raw === "string" ? raw : undefined);
  }

  return buildPollResult(ctx, status, raw, queryParams);
}

async function fetchClosedDateViaPage(
  ctx: ApiServiceContext,
  url: string,
  queryParams: ApiQueryParams,
  page: Page,
): Promise<ClosedDatePollResult> {
  const referer = resolvePortalReferer(page.url(), ctx.settings.referer);
  const authorization = resolveAuthorizationForContext(ctx);
  const headers = buildApiHeaders(ctx, authorization, {}, referer);
  const browserResult = await apiFetchViaPage(page, url, headers, { queryParams });

  if (browserResult.networkError) {
    throw new Error(browserResult.networkError);
  }

  const raw = parseBody(browserResult.contentType, browserResult.bodyText);
  if (browserResult.status < 200 || browserResult.status >= 300) {
    return mapHttpFailure(browserResult.status, raw, browserResult.bodyText);
  }

  return buildPollResult(ctx, browserResult.status, raw, queryParams);
}

export async function checkAvailability(
  ctx: ApiServiceContext,
  queryParams: ApiQueryParams,
  page?: Page,
): Promise<ClosedDatePollResult> {
  const url = closedDateUrl(ctx, queryParams);
  logger.debug(
    `[checkAvailability] typeId=${queryParams.appointmentTypeId} (${queryParams.appointmentStyleLabel ?? "?"}) → ${url}`,
  );

  try {
    const forceNode = process.env.API_POLL_VIA_NODE === "true";
    const useBrowser = !forceNode && page && !page.isClosed() && pageIsOnPortal(page);

    if (useBrowser && page && !page.isClosed()) {
      try {
        return await fetchClosedDateViaPage(ctx, url, queryParams, page);
      } catch (browserError) {
        const message =
          browserError instanceof Error ? browserError.message : String(browserError);
        logger.warn(
          `[checkAvailability] Tarayıcı fetch başarısız — Node fetch deneniyor: ${message}`,
        );
      }
    } else if (forceNode) {
      logger.debug("[checkAvailability] API_POLL_VIA_NODE=true — Node fetch");
    }

    return await fetchClosedDateViaNode(ctx, url, queryParams);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? ` — ${error.cause.message}`
        : error instanceof Error && error.cause
          ? ` — ${String(error.cause)}`
          : "";
    logger.warn(`[checkAvailability] ${message}${cause}`);
    return {
      ok: false,
      status: 0,
      hasOpenSlots: false,
      summary: `${message}${cause}`,
    };
  }
}
