import type { Page } from "playwright";

import type { NavigationSettings } from "../config/settings.js";
import { navigateKosmosAppointmentFlow } from "../navigation/kosmosPortalNav.js";
import { resetMousePosition } from "../interaction/humanMouse.js";
import { logger } from "../utils/logger.js";

/** Ana sayfa — randevu akışına giriş navigasyonu */
export class HomePage {
  constructor(
    private readonly page: Page,
    private readonly navigation: NavigationSettings,
  ) {}

  async navigateToAppointmentForm(): Promise<void> {
    await navigateKosmosAppointmentFlow(this.page, this.navigation);
  }
}
