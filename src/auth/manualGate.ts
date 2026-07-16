import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { Page } from "playwright";

import { logger } from "../utils/logger.js";
import { detectManualAuthStep } from "./authStepDetector.js";

export interface WaitForManualAuthOptions {
  pollIntervalMs?: number;
  /** Terminalde Enter ile devam (OTP/şifre girildikten sonra) */
  allowEnterToContinue?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sadece kullanıcı Enter'a basana kadar bekler */
export async function waitForUserContinue(message: string): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(`\n${message}\n`);
  } finally {
    rl.close();
  }
}

/**
 * Şifre / OTP ekranında bekler — hata fırlatmaz.
 * Sayfa kendiliğinden ilerlerse veya kullanıcı Enter'a basınca devam eder.
 */
export async function waitForManualAuthCompletion(
  page: Page,
  options: WaitForManualAuthOptions = {},
): Promise<boolean> {
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const allowEnter = options.allowEnterToContinue ?? true;

  const initial = await detectManualAuthStep(page);
  if (!initial.required) {
    return false;
  }

  const kindLabel =
    initial.kind === "otp"
      ? "OTP / doğrulama kodu"
      : initial.kind === "login_and_otp"
        ? "şifre + OTP"
        : "giriş (şifre)";

  logger.info(
    `[bootstrap] Manuel adım: ${kindLabel} — tarayıcıda tamamlayın.` +
      (allowEnter ? " Bitince terminale dönüp Enter'a basabilirsiniz." : ""),
  );

  let enterPressed = false;
  let rl: readline.Interface | null = null;

  if (allowEnter) {
    rl = readline.createInterface({ input, output });
    void rl
      .question("\n[bootstrap] Şifre/OTP girdikten sonra Enter'a basın...\n")
      .then(() => {
        enterPressed = true;
      })
      .finally(() => {
        rl?.close();
      });
  }

  const started = Date.now();
  while (true) {
    if (enterPressed) {
      logger.info("[bootstrap] Enter alındı — akış devam ediyor.");
      return true;
    }

    const state = await detectManualAuthStep(page);
    if (!state.required) {
      logger.info(
        `[bootstrap] Manuel adım tamamlandı (${Math.round((Date.now() - started) / 1000)}s) — devam ediliyor.`,
      );
      return true;
    }

    if ((Date.now() - started) % 30_000 < pollIntervalMs) {
      logger.info(
        `[bootstrap] Hâlâ bekleniyor (${kindLabel}) — ${Math.round((Date.now() - started) / 1000)}s`,
      );
    }

    await sleep(pollIntervalMs);
  }
}
