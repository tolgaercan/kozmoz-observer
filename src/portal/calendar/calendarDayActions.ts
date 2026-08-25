import type { Page } from "playwright";

import type { AppointmentSettings } from "../../config/settings.js";
import { humanClickLocator } from "../../interaction/humanClick.js";
import { logger } from "../../utils/logger.js";
import {
  dayCellLocator,
  normalizeHourLabel,
  splitLocators,
} from "./calendarDom.js";

export interface TimeSlotCheckResult {
  isoDate: string;
  times: string[];
  isEmpty: boolean;
  emptyMessage: string | null;
  hasRealSlots: boolean;
}

function mouseOptions(settings: AppointmentSettings) {
  return {
    minStepDelayMs: settings.minStepDelayMs,
    maxStepDelayMs: settings.maxStepDelayMs,
    overshootProbability: settings.overshootProbability,
  };
}

export type HourPanelState = "ready" | "empty" | "timeout";

const HOUR_PANEL_CONTAINER = ".appointment-hours-container";
const HOUR_PANEL_POLL_MS = 250;

async function countVisibleHourButtons(
  page: Page,
  settings: AppointmentSettings,
): Promise<number> {
  const buttonSelectors = splitLocators(settings.slotTimeButtonSelector);
  for (const selector of buttonSelectors) {
    const buttons = page.locator(selector);
    const count = await buttons.count();
    for (let index = 0; index < count; index++) {
      const label = (await buttons
        .nth(index)
        .innerText({ timeout: 500 })
        .catch(() => ""))
        .replace(/\s+/g, " ")
        .trim();
      if (label && /\d/.test(label)) {
        return 1;
      }
    }
  }
  return 0;
}

async function detectEmptyHourMessage(
  page: Page,
  settings: AppointmentSettings,
): Promise<boolean> {
  const emptyText = settings.slotEmptyTimeMessage.toLowerCase();
  for (const selector of splitLocators(settings.slotEmptyTimeMessageLocator)) {
    try {
      if (await page.locator(selector).first().isVisible({ timeout: 200 })) {
        return true;
      }
    } catch {
      // devam
    }
  }

  const bodyText = (await page.locator("body").innerText({ timeout: 1500 }).catch(() => "")).toLowerCase();
  return bodyText.includes(emptyText);
}

/** Gün tıklandıktan sonra saat paneli veya boş mesaj görünene kadar poll. */
export async function waitForAppointmentHourPanel(
  page: Page,
  settings: AppointmentSettings,
  timeoutMs?: number,
): Promise<HourPanelState> {
  const maxWaitMs = timeoutMs ?? settings.slotHourPanelTimeoutMs;
  const deadline = Date.now() + maxWaitMs;
  const emptyText = settings.slotEmptyTimeMessage;

  while (Date.now() < deadline) {
    if ((await countVisibleHourButtons(page, settings)) > 0) {
      logger.info("[takvim] Saat paneli hazır (.appointment-hours-container).");
      return "ready";
    }

    const container = page.locator(HOUR_PANEL_CONTAINER).first();
    const containerVisible = await container.isVisible({ timeout: 200 }).catch(() => false);
    if (containerVisible || (await detectEmptyHourMessage(page, settings))) {
      if (await detectEmptyHourMessage(page, settings)) {
        logger.info(`[takvim] Saat paneli boş: "${emptyText}"`);
        return "empty";
      }
    }

    await page.waitForTimeout(HOUR_PANEL_POLL_MS);
  }

  logger.warn(
    `[takvim] Saat paneli zaman aşımı (${maxWaitMs}ms).`,
  );
  return "timeout";
}

export async function clickCalendarDay(
  page: Page,
  isoDate: string,
  settings: AppointmentSettings,
  options?: { hourPanelTimeoutMs?: number },
): Promise<HourPanelState> {
  const cell = dayCellLocator(page, isoDate);
  await humanClickLocator(page, cell, {
    label: `Takvim günü ${isoDate}`,
    waitTimeoutMs: 10_000,
    ...mouseOptions(settings),
  });

  if (settings.slotDayClickWaitMs > 0) {
    await page.waitForTimeout(Math.min(settings.slotDayClickWaitMs, 300));
  }

  return waitForAppointmentHourPanel(page, settings, options?.hourPanelTimeoutMs);
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

  return {
    isoDate,
    times: uniqueTimes,
    isEmpty: !hasRealSlots && Boolean(emptyMessage),
    emptyMessage,
    hasRealSlots,
  };
}

export async function clickHourButtonByLabel(
  page: Page,
  hourLabel: string,
  settings: AppointmentSettings,
): Promise<string> {
  const targetNorm = normalizeHourLabel(hourLabel);
  if (!targetNorm) {
    throw new Error(`Geçersiz saat etiketi: ${hourLabel}`);
  }

  const buttonSelectors = splitLocators(settings.slotTimeButtonSelector);
  let lastError: unknown;

  for (const selector of buttonSelectors) {
    const buttons = page.locator(selector);
    const count = await buttons.count();
    for (let index = 0; index < count; index++) {
      const button = buttons.nth(index);
      const label = (await button.innerText({ timeout: 2000 })).replace(/\s+/g, " ").trim();
      if (!label || !/\d/.test(label)) {
        continue;
      }
      if (normalizeHourLabel(label) !== targetNorm) {
        continue;
      }

      try {
        await humanClickLocator(page, button, {
          label: `Randevu saati ${label}`,
          waitTimeoutMs: 10_000,
          ...mouseOptions(settings),
        });
        await page.waitForTimeout(settings.waitAfterWizardStepMs || 400);
        logger.info(`[takvim] Saat seçildi: ${label} (hedef: ${hourLabel})`);
        return label;
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw new Error(`Saat butonu bulunamadı: ${hourLabel}`, {
    cause: lastError instanceof Error ? lastError : undefined,
  });
}
