import type { FlowDefinition, FlowRunContext, FlowRunOptions, FlowSetupResult, FlowStepContext } from "./types.js";
import { clickNavigationTarget } from "../navigation/targetNavigator.js";
import { logger } from "../utils/logger.js";
import {
  detectViewStepFromContent,
  type WizardStepId,
  type WizardStepState,
} from "../appointment/wizardStepDetector.js";

function emptyResult(): FlowSetupResult {
  return { observeTargetReached: false };
}

function mergeResult(
  target: FlowSetupResult,
  partial: Partial<FlowSetupResult>,
): void {
  if (partial.city !== undefined) target.city = partial.city;
  if (partial.applicationType !== undefined) target.applicationType = partial.applicationType;
  if (partial.nationalityNumber !== undefined) target.nationalityNumber = partial.nationalityNumber;
  if (partial.appointmentStyle !== undefined) target.appointmentStyle = partial.appointmentStyle;
  if (partial.wizardStep !== undefined) target.wizardStep = partial.wizardStep;
  if (partial.wizardViewStep !== undefined) target.wizardViewStep = partial.wizardViewStep;
  if (partial.observeTargetReached !== undefined) {
    target.observeTargetReached = partial.observeTargetReached;
  }
}

function resolveWizardActionStep(
  state: WizardStepState,
  contentStep: WizardStepId | null,
): WizardStepId | null {
  if (contentStep !== null) {
    return contentStep;
  }
  return state.progressStep ?? state.viewStep ?? null;
}

/**
 * Test spec runner — wizard döngüsü + akış handler'ları.
 * Her tur: adım tespit → hedefe ulaşıldı mı → flow handler çalıştır.
 */
export async function runFlowSetup(
  flow: FlowDefinition,
  ctx: FlowRunContext,
  options: FlowRunOptions = {},
): Promise<FlowSetupResult> {
  const maxRounds = options.maxRounds ?? 8;
  const observeTargetStep = flow.observeTargetStep;
  const { page, profile, form, pages, settings } = ctx;
  const appointment = settings.appointment;
  const navigation = settings.navigation;

  const result = emptyResult();

  logger.info(`[flow:${flow.id}] Kurulum başlıyor — profil: ${profile.id}`);

  for (let round = 1; round <= maxRounds; round++) {
    let state = await pages.wizard.detectStep();

    if (!pages.wizard.isOnWizard(state)) {
      logger.info(
        `[flow:${flow.id}] [wizard ${round}/${maxRounds}] Form görünmüyor — randevu akışına gidiliyor.`,
      );
      await clickNavigationTarget(page, navigation, {
        homeUrl: settings.visaPortalHomeUrl,
      });
      if (appointment.waitAfterNavMs > 0) {
        await page.waitForTimeout(appointment.waitAfterNavMs);
      }
      state = await pages.wizard.detectStep();
    }

    if (!state || !pages.wizard.isOnWizard(state)) {
      throw new Error("Randevu wizard yüklenemedi — nav bar veya form alanları bulunamadı.");
    }

    logger.info(
      `[flow:${flow.id}] [wizard ${round}/${maxRounds}] ${pages.wizard.formatStepLog(state)}`,
    );

    const progress = state.progressStep ?? 0;

    if (progress >= observeTargetStep || state.observeTargetReached) {
      logger.info(
        `[flow:${flow.id}] Hedef adım ${observeTargetStep}+ — gözlem fazına hazır.`,
      );
      result.wizardStep = (state.progressStep ?? observeTargetStep) as WizardStepId;
      result.wizardViewStep = state.viewStep ?? undefined;
      result.observeTargetReached = true;
      return result;
    }

    state = await pages.wizard.syncViewWithProgress(state);

    const contentStep = await detectViewStepFromContent(page);
    const actionStep = resolveWizardActionStep(state, contentStep);
    if (contentStep !== null && contentStep !== state.progressStep) {
      logger.info(
        `[flow:${flow.id}] Ekran adımı=${contentStep}, nav ilerleme=${state.progressStep ?? "?"} — handler adım ${actionStep}.`,
      );
    }

    const step = actionStep;
    if (!step) {
      logger.warn(`[flow:${flow.id}] İlerleme adımı belirlenemedi — durduruldu.`);
      result.wizardStep = undefined;
      return result;
    }

    const handler = flow.handlers[step];
    if (!handler) {
      logger.warn(
        `[flow:${flow.id}] Adım ${step} için handler tanımlı değil — durduruldu.`,
      );
      result.wizardStep = step;
      return result;
    }

    const stepCtx: FlowStepContext = {
      page,
      profile,
      form,
      pages,
      appointment,
      navigation,
      wizardState: state,
    };

    logger.info(`[flow:${flow.id}] Adım ${step} handler çalışıyor...`);
    const stepResult = await handler(stepCtx);
    mergeResult(result, stepResult);

    await pages.wizard.waitAfterStep();
  }

  const finalState = await pages.wizard.detectStep();
  if ((finalState?.progressStep ?? 0) >= observeTargetStep) {
    result.wizardStep = (finalState?.progressStep ?? observeTargetStep) as WizardStepId;
    result.wizardViewStep = finalState?.viewStep ?? undefined;
    result.observeTargetReached = true;
    return result;
  }

  throw new Error(
    `[flow:${flow.id}] Hedef adıma ulaşılamadı (${maxRounds} tur). Son ilerleme: ${finalState?.progressStep ?? "?"}`,
  );
}
