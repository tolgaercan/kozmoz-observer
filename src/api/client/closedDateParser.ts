import { normalizeDateIso } from "./availabilityDates.js";
import { parseDecryptedJson } from "./decryptResponse.js";
import { logger } from "../../utils/logger.js";

export interface ParsedClosedDates {
  hasOpenSlots: boolean;
  summary: string;
  closedDates: string[];
  raw: unknown;
}

function extractClosedDates(decoded: unknown): string[] {
  if (Array.isArray(decoded)) {
    const normalized = decoded
      .map((item) => normalizeDateIso(item))
      .filter((value): value is string => Boolean(value));

    return [...new Set(normalized)].sort();
  }

  if (decoded && typeof decoded === "object") {
    const record = decoded as Record<string, unknown>;
    const list =
      record.closedDates ??
      record.dates ??
      record.data ??
      record.result ??
      record.items;
    if (Array.isArray(list)) {
      return extractClosedDates(list);
    }
  }

  return [];
}

function summarizeAvailability(decoded: unknown, closedDates: string[]): ParsedClosedDates {
  if (typeof decoded === "object" && decoded !== null && !Array.isArray(decoded)) {
    const record = decoded as Record<string, unknown>;
    for (const key of ["isOpen", "open", "available", "hasAvailable"]) {
      if (typeof record[key] === "boolean") {
        return {
          hasOpenSlots: record[key] as boolean,
          summary: `boolean ${key}=${String(record[key])}`,
          closedDates,
          raw: decoded,
        };
      }
    }
  }

  return {
    hasOpenSlots: false,
    summary:
      closedDates.length > 0
        ? `${closedDates.length} kapalı gün`
        : "Kapalı gün listesi boş veya çözülemedi",
    closedDates,
    raw: decoded,
  };
}

/**
 * GetClosedDate yanıtını çözer — portal index.vue ile aynı AES-256-CBC anahtarı.
 * @param encryptedData API yanıtı (şifreli string, { data: "..." } veya düz JSON)
 * @param _bearerJwt Geriye dönük uyumluluk; artık kullanılmıyor
 */
export function parseResponse(encryptedData: unknown, _bearerJwt?: string): ParsedClosedDates {
  const decoded = parseDecryptedJson(encryptedData);

  if (decoded === encryptedData && typeof encryptedData === "string") {
    logger.debug("[parseResponse] Şifre çözme başarısız veya düz metin yanıt.");
  } else if (decoded !== encryptedData) {
    logger.debug("[parseResponse] Portal AES decrypt başarılı.");
  }

  const closedDates = extractClosedDates(decoded);
  return summarizeAvailability(decoded, closedDates);
}

/** @deprecated parseResponse kullanın */
export function parseClosedDateResponse(body: unknown): {
  hasOpenSlots: boolean;
  summary: string;
} {
  const parsed = parseResponse(body);
  return { hasOpenSlots: parsed.hasOpenSlots, summary: parsed.summary };
}
