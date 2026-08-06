import type { Page } from "playwright";

import type { AppointmentSettings, AppSettings, NavigationSettings, TelegramSettings } from "../config/settings.js";
import type { PageCollection } from "../pages/PageFactory.js";
import type { ProfileFormData, ResolvedProfile } from "../profiles/profileManager.js";
import type { WizardStepId, WizardStepState } from "../appointment/wizardStepDetector.js";

/** Akış kurulum fazının sonucu — wizard doldurma tamamlandığında */
export interface FlowSetupResult {
  city?: string;
  applicationType?: string;
  nationalityNumber?: string;
  appointmentStyle?: string;
  wizardStep?: WizardStepId;
  wizardViewStep?: WizardStepId;
  observeTargetReached: boolean;
}

export interface FlowStepContext {
  page: Page;
  profile: ResolvedProfile;
  form: ProfileFormData;
  pages: PageCollection;
  appointment: AppointmentSettings;
  navigation: NavigationSettings;
  wizardState: WizardStepState;
}

export type FlowMode = "wizard" | "api";

export interface FlowDefinition {
  id: string;
  name: string;
  description?: string;
  /** wizard = takvim DOM | api = HTTP watcher (handler yok) */
  mode?: FlowMode;
  /** Gözlem hedefi wizard adımı (api modunda kullanılmaz) */
  observeTargetStep: WizardStepId;
  /** Profilden zorunlu form alanları */
  requiredProfileFields: (keyof ProfileFormData)[];
  /** Wizard ilerleme adımına göre handler */
  handlers: Partial<Record<WizardStepId, (ctx: FlowStepContext) => Promise<Partial<FlowSetupResult>>>>;
}

export interface FlowRunContext {
  page: Page;
  profile: ResolvedProfile;
  form: ProfileFormData;
  pages: PageCollection;
  settings: AppSettings;
  telegram: TelegramSettings;
}

export interface FlowRunOptions {
  maxRounds?: number;
}
