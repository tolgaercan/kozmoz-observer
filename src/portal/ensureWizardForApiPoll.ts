import type { Page } from "playwright";

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
  type WizardStepId,
} from "./wizardStepDetector.js";
import {
  advanceWizardStep1ToStep2Only,
  ensureApiPollStep2FieldsFilled,
} from "./wizardStepAutofill.js";
import { waitForWizardStepGate } from "./wizardStepGate.js";

/** API poll güvenli üst sınır — başvuru şekli burada (panel typeId). */
const API_SAFE_MAX_STEP = 2 as WizardStepId;
/** Bilgi formu — captcha / rate limit riski; API watcher GİTMEZ. */
const FORBIDDEN_STEP = 3 as WizardStepId;
const CALENDAR_STEP = 4 as WizardStepId;

export interface EnsureWizardForApiPollResult {
  ok: boolean;
  reason?: string;
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

function resolveVisibleWizardStep(
  state: Awaited<ReturnType<typeof detectWizardStep>>,
  contentStep: WizardStepId | null,
): WizardStepId {
  const viewStep = state?.viewStep ?? contentStep ?? 1;
  return Math.min(viewStep, API_SAFE_MAX_STEP) as WizardStepId;
}

async function ensureStep2ViewForApiPoll(
  page: Page,
  profile: ResolvedProfile,
  appointmentSettings: AppointmentSettings,
  apiSettings: ApiWatcherSettings,
  queryParams: ApiQueryParams,
): Promise<void> {
  const state = await detectWizardStep(page, apiSettings.wizardNavLocator);
  const contentStep = await detectViewStepFromContent(page);
  const viewStep = resolveVisibleWizardStep(state, contentStep);
  const progress = state?.progressStep ?? 0;

  if (viewStep >= 2 || progress >= 2) {
    if (viewStep < 2 && progress >= 2) {
      logger.info("[wizard-prep] Ilerleme adim 2+ — wizard sekmesine geciliyor (Sonraki yok).");
      await navigateToWizardViewStep(page, 2, apiSettings.wizardNavLocator);
      await page.waitForTimeout(400);
    }
    return;
  }

  const gateBeforeNext = await waitForWizardStepGate(page, appointmentSettings);
  if (!gateBeforeNext.ok) {
    if (
      gateBeforeNext.blockedBy === "otp" ||
      gateBeforeNext.blockedBy === "login" ||
      gateBeforeNext.blockedBy === "captcha"
    ) {
      throw new Error(gateBeforeNext.message ?? "Adim 1 Sonraki oncesi captcha/giris bekleniyor");
    }
  }

  logger.info("[wizard-prep] Adim 1 tamam (il+merkez) — tek Sonraki ile adim 2'ye.");
  await advanceWizardStep1ToStep2Only(page, profile, appointmentSettings, queryParams);

  const gateAfterNext = await waitForWizardStepGate(page, appointmentSettings);
  if (!gateAfterNext.ok) {
    if (
      gateAfterNext.blockedBy === "otp" ||
      gateAfterNext.blockedBy === "login" ||
      gateAfterNext.blockedBy === "captcha"
    ) {
      throw new Error(gateAfterNext.message ?? "Adim 1→2 Sonraki sonrasi captcha/giris bekleniyor");
    }
  }
}

/**
 * API poll öncesi wizard:
 * - Adim 1: il + merkez (panel) → tek Sonraki
 * - Adim 2: basvuru tipi + sekli (panel) — Sonraki YOK
 * - Adim 3+ / takvim: geri adim 2 (Sonraki yok)
 */
export async function ensureWizardForApiPoll(
  page: Page,
  profile: ResolvedProfile,
  appointmentSettings: AppointmentSettings,
  apiSettings: ApiWatcherSettings,
  queryParams: ApiQueryParams,
): Promise<EnsureWizardForApiPollResult> {
  const selector = apiSettings.appointmentTypeSelectLocator;
  const targetTypeId = queryParams.appointmentTypeId.trim();
  const styleLabel = queryParams.appointmentStyleLabel?.trim();

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
        `Adim ${FORBIDDEN_STEP}+ (bilgi formu / captcha riski)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `adim 3'ten geri donulemedi: ${message}` };
    }
  }

  const gate = await waitForWizardStepGate(page, appointmentSettings);
  if (!gate.ok) {
    logger.warn(`[wizard-prep] Adim kapisi: ${gate.message ?? gate.blockedBy}`);
    if (gate.blockedBy === "otp" || gate.blockedBy === "login" || gate.blockedBy === "captcha") {
      return { ok: false, reason: gate.message };
    }
  }

  if (await isAppointmentTypeSelectReady(page, selector, targetTypeId)) {
    logger.info(
      `[wizard-prep] Basvuru sekli hazir — typeId=${targetTypeId} (${styleLabel ?? "?"})`,
    );
    return { ok: true };
  }

  try {
    await ensureStep2ViewForApiPoll(
      page,
      profile,
      appointmentSettings,
      apiSettings,
      queryParams,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[wizard-prep] Adim 1→2 gecis: ${message}`);
    return { ok: false, reason: message };
  }

  await ensureApiPollStep2FieldsFilled(page, profile, appointmentSettings, queryParams);
  logger.info("[wizard-prep] Adim 2 — panel degerleri dolduruldu, Sonraki YOK.");

  if (await isAppointmentTypeSelectReady(page, selector, targetTypeId)) {
    logger.info(
      `[wizard-prep] Basvuru sekli hazir — typeId=${targetTypeId} (${styleLabel ?? "?"})`,
    );
    return { ok: true };
  }

  return {
    ok: false,
    reason: `Basvuru sekli (typeId=${targetTypeId}) adim 2'de hazir degil — panel: ${styleLabel ?? "?"}`,
  };
}
