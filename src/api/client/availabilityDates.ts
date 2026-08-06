export interface ActiveDateOptions {
  /** Portal takvimi bugünü randevu günü olarak seçtirmez — varsayılan true */
  excludeToday?: boolean;
  /** Test / sabit referans günü (yyyy-MM-dd) */
  todayIso?: string;
}

export interface ActiveDateResult {
  activeDates: string[];
  bookableStart: string;
  /** Portal takviminde son seçilebilir gün (maxDate hariç) */
  bookableEnd: string;
  /** bookableStart..bookableEnd aralığında kapalı olan günler */
  closedInRange: string[];
}

export function formatIsoDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysIso(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T12:00:00`);
  base.setDate(base.getDate() + days);
  return formatIsoDateLocal(base);
}

/** Portal / API tarih string'lerini yyyy-MM-dd formatına çevirir. */
export function normalizeDateIso(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : formatIsoDateLocal(parsed);
  }

  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    for (const key of ["date", "closedDate", "isoDate", "appointmentDate"]) {
      if (key in row) {
        return normalizeDateIso(row[key]);
      }
    }
    if (
      typeof row.year === "number" &&
      typeof row.month === "number" &&
      typeof row.day === "number"
    ) {
      return `${row.year}-${String(row.month).padStart(2, "0")}-${String(row.day).padStart(2, "0")}`;
    }
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const isoPrefix = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoPrefix) {
    return isoPrefix[1];
  }

  const dotted = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotted) {
    return `${dotted[3]}-${dotted[2]}-${dotted[1]}`;
  }

  const slashed = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashed) {
    return `${slashed[3]}-${slashed[2]}-${slashed[1]}`;
  }

  return null;
}

export function normalizeClosedDates(closedDates: unknown[]): string[] {
  const normalized = closedDates
    .map((value) => normalizeDateIso(value))
    .filter((value): value is string => Boolean(value));

  return [...new Set(normalized)].sort();
}

/** yyyy-MM-dd aralığındaki tüm günler (başlangıç ve bitiş dahil). */
export function listDatesInRange(startIso: string, endIso: string): string[] {
  if (startIso > endIso) {
    return [];
  }

  const dates: string[] = [];
  const cursor = new Date(`${startIso}T12:00:00`);
  const end = new Date(`${endIso}T12:00:00`);

  while (cursor <= end) {
    dates.push(formatIsoDateLocal(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

/**
 * Portal minDate mantığı: bugün randevu günü değil → yarın veya API date hangisi sonra ise.
 */
export function resolveBookableStart(
  rangeStartIso: string,
  options?: ActiveDateOptions,
): string {
  const today = options?.todayIso ?? formatIsoDateLocal(new Date());
  const excludeToday = options?.excludeToday !== false;

  if (!excludeToday) {
    return rangeStartIso > today ? rangeStartIso : today;
  }

  const earliestBookable = addDaysIso(today, 1);
  return rangeStartIso > earliestBookable ? rangeStartIso : earliestBookable;
}

/** Portal weekDays — Cumartesi/Pazar takvimde kapalı. */
export function filterPortalWeekdays(isoDates: string[]): string[] {
  return isoDates.filter((isoDate) => {
    const day = new Date(`${isoDate}T12:00:00`).getDay();
    return day !== 0 && day !== 6;
  });
}

/**
 * Portal GetClosedDate maxDate — fallback formül (AdminDatas alınamazsa).
 * Birincil kaynak: GET AdminDatas/GetDatasById?id=2329 → dataType=MaxAppointmentDate, name=yyyy-MM-dd
 * DevTools: date=2026-08-06 → AdminDatas name=2026-09-01
 */
export function resolvePortalGetClosedDateMaxDate(rangeStartIso: string): string {
  const base = new Date(`${rangeStartIso}T12:00:00`);
  base.setMonth(base.getMonth() + 1, 1);
  return formatIsoDateLocal(base);
}

/** İki yyyy-MM-dd arası gün farkı (end − start). */
export function daysBetweenIso(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T12:00:00`);
  const end = new Date(`${endIso}T12:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** GetClosedDate sorgu penceresi — maxDate − date (gün). */
export function resolveClosedDateRangeDays(date: string, maxDate: string): number {
  return Math.max(0, daysBetweenIso(date, maxDate));
}

/**
 * GetClosedDate maxDate sorgu üst sınırıdır — portal takviminde son gün dahil değil.
 */
export function resolveBookableEnd(rangeEndIso: string, bookableStart: string): string {
  if (rangeEndIso <= bookableStart) {
    return rangeEndIso;
  }
  return addDaysIso(rangeEndIso, -1);
}

export interface CalendarDateResult {
  /** Sorgu penceresi içinde API allowedDates ile kesişen günler */
  allowedInRange: string[];
  /** Sorgu penceresinde allowedDates dışında kalan günler */
  closedInRange: string[];
  bookableStart: string;
  bookableEnd: string;
}

/**
 * GetClosedDate ham dizisi portalda kapalı günler (disabledDates) olarak kullanılır.
 * Seçilebilir günler = sorgu penceresi − kapalı liste.
 * (bookableEnd = maxDate − 1 gün)
 */
export function computeCalendarDatesFromAllowed(
  rangeStartIso: string,
  rangeEndIso: string,
  allowedDates: unknown[],
  options?: ActiveDateOptions,
): CalendarDateResult {
  const normalizedAllowed = normalizeClosedDates(allowedDates);
  const allowedSet = new Set(normalizedAllowed);
  const bookableStart = resolveBookableStart(rangeStartIso, options);
  const bookableEnd = resolveBookableEnd(rangeEndIso, bookableStart);

  const allowedInRange: string[] = [];
  const closedInRange: string[] = [];

  if (bookableStart > bookableEnd) {
    return { allowedInRange, closedInRange, bookableStart, bookableEnd };
  }

  for (const date of listDatesInRange(bookableStart, bookableEnd)) {
    if (allowedSet.has(date)) {
      allowedInRange.push(date);
    } else {
      closedInRange.push(date);
    }
  }

  const afterMonthRule = applyFullyClosedMonthRule(
    allowedInRange,
    closedInRange,
    bookableStart,
    bookableEnd,
  );

  return applyWeekendAsClosed(
    afterMonthRule.allowedInRange,
    afterMonthRule.closedInRange,
    afterMonthRule.bookableStart,
    afterMonthRule.bookableEnd,
  );
}

function applyWeekendAsClosed(
  allowedInRange: string[],
  closedInRange: string[],
  bookableStart: string,
  bookableEnd: string,
): CalendarDateResult {
  const weekdayAllowed = filterPortalWeekdays(allowedInRange);
  const weekendDays = allowedInRange.filter((date) => !weekdayAllowed.includes(date));
  const closedSet = new Set([...closedInRange, ...weekendDays]);

  return {
    allowedInRange: weekdayAllowed,
    closedInRange: [...closedSet].sort(),
    bookableStart,
    bookableEnd,
  };
}

/**
 * Ay sınırında API tek gün döndürebilir (örn. 1 Eylül) ama o ayın devamı kapalıdır —
 * portal takviminde tüm ay gri. Son seçilebilir günden sonra kapalı gün varsa o aydaki
 * tüm seçilebilir günleri kaldır (tüm Eylül kapalı).
 */
export function applyFullyClosedMonthRule(
  allowedInRange: string[],
  closedInRange: string[],
  bookableStart: string,
  bookableEnd: string,
): CalendarDateResult {
  if (bookableStart > bookableEnd) {
    return { allowedInRange, closedInRange, bookableStart, bookableEnd };
  }

  const allInRange = listDatesInRange(bookableStart, bookableEnd);
  const allowedSet = new Set(allowedInRange);
  const closedSet = new Set(closedInRange);
  const months = [...new Set(allInRange.map((date) => date.slice(0, 7)))].sort();

  for (const month of months) {
    const daysInMonth = allInRange.filter((date) => date.startsWith(`${month}-`));
    const allowedInMonth = daysInMonth.filter((date) => allowedSet.has(date));
    const closedInMonth = daysInMonth.filter((date) => !allowedSet.has(date));

    if (allowedInMonth.length === 0 || closedInMonth.length === 0) {
      continue;
    }

    const lastAllowed = [...allowedInMonth].sort().at(-1)!;
    const hasClosedAfterLastAllowed = closedInMonth.some((date) => date > lastAllowed);

    if (hasClosedAfterLastAllowed) {
      for (const day of allowedInMonth) {
        allowedSet.delete(day);
        closedSet.add(day);
      }
    }
  }

  return {
    allowedInRange: [...allowedSet].sort(),
    closedInRange: [...closedSet].sort(),
    bookableStart,
    bookableEnd,
  };
}

/**
 * @deprecated computeCalendarDatesFromAllowed kullanın — eski kapalı-liste tersi mantığı.
 */
export function computeActiveDates(
  rangeStartIso: string,
  rangeEndIso: string,
  closedDates: unknown[],
  options?: ActiveDateOptions,
): ActiveDateResult {
  const normalizedClosed = normalizeClosedDates(closedDates);
  const closedSet = new Set(normalizedClosed);
  const bookableStart = resolveBookableStart(rangeStartIso, options);
  const bookableEnd = resolveBookableEnd(rangeEndIso, bookableStart);

  const activeDates: string[] = [];
  const closedInRange: string[] = [];

  if (bookableStart > bookableEnd) {
    return { activeDates, bookableStart, bookableEnd, closedInRange };
  }

  for (const date of listDatesInRange(bookableStart, bookableEnd)) {
    if (closedSet.has(date)) {
      closedInRange.push(date);
      continue;
    }
    activeDates.push(date);
  }

  return { activeDates, bookableStart, bookableEnd, closedInRange };
}

/** @deprecated computeActiveDates kullanın */
export function computeOpenDates(
  startIso: string,
  endIso: string,
  closedDates: string[],
): string[] {
  return computeActiveDates(startIso, endIso, closedDates).activeDates;
}
