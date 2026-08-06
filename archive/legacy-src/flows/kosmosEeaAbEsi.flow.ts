import type { FlowDefinition } from "./types.js";
import { kosmosBireyselStandartFlow } from "./kosmosBireyselStandart.flow.js";

/**
 * Ankara + EEA AB Eşi başvuru şekli — takvim slot doğrulama akışı.
 * Handler'lar bireysel akışla aynı; fark profil manifest (appointmentStyle) verisindedir.
 */
export const kosmosEeaAbEsiStandartFlow: FlowDefinition = {
  ...kosmosBireyselStandartFlow,
  id: "kosmos-eea-ab-esi-standart",
  name: "Kozmos EEA AB Eşi",
  description: "Ankara → EEA AB Eşi → takvim slot gözlemi (algoritma doğrulama)",
  requiredProfileFields: [
    "appointmentCity",
    "applicationType",
    "nationalityNumber",
    "appointmentStyle",
  ],
};

/** Observer — profile-2 ile kullanılır */
export const kosmosEeaAbEsiObserveV1Flow: FlowDefinition = {
  ...kosmosEeaAbEsiStandartFlow,
  id: "kosmos-eea-ab-esi-v1",
  name: "Kozmos EEA AB Eşi Observer v1",
  description: "EEA AB Eşi randevu wizard + takvim tarama + Telegram",
};
