import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";
import { clickRegisterWizardNext } from "./registerFormNavigation.js";

export async function isAccommodationStepVisible(page: Page): Promise<boolean> {
  const heading = page
    .locator(
      "h2:has-text('Kalacak Yer Bilgileri'), .stepTitle:has-text('Kalacak Yer Bilgileri')",
    )
    .first();

  return (
    (await heading.isVisible({ timeout: 1500 }).catch(() => false)) ||
    (await page
      .locator("text=Üye Ülkeye Sizi Davet Eden Kişinin")
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false))
  );
}

/**
 * Adım 6 — Kalacak Yer Bilgileri.
 * Şimdilik zorunlu alan yok — doğrudan Sonraki.
 *
 * TODO: Otel / davet eden kişi / firma alanları ileride env'den doldurulabilir.
 */
export async function fillRegisterStep6Accommodation(
  page: Page,
  appointmentSettings: AppointmentSettings,
): Promise<{ filled: boolean; advanced: boolean }> {
  if (!(await isAccommodationStepVisible(page))) {
    logger.warn("[register][step-6] Kalacak Yer Bilgileri ekranı görünmüyor.");
    return { filled: false, advanced: false };
  }

  logger.info("[register][step-6] Zorunlu alan yok — Sonraki butonuna tıklanıyor...");
  await clickRegisterWizardNext(page, appointmentSettings, "register][step-6");

  await page.waitForTimeout(appointmentSettings.waitAfterWizardNextMs);

  const advanced = !(await isAccommodationStepVisible(page));
  logger.info(
    `[register][step-6] Tamamlandı — sonraki adıma ${advanced ? "geçildi" : "geçilemedi (doğrulama/manuel kontrol)"}.`,
  );

  return { filled: true, advanced };
}
