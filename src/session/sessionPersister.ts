import { writeFileSync } from "node:fs";

import type { Page } from "playwright";

import { logger } from "../utils/logger.js";
import type { StorageEntries } from "./sessionReader.js";

const SKIP_STORAGE_KEYS = new Set(["Kosmos-initial-loader-bg", "Kosmos-initial-loader-color"]);

/** Portal localStorage — JWT genelde rastgele anahtar adıyla tutulur */
export async function readPortalLocalStorage(page: Page): Promise<StorageEntries> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) {
        continue;
      }
      const value = localStorage.getItem(key);
      if (value !== null) {
        out[key] = value;
      }
    }
    return out;
  });
}

export async function applyPortalLocalStorage(
  page: Page,
  entries: StorageEntries,
): Promise<number> {
  if (Object.keys(entries).length === 0) {
    return 0;
  }

  await page.evaluate((items) => {
    for (const [key, value] of Object.entries(items)) {
      localStorage.setItem(key, value);
    }
  }, entries);

  return Object.keys(entries).length;
}

function filterPersistableStorage(entries: StorageEntries): StorageEntries {
  const filtered: StorageEntries = {};
  for (const [key, value] of Object.entries(entries)) {
    if (SKIP_STORAGE_KEYS.has(key)) {
      filtered[key] = value;
      continue;
    }
    // JWT veya oturum token'ı — hepsini kaydet (anahtar adı dinamik)
    if (value.startsWith("eyJ") || key.length >= 16) {
      filtered[key] = value;
      continue;
    }
    filtered[key] = value;
  }
  return filtered;
}

/** Chrome'daki portal JWT/localStorage → storage.json */
export async function persistPortalStorage(
  page: Page,
  storageFilePath: string,
): Promise<number> {
  const live = await readPortalLocalStorage(page);
  const persistable = filterPersistableStorage(live);
  const keys = Object.keys(persistable);

  if (keys.length === 0) {
    logger.warn(`[session] Kaydedilecek localStorage yok — ${storageFilePath}`);
    return 0;
  }

  writeFileSync(storageFilePath, `${JSON.stringify(persistable, null, 2)}\n`, "utf-8");
  const jwtKeys = keys.filter((k) => persistable[k]?.startsWith("eyJ"));
  logger.info(
    `[session] storage.json güncellendi — ${keys.length} anahtar` +
      (jwtKeys.length > 0 ? ` (JWT: ${jwtKeys.length})` : ""),
  );
  return keys.length;
}

export function hasJwtInStorage(entries: StorageEntries): boolean {
  return Object.values(entries).some((v) => v.startsWith("eyJ"));
}
