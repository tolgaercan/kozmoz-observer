import type { Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import { waitForRecaptchaSolution } from "./recaptchaGate.js";
import {
  detectWizardStep,
  navigateToWizardViewStep,
  WIZARD_OBSERVE_TARGET_STEP,
} from "./wizardStepDetector.js";
import { ensureObserveTargetStep } from "./wizardOrchestrator.js";
import {
  clickWizardNextButton,
  clickWizardPreviousButton,
} from "./wizardNavigation.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";

/** reCAPTCHA takılınca Önceki→Sonraki veya refresh + wizard kurtarma */
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

  const solved = await waitForRecaptchaSolution(
    page,
    appointmentSettings.recaptchaWaitMs,
    appointmentSettings.recaptchaPollIntervalMs,
  );
  if (solved) {
    return true;
  }

  logger.warn("reCAPTCHA çözülmedi — kurtarma adımları deneniyor.");

  if (appointmentSettings.captchaRecoveryTryPreviousNext) {
    try {
      await clickWizardPreviousButton(page, appointmentSettings);
      await page.waitForTimeout(appointmentSettings.captchaRecoveryStepWaitMs);

      await clickWizardNextButton(page, appointmentSettings);
      await page.waitForTimeout(appointmentSettings.captchaRecoveryStepWaitMs);

      const ok = await waitForRecaptchaSolution(
        page,
        appointmentSettings.recaptchaWaitMs,
        appointmentSettings.recaptchaPollIntervalMs,
      );
      if (ok) {
        logger.info("reCAPTCHA kurtarıldı (Önceki → Sonraki).");
        return true;
      }
    } catch (error) {
      logger.warn(
        `Önceki/Sonraki kurtarma başarısız: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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

    await page.waitForTimeout(appointmentSettings.captchaRecoveryStepWaitMs);

    const afterRefresh = await waitForRecaptchaSolution(
      page,
      appointmentSettings.recaptchaWaitMs,
      appointmentSettings.recaptchaPollIntervalMs,
    );
    if (afterRefresh) {
      logger.info("reCAPTCHA kurtarıldı (sayfa yenileme + wizard).");
      return true;
    }
  }

  logger.error("reCAPTCHA kurtarma başarısız — manuel müdahale gerekebilir.");
  return false;
}
