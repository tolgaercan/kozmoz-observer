import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { clickAppointmentLocationButton } from "./locationButton.js";
import { resolveAppointmentCity } from "./citySelector.js";
import { dismissOpenOverlay } from "../interaction/dismissOverlay.js";
import { humanScrollToLocator } from "../interaction/humanScroll.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";
import type { WizardStepId } from "./wizardStepDetector.js";
import {
  advanceWizardAfterAutofill,
  ensureVisibleWizardFieldsFilled,
} from "./wizardStepAutofill.js";

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

async function waitForSelectedCityHeader(
  page: Page,
  city: string,
  headerLocators: string[],
  timeoutMs: number,
): Promise<{ locator: ReturnType<Page["locator"]>; label: string }> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    for (const selector of headerLocators) {
      const header = page.locator(selector).first();
      try {
        await header.waitFor({ state: "visible", timeout: 2000 });
        const citySpan = header.locator(".sp-selected-city");
        if ((await citySpan.count()) > 0) {
          const text = (await citySpan.innerText()).replace(/\s+/g, " ").trim();
          if (text.toLocaleLowerCase("tr-TR") === city.toLocaleLowerCase("tr-TR")) {
            logger.info(`Seçilen il başlığı doğrulandı: ${text}`);
            return { locator: header, label: selector };
          }
        }
        const headerText = (await header.innerText()).replace(/\s+/g, " ");
        if (headerText.toLocaleLowerCase("tr-TR").includes(city.toLocaleLowerCase("tr-TR"))) {
          logger.info(`Seçilen il başlığı doğrulandı: ${headerText.trim()}`);
          return { locator: header, label: selector };
        }
      } catch {
        // sonraki locator
      }
    }
    await page.waitForTimeout(400);
  }

  throw new Error(
    `"Seçilen İl" alanında "${city}" görünmedi (timeout ${timeoutMs}ms).`,
  );
}

export interface WizardFlowResult {
  city?: string;
  applicationType?: string;
  nationalityNumber?: string;
  appointmentStyle?: string;
  /** Gerçek ilerleme adımı (checked) */
  wizardStep?: WizardStepId;
  /** Ekranda görünen adım (icon-container) */
  wizardViewStep?: WizardStepId;
}

/** Adım 1 — il seçildikten sonra: boş tık → konum → Sonraki */
export async function runStep1AfterCitySelection(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
): Promise<WizardFlowResult> {
  const city = resolveAppointmentCity(profile, settings.defaultCity);
  if (!city) {
    throw new Error("Kayıtlı il (appointmentCity) tanımlı değil.");
  }

  logger.info(`Kayıtlı il: ${city} (profil: ${profile.id})`);

  if (settings.waitAfterCitySelectMs > 0) {
    await page.waitForTimeout(settings.waitAfterCitySelectMs);
  }

  if (settings.blankClickEnabled) {
    await dismissOpenOverlay(page, mouseOptions(settings));
  }

  const headerLocators = parseLocatorList(settings.selectedCityHeaderLocator);
  const { locator: headerLocator, label } = await waitForSelectedCityHeader(
    page,
    city,
    headerLocators,
    settings.citySelectTimeoutMs,
  );

  logger.info(`Seçilen il alanına scroll (ortala): ${label}`);
  await humanScrollToLocator(page, headerLocator, `Seçilen İl: ${city}`, {
    timeoutMs: settings.citySelectTimeoutMs,
    centerVertically: true,
    maxSteps: 60,
  });

  await clickAppointmentLocationButton(page, city, settings);
  await ensureVisibleWizardFieldsFilled(page, profile, settings);
  await advanceWizardAfterAutofill(page, profile, settings);

  return { city, wizardStep: 1 };
}

/** Adım 3 — başvuru tipi, TC, başvuru şekli → Sonraki (boş alan kontrolü ile) */
export async function runStep2InformationFlow(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
): Promise<WizardFlowResult> {
  const city = resolveAppointmentCity(profile, settings.defaultCity) ?? undefined;
  const result: WizardFlowResult = { city, wizardStep: 3 };

  await ensureVisibleWizardFieldsFilled(page, profile, settings);

  try {
    result.applicationType = profile.applicationType ?? settings.defaultApplicationType;
    result.nationalityNumber = profile.nationalityNumber ?? settings.defaultNationalityNumber;
    result.appointmentStyle = profile.appointmentStyle ?? settings.defaultAppointmentStyle;
    await advanceWizardAfterAutofill(page, profile, settings);
  } catch (error) {
    logger.error(
      "Bilgi formu / Sonraki başarısız — observer devam ediyor.",
      error instanceof Error ? error.message : error,
    );
  }

  return result;
}

/** @deprecated ensureObserveTargetStep kullanın */
export async function runPostCitySelectionFlow(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
): Promise<WizardFlowResult> {
  const step1 = await runStep1AfterCitySelection(page, profile, settings);
  const step2 = await runStep2InformationFlow(page, profile, settings);
  return { ...step1, ...step2, wizardStep: 2 };
}
