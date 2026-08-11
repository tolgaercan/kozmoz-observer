import type { WorkerApiParams } from "./workerConfigStore.js";

/** TR cep — başında 0 olmadan 10 hane (5XXXXXXXXX) */
export const OTP_PHONE_DIGIT_COUNT = 10;

export function normalizeOtpPhone(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

export function isValidOtpPhone(digits: string): boolean {
  return digits.length === OTP_PHONE_DIGIT_COUNT && /^5\d{9}$/.test(digits);
}

export function isValidPortalEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length >= 5 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function isValidTcKimlik(digits: string): boolean {
  return digits.length === 11 && /^\d{11}$/.test(digits);
}

export function isValidPassportNumber(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 32;
}

export interface WorkerApiValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateWorkerApiParams(api: WorkerApiParams): WorkerApiValidationResult {
  const errors: string[] = [];

  if (!api.dealerOffice?.trim()) {
    errors.push("Başvuru noktası (şube) seçilmeli");
  }
  if (!api.appointmentStyle?.trim()) {
    errors.push("Başvuru şekli seçilmeli");
  }
  if (!api.applicationType?.trim()) {
    errors.push("Başvuru tipi seçilmeli");
  }

  const tc = (api.nationalityNumber ?? "").replace(/\D/g, "");
  if (!isValidTcKimlik(tc)) {
    errors.push("TC Kimlik 11 hane olmalı");
  }

  const phone = normalizeOtpPhone(api.otpPhone ?? "");
  if (!isValidOtpPhone(phone)) {
    errors.push("OTP cep telefonu 10 hane olmalı (5 ile başlar, başında 0 yok)");
  }

  if (!isValidPortalEmail(api.portalEmail ?? "")) {
    errors.push("Geçerli bir e-posta adresi girilmeli");
  }

  if (!isValidPassportNumber(api.passportNumber ?? "")) {
    errors.push("Pasaport numarası girilmeli");
  }

  return { ok: errors.length === 0, errors };
}

export function sanitizeWorkerApiParams(api: WorkerApiParams): WorkerApiParams {
  return {
    ...api,
    dealerOffice: api.dealerOffice?.trim() ?? "",
    appointmentStyle: api.appointmentStyle?.trim() ?? "",
    applicationType: api.applicationType?.trim() ?? "",
    nationalityNumber: (api.nationalityNumber ?? "").replace(/\D/g, ""),
    otpPhone: normalizeOtpPhone(api.otpPhone ?? ""),
    portalEmail: api.portalEmail?.trim() ?? "",
    passportNumber: api.passportNumber?.trim() ?? "",
  };
}
