import type { Page } from "playwright";

import { logger } from "../utils/logger.js";

const PORTAL_ERROR_PATTERNS = [
  /bir\s+hata\s+oluştu/i,
  /geçersiz\s+bağlantı/i,
  /link\s+geçersiz/i,
  /oturum\s+sona\s+erdi/i,
  /session\s+expired/i,
  /error/i,
  /hata/i,
];

export async function detectPortalPageError(page: Page): Promise<string | null> {
  const url = page.url();
  if (!/kosmosvize\.com\.tr/i.test(url)) {
    return null;
  }

  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "");

  const snippet = bodyText.slice(0, 800).replace(/\s+/g, " ").trim();

  for (const pattern of PORTAL_ERROR_PATTERNS) {
    if (pattern.test(snippet) && !/Kimlik Doğrulama/i.test(snippet)) {
      return snippet.slice(0, 200);
    }
  }

  return null;
}

export async function logPortalPageState(page: Page, label: string): Promise<void> {
  const url = page.url();
  const title = await page.title().catch(() => "?");
  logger.info(`[portal] ${label} — title="${title}" url=${url}`);

  const error = await detectPortalPageError(page);
  if (error) {
    logger.warn(`[portal] ${label} — olasi hata metni: ${error}`);
  }
}
