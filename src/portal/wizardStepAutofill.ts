import type { Page } from "playwright";

import type { ApiQueryParams } from "../api/client/resolveApiQueryParams.js";
import type { AppointmentSettings } from "../config/settings.js";
import { dismissOpenOverlay } from "../interaction/dismissOverlay.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";
import { selectApplicationType } from "./applicationTypeSelector.js";
import { selectAppointmentStyle } from "./appointmentStyleSelector.js";
import { resolveAppointmentCity, selectProfileCity } from "./citySelector.js";
import { clickAppointmentLocationButton } from "./locationButton.js";
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

function mouseOptions(settings: AppointmentSettings) {
  return {
    minStepDelayMs: settings.minStepDelayMs,
    maxStepDelayMs: settings.maxStepDelayMs,
    overshootProbability: settings.overshootProbability,
  };
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
  if (!value || value === "0") {
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

async function isLocationButtonVisible(page: Page, settings: AppointmentSettings): Promise<boolean> {
  if (!settings.locationButtonEnabled) {
    return false;
  }
  const containerSelectors = parseLocatorList(settings.locationButtonContainer);
  for (const selector of containerSelectors) {
    const container = page.locator(selector).first();
    try {
      if (await container.isVisible({ timeout: 400 })) {
        const count = await container.locator(settings.locationButtonSelector).count();
        if (count > 0) {
          return true;
        }
      }
    } catch {
      // yoksay
    }
  }
  return false;
}

function resolveOfficeLabelForStep1(
  queryParams: ApiQueryParams,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
): string | null {
  return (
    queryParams.dealerOfficeLabel?.trim() ??
    queryParams.cityLabel?.trim() ??
    resolveAppointmentCity(profile, settings.defaultCity)
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
    try {
      if (await page.locator(pattern).first().isVisible({ timeout: 200 })) {
        return true;
      }
    } catch {
      // yoksay
    }
  }
  return false;
}

/**
 * Wizard adım 1 — il + merkez/şube (panel ofisi). Sonraki burada YOK.
 */
export async function ensureApiPollStep1FieldsFilled(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
  queryParams: ApiQueryParams,
): Promise<void> {
  const citySelectors = parseLocatorList(settings.citySelectLocator);
  const cityWasEmpty = await isSelectEmpty(page, citySelectors);

  if (cityWasEmpty) {
    logger.info("[wizard-fill] Adim 1 — il alani dolduruluyor (panel).");
    try {
      await selectProfileCity(page, profile, settings);
    } catch (error) {
      logger.warn(`[wizard-fill] İl: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (cityWasEmpty && settings.waitAfterCitySelectMs > 0) {
    await page.waitForTimeout(settings.waitAfterCitySelectMs);
  }

  if (settings.blankClickEnabled) {
    await dismissOpenOverlay(page, mouseOptions(settings)).catch(() => undefined);
  }

  const officeLabel = resolveOfficeLabelForStep1(queryParams, profile, settings);
  if (!officeLabel) {
    logger.warn("[wizard-fill] Adim 1 — merkez/sube etiketi yok (panel ofis / il).");
    return;
  }

  if (!(await isLocationButtonVisible(page, settings))) {
    logger.debug("[wizard-fill] Adim 1 — merkez/sube butonlari henuz gorunmuyor.");
    return;
  }

  logger.info(`[wizard-fill] Adim 1 — merkez/sube seciliyor: ${officeLabel} (panel).`);
  try {
    await clickAppointmentLocationButton(page, officeLabel, settings);
  } catch (error) {
    logger.warn(
      `[wizard-fill] Merkez/sube: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Wizard adım 2 — başvuru tipi + başvuru şekli (panel). Sonraki YOK.
 */
export async function ensureApiPollStep2FieldsFilled(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
  queryParams: ApiQueryParams,
): Promise<void> {
  const applicationSelectors = parseLocatorList(settings.applicationTypeLocator);
  if (await isSelectEmpty(page, applicationSelectors)) {
    logger.info("[wizard-fill] Adim 2 — basvuru tipi dolduruluyor (panel).");
    try {
      await selectApplicationType(page, profile, settings);
    } catch (error) {
      logger.warn(
        `[wizard-fill] Başvuru tipi: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const styleLabel = queryParams.appointmentStyleLabel?.trim();
  const styleSelectors = parseLocatorList(settings.appointmentStyleLocator);
  const styleVisible = (await firstVisibleLocator(page, styleSelectors)) !== null;

  if (styleVisible && (await isSelectEmpty(page, styleSelectors))) {
    logger.info("[wizard-fill] Adim 2 — basvuru sekli dolduruluyor (panel).");
    try {
      await selectAppointmentStyle(page, profile, settings, styleLabel);
    } catch (error) {
      logger.warn(
        `[wizard-fill] Başvuru şekli: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (styleVisible && styleLabel) {
    try {
      await selectAppointmentStyle(page, profile, settings, styleLabel);
    } catch (error) {
      logger.warn(
        `[wizard-fill] Başvuru şekli güncelleme: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** Adim 1 tamam (il+merkez) → tek Sonraki → adim 2. Adim 2'den Sonraki YOK. */
export async function advanceWizardStep1ToStep2Only(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
  queryParams: ApiQueryParams,
): Promise<void> {
  await ensureApiPollStep1FieldsFilled(page, profile, settings, queryParams);

  if (await hasWizardValidationError(page)) {
    await ensureApiPollStep1FieldsFilled(page, profile, settings, queryParams);
  }

  logger.info("[wizard-fill] Adim 1 → 2 tek Sonraki (captcha gate disarida — adim 2'den Sonraki yasak)");
  await clickWizardNextButton(page, settings);
  await page.waitForTimeout(settings.waitAfterWizardNextMs || 400);
}

/** @deprecated ensureApiPollStep1/2FieldsFilled kullanin */
export async function ensureApiPollStepFieldsFilled(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
  appointmentStyleOverride?: string,
): Promise<void> {
  const stubParams: ApiQueryParams = {
    dealerId: "",
    date: "",
    maxDate: "",
    cityId: "",
    appointmentTypeId: "",
    applicationTypeId: "",
    appointmentStyleLabel: appointmentStyleOverride,
  };
  await ensureApiPollStep1FieldsFilled(page, profile, settings, stubParams);
  await ensureApiPollStep2FieldsFilled(page, profile, settings, stubParams);
}

/** Ekranda görünen boş wizard alanlarını doldurur. */
export async function ensureVisibleWizardFieldsFilled(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
  appointmentStyleOverride?: string,
): Promise<void> {
  const citySelectors = parseLocatorList(settings.citySelectLocator);
  if (await isSelectEmpty(page, citySelectors)) {
    logger.info("[wizard-fill] İl alanı boş — dolduruluyor.");
    try {
      await selectProfileCity(page, profile, settings);
    } catch (error) {
      logger.warn(`[wizard-fill] İl: ${error instanceof Error ? error.message : String(error)}`);
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
      logger.warn(`[wizard-fill] TC: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const styleSelectors = parseLocatorList(settings.appointmentStyleLocator);
  if (await isSelectEmpty(page, styleSelectors)) {
    logger.info("[wizard-fill] Başvuru şekli boş — dolduruluyor.");
    try {
      await selectAppointmentStyle(page, profile, settings, appointmentStyleOverride);
    } catch (error) {
      logger.warn(
        `[wizard-fill] Başvuru şekli: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (appointmentStyleOverride) {
    const styleFound = await firstVisibleLocator(page, styleSelectors);
    if (styleFound) {
      try {
        await selectAppointmentStyle(page, profile, settings, appointmentStyleOverride);
      } catch (error) {
        logger.warn(
          `[wizard-fill] Başvuru şekli güncelleme: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

/** Boş alanları doldur → captcha gate dışarıda → Sonraki (insani). */
export async function advanceWizardAfterAutofill(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
  appointmentStyleOverride?: string,
): Promise<void> {
  await ensureVisibleWizardFieldsFilled(page, profile, settings, appointmentStyleOverride);

  if (await hasWizardValidationError(page)) {
    await ensureVisibleWizardFieldsFilled(page, profile, settings, appointmentStyleOverride);
  }

  await clickWizardNextButton(page, settings);
  await page.waitForTimeout(400);

  if (await hasWizardValidationError(page)) {
    throw new Error("Wizard Sonraki — zorunlu alanlar eksik.");
  }
}
