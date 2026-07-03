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
import {
  detectRecaptchaState,
  waitForRecaptchaSolution,
} from "./recaptchaGate.js";

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
    return true;
  }

  logger.info("[takvim] reCAPTCHA bekleniyor (eklenti)...");
  const ok = await waitForRecaptchaSolution(
    page,
    settings.recaptchaWaitMs,
    settings.recaptchaPollIntervalMs,
  );
  return ok;
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
  logger.info(`[takvim] Tarama başlıyor — baz ay: ${baseMonth}, +${monthsAhead} ay`);

  if (!(await ensureRecaptchaBeforeScan(page, settings))) {
    return { availableDays: [], monthGroups: [], calendarFound: false };
  }

  const appendScan = async (scan: Awaited<ReturnType<typeof scanAvailableCalendarDays>>) => {
    if (!scan.calendarFound) {
      return;
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
  };

  const firstScan = await scanAvailableCalendarDays(page, settings);
  if (!firstScan.calendarFound) {
    return { availableDays: [], monthGroups: [], calendarFound: false };
  }
  await appendScan(firstScan);

  let advanced = 0;
  for (let index = 0; index < monthsAhead; index++) {
    const moved = await clickCalendarNextMonth(page, settings);
    if (!moved) {
      break;
    }
    advanced++;

    const afterMove = await detectRecaptchaState(page);
    if (afterMove.present && !afterMove.solved) {
      logger.info("[takvim] Ay geçişi sonrası reCAPTCHA yenilendi — eklenti bekleniyor...");
      if (!(await ensureRecaptchaBeforeScan(page, settings))) {
        break;
      }
    }

    const monthScan = await scanAvailableCalendarDays(page, settings);
    await appendScan(monthScan);
  }

  if (advanced > 0) {
    logger.info(`[takvim] Başlangıç ayına dönülüyor (${advanced} adım geri)...`);
    await returnToCalendarBaseMonth(page, settings, advanced);
  }

  logger.info(
    `[takvim] Çoklu ay taraması bitti — ${allDays.length} müsait gün (${monthGroups.length} ay).`,
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
    await waitForRecaptchaSolution(
      page,
      settings.recaptchaProactiveWaitMs,
      settings.recaptchaPollIntervalMs,
    );
    await clickCalendarPrevMonth(page, settings);
  } else {
    const movedPrev = await clickCalendarPrevMonth(page, settings);
    if (!movedPrev) {
      return false;
    }
    await waitForRecaptchaSolution(
      page,
      settings.recaptchaProactiveWaitMs,
      settings.recaptchaPollIntervalMs,
    );
    await clickCalendarNextMonth(page, settings);
  }

  const state = await detectRecaptchaState(page);
  return !state.present || state.solved;
}
