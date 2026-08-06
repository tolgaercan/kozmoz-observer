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
  return defaultType.trim() || null;
}

export async function selectApplicationType(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
): Promise<string> {
  if (!settings.applicationTypeEnabled) {
    throw new Error("Başvuru tipi seçimi kapalı.");
  }

  const applicationType = resolveApplicationType(profile, settings.defaultApplicationType);
  if (!applicationType) {
    throw new Error(`${profile.id} için applicationType tanımlı değil.`);
  }

  logger.info(`Başvuru tipi seçiliyor: ${applicationType}`);
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
      return applicationType;
    } catch (error) {
      lastError = error;
      logger.warn(
        `Başvuru tipi başarısız (${selector}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(`Başvuru tipi seçilemedi (${applicationType}).`, {
    cause: lastError instanceof Error ? lastError : undefined,
  });
}
