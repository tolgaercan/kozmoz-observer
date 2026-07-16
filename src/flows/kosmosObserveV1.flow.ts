import type { FlowDefinition } from "./types.js";
import { kosmosBireyselStandartFlow } from "./kosmosBireyselStandart.flow.js";

/** v1 Observer — wizard + slot watcher + Telegram */
export const kosmosObserveV1Flow: FlowDefinition = {
  ...kosmosBireyselStandartFlow,
  id: "kosmos-observe-v1",
  name: "Kozmos Observer v1",
  description: "Bootstrap sonrası wizard 1–3 + takvim gözlemi + Telegram bildirimi",
};
