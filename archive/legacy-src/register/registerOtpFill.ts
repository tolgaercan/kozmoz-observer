import type { Locator, Page } from "playwright";

import { humanTypeIntoLocator } from "../interaction/humanType.js";
import { logger } from "../utils/logger.js";

/** Register / portal OTP alanları — ileride eklenti aynı listeyi kullanır */
export const REGISTER_OTP_INPUT_SELECTORS = [
  "input[name*='otp' i]",
  "input[name*='verification' i]",
  "input[name*='verify' i]",
  "input[name*='code' i]",
  "input[id*='otp' i]",
  "input[placeholder*='kod' i]",
  "input[placeholder*='OTP' i]",
  "input[autocomplete='one-time-code']",
];

export type RegisterOtpStep = "identity" | "portal-login" | "email" | "phone";

export interface RegisterOtpContext {
  profileId: string;
  step: RegisterOtpStep;
}

export interface RegisterOtpProvider {
  /** null = henüz kod yok veya sağlayıcı bağlı değil */
  fetchOtp(context: RegisterOtpContext): Promise<string | null>;
}

/** Şimdilik boş — sistem OTP eklentisi buraya bağlanacak */
export const stubRegisterOtpProvider: RegisterOtpProvider = {
  async fetchOtp(context: RegisterOtpContext): Promise<string | null> {
    logger.info(
      `[register][otp] Stub sağlayıcı — adım=${context.step}, profil=${context.profileId} (kod döndürülmedi)`,
    );
    return null;
  },
};

let activeOtpProvider: RegisterOtpProvider = stubRegisterOtpProvider;

/** İleride SMS/email OTP eklentisi buradan kaydedilir */
export function setRegisterOtpProvider(provider: RegisterOtpProvider): void {
  activeOtpProvider = provider;
}

export function getRegisterOtpProvider(): RegisterOtpProvider {
  return activeOtpProvider;
}

export interface FillRegisterOtpResult {
  visible: boolean;
  filled: boolean;
}

async function findVisibleOtpInput(page: Page): Promise<Locator | null> {
  for (const selector of REGISTER_OTP_INPUT_SELECTORS) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 400 }).catch(() => false)) {
      return locator;
    }
  }
  return null;
}

/**
 * Kimlik / portal adımında OTP alanı görünürse doldurmayı dener.
 * Stub modda kod gelmez — alan boş kalır, akış devam eder (manuel müdahale mümkün).
 */
export async function fillRegisterOtpIfVisible(
  page: Page,
  options: {
    profileId: string;
    step?: RegisterOtpStep;
    provider?: RegisterOtpProvider;
  },
): Promise<FillRegisterOtpResult> {
  const input = await findVisibleOtpInput(page);
  if (!input) {
    return { visible: false, filled: false };
  }

  const step = options.step ?? "identity";
  logger.info(`[register][otp] OTP alanı görünür — adım=${step}`);

  const provider = options.provider ?? getRegisterOtpProvider();
  const code = await provider.fetchOtp({ profileId: options.profileId, step });

  if (!code?.trim()) {
    logger.info("[register][otp] OTP kodu yok — eklenti bağlanınca otomatik doldurulacak.");
    return { visible: true, filled: false };
  }

  await humanTypeIntoLocator(page, input, code.trim(), {
    label: "OTP",
    minCharDelayMs: 40,
    maxCharDelayMs: 110,
  });
  logger.info("[register][otp] OTP alanı dolduruldu.");
  return { visible: true, filled: true };
}
