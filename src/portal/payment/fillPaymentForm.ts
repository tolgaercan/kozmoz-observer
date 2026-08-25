import type { Page } from "playwright";

import { humanTypeIntoLocator } from "../../interaction/humanType.js";
import {
  resolvePortalPaymentData,
  type PortalPaymentData,
} from "../../profiles/profileCredentials.js";
import type { ResolvedProfile } from "../../profiles/profileManager.js";
import { validateWorkerPaymentParams } from "../../control-panel/workerPaymentValidation.js";
import { logger } from "../../utils/logger.js";
import { PAYMENT_FORM_SELECTORS, PAYMENT_PAGE_MARKERS } from "./paymentFormSelectors.js";

export interface FillPaymentFormOptions {
  profile: ResolvedProfile;
  /** Panel override — test / tek alan */
  payment?: Partial<PortalPaymentData>;
  /** «Ödemeyi Tamamla» tıkla (varsayılan false — yalnızca doldur) */
  clickSubmit?: boolean;
  detectTimeoutMs?: number;
  submitWaitMs?: number;
}

export interface FillPaymentFormResult {
  ok: boolean;
  detected: boolean;
  filled: boolean;
  submitted: boolean;
  reason?: string;
}

function formatCardNumberForInput(digits: string): string {
  const normalized = digits.replace(/\D/g, "");
  return normalized.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

/** 5321234567 → 0 (532) 123-4567 */
export function formatPaymentPhoneForInput(digits10: string): string {
  const digits = digits10.replace(/\D/g, "");
  if (digits.length !== 10) {
    return digits;
  }
  return `0 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function maskCardNumber(digits: string): string {
  const normalized = digits.replace(/\D/g, "");
  if (normalized.length <= 4) {
    return "****";
  }
  return `****${normalized.slice(-4)}`;
}

export async function isPaymentPageVisible(
  page: Page,
  timeoutMs = 800,
): Promise<boolean> {
  for (const selector of PAYMENT_PAGE_MARKERS) {
    try {
      if (await page.locator(selector).first().isVisible({ timeout: timeoutMs })) {
        return true;
      }
    } catch {
      // sonraki
    }
  }
  return false;
}

async function fillTextField(
  page: Page,
  selector: string,
  value: string,
  label: string,
  maskLog?: (raw: string) => string,
): Promise<void> {
  const input = page.locator(selector).first();
  await input.waitFor({ state: "visible", timeout: 12_000 });
  const current = (await input.inputValue().catch(() => "")).trim();
  if (current === value.trim()) {
    logger.info(`[payment] ${label} zaten dolu (${maskLog ? maskLog(value) : label}).`);
    return;
  }
  await humanTypeIntoLocator(page, input, value, {
    label,
    minCharDelayMs: 45,
    maxCharDelayMs: 110,
    clearBeforeType: true,
  });
  logger.info(`[payment] ${label} yazıldı (${maskLog ? maskLog(value) : label}).`);
}

async function selectOptionValue(
  page: Page,
  selector: string,
  value: string,
  label: string,
): Promise<void> {
  const select = page.locator(selector).first();
  await select.waitFor({ state: "visible", timeout: 12_000 });
  const current = (await select.inputValue().catch(() => "")).trim();
  if (current === value) {
    logger.info(`[payment] ${label} zaten seçili (${value}).`);
    return;
  }
  await select.selectOption({ value });
  logger.info(`[payment] ${label} seçildi: ${value}`);
}

async function clickSubmitWhenEnabled(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  const button = page.locator(PAYMENT_FORM_SELECTORS.submitButton).first();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      if (!(await button.isVisible({ timeout: 300 }))) {
        await page.waitForTimeout(250);
        continue;
      }
      if (await button.isDisabled()) {
        await page.waitForTimeout(250);
        continue;
      }
      await button.click({ timeout: 8000 });
      logger.info("[payment] «Ödemeyi Tamamla» tıklandı.");
      return true;
    } catch {
      await page.waitForTimeout(250);
    }
  }

  return false;
}

/** Form dolu varsayımıyla submit — yeniden doldurma yok */
export async function submitPaymentFormWhenReady(
  page: Page,
  timeoutMs = 20_000,
): Promise<boolean> {
  return clickSubmitWhenEnabled(page, timeoutMs);
}

/**
 * Ödeme sayfası kart formunu panel verisiyle doldurur.
 * Tek sorumluluk: alanları doldurmak (submit opsiyonel).
 */
export async function fillPaymentForm(
  page: Page,
  options: FillPaymentFormOptions,
): Promise<FillPaymentFormResult> {
  const detectTimeoutMs = options.detectTimeoutMs ?? 800;

  if (!(await isPaymentPageVisible(page, detectTimeoutMs))) {
    return {
      ok: false,
      detected: false,
      filled: false,
      submitted: false,
      reason: "Ödeme sayfası görünür değil",
    };
  }

  const data = {
    ...resolvePortalPaymentData(options.profile),
    ...options.payment,
  };

  const validation = validateWorkerPaymentParams({
    cardNumber: data.cardNumber,
    cardholderName: data.cardholderName,
    expireMonth: data.expireMonth,
    expireYear: data.expireYear,
    cvv: data.cvv,
    email: data.email,
    phone: data.phone,
  });

  if (!validation.ok) {
    return {
      ok: false,
      detected: true,
      filled: false,
      submitted: false,
      reason: validation.errors.join("; "),
    };
  }

  logger.info(
    `[payment] Form dolduruluyor — profil=${options.profile.id}, kart=${maskCardNumber(data.cardNumber)}`,
  );

  try {
    await fillTextField(
      page,
      PAYMENT_FORM_SELECTORS.cardNumber,
      formatCardNumberForInput(data.cardNumber),
      "Kart numarası",
      maskCardNumber,
    );
    await fillTextField(
      page,
      PAYMENT_FORM_SELECTORS.cardholderName,
      data.cardholderName,
      "Kart sahibi",
    );
    await selectOptionValue(
      page,
      PAYMENT_FORM_SELECTORS.expireMonth,
      data.expireMonth,
      "SKT ay",
    );
    await selectOptionValue(
      page,
      PAYMENT_FORM_SELECTORS.expireYear,
      data.expireYear,
      "SKT yıl",
    );
    await fillTextField(page, PAYMENT_FORM_SELECTORS.cvv, data.cvv, "CVV", () => "***");
    await fillTextField(page, PAYMENT_FORM_SELECTORS.email, data.email, "E-posta");
    await fillTextField(
      page,
      PAYMENT_FORM_SELECTORS.phone,
      formatPaymentPhoneForInput(data.phone),
      "Telefon",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[payment] Doldurma hatası: ${message}`);
    return {
      ok: false,
      detected: true,
      filled: false,
      submitted: false,
      reason: message,
    };
  }

  let submitted = false;
  if (options.clickSubmit) {
    submitted = await clickSubmitWhenEnabled(page, options.submitWaitMs ?? 20_000);
    if (!submitted) {
      return {
        ok: false,
        detected: true,
        filled: true,
        submitted: false,
        reason: "Ödemeyi Tamamla butonu etkinleşmedi veya tıklanamadı",
      };
    }
  }

  return {
    ok: true,
    detected: true,
    filled: true,
    submitted,
  };
}
