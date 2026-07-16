import type { BrowserContext } from "playwright";

import { logger } from "../utils/logger.js";

/** CDP oturumunda çerezleri temizler — temiz portal girişi için */
export async function clearBrowserCookies(context: BrowserContext): Promise<void> {
  await context.clearCookies();
  logger.info("[session] Tarayıcı çerezleri temizlendi (temiz başlangıç).");
}
