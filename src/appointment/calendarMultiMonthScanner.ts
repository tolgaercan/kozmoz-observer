import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";
import {
  clickCalendarNextMonth,
  clickCalendarPrevMonth,
  getCalendarMonthLabel,
  returnToCalendarBaseMonth,
} from "./calendarMonthNavigator.js";
import {
  type AvailableSlotDay,
  scanAvailableCalendarDays,
} from "./calendarSlotScanner.js";
import { verifyCandidateDays } from "./calendarDayVerifier.js";
import { detectRecaptchaState } from "./recaptchaGate.js";
import { ensureStableRecaptchaOrEscape } from "./captchaSession.js";

export interface MonthSlotGroup {
  monthLabel: string;
  days: AvailableSlotDay[];
}

export interface MultiMonthScanResult {
  availableDays: AvailableSlotDay[];
  monthGroups: MonthSlotGroup[];
  calendarFound: boolean;
}

async function ensureRecaptchaBeforeScan(
  page: Page,
  settings: AppointmentSettings,
): Promise<boolean> {
  const state = await detectRecaptchaState(page);
  if (!state.present || state.solved) {
    if (state.solved && state.present) {
      return ensureStableRecaptchaOrEscape(page, settings);
    }
    return true;
  }

  logger.info("[takvim] reCAPTCHA bekleniyor (captcha-lock)...");
  return ensureStableRecaptchaOrEscape(page, settings);
}

async function clickCalendarNextMonthWithRetry(
  page: Page,
  settings: AppointmentSettings,
  maxAttempts = 2,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await clickCalendarNextMonth(page, settings)) {
      return true;
    }

    if (attempt < maxAttempts) {
      logger.info(
        `[takvim] İleri ay tıklanamadı (deneme ${attempt}/${maxAttempts}) — captcha kontrolü...`,
      );
      if (!(await ensureRecaptchaBeforeScan(page, settings))) {
        return false;
      }
      await page.waitForTimeout(settings.slotMonthNavWaitMs);
    }
  }

  return false;
}

/** Mevcut ay + slotMonthsAhead kadar ileri ay tarar, sonra başlangıç ayına döner */
export async function scanAvailableCalendarMonths(
  page: Page,
  settings: AppointmentSettings,
): Promise<MultiMonthScanResult> {
  const monthsAhead = Math.max(0, settings.slotMonthsAhead);
  const monthGroups: MonthSlotGroup[] = [];
  const allDays: AvailableSlotDay[] = [];
  const seenDates = new Set<string>();

  const baseMonth = (await getCalendarMonthLabel(page)) ?? "Ay-0";
  logger.info(
    `[takvim] Çoklu ay taraması — baz: ${baseMonth}, +${monthsAhead} ay (ileri tarama + baz aya dönüş).`,
  );

  if (!(await ensureRecaptchaBeforeScan(page, settings))) {
    return { availableDays: [], monthGroups: [], calendarFound: false };
  }

  const appendScan = async (scan: Awaited<ReturnType<typeof scanAvailableCalendarDays>>) => {
    if (!scan.calendarFound) {
      return false;
    }
    const label = scan.monthLabel ?? "Bilinmeyen ay";

    let days = scan.availableDays;
    if (days.length > 0) {
      days = await verifyCandidateDays(page, days, settings);
    }

    const uniqueDays = days.filter((day) => {
      if (seenDates.has(day.isoDate)) {
        return false;
      }
      seenDates.add(day.isoDate);
      return true;
    });
    monthGroups.push({ monthLabel: label, days: uniqueDays });
    allDays.push(...uniqueDays);
    return true;
  };

  const firstScan = await scanAvailableCalendarDays(page, settings);
  if (!firstScan.calendarFound) {
    return { availableDays: [], monthGroups: [], calendarFound: false };
  }
  await appendScan(firstScan);

  let advanced = 0;
  for (let index = 0; index < monthsAhead; index++) {
    const moved = await clickCalendarNextMonthWithRetry(page, settings);
    if (!moved) {
      logger.warn(
        `[takvim] ${index + 1}. ileri ay açılamadı — kalan aylar atlanıyor (baz: ${baseMonth}).`,
      );
      break;
    }
    advanced++;

    const afterMove = await detectRecaptchaState(page);
    if (afterMove.present && !afterMove.solved) {
      logger.info("[takvim] Ay geçişi sonrası reCAPTCHA — bekleniyor...");
      if (!(await ensureRecaptchaBeforeScan(page, settings))) {
        break;
      }
    }

    const monthScan = await scanAvailableCalendarDays(page, settings);
    await appendScan(monthScan);
  }

  if (advanced > 0) {
    logger.info(`[takvim] Baz aya dönülüyor (${advanced} adım geri)...`);
    await returnToCalendarBaseMonth(page, settings, advanced);
  }

  const scannedLabels = monthGroups.map((group) => group.monthLabel).join(", ");
  logger.info(
    `[takvim] Tarama bitti — ${allDays.length} müsait gün | taranan: ${scannedLabels || baseMonth}.`,
  );

  return {
    availableDays: allDays.sort((a, b) => a.isoDate.localeCompare(b.isoDate)),
    monthGroups,
    calendarFound: true,
  };
}

/** reCAPTCHA yenileme — wizard adımını değiştirmeden ay okları ile */
export async function refreshRecaptchaViaMonthNav(
  page: Page,
  settings: AppointmentSettings,
): Promise<boolean> {
  logger.info("[captcha] Ay okları ile reCAPTCHA yenileme (ileri → geri)...");

  const movedNext = await clickCalendarNextMonth(page, settings);
  if (movedNext) {
    await ensureStableRecaptchaOrEscape(page, settings);
    await clickCalendarPrevMonth(page, settings);
  } else {
    const movedPrev = await clickCalendarPrevMonth(page, settings);
    if (!movedPrev) {
      return false;
    }
    await ensureStableRecaptchaOrEscape(page, settings);
    await clickCalendarNextMonth(page, settings);
  }

  const state = await detectRecaptchaState(page);
  return !state.present || state.solved;
}
