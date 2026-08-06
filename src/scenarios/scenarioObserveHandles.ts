import type { ApiWatcherHandle } from "../api/types.js";
import type { InterventionWatcher } from "../challenge/interventionWatcher.js";

/** API watcher fazı — senaryo kapanırken durdurulur */
export interface ScenarioObserveHandles {
  interventionWatcher?: InterventionWatcher | null;
  apiWatcher?: ApiWatcherHandle | null;
}
