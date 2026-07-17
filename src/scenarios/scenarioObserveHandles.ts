import type { AppointmentSlotWatcherHandle } from "../appointment/appointmentSlotWatcher.js";
import type { WizardStepGuardHandle } from "../appointment/wizardStepGuard.js";
import type { InterventionWatcher } from "../challenge/interventionWatcher.js";

/** Observer fazı watcher'ları — senaryo kapanırken durdurulur */
export interface ScenarioObserveHandles {
  slotWatcher?: AppointmentSlotWatcherHandle | null;
  wizardStepGuard?: WizardStepGuardHandle | null;
  interventionWatcher?: InterventionWatcher | null;
}
