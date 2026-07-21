import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanSelectCity } from "../interaction/humanSelect.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";

export function resolveAppointmentStyle(
  profile: ResolvedProfile,
  defaultStyle: string,
): string | null {
  const profileEnvKey = `APPOINTMENT_STYLE_${profile.id.toUpperCase().replace(/-/g, "_")}`;
  const fromProfileEnv = process.env[profileEnvKey]?.trim();
  if (fromProfileEnv) {
    return fromProfileEnv;
  }

  const fromGlobal = process.env.APPOINTMENT_STYLE?.trim();
  if (fromGlobal) {
    return fromGlobal;
  }

  const fromProfile = profile.appointmentStyle?.trim();
  if (fromProfile) {
    return fromProfile;
  }

  const fallback = defaultStyle.trim();
  return fallback || null;
}

export async function selectAppointmentStyle(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
): Promise<string> {
  if (!settings.appointmentStyleEnabled) {
    logger.info("Başvuru şekli seçimi kapalı — APPOINTMENT_STYLE_ENABLED=false");
    throw new Error("Başvuru şekli seçimi kapalı.");
  }

  const appointmentStyle = resolveAppointmentStyle(profile, settings.defaultAppointmentStyle);
  if (!appointmentStyle) {
    throw new Error(
      `${profile.id} için appointmentStyle tanımlı değil (manifest veya APPOINTMENT_STYLE).`,
    );
  }

  if (settings.waitAfterNationalityForStyleMs > 0) {
    await page.waitForTimeout(settings.waitAfterNationalityForStyleMs);
  }

  logger.info(`Başvuru şekli seçiliyor: ${appointmentStyle} (profil: ${profile.id})`);

  const locators = settings.appointmentStyleLocator
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  let lastError: unknown;
  for (const selector of locators) {
    try {
      await humanSelectCity(page, selector, appointmentStyle, {
        locatorTimeoutMs: settings.appointmentStyleTimeoutMs,
        scrollAnchorSelectors: [selector],
        minStepDelayMs: settings.minStepDelayMs,
        maxStepDelayMs: settings.maxStepDelayMs,
        overshootProbability: settings.overshootProbability,
      });
      logger.info(`Başvuru şekli seçildi: ${appointmentStyle}`);
      return appointmentStyle;
    } catch (error) {
      lastError = error;
      logger.warn(
        `Başvuru şekli locator başarısız (${selector}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(
    `Başvuru şekli seçilemedi (${appointmentStyle}). Denenen: ${locators.join(" | ")}`,
    { cause: lastError instanceof Error ? lastError : undefined },
  );
}
