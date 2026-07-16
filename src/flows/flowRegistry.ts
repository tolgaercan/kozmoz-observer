import type { FlowDefinition } from "./types.js";
import { kosmosBireyselStandartFlow } from "./kosmosBireyselStandart.flow.js";
import { kosmosObserveV1Flow } from "./kosmosObserveV1.flow.js";
import { kosmosPortalBootstrapFlow } from "./kosmosPortalBootstrap.flow.js";

const flows = new Map<string, FlowDefinition>();

function registerFlow(flow: FlowDefinition): void {
  if (flows.has(flow.id)) {
    throw new Error(`Akış zaten kayıtlı: ${flow.id}`);
  }
  flows.set(flow.id, flow);
}

registerFlow(kosmosPortalBootstrapFlow);
registerFlow(kosmosObserveV1Flow);
registerFlow(kosmosBireyselStandartFlow);

export const DEFAULT_FLOW_ID = kosmosObserveV1Flow.id;
export const DEFAULT_BOOTSTRAP_FLOW_ID = kosmosPortalBootstrapFlow.id;

export function getFlow(flowId: string): FlowDefinition {
  const flow = flows.get(flowId);
  if (!flow) {
    const available = [...flows.keys()].join(", ");
    throw new Error(`Akış bulunamadı: "${flowId}". Mevcut akışlar: ${available}`);
  }
  return flow;
}

export function listFlows(): FlowDefinition[] {
  return [...flows.values()];
}

export function hasFlow(flowId: string): boolean {
  return flows.has(flowId);
}

export function resolveFlowId(
  cliFlowId?: string,
  profileFlowId?: string,
  envDefault?: string,
): string {
  const candidate = cliFlowId?.trim() || profileFlowId?.trim() || envDefault?.trim();
  if (!candidate) {
    return DEFAULT_FLOW_ID;
  }
  return getFlow(candidate).id;
}

export function resolveBootstrapFlowId(profileBootstrapFlowId?: string): string {
  const candidate = profileBootstrapFlowId?.trim() || DEFAULT_BOOTSTRAP_FLOW_ID;
  return getFlow(candidate).id;
}
