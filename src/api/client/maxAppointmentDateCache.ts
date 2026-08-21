import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { logger } from "../../utils/logger.js";

/** Varsayılan: günde 2 kez (12 saat). */
export const DEFAULT_MAX_DATE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export interface MaxAppointmentDateCacheRecord {
  maxDate: string;
  fetchedAt: string;
  source: "admin-datas" | "portal-formula" | "stale-reuse";
  adminDataId?: string;
}

function resolveCachePath(projectRoot: string): string {
  return resolve(projectRoot, "data/config/max-appointment-date.cache.json");
}

function readTtlMs(): number {
  const raw = process.env.API_MAX_DATE_CACHE_TTL_MS?.trim();
  if (!raw) {
    return DEFAULT_MAX_DATE_CACHE_TTL_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_MAX_DATE_CACHE_TTL_MS;
  }
  return parsed;
}

export function loadMaxAppointmentDateCache(
  projectRoot: string,
): MaxAppointmentDateCacheRecord | null {
  const path = resolveCachePath(projectRoot);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as MaxAppointmentDateCacheRecord;
    if (!parsed.maxDate?.trim() || !parsed.fetchedAt?.trim()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveMaxAppointmentDateCache(
  projectRoot: string,
  maxDate: string,
  source: MaxAppointmentDateCacheRecord["source"],
  adminDataId?: string,
): MaxAppointmentDateCacheRecord {
  const path = resolveCachePath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });

  const record: MaxAppointmentDateCacheRecord = {
    maxDate: maxDate.trim(),
    fetchedAt: new Date().toISOString(),
    source,
    adminDataId,
  };

  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
  return record;
}

export function getFreshMaxAppointmentDateFromCache(
  projectRoot: string,
  ttlMs = readTtlMs(),
): { maxDate: string; ageMs: number; record: MaxAppointmentDateCacheRecord } | null {
  const record = loadMaxAppointmentDateCache(projectRoot);
  if (!record) {
    return null;
  }

  const fetchedAtMs = Date.parse(record.fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) {
    return null;
  }

  const ageMs = Date.now() - fetchedAtMs;
  if (ageMs < 0 || ageMs >= ttlMs) {
    return null;
  }

  return { maxDate: record.maxDate, ageMs, record };
}

export function getStaleMaxAppointmentDateFromCache(
  projectRoot: string,
): MaxAppointmentDateCacheRecord | null {
  return loadMaxAppointmentDateCache(projectRoot);
}

export function formatCacheAge(ageMs: number): string {
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  const minutes = Math.floor((ageMs % (60 * 60 * 1000)) / (60 * 1000));
  if (hours <= 0) {
    return `${minutes}dk`;
  }
  return `${hours}sa ${minutes}dk`;
}

export function logMaxDateCacheHit(ageMs: number, maxDate: string, ttlMs?: number): void {
  const ttlLabel =
    ttlMs !== undefined ? formatCacheAge(ttlMs) : `${DEFAULT_MAX_DATE_CACHE_TTL_MS / 3_600_000}sa`;
  logger.info(
    `[api] maxDate cache hit → ${maxDate} (yas=${formatCacheAge(ageMs)}, ttl=${ttlLabel})`,
  );
}
