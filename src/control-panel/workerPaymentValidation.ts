import type { WorkerPaymentParams } from "./workerConfigStore.js";
import { isValidPortalEmail, normalizeOtpPhone, isValidOtpPhone } from "./workerApiValidation.js";

export function normalizeCardNumber(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

export function isValidCardNumber(digits: string): boolean {
  return digits.length >= 13 && digits.length <= 19;
}

export function isValidCvv(value: string): boolean {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 3 && digits.length <= 4;
}

export function isValidExpireMonth(value: string): boolean {
  return /^(0[1-9]|1[0-2])$/.test(value.trim());
}

export function isValidExpireYear(value: string): boolean {
  const year = Number.parseInt(value.trim(), 10);
  return Number.isFinite(year) && year >= 2026 && year <= 2040;
}

export interface WorkerPaymentValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateWorkerPaymentParams(
  payment: WorkerPaymentParams,
  options: { emailFallback?: string; phoneFallback?: string } = {},
): WorkerPaymentValidationResult {
  const errors: string[] = [];

  const cardNumber = normalizeCardNumber(payment.cardNumber ?? "");
  if (!isValidCardNumber(cardNumber)) {
    errors.push("Kart numarası 13–19 hane olmalı");
  }

  if (!payment.cardholderName?.trim()) {
    errors.push("Kart sahibi adı girilmeli");
  }

  if (!isValidExpireMonth(payment.expireMonth ?? "")) {
    errors.push("Son kullanma ayı seçilmeli (01–12)");
  }

  if (!isValidExpireYear(payment.expireYear ?? "")) {
    errors.push("Son kullanma yılı seçilmeli");
  }

  if (!isValidCvv(payment.cvv ?? "")) {
    errors.push("CVV 3 veya 4 hane olmalı");
  }

  const email = (payment.email?.trim() || options.emailFallback?.trim() || "");
  if (!isValidPortalEmail(email)) {
    errors.push("Geçerli kart sahibi e-postası girilmeli (veya Worker e-postası)");
  }

  const phoneDigits = normalizeOtpPhone(payment.phone ?? options.phoneFallback ?? "");
  if (!isValidOtpPhone(phoneDigits)) {
    errors.push("Kart sahibi telefonu 10 hane olmalı (5 ile başlar, başında 0 yok)");
  }

  return { ok: errors.length === 0, errors };
}

export function sanitizeWorkerPaymentParams(payment: WorkerPaymentParams): WorkerPaymentParams {
  const monthRaw = (payment.expireMonth ?? "").replace(/\D/g, "");
  const month =
    monthRaw.length === 1 ? `0${monthRaw}` : monthRaw.length === 2 ? monthRaw : monthRaw.slice(0, 2);

  return {
    cardNumber: normalizeCardNumber(payment.cardNumber ?? ""),
    cardholderName: payment.cardholderName?.trim() ?? "",
    expireMonth: month,
    expireYear: (payment.expireYear ?? "").replace(/\D/g, "").slice(0, 4),
    cvv: (payment.cvv ?? "").replace(/\D/g, ""),
    email: payment.email?.trim() ?? "",
    phone: normalizeOtpPhone(payment.phone ?? ""),
  };
}
