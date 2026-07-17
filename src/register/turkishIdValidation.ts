/** Türkiye Cumhuriyeti Kimlik Numarası (TCKN) doğrulama ve üretim. */

function parseTcknDigits(value: string): number[] | null {
  const trimmed = value.trim();
  if (!/^\d{11}$/.test(trimmed)) {
    return null;
  }
  return trimmed.split("").map((char) => Number.parseInt(char, 10));
}

/** TCKN algoritmasına göre geçerli mi (11 hane + kontrol basamakları). */
export function isValidTckn(value: string): boolean {
  const digits = parseTcknDigits(value);
  if (!digits) {
    return false;
  }

  if (digits[0] === 0) {
    return false;
  }

  const oddSum = digits[0]! + digits[2]! + digits[4]! + digits[6]! + digits[8]!;
  const evenSum = digits[1]! + digits[3]! + digits[5]! + digits[7]!;
  const digit10 = (oddSum * 7 - evenSum) % 10;
  const digit11 = digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10;

  return digits[9] === digit10 && digits[10] === digit11;
}

/** İlk 9 haneden geçerli TCKN üretir (10. ve 11. hane hesaplanır). */
export function buildValidTcknFromNineDigits(firstNine: string): string {
  if (!/^[1-9]\d{8}$/.test(firstNine)) {
    throw new Error("TCKN ilk 9 hane 1-9 ile başlamalı ve 9 rakam olmalı.");
  }

  const digits = firstNine.split("").map((char) => Number.parseInt(char, 10));
  const oddSum = digits[0]! + digits[2]! + digits[4]! + digits[6]! + digits[8]!;
  const evenSum = digits[1]! + digits[3]! + digits[5]! + digits[7]!;
  const digit10 = (oddSum * 7 - evenSum) % 10;
  const digit11 = (digits.reduce((sum, digit) => sum + digit, 0) + digit10) % 10;

  return `${firstNine}${digit10}${digit11}`;
}

/**
 * Türk pasaport numarası — 1 harf + 7–10 rakam (toplam 8–11 karakter).
 * Örnek: U12345678
 */
export function isValidTurkishPassportNo(value: string): boolean {
  const trimmed = value.trim().toUpperCase();
  if (trimmed.length < 8 || trimmed.length > 11) {
    return false;
  }
  if (!/^[A-Z]\d{7,10}$/.test(trimmed)) {
    return false;
  }
  if (/^(\d)\1+$/.test(trimmed.slice(1))) {
    return false;
  }
  return true;
}

/** Demo kayıt — algoritmaya uygun sahte TCKN (12345678950). */
export const DEMO_VALID_TCKN = buildValidTcknFromNineDigits("123456789");

/** Demo kayıt — geçerli pasaport formatı. */
export const DEMO_VALID_PASSPORT_NO = "U12345678";
