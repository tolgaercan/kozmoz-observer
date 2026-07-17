import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";
import { selectRegisterFieldIfNeeded } from "./registerFormFieldHelpers.js";
import { clickRegisterWizardNext } from "./registerFormNavigation.js";
import type { RegisterOccupationData } from "./registerOccupationData.js";

export async function isOccupationStepVisible(page: Page): Promise<boolean> {
  const jobSelect = page.locator("select[name='jobId']").first();
  const heading = page
    .locator("h2:has-text('Meslek Bilgileri'), .stepTitle:has-text('Meslek Bilgileri')")
    .first();

  return (
    (await jobSelect.isVisible({ timeout: 1500 }).catch(() => false)) ||
    (await heading.isVisible({ timeout: 800 }).catch(() => false))
  );
}

/**
 * Adım 4 — Meslek Bilgileri: Şu Anki Mesleğiniz (jobId) + Sonraki.
 *
 * TODO: Çiftçi (375) dışındaki mesleklerde portal ek alanlar açıyor
 * (Firma İsmi, Firma Telefon, Firma Adresi vb.) — meslek bazlı koşullu doldurma
 * ileride registerFormStep4Occupation.ts içinde genişletilecek.
 */
export async function fillRegisterStep4Occupation(
  page: Page,
  occupation: RegisterOccupationData,
  appointmentSettings: AppointmentSettings,
): Promise<{ filled: boolean; advanced: boolean }> {
  if (!(await isOccupationStepVisible(page))) {
    logger.warn("[register][step-4] Meslek Bilgileri ekranı görünmüyor.");
    return { filled: false, advanced: false };
  }

  logger.info(
    `[register][step-4] Meslek seçiliyor — ${occupation.job.by}=${occupation.job.value}`,
  );

  await selectRegisterFieldIfNeeded(
    page,
    "jobId",
    occupation.job,
    "Şu anki meslek",
    appointmentSettings,
  );

  logger.info("[register][step-4] Sonraki butonuna tıklanıyor...");
  await clickRegisterWizardNext(page, appointmentSettings, "register][step-4");

  await page.waitForTimeout(appointmentSettings.waitAfterWizardNextMs);

  const advanced = !(await isOccupationStepVisible(page));
  logger.info(
    `[register][step-4] Tamamlandı — sonraki adıma ${advanced ? "geçildi" : "geçilemedi (doğrulama/manuel kontrol)"}.`,
  );

  return { filled: true, advanced };
}
