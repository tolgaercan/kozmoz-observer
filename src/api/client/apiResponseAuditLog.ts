import { logger } from "../../utils/logger.js";
import type { ApiQueryParams } from "./resolveApiQueryParams.js";
import { parseDecryptedJson } from "./decryptResponse.js";

const MAX_LIST_PREVIEW = 20;
const MAX_BODY_PREVIEW = 240;

function auditEnabled(): boolean {
  return process.env.API_RESPONSE_AUDIT_LOG !== "false";
}

function formatDateListPreview(dates: string[], maxItems = MAX_LIST_PREVIEW): string {
  if (dates.length === 0) {
    return "(bos)";
  }
  if (dates.length <= maxItems) {
    return dates.join(", ");
  }
  const head = dates.slice(0, Math.ceil(maxItems / 2));
  const tail = dates.slice(-Math.floor(maxItems / 2));
  return `${head.join(", ")} ... ${tail.join(", ")} (+${dates.length - maxItems} daha)`;
}

function describeRawBody(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return "bos";
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return `düz-json (len=${trimmed.length})`;
    }
    const decrypted = parseDecryptedJson(trimmed);
    const decryptOk = decrypted !== trimmed;
    if (Array.isArray(decrypted)) {
      return `cipher→dizi (len=${trimmed.length}, decrypt=${decryptOk ? "ok" : "fail"}, ${decrypted.length} öğe)`;
    }
    if (decrypted && typeof decrypted === "object") {
      const keys = Object.keys(decrypted as Record<string, unknown>).slice(0, 6);
      return `cipher→obj (len=${trimmed.length}, decrypt=${decryptOk ? "ok" : "fail"}, keys=${keys.join("|") || "?"})`;
    }
    return `metin (len=${trimmed.length}, decrypt=${decryptOk ? "ok" : "fail"})`;
  }

  if (Array.isArray(raw)) {
    return `dizi (${raw.length} öğe)`;
  }

  if (typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const keys = Object.keys(record).slice(0, 8);
    const nested =
      typeof record.data === "string"
        ? `, data=cipher(${record.data.length})`
        : typeof record.result === "string"
          ? `, result=cipher(${record.result.length})`
          : "";
    return `obj keys=[${keys.join(", ")}]${nested}`;
  }

  return typeof raw;
}

function bodyTextPreview(bodyText: string | undefined): string {
  if (!bodyText?.trim()) {
    return "(bos govde)";
  }
  const oneLine = bodyText.replace(/\s+/g, " ").trim();
  if (oneLine.length <= MAX_BODY_PREVIEW) {
    return oneLine;
  }
  return `${oneLine.slice(0, MAX_BODY_PREVIEW)}…`;
}

export interface GetClosedDateAuditInput {
  status: number;
  raw: unknown;
  queryParams: ApiQueryParams;
  closedDates: string[];
  closedInRange: string[];
  activeDates: string[];
  bookableStart: string;
  bookableEnd: string;
  retry?: boolean;
}

/** GetClosedDate yanıt özeti — hata ayıklama / SS karşılaştırma için. */
export function logGetClosedDateAudit(input: GetClosedDateAuditInput): void {
  if (!auditEnabled()) {
    return;
  }

  const tag = input.retry ? "retry" : "poll";
  const typeLabel = input.queryParams.appointmentStyleLabel ?? "?";
  logger.info(
    `[api-audit] GetClosedDate ${tag} HTTP ${input.status} — ` +
      `typeId=${input.queryParams.appointmentTypeId} (${typeLabel}) ` +
      `dealerId=${input.queryParams.dealerId} ` +
      `date=${input.queryParams.date} maxDate=${input.queryParams.maxDate}`,
  );
  logger.info(`[api-audit] GetClosedDate ham yanıt: ${describeRawBody(input.raw)}`);
  logger.info(
    `[api-audit] GetClosedDate kapalı (ham API): ${input.closedDates.length} — ${formatDateListPreview(input.closedDates)}`,
  );
  logger.info(
    `[api-audit] GetClosedDate aralık ${input.bookableStart} → ${input.bookableEnd} — ` +
      `kapalı=${input.closedInRange.length}, seçilebilir=${input.activeDates.length}`,
  );
  logger.info(
    `[api-audit] GetClosedDate kapalı (aralık): ${formatDateListPreview(input.closedInRange)}`,
  );
  logger.info(
    `[api-audit] GetClosedDate seçilebilir: ${formatDateListPreview(input.activeDates)}`,
  );

  if (input.activeDates.length === 0 && input.closedInRange.length > 0) {
    logger.warn(
      `[api-audit] GetClosedDate 0 seçilebilir — typeId=${input.queryParams.appointmentTypeId}, ` +
        `ham kapalı=${input.closedDates.length}, aralık kapalı=${input.closedInRange.length}`,
    );
  }
}

export function logGetClosedDateHttpFailure(
  status: number,
  raw: unknown,
  queryParams: ApiQueryParams,
  bodyText?: string,
  retry?: boolean,
): void {
  if (!auditEnabled()) {
    return;
  }

  const tag = retry ? "retry" : "poll";
  logger.warn(
    `[api-audit] GetClosedDate ${tag} HTTP ${status} — ` +
      `typeId=${queryParams.appointmentTypeId} dealerId=${queryParams.dealerId} ` +
      `date=${queryParams.date} maxDate=${queryParams.maxDate}`,
  );
  logger.warn(`[api-audit] GetClosedDate hata govdesi: ${bodyTextPreview(bodyText)}`);
  if (raw !== undefined && raw !== bodyText) {
    logger.warn(`[api-audit] GetClosedDate hata ham: ${describeRawBody(raw)}`);
  }
}

export interface HourQuotaAuditInput {
  status: number;
  raw: unknown;
  appointmentDate: string;
  queryParams: ApiQueryParams;
  hasAvailableHours: boolean;
  availableHours: string[];
  slotCount: number;
  summary: string;
}

/** GetAppointmentHourQoutaInfo yanıt özeti. */
export function logHourQuotaAudit(input: HourQuotaAuditInput): void {
  if (!auditEnabled()) {
    return;
  }

  logger.info(
    `[api-audit] HourQuota HTTP ${input.status} — gün=${input.appointmentDate} ` +
      `typeId=${input.queryParams.appointmentTypeId} dealerId=${input.queryParams.dealerId} — ${input.summary}`,
  );
  logger.info(`[api-audit] HourQuota ham yanıt: ${describeRawBody(input.raw)}`);
  logger.info(
    `[api-audit] HourQuota müsait saat (${input.availableHours.length}/${input.slotCount} slot): ` +
      `${input.availableHours.length > 0 ? input.availableHours.join(", ") : "(bos)"}`,
  );
}

export function logHourQuotaHttpFailure(
  status: number,
  appointmentDate: string,
  queryParams: ApiQueryParams,
  bodyText?: string,
): void {
  if (!auditEnabled()) {
    return;
  }

  logger.warn(
    `[api-audit] HourQuota HTTP ${status} — gün=${appointmentDate} ` +
      `typeId=${queryParams.appointmentTypeId} dealerId=${queryParams.dealerId}`,
  );
  logger.warn(`[api-audit] HourQuota hata govdesi: ${bodyTextPreview(bodyText)}`);
}
