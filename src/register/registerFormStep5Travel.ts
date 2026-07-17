import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";
import {
  fillDateFieldIfNeeded,
  selectRegisterFieldIfNeeded,
  selectRegisterRadioIfNeeded,
} from "./registerFormFieldHelpers.js";
import { clickRegisterWizardNext } from "./registerFormNavigation.js";
import type { RegisterTravelData } from "./registerTravelData.js";

export async function isTravelStepVisible(page: Page): Promise<boolean> {
  const travelType = page.locator("select[name='traveltype']").first();
  const entryDate = page.locator("input[name='visaEntryDate']").first();
  const heading = page
    .locator("h2:has-text('Seyahat Bilgileri'), .stepTitle:has-text('Seyahat Bilgileri')")
    .first();

  return (
    (await travelType.isVisible({ timeout: 1500 }).catch(() => false)) ||
    (await entryDate.isVisible({ timeout: 800 }).catch(() => false)) ||
    (await heading.isVisible({ timeout: 800 }).catch(() => false))
  );
}

/**
 * Adım 5 — Seyahat Bilgileri (zorunlu alanlar) + Sonraki.
 */
export async function fillRegisterStep5Travel(
  page: Page,
  travel: RegisterTravelData,
  appointmentSettings: AppointmentSettings,
): Promise<{ filled: boolean; advanced: boolean }> {
  if (!(await isTravelStepVisible(page))) {
    logger.warn("[register][step-5] Seyahat Bilgileri ekranı görünmüyor.");
    return { filled: false, advanced: false };
  }

  logger.info("[register][step-5] Seyahat Bilgileri dolduruluyor...");

  await selectRegisterFieldIfNeeded(
    page,
    "traveltype",
    travel.travelType,
    "Seyahat amacı",
    appointmentSettings,
  );
  await selectRegisterFieldIfNeeded(
    page,
    "schDestinationCountryId",
    travel.destinationCountry,
    "Asıl gidilecek üye ülke",
    appointmentSettings,
  );
  await selectRegisterFieldIfNeeded(
    page,
    "schFirstEntryCountryId",
    travel.firstEntryCountry,
    "İlk giriş üye ülke",
    appointmentSettings,
  );
  await selectRegisterFieldIfNeeded(
    page,
    "visaEntryTypeId",
    travel.visaEntryType,
    "Talep edilen giriş sayısı",
    appointmentSettings,
  );

  const entryDateInput = page.locator("input[name='visaEntryDate']").first();
  const returnDateInput = page.locator("input[name='visaReturnDate']").first();
  await fillDateFieldIfNeeded(
    page,
    entryDateInput,
    travel.visaEntryDate,
    "Schengen planlanan giriş tarihi",
  );
  await fillDateFieldIfNeeded(
    page,
    returnDateInput,
    travel.visaReturnDate,
    "Schengen planlanan çıkış tarihi",
  );

  await selectRegisterRadioIfNeeded(
    page,
    "schengenVisaFingerPrint",
    travel.schengenFingerprint,
    "Parmak izi daha önce alındı mı",
    appointmentSettings,
  );

  logger.info("[register][step-5] Sonraki butonuna tıklanıyor...");
  await clickRegisterWizardNext(page, appointmentSettings, "register][step-5");

  await page.waitForTimeout(appointmentSettings.waitAfterWizardNextMs);

  const advanced = !(await isTravelStepVisible(page));
  logger.info(
    `[register][step-5] Tamamlandı — sonraki adıma ${advanced ? "geçildi" : "geçilemedi (doğrulama/manuel kontrol)"}.`,
  );

  return { filled: true, advanced };
}
