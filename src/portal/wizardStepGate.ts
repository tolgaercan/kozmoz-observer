import type { Page } from "playwright";

import { detectManualAuthStep, type ManualAuthState } from "../auth/authStepDetector.js";
import type { AppointmentSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";
import { detectRecaptchaState, waitForRecaptchaSolution } from "./recaptchaGate.js";

export interface WizardStepGateResult {
  ok: boolean;
  blockedBy?: "captcha" | "otp" | "login";
  message?: string;
}

export interface WaitForPortalManualAuthOptions {
  maxWaitMs: number;
  pollIntervalMs?: number;
  profileId?: string;
  onAuthRequired?: (auth: ManualAuthState) => Promise<void>;
}

const WIZARD_OTP_TEXT_SELECTORS = [
  "text=Telefonuma Doğrulama Kodu Gönder",
  "text=sms kodu talep edin",
];

async function detectWizardOtpPrompt(page: Page): Promise<boolean> {
  for (const selector of WIZARD_OTP_TEXT_SELECTORS) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 250 })) {
        return true;
      }
    } catch {
      // görünür değil
    }
  }
  return false;
}

function authKindLabel(kind: ManualAuthState["kind"]): string {
  switch (kind) {
    case "otp":
      return "OTP";
    case "login_and_otp":
      return "sifre + OTP";
    case "login":
      return "giris";
    default:
      return "dogrulama";
  }
}

/**
 * OTP / sifre ekrani varsa bekler (Telegram opsiyonel); yoksa hemen gecer.
 */
export async function waitForPortalManualAuthClear(
  page: Page,
  options: WaitForPortalManualAuthOptions,
): Promise<{ cleared: boolean; kind?: ManualAuthState["kind"] }> {
  const pollMs = options.pollIntervalMs ?? 1500;
  const started = Date.now();
  let notified = false;

  while (Date.now() - started < options.maxWaitMs) {
    const auth = await detectManualAuthStep(page);
    const wizardOtp = await detectWizardOtpPrompt(page);
    const blocked = auth.required || wizardOtp;

    if (!blocked) {
      if (notified) {
        logger.info("[wizard-gate] OTP/giris tamamlandi — wizard devam ediyor.");
      }
      return { cleared: true };
    }

    const kind = wizardOtp && auth.kind === "none" ? "otp" : auth.kind;

    if (!notified) {
      notified = true;
      logger.warn(
        `[wizard-gate] ${authKindLabel(kind)} bekleniyor (${Math.round(options.maxWaitMs / 1000)}s max): ${page.url()}`,
      );
      if (options.onAuthRequired) {
        await options.onAuthRequired({ ...auth, required: true, kind });
      }
    }

    await page.waitForTimeout(pollMs);
  }

  const finalAuth = await detectManualAuthStep(page);
  const finalWizardOtp = await detectWizardOtpPrompt(page);
  if (!finalAuth.required && !finalWizardOtp) {
    return { cleared: true };
  }

  logger.warn("[wizard-gate] OTP/giris bekleme suresi doldu — wizard adimi atlanabilir.");
  return { cleared: false, kind: finalAuth.kind };
}

export interface WaitForWizardStepGateOptions {
  /** OTP/giris gelirse bekle; gelmezse devam et */
  waitForManualAuth?: boolean;
  manualAuthMaxWaitMs?: number;
  profileId?: string;
  onAuthRequired?: (auth: ManualAuthState) => Promise<void>;
}

/** Wizard adımları arası — reCAPTCHA bekle; OTP/login opsiyonel bekleme + Telegram. */
export async function waitForWizardStepGate(
  page: Page,
  settings: AppointmentSettings,
  options?: WaitForWizardStepGateOptions,
): Promise<WizardStepGateResult> {
  const state = await detectRecaptchaState(page);
  if (state.present && !state.solved) {
    logger.info("[wizard-gate] reCAPTCHA algılandı — çözüm bekleniyor (insan).");
    const solved = await waitForRecaptchaSolution(
      page,
      settings.recaptchaWaitMs,
      settings.recaptchaPollIntervalMs,
    );
    if (!solved) {
      return {
        ok: false,
        blockedBy: "captcha",
        message: "reCAPTCHA süresi doldu — Sonraki öncesi manuel çözün",
      };
    }
  }

  if (options?.waitForManualAuth) {
    const maxWaitMs =
      options.manualAuthMaxWaitMs ??
      Math.max(settings.recaptchaWaitMs, 180_000);
    const authWait = await waitForPortalManualAuthClear(page, {
      maxWaitMs,
      profileId: options.profileId,
      onAuthRequired: options.onAuthRequired,
    });
    if (!authWait.cleared) {
      return {
        ok: false,
        blockedBy: authWait.kind === "login" ? "login" : "otp",
        message: "OTP/giris tamamlanmadi — wizard adimi bekliyor",
      };
    }
    return { ok: true };
  }

  const auth = await detectManualAuthStep(page);
  if (auth.required) {
    if (auth.kind === "otp" || auth.kind === "login_and_otp") {
      return {
        ok: false,
        blockedBy: "otp",
        message: `OTP bekleniyor: ${auth.reasons.join("; ")}`,
      };
    }
    if (auth.kind === "login") {
      return {
        ok: false,
        blockedBy: "login",
        message: `Giriş gerekli: ${auth.reasons.join("; ")}`,
      };
    }
  }

  if (await detectWizardOtpPrompt(page)) {
    return {
      ok: false,
      blockedBy: "otp",
      message: "Wizard SMS OTP ekranı — manuel devam gerekli",
    };
  }

  return { ok: true };
}
