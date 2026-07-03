import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { runStep2InformationFlow } from "../appointment/postCityFlow.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";
import type { WizardFlowResult } from "../appointment/postCityFlow.js";

/** Wizard adım 2 — Başvuru bilgileri formu */
export class WizardStep2ApplicationPage {
  constructor(
    private readonly page: Page,
    private readonly settings: AppointmentSettings,
  ) {}

  async fillFormAndNext(profile: ResolvedProfile): Promise<WizardFlowResult> {
    logger.info("[flow][step-2] Başvuru tipi, TC, başvuru şekli");
    return runStep2InformationFlow(this.page, profile, this.settings);
  }
}
