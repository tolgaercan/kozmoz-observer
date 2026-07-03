import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanClickLocator } from "../interaction/humanClick.js";
import { logger } from "../utils/logger.js";
import type { AvailableSlotDay } from "./calendarSlotScanner.js";

export interface TimeSlotCheckResult {
  isoDate: string;
  times: string[];
  isEmpty: boolean;
  emptyMessage: string | null;
  hasRealSlots: boolean;
}

function splitLocators(raw: string): string[] {
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function dayCellLocator(page: Page, isoDate: string) {
  return page
    .locator(`#dp-${isoDate}, [data-test-id="dp-${isoDate}"]`)
    .first();
}

export async function clickCalendarDay(
  page: Page,
  isoDate: string,
  settings: AppointmentSettings,
): Promise<void> {
  const cell = dayCellLocator(page, isoDate);
  await humanClickLocator(page, cell, {
    label: `Takvim günü ${isoDate}`,
    waitTimeoutMs: 10_000,
    minStepDelayMs: settings.minStepDelayMs,
    maxStepDelayMs: settings.maxStepDelayMs,
    overshootProbability: settings.overshootProbability,
  });
  await page.waitForTimeout(settings.slotDayClickWaitMs);
}

export async function readTimeSlotsForSelectedDay(
  page: Page,
  isoDate: string,
  settings: AppointmentSettings,
): Promise<TimeSlotCheckResult> {
  const buttonSelectors = splitLocators(settings.slotTimeButtonSelector);
  const emptyText = settings.slotEmptyTimeMessage.toLowerCase();

  const times: string[] = [];
  for (const selector of buttonSelectors) {
    const buttons = page.locator(selector);
    const count = await buttons.count();
    for (let index = 0; index < count; index++) {
      const label = (await buttons.nth(index).innerText({ timeout: 2000 }))
        .replace(/\s+/g, " ")
        .trim();
      if (label && /\d/.test(label)) {
        times.push(label);
      }
    }
    if (times.length > 0) {
      break;
    }
  }

  let emptyMessage: string | null = null;
  if (times.length === 0) {
    const bodyText = (await page.locator("body").innerText({ timeout: 3000 })).toLowerCase();
    if (bodyText.includes(emptyText)) {
      emptyMessage = settings.slotEmptyTimeMessage;
    }
  }

  const uniqueTimes = [...new Set(times)];
  const hasRealSlots = uniqueTimes.length > 0;
  const isEmpty = !hasRealSlots && Boolean(emptyMessage);

  return {
    isoDate,
    times: uniqueTimes,
    isEmpty,
    emptyMessage,
    hasRealSlots,
  };
}

export async function verifyCalendarDaySlots(
  page: Page,
  isoDate: string,
  settings: AppointmentSettings,
): Promise<AvailableSlotDay | null> {
  await clickCalendarDay(page, isoDate, settings);
  const check = await readTimeSlotsForSelectedDay(page, isoDate, settings);

  if (check.hasRealSlots) {
    logger.info(`[slot-verify] ${isoDate} — DOLU saatler: ${check.times.join(", ")}`);
    return {
      isoDate,
      dayNumber: Number.parseInt(isoDate.slice(-2), 10),
      times: check.times,
      verified: true,
    };
  }

  if (check.isEmpty) {
    logger.warn(
      `[slot-verify] ${isoDate} — takvimde müsait görünüyor ama saat yok (portal hatası).`,
    );
    return null;
  }

  logger.warn(`[slot-verify] ${isoDate} — saat alanı belirsiz, atlandı.`);
  return null;
}

export function shouldVerifyCandidates(
  candidateCount: number,
  settings: AppointmentSettings,
): boolean {
  if (!settings.slotVerifyByClick) {
    return false;
  }

  switch (settings.slotVerifyMode) {
    case "never":
      return false;
    case "single-only":
      return candidateCount === 1;
    case "always":
    default:
      return candidateCount > 0;
  }
}

export async function verifyCandidateDays(
  page: Page,
  candidates: AvailableSlotDay[],
  settings: AppointmentSettings,
): Promise<AvailableSlotDay[]> {
  if (!shouldVerifyCandidates(candidates.length, settings)) {
    if (candidates.length > 1) {
      logger.info(
        `[slot-verify] ${candidates.length} gün — tıklama yok, takvim listesi olarak gönderilecek.`,
      );
    } else {
      logger.info(
        `[slot-verify] Atlandı (${candidates.length} aday) — mod=${settings.slotVerifyMode}`,
      );
    }
    return candidates.map((day) => ({ ...day, verified: false }));
  }

  const confirmed: AvailableSlotDay[] = [];
  for (const candidate of candidates) {
    const verified = await verifyCalendarDaySlots(page, candidate.isoDate, settings);
    if (verified) {
      confirmed.push(verified);
    }
  }

  logger.info(
    `[slot-verify] ${confirmed.length}/${candidates.length} gün gerçek saat ile doğrulandı.`,
  );
  return confirmed;
}
