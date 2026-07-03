import type { Page } from "playwright";

import type { NavigationSettings } from "../config/settings.js";
import { humanClickSelector } from "../interaction/humanClick.js";
import { resetMousePosition } from "../interaction/humanMouse.js";
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

async function clickStepLocators(
  page: Page,
  settings: NavigationSettings,
  locators: string[],
  stepLabel: string,
): Promise<void> {
  const perLocatorTimeoutMs = Math.max(
    10_000,
    Math.floor(settings.locatorTimeoutMs / locators.length),
  );
  const clickOptions = {
    minStepDelayMs: settings.minStepDelayMs,
    maxStepDelayMs: settings.maxStepDelayMs,
    overshootProbability: settings.overshootProbability,
  };

  let lastError: unknown;
  for (const selector of locators) {
    logger.info(`[${stepLabel}] Locator deneniyor: ${selector}`);
    try {
      await humanClickSelector(page, selector, {
        ...clickOptions,
        waitTimeoutMs: perLocatorTimeoutMs,
        label: selector,
      });
      logger.info(`[${stepLabel}] Tıklandı — URL: ${page.url()}`);
      await waitForPageSettle(page);
      return;
    } catch (error) {
      lastError = error;
      logger.warn(
        `[${stepLabel}] Bulunamadı: ${selector} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(
    `[${stepLabel}] Hiçbir locator bulunamadı. Denenen: ${locators.join(" | ")}`,
    { cause: lastError instanceof Error ? lastError : undefined },
  );
}

export async function clickNavigationTarget(
  page: Page,
  settings: NavigationSettings,
): Promise<void> {
  if (!settings.enabled || settings.steps.length === 0) {
    logger.info("Otomatik navigasyon kapalı — hedef tıklama atlandı.");
    return;
  }

  logger.info(
    `Otomatik navigasyon: ${settings.steps.length} adım. Henüz tıklama yok; locator görünür olmalı.`,
  );
  logger.info(`  URL: ${page.url()}`);

  if (settings.waitAfterLoadMs > 0) {
    await page.waitForTimeout(settings.waitAfterLoadMs);
  }

  resetMousePosition();

  for (let index = 0; index < settings.steps.length; index++) {
    const stepNumber = index + 1;
    const stepLabel = `Adım ${stepNumber}/${settings.steps.length}`;
    const locators = parseStepLocators(settings.steps[index]);

    logger.info(`[${stepLabel}] Hedef aranıyor (${locators.length} locator)...`);

    if (index > 0 && settings.waitBetweenStepsMs > 0) {
      await page.waitForTimeout(settings.waitBetweenStepsMs);
    }

    await clickStepLocators(page, settings, locators, stepLabel);
  }

  logger.info(`Navigasyon tamamlandı — son URL: ${page.url()}`);
}
