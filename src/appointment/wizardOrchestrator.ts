import type { Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import type { WizardStepId } from "./wizardStepDetector.js";
import { executeProfileFlow, toWizardFlowResult } from "../flows/flowExecutor.js";
import type { WizardFlowResult } from "./postCityFlow.js";

export interface WizardOrchestratorOptions {
  maxRounds?: number;
  flowRef?: string;
  observeTargetStep?: WizardStepId;
}

/**
 * @deprecated executeProfileFlow kullanın — geriye dönük uyumluluk için korunuyor.
 */
export async function ensureObserveTargetStep(
  page: Page,
  profile: ResolvedProfile,
  settings: AppSettings,
  options: WizardOrchestratorOptions = {},
): Promise<WizardFlowResult> {
  const result = await executeProfileFlow(page, profile, settings, {
    maxRounds: options.maxRounds,
    flowRef: options.flowRef,
    softValidate: true,
  });

  return toWizardFlowResult(result);
}
