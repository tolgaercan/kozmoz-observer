import type { Page } from "playwright";

import { logger } from "../../utils/logger.js";
import { PAYMENT_FORM_SELECTORS, PAYMENT_FIELD_ERROR_SELECTORS } from "./paymentFormSelectors.js";
import { resolvePaymentFormRoot, resolvePaymentSubmitButton, type PaymentSearchRoot } from "./paymentPageDetect.js";

export interface PaymentFormAnalysis {
  submitEnabled: boolean;
  /** Doğrulama / hata mesajları (submit öncesi) */
  fieldErrors: string[];
  /** Bilgilendirme kutuları — pembe uyarı vb. (engel değil) */
  pageWarnings: string[];
  /** HTML5 :invalid alan id/name listesi */
  invalidFieldIds: string[];
  /** Submit disabled ise olası neden özeti */
  submitBlockedHint?: string;
}

export type PaymentOutcomeKind =
  | "still_on_form"
  | "three_ds"
  | "success"
  | "error"
  | "unknown";

export interface PaymentOutcome {
  kind: PaymentOutcomeKind;
  detail?: string;
  url?: string;
}

const FIELD_ERROR_SELECTORS = [
  ...PAYMENT_FIELD_ERROR_SELECTORS,
  ".invalid-feedback:visible",
  ".field-validation-error:visible",
  ".text-danger:visible",
  ".alert-danger:visible",
  "[role='alert']:visible",
] as const;

const PAGE_WARNING_SELECTORS = [
  ".alert-warning:visible",
  ".alert-info:visible",
  ".payment-notice:visible",
  ".notice-box:visible",
] as const;

const THREE_DS_TEXT_PATTERNS = [
  /3\s*d\s*secure/i,
  /3d\s*doğrulama/i,
  /banka\s*onay/i,
  /doğrulama\s*kodu/i,
  /\bacs\b/i,
  /sms\s*ile\s*onay/i,
  /güvenlik\s*kodu/i,
] as const;

const SUCCESS_TEXT_PATTERNS = [
  /ödemeniz\s*alın/i,
  /randevunuz\s*oluştur/i,
  /randevu\s*başarı/i,
  /işleminiz\s*tamamland/i,
  /payment\s*successful/i,
  /successfully\s*paid/i,
] as const;

const ERROR_TEXT_PATTERNS = [
  /ödeme\s*başarısız/i,
  /işlem\s*reddedildi/i,
  /kart.*geçersiz/i,
  /kart.*redded/i,
  /yetersiz\s*bakiye/i,
  /payment\s*failed/i,
  /declined/i,
] as const;

const THREE_DS_FRAME_SELECTORS = [
  "iframe[src*='3d' i]",
  "iframe[src*='secure' i]",
  "iframe[src*='acs' i]",
  "iframe[id*='3d' i]",
  "iframe[name*='3ds' i]",
  "iframe[name*='secure' i]",
] as const;

async function collectVisibleTexts(root: PaymentSearchRoot, selectors: readonly string[]): Promise<string[]> {
  const texts: string[] = [];

  for (const selector of selectors) {
    const locators = root.locator(selector);
    const count = await locators.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
      const text = (await locators.nth(index).innerText().catch(() => "")).trim();
      if (text && text.length <= 500) {
        texts.push(text.replace(/\s+/g, " "));
      }
    }
  }

  return [...new Set(texts)];
}

async function collectInvalidFields(root: PaymentSearchRoot): Promise<string[]> {
  return root.evaluate((selectors) => {
    const ids: string[] = [];
    for (const key of Object.keys(selectors)) {
      if (key === "submitButton") {
        continue;
      }
      const el = document.querySelector(selectors[key]!);
      if (!el) {
        continue;
      }
      const input = el as HTMLInputElement | HTMLSelectElement;
      if (!input.checkValidity?.()) {
        const label =
          input.id ||
          input.getAttribute("name") ||
          input.getAttribute("aria-label") ||
          key;
        const message = input.validationMessage?.trim();
        ids.push(message ? `${label}: ${message}` : label);
      }
    }
    return ids;
  }, PAYMENT_FORM_SELECTORS as Record<string, string>);
}

/** Alan blur — client-side doğrulamayı tetikler (submit tıklamadan). */
export async function triggerPaymentFormValidation(page: Page): Promise<void> {
  const root = (await resolvePaymentFormRoot(page)) ?? page;

  for (const [key, selector] of Object.entries(PAYMENT_FORM_SELECTORS)) {
    if (key === "submitButton") {
      continue;
    }
    const field = root.locator(selector).first();
    try {
      if (await field.isVisible({ timeout: 200 })) {
        await field.blur();
      }
    } catch {
      // yoksay
    }
  }

  try {
    await page.locator("body").click({ position: { x: 8, y: 8 }, timeout: 2000 });
  } catch {
    // yoksay
  }

  await page.waitForTimeout(700);
}

/**
 * Submit öncesi durum — «Ödemeyi Tamamla» tıklamadan uyarı/hata analizi.
 * 3D Secure submit SONRASI ortaya çıkar; bu analizde yalnızca form doğrulaması görülür.
 */
export async function analyzePaymentFormBeforeSubmit(page: Page): Promise<PaymentFormAnalysis> {
  await triggerPaymentFormValidation(page);

  const root = (await resolvePaymentFormRoot(page)) ?? page;
  const submit =
    (await resolvePaymentSubmitButton(root)) ??
    root.locator(PAYMENT_FORM_SELECTORS.submitButton).first();
  const submitEnabled = await submit.isEnabled().catch(() => false);

  const fieldErrors = [
    ...(await collectVisibleTexts(root, FIELD_ERROR_SELECTORS)),
    ...(await collectInvalidFields(root)),
  ];
  const uniqueErrors = [...new Set(fieldErrors.filter(Boolean))];

  const pageWarnings = await collectVisibleTexts(root, PAGE_WARNING_SELECTORS);

  const invalidFieldIds = await root.evaluate((selectors) => {
    const ids: string[] = [];
    for (const key of Object.keys(selectors)) {
      if (key === "submitButton") {
        continue;
      }
      const el = document.querySelector(selectors[key]!) as HTMLInputElement | HTMLSelectElement | null;
      if (el && !el.checkValidity?.()) {
        ids.push(el.id || el.name || key);
      }
    }
    return ids;
  }, PAYMENT_FORM_SELECTORS as Record<string, string>);

  let submitBlockedHint: string | undefined;
  if (!submitEnabled) {
    if (uniqueErrors.length > 0) {
      submitBlockedHint = uniqueErrors.slice(0, 3).join(" · ");
    } else if (invalidFieldIds.length > 0) {
      submitBlockedHint = `Geçersiz alanlar: ${invalidFieldIds.join(", ")}`;
    } else {
      submitBlockedHint =
        "Submit devre dışı — alanlar dolu görünse bile portal JS doğrulaması geçmedi (fatura alanı vb. kontrol edin)";
    }
  }

  logger.info(
    `[payment] Pre-submit analiz: submit=${submitEnabled ? "enabled" : "disabled"}, ` +
      `hata=${uniqueErrors.length}, uyarı=${pageWarnings.length}`,
  );

  if (uniqueErrors.length > 0) {
    logger.warn(`[payment] Pre-submit hatalar: ${uniqueErrors.slice(0, 4).join(" | ")}`);
  }
  if (pageWarnings.length > 0) {
    logger.info(`[payment] Pre-submit uyarılar: ${pageWarnings.slice(0, 2).join(" | ")}`);
  }
  if (submitBlockedHint && !submitEnabled) {
    logger.warn(`[payment] Submit engeli: ${submitBlockedHint}`);
  }

  return {
    submitEnabled,
    fieldErrors: uniqueErrors,
    pageWarnings,
    invalidFieldIds,
    submitBlockedHint,
  };
}

async function pageOrFrameMatchesPatterns(
  page: Page,
  patterns: readonly RegExp[],
): Promise<string | null> {
  try {
    const bodyText = await page.locator("body").innerText({ timeout: 1500 });
    for (const pattern of patterns) {
      if (pattern.test(bodyText)) {
        return pattern.source;
      }
    }
  } catch {
    // yoksay
  }

  for (const frame of page.frames()) {
    try {
      const text = await frame.locator("body").innerText({ timeout: 800 });
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          return `frame:${pattern.source}`;
        }
      }
    } catch {
      // cross-origin frame
    }
  }

  return null;
}

async function detectThreeDsSurface(page: Page): Promise<boolean> {
  for (const selector of THREE_DS_FRAME_SELECTORS) {
    try {
      if (await page.locator(selector).first().isVisible({ timeout: 200 })) {
        return true;
      }
    } catch {
      // sonraki
    }
  }

  const frameMatch = await pageOrFrameMatchesPatterns(page, THREE_DS_TEXT_PATTERNS);
  return frameMatch !== null;
}

async function isStillOnPaymentForm(page: Page): Promise<boolean> {
  const root = await resolvePaymentFormRoot(page);
  if (!root) {
    return false;
  }
  try {
    return await root.locator(PAYMENT_FORM_SELECTORS.cardNumber).first().isVisible({ timeout: 300 });
  } catch {
    return false;
  }
}

/** Submit sonrası — 3DS / başarı / hata ayrımı */
export async function detectPaymentOutcomeAfterSubmit(
  page: Page,
  timeoutMs = 12_000,
): Promise<PaymentOutcome> {
  const startedUrl = page.url();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await detectThreeDsSurface(page)) {
      logger.info("[payment] Post-submit: 3D Secure / banka onay yüzeyi algılandı — manuel adım.");
      return {
        kind: "three_ds",
        detail: "3D Secure veya banka doğrulama ekranı",
        url: page.url(),
      };
    }

    const successHit = await pageOrFrameMatchesPatterns(page, SUCCESS_TEXT_PATTERNS);
    if (successHit) {
      logger.info(`[payment] Post-submit: başarı sinyali (${successHit})`);
      return { kind: "success", detail: successHit, url: page.url() };
    }

    const errorHit = await pageOrFrameMatchesPatterns(page, ERROR_TEXT_PATTERNS);
    if (errorHit && !(await isStillOnPaymentForm(page))) {
      logger.warn(`[payment] Post-submit: hata sinyali (${errorHit})`);
      return { kind: "error", detail: errorHit, url: page.url() };
    }

    const onForm = await isStillOnPaymentForm(page);
    const formErrors = await collectVisibleTexts(page, FIELD_ERROR_SELECTORS);
    if (onForm && formErrors.length > 0) {
      logger.warn(`[payment] Post-submit: form hatası — ${formErrors.slice(0, 2).join(" | ")}`);
      return {
        kind: "error",
        detail: formErrors.slice(0, 3).join(" · "),
        url: page.url(),
      };
    }

    if (!onForm && page.url() !== startedUrl) {
      const maybeSuccess = await pageOrFrameMatchesPatterns(page, SUCCESS_TEXT_PATTERNS);
      if (maybeSuccess) {
        return { kind: "success", detail: maybeSuccess, url: page.url() };
      }
      if (await detectThreeDsSurface(page)) {
        return { kind: "three_ds", detail: "URL değişti — 3DS olası", url: page.url() };
      }
    }

    await page.waitForTimeout(450);
  }

  if (await detectThreeDsSurface(page)) {
    return { kind: "three_ds", detail: "Zaman aşımı sonrası 3DS yüzeyi", url: page.url() };
  }

  if (await isStillOnPaymentForm(page)) {
    return { kind: "still_on_form", detail: "Ödeme formu hâlâ açık", url: page.url() };
  }

  return { kind: "unknown", detail: "Sonuç belirlenemedi", url: page.url() };
}
