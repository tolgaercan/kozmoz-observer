import type { Page } from "playwright";

import { logger } from "../../utils/logger.js";
import type { ApiQueryParams } from "./resolveApiQueryParams.js";
import { fetchMaxAppointmentDate } from "./maxAppointmentDate.js";
import {
  DEFAULT_MAX_DATE_CACHE_TTL_MS,
  getFreshMaxAppointmentDateFromCache,
  loadMaxAppointmentDateCache,
  logMaxDateCacheHit,
  saveMaxAppointmentDateCache,
  type MaxAppointmentDateCacheRecord,
} from "./maxAppointmentDateCache.js";
import type { ApiServiceContext } from "./apiService.js";

function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

export function readMaxDateEnvOverride(): string | undefined {
  return readEnv("API_CLOSED_DATE_MAX");
}

/** Senkron param ozeti — env veya disk cache (poll oncesi ensureMaxAppointmentDate tercih edilir). */
export function resolveMaxDateForParams(
  projectRoot: string,
  maxDateOverride?: string,
): string {
  const override = maxDateOverride?.trim() || readMaxDateEnvOverride();
  if (override) {
    return override;
  }

  const record = loadMaxAppointmentDateCache(projectRoot);
  return record?.maxDate?.trim() ?? "";
}

async function fetchAndCacheMaxDate(
  ctx: ApiServiceContext,
  page: Page | undefined,
  reason: "startup" | "poll",
): Promise<string | null> {
  const fetched = await fetchMaxAppointmentDate(ctx, page);
  if (!fetched) {
    return null;
  }

  saveMaxAppointmentDateCache(
    ctx.projectRoot,
    fetched,
    "admin-datas",
    ctx.settings.maxAppointmentDateAdminDataId,
  );
  const ttlHours = DEFAULT_MAX_DATE_CACHE_TTL_MS / 3_600_000;
  logger.info(
    `[api] maxDate AdminDatas yenilendi → ${fetched} (cache ${ttlHours}sa, ${reason})`,
  );
  return fetched;
}

function maxDateUnavailableMessage(): string {
  return (
    "AdminDatas maxDate alınamadı — portal oturumunu kontrol edin veya " +
    "API_CLOSED_DATE_MAX ile elle girin."
  );
}

/**
 * Watcher ilk acilisinda bir kez cagrilir — cache yoksa veya TTL dolmussa AdminDatas ceker.
 */
export async function ensureMaxAppointmentDate(
  ctx: ApiServiceContext,
  page?: Page,
): Promise<string> {
  const override = readMaxDateEnvOverride();
  if (override) {
    logger.info(`[api] maxDate env override → ${override}`);
    return override;
  }

  const cached = getFreshMaxAppointmentDateFromCache(ctx.projectRoot);
  if (cached) {
    logMaxDateCacheHit(cached.ageMs, cached.maxDate);
    return cached.maxDate;
  }

  logger.info("[api] maxDate cache yok veya suresi doldu — AdminDatas istegi yapiliyor.");
  const fetched = await fetchAndCacheMaxDate(ctx, page, "startup");
  if (!fetched) {
    throw new Error(maxDateUnavailableMessage());
  }
  return fetched;
}

/**
 * GetClosedDate poll oncesi maxDate — yalnizca env override veya AdminDatas (+ 12sa cache).
 */
export async function enrichQueryParamsWithLiveMaxDate(
  ctx: ApiServiceContext,
  params: ApiQueryParams,
  page?: Page,
): Promise<{ params: ApiQueryParams; source: MaxAppointmentDateCacheRecord["source"] | "env" }> {
  const override = readMaxDateEnvOverride();
  if (override) {
    return { params: { ...params, maxDate: override }, source: "env" };
  }

  const cached = getFreshMaxAppointmentDateFromCache(ctx.projectRoot);
  if (cached) {
    logMaxDateCacheHit(cached.ageMs, cached.maxDate);
    return { params: { ...params, maxDate: cached.maxDate }, source: "admin-datas" };
  }

  logger.info("[api] maxDate cache suresi doldu — AdminDatas yenileniyor.");
  const fetched = await fetchAndCacheMaxDate(ctx, page, "poll");
  if (!fetched) {
    throw new Error(maxDateUnavailableMessage());
  }

  return { params: { ...params, maxDate: fetched }, source: "admin-datas" };
}
