import type { Page } from "playwright";

import type { AppointmentSettings } from "../../config/settings.js";
import type { ResolvedProfile } from "../../profiles/profileManager.js";
import { logger } from "../../utils/logger.js";
import { navigateToWizardViewStep } from "../../portal/wizardStepDetector.js";
import { WIZARD_STEP } from "../../portal/wizardSteps.js";
import { clickWizardNextButton } from "../../portal/wizardNavigation.js";
import {
  advanceWizardStep1ToStep2Only,
  ensureApiPollStep1FieldsFilled,
} from "../../portal/wizardStepAutofill.js";
import type { ApiQueryParams } from "../client/resolveApiQueryParams.js";
import { withPortalCheckpoint } from "../../portal/interventions/portalCheckpoint.js";

/** Step 2 (Bilgiler) sekmesine geri dön — watch modu. */
export async function retreatToApplicantInfoStep(
  page: Page,
  navLocator: string,
): Promise<void> {
  logger.info("[booking] Step 2 (Bilgiler) görünümüne geri dönülüyor.");
  await navigateToWizardViewStep(page, WIZARD_STEP.APPLICANT_INFO, navLocator);
  await page.waitForTimeout(400);
}

/**
 * Step 1 doldur → Sonraki → Step 2 görünümü.
 * Step 2 alan doldurma locator'ları gelince buraya bağlanacak.
 */
export async function advanceToApplicantInfoStep(
  page: Page,
  profile: ResolvedProfile,
  appointmentSettings: AppointmentSettings,
  queryParams: ApiQueryParams,
): Promise<void> {
  await withPortalCheckpoint(page, { profile }, async () => {
    await ensureApiPollStep1FieldsFilled(page, profile, appointmentSettings, queryParams);
    await advanceWizardStep1ToStep2Only(page, profile, appointmentSettings, queryParams);
  });
}

/** Step 2 hazır → Sonraki → Step 3 (Takvim). */
export async function advanceToCalendarStep(
  page: Page,
  profile: ResolvedProfile,
  appointmentSettings: AppointmentSettings,
): Promise<void> {
  logger.info("[booking] Step 2 → Step 3 (Takvim) — Sonraki.");
  await withPortalCheckpoint(page, { profile }, async () => {
    await clickWizardNextButton(page, appointmentSettings);
    await page.waitForTimeout(appointmentSettings.waitAfterWizardNextMs || 400);
  });
  await page.waitForTimeout(600);
}

/** Step 3 hazır → Sonraki → Step 4 (Onay / özet). */
export async function advanceToSummaryStep(
  page: Page,
  profile: ResolvedProfile,
  appointmentSettings: AppointmentSettings,
): Promise<void> {
  logger.info("[booking] Step 3 → Step 4 (Onay) — Sonraki.");
  await withPortalCheckpoint(page, { profile }, async () => {
    await clickWizardNextButton(page, appointmentSettings);
    await page.waitForTimeout(appointmentSettings.waitAfterWizardNextMs || 400);
  });
  await page.waitForTimeout(600);
}

/** Step 4 onaylar → Sonraki → Step 5 (OTP). */
export async function advanceToOtpStep(
  page: Page,
  profile: ResolvedProfile,
  appointmentSettings: AppointmentSettings,
): Promise<void> {
  logger.info("[booking] Step 4 → Step 5 (OTP) — Sonraki.");
  await withPortalCheckpoint(page, { profile }, async () => {
    await clickWizardNextButton(page, appointmentSettings);
    await page.waitForTimeout(appointmentSettings.waitAfterWizardNextMs || 400);
  });
  await page.waitForTimeout(600);
}

/** Step 3 takvim sekmesinde mi kontrol. */
export async function ensureCalendarView(
  page: Page,
  navLocator: string,
): Promise<void> {
  await navigateToWizardViewStep(page, WIZARD_STEP.CALENDAR, navLocator);
  await page.waitForTimeout(500);
}
