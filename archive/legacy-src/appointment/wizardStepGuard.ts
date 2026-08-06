import type { Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { isKosmosPortalUrl } from "../portal/kosmosOrigin.js";
import { logger } from "../utils/logger.js";
import { isCaptchaLockEngaged } from "./captchaSession.js";
import { isSlotCycleRunning } from "./slotCycleLock.js";
import {
  detectWizardStep,
  formatWizardStepLog,
  isCalendarStepVisible,
  navigateToWizardViewStep,
  WIZARD_OBSERVE_TARGET_STEP,
} from "./wizardStepDetector.js";
import { ensureObserveTargetStep } from "./wizardOrchestrator.js";

export interface WizardStepGuardHandle {
  stop: () => void;
}

export interface WizardStepGuardOptions {
  targetReached?: boolean;
  onRecovered?: () => void;
  /** Takvim adımına ulaşıldığında (slot watcher vb.) */
  onObserveTargetReady?: () => void;
  flowRef?: string;
}

/** İlerleme gerilediğinde otomatik doldur; hedef adımda görünüm gerideyse takvim sekmesine geç */
export function startWizardStepGuard(
  page: Page,
  profile: ResolvedProfile,
  settings: AppSettings,
  options: WizardStepGuardOptions = {},
): WizardStepGuardHandle {
  const appointmentSettings = settings.appointment;

  if (!appointmentSettings.wizardAutoRecoverEnabled) {
    logger.info("Wizard otomatik kurtarma kapalı — WIZARD_AUTO_RECOVER_ENABLED=false");
    return { stop: () => undefined };
  }

  let recovering = false;
  let observeTargetReached = options.targetReached ?? false;

  const intervalMs = appointmentSettings.wizardRecoverCheckIntervalMs;
  logger.info(`Wizard adım gözlemi başladı (aralık: ${intervalMs}ms, hedef ilerleme: adım ${WIZARD_OBSERVE_TARGET_STEP}+).`);

  const timer = setInterval(async () => {
    if (recovering || isSlotCycleRunning() || isCaptchaLockEngaged()) {
      return;
    }

    try {
      const state = await detectWizardStep(page, appointmentSettings.wizardNavLocator);

      if (!state?.isOnWizard) {
        if (!observeTargetReached) {
          const url = page.url();
          if (isKosmosPortalUrl(url)) {
            recovering = true;
            logger.info(
              "[wizard-guard] Wizard görünmüyor — Randevu Al akışı başlatılıyor (Randevu İşlemleri).",
            );
            await ensureObserveTargetStep(page, profile, settings, {
              flowRef: options.flowRef,
            });
            options.onRecovered?.();
          }
          return;
        }

        recovering = true;
        logger.warn(
          "[wizard-guard] Wizard kayboldu (sayfa yenileme veya başa dönüş) — takvim adımına otomatik dönülüyor.",
        );

        await ensureObserveTargetStep(page, profile, settings, {
          flowRef: options.flowRef,
        });

        options.onRecovered?.();

        const after = await detectWizardStep(page, appointmentSettings.wizardNavLocator);
        if ((after?.progressStep ?? 0) >= WIZARD_OBSERVE_TARGET_STEP) {
          logger.info("[wizard-guard] Sayfa kurtarıldı — randevu tarihi adımına geri dönüldü.");
        }
        return;
      }

      const progress = state.progressStep ?? 0;

      if (!observeTargetReached && state.isOnWizard && progress > 0 && progress < WIZARD_OBSERVE_TARGET_STEP) {
        recovering = true;
        logger.info(
          `[wizard-guard] Wizard adım ${progress} — otomasyon ilerletiliyor (${formatWizardStepLog(state)}).`,
        );
        await ensureObserveTargetStep(page, profile, settings, {
          flowRef: options.flowRef,
        });
        options.onRecovered?.();
        const afterAdvance = await detectWizardStep(page, appointmentSettings.wizardNavLocator);
        if (afterAdvance) {
          const calendarVisible = await isCalendarStepVisible(
            page,
            appointmentSettings.slotCalendarLocator,
          );
          if (
            calendarVisible ||
            (afterAdvance.progressStep ?? 0) >= WIZARD_OBSERVE_TARGET_STEP
          ) {
            observeTargetReached = true;
            options.onObserveTargetReady?.();
          }
        }
        return;
      }

      if (progress >= WIZARD_OBSERVE_TARGET_STEP) {
        if (!observeTargetReached) {
          const calendarVisible = await isCalendarStepVisible(
            page,
            appointmentSettings.slotCalendarLocator,
          );
          if (calendarVisible) {
            observeTargetReached = true;
            logger.info(
              `[wizard-guard] Takvim adımı hazır — ${formatWizardStepLog(state)}`,
            );
            options.onObserveTargetReady?.();
          }
        }

        if (!observeTargetReached) {
          return;
        }

        if (!options.targetReached && observeTargetReached) {
          logger.info(`[wizard-guard] Hedef ilerleme: ${formatWizardStepLog(state)}`);
        }

        if (state.isViewingPastStep && state.progressStep) {
          logger.info(
            `[wizard-guard] İlerleme=${state.progressStep} ama ekranda adım ${state.viewStep} — doğru sekmeye geçiliyor.`,
          );
          await navigateToWizardViewStep(
            page,
            state.progressStep,
            appointmentSettings.wizardNavLocator,
          );
        }
        return;
      }

      if (!observeTargetReached) {
        return;
      }

      recovering = true;
      logger.warn(
        `[wizard-guard] İlerleme geriledi (${formatWizardStepLog(state)}) — otomatik doldurma başlıyor.`,
      );

      await ensureObserveTargetStep(page, profile, settings, {
        flowRef: options.flowRef,
      });

      options.onRecovered?.();

      const after = await detectWizardStep(page, appointmentSettings.wizardNavLocator);
      if ((after?.progressStep ?? 0) >= WIZARD_OBSERVE_TARGET_STEP) {
        logger.info("[wizard-guard] Kurtarma tamamlandı — randevu tarihi ilerleme adımında.");
      }
    } catch (error) {
      logger.warn(
        `[wizard-guard] ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      recovering = false;
    }
  }, intervalMs);

  return {
    stop: () => {
      clearInterval(timer);
      logger.info("Wizard adım gözlemi durduruldu.");
    },
  };
}
