import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { selectProfileCity } from "../appointment/citySelector.js";
import { runStep1AfterCitySelection } from "../appointment/postCityFlow.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";
import type { WizardFlowResult } from "../appointment/postCityFlow.js";

/** Wizard adım 1 — İkamet / il seçimi */
export class WizardStep1CityPage {
  constructor(
    private readonly page: Page,
    private readonly settings: AppointmentSettings,
  ) {}

  async selectCity(profile: ResolvedProfile): Promise<void> {
    logger.info("[flow][step-1] İl seçimi");
    await selectProfileCity(this.page, profile, this.settings);
  }

  async confirmLocationAndNext(profile: ResolvedProfile): Promise<WizardFlowResult> {
    logger.info("[flow][step-1] Konum onayı ve Sonraki");
    return runStep1AfterCitySelection(this.page, profile, this.settings);
  }

  async complete(profile: ResolvedProfile): Promise<WizardFlowResult> {
    await this.selectCity(profile);
    return this.confirmLocationAndNext(profile);
  }
}
