import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanSelectCity } from "../interaction/humanSelect.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";

export function resolveApplicationType(
  profile: ResolvedProfile,
  defaultType: string,
): string | null {
  const fromProfile = profile.applicationType?.trim();
  if (fromProfile) {
    return fromProfile;
  }

  const fallback = defaultType.trim();
  return fallback || null;
}

export async function selectApplicationType(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
): Promise<string> {
  if (!settings.applicationTypeEnabled) {
    logger.info("Başvuru tipi seçimi kapalı — APPLICATION_TYPE_ENABLED=false");
    throw new Error("Başvuru tipi seçimi kapalı.");
  }

  const applicationType = resolveApplicationType(profile, settings.defaultApplicationType);
  if (!applicationType) {
    throw new Error(
      `${profile.id} için applicationType tanımlı değil (manifest veya APPLICATION_TYPE).`,
    );
  }

  if (settings.waitAfterWizardNextMs > 0) {
    await page.waitForTimeout(settings.waitAfterWizardNextMs);
  }

  logger.info(`Başvuru tipi seçiliyor: ${applicationType} (profil: ${profile.id})`);

  const locators = settings.applicationTypeLocator
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  let lastError: unknown;
  for (const selector of locators) {
    try {
      await humanSelectCity(page, selector, applicationType, {
        locatorTimeoutMs: settings.applicationTypeTimeoutMs,
        scrollAnchorSelectors: [selector],
        minStepDelayMs: settings.minStepDelayMs,
        maxStepDelayMs: settings.maxStepDelayMs,
        overshootProbability: settings.overshootProbability,
      });
      logger.info(`Başvuru tipi seçildi: ${applicationType}`);
      return applicationType;
    } catch (error) {
      lastError = error;
      logger.warn(
        `Başvuru tipi locator başarısız (${selector}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(
    `Başvuru tipi seçilemedi (${applicationType}). Denenen: ${locators.join(" | ")}`,
    { cause: lastError instanceof Error ? lastError : undefined },
  );
}
