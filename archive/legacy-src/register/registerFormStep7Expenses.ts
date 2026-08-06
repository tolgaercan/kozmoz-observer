import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";
import type { RegisterExpensesData } from "./registerExpensesData.js";
import {
  checkRegisterCheckboxIfNeeded,
  selectRegisterRadioIfNeeded,
} from "./registerFormFieldHelpers.js";
import { clickRegisterWizardNext } from "./registerFormNavigation.js";

export async function isExpensesStepVisible(page: Page): Promise<boolean> {
  const costsRadio = page.locator("input[name='accommodationTravelCosts']").first();
  const heading = page
    .locator("h2:has-text('Masraflar'), .stepTitle:has-text('Masraflar')")
    .first();

  return (
    (await costsRadio.isVisible({ timeout: 1500 }).catch(() => false)) ||
    (await heading.isVisible({ timeout: 800 }).catch(() => false))
  );
}

async function waitForLivingCostsSection(page: Page): Promise<void> {
  await page
    .locator("b:has-text('Masraflarının Karşılanma Şekli')")
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
}

async function waitForSponsorSection(page: Page): Promise<void> {
  await page
    .locator("b:has-text('Sponsor Bilgileri')")
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
}

/**
 * Adım 7 — Masraflar (koşullu alanlar) + Sonraki.
 *
 * self (gecimMasraflariHayir) → Masraflarının Karşılanma Şekli checkbox(lar)
 * sponsor (gecimMasraflariEvet) → Sponsor Bilgileri radio
 */
export async function fillRegisterStep7Expenses(
  page: Page,
  expenses: RegisterExpensesData,
  appointmentSettings: AppointmentSettings,
): Promise<{ filled: boolean; advanced: boolean }> {
  if (!(await isExpensesStepVisible(page))) {
    logger.warn("[register][step-7] Masraflar ekranı görünmüyor.");
    return { filled: false, advanced: false };
  }

  logger.info(`[register][step-7] Masraflar — coveredBy=${expenses.coveredBy}`);

  await selectRegisterRadioIfNeeded(
    page,
    "accommodationTravelCosts",
    expenses.coveredBy,
    "Masrafları kim karşılayacak",
    appointmentSettings,
  );
  await page.waitForTimeout(400);

  if (expenses.coveredBy === "gecimMasraflariHayir") {
    await waitForLivingCostsSection(page);
    for (const cost of expenses.livingCosts) {
      await checkRegisterCheckboxIfNeeded(page, cost, `Masraf şekli: ${cost}`, appointmentSettings);
    }
  } else {
    await waitForSponsorSection(page);
    await selectRegisterRadioIfNeeded(
      page,
      "thirtyOneThirtytwoNumberedbox",
      expenses.sponsorInfo,
      "Sponsor bilgisi",
      appointmentSettings,
    );
  }

  logger.info("[register][step-7] Sonraki butonuna tıklanıyor...");
  await clickRegisterWizardNext(page, appointmentSettings, "register][step-7");

  await page.waitForTimeout(appointmentSettings.waitAfterWizardNextMs);

  const advanced = !(await isExpensesStepVisible(page));
  logger.info(
    `[register][step-7] Tamamlandı — sonraki adıma ${advanced ? "geçildi" : "geçilemedi (doğrulama/manuel kontrol)"}.`,
  );

  return { filled: true, advanced };
}
