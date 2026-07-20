import CryptoJS from "crypto-js";

import { logger } from "../../utils/logger.js";

/** Portal appointmentRequestDto / index.vue — sabit AES anahtarı ve IV */
const PORTAL_AES_KEY = CryptoJS.enc.Utf8.parse("aRöÜ@9/*½&7&$£]_?/ç");
const PORTAL_AES_IV = CryptoJS.enc.Utf8.parse("0000000000000000");

/**
 * Kozmos portal API şifreli yanıtlarını çözer.
 * GetClosedDate, GetAppointmentHourQoutaInfo ve benzeri endpoint'ler aynı anahtarı kullanır.
 */
export function decryptPortalResponse(encryptedData: string): string | null {
  const trimmed = encryptedData.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const decrypted = CryptoJS.AES.decrypt(trimmed, PORTAL_AES_KEY, {
      iv: PORTAL_AES_IV,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });

    const decryptedStr = decrypted.toString(CryptoJS.enc.Utf8);
    if (!decryptedStr) {
      return null;
    }

    return decryptedStr;
  } catch (error) {
    logger.debug(
      `[decryptPortalResponse] AES decrypt hatası: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Şifreli string veya düz JSON/object yanıtı parse eder.
 */
export function parseDecryptedJson<T = unknown>(encryptedOrPlain: unknown): T | unknown {
  if (encryptedOrPlain === null || encryptedOrPlain === undefined) {
    return encryptedOrPlain;
  }

  if (typeof encryptedOrPlain === "string") {
    const trimmed = encryptedOrPlain.trim();

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed) as T;
      } catch {
        return encryptedOrPlain;
      }
    }

    const decrypted = decryptPortalResponse(trimmed);
    if (decrypted) {
      try {
        return JSON.parse(decrypted) as T;
      } catch {
        return decrypted;
      }
    }

    return encryptedOrPlain;
  }

  if (typeof encryptedOrPlain === "object" && !Array.isArray(encryptedOrPlain)) {
    const record = encryptedOrPlain as Record<string, unknown>;
    const cipherText =
      record.data ??
      record.result ??
      record.payload ??
      record.cipherText ??
      record.encryptedData;

    if (typeof cipherText === "string") {
      return parseDecryptedJson<T>(cipherText);
    }
  }

  return encryptedOrPlain;
}
