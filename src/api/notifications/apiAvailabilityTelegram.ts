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
  });
}

export interface ApiAvailabilitySummaryInput {
  profileId: string;
  cityLabel?: string;
  appointmentStyleLabel?: string;
  queryDate: string;
  queryMaxDate: string;
  rangeDays: number;
  bookableStart: string;
  bookableEnd?: string;
  maxDate: string;
  /** Sorgu penceresinde seçilebilir günler (API allowedDates) */
  allowedDates: string[];
  /** Sorgu penceresinde kapalı günler (hesaplanan) */
  closedDates: string[];
  /** allowedDates listesine yeni eklenen günler */
  newlyOpenedDates?: string[];
  hasAllowedListChange?: boolean;
}

const ALLOWED_DATE_NOTE =
  "Not: Liste API whitelist + hafta içi filtresi. Saat kotası olmayan günler takvimde gri kalabilir.";

const MAX_DATES_IN_MESSAGE = 60;

function formatDateLines(dates: string[], emptyLabel: string): string[] {
  if (dates.length === 0) {
    return [emptyLabel];
  }

  const sorted = [...dates].sort();
  const visible = sorted.slice(0, MAX_DATES_IN_MESSAGE);
  const lines = visible.map(
    (isoDate) => `• ${isoDate} (${formatTurkishDate(isoDate)})`,
  );

  if (sorted.length > visible.length) {
    lines.push(`… ve ${sorted.length - visible.length} gün daha`);
  }

  return lines;
}

function buildQueryWindowLines(input: ApiAvailabilitySummaryInput): string[] {
  const rangeEnd = input.bookableEnd ?? input.maxDate;
  return [
    `Sorgu penceresi: ${input.bookableStart} → ${rangeEnd}`,
    `(Her poll: date=${input.queryDate}, maxDate=${input.queryMaxDate} — bugün + ${input.rangeDays} gün)`,
  ];
}

/** Periyodik durum — seçilebilir gün listesi (API allowedDates). */
export function buildApiClosedDateStatusSummary(input: ApiAvailabilitySummaryInput): string {
  const styleLine = input.appointmentStyleLabel
    ? `${input.appointmentStyleLabel} (${input.profileId})`
    : input.profileId;
  const cityLine = input.cityLabel ? ` — ${input.cityLabel}` : "";
  const header = `API seçilebilir günler${cityLine} — ${styleLine}`;

  const lines = [
    header,
    ...buildQueryWindowLines(input),
    "",
    `Seçilebilir (API, hafta içi): ${input.allowedDates.length} gün`,
    `Kapalı (hesaplanan): ${input.closedDates.length} gün`,
    input.hasAllowedListChange === false ? "Son değişiklik: yok" : "",
    "",
    "Seçilebilir günler:",
    ...formatDateLines(input.allowedDates, "(API seçilebilir gün döndürmedi)"),
    "",
    ALLOWED_DATE_NOTE,
    "YENİ açılış = seçilebilir listesine eklenen gün.",
  ].filter((line) => line !== "");

  return lines.join("\n");
}

/** Seçilebilir listesine eklenen günler. */
export function buildApiNewlyOpenedDaysSummary(input: ApiAvailabilitySummaryInput): string {
  const styleLine = input.appointmentStyleLabel
    ? `${input.appointmentStyleLabel} (${input.profileId})`
    : input.profileId;
  const cityLine = input.cityLabel ? ` — ${input.cityLabel}` : "";
  const header = `API YENİ seçilebilir gün${cityLine} — ${styleLine}`;
  const opened = input.newlyOpenedDates ?? [];

  if (opened.length === 0) {
    return buildApiClosedDateStatusSummary(input);
  }

  const dayLines = opened.map(
    (isoDate) => `• ${isoDate} (${formatTurkishDate(isoDate)})`,
  );

  return [
    header,
    ...buildQueryWindowLines(input),
    "",
    "Seçilebilir listesine eklenen günler:",
    ...dayLines,
    "",
    `Toplam: ${opened.length} yeni gün`,
    `Seçilebilir (API, hafta içi): ${input.allowedDates.length} gün`,
    "",
    "Güncel seçilebilir günler:",
    ...formatDateLines(input.allowedDates, "(boş)"),
    "",
    "Portal takviminde ve saat kotasında doğrulayın.",
  ].join("\n");
}

/** @deprecated buildApiClosedDateStatusSummary / buildApiNewlyOpenedDaysSummary kullanın */
export function buildApiAvailabilityTextSummary(input: {
  profileId: string;
  cityLabel?: string;
  appointmentStyleLabel?: string;
  bookableStart: string;
  bookableEnd?: string;
  maxDate: string;
  activeDates: string[];
  closedDates: string[];
}): string {
  return buildApiClosedDateStatusSummary({
    profileId: input.profileId,
    cityLabel: input.cityLabel,
    appointmentStyleLabel: input.appointmentStyleLabel,
    queryDate: input.bookableStart,
    queryMaxDate: input.maxDate,
    rangeDays: 43,
    bookableStart: input.bookableStart,
    bookableEnd: input.bookableEnd,
    maxDate: input.maxDate,
    allowedDates: input.activeDates,
    closedDates: input.closedDates,
  });
}
