import type { BrowserContext, Page } from "playwright";

import { logger } from "../utils/logger.js";

/**
 * Sabit Chrome profilinde eski sekmeler geri yüklenir.
 * Observer için her zaman yeni, temiz bir sekme açar (eklenti + çerezler aynı context'te kalır).
 */
export async function resolveObserverPage(
  context: BrowserContext,
  options: { preferNewTab?: boolean } = {},
): Promise<Page> {
  const preferNewTab = options.preferNewTab ?? true;
  const existingPages = context.pages();

  logger.info(`Chrome açıldı — mevcut sekme sayısı: ${existingPages.length}`);

  if (preferNewTab || existingPages.length === 0) {
    const page = await context.newPage();
    logger.info("Observer sekmesi açıldı (yeni tab).");
    return page;
  }

  const page = existingPages[0];
  logger.info(`Mevcut sekme kullanılıyor: ${page.url() || "about:blank"}`);
  return page;
}
