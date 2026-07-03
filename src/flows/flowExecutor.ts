import type { Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import {
  applyFormToProfile,
  resolveProfileForm,
  validateProfileFormForFlow,
} from "../profiles/profileContext.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { createPageCollection } from "../pages/PageFactory.js";
import { getFlow, resolveFlowId } from "./flowRegistry.js";
import { runFlowSetup } from "./flowRunner.js";
import type { FlowSetupResult } from "./types.js";
import { logger } from "../utils/logger.js";

export interface ExecuteProfileFlowOptions {
  flowRef?: string;
  maxRounds?: number;
  /** true ise zorunlu alan eksikliğinde hata fırlatmaz, uyarı verir */
  softValidate?: boolean;
}

/**
 * Profil + akış spec'ini çalıştırır (test koşturma giriş noktası).
 */
export async function executeProfileFlow(
  page: Page,
  profile: ResolvedProfile,
  settings: AppSettings,
  options: ExecuteProfileFlowOptions = {},
): Promise<FlowSetupResult> {
  const flowId = resolveFlowId(options.flowRef, profile.flowId, settings.defaultFlowId);
  const flow = getFlow(flowId);
  const form = resolveProfileForm(profile, settings);

  const formErrors = validateProfileFormForFlow(
    form,
    flow.requiredProfileFields,
    flowId,
    profile.id,
  );

  if (formErrors.length > 0) {
    const message = formErrors.join("\n");
    if (options.softValidate) {
      for (const err of formErrors) {
        logger.warn(`[preflight-flow] ${err}`);
      }
    } else {
      throw new Error(message);
    }
  }

  const enrichedProfile = applyFormToProfile(profile, form);
  const pages = createPageCollection(page, settings);

  logger.info(
    `[flow:${flow.id}] Senaryo: ${flow.name} — profil: ${profile.id} (${profile.name})`,
  );

  return runFlowSetup(
    flow,
    {
      page,
      profile: enrichedProfile,
      form,
      pages,
      settings,
      telegram: settings.telegram,
    },
    { maxRounds: options.maxRounds },
  );
}

/** WizardFlowResult uyumluluğu için dönüştürücü */
export function toWizardFlowResult(result: FlowSetupResult) {
  return {
    city: result.city,
    applicationType: result.applicationType,
    nationalityNumber: result.nationalityNumber,
    appointmentStyle: result.appointmentStyle,
    wizardStep: result.wizardStep,
    wizardViewStep: result.wizardViewStep,
  };
}
