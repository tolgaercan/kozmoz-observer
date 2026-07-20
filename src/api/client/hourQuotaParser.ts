import { normalizeDateIso } from "./availabilityDates.js";
import { parseDecryptedJson } from "./decryptResponse.js";

export interface HourQuotaSlot {
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

export interface ParsedHourQuota {
  appointmentDate: string;
  slots: HourQuotaSlot[];
  /** availableAppointmentCount > 0 olan saat etiketleri (ör. 11.30) */
  availableHours: string[];
  hasAvailableHours: boolean;
  summary: string;
  raw: unknown;
}

function readNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractHourSlots(decoded: unknown): HourQuotaSlot[] {
  if (!Array.isArray(decoded)) {
    return [];
  }

  return decoded
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const row = item as Record<string, unknown>;
      const date =
        normalizeDateIso(row.date) ??
        normalizeDateIso(row.appointmentDate) ??
        "";

      return {
        hourId: readNumber(row.appointmentHourId ?? row.hourId),
        hourLabel: readString(row.appointmentHourName ?? row.hourName ?? row.time),
        hourCode: readString(row.appointmentHourCode ?? row.hourCode),
        appointmentTypeId: readNumber(row.appointmentTypeId),
        dealerId: readNumber(row.dealerId),
        quotaCount: readNumber(row.qoutaCount ?? row.quotaCount),
        existingAppointmentCount: readNumber(row.existingAppointmentCount),
        availableAppointmentCount: readNumber(row.availableAppointmentCount),
        date,
      } satisfies HourQuotaSlot;
    })
    .filter((slot): slot is HourQuotaSlot => Boolean(slot?.hourLabel || slot?.hourId));
}

function summarizeHourQuota(
  slots: HourQuotaSlot[],
  appointmentDate: string,
  raw: unknown,
): ParsedHourQuota {
  const availableHours = [
    ...new Set(
      slots
        .filter((slot) => slot.availableAppointmentCount > 0)
        .map((slot) => slot.hourLabel)
        .filter(Boolean),
    ),
  ].sort();

  const summary =
    availableHours.length > 0
      ? `${appointmentDate}: ${availableHours.length} müsait saat (${availableHours.join(", ")})`
      : `${appointmentDate}: müsait saat yok (${slots.length} slot kaydı)`;

  return {
    appointmentDate,
    slots,
    availableHours,
    hasAvailableHours: availableHours.length > 0,
    summary,
    raw,
  };
}

/**
 * GetAppointmentHourQoutaInfo yanıtını çözer — portal ile aynı AES decrypt.
 *
 * Örnek çözülmüş yanıt:
 * [{ appointmentHourName: "11.30", availableAppointmentCount: 1, date: "2026-07-23T00:00:00", ... }]
 */
export function parseHourQuotaResponse(
  encryptedData: unknown,
  appointmentDate: string,
): ParsedHourQuota {
  const decoded = parseDecryptedJson(encryptedData);
  const slots = extractHourSlots(decoded);
  const resolvedDate =
    normalizeDateIso(appointmentDate) ??
    slots.find((slot) => slot.date)?.date ??
    appointmentDate;

  return summarizeHourQuota(slots, resolvedDate, decoded);
}

/** Parser doğrulama — kullanıcı örnek cipher (2026-07-23, EEA 11.30) */
export const HOUR_QUOTA_SAMPLE_CIPHER =
  "3OIXUU4Hd72WV5w0/3Ekc7NkMdKdYhkzDOxYb5+QGZ9/A08UriIqDHZD8McQAmu0anphvXFuOIm2XIlpPbiGMpkbkW/WodBKnoaMpazLtM8TOSRL8nYdIocI6L6FiqYzGH0uHDABID0CTUeezm+bJ0Hu04L1GlmNGW9awAaAibzB409BXK8MVEgCDqFKGkJ1mZt/vaL5zWYRmqLZUxDtbSoiRAlwtgdBs0PMttHRZ77quAzNTBDbawpNfFfDlRWhtv4sypTJRSg7Vqb9NSGhvheacCoj8d1Q1eQSkAhhmsS5W1fKQaIgALvkG5uf4jIqc4Txg+DOCDzdrXYqJujDmQ==";
