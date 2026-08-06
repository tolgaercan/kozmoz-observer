import type { Locator, Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanClickLocator } from "../interaction/humanClick.js";
import { humanTypeIntoLocator } from "../interaction/humanType.js";
import { logger } from "../utils/logger.js";
import type { RegisterIdentityData } from "./registerIdentityData.js";
import { birthDateToHtmlInputValue, maskRegisterIdentity } from "./registerIdentityData.js";
import { clickRegisterWizardNext } from "./registerFormNavigation.js";
import { fillRegisterOtpIfVisible } from "./registerOtpFill.js";

const FIRST_NAME_SELECTORS = [
  "input[name='nameOriginal']",
  "input[name='name']",
  "input[name='firstName']",
];

const LAST_NAME_SELECTORS = [
  "input[name='surnameOriginal']",
  "input[name='surname']",
  "input[name='lastName']",
];

const TC_SELECTORS = [
  "input[name='nationalityNumber']",
  "input[name='identityNumber']",
  "input[name='tcKimlikNo']",
];

const BIRTH_DATE_SELECTORS = [
  "input[name='birthDate'][type='date']",
  "input[name='birthDate']",
  "input[placeholder='gg.aa.yyyy']",
  "input[name='dateOfBirth']",
];

async function findInputByLabel(page: Page, labelPattern: RegExp): Promise<Locator | null> {
  const byLabel = page.getByLabel(labelPattern).first();
  if (await byLabel.isVisible({ timeout: 800 }).catch(() => false)) {
    return byLabel;
  }
  return null;
}

async function resolveFieldLocator(
  page: Page,
  labelPattern: RegExp,
  selectors: string[],
): Promise<Locator> {
  const byLabel = await findInputByLabel(page, labelPattern);
  if (byLabel) {
    return byLabel;
  }

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 800 }).catch(() => false)) {
      return locator;
    }
  }

  throw new Error(
    `Alan bulunamadı (${labelPattern.source}). Denenen: ${selectors.join(" | ")}`,
  );
}

async function fieldHasValue(locator: Locator, expected: string): Promise<boolean> {
  const value = (await locator.inputValue().catch(() => "")).trim();
  return value === expected.trim();
}

async function fillFieldIfNeeded(
  page: Page,
  locator: Locator,
  value: string,
  label: string,
  options: { groupPauseEveryChars?: number } = {},
): Promise<boolean> {
  if (await fieldHasValue(locator, value)) {
    logger.info(`[register][step-1] ${label} zaten dolu — atlanıyor.`);
    return false;
  }

  await humanTypeIntoLocator(page, locator, value, {
    label,
    minCharDelayMs: 45,
    maxCharDelayMs: 130,
    groupPauseEveryChars: options.groupPauseEveryChars,
    groupPauseMinMs: 180,
    groupPauseMaxMs: 420,
  });
  return true;
}

async function fillBirthDateIfNeeded(
  page: Page,
  locator: Locator,
  birthDate: string,
): Promise<boolean> {
  const htmlValue = birthDateToHtmlInputValue(birthDate);
  if (await fieldHasValue(locator, htmlValue)) {
    logger.info("[register][step-1] Doğum tarihi zaten dolu — atlanıyor.");
    return false;
  }

  const inputType = await locator.getAttribute("type");
  await humanClickLocator(page, locator, { label: "Doğum tarihi", waitTimeoutMs: 10_000 });

  if (inputType === "date") {
    await locator.fill(htmlValue);
    logger.info(`[register][step-1] Doğum tarihi (date input): ${htmlValue}`);
  } else {
    await humanTypeIntoLocator(page, locator, birthDate, {
      label: "Doğum tarihi",
      minCharDelayMs: 45,
      maxCharDelayMs: 130,
    });
  }

  await page.waitForTimeout(200);
  return true;
}

export async function isIdentityStepVisible(page: Page): Promise<boolean> {
  const heading = page.locator("h2:has-text('Kimlik Doğrulama')").first();
  const nameField = page.locator("input[name='nameOriginal']").first();
  return (
    (await heading.isVisible({ timeout: 1500 }).catch(() => false)) ||
    (await nameField.isVisible({ timeout: 800 }).catch(() => false))
  );
}

/**
 * Adım 1 — Kimlik Doğrulama: Ad, Soyad, TC, Doğum tarihi + Sonraki.
 */
export async function fillRegisterStep1Identity(
  page: Page,
  identity: RegisterIdentityData,
  appointmentSettings: AppointmentSettings,
  options: { profileId?: string } = {},
): Promise<{ filled: boolean; advanced: boolean }> {
  if (!(await isIdentityStepVisible(page))) {
    logger.warn("[register][step-1] Kimlik Doğrulama ekranı görünmüyor.");
    return { filled: false, advanced: false };
  }

  const masked = maskRegisterIdentity(identity);
  logger.info(
    `[register][step-1] Kimlik Doğrulama dolduruluyor: ${masked.firstName} ${masked.lastName}, TC ${masked.nationalityNumber}, doğum ${masked.birthDate}`,
  );

  const firstNameInput = await resolveFieldLocator(page, /^Adı$/i, FIRST_NAME_SELECTORS);
  const lastNameInput = await resolveFieldLocator(page, /^Soyadı$/i, LAST_NAME_SELECTORS);
  const tcInput = await resolveFieldLocator(
    page,
    /T\.C\. Kimlik/i,
    TC_SELECTORS,
  );
  const birthInput = await resolveFieldLocator(
    page,
    /Doğum Tarihi/i,
    BIRTH_DATE_SELECTORS,
  );

  await fillFieldIfNeeded(page, firstNameInput, identity.firstName, "Adı");
  await fillFieldIfNeeded(page, lastNameInput, identity.lastName, "Soyadı");
  await fillFieldIfNeeded(page, tcInput, identity.nationalityNumber, "TC Kimlik", {
    groupPauseEveryChars: 3,
  });
  await fillBirthDateIfNeeded(page, birthInput, identity.birthDate);

  if (appointmentSettings.waitAfterNationalityNumberMs > 0) {
    await page.waitForTimeout(appointmentSettings.waitAfterNationalityNumberMs);
  }

  const profileId = options.profileId ?? "unknown";
  await fillRegisterOtpIfVisible(page, { profileId, step: "identity" });

  logger.info("[register][step-1] Sonraki butonuna tıklanıyor...");
  await clickRegisterWizardNext(page, appointmentSettings, "register][step-1");

  await page.waitForTimeout(appointmentSettings.waitAfterWizardNextMs);

  const otpAfter = await fillRegisterOtpIfVisible(page, { profileId, step: "identity" });
  if (otpAfter.filled && (await isIdentityStepVisible(page))) {
    logger.info("[register][step-1] OTP dolduruldu — tekrar Sonraki...");
    await clickRegisterWizardNext(page, appointmentSettings, "register][step-1");
    await page.waitForTimeout(appointmentSettings.waitAfterWizardNextMs);
  }

  const advanced = !(await isIdentityStepVisible(page));
  logger.info(
    `[register][step-1] Tamamlandı — sonraki adıma ${advanced ? "geçildi" : "geçilemedi (doğrulama/manuel kontrol)"}.`,
  );

  return { filled: true, advanced };
}
