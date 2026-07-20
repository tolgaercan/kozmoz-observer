import type { FlowDefinition } from "./types.js";

/** API-first GetClosedDate watcher — wizard handler yok, observe.ts kullanmaz */
export const KOSMOS_API_WATCHER_V1_FLOW_ID = "kosmos-api-watcher-v1";

export const kosmosApiWatcherV1Flow: FlowDefinition = {
  id: KOSMOS_API_WATCHER_V1_FLOW_ID,
  mode: "api",
  name: "Kosmos API Watcher v1",
  description: "Register sayfasından token → GetClosedDate API poll → booking stub",
  observeTargetStep: 4,
  requiredProfileFields: ["appointmentCity"],
  handlers: {},
};
