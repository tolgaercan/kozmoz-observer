export interface ApiAvailabilitySummaryInput {
  profileId: string;
  cityLabel?: string;
  appointmentStyleLabel?: string;
  appointmentTypeId?: string;
  queryDate: string;
  queryMaxDate: string;
  rangeDays: number;
  todayIso?: string;
  bookableStart: string;
  bookableEnd?: string;
  maxDate: string;
  allowedDates: string[];
  closedDates: string[];
  newlyOpenedDates?: string[];
  hasAllowedListChange?: boolean;
}

/** Telegram: boşsa "0", değilse her satırda bir tarih. */
export function buildApiDatesOnlySummary(dates: string[]): string {
  const sorted = [...dates].sort();
  if (sorted.length === 0) {
    return "0";
  }
  return sorted.join("\n");
}

/** Sorgu parametreleri — ek açıklama yok. */
export function buildApiQueryParamsHeader(input: ApiAvailabilitySummaryInput): string {
  const office = input.cityLabel?.trim() || "—";
  const style = input.appointmentStyleLabel?.trim() || "—";
  const typeId = input.appointmentTypeId?.trim() || "—";

  return [
    `profil: ${input.profileId}`,
    `ofis: ${office}`,
    `başvuru: ${style} (${typeId})`,
    `date: ${input.queryDate} · maxDate: ${input.queryMaxDate}`,
  ].join("\n");
}

export function buildApiClosedDateStatusSummary(input: ApiAvailabilitySummaryInput): string {
  const header = buildApiQueryParamsHeader(input);
  const dates = buildApiDatesOnlySummary(input.allowedDates);
  return `${header}\n\n${dates}`;
}

export function buildApiNewlyOpenedDaysSummary(input: ApiAvailabilitySummaryInput): string {
  const header = buildApiQueryParamsHeader(input);
  const opened = input.newlyOpenedDates ?? [];
  const dates =
    opened.length === 0
      ? buildApiDatesOnlySummary(input.allowedDates)
      : buildApiDatesOnlySummary(opened);
  return `${header}\n\n${dates}`;
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
  return buildApiDatesOnlySummary(input.activeDates);
}
