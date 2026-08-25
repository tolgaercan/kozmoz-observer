import type { Page } from "playwright";

import {
  isSupabaseOtpConfigured,
  peekSupabaseOtp,
  consumeSupabaseOtpForPhone,
  normalizePhoneLast10,
  type WaitSupabaseOtpOptions,
} from "../../integrations/supabaseOtp.js";
import { logger } from "../../utils/logger.js";
import { IDENTITY_OTP_POPUP_POLL_MS } from "../interventions/portalInterventionTiming.js";
import {
  IDENTITY_PHONE_VERIFICATION_SELECTORS,
  IDENTITY_PHONE_VERIFICATION_TITLE,
} from "./identityPhoneVerificationSelectors.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isIdentityPopupVisible(page: Page, probeMs: number): Promise<boolean> {
  const title = page.locator(IDENTITY_PHONE_VERIFICATION_SELECTORS.popupTitle).filter({
    hasText: IDENTITY_PHONE_VERIFICATION_TITLE,
  });
  return title.first().isVisible({ timeout: probeMs }).catch(() => false);
}

export type IdentityOtpWaitResult =
  | { kind: "supabase"; otp: string }
  | { kind: "manual_dismiss" }
  | { kind: "timeout"; message: string };

export interface WaitIdentityOtpOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  since?: Date;
  consume?: boolean;
  waitOptions?: Pick<WaitSupabaseOtpOptions, "sbUrl" | "serviceKey" | "table">;
}

/**
 * Supabase OTP veya kullanicinin elle girip popup'i kapatmasini izler.
 * Sabit 210sn bloklamaz — her turde popup gorunurlugu kontrol edilir.
 */
export async function waitForIdentityOtpResolution(
  page: Page,
  phone: string,
  options: WaitIdentityOtpOptions = {},
): Promise<IdentityOtpWaitResult> {
  const timeoutMs = options.timeoutMs ?? 210_000;
  const pollMs = options.pollIntervalMs ?? IDENTITY_OTP_POPUP_POLL_MS;
  const consume = options.consume !== false;
  const since = options.since;
  const started = Date.now();
  let lastProgressLogAt = 0;

  const phoneLast10 = normalizePhoneLast10(phone);
  const supabaseReady = isSupabaseOtpConfigured(options.waitOptions);

  logger.info(
    `[identity-phone] OTP izleme — popup poll ${pollMs}ms, timeout ${timeoutMs}ms` +
      (supabaseReady ? ", Supabase acik" : ", yalnizca manuel/popup kapanisi"),
  );

  while (Date.now() - started < timeoutMs) {
    const popupVisible = await isIdentityPopupVisible(page, pollMs);
    if (!popupVisible) {
      logger.info("[identity-phone] Popup kapandi — manuel OTP kabul edildi, devam ediliyor.");
      return { kind: "manual_dismiss" };
    }

    if (supabaseReady) {
      try {
        const otp = await peekSupabaseOtp(phone, {
          since,
          consume: false,
          ...options.waitOptions,
        });
        if (otp) {
          logger.info(`[identity-phone] Supabase OTP alindi (***${phoneLast10.slice(-4)}).`);
          if (consume) {
            await consumeSupabaseOtpForPhone(phone, options.waitOptions);
          }
          return { kind: "supabase", otp };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[identity-phone] Supabase poll hatasi: ${message}`);
      }
    }

    const elapsed = Date.now() - started;
    if (elapsed - lastProgressLogAt >= 15_000) {
      lastProgressLogAt = elapsed;
      logger.info(
        `[identity-phone] OTP bekleniyor (${Math.round(elapsed / 1000)}s) — popup acik, manuel giris veya SMS...`,
      );
    }

    await sleep(pollMs);
  }

  const stillVisible = await isIdentityPopupVisible(page, pollMs);
  if (!stillVisible) {
    logger.info("[identity-phone] Timeout sonrasi popup kapali — manuel OTP kabul edildi.");
    return { kind: "manual_dismiss" };
  }

  return {
    kind: "timeout",
    message: `OTP gelmedi ve popup acik (timeout ${timeoutMs}ms): ***${phoneLast10.slice(-4)}`,
  };
}
