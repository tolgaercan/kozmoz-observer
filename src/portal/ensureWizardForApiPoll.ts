import type { Page } from "playwright";

import type { ManualAuthState } from "../auth/authStepDetector.js";
import type { ApiQueryParams } from "../api/client/resolveApiQueryParams.js";
import type { ApiWatcherSettings, AppointmentSettings } from "../config/settings.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";
import {
  detectViewStepFromContent,
  detectWizardStep,
  formatWizardStepLog,
  isCalendarStepVisible,
  navigateToWizardViewStep,
} from "./wizardStepDetector.js";
import {
  WIZARD_API_POLL_MAX_STEP,
  WIZARD_FORBIDDEN_STEP,
  WIZARD_STEP,
} from "./wizardSteps.js";
import {
  advanceWizardStep1ToStep2Only,
} from "./wizardStepAutofill.js";
import { getPortalBookingFlowLock } from "./portalBookingFlowGuard.js";
import { drainPortalInterventions } from "./interventions/portalCheckpoint.js";
import { waitForWizardStepGate } from "./wizardStepGate.js";

/** API poll güvenli üst sınır — bilgi formu (Step 2). */
const API_SAFE_MAX_STEP = WIZARD_API_POLL_MAX_STEP;
/** Takvim — captcha / rate limit; API watcher GİTMEZ. Step 3. */
const FORBIDDEN_STEP = WIZARD_FORBIDDEN_STEP;
const CALENDAR_STEP = WIZARD_STEP.CALENDAR;
const INFO_STEP = WIZARD_STEP.APPLICANT_INFO;

export interface EnsureWizardForApiPollResult {
  ok: boolean;
  reason?: string;
  /** Step 2 görünümüne yeni geçildi — GetClosedDate öncesi kısa bekleme önerilir */
  step2Transition?: boolean;
}

export interface EnsureWizardForApiPollOptions {
  /** OTP/giris gelirse bekleme suresi (ms) */
  manualAuthMaxWaitMs?: number;
  onManualAuthRequired?: (auth: ManualAuthState, url: string) => Promise<void>;
}

async function buildWizardGateOptions(
  page: Page,
  profile: ResolvedProfile,
  appointmentSettings: AppointmentSettings,
  options?: EnsureWizardForApiPollOptions,
) {
  return {
    waitForManualAuth: true,
    manualAuthMaxWaitMs: options?.manualAuthMaxWaitMs ?? 1_800_000,
    profileId: profile.id,
    profile,
    onAuthRequired: options?.onManualAuthRequired
      ? async (auth: ManualAuthState) => {
          await options.onManualAuthRequired!(auth, page.url());
        }
      : undefined,
  };
}

async function waitWizardGate(
  page: Page,
  appointmentSettings: AppointmentSettings,
  profile: ResolvedProfile,
  options?: EnsureWizardForApiPollOptions,
): Promise<EnsureWizardForApiPollResult | null> {
  const gate = await waitForWizardStepGate(
    page,
    appointmentSettings,
    await buildWizardGateOptions(page, profile, appointmentSettings, options),
  );
  if (!gate.ok) {
    logger.warn(`[wizard-prep] Adim kapisi: ${gate.message ?? gate.blockedBy}`);
    if (gate.blockedBy === "otp" || gate.blockedBy === "login" || gate.blockedBy === "captcha") {
      return { ok: false, reason: gate.message };
    }
  }
  return null;
}

export async function isPortalAppointmentTypeReady(
  page: Page,
  apiSettings: ApiWatcherSettings,
  targetTypeId: string,
): Promise<boolean> {
  return isAppointmentTypeSelectReady(page, apiSettings.appointmentTypeSelectLocator, targetTypeId);
}

export async function isPortalSessionReadyForPoll(
  page: Page,
  apiSettings: ApiWatcherSettings,
  queryParams: ApiQueryParams,
  options?: { requireTypeReady?: boolean },
): Promise<{ ready: boolean; reason?: string }> {
  const calendarVisible = await isCalendarStepVisible(page);
  const contentStep = await detectViewStepFromContent(page);

  if (calendarVisible || (contentStep ?? 0) >= FORBIDDEN_STEP) {
    return {
      ready: false,
      reason: calendarVisible
        ? "takvim gorunur (step 3+)"
        : `icerik adimi ${contentStep} (>= ${FORBIDDEN_STEP})`,
    };
  }

  if (options?.requireTypeReady) {
    const targetTypeId = queryParams.appointmentTypeId.trim();
    const typeReady = await isAppointmentTypeSelectReady(
      page,
      apiSettings.appointmentTypeSelectLocator,
      targetTypeId,
    );
    if (!typeReady) {
      return { ready: false, reason: `typeId=${targetTypeId} DOM hazir degil` };
    }
  }

  return { ready: true };
}

async function isAppointmentTypeSelectReady(
  page: Page,
  selector: string,
  targetTypeId: string,
): Promise<boolean> {
  return page.evaluate(
    ({ sel, target }) => {
      const element = document.querySelector<HTMLSelectElement>(sel);
      if (!element || element.disabled) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0;
      return visible && element.value.trim() === target;
    },
    { sel: selector, target: targetTypeId },
  );
}

async function retreatFromForbiddenSteps(
  page: Page,
  apiSettings: ApiWatcherSettings,
  appointmentSettings: AppointmentSettings,
  reason: string,
): Promise<void> {
  logger.info(`[wizard-prep] ${reason} — adim ${API_SAFE_MAX_STEP} gorunumune geri (Sonraki yok)`);
  await navigateToWizardViewStep(page, API_SAFE_MAX_STEP, apiSettings.wizardNavLocator);
  await page.waitForTimeout(400);
  await waitForWizardStepGate(page, appointmentSettings);
}

async function ensureInfoStepViewForApiPoll(
  page: Page,
  profile: ResolvedProfile,
  appointmentSettings: AppointmentSettings,
  apiSettings: ApiWatcherSettings,
  queryParams: ApiQueryParams,
  wizardOptions?: EnsureWizardForApiPollOptions,
): Promise<boolean> {
  let contentStep = await detectViewStepFromContent(page);

  if ((contentStep ?? 0) >= INFO_STEP) {
    return false;
  }

  const state = await detectWizardStep(page, apiSettings.wizardNavLocator);
  const progress = state?.progressStep ?? 0;

  if (progress >= INFO_STEP) {
    logger.info("[wizard-prep] Bilgi formu (step 2) sekmesine geciliyor (Sonraki yok).");
    await navigateToWizardViewStep(page, INFO_STEP, apiSettings.wizardNavLocator);
    await page.waitForTimeout(400);
    return true;
  }

  let step2Transition = false;

  if ((contentStep ?? 0) < 2) {
    const gateBefore = await waitWizardGate(page, appointmentSettings, profile, wizardOptions);
    if (gateBefore) {
      throw new Error(gateBefore.reason ?? "Adim 1 oncesi OTP/giris bekleniyor");
    }

    logger.info("[wizard-prep] Step 1 tamam (il+merkez) — tek Sonraki ile step 2'ye.");
    await advanceWizardStep1ToStep2Only(page, profile, appointmentSettings, queryParams);
    step2Transition = true;

    const gateAfter = await waitWizardGate(page, appointmentSettings, profile, wizardOptions);
    if (gateAfter) {
      throw new Error(gateAfter.reason ?? "Adim 1→2 Sonraki sonrasi OTP/giris bekleniyor");
    }

    contentStep = await detectViewStepFromContent(page);
  }

  if ((contentStep ?? 0) < INFO_STEP) {
    const gateBeforeStep3 = await waitWizardGate(page, appointmentSettings, profile, wizardOptions);
    if (gateBeforeStep3) {
      throw new Error(gateBeforeStep3.reason ?? "Step 2 oncesi OTP/giris bekleniyor");
    }

    logger.info("[wizard-prep] Step 2 → takvim atlanir — bilgi formu gorunumu (Sonraki yok, watch modu).");
    return step2Transition;
  }

  return step2Transition;
}

/**
 * API poll öncesi wizard (watch modu):
 * - Step 1: il + merkez → Sonraki
 * - Step 2: bilgi formu görünümü — Sonraki YOK (GetClosedDate buradan)
 * - Step 3+ / takvim: geri step 2
 */
export async function ensureWizardForApiPoll(
  page: Page,
  profile: ResolvedProfile,
  appointmentSettings: AppointmentSettings,
  apiSettings: ApiWatcherSettings,
  queryParams: ApiQueryParams,
  wizardOptions?: EnsureWizardForApiPollOptions,
): Promise<EnsureWizardForApiPollResult> {
  const targetTypeId = queryParams.appointmentTypeId.trim();
  const styleLabel = queryParams.appointmentStyleLabel?.trim();
  let step2Transition = false;

  const bookingLock = await getPortalBookingFlowLock(page);
  if (bookingLock.locked) {
    logger.info(
      `[wizard-prep] ${bookingLock.reason} — booking/odeme akisi, wizard geri donus yok (poll atlanacak).`,
    );
    return { ok: false, reason: `${bookingLock.reason} — poll wizard hazirligi atlandi` };
  }

  const calendarVisible = await isCalendarStepVisible(page);
  const contentStep = await detectViewStepFromContent(page);
  const initialState = await detectWizardStep(page, apiSettings.wizardNavLocator);
  if (initialState) {
    logger.info(`[wizard-prep] ${formatWizardStepLog(initialState)}`);
  }

  const progress = initialState?.progressStep ?? 0;

  if (calendarVisible || progress >= CALENDAR_STEP) {
    try {
      await retreatFromForbiddenSteps(
        page,
        apiSettings,
        appointmentSettings,
        "Takvim alaninda",
      );
      step2Transition = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `takvimden geri donulemedi: ${message}` };
    }
  } else if (progress >= FORBIDDEN_STEP || (contentStep ?? 0) >= FORBIDDEN_STEP) {
    try {
      await retreatFromForbiddenSteps(
        page,
        apiSettings,
        appointmentSettings,
        `Adim ${FORBIDDEN_STEP}+ (takvim)`,
      );
      step2Transition = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `adim 4'ten geri donulemedi: ${message}` };
    }
  }

  const gateBlock = await waitWizardGate(page, appointmentSettings, profile, wizardOptions);
  if (gateBlock) {
    return gateBlock;
  }

  await drainPortalInterventions(page, { profile }).catch((error) => {
    logger.warn(
      `[wizard-prep] Portal checkpoint: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  try {
    const infoTransition = await ensureInfoStepViewForApiPoll(
      page,
      profile,
      appointmentSettings,
      apiSettings,
      queryParams,
      wizardOptions,
    );
    step2Transition = step2Transition || infoTransition;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[wizard-prep] Bilgi formu (adim 3) gorunumu: ${message}`);
    return { ok: false, reason: message };
  }

  // BAN-SAFE: TC / bos tik / basvuru sekli doldurma kapali — sadece adim 3 gorunumune gelindi.
  logger.info("[wizard-prep] Step 2 gorunumu hazir — TC/sekil otomasyonu BAN-SAFE kapali.");
  return { ok: true, step2Transition };

  /*
  await ensureApiPollInfoStepFieldsFilled(page, profile, appointmentSettings, queryParams);
  logger.info("[wizard-prep] Adim 3 — tip/TC/sekil dolduruldu, Sonraki YOK.");

  const selector = apiSettings.appointmentTypeSelectLocator;
  if (await isAppointmentTypeSelectReady(page, selector, targetTypeId)) {
    logger.info(
      `[wizard-prep] Basvuru sekli hazir — typeId=${targetTypeId} (${styleLabel ?? "?"})`,
    );
    return { ok: true };
  }

  return {
    ok: false,
    reason: `Basvuru sekli (typeId=${targetTypeId}) adim 3'de hazir degil — panel: ${styleLabel ?? "?"}`,
  };
  */
}
