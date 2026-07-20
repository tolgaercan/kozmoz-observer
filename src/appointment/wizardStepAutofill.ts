import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";
import { selectApplicationType } from "./applicationTypeSelector.js";
import { selectAppointmentStyle } from "./appointmentStyleSelector.js";
import { selectProfileCity } from "./citySelector.js";
import {
  fillNationalityNumber,
  isValidTurkishNationalId,
  normalizeNationalityNumber,
} from "./nationalityNumberInput.js";
import { clickWizardNextButton } from "./wizardNavigation.js";

function parseLocatorList(raw: string): string[] {
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function firstVisibleLocator(
  page: Page,
  selectors: string[],
): Promise<{ selector: string; locator: ReturnType<Page["locator"]> } | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 400 })) {
        return { selector, locator };
      }
    } catch {
      // görünür değil
    }
  }
  return null;
}

async function isSelectEmpty(page: Page, selectors: string[]): Promise<boolean> {
  const found = await firstVisibleLocator(page, selectors);
  if (!found) {
    return false;
  }

  const value = (await found.locator.inputValue().catch(() => "")).trim();
  if (!value || value === "0" || value === "null" || value === "undefined") {
    return true;
  }

  const selectedText = (
    await found.locator.locator("option:checked").innerText().catch(() => "")
  )
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr-TR");

  return (
    !selectedText ||
    selectedText.includes("seçin") ||
    selectedText.includes("seçiniz") ||
    selectedText === "—"
  );
}

async function isNationalityInputEmpty(page: Page, selectors: string[]): Promise<boolean> {
  const found = await firstVisibleLocator(page, selectors);
  if (!found) {
    return false;
  }

  if (await found.locator.isDisabled().catch(() => false)) {
    return false;
  }

  const value = normalizeNationalityNumber(await found.locator.inputValue().catch(() => ""));
  return value.length < 11 || !isValidTurkishNationalId(value);
}

export async function hasWizardValidationError(page: Page): Promise<boolean> {
  const patterns = [
    "text=Lütfen tüm zorunlu alanları doldurunuz",
    "text=Bu alan zorunludur",
    ".invalid-feedback:visible",
    ".is-invalid",
  ];

  for (const pattern of patterns) {
    const locator = page.locator(pattern).first();
    try {
      if (await locator.isVisible({ timeout: 200 })) {
        return true;
      }
    } catch {
      // yoksay
    }
  }

  return false;
}

/** Ekranda görünen boş wizard alanlarını doldurur — Sonraki öncesi çağrılmalı. */
export async function ensureVisibleWizardFieldsFilled(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
): Promise<void> {
  const citySelectors = parseLocatorList(settings.citySelectLocator);
  if (await isSelectEmpty(page, citySelectors)) {
    logger.info("[wizard-fill] İl alanı boş — dolduruluyor.");
    try {
      await selectProfileCity(page, profile, settings);
    } catch (error) {
      logger.warn(
        `[wizard-fill] İl seçimi: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const applicationSelectors = parseLocatorList(settings.applicationTypeLocator);
  if (await isSelectEmpty(page, applicationSelectors)) {
    logger.info("[wizard-fill] Başvuru tipi boş — dolduruluyor.");
    try {
      await selectApplicationType(page, profile, settings);
    } catch (error) {
      logger.warn(
        `[wizard-fill] Başvuru tipi: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const nationalitySelectors = parseLocatorList(settings.nationalityNumberLocator);
  if (await isNationalityInputEmpty(page, nationalitySelectors)) {
    logger.info("[wizard-fill] TC Kimlik boş — dolduruluyor.");
    try {
      await fillNationalityNumber(page, profile, settings);
    } catch (error) {
      logger.warn(
        `[wizard-fill] TC Kimlik: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const styleSelectors = parseLocatorList(settings.appointmentStyleLocator);
  if (await isSelectEmpty(page, styleSelectors)) {
    logger.info("[wizard-fill] Başvuru şekli boş — dolduruluyor.");
    try {
      await selectAppointmentStyle(page, profile, settings);
    } catch (error) {
      logger.warn(
        `[wizard-fill] Başvuru şekli: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** Boş alanları doldur → doğrula → Sonraki */
export async function advanceWizardAfterAutofill(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
): Promise<void> {
  await ensureVisibleWizardFieldsFilled(page, profile, settings);

  if (await hasWizardValidationError(page)) {
    logger.warn("[wizard-fill] Doğrulama hatası — alanlar tekrar dolduruluyor.");
    await ensureVisibleWizardFieldsFilled(page, profile, settings);
  }

  await clickWizardNextButton(page, settings);
  await page.waitForTimeout(400);

  if (await hasWizardValidationError(page)) {
    logger.warn("[wizard-fill] Sonraki sonrası zorunlu alan hatası — bir kez daha dolduruluyor.");
    await ensureVisibleWizardFieldsFilled(page, profile, settings);
    throw new Error("Wizard Sonraki — zorunlu alanlar hâlâ eksik.");
  }
}
