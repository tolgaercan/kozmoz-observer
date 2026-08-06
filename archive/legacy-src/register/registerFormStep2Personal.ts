import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";
import {
  fillDateFieldIfNeeded,
  fillTextFieldIfNeeded,
  selectRegisterFieldIfNeeded,
} from "./registerFormFieldHelpers.js";
import { clickRegisterWizardNext } from "./registerFormNavigation.js";
import {
  maskRegisterPersonal,
  type RegisterPersonalData,
} from "./registerPersonalData.js";

export async function isPersonalStepVisible(page: Page): Promise<boolean> {
  const birthPlace = page.locator("input[name='birthPlace']").first();
  const passportType = page.locator("select[name='passportTypeId']").first();
  const heading = page.locator("h2:has-text('Kişisel Bilgiler'), .stepTitle:has-text('Kişisel Bilgiler')").first();

  return (
    (await birthPlace.isVisible({ timeout: 1500 }).catch(() => false)) ||
    (await passportType.isVisible({ timeout: 800 }).catch(() => false)) ||
    (await heading.isVisible({ timeout: 800 }).catch(() => false))
  );
}

/**
 * Adım 2 — Kişisel Bilgiler + Seyahat Belgesi (Pasaport) alt bölümü + Sonraki.
 */
export async function fillRegisterStep2Personal(
  page: Page,
  personal: RegisterPersonalData,
  appointmentSettings: AppointmentSettings,
): Promise<{ filled: boolean; advanced: boolean }> {
  if (!(await isPersonalStepVisible(page))) {
    logger.warn("[register][step-2] Kişisel Bilgiler ekranı görünmüyor.");
    return { filled: false, advanced: false };
  }

  const masked = maskRegisterPersonal(personal);
  logger.info(
    `[register][step-2] Kişisel Bilgiler dolduruluyor: doğum yeri ${masked.birthPlace}, pasaport ${masked.passportNo}`,
  );

  const birthPlaceInput = page.locator("input[name='birthPlace']").first();
  await birthPlaceInput.waitFor({ state: "visible", timeout: 15_000 });

  await fillTextFieldIfNeeded(page, birthPlaceInput, personal.birthPlace, "Doğum yeri");

  await page.waitForTimeout(appointmentSettings.waitAfterWizardStepMs || 600);

  await selectRegisterFieldIfNeeded(
    page,
    "birthCountryId",
    personal.birthCountry,
    "Doğduğu ülke",
    appointmentSettings,
  );
  await selectRegisterFieldIfNeeded(
    page,
    "genderId",
    personal.gender,
    "Cinsiyet",
    appointmentSettings,
  );
  await selectRegisterFieldIfNeeded(
    page,
    "martialStatusId",
    personal.maritalStatus,
    "Medeni hal",
    appointmentSettings,
  );
  await selectRegisterFieldIfNeeded(
    page,
    "nationalityId",
    personal.currentNationality,
    "Mevcut uyruk",
    appointmentSettings,
  );

  await selectRegisterFieldIfNeeded(
    page,
    "passportTypeId",
    personal.passportType,
    "Seyahat belgesi türü",
    appointmentSettings,
  );

  const issueDateInput = page.locator("input[name='passportIssueDate']").first();
  const expiryDateInput = page.locator("input[name='passportExpiryDate']").first();
  await fillDateFieldIfNeeded(
    page,
    issueDateInput,
    personal.passportIssueDate,
    "Pasaport veriliş tarihi",
  );
  await fillDateFieldIfNeeded(
    page,
    expiryDateInput,
    personal.passportExpiryDate,
    "Pasaport geçerlilik tarihi",
  );

  const passportNoInput = page.locator("input[name='passportNo']").first();
  await fillTextFieldIfNeeded(page, passportNoInput, personal.passportNo, "Pasaport no", {
    groupPauseEveryChars: 2,
  });

  const issuingAuthorityInput = page.locator("input[name='issuingAuthority']").first();
  await fillTextFieldIfNeeded(
    page,
    issuingAuthorityInput,
    personal.issuingAuthority,
    "Belgeyi veren makam",
  );

  if (appointmentSettings.waitAfterNationalityNumberMs > 0) {
    await page.waitForTimeout(Math.min(appointmentSettings.waitAfterNationalityNumberMs, 600));
  }

  logger.info("[register][step-2] Sonraki butonuna tıklanıyor...");
  await clickRegisterWizardNext(page, appointmentSettings, "register][step-2");

  await page.waitForTimeout(appointmentSettings.waitAfterWizardNextMs);

  const advanced = !(await isPersonalStepVisible(page));
  logger.info(
    `[register][step-2] Tamamlandı — sonraki adıma ${advanced ? "geçildi" : "geçilemedi (doğrulama/manuel kontrol)"}.`,
  );

  return { filled: true, advanced };
}
