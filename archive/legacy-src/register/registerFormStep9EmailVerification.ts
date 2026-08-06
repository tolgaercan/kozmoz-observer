import type { Locator, Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanClickLocator } from "../interaction/humanClick.js";
import { logger } from "../utils/logger.js";
import type { RegisterContactData } from "./registerContactData.js";
import { maskRegisterContact } from "./registerContactData.js";
import { normalizeRegisterPhone } from "./registerFormCatalogs.js";
import { ensureTextFieldValue } from "./registerFormFieldVerify.js";
import { isRegisterFormUrl } from "./registerFormWizardDetector.js";
import {
  countVerifiedLabels,
  isCreateFormButtonVisible,
  verifyRandevuIslemleriNavVisible,
  waitForManualFormCreateAndRandevuNav,
  waitForManualVerification,
} from "./registerFormVerificationGate.js";

function randomIn(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clickOptions(appointmentSettings: AppointmentSettings) {
  return {
    waitTimeoutMs: appointmentSettings.citySelectTimeoutMs,
    minStepDelayMs: appointmentSettings.minStepDelayMs,
    maxStepDelayMs: appointmentSettings.maxStepDelayMs,
    overshootProbability: appointmentSettings.overshootProbability,
  };
}

/** Kotaya takılmamak için varsayılan kapalı — açıkça true yapılmadıkça Kod Talep Et tıklanmaz. */
export function resolveRegisterEnableCodeRequest(
  options: { enableCodeRequest?: boolean } = {},
): boolean {
  if (options.enableCodeRequest !== undefined) {
    return options.enableCodeRequest;
  }
  const raw = process.env.REGISTER_ENABLE_CODE_REQUEST?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function activeWizardPane(page: Page): Locator {
  return page
    .locator(".wizard-tab-container:visible, div[role='tabpanel']:visible, .tab-pane.active")
    .first();
}

function visibleContactInputs(page: Page): Locator {
  const pane = activeWizardPane(page);
  return pane.locator(
    "input.form-control:visible:not([placeholder*='Kodu']):not([type='hidden']):not([type='date'])",
  );
}

async function resolveEmailInput(page: Page): Promise<Locator> {
  const pane = activeWizardPane(page);
  const named = pane.locator("input[name='eMail']").first();
  if (await named.isVisible({ timeout: 800 }).catch(() => false)) {
    return named;
  }

  const inputs = visibleContactInputs(page);
  const count = await inputs.count();
  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    const value = (await input.inputValue().catch(() => "")).trim();
    const type = ((await input.getAttribute("type")) ?? "text").toLowerCase();
    if (type === "email" || value.includes("@")) {
      return input;
    }
  }

  if (count > 0) {
    return inputs.first();
  }

  throw new Error("[register][step-9] Email alanı bulunamadı.");
}

async function resolvePhoneInput(page: Page): Promise<Locator> {
  const pane = activeWizardPane(page);

  for (const selector of [
    "input[name='phoneNumber']",
    "input[name='mobilePhone']",
    "input[name='phone']",
    "input[name='gsm']",
  ]) {
    const locator = pane.locator(selector).first();
    if (await locator.isVisible({ timeout: 600 }).catch(() => false)) {
      return locator;
    }
  }

  const inputs = visibleContactInputs(page);
  const count = await inputs.count();
  for (let i = count - 1; i >= 0; i--) {
    const input = inputs.nth(i);
    const value = (await input.inputValue().catch(() => "")).trim();
    if (value.includes("@")) {
      continue;
    }
    if (normalizeRegisterPhone(value).length >= 10) {
      return input;
    }
  }

  if (count >= 2) {
    return inputs.nth(1);
  }

  throw new Error("[register][step-9] Telefon alanı bulunamadı.");
}

async function resolveRequestCodeButton(page: Page, index: number): Promise<Locator | null> {
  const buttons = page.locator("button:has-text('Kod Talep Et')");
  const count = await buttons.count();
  if (count === 0) {
    return null;
  }
  const target = count > index ? buttons.nth(index) : buttons.last();
  if (await target.isVisible({ timeout: 800 }).catch(() => false)) {
    return target;
  }
  return null;
}

async function phoneFieldMatches(locator: Locator, expectedDigits: string): Promise<boolean> {
  const current = normalizeRegisterPhone((await locator.inputValue().catch(() => "")).trim());
  return current === normalizeRegisterPhone(expectedDigits);
}

async function emailFieldMatches(locator: Locator, expectedEmail: string): Promise<boolean> {
  const current = (await locator.inputValue().catch(() => "")).trim().toLowerCase();
  return current === expectedEmail.trim().toLowerCase();
}

async function ensurePhoneFieldValue(
  page: Page,
  locator: Locator,
  phoneDigits: string,
  fieldLabel: string,
  appointmentSettings: AppointmentSettings,
  maxAttempts = 4,
): Promise<void> {
  await locator.waitFor({ state: "visible", timeout: 15_000 });

  if (await phoneFieldMatches(locator, phoneDigits)) {
    logger.info(`[register] ${fieldLabel} doğrulandı — telefon dolu.`);
    return;
  }

  const disabled = await locator.isDisabled().catch(() => false);
  if (disabled) {
    const current = (await locator.inputValue().catch(() => "")).trim();
    throw new Error(
      `[register] ${fieldLabel} salt okunur — beklenen ${phoneDigits}, mevcut "${current}".`,
    );
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await phoneFieldMatches(locator, phoneDigits)) {
      logger.info(`[register] ${fieldLabel} doğrulandı — telefon dolu.`);
      return;
    }

    logger.info(`[register] ${fieldLabel} dolduruluyor (deneme ${attempt}/${maxAttempts})...`);
    await ensureTextFieldValue(page, locator, phoneDigits, fieldLabel, appointmentSettings);
    await page.waitForTimeout(randomIn(200, 420));
  }

  if (await phoneFieldMatches(locator, phoneDigits)) {
    return;
  }

  throw new Error(`[register] ${fieldLabel} doldurulamadı (${maxAttempts} deneme).`);
}

async function ensureEmailFieldValue(
  page: Page,
  locator: Locator,
  email: string,
  fieldLabel: string,
  appointmentSettings: AppointmentSettings,
): Promise<void> {
  await locator.waitFor({ state: "visible", timeout: 15_000 });

  if (await emailFieldMatches(locator, email)) {
    logger.info(`[register] ${fieldLabel} doğrulandı — "${email}".`);
    return;
  }

  const disabled = await locator.isDisabled().catch(() => false);
  if (disabled) {
    const current = (await locator.inputValue().catch(() => "")).trim();
    throw new Error(
      `[register] ${fieldLabel} salt okunur — beklenen "${email}", mevcut "${current}".`,
    );
  }

  await ensureTextFieldValue(page, locator, email, fieldLabel, appointmentSettings);
}

async function clickRequestCodeWithVerify(
  page: Page,
  button: Locator,
  fieldLabel: string,
  appointmentSettings: AppointmentSettings,
): Promise<void> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    logger.info(`[register][step-9] ${fieldLabel} — Kod Talep Et (deneme ${attempt}/4)...`);
    await humanClickLocator(page, button, {
      ...clickOptions(appointmentSettings),
      label: `${fieldLabel} Kod Talep Et`,
    });
    await page.waitForTimeout(randomIn(450, 900));

    const toastVisible = await page
      .locator("text=Doğrulama kodu")
      .first()
      .isVisible({ timeout: 2500 })
      .catch(() => false);
    const codeInputVisible = await page
      .locator("input[placeholder*='Kodu']")
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);

    if (toastVisible || codeInputVisible) {
      logger.info(`[register][step-9] ${fieldLabel} — kod gönderimi tetiklendi.`);
      return;
    }

    const stillVisible = await button.isVisible({ timeout: 500 }).catch(() => false);
    if (!stillVisible) {
      logger.info(`[register][step-9] ${fieldLabel} — Kod Talep Et kayboldu.`);
      return;
    }
  }

  logger.warn(`[register][step-9] ${fieldLabel} — Kod Talep Et doğrulanamadı.`);
}

export async function isEmailVerificationStepVisible(page: Page): Promise<boolean> {
  const heading = page
    .locator(".stepTitle:has-text('Email Doğrulama'), h2:has-text('Email Doğrulama')")
    .first();
  const requestCode = page.locator("button:has-text('Kod Talep Et')").first();
  const createForm = page.locator("button.wizard-btn:has-text('Formu Oluştur')").first();

  return (
    (await heading.isVisible({ timeout: 1500 }).catch(() => false)) ||
    (await page.getByText("Email Doğrulama").first().isVisible({ timeout: 800 }).catch(() => false)) ||
    ((await requestCode.isVisible({ timeout: 800 }).catch(() => false)) &&
      (await page.locator("input.form-control").count()) >= 2) ||
    (await createForm.isVisible({ timeout: 800 }).catch(() => false))
  );
}

export async function isRegisterFlowComplete(page: Page): Promise<boolean> {
  if (isRegisterFormUrl(page.url())) {
    if (await isEmailVerificationStepVisible(page)) {
      return false;
    }
    return false;
  }

  return verifyRandevuIslemleriNavVisible(page);
}

/**
 * Adım 9 — yalnızca email/telefon alanlarını doğrula. Kod Talep Et tıklanmaz.
 */
export async function prepareRegisterStep9EmailVerification(
  page: Page,
  contact: RegisterContactData,
  appointmentSettings: AppointmentSettings,
): Promise<{ reachedStep: boolean; emailReady: boolean; phoneReady: boolean }> {
  if (!(await isEmailVerificationStepVisible(page))) {
    logger.warn("[register][step-9] Email Doğrulama ekranı görünmüyor.");
    return { reachedStep: false, emailReady: false, phoneReady: false };
  }

  const masked = maskRegisterContact(contact);
  logger.info(
    `[register][step-9] Alan doğrulama — ${masked.email}, tel ${masked.phone} (Kod Talep Et YOK)`,
  );

  const emailVerified = (await countVerifiedLabels(page)) >= 1;
  let emailReady = emailVerified;

  if (!emailVerified) {
    const emailInput = await resolveEmailInput(page);
    await ensureEmailFieldValue(
      page,
      emailInput,
      contact.email,
      "Email (doğrulama)",
      appointmentSettings,
    );
    emailReady = true;
  } else {
    logger.info("[register][step-9] Email zaten doğrulanmış.");
  }

  const phoneVerified = (await countVerifiedLabels(page)) >= 2;
  let phoneReady = phoneVerified;

  if (!phoneVerified) {
    const phoneInput = await resolvePhoneInput(page);
    await ensurePhoneFieldValue(
      page,
      phoneInput,
      contact.phone,
      "Telefon (doğrulama)",
      appointmentSettings,
    );
    phoneReady = true;
  } else {
    logger.info("[register][step-9] Telefon zaten doğrulanmış.");
  }

  const emailRequestBtn = await resolveRequestCodeButton(page, 0);
  const phoneRequestBtn = await resolveRequestCodeButton(page, 1);

  logger.info(
    `[register][step-9] Tamam — Email Kod Talep Et=${emailRequestBtn ? "görünür" : "yok"}, ` +
      `Telefon Kod Talep Et=${phoneRequestBtn ? "görünür" : "yok"}. Kod gönderilmedi.`,
  );

  await page.waitForTimeout(appointmentSettings.waitAfterWizardNextMs);

  return {
    reachedStep: await isEmailVerificationStepVisible(page),
    emailReady,
    phoneReady,
  };
}

/** Tam akış — yalnızca REGISTER_ENABLE_CODE_REQUEST=true iken kullanılır. */
async function fillRegisterStep9WithCodeRequest(
  page: Page,
  contact: RegisterContactData,
  appointmentSettings: AppointmentSettings,
): Promise<{ filled: boolean; registerComplete: boolean; randevuNavVerified: boolean }> {
  const masked = maskRegisterContact(contact);
  logger.info(`[register][step-9] Kod gönderim akışı — ${masked.email}, tel ${masked.phone}`);

  let verifiedCount = await countVerifiedLabels(page);

  if (verifiedCount < 1) {
    const emailInput = await resolveEmailInput(page);
    await ensureEmailFieldValue(
      page,
      emailInput,
      contact.email,
      "Email (doğrulama)",
      appointmentSettings,
    );

    const emailRequestBtn = await resolveRequestCodeButton(page, 0);
    if (emailRequestBtn) {
      await clickRequestCodeWithVerify(page, emailRequestBtn, "Email", appointmentSettings);
    }

    await waitForManualVerification(page, {
      verifiedCountTarget: 1,
      fieldLabel: "Email doğrulama",
    });
    verifiedCount = await countVerifiedLabels(page);
  }

  if (verifiedCount < 2) {
    const phoneInput = await resolvePhoneInput(page);
    await ensurePhoneFieldValue(
      page,
      phoneInput,
      contact.phone,
      "Telefon (doğrulama)",
      appointmentSettings,
    );

    const phoneRequestIndex =
      (await page.locator("button:has-text('Kod Talep Et')").count()) > 1 ? 1 : 0;
    const phoneRequestBtn = await resolveRequestCodeButton(page, phoneRequestIndex);
    if (phoneRequestBtn) {
      await clickRequestCodeWithVerify(page, phoneRequestBtn, "Telefon", appointmentSettings);
    }

    await waitForManualVerification(page, {
      verifiedCountTarget: 2,
      fieldLabel: "Telefon doğrulama",
    });
  }

  const randevuNavVerified = await waitForManualFormCreateAndRandevuNav(page);

  return {
    filled: true,
    registerComplete: randevuNavVerified,
    randevuNavVerified,
  };
}

export async function fillRegisterStep9EmailVerification(
  page: Page,
  contact: RegisterContactData,
  appointmentSettings: AppointmentSettings,
  options: { enableCodeRequest?: boolean } = {},
): Promise<{
  filled: boolean;
  registerComplete: boolean;
  randevuNavVerified: boolean;
  emailVerificationStepReached?: boolean;
}> {
  if (!(await isEmailVerificationStepVisible(page))) {
    logger.warn("[register][step-9] Email Doğrulama ekranı görünmüyor.");
    return { filled: false, registerComplete: false, randevuNavVerified: false };
  }

  if (!resolveRegisterEnableCodeRequest(options)) {
    const prepared = await prepareRegisterStep9EmailVerification(page, contact, appointmentSettings);
    return {
      filled: prepared.reachedStep,
      registerComplete: false,
      randevuNavVerified: false,
      emailVerificationStepReached: prepared.reachedStep,
    };
  }

  return fillRegisterStep9WithCodeRequest(page, contact, appointmentSettings);
}
