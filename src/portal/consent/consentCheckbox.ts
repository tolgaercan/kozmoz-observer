import type { Locator, Page } from "playwright";

import type { AppointmentSettings } from "../../config/settings.js";
import { humanClickLocator } from "../../interaction/humanClick.js";
import { logger } from "../../utils/logger.js";

function randomIn(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clickOptions(settings: AppointmentSettings) {
  return {
    waitTimeoutMs: settings.citySelectTimeoutMs,
    minStepDelayMs: settings.minStepDelayMs,
    maxStepDelayMs: settings.maxStepDelayMs,
    overshootProbability: settings.overshootProbability,
  };
}

export async function ensureCheckboxChecked(
  page: Page,
  locator: Locator,
  fieldLabel: string,
  settings: AppointmentSettings,
  maxAttempts = 4,
): Promise<void> {
  await locator.waitFor({ state: "attached", timeout: 15_000 });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await locator.isChecked().catch(() => false)) {
      logger.info(`[consent] ${fieldLabel} doğrulandı — işaretli.`);
      return;
    }

    if (await locator.isDisabled().catch(() => false)) {
      throw new Error(
        `[consent] ${fieldLabel} hâlâ devre dışı — metin sonuna kaydırılmamış olabilir.`,
      );
    }

    logger.info(`[consent] ${fieldLabel} tıklanıyor (${attempt}/${maxAttempts})...`);
    const label = locator.locator("xpath=ancestor::div[contains(@class,'form-check')]//label").first();
    const clickTarget = (await label.count()) > 0 ? label : locator;

    await humanClickLocator(page, clickTarget, {
      ...clickOptions(settings),
      label: fieldLabel,
    });
    await locator.dispatchEvent("change").catch(() => undefined);
    await locator.dispatchEvent("input").catch(() => undefined);
    await page.waitForTimeout(randomIn(220, 480));
  }

  if (await locator.isChecked().catch(() => false)) {
    return;
  }

  throw new Error(`[consent] ${fieldLabel} işaretlenemedi (${maxAttempts} deneme).`);
}

export function resolveConsentCheckbox(page: Page, labelMatch: RegExp): Locator {
  return page
    .locator(".form-check")
    .filter({ has: page.locator("label", { hasText: labelMatch }) })
    .locator("input[type='checkbox']")
    .first();
}
