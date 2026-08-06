import type { Page } from "playwright";

import type { ApiWatcherSettings } from "../../config/settings.js";
import { logger } from "../../utils/logger.js";
import { normalizeDateIso } from "./availabilityDates.js";
import {
  apiFetch,
  apiFetchViaPage,
  buildApiHeaders,
  maxAppointmentDateUrl,
  resolveAuthorizationForContext,
  resolvePortalReferer,
  type ApiServiceContext,
} from "./apiService.js";

/** Portal AdminDatas — MaxAppointmentDate kaydı (DevTools: id=2329). */
export const DEFAULT_MAX_APPOINTMENT_DATE_ADMIN_DATA_ID = "2329";

export interface MaxAppointmentDateRow {
  id?: number;
  dataType?: string;
  name?: string;
  description?: string;
}

function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

export function resolveMaxAppointmentDateAdminDataId(
  apiSettings: ApiWatcherSettings,
): string {
  return (
    readEnv("API_MAX_APPOINTMENT_DATE_ADMIN_DATA_ID") ??
    apiSettings.maxAppointmentDateAdminDataId ??
    DEFAULT_MAX_APPOINTMENT_DATE_ADMIN_DATA_ID
  );
}

/**
 * AdminDatas yanıtından maxDate — `dataType=MaxAppointmentDate`, değer `name` alanında.
 * Örnek: [{ "dataType": "MaxAppointmentDate", "name": "2026-09-01", ... }]
 */
export function parseMaxAppointmentDateResponse(raw: unknown): string | null {
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
      ? ((raw as { data: unknown[] }).data ?? [])
      : [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const entry = row as MaxAppointmentDateRow;
    if (entry.dataType !== "MaxAppointmentDate") {
      continue;
    }
    const normalized = normalizeDateIso(entry.name);
    if (normalized) {
      return normalized;
    }
  }

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const normalized = normalizeDateIso((row as MaxAppointmentDateRow).name);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function parseJsonBody(contentType: string, bodyText: string): unknown {
  if (contentType.includes("json")) {
    try {
      return JSON.parse(bodyText);
    } catch {
      return bodyText;
    }
  }
  return bodyText;
}

async function fetchMaxAppointmentDateViaNode(
  ctx: ApiServiceContext,
  adminDataId: string,
): Promise<string | null> {
  const url = maxAppointmentDateUrl(ctx, adminDataId);
  const response = await apiFetch(ctx, url);
  if (response.status < 200 || response.status >= 300) {
    logger.warn(
      `[api] AdminDatas maxDate HTTP ${response.status} — id=${adminDataId}`,
    );
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const raw = contentType.includes("json") ? await response.json() : await response.text();
  const parsed = typeof raw === "string" ? parseJsonBody(contentType, raw) : raw;
  return parseMaxAppointmentDateResponse(parsed);
}

async function fetchMaxAppointmentDateViaPage(
  ctx: ApiServiceContext,
  adminDataId: string,
  page: Page,
): Promise<string | null> {
  const url = maxAppointmentDateUrl(ctx, adminDataId);
  const referer = resolvePortalReferer(page.url(), ctx.settings.referer);
  const authorization = resolveAuthorizationForContext(ctx);
  const headers = buildApiHeaders(ctx, authorization, {}, referer);
  const browserResult = await apiFetchViaPage(page, url, headers);

  if (browserResult.networkError) {
    logger.warn(`[api] AdminDatas maxDate tarayıcı hatası: ${browserResult.networkError}`);
    return null;
  }

  if (browserResult.status < 200 || browserResult.status >= 300) {
    logger.warn(
      `[api] AdminDatas maxDate HTTP ${browserResult.status} — id=${adminDataId}`,
    );
    return null;
  }

  const raw = parseJsonBody(browserResult.contentType, browserResult.bodyText);
  return parseMaxAppointmentDateResponse(raw);
}

/** Portal AdminDatas — randevu alınabilir son tarih (GetClosedDate maxDate parametresi). */
export async function fetchMaxAppointmentDate(
  ctx: ApiServiceContext,
  page?: Page,
): Promise<string | null> {
  const adminDataId = resolveMaxAppointmentDateAdminDataId(ctx.settings);
  const forceNode = process.env.API_POLL_VIA_NODE === "true";

  if (page && !page.isClosed() && !forceNode) {
    try {
      return await fetchMaxAppointmentDateViaPage(ctx, adminDataId, page);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[api] AdminDatas maxDate (page) basarisiz: ${message}`);
    }
  }

  try {
    return await fetchMaxAppointmentDateViaNode(ctx, adminDataId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[api] AdminDatas maxDate (node) basarisiz: ${message}`);
    return null;
  }
}
