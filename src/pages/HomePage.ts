import type { Page } from "playwright";

import type { NavigationSettings } from "../config/settings.js";
import { clickNavigationTarget } from "../navigation/targetNavigator.js";

/** Ana sayfa — randevu akışına giriş navigasyonu */
export class HomePage {
  constructor(
    private readonly page: Page,
    private readonly navigation: NavigationSettings,
  ) {}

  async navigateToAppointmentForm(): Promise<void> {
    await clickNavigationTarget(this.page, this.navigation);
  }
}
