export interface ApiTokenRecord {
  authorization: string;
  capturedAt: string;
  source: "localStorage" | "sessionStorage" | "network" | "storage-file";
  profileId: string;
}

export interface ClosedDatePollResult {
  ok: boolean;
  status: number;
  hasOpenSlots: boolean;
  summary: string;
  raw?: unknown;
  /** GetClosedDate ham dizisi — portal allowedDates (seçilebilir günler) */
  allowedDates?: string[];
  /** Sorgu penceresinde allowedDates dışında kalan günler (hesaplanan) */
  closedDates?: string[];
  /** Portal takvimiyle uyumlu seçilebilir günler (allowedInRange) */
  activeDates?: string[];
  /** Geriye dönük alias — activeDates ile aynı */
  openDates?: string[];
  bookableStart?: string;
  bookableEnd?: string;
  closedInRange?: string[];
  unauthorized?: boolean;
  /** HTTP 429 — çok sık poll */
  rateLimited?: boolean;
}

export interface ApiWatcherHandle {
  stop: () => void;
}

export interface HourQuotaSlotResult {
  hourId: number;
  hourLabel: string;
  hourCode: string;
  appointmentTypeId: number;
  dealerId: number;
  quotaCount: number;
  existingAppointmentCount: number;
  availableAppointmentCount: number;
  date: string;
}

export interface HourQuotaPollResult {
  ok: boolean;
  status: number;
  hasAvailableHours: boolean;
  summary: string;
  appointmentDate?: string;
  availableHours?: string[];
  slots?: HourQuotaSlotResult[];
  raw?: unknown;
  /** API_HOUR_QUOTA_ENABLED=false — istek atılmadı */
  skipped?: boolean;
  unauthorized?: boolean;
  rateLimited?: boolean;
}
