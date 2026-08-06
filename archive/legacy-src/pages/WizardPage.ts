import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { advanceWizardAfterAutofill } from "../appointment/wizardStepAutofill.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import {
  detectWizardStep,
  ensureWizardViewMatchesProgress,
  formatWizardStepLog,
  navigateToWizardViewStep,
  type WizardStepId,
  type WizardStepState,
} from "../appointment/wizardStepDetector.js";
import { logger } from "../utils/logger.js";

/** Wizard genel navigasyon ve adım tespiti */
export class WizardPage {
  constructor(
    private readonly page: Page,
    private readonly settings: AppointmentSettings,
  ) {}

  get navLocator(): string {
    return this.settings.wizardNavLocator;
  }

  async detectStep(): Promise<WizardStepState | null> {
    return detectWizardStep(this.page, this.navLocator);
  }

  formatStepLog(state: WizardStepState): string {
    return formatWizardStepLog(state);
  }

  async syncViewWithProgress(state: WizardStepState): Promise<WizardStepState> {
    return ensureWizardViewMatchesProgress(this.page, state, this.navLocator);
  }

  async navigateToViewStep(step: WizardStepId): Promise<void> {
    await navigateToWizardViewStep(this.page, step, this.navLocator);
  }

  async clickNext(profile: ResolvedProfile): Promise<void> {
    await advanceWizardAfterAutofill(this.page, profile, this.settings);
  }

  async waitAfterStep(): Promise<void> {
    if (this.settings.waitAfterWizardStepMs > 0) {
      await pageWait(this.page, this.settings.waitAfterWizardStepMs);
    }
  }

  isOnWizard(state: WizardStepState | null): boolean {
    return state?.isOnWizard === true;
  }
}

function pageWait(page: Page, ms: number): Promise<void> {
  return page.waitForTimeout(ms);
}

export function logWizardStep(round: number, maxRounds: number, state: WizardStepState): void {
  logger.info(`[wizard ${round}/${maxRounds}] ${formatWizardStepLog(state)}`);
}
