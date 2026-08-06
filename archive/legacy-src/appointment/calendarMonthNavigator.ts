import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanClickLocator } from "../interaction/humanClick.js";
import { logger } from "../utils/logger.js";
import { readCalendarMonthLabelFromDom } from "./calendarSlotScanner.js";

function splitLocators(raw: string): string[] {
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function getCalendarMonthLabel(page: Page): Promise<string | null> {
  return readCalendarMonthLabelFromDom(page);
}

async function scrollCalendarIntoView(page: Page): Promise<void> {
  const selectors = [".dp__calendar", "div.dp__main", ".dp__instance_calendar"];
  for (const selector of selectors) {
    const calendar = page.locator(selector).first();
    if ((await calendar.count()) > 0) {
      try {
        await calendar.scrollIntoViewIfNeeded({ timeout: 5000 });
        return;
      } catch {
        // sonraki
      }
    }
  }
}

async function describeNavButton(page: Page, selector: string): Promise<string> {
  const button = page.locator(selector).first();
  if ((await button.count()) === 0) {
    return `${selector}: bulunamadı`;
  }
  const ariaDisabled = (await button.getAttribute("aria-disabled")) ?? "yok";
  const visible = await button.isVisible().catch(() => false);
  const innerDisabled = await button.locator(".dp__inner_nav_disabled").count();
  return `${selector}: visible=${visible} aria-disabled=${ariaDisabled} innerDisabled=${innerDisabled}`;
}

async function isNavButtonEnabled(page: Page, locators: string[]): Promise<boolean> {
  for (const selector of locators) {
    const button = page.locator(selector).first();
    if ((await button.count()) === 0) {
      continue;
    }
    const disabled = await button.getAttribute("aria-disabled");
    if (disabled === "true") {
      logger.info(`[takvim] ${await describeNavButton(page, selector)}`);
      continue;
    }
    const innerDisabled = await button.locator(".dp__inner_nav_disabled").count();
    if (innerDisabled > 0) {
      logger.info(`[takvim] ${await describeNavButton(page, selector)}`);
      continue;
    }
    const visible = await button.isVisible().catch(() => false);
    if (!visible) {
      logger.info(`[takvim] ${await describeNavButton(page, selector)}`);
      continue;
    }
    return true;
  }
  return false;
}

/** Captcha sonrası tek sefer ileri → geri */
export async function bumpCalendarMonthForwardBack(
  page: Page,
  settings: AppointmentSettings,
): Promise<boolean> {
  await scrollCalendarIntoView(page);
  const before = (await getCalendarMonthLabel(page)) ?? "?";

  const movedNext = await clickCalendarNextMonth(page, settings);
  if (!movedNext) {
    logger.warn(`[takvim] İleri ok tıklanamadı (baz ay: ${before}).`);
    return false;
  }

  await page.waitForTimeout(settings.slotMonthNavWaitMs);
  const movedBack = await clickCalendarPrevMonth(page, settings);
  if (!movedBack) {
    logger.warn("[takvim] Geri ok tıklanamadı — baz aya dönülemedi.");
    return false;
  }

  const after = (await getCalendarMonthLabel(page)) ?? "?";
  logger.info(`[takvim] Ay bump tamam: ${before} → ileri → ${after}`);
  return true;
}

export async function clickCalendarNextMonth(
  page: Page,
  settings: AppointmentSettings,
): Promise<boolean> {
  await scrollCalendarIntoView(page);
  const locators = splitLocators(settings.slotCalendarNextLocator);
  if (!(await isNavButtonEnabled(page, locators))) {
    logger.warn(
      `[takvim] İleri ok kullanılamıyor — ${locators.map((s) => s.slice(0, 40)).join(" | ")}`,
    );
    return false;
  }

  for (const selector of locators) {
    const button = page.locator(selector).first();
    if ((await button.count()) === 0) {
      continue;
    }
    logger.info("Takvim: sonraki ay →");
    await humanClickLocator(page, button, {
      label: "Takvim sonraki ay",
      waitTimeoutMs: 10_000,
      minStepDelayMs: settings.minStepDelayMs,
      maxStepDelayMs: settings.maxStepDelayMs,
      overshootProbability: settings.overshootProbability,
    });
    await page.waitForTimeout(settings.slotMonthNavWaitMs);
    logger.info(`Takvim ayı: ${(await getCalendarMonthLabel(page)) ?? "?"}`);
    return true;
  }

  return false;
}

export async function clickCalendarPrevMonth(
  page: Page,
  settings: AppointmentSettings,
): Promise<boolean> {
  await scrollCalendarIntoView(page);
  const locators = splitLocators(settings.slotCalendarPrevLocator);
  if (!(await isNavButtonEnabled(page, locators))) {
    logger.warn(
      `[takvim] Geri ok kullanılamıyor — ${locators.map((s) => s.slice(0, 40)).join(" | ")}`,
    );
    return false;
  }

  for (const selector of locators) {
    const button = page.locator(selector).first();
    if ((await button.count()) === 0) {
      continue;
    }
    logger.info("Takvim: önceki ay ←");
    await humanClickLocator(page, button, {
      label: "Takvim önceki ay",
      waitTimeoutMs: 10_000,
      minStepDelayMs: settings.minStepDelayMs,
      maxStepDelayMs: settings.maxStepDelayMs,
      overshootProbability: settings.overshootProbability,
    });
    await page.waitForTimeout(settings.slotMonthNavWaitMs);
    logger.info(`Takvim ayı: ${(await getCalendarMonthLabel(page)) ?? "?"}`);
    return true;
  }

  return false;
}

/** Başlangıç ayına geri dön */
export async function returnToCalendarBaseMonth(
  page: Page,
  settings: AppointmentSettings,
  stepsBack: number,
): Promise<void> {
  for (let step = 0; step < stepsBack; step++) {
    const moved = await clickCalendarPrevMonth(page, settings);
    if (!moved) {
      break;
    }
  }
}
