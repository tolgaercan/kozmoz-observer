import type { Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";
import { ensureStableRecaptchaOrEscape } from "./captchaSession.js";
import {
  detectWizardStep,
  navigateToWizardViewStep,
  WIZARD_OBSERVE_TARGET_STEP,
} from "./wizardStepDetector.js";
import { ensureObserveTargetStep } from "./wizardOrchestrator.js";

/** @deprecated ensureStableRecaptchaOrEscape kullanın — geriye dönük uyumluluk */
export async function recoverCalendarPageAccess(
  page: Page,
  profile: ResolvedProfile,
  settings: AppSettings,
): Promise<boolean> {
  const appointmentSettings = settings.appointment;
  if (!appointmentSettings.captchaRecoveryEnabled) {
    logger.info("reCAPTCHA kurtarma kapalı — CAPTCHA_RECOVERY_ENABLED=false");
    return false;
  }

  const ok = await ensureStableRecaptchaOrEscape(page, appointmentSettings);
  if (ok) {
    return true;
  }

  if (appointmentSettings.captchaRecoveryTryRefresh) {
    logger.info("Sayfa yenileniyor — wizard otomatik kurtarma devreye girecek...");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(appointmentSettings.captchaRecoveryStepWaitMs);

    await ensureObserveTargetStep(page, profile, settings);

    const state = await detectWizardStep(page, appointmentSettings.wizardNavLocator);
    if ((state?.progressStep ?? 0) >= WIZARD_OBSERVE_TARGET_STEP) {
      await navigateToWizardViewStep(
        page,
        WIZARD_OBSERVE_TARGET_STEP,
        appointmentSettings.wizardNavLocator,
      );
    }

    return ensureStableRecaptchaOrEscape(page, appointmentSettings);
  }

  logger.error("reCAPTCHA kurtarma başarısız — manuel müdahale gerekebilir.");
  return false;
}
