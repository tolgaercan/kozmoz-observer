import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanClickLocator } from "../interaction/humanClick.js";
import { logger } from "../utils/logger.js";
import type { RegisterContactData } from "./registerContactData.js";
import { maskRegisterContact } from "./registerContactData.js";
import {
  fillTextFieldIfNeeded,
  selectRegisterFieldIfNeeded,
} from "./registerFormFieldHelpers.js";
import { clickRegisterWizardNext } from "./registerFormNavigation.js";

const PHONE_INPUT_SELECTORS = [
  "input[name='phoneNumber']",
  "input[name='mobilePhone']",
  "input[name='phone']",
  "input[name='gsm']",
  ".b-form-group:has(b:text-matches('Telefon Numarası')) input.form-control",
  "input[placeholder='(555) 555 55 55']",
];

const POSTAL_CODE_SELECTORS = [
  "input[name='postalCode']",
  "input[name='zipCode']",
  ".b-form-group:has(b:text-matches('Posta Kodu')) input.form-control",
];

async function resolveFirstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 800 }).catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function selectResidenceAbroadIfNeeded(
  page: Page,
  choice: RegisterContactData["residenceAbroad"],
  appointmentSettings: AppointmentSettings,
): Promise<void> {
  const hayirRadio = page.getByRole("radio", { name: /^Hayır$/i }).first();
  const evetRadio = page.getByRole("radio", { name: /^Evet/i }).first();

  const target = choice === "evet" ? evetRadio : hayirRadio;
  if (!(await target.isVisible({ timeout: 3000 }).catch(() => false))) {
    logger.warn("[register][step-3] İkamet sorusu radio butonları bulunamadı — atlanıyor.");
    return;
  }

  if (await target.isChecked().catch(() => false)) {
    logger.info(`[register][step-3] İkamet sorusu zaten "${choice}" seçili.`);
    return;
  }

  await humanClickLocator(page, target, {
    label: choice === "evet" ? "İkamet: Evet" : "İkamet: Hayır",
    waitTimeoutMs: appointmentSettings.citySelectTimeoutMs,
    minStepDelayMs: appointmentSettings.minStepDelayMs,
    maxStepDelayMs: appointmentSettings.maxStepDelayMs,
    overshootProbability: appointmentSettings.overshootProbability,
  });
}

export async function isContactStepVisible(page: Page): Promise<boolean> {
  const street = page.locator("input[name='street']").first();
  const email = page.locator("input[name='eMail']").first();
  const heading = page
    .locator(
      "h2:has-text('İletişim'), .stepTitle:has-text('İletişim'), h2:has-text('İkamet')",
    )
    .first();

  return (
    (await street.isVisible({ timeout: 1500 }).catch(() => false)) ||
    (await email.isVisible({ timeout: 800 }).catch(() => false)) ||
    (await heading.isVisible({ timeout: 800 }).catch(() => false))
  );
}

/**
 * Adım 3 — İletişim / İkamet Bilgileri + Sonraki.
 */
export async function fillRegisterStep3Contact(
  page: Page,
  contact: RegisterContactData,
  appointmentSettings: AppointmentSettings,
): Promise<{ filled: boolean; advanced: boolean }> {
  if (!(await isContactStepVisible(page))) {
    logger.warn("[register][step-3] İletişim / İkamet ekranı görünmüyor.");
    return { filled: false, advanced: false };
  }

  const masked = maskRegisterContact(contact);
  logger.info(
    `[register][step-3] İletişim dolduruluyor: ${masked.email}, tel ${masked.phone}, sokak ${masked.street}`,
  );

  await selectRegisterFieldIfNeeded(
    page,
    "applicantCountryId",
    contact.applicantCountry,
    "Ülke",
    appointmentSettings,
  );
  await selectRegisterFieldIfNeeded(
    page,
    "applicantCityId",
    contact.applicantCity,
    "Şehir",
    appointmentSettings,
  );

  const streetInput = page.locator("input[name='street']").first();
  await streetInput.waitFor({ state: "visible", timeout: 15_000 });
  await fillTextFieldIfNeeded(page, streetInput, contact.street, "Sokak ve cadde");

  if (contact.postalCode) {
    const postalInput = await resolveFirstVisible(page, POSTAL_CODE_SELECTORS);
    if (postalInput) {
      await fillTextFieldIfNeeded(page, postalInput, contact.postalCode, "Posta kodu");
    }
  }

  const emailInput = page.locator("input[name='eMail']").first();
  await fillTextFieldIfNeeded(page, emailInput, contact.email, "Email");

  const phoneInput = await resolveFirstVisible(page, PHONE_INPUT_SELECTORS);
  if (!phoneInput) {
    throw new Error("[register][step-3] Telefon alanı bulunamadı.");
  }
  await fillTextFieldIfNeeded(page, phoneInput, contact.phone, "Telefon", {
    groupPauseEveryChars: 3,
  });

  await selectResidenceAbroadIfNeeded(page, contact.residenceAbroad, appointmentSettings);

  logger.info("[register][step-3] Sonraki butonuna tıklanıyor...");
  await clickRegisterWizardNext(page, appointmentSettings, "register][step-3");

  await page.waitForTimeout(appointmentSettings.waitAfterWizardNextMs);

  const advanced = !(await isContactStepVisible(page));
  logger.info(
    `[register][step-3] Tamamlandı — sonraki adıma ${advanced ? "geçildi" : "geçilemedi (doğrulama/manuel kontrol)"}.`,
  );

  return { filled: true, advanced };
}
