import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanSelectCity } from "../interaction/humanSelect.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";

export function resolveAppointmentCity(
  profile: ResolvedProfile,
  defaultCity: string,
): string | null {
  const fromProfile = profile.appointmentCity?.trim();
  if (fromProfile) {
    return fromProfile;
  }
  const fallback = defaultCity.trim();
  return fallback || null;
}

export async function selectProfileCity(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
): Promise<void> {
  if (!settings.citySelectEnabled) {
    return;
  }

  const city = resolveAppointmentCity(profile, settings.defaultCity);
  if (!city) {
    logger.warn(`İl seçimi atlandı — ${profile.id} için appointmentCity tanımlı değil.`);
    return;
  }

  logger.info(`İl seçimi: ${city} (profil: ${profile.id})`);
  const scrollAnchors = settings.cityScrollLocator
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  const locators = settings.citySelectLocator
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  let lastError: unknown;
  for (const selector of locators) {
    try {
      await humanSelectCity(page, selector, city, {
        locatorTimeoutMs: settings.citySelectTimeoutMs,
        scrollAnchorSelectors: scrollAnchors,
        minStepDelayMs: settings.minStepDelayMs,
        maxStepDelayMs: settings.maxStepDelayMs,
        overshootProbability: settings.overshootProbability,
      });
      return;
    } catch (error) {
      lastError = error;
      logger.warn(
        `İl select başarısız (${selector}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(`İl seçilemedi (${city}).`, {
    cause: lastError instanceof Error ? lastError : undefined,
  });
}
