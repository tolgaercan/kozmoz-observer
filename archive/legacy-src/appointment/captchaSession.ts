import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanClickBlankArea } from "../interaction/humanClick.js";
import { logger } from "../utils/logger.js";
import {
  clickWizardNextButton,
  clickWizardPreviousButton,
} from "./wizardNavigation.js";
import {
  detectRecaptchaState,
  isRecaptchaTokenReady,
} from "./recaptchaGate.js";
import {
  isCalendarStepVisible,
  navigateToWizardViewStep,
  WIZARD_OBSERVE_TARGET_STEP,
  type WizardStepId,
} from "./wizardStepDetector.js";

let captchaLockEngaged = false;
let captchaSessionStartedAtMs: number | null = null;

/** Captcha beklenirken wizard guard / ek tıklamalar durmalı */
export function isCaptchaLockEngaged(): boolean {
  return captchaLockEngaged;
}

export function releaseCaptchaLock(): void {
  captchaLockEngaged = false;
  captchaSessionStartedAtMs = null;
}

function engageCaptchaLock(escapeMs: number): void {
  if (!captchaLockEngaged) {
    captchaLockEngaged = true;
    captchaSessionStartedAtMs = Date.now();
    logger.info(
      `[captcha-lock] reCAPTCHA algılandı — otomasyon duraklatıldı, kurtarma ${Math.round(escapeMs / 1000)}s sonra.`,
    );
  }
}

async function confirmStableSolve(
  page: Page,
  settings: AppointmentSettings,
): Promise<boolean> {
  if (settings.captchaStableSolveMs > 0) {
    await page.waitForTimeout(settings.captchaStableSolveMs);
  }

  const after = await detectRecaptchaState(page);
  if (isRecaptchaTokenReady(after.tokenLength)) {
    logger.info(
      `[captcha-lock] Token hazır — devam (token=${after.tokenLength}, iframe yok sayıldı).`,
    );
    return true;
  }

  if (!after.present || after.solved) {
    logger.info(
      `[captcha-lock] Captcha stabil çözüldü (token=${after.tokenLength}, checkbox=${after.checkboxChecked}).`,
    );
    return true;
  }

  logger.info("[captcha-lock] Çözüldü sanıldı ama stabil değil — beklemeye devam.");
  return false;
}

async function returnToCalendarAfterWizardNav(
  page: Page,
  settings: AppointmentSettings,
): Promise<void> {
  const calendarLocator = settings.slotCalendarLocator;

  try {
    await navigateToWizardViewStep(
      page,
      WIZARD_OBSERVE_TARGET_STEP,
      settings.wizardNavLocator,
    );
    await page.waitForTimeout(settings.captchaRecoveryStepWaitMs);
    if (await isCalendarStepVisible(page, calendarLocator)) {
      logger.info("[captcha-lock] Takvim sekmesine doğrudan dönüldü.");
      return;
    }
  } catch {
    logger.info("[captcha-lock] Takvim sekmesi doğrudan açılamadı — Sonraki ile ilerleniyor.");
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await isCalendarStepVisible(page, calendarLocator)) {
      logger.info(`[captcha-lock] Takvim görünür (Sonraki denemesi ${attempt}).`);
      return;
    }

    logger.info(`[captcha-lock] Sonraki (${attempt}/3) — takvime ilerleniyor...`);
    await clickWizardNextButton(page, settings);
    await page.waitForTimeout(settings.captchaRecoveryStepWaitMs);
  }
}

async function runCaptchaEscapeViaWizardNav(
  page: Page,
  settings: AppointmentSettings,
): Promise<void> {
  const step = Math.min(
    Math.max(settings.captchaRecoveryWizardStep, 1),
    WIZARD_OBSERVE_TARGET_STEP - 1,
  ) as WizardStepId;

  logger.warn(
    `[captcha-lock] Kurtarma süresi doldu — wizard sekmesi ${step} → takvim.`,
  );

  await navigateToWizardViewStep(page, step, settings.wizardNavLocator);
  await page.waitForTimeout(settings.captchaRecoveryStepWaitMs);
  await returnToCalendarAfterWizardNav(page, settings);
  logger.info("[captcha-lock] Wizard sekme kurtarması tamamlandı — sayaç sıfırlandı.");
}

async function runCaptchaEscapePreviousNext(
  page: Page,
  settings: AppointmentSettings,
): Promise<void> {
  logger.warn(
    "[captcha-lock] Kurtarma süresi doldu — boş tık → Önceki → Sonraki.",
  );

  if (settings.captchaRecoveryBlankClick) {
    logger.info("[captcha-lock] Captcha odak kırma — boş alana tıklanıyor...");
    await humanClickBlankArea(page, {
      minStepDelayMs: settings.minStepDelayMs,
      maxStepDelayMs: settings.maxStepDelayMs,
      overshootProbability: settings.overshootProbability,
    });
    await page.waitForTimeout(settings.captchaRecoveryStepWaitMs);
  }

  await clickWizardPreviousButton(page, settings);
  await page.waitForTimeout(settings.captchaRecoveryStepWaitMs);
  await clickWizardNextButton(page, settings);
  await page.waitForTimeout(settings.captchaRecoveryStepWaitMs);
  logger.info("[captcha-lock] Önceki → Sonraki tamamlandı — sayaç sıfırlandı.");
}

async function runCaptchaEscape(
  page: Page,
  settings: AppointmentSettings,
): Promise<void> {
  if (!settings.captchaRecoveryEnabled) {
    logger.warn("[captcha-lock] Kurtarma kapalı — CAPTCHA_RECOVERY_ENABLED=false");
    return;
  }

  try {
    if (settings.captchaRecoveryMode === "wizard-nav") {
      await runCaptchaEscapeViaWizardNav(page, settings);
      return;
    }

    if (settings.captchaRecoveryTryPreviousNext) {
      await runCaptchaEscapePreviousNext(page, settings);
      return;
    }

    logger.warn("[captcha-lock] Kurtarma modu tanımsız — atlandı.");
  } catch (error) {
    logger.warn(
      `[captcha-lock] Kurtarma hatası: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Captcha yok veya stabil çözülene kadar bekler.
 * Açıkken global kilit — ay oku, gün tık, wizard guard yok.
 * CAPTCHA_ESCAPE_MS dolunca wizard sekmesi veya Önceki→Sonraki kurtarması.
 */
export async function ensureStableRecaptchaOrEscape(
  page: Page,
  settings: AppointmentSettings,
): Promise<boolean> {
  let state = await detectRecaptchaState(page);
  if (!state.present || state.solved) {
    if (state.solved && state.present) {
      const stable = await confirmStableSolve(page, settings);
      if (stable) {
        releaseCaptchaLock();
        return true;
      }
      engageCaptchaLock(settings.captchaEscapeMs);
    } else {
      releaseCaptchaLock();
      return true;
    }
  } else {
    engageCaptchaLock(settings.captchaEscapeMs);
  }

  let lastLogAt = 0;

  while (captchaLockEngaged) {
    const elapsed =
      captchaSessionStartedAtMs === null ? 0 : Date.now() - captchaSessionStartedAtMs;

    state = await detectRecaptchaState(page);
    if (isRecaptchaTokenReady(state.tokenLength)) {
      const stable = await confirmStableSolve(page, settings);
      if (stable) {
        releaseCaptchaLock();
        return true;
      }
    }

    if (!state.present) {
      releaseCaptchaLock();
      return true;
    }

    if (state.solved) {
      const stable = await confirmStableSolve(page, settings);
      if (stable) {
        releaseCaptchaLock();
        return true;
      }
    }

    if (elapsed >= settings.captchaEscapeMs) {
      await runCaptchaEscape(page, settings);
      captchaSessionStartedAtMs = Date.now();
      lastLogAt = 0;
      logger.info(
        `[captcha-lock] Yeni kurtarma sayacı (${Math.round(settings.captchaEscapeMs / 1000)}s).`,
      );
      continue;
    }

    if (elapsed - lastLogAt >= 15_000) {
      lastLogAt = elapsed;
      logger.info(
        `[captcha-lock] bekleniyor (${Math.round(elapsed / 1000)}s / ${Math.round(settings.captchaEscapeMs / 1000)}s) — token=${state.tokenLength}`,
      );
    }

    await page.waitForTimeout(settings.recaptchaPollIntervalMs);
  }

  return false;
}
