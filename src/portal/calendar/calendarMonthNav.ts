import type { Page } from "playwright";

import type { AppointmentSettings } from "../../config/settings.js";
import { humanClickLocator } from "../../interaction/humanClick.js";
import { logger } from "../../utils/logger.js";
import {
  dayCellLocator,
  isDayCellClickable,
  monthIndex,
  parseCalendarMonthFromDom,
  parseIsoDateParts,
  readCalendarMonthLabelFromDom,
  splitLocators,
} from "./calendarDom.js";

export async function getCalendarMonthLabel(page: Page): Promise<string | null> {
  return readCalendarMonthLabelFromDom(page);
}

export async function scrollCalendarIntoView(page: Page): Promise<void> {
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

/** Hedef ISO günü tıklanabilir olana kadar ay okları ile gezin. */
export async function ensureDayVisible(
  page: Page,
  isoDate: string,
  settings: AppointmentSettings,
  maxSteps = 14,
): Promise<boolean> {
  await scrollCalendarIntoView(page);

  const target = parseIsoDateParts(isoDate);
  if (!target) {
    logger.warn(`[takvim] Geçersiz ISO tarih: ${isoDate}`);
    return false;
  }

  for (let step = 0; step < maxSteps; step++) {
    if (await isDayCellClickable(page, isoDate)) {
      logger.info(`[takvim] Gün görünür: ${isoDate} (adım ${step})`);
      return true;
    }

    const current = await parseCalendarMonthFromDom(page);
    if (!current) {
      logger.warn("[takvim] Ay etiketi okunamadı — sonraki aya denenecek.");
      if (!(await clickCalendarNextMonth(page, settings))) {
        break;
      }
      continue;
    }

    const delta = monthIndex(target) - monthIndex(current);
    if (delta === 0) {
      const exists = (await dayCellLocator(page, isoDate).count()) > 0;
      if (!exists) {
        logger.warn(`[takvim] ${isoDate} bu ay grid'inde yok.`);
      } else {
        logger.warn(`[takvim] ${isoDate} görünüyor ama tıklanabilir değil.`);
      }
      break;
    }

    const moved =
      delta > 0
        ? await clickCalendarNextMonth(page, settings)
        : await clickCalendarPrevMonth(page, settings);
    if (!moved) {
      break;
    }
  }

  return isDayCellClickable(page, isoDate);
}

/** Captcha token yenileme tetiklemek için tek sefer ileri → geri */
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
