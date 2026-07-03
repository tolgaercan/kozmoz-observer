import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanClickSelector } from "../interaction/humanClick.js";
import { logger } from "../utils/logger.js";

function parseLocatorList(raw: string): string[] {
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function clickWizardNextButton(
  page: Page,
  settings: AppointmentSettings,
): Promise<void> {
  if (!settings.wizardNextEnabled) {
    logger.info("Wizard Sonraki tıklaması kapalı — WIZARD_NEXT_ENABLED=false");
    return;
  }

  if (settings.waitBeforeWizardNextMs > 0) {
    await page.waitForTimeout(settings.waitBeforeWizardNextMs);
  }

  const locators = parseLocatorList(settings.wizardNextLocator);
  const clickOptions = {
    waitTimeoutMs: settings.citySelectTimeoutMs,
    minStepDelayMs: settings.minStepDelayMs,
    maxStepDelayMs: settings.maxStepDelayMs,
    overshootProbability: settings.overshootProbability,
  };

  let lastError: unknown;
  for (const selector of locators) {
    logger.info(`Sonraki butonu deneniyor: ${selector}`);
    try {
      await humanClickSelector(page, selector, {
        ...clickOptions,
        label: "Sonraki",
      });
      logger.info(`Sonraki tıklandı — URL: ${page.url()}`);

      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
      } catch {
        logger.warn("Sonraki sonrası domcontentloaded zaman aşımı — devam ediliyor.");
      }
      return;
    } catch (error) {
      lastError = error;
      logger.warn(
        `Sonraki locator başarısız (${selector}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(
    `Sonraki butonu bulunamadı. Denenen: ${locators.join(" | ")}`,
    { cause: lastError instanceof Error ? lastError : undefined },
  );
}

export async function clickWizardPreviousButton(
  page: Page,
  settings: AppointmentSettings,
): Promise<void> {
  const locators = parseLocatorList(settings.wizardPreviousLocator);
  const clickOptions = {
    waitTimeoutMs: settings.citySelectTimeoutMs,
    minStepDelayMs: settings.minStepDelayMs,
    maxStepDelayMs: settings.maxStepDelayMs,
    overshootProbability: settings.overshootProbability,
  };

  let lastError: unknown;
  for (const selector of locators) {
    logger.info(`Önceki butonu deneniyor: ${selector}`);
    try {
      await humanClickSelector(page, selector, {
        ...clickOptions,
        label: "Önceki",
      });
      logger.info("Önceki tıklandı.");
      await page.waitForTimeout(settings.waitBeforeWizardNextMs);
      return;
    } catch (error) {
      lastError = error;
      logger.warn(
        `Önceki locator başarısız (${selector}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(
    `Önceki butonu bulunamadı. Denenen: ${locators.join(" | ")}`,
    { cause: lastError instanceof Error ? lastError : undefined },
  );
}
