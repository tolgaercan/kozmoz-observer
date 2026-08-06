import type { Page } from "playwright";

import { detectManualAuthStep } from "../auth/authStepDetector.js";
import type { AppointmentSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";
import { detectRecaptchaState, waitForRecaptchaSolution } from "./recaptchaGate.js";

export interface WizardStepGateResult {
  ok: boolean;
  blockedBy?: "captcha" | "otp" | "login";
  message?: string;
}

/** Wizard adımları arası — reCAPTCHA bekle; OTP/login takılırsa dur (ileride Telegram). */
export async function waitForWizardStepGate(
  page: Page,
  settings: AppointmentSettings,
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

  const wizardOtpSelectors = [
    "text=Telefonuma Doğrulama Kodu Gönder",
    "text=sms kodu talep edin",
  ];
  for (const selector of wizardOtpSelectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 250 })) {
        return {
          ok: false,
          blockedBy: "otp",
          message: "Wizard SMS OTP ekranı — manuel devam gerekli",
        };
      }
    } catch {
      // görünür değil
    }
  }

  return { ok: true };
}
