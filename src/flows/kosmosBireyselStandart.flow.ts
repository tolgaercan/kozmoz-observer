import type { FlowDefinition, FlowSetupResult, FlowStepContext } from "./types.js";

export const KOSMOS_BIREYSEL_STANDART_FLOW_ID = "kosmos-bireysel-standart";

async function runStep1(ctx: FlowStepContext): Promise<Partial<FlowSetupResult>> {
  const partial = await ctx.pages.wizardStep1.complete(ctx.profile);
  return {
    city: partial.city,
    wizardStep: partial.wizardStep,
  };
}

async function runStep2(ctx: FlowStepContext): Promise<Partial<FlowSetupResult>> {
  const partial = await ctx.pages.wizardStep2.fillFormAndNext(ctx.profile);
  return {
    city: partial.city,
    applicationType: partial.applicationType,
    nationalityNumber: partial.nationalityNumber,
    appointmentStyle: partial.appointmentStyle,
    wizardStep: partial.wizardStep,
  };
}

/**
 * Spec: Kozmos vize portalı — Bireysel / Standart — takvim gözlemi
 *
 * Arrange: profil form verileri (manifest + .env)
 * Act:     wizard adım 1 → 2 → 3
 * Assert:  adım 3'e ulaş → slot watcher (observe fazı)
 */
export const kosmosBireyselStandartFlow: FlowDefinition = {
  id: KOSMOS_BIREYSEL_STANDART_FLOW_ID,
  name: "Kozmos Bireysel Standart",
  description: "İkamet → Bireysel/TC/Standart form → takvim slot gözlemi",
  observeTargetStep: 3,
  requiredProfileFields: [
    "appointmentCity",
    "applicationType",
    "nationalityNumber",
    "appointmentStyle",
  ],
  handlers: {
    1: runStep1,
    2: runStep2,
  },
};
