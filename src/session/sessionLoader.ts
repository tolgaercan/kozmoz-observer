import type { BrowserContext, Page } from "playwright";

import { logger } from "../utils/logger.js";
import { readCookiesFile, readStorageFile } from "./sessionReader.js";
import { applyPortalLocalStorage } from "./sessionPersister.js";

export interface SessionPaths {
  cookiesFile: string;
  storageFile: string;
}

export interface SessionLoadResult {
  cookiesLoaded: number;
  storageKeysLoaded: number;
}

const LOCAL_STORAGE_INIT_SCRIPT = (entries: Record<string, string>) => {
  for (const [key, value] of Object.entries(entries)) {
    window.localStorage.setItem(key, value);
  }
};

/**
 * cookies.json ve storage.json dosyalarını tarayıcı oturumuna yükler.
 * page.goto() çağrılmadan önce invoke edilmelidir.
 *
 * Worker Pool gibi paralel iş yükleri için stateless tasarlanmıştır.
 */
export interface SessionLoadOptions {
  /** Sabit Chrome profilinde profilin kendi çerezleri kullanılır */
  skipCookies?: boolean;
  skipStorage?: boolean;
  /** true ise sayfa yüklendikten sonra localStorage doğrudan yazılır (init script yedek) */
  applyStorageAfterNavigation?: boolean;
}

/**
 * cookies.json ve storage.json dosyalarını tarayıcı oturumuna yükler.
 * page.goto() çağrılmadan önce invoke edilmelidir.
 */
export async function loadSession(
  context: BrowserContext,
  page: Page,
  paths: SessionPaths,
  options: SessionLoadOptions = {},
): Promise<SessionLoadResult> {
  try {
    let cookiesLoaded = 0;
    let storageKeysLoaded = 0;

    if (!options.skipCookies) {
      const cookies = readCookiesFile(paths.cookiesFile);
      if (cookies.length > 0) {
        await context.addCookies(cookies);
        logger.info(`${cookies.length} çerez yüklendi (${paths.cookiesFile}).`);
        cookiesLoaded = cookies.length;
      } else {
        logger.warn(`Yüklenecek çerez yok: ${paths.cookiesFile}`);
      }
    } else {
      logger.info("Sabit profil modu — çerez enjeksiyonu atlandı (profil çerezleri kullanılacak).");
    }

    if (!options.skipStorage) {
      const storageEntries = readStorageFile(paths.storageFile);
      const storageKeys = Object.keys(storageEntries);

      if (storageKeys.length > 0) {
        await page.addInitScript(LOCAL_STORAGE_INIT_SCRIPT, storageEntries);
        logger.info(
          `${storageKeys.length} localStorage anahtarı enjekte edildi (${paths.storageFile}).`,
        );
        storageKeysLoaded = storageKeys.length;
      }
    } else {
      logger.info("Sabit profil modu — localStorage enjeksiyonu atlandı.");
    }

    return { cookiesLoaded, storageKeysLoaded };
  } catch (error) {
    throw new Error(
      `Session yüklenemedi: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Portal sayfası açıldıktan sonra storage enjekte et (origin doğru olmalı) */
export async function applySessionStorageOnPage(
  page: Page,
  paths: SessionPaths,
): Promise<number> {
  const storageEntries = readStorageFile(paths.storageFile);
  if (Object.keys(storageEntries).length === 0) {
    return 0;
  }
  const applied = await applyPortalLocalStorage(page, storageEntries);
  logger.info(`[session] ${applied} localStorage anahtarı sayfaya yazıldı (${page.url()}).`);
  return applied;
}
