import type { Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";
import { isSlotCycleRunning } from "./slotCycleLock.js";
import {
  detectWizardStep,
  formatWizardStepLog,
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
    if (recovering || isSlotCycleRunning()) {
      return;
    }

    try {
      const state = await detectWizardStep(page, appointmentSettings.wizardNavLocator);

      if (!state?.isOnWizard) {
        if (!observeTargetReached) {
          return;
        }

        recovering = true;
        logger.warn(
          "[wizard-guard] Wizard kayboldu (sayfa yenileme veya başa dönüş) — adım 3'e otomatik dönülüyor.",
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

      if (progress >= WIZARD_OBSERVE_TARGET_STEP) {
        if (!observeTargetReached) {
          logger.info(`[wizard-guard] Hedef ilerleme: ${formatWizardStepLog(state)}`);
        }
        observeTargetReached = true;

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
