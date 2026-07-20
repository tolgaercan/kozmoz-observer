export interface ActiveDateOptions {
  /** Portal takvimi bugünü randevu günü olarak seçtirmez — varsayılan true */
  excludeToday?: boolean;
  /** Test / sabit referans günü (yyyy-MM-dd) */
  todayIso?: string;
}

export interface ActiveDateResult {
  activeDates: string[];
  bookableStart: string;
  /** bookableStart..maxDate aralığında kapalı olan günler */
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

/**
 * Portal takvimi ile uyumlu aktif günler:
 * bookableStart..maxDate aralığı − GetClosedDate kapalı listesi.
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

  const activeDates: string[] = [];
  const closedInRange: string[] = [];

  for (const date of listDatesInRange(bookableStart, rangeEndIso)) {
    if (closedSet.has(date)) {
      closedInRange.push(date);
      continue;
    }
    activeDates.push(date);
  }

  return { activeDates, bookableStart, closedInRange };
}

/** @deprecated computeActiveDates kullanın */
export function computeOpenDates(
  startIso: string,
  endIso: string,
  closedDates: string[],
): string[] {
  return computeActiveDates(startIso, endIso, closedDates).activeDates;
}
