import { readFileSync, existsSync } from "node:fs";
import type { Cookie } from "playwright";

import { normalizeCookies, sanitizeCookies, isBrowserExportFormat } from "./cookieSanitizer.js";
import { logger } from "../utils/logger.js";

export type StorageEntries = Record<string, string>;

export function readCookiesFile(cookiesFilePath: string): Cookie[] {
  if (!existsSync(cookiesFilePath)) {
    logger.warn(`cookies.json bulunamadı, boş liste kullanılacak: ${cookiesFilePath}`);
    return [];
  }

  try {
    const raw = readFileSync(cookiesFilePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error("cookies.json bir JSON dizisi olmalı.");
    }

    const isExport = isBrowserExportFormat(parsed);
    const result = isExport
      ? sanitizeCookies(parsed, { includeOptional: true })
      : sanitizeCookies(parsed);

    if (result.missingCloudflare.length > 0) {
      logger.warn(
        `Eksik Cloudflare çerezleri: ${result.missingCloudflare.join(", ")} — CF challenge tetiklenebilir.`,
      );
    }

    if (result.cookies.length > 0) {
      logger.info(`Çerezler filtrelendi, yüklenecek: ${result.kept.join(", ")}`);
    }

    return result.cookies;
  } catch (error) {
    throw new Error(
      `cookies.json okunamadı (${cookiesFilePath}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function readStorageFile(storageFilePath: string): StorageEntries {
  if (!existsSync(storageFilePath)) {
    logger.error(`storage.json bulunamadı: ${storageFilePath}`);
    return {};
  }

  try {
    const raw = readFileSync(storageFilePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("storage.json bir key-value JSON nesnesi olmalı.");
    }

    const entries: StorageEntries = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      entries[key] = typeof value === "string" ? value : JSON.stringify(value);
    }

    return entries;
  } catch (error) {
    logger.error(
      `storage.json okunamadı (${storageFilePath}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return {};
  }
}
