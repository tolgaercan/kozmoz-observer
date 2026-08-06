import type { Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import { CalendarPage } from "./CalendarPage.js";
import { HomePage } from "./HomePage.js";
import { WizardPage } from "./WizardPage.js";
import { WizardStep1CityPage } from "./WizardStep1CityPage.js";
import { WizardStep2ApplicationPage } from "./WizardStep2ApplicationPage.js";

export interface PageCollection {
  home: HomePage;
  wizard: WizardPage;
  wizardStep1: WizardStep1CityPage;
  wizardStep2: WizardStep2ApplicationPage;
  calendar: CalendarPage;
}

export function createPageCollection(page: Page, settings: AppSettings): PageCollection {
  return {
    home: new HomePage(page, settings.navigation),
    wizard: new WizardPage(page, settings.appointment),
    wizardStep1: new WizardStep1CityPage(page, settings.appointment),
    wizardStep2: new WizardStep2ApplicationPage(page, settings.appointment),
    calendar: new CalendarPage(page, settings),
  };
}
