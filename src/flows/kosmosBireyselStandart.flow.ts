import type { FlowDefinition, FlowSetupResult, FlowStepContext } from "./types.js";
import { logger } from "../utils/logger.js";
import { advanceWizardAfterAutofill, ensureVisibleWizardFieldsFilled } from "../appointment/wizardStepAutofill.js";
import { detectViewStepFromContent } from "../appointment/wizardStepDetector.js";

export const KOSMOS_BIREYSEL_STANDART_FLOW_ID = "kosmos-bireysel-standart";

async function runStep1(ctx: FlowStepContext): Promise<Partial<FlowSetupResult>> {
  const partial = await ctx.pages.wizardStep1.complete(ctx.profile);
  return {
    city: partial.city,
    wizardStep: partial.wizardStep,
  };
}

/** Portal adım 2 — Şube (form alanları yoksa Sonraki) */
async function runStep2Branch(ctx: FlowStepContext): Promise<Partial<FlowSetupResult>> {
  const contentStep = await detectViewStepFromContent(ctx.page);
  if (contentStep !== null && contentStep >= 3) {
    logger.info("[flow][step-2] Ekranda bilgi formu — adım 3 handler'a yönlendiriliyor.");
    return runStep3Form(ctx);
  }

  logger.info("[flow][step-2] Şube / ara adım — boş alan kontrolü → Sonraki");
  await ensureVisibleWizardFieldsFilled(ctx.page, ctx.profile, ctx.appointment);
  await advanceWizardAfterAutofill(ctx.page, ctx.profile, ctx.appointment);
  return { wizardStep: 2 };
}

/** Portal adım 3 — Bilgilerinizi Girin */
async function runStep3Form(ctx: FlowStepContext): Promise<Partial<FlowSetupResult>> {
  logger.info("[flow][step-3] Bilgiler formu — boş alan kontrolü → Sonraki");
  await ensureVisibleWizardFieldsFilled(ctx.page, ctx.profile, ctx.appointment);
  await advanceWizardAfterAutofill(ctx.page, ctx.profile, ctx.appointment);

  return {
    wizardStep: 3,
    city: ctx.profile.appointmentCity,
    applicationType: ctx.profile.applicationType,
    nationalityNumber: ctx.profile.nationalityNumber,
    appointmentStyle: ctx.profile.appointmentStyle,
  };
}

/**
 * Spec: Kozmos vize portalı — Bireysel / Standart — takvim gözlemi
 */
export const kosmosBireyselStandartFlow: FlowDefinition = {
  id: KOSMOS_BIREYSEL_STANDART_FLOW_ID,
  name: "Kozmos Bireysel Standart",
  description: "İkamet → Şube → Bireysel/TC/Standart → takvim slot gözlemi",
  observeTargetStep: 4,
  requiredProfileFields: [
    "appointmentCity",
    "applicationType",
    "nationalityNumber",
    "appointmentStyle",
  ],
  handlers: {
    1: runStep1,
    2: runStep2Branch,
    3: runStep3Form,
  },
};
