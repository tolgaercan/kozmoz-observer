import type { Page } from "playwright";

import { logger } from "../utils/logger.js";
import { waitForUserContinue } from "./manualGate.js";

const DEFAULT_STARTUP_URL = "chrome://profile-picker";

/**
 * Observer başlangıcında Chrome profil ekranına gider; kullanıcı onayı bekler.
 */
export async function runChromeProfileGate(
  page: Page,
  startupUrl: string = DEFAULT_STARTUP_URL,
): Promise<void> {
  logger.info(`[bootstrap] Chrome profil ekranına gidiliyor: ${startupUrl}`);

  try {
    await page.goto(startupUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  } catch {
    logger.warn("[bootstrap] profile-picker açılamadı — chrome://settings/manageProfile deneniyor.");
    await page.goto("chrome://settings/manageProfile", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  }

  await waitForUserContinue(
    "[bootstrap] Chrome profilini seçin / kontrol edin. Hazır olunca Enter'a basın (akış devam eder)...",
  );
}
