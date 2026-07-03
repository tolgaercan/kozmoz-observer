import type { Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import {
  startAppointmentSlotWatcher,
  type AppointmentSlotWatcherHandle,
} from "../appointment/appointmentSlotWatcher.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";

/** Wizard adım 3 — Takvim / slot gözlemi */
export class CalendarPage {
  constructor(
    private readonly page: Page,
    private readonly settings: AppSettings,
  ) {}

  startSlotWatcher(
    profile: ResolvedProfile,
    city?: string,
  ): AppointmentSlotWatcherHandle {
    logger.info("[flow][observe] Takvim slot gözlemi başlatılıyor");
    return startAppointmentSlotWatcher(this.page, profile, this.settings, { city });
  }
}
