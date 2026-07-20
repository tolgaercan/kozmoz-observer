import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";

export interface AvailableSlotDay {
  isoDate: string;
  dayNumber: number;
  times?: string[];
  verified?: boolean;
}

export interface CalendarScanResult {
  availableDays: AvailableSlotDay[];
  monthLabel: string | null;
  textSummary: string;
  calendarFound: boolean;
}

function splitLocators(raw: string): string[] {
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function readCalendarMonthLabelFromDom(page: Page): Promise<string | null> {
  const monthLoc = page.locator('[data-dp-element="overlay-month"]').first();
  const yearLoc = page.locator('[data-dp-element="overlay-year"]').first();

  if ((await monthLoc.count()) > 0 && (await yearLoc.count()) > 0) {
    try {
      const month = (await monthLoc.innerText({ timeout: 2000 })).replace(/\s+/g, " ").trim();
      const year = (await yearLoc.innerText({ timeout: 2000 })).replace(/\s+/g, " ").trim();
      if (month && year) {
        return `${month} ${year}`;
      }
    } catch {
      // legacy fallback
    }
  }

  const legacy = page.locator(".dp__month_year").first();
  if ((await legacy.count()) > 0) {
    try {
      const text = (await legacy.innerText({ timeout: 2000 })).replace(/\s+/g, " ").trim();
      return text || null;
    } catch {
      return null;
    }
  }

  return null;
}

async function scanAvailableDatesInDom(page: Page): Promise<string[]> {
  const items = page.locator(".dp__calendar_item");
  const count = await items.count();
  const available: string[] = [];

  for (let index = 0; index < count; index++) {
    const item = items.nth(index);

    if ((await item.getAttribute("aria-disabled")) === "true") {
      continue;
    }

    const inner = item.locator(".dp__cell_inner").first();
    if ((await inner.count()) === 0) {
      continue;
    }

    const className = (await inner.getAttribute("class")) ?? "";
    if (!className.includes("dp__pointer") || className.includes("dp__cell_disabled")) {
      continue;
    }

    const rawId = (await item.getAttribute("id")) ?? "";
    if (rawId.startsWith("dp-")) {
      const isoDate = rawId.slice(3);
      if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        available.push(isoDate);
        continue;
      }
    }

    const testId = (await item.getAttribute("data-test-id")) ?? "";
    if (testId.startsWith("dp-")) {
      const isoDate = testId.slice(3);
      if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        available.push(isoDate);
      }
    }
  }

  return [...new Set(available)].sort();
}

function formatTurkishDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) {
    return isoDate;
  }
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("tr-TR", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function buildSlotTextSummary(
  availableDays: AvailableSlotDay[],
  monthLabel: string | null,
  profileLabel: string,
  city?: string,
): string {
  const header = city
    ? `Müsait randevu günleri — ${city} (${profileLabel})`
    : `Müsait randevu günleri — ${profileLabel}`;

  if (availableDays.length === 0) {
    return `${header}\n\nŞu an müsait gün yok.`;
  }

  const monthLine = monthLabel ? `\nTakvim: ${monthLabel}` : "";
  const lines = availableDays.map((day) => `• ${day.isoDate} (${formatTurkishDate(day.isoDate)})`);

  return [header, monthLine, "", ...lines, "", `Toplam: ${availableDays.length} gün`]
    .join("\n")
    .trim();
}

export function buildMultiMonthSlotTextSummary(
  monthGroups: Array<{ monthLabel: string; days: AvailableSlotDay[] }>,
  profileLabel: string,
  city?: string,
): string {
  const header = city
    ? `Müsait randevu günleri — ${city} (${profileLabel})`
    : `Müsait randevu günleri — ${profileLabel}`;

  const scannedMonths =
    monthGroups.length > 0 ? monthGroups.map((group) => group.monthLabel).join(", ") : "—";
  const allDays = monthGroups.flatMap((group) => group.days);

  if (allDays.length === 0) {
    return `${header}\n\nTaranan aylar: ${scannedMonths}\n\nŞu an müsait gün yok.`;
  }

  const sections = monthGroups.map((group) => {
    if (group.days.length === 0) {
      return `${group.monthLabel}:\n  (müsait gün yok)`;
    }
    const lines = group.days.map((day) => {
      const times =
        day.times && day.times.length > 0 ? ` → saatler: ${day.times.join(", ")}` : "";
      const verified = day.verified ? " ✓" : "";
      return `  • ${day.isoDate} (${formatTurkishDate(day.isoDate)})${times}${verified}`;
    });
    return `${group.monthLabel}:\n${lines.join("\n")}`;
  });

  return [
    header,
    `\nTaranan aylar: ${scannedMonths}`,
    "",
    ...sections,
    "",
    `Toplam: ${allDays.length} gün (${monthGroups.length} ay)`,
  ]
    .join("\n")
    .trim();
}

export async function scanAvailableCalendarDays(
  page: Page,
  settings: AppointmentSettings,
): Promise<CalendarScanResult> {
  const calendarSelectors = splitLocators(settings.slotCalendarLocator);
  let calendarFound = false;

  for (const selector of calendarSelectors) {
    const candidate = page.locator(selector).first();
    if ((await candidate.count()) > 0) {
      try {
        if (await candidate.isVisible({ timeout: 2000 })) {
          calendarFound = true;
          break;
        }
      } catch {
        // sonraki
      }
    }
  }

  if (!calendarFound) {
    calendarFound = (await page.locator(".dp__calendar_item").count()) > 0;
  }

  if (!calendarFound) {
    return {
      availableDays: [],
      monthLabel: null,
      textSummary: "Takvim bulunamadı.",
      calendarFound: false,
    };
  }

  const monthLabel = await readCalendarMonthLabelFromDom(page);
  const available = await scanAvailableDatesInDom(page);

  const availableDays: AvailableSlotDay[] = available.map((isoDate) => ({
    isoDate,
    dayNumber: Number.parseInt(isoDate.slice(-2), 10),
  }));

  logger.info(
    `Takvim taraması: ${availableDays.length} müsait gün${monthLabel ? ` (${monthLabel})` : ""}.`,
  );

  if (availableDays.length > 0) {
    logger.info(`Müsait günler: ${availableDays.map((day) => day.isoDate).join(", ")}`);
  }

  return {
    availableDays,
    monthLabel,
    textSummary: "",
    calendarFound: true,
  };
}
