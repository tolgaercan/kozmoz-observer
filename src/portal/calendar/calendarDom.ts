import type { Page } from "playwright";

export function splitLocators(raw: string): string[] {
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function dayCellLocator(page: Page, isoDate: string) {
  return page.locator(`#dp-${isoDate}, [data-test-id="dp-${isoDate}"]`).first();
}

const TR_MONTH_INDEX: Record<string, number> = {
  ocak: 1,
  şubat: 2,
  subat: 2,
  mart: 3,
  nisan: 4,
  mayıs: 5,
  mayis: 5,
  haziran: 6,
  temmuz: 7,
  ağustos: 8,
  agustos: 8,
  eylül: 9,
  eylul: 9,
  ekim: 10,
  kasım: 11,
  kasim: 11,
  aralık: 12,
  aralik: 12,
};

export interface CalendarMonthRef {
  year: number;
  month: number;
}

export function parseIsoDateParts(isoDate: string): CalendarMonthRef | null {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(isoDate.trim());
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  if (!year || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
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

function parseMonthToken(token: string): number | null {
  const normalized = token
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return TR_MONTH_INDEX[normalized] ?? null;
}

export function parseCalendarMonthLabel(label: string | null): CalendarMonthRef | null {
  if (!label?.trim()) {
    return null;
  }

  const cleaned = label.replace(/\s+/g, " ").trim();
  const yearMatch = cleaned.match(/\b(20\d{2})\b/);
  if (!yearMatch) {
    return null;
  }

  const year = Number.parseInt(yearMatch[1]!, 10);
  const monthPart = cleaned.replace(yearMatch[0], "").trim();
  const month = parseMonthToken(monthPart.split(" ")[0] ?? monthPart);
  if (!month) {
    return null;
  }

  return { year, month };
}

export async function parseCalendarMonthFromDom(page: Page): Promise<CalendarMonthRef | null> {
  const monthLoc = page.locator('[data-dp-element="overlay-month"]').first();
  const yearLoc = page.locator('[data-dp-element="overlay-year"]').first();

  if ((await monthLoc.count()) > 0 && (await yearLoc.count()) > 0) {
    try {
      const monthText = (await monthLoc.innerText({ timeout: 2000 })).trim();
      const yearText = (await yearLoc.innerText({ timeout: 2000 })).trim();
      const month = parseMonthToken(monthText);
      const year = Number.parseInt(yearText, 10);
      if (month && Number.isFinite(year)) {
        return { year, month };
      }
    } catch {
      // label fallback
    }
  }

  return parseCalendarMonthLabel(await readCalendarMonthLabelFromDom(page));
}

export function monthIndex(ref: CalendarMonthRef): number {
  return ref.year * 12 + ref.month;
}

/** API/UI saat etiketi eşleştirmesi — "11.30" ↔ "11:30" */
export function normalizeHourLabel(label: string): string {
  return label.replace(/\D/g, "");
}

/** Takvimde şu an seçili (aktif) gün — VueDatePicker dp__active_date / id=dp-YYYY-MM-DD */
export async function readSelectedCalendarDayIso(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const activeInner =
      document.querySelector(".dp__cell_inner.dp__active_date") ??
      document.querySelector(".dp__cell_inner.dp__selection_start") ??
      document.querySelector(".dp__cell_inner.dp__range_start");

    const item =
      activeInner?.closest(".dp__calendar_item") ??
      activeInner?.closest("[id^='dp-']") ??
      document.querySelector(".dp__calendar_item .dp__active_date")?.closest(".dp__calendar_item");

    if (!item) {
      return null;
    }

    const id = item.id || item.getAttribute("data-test-id") || "";
    const match = /dp-(\d{4}-\d{2}-\d{2})/.exec(id);
    return match?.[1] ?? null;
  });
}

export async function isDayCellClickable(page: Page, isoDate: string): Promise<boolean> {
  const cell = dayCellLocator(page, isoDate);
  try {
    if (!(await cell.isVisible({ timeout: 400 }))) {
      return false;
    }
  } catch {
    return false;
  }

  if ((await cell.getAttribute("aria-disabled")) === "true") {
    return false;
  }

  const inner = cell.locator(".dp__cell_inner").first();
  if ((await inner.count()) > 0) {
    const className = (await inner.getAttribute("class")) ?? "";
    if (!className.includes("dp__pointer") || className.includes("dp__cell_disabled")) {
      return false;
    }
  }

  return true;
}

export async function waitForCalendarContainer(
  page: Page,
  calendarLocator: string,
  timeoutMs: number,
): Promise<boolean> {
  for (const selector of splitLocators(calendarLocator)) {
    try {
      await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
      return true;
    } catch {
      // sonraki locator
    }
  }
  return false;
}
