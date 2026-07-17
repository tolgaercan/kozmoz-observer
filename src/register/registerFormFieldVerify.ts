import type { Locator, Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanClickLocator } from "../interaction/humanClick.js";
import { logger } from "../utils/logger.js";
import { birthDateToHtmlInputValue } from "./registerIdentityData.js";
import { fillDateFieldIfNeeded, fillTextFieldIfNeeded } from "./registerFormFieldHelpers.js";

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

export async function ensureCheckboxChecked(
  page: Page,
  locator: Locator,
  fieldLabel: string,
  appointmentSettings: AppointmentSettings,
  maxAttempts = 4,
): Promise<void> {
  await locator.waitFor({ state: "attached", timeout: 15_000 });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await locator.isChecked().catch(() => false)) {
      logger.info(`[register] ${fieldLabel} doğrulandı — işaretli.`);
      return;
    }

    if (await locator.isDisabled().catch(() => false)) {
      throw new Error(
        `[register] ${fieldLabel} hâlâ devre dışı — KVKK metni sonuna kaydırılmamış olabilir.`,
      );
    }

    logger.info(`[register] ${fieldLabel} tıklanıyor (deneme ${attempt}/${maxAttempts})...`);
    const label = locator.locator("xpath=ancestor::div[contains(@class,'form-check')]//label").first();
    const clickTarget = (await label.count()) > 0 ? label : locator;

    await humanClickLocator(page, clickTarget, { ...clickOptions(appointmentSettings), label: fieldLabel });
    await locator.dispatchEvent("change").catch(() => {});
    await locator.dispatchEvent("input").catch(() => {});
    await page.waitForTimeout(randomIn(220, 480));
  }

  if (await locator.isChecked().catch(() => false)) {
    return;
  }

  throw new Error(`[register] ${fieldLabel} işaretlenemedi (${maxAttempts} deneme).`);
}

export async function ensureTextFieldValue(
  page: Page,
  locator: Locator,
  value: string,
  fieldLabel: string,
  appointmentSettings: AppointmentSettings,
  maxAttempts = 4,
): Promise<void> {
  const expected = value.trim();
  await locator.waitFor({ state: "visible", timeout: 15_000 });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const current = (await locator.inputValue().catch(() => "")).trim();
    if (current === expected) {
      logger.info(`[register] ${fieldLabel} doğrulandı — "${expected}".`);
      return;
    }

    logger.info(
      `[register] ${fieldLabel} dolduruluyor (deneme ${attempt}/${maxAttempts}, mevcut="${current}")...`,
    );
    await fillTextFieldIfNeeded(page, locator, expected, fieldLabel);
    await page.waitForTimeout(randomIn(200, 420));
  }

  const final = (await locator.inputValue().catch(() => "")).trim();
  if (final === expected) {
    return;
  }

  throw new Error(
    `[register] ${fieldLabel} doldurulamadı — beklenen "${expected}", mevcut "${final}".`,
  );
}

export async function ensureDateFieldValue(
  page: Page,
  locator: Locator,
  dateValue: string,
  fieldLabel: string,
  appointmentSettings: AppointmentSettings,
  maxAttempts = 4,
): Promise<void> {
  const expected = birthDateToHtmlInputValue(dateValue);
  await locator.waitFor({ state: "visible", timeout: 15_000 });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const current = (await locator.inputValue().catch(() => "")).trim();
    if (current === expected) {
      logger.info(`[register] ${fieldLabel} doğrulandı — ${expected}.`);
      return;
    }

    logger.info(
      `[register] ${fieldLabel} dolduruluyor (deneme ${attempt}/${maxAttempts}, mevcut="${current}")...`,
    );
    await fillDateFieldIfNeeded(page, locator, dateValue, fieldLabel);
    await page.waitForTimeout(randomIn(200, 420));
  }

  const final = (await locator.inputValue().catch(() => "")).trim();
  if (final === expected) {
    return;
  }

  throw new Error(
    `[register] ${fieldLabel} doldurulamadı — beklenen ${expected}, mevcut "${final}".`,
  );
}
