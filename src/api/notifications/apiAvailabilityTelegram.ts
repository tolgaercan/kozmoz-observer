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
  bookableStart: string;
  maxDate: string;
  activeDates: string[];
  closedDates: string[];
}

export function buildApiAvailabilityTextSummary(input: ApiAvailabilitySummaryInput): string {
  const styleLine = input.appointmentStyleLabel
    ? `${input.appointmentStyleLabel} (${input.profileId})`
    : input.profileId;
  const cityLine = input.cityLabel ? ` — ${input.cityLabel}` : "";
  const header = `API müsait günler${cityLine} — ${styleLine}`;
  const rangeLine = `Aralık: ${input.bookableStart} → ${input.maxDate}`;

  if (input.activeDates.length === 0) {
    return [
      header,
      rangeLine,
      "",
      `Kapalı (API): ${input.closedDates.length} gün`,
      "",
      "Şu an seçilebilir aktif gün yok.",
    ].join("\n");
  }

  const lines = input.activeDates.map(
    (isoDate) => `• ${isoDate} (${formatTurkishDate(isoDate)})`,
  );

  return [
    header,
    rangeLine,
    "",
    ...lines,
    "",
    `Toplam: ${input.activeDates.length} aktif gün`,
    `Kapalı (API): ${input.closedDates.length} gün`,
  ].join("\n");
}
