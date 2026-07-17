import type { Page } from "playwright";

import type { NavigationSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";
import { ensureRegisterFormOpen } from "./registerFormNav.js";
import {
  detectRegisterWizardStep,
  isRegisterFormPage,
  navigateToRegisterWizardViewStep,
  type RegisterWizardStepId,
} from "./registerFormWizardDetector.js";

export const REGISTER_STEP_SAME_RETRIES = 3;

export type RegisterStepRecoveryAction = "retry" | "previous_step" | "refresh";

export interface RegisterStepFailureTracker {
  getAttempt(step: RegisterWizardStepId): number;
  recordFailure(step: RegisterWizardStepId): number;
  clear(step: RegisterWizardStepId): void;
}

export function createRegisterStepFailureTracker(): RegisterStepFailureTracker {
  const counts = new Map<RegisterWizardStepId, number>();

  return {
    getAttempt(step) {
      return counts.get(step) ?? 0;
    },
    recordFailure(step) {
      const next = (counts.get(step) ?? 0) + 1;
      counts.set(step, next);
      return next;
    },
    clear(step) {
      counts.delete(step);
    },
  };
}

async function refreshRegisterWizardPage(
  page: Page,
  homeUrl: string,
  navigation: NavigationSettings,
  targetStep: RegisterWizardStepId,
): Promise<void> {
  logger.warn("[register] Son çare — sayfa yenileniyor ve wizard yeniden açılıyor...");

  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[register] reload başarısız (${message}) — form URL'si deneniyor.`);
    await ensureRegisterFormOpen(page, homeUrl, navigation);
  }

  if (!(await isRegisterFormPage(page))) {
    await ensureRegisterFormOpen(page, homeUrl, navigation);
  }

  const state = await detectRegisterWizardStep(page);
  if (state?.isOnRegisterWizard) {
    await navigateToRegisterWizardViewStep(page, targetStep);
    await page.waitForTimeout(800);
  }

  logger.info(`[register] Sayfa yenilendi — hedef adım ${targetStep}.`);
}

/**
 * Adım hatası sonrası kurtarma:
 * 1) Aynı adımda 3 deneme
 * 2) Önceki wizard adımına geç + yeniden dene
 * 3) Sayfa refresh + form yeniden aç
 */
export async function recoverRegisterWizardStep(
  page: Page,
  targetStep: RegisterWizardStepId,
  attempt: number,
  homeUrl: string,
  navigation: NavigationSettings,
): Promise<RegisterStepRecoveryAction> {
  if (attempt <= REGISTER_STEP_SAME_RETRIES) {
    logger.warn(
      `[register] Adım ${targetStep} — aynı adımda tekrar (${attempt}/${REGISTER_STEP_SAME_RETRIES}).`,
    );
    await page.waitForTimeout(700 * attempt);
    return "retry";
  }

  if (attempt === REGISTER_STEP_SAME_RETRIES + 1) {
    const previousStep = Math.max(1, targetStep - 1) as RegisterWizardStepId;
    logger.warn(
      `[register] Adım ${targetStep} — ${REGISTER_STEP_SAME_RETRIES} deneme başarısız; önceki adım ${previousStep}'e dönülüyor.`,
    );
    await navigateToRegisterWizardViewStep(page, previousStep);
    await page.waitForTimeout(1000);
    return "previous_step";
  }

  await refreshRegisterWizardPage(page, homeUrl, navigation, targetStep);
  return "refresh";
}
