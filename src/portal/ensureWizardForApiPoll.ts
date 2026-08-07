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
  ensureApiPollInfoStepFieldsFilled,
} from "./wizardStepAutofill.js";
import { clickWizardNextButton } from "./wizardNavigation.js";
import { waitForWizardStepGate } from "./wizardStepGate.js";

/** API poll güvenli üst sınır — bilgi formu (TC + başvuru şekli). Portal adım 3. */
const API_SAFE_MAX_STEP = 3 as WizardStepId;
/** Takvim — captcha / rate limit; API watcher GİTMEZ. Portal adım 4. */
const FORBIDDEN_STEP = 4 as WizardStepId;
const CALENDAR_STEP = 4 as WizardStepId;
const INFO_STEP = 3 as WizardStepId;

export interface EnsureWizardForApiPollResult {
  ok: boolean;
  reason?: string;
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
        ? "takvim gorunur (adim 4+)"
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
): Promise<void> {
  let contentStep = await detectViewStepFromContent(page);

  if ((contentStep ?? 0) >= INFO_STEP) {
    return;
  }

  const state = await detectWizardStep(page, apiSettings.wizardNavLocator);
  const progress = state?.progressStep ?? 0;

  if (progress >= INFO_STEP) {
    logger.info("[wizard-prep] Bilgi formu (adim 3) sekmesine geciliyor (Sonraki yok).");
    await navigateToWizardViewStep(page, INFO_STEP, apiSettings.wizardNavLocator);
    await page.waitForTimeout(400);
    return;
  }

  if ((contentStep ?? 0) < 2) {
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

    contentStep = await detectViewStepFromContent(page);
  }

  if ((contentStep ?? 0) < INFO_STEP) {
    logger.info("[wizard-prep] Adim 2 → 3 tek Sonraki (bilgi formu — TC/sekil sayfasi).");
    await clickWizardNextButton(page, appointmentSettings);
    await page.waitForTimeout(appointmentSettings.waitAfterWizardNextMs || 400);
  }
}

/**
 * API poll öncesi wizard:
 * - Adim 1: il + merkez (panel) → Sonraki
 * - Adim 2: gerekirse → Sonraki (adim 3'e)
 * - Adim 3: basvuru tipi → TC → bos tik → basvuru sekli — Sonraki YOK
 * - Adim 4+ / takvim: geri adim 3
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
        `Adim ${FORBIDDEN_STEP}+ (takvim)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `adim 4'ten geri donulemedi: ${message}` };
    }
  }

  const gate = await waitForWizardStepGate(page, appointmentSettings);
  if (!gate.ok) {
    logger.warn(`[wizard-prep] Adim kapisi: ${gate.message ?? gate.blockedBy}`);
    if (gate.blockedBy === "otp" || gate.blockedBy === "login" || gate.blockedBy === "captcha") {
      return { ok: false, reason: gate.message };
    }
  }

  try {
    await ensureInfoStepViewForApiPoll(
      page,
      profile,
      appointmentSettings,
      apiSettings,
      queryParams,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[wizard-prep] Bilgi formu (adim 3) gorunumu: ${message}`);
    return { ok: false, reason: message };
  }

  await ensureApiPollInfoStepFieldsFilled(page, profile, appointmentSettings, queryParams);
  logger.info("[wizard-prep] Adim 3 — tip/TC/sekil dolduruldu, Sonraki YOK.");

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
}
