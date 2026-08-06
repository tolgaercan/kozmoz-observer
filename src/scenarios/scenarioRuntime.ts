import type { BrowserSession } from "../browser/contextFactory.js";
import type { AppSettings } from "../config/settings.js";
import type { ProfileManager } from "../profiles/profileManager.js";
import type { ScenarioRunOptions } from "./types.js";
import type { ScenarioObserveHandles } from "./scenarioObserveHandles.js";

/** Senaryo boyunca paylaşılan Chrome/CDP oturumu */
export class ScenarioRuntime {
  session: BrowserSession | null = null;
  readonly observeHandles: ScenarioObserveHandles = {};
  scenarioUsesSystemProfile = false;
  banSafe = false;

  constructor(
    readonly projectRoot: string,
    readonly settings: AppSettings,
    readonly profileManager: ProfileManager,
    readonly profileId: string,
    readonly runOptions: ScenarioRunOptions,
  ) {}

  async closeSession(): Promise<void> {
    this.observeHandles.apiWatcher?.stop();
    this.observeHandles.apiWatcher = null;
    this.observeHandles.interventionWatcher?.stopContinuousWatch();
    this.observeHandles.interventionWatcher = null;

    if (this.session) {
      await this.session.context.close().catch(() => {});
      this.session = null;
    }
  }
}
