import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanClickBlankArea } from "../interaction/humanClick.js";
import { humanTypeIntoLocator } from "../interaction/humanType.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";

const TC_DIGIT_COUNT = 11;

export function maskNationalityNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 3) {
    return "***";
  }
  return `${digits.slice(0, 3)}${"*".repeat(digits.length - 3)}`;
}

export function normalizeNationalityNumber(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function isValidTurkishNationalId(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) {
    return false;
  }

  const digits = value.split("").map((part) => Number.parseInt(part, 10));
  const oddSum = digits[0]! + digits[2]! + digits[4]! + digits[6]! + digits[8]!;
  const evenSum = digits[1]! + digits[3]! + digits[5]! + digits[7]!;
  const digit10 = (oddSum * 7 - evenSum) % 10;
  if (digit10 !== digits[9]) {
    return false;
  }

  const sumFirst10 = digits.slice(0, 10).reduce((total, digit) => total + digit, 0);
  return sumFirst10 % 10 === digits[10];
}

export function resolveNationalityNumber(
  profile: ResolvedProfile,
  defaultNumber: string,
): string | null {
  const profileEnvKey = `NATIONALITY_NUMBER_${profile.id.toUpperCase().replace(/-/g, "_")}`;
  const fromProfileEnv = process.env[profileEnvKey]?.trim();
  if (fromProfileEnv) {
    return normalizeNationalityNumber(fromProfileEnv);
  }

  const fromProfile = profile.nationalityNumber?.trim();
  if (fromProfile) {
    return normalizeNationalityNumber(fromProfile);
  }

  const fallback = normalizeNationalityNumber(defaultNumber.trim());
  return fallback || null;
}

async function readInputValue(page: Page, selector: string): Promise<string> {
  return normalizeNationalityNumber(await page.locator(selector).first().inputValue());
}

function mouseOptions(settings: AppointmentSettings) {
  return {
    minStepDelayMs: settings.minStepDelayMs,
    maxStepDelayMs: settings.maxStepDelayMs,
    overshootProbability: settings.overshootProbability,
  };
}

async function triggerNationalityValidationBlur(
  page: Page,
  settings: AppointmentSettings,
): Promise<void> {
  if (!settings.nationalityNumberBlankClickEnabled) {
    return;
  }

  if (settings.waitAfterNationalityNumberMs > 0) {
    await page.waitForTimeout(settings.waitAfterNationalityNumberMs);
  }

  logger.info("TC doğrulama için boş alana tıklanıyor...");
  await humanClickBlankArea(page, mouseOptions(settings));
}

export async function fillNationalityNumber(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
): Promise<string> {
  if (!settings.nationalityNumberEnabled) {
    throw new Error("TC Kimlik girişi kapalı.");
  }

  const nationalityNumber = resolveNationalityNumber(profile, settings.defaultNationalityNumber);
  if (!nationalityNumber) {
    throw new Error(`${profile.id} için nationalityNumber tanımlı değil.`);
  }

  if (nationalityNumber.length !== TC_DIGIT_COUNT || !isValidTurkishNationalId(nationalityNumber)) {
    throw new Error(`TC Kimlik No geçersiz (${profile.id}).`);
  }

  const masked = maskNationalityNumber(nationalityNumber);
  logger.info(`TC Kimlik No giriliyor: ${masked}`);

  const locators = settings.nationalityNumberLocator
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  let lastError: unknown;
  for (const selector of locators) {
    const input = page.locator(selector).first();
    try {
      await humanTypeIntoLocator(page, input, nationalityNumber, {
        waitTimeoutMs: settings.nationalityNumberTimeoutMs,
        label: `TC Kimlik (${selector})`,
        minCharDelayMs: settings.typeMinCharDelayMs,
        maxCharDelayMs: settings.typeMaxCharDelayMs,
        groupPauseEveryChars: settings.typeGroupPauseEveryChars,
        groupPauseMinMs: settings.typeGroupPauseMinMs,
        groupPauseMaxMs: settings.typeGroupPauseMaxMs,
        minStepDelayMs: settings.minStepDelayMs,
        maxStepDelayMs: settings.maxStepDelayMs,
        overshootProbability: settings.overshootProbability,
      });

      const entered = await readInputValue(page, selector);
      if (entered !== nationalityNumber) {
        throw new Error("TC alanı doğrulanamadı.");
      }

      await triggerNationalityValidationBlur(page, settings);
      return nationalityNumber;
    } catch (error) {
      lastError = error;
      logger.warn(
        `TC Kimlik başarısız (${selector}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(`TC Kimlik No girilemedi (${masked}).`, {
    cause: lastError instanceof Error ? lastError : undefined,
  });
}
