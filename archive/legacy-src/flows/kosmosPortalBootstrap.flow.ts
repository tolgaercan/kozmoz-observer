import type { FlowDefinition, FlowSetupResult, FlowStepContext } from "./types.js";

async function runBootstrapPlaceholder(ctx: FlowStepContext): Promise<Partial<FlowSetupResult>> {
  void ctx;
  return {};
}

/**
 * Portal bootstrap — oturum + kayıt formu (registerForm wizard).
 * Adım 1: Kimlik Doğrulama — runRegisterFormSetup (observer checkpoint).
 */
export const kosmosPortalBootstrapFlow: FlowDefinition = {
  id: "kosmos-portal-bootstrap",
  name: "Kozmos Portal Bootstrap",
  description: "Portal girişi → Başvuru Formu kayıt wizard (Kimlik Doğrulama …)",
  observeTargetStep: 1,
  requiredProfileFields: [],
  handlers: {
    1: runBootstrapPlaceholder,
  },
};
