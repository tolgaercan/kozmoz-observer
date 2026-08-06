export interface ApiAvailabilitySummaryInput {
  profileId: string;
  cityLabel?: string;
  appointmentStyleLabel?: string;
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

/** Telegram: yalnızca gün listesi; boşsa "0". */
export function buildApiDatesOnlySummary(dates: string[]): string {
  const sorted = [...dates].sort();
  if (sorted.length === 0) {
    return "0";
  }
  return sorted.join("\n");
}

export function buildApiClosedDateStatusSummary(input: ApiAvailabilitySummaryInput): string {
  return buildApiDatesOnlySummary(input.allowedDates);
}

export function buildApiNewlyOpenedDaysSummary(input: ApiAvailabilitySummaryInput): string {
  const opened = input.newlyOpenedDates ?? [];
  if (opened.length === 0) {
    return buildApiClosedDateStatusSummary(input);
  }
  return buildApiDatesOnlySummary(opened);
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
