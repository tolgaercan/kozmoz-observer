import type { Page } from "playwright";

import { humanTypeIntoLocator } from "../../interaction/humanType.js";
import { humanClickLocator } from "../../interaction/humanClick.js";
import {
  resolvePortalPaymentData,
  type PortalPaymentData,
} from "../../profiles/profileCredentials.js";
import type { ResolvedProfile } from "../../profiles/profileManager.js";
import { validateWorkerPaymentParams } from "../../control-panel/workerPaymentValidation.js";
import { logger } from "../../utils/logger.js";
import { PAYMENT_FORM_SELECTORS } from "./paymentFormSelectors.js";
import {
  isPaymentPageVisible,
  resolvePaymentFormRoot,
  resolvePaymentSubmitButton,
  type PaymentSearchRoot,
  waitForPaymentPage,
} from "./paymentPageDetect.js";
import { triggerPaymentFormValidation } from "./paymentFormAnalysis.js";

export { isPaymentPageVisible, waitForPaymentPage };

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

async function fillTextField(
  root: PaymentSearchRoot,
  selector: string,
  value: string,
  label: string,
  maskLog?: (raw: string) => string,
): Promise<void> {
  const input = root.locator(selector).first();
  await input.waitFor({ state: "visible", timeout: 12_000 });
  const page = input.page();
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
  root: PaymentSearchRoot,
  selector: string,
  value: string,
  label: string,
): Promise<void> {
  const select = root.locator(selector).first();
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
  root: PaymentSearchRoot,
  timeoutMs: number,
): Promise<boolean> {
  await triggerPaymentFormValidation(page);

  const deadline = Date.now() + timeoutMs;
  let lastDisabledLogAt = 0;

  while (Date.now() < deadline) {
    const button = await resolvePaymentSubmitButton(root);
    if (!button) {
      await page.waitForTimeout(300);
      continue;
    }

    const clickPage = button.page();

    try {
      await button.scrollIntoViewIfNeeded().catch(() => undefined);

      if (await button.isDisabled()) {
        const elapsed = Date.now() - deadline + timeoutMs;
        if (elapsed - lastDisabledLogAt >= 4000) {
          lastDisabledLogAt = elapsed;
          logger.info("[payment] «Ödemeyi Tamamla» henüz devre dışı — portal JS doğrulaması bekleniyor…");
        }
        await clickPage.waitForTimeout(350);
        continue;
      }

      await humanClickLocator(clickPage, button, {
        label: "Ödemeyi Tamamla",
        waitTimeoutMs: 8000,
      });
      logger.info("[payment] «Ödemeyi Tamamla / Complete Payment» tıklandı (#btnSubmit).");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[payment] Submit tıklama denemesi başarısız: ${message}`);
      await clickPage.waitForTimeout(350);
    }
  }

  logger.warn("[payment] Submit zaman aşımı — #btnSubmit etkinleşmedi veya tıklanamadı.");
  return false;
}

/** Form dolu varsayımıyla submit — yeniden doldurma yok */
export async function submitPaymentFormWhenReady(
  page: Page,
  timeoutMs = 30_000,
): Promise<boolean> {
  const root = await resolvePaymentFormRoot(page);
  if (!root) {
    return false;
  }
  return clickSubmitWhenEnabled(page, root, timeoutMs);
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

  const formRoot = await resolvePaymentFormRoot(page);
  if (!formRoot) {
    return {
      ok: false,
      detected: false,
      filled: false,
      submitted: false,
      reason: "Ödeme formu kökü bulunamadı (main/iframe)",
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
      formRoot,
      PAYMENT_FORM_SELECTORS.cardNumber,
      formatCardNumberForInput(data.cardNumber),
      "Kart numarası",
      maskCardNumber,
    );
    await fillTextField(
      formRoot,
      PAYMENT_FORM_SELECTORS.cardholderName,
      data.cardholderName,
      "Kart sahibi",
    );
    await selectOptionValue(
      formRoot,
      PAYMENT_FORM_SELECTORS.expireMonth,
      data.expireMonth,
      "SKT ay",
    );
    await selectOptionValue(
      formRoot,
      PAYMENT_FORM_SELECTORS.expireYear,
      data.expireYear,
      "SKT yıl",
    );
    await fillTextField(formRoot, PAYMENT_FORM_SELECTORS.cvv, data.cvv, "CVV", () => "***");
    await fillTextField(formRoot, PAYMENT_FORM_SELECTORS.email, data.email, "E-posta");
    await fillTextField(
      formRoot,
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
    await triggerPaymentFormValidation(page);
    submitted = await clickSubmitWhenEnabled(page, formRoot, options.submitWaitMs ?? 30_000);
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
