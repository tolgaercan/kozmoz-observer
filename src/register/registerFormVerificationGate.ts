import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { Page } from "playwright";

import { RANDEVU_ISLEMLERI_SELECTORS } from "../navigation/kosmosPortalNav.js";
import { logger } from "../utils/logger.js";
import { isIdentityStepVisible } from "./registerFormStep1Identity.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function countVerifiedLabels(page: Page): Promise<number> {
  return page.locator("text=Doğrulandı").count();
}

export async function isCreateFormButtonVisible(page: Page): Promise<boolean> {
  return page
    .locator(".wizard-footer-right button.wizard-btn:has-text('Formu Oluştur')")
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
}

export async function verifyRandevuIslemleriNavVisible(page: Page): Promise<boolean> {
  for (const selector of RANDEVU_ISLEMLERI_SELECTORS) {
    const visible = await page
      .locator(selector)
      .first()
      .isVisible({ timeout: 1200 })
      .catch(() => false);
    if (visible) {
      return true;
    }
  }
  return false;
}

export interface WaitForManualVerificationOptions {
  pollIntervalMs?: number;
  /** Kaç adet "Doğrulandı" etiketi görülünce tamam sayılır (email=1, phone=2) */
  verifiedCountTarget: number;
  fieldLabel: string;
}

/**
 * Email/telefon kodu manuel girilip Doğrula tıklanana kadar bekler.
 * Sayfa "Doğrulandı" gösterirse veya kullanıcı Enter'a basınca devam eder.
 */
export async function waitForManualVerification(
  page: Page,
  options: WaitForManualVerificationOptions,
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const { verifiedCountTarget, fieldLabel } = options;

  logger.info(
    `[register][step-9] ${fieldLabel} — kodu tarayıcıda girin, Doğrula'ya tıklayın. ` +
      "Bitince terminale dönüp Enter'a basabilirsiniz.",
  );

  let enterPressed = false;
  const rl = readline.createInterface({ input, output });
  void rl
    .question(`\n[register][step-9] ${fieldLabel} doğrulandıktan sonra Enter'a basın...\n`)
    .then(() => {
      enterPressed = true;
    })
    .finally(() => {
      rl.close();
    });

  const started = Date.now();
  while (true) {
    const verifiedCount = await countVerifiedLabels(page);
    if (verifiedCount >= verifiedCountTarget) {
      logger.info(
        `[register][step-9] ${fieldLabel} doğrulandı (${Math.round((Date.now() - started) / 1000)}s).`,
      );
      return;
    }

    if (enterPressed) {
      logger.info(`[register][step-9] Enter alındı — ${fieldLabel} sonrası devam ediliyor.`);
      return;
    }

    if ((Date.now() - started) % 30_000 < pollIntervalMs) {
      logger.info(
        `[register][step-9] ${fieldLabel} bekleniyor — Doğrulandı=${verifiedCount}/${verifiedCountTarget} (${Math.round((Date.now() - started) / 1000)}s)`,
      );
    }

    await sleep(pollIntervalMs);
  }
}

export interface WaitForFormCreateOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Formu Oluştur manuel tıklanana kadar bekler; ardından Randevu İşlemleri menüsünü doğrular.
 */
export async function waitForManualFormCreateAndRandevuNav(
  page: Page,
  options: WaitForFormCreateOptions = {},
): Promise<boolean> {
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 600_000;

  logger.info(
    "[register][step-9] Her iki alan doğrulandı — tarayıcıda Formu Oluştur'a tıklayın.",
  );

  let enterPressed = false;
  const rl = readline.createInterface({ input, output });
  void rl
    .question("\n[register][step-9] Formu Oluştur sonrası Enter'a basın (veya sayfa kendiliğinden ilerler)...\n")
    .then(() => {
      enterPressed = true;
    })
    .finally(() => {
      rl.close();
    });

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const randevuVisible = await verifyRandevuIslemleriNavVisible(page);
    const createVisible = await isCreateFormButtonVisible(page);
    const onIdentity = await isIdentityStepVisible(page);

    if (randevuVisible && !createVisible) {
      logger.info("[register][step-9] Form kaydedildi — Randevu İşlemleri menüsü görünür.");
      return true;
    }

    if (randevuVisible && onIdentity && !createVisible) {
      logger.info("[register][step-9] Kimlik adımına dönüldü — kayıt tamamlandı.");
      return true;
    }

    if (enterPressed && randevuVisible) {
      logger.info("[register][step-9] Enter + Randevu İşlemleri — kayıt adımı tamam.");
      return true;
    }

    if (enterPressed && !createVisible && !(await isEmailVerificationViewActive(page))) {
      if (randevuVisible) {
        return true;
      }
    }

    await sleep(pollIntervalMs);
  }

  throw new Error("[register][step-9] Formu Oluştur / Randevu İşlemleri zaman aşımı.");
}

async function isEmailVerificationViewActive(page: Page): Promise<boolean> {
  return page
    .locator("text=Email Doğrulama")
    .first()
    .isVisible({ timeout: 600 })
    .catch(() => false);
}
