import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";
import {
  ensureCheckboxChecked,
  ensureDateFieldValue,
  ensureTextFieldValue,
} from "./registerFormFieldVerify.js";
import { clickRegisterWizardNext } from "./registerFormNavigation.js";
import {
  areKvkkCheckboxesEnabled,
  ensureRegisterKvkkTextScrolled,
} from "./registerFormKvkkScroll.js";
import type { RegisterKvkkData } from "./registerKvkkData.js";

const KVKK_CHECKBOX_STEPS = [
  {
    labelMatch: /KVKK Rıza Metnini/i,
    fieldLabel: "KVKK Rıza Metni onayı",
  },
  {
    labelMatch: /Sözleşmeyi/i,
    fieldLabel: "Sözleşme onayı",
  },
  {
    labelMatch: /Vize başvurumun reddedilmesi/i,
    fieldLabel: "Ücret iadesi onayı",
  },
] as const;

function resolveKvkkCheckbox(page: Page, labelMatch: RegExp) {
  return page
    .locator(".form-check")
    .filter({ has: page.locator("label", { hasText: labelMatch }) })
    .locator("input[type='checkbox']")
    .first();
}

async function waitForKvkkCheckboxesEnabled(page: Page, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await areKvkkCheckboxesEnabled(page)) {
      return;
    }
    await page.waitForTimeout(350);
  }
  throw new Error("[register][step-8] Checkbox'lar aktif olmadı — KVKK metni scroll edilememiş olabilir.");
}

export async function isKvkkStepVisible(page: Page): Promise<boolean> {
  const progressBar = page.locator("progress#file").first();
  const locationField = page.locator("input[name='location']").first();
  const heading = page
    .locator(
      "h2:has-text('KVKK'), .stepTitle:has-text('KVKK'), h1:has-text('AYDINLATMA METNİ')",
    )
    .first();

  return (
    (await progressBar.isVisible({ timeout: 1500 }).catch(() => false)) ||
    (await locationField.isVisible({ timeout: 800 }).catch(() => false)) ||
    (await heading.isVisible({ timeout: 800 }).catch(() => false))
  );
}

/**
 * Adım 8 — KVKK: scroll → 3 checkbox (doğrula/tekrar) → Yer/Tarih → Sonraki.
 */
export async function fillRegisterStep8Kvkk(
  page: Page,
  kvkk: RegisterKvkkData,
  appointmentSettings: AppointmentSettings,
): Promise<{ filled: boolean; advanced: boolean }> {
  if (!(await isKvkkStepVisible(page))) {
    logger.warn("[register][step-8] KVKK ekranı görünmüyor.");
    return { filled: false, advanced: false };
  }

  logger.info("[register][step-8] KVKK adımı başlıyor...");

  const scrollComplete = await ensureRegisterKvkkTextScrolled(page);
  if (!scrollComplete) {
    throw new Error("[register][step-8] KVKK metni sonuna kaydırılamadı.");
  }

  await waitForKvkkCheckboxesEnabled(page);

  for (const step of KVKK_CHECKBOX_STEPS) {
    const checkbox = resolveKvkkCheckbox(page, step.labelMatch);
    await ensureCheckboxChecked(page, checkbox, step.fieldLabel, appointmentSettings);
    await page.waitForTimeout(180 + Math.random() * 220);
  }

  const locationInput = page.locator("input[name='location']").first();
  await ensureTextFieldValue(page, locationInput, kvkk.location, "Yer (KVKK)", appointmentSettings);

  const dateInput = page.locator("input[name='locationDate']").first();
  await ensureDateFieldValue(
    page,
    dateInput,
    kvkk.locationDate,
    "Tarih (KVKK)",
    appointmentSettings,
  );

  logger.info("[register][step-8] Sonraki butonuna tıklanıyor...");
  await clickRegisterWizardNext(page, appointmentSettings, "register][step-8");

  await page.waitForTimeout(appointmentSettings.waitAfterWizardNextMs);

  const advanced = !(await isKvkkStepVisible(page));
  logger.info(
    `[register][step-8] Tamamlandı — sonraki adıma ${advanced ? "geçildi" : "geçilemedi (doğrulama/manuel kontrol)"}.`,
  );

  return { filled: true, advanced };
}
