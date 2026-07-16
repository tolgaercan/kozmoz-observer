import type { Page } from "playwright";

import type { NavigationSettings } from "../config/settings.js";
import { resetMousePosition } from "../interaction/humanMouse.js";
import { navigateKosmosAppointmentFlow } from "./kosmosPortalNav.js";
import { logger } from "../utils/logger.js";

function parseStepLocators(raw: string): string[] {
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function waitForPageSettle(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  } catch {
    logger.warn("domcontentloaded zaman aşımı — devam ediliyor.");
  }
}

export async function clickNavigationTarget(
  page: Page,
  settings: NavigationSettings,
  options: { homeUrl?: string } = {},
): Promise<void> {
  if (!settings.enabled || settings.steps.length === 0) {
    logger.info("Otomatik navigasyon kapalı — hedef tıklama atlandı.");
    return;
  }

  logger.info(
    `Otomatik navigasyon: Kosmos randevu menüsü (${settings.steps.length} adım tanımlı).`,
  );
  logger.info(`  URL: ${page.url()}`);

  if (settings.waitAfterLoadMs > 0) {
    await page.waitForTimeout(settings.waitAfterLoadMs);
  }

  resetMousePosition();
  await navigateKosmosAppointmentFlow(page, settings, { homeUrl: options.homeUrl });
  await waitForPageSettle(page);

  logger.info(`Navigasyon tamamlandı — son URL: ${page.url()}`);
}

/** @deprecated Eski env tabanlı adım locator'ları — kosmosPortalNav kullanın */
export function parseNavigationStepLocators(raw: string): string[] {
  return parseStepLocators(raw);
}
