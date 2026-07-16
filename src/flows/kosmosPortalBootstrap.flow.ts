import type { FlowDefinition, FlowSetupResult, FlowStepContext } from "./types.js";

async function runBootstrapPlaceholder(ctx: FlowStepContext): Promise<Partial<FlowSetupResult>> {
  void ctx;
  return {};
}

/**
 * Portal bootstrap — mail/şifre + kayıt girişi (Adım B'de implement edilecek).
 * Observer ve Processor modları bu akışı paylaşır.
 */
export const kosmosPortalBootstrapFlow: FlowDefinition = {
  id: "kosmos-portal-bootstrap",
  name: "Kozmos Portal Bootstrap",
  description: "Mail/şifre girişi → oturum kontrolü → kayıt/randevu giriş noktası (Adım B)",
  observeTargetStep: 1,
  requiredProfileFields: [],
  handlers: {
    1: runBootstrapPlaceholder,
  },
};
