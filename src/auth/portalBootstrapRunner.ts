import type { Page } from "playwright";

import type { ProfileCredentials } from "../profiles/profileCredentials.js";
import { maskEmail } from "../profiles/profileCredentials.js";
import { humanTypeIntoLocator } from "../interaction/humanType.js";
import { logger } from "../utils/logger.js";
import { detectManualAuthStep, findVisibleEmailInput } from "./authStepDetector.js";
import { waitForManualAuthCompletion } from "./manualGate.js";

export interface PortalBootstrapResult {
  manualAuthRequired: boolean;
  emailFilled: boolean;
}

/**
 * Portal bootstrap — email doldur (varsa), şifre/OTP için bekle, hata verme.
 */
export async function runPortalBootstrap(
  page: Page,
  credentials: ProfileCredentials,
): Promise<PortalBootstrapResult> {
  logger.info("[bootstrap] Portal oturum kontrolü başlıyor...");

  let emailFilled = false;
  const authState = await detectManualAuthStep(page);

  if (!authState.required) {
    logger.info("[bootstrap] Giriş/OTP ekranı yok — oturum hazır veya anasayfa açık.");
    return { manualAuthRequired: false, emailFilled: false };
  }

  if (credentials.email) {
    const emailInput = await findVisibleEmailInput(page);
    if (emailInput) {
      try {
        logger.info(`[bootstrap] Email dolduruluyor: ${maskEmail(credentials.email)}`);
        await humanTypeIntoLocator(page, emailInput, credentials.email, {
          label: "Portal email",
          minCharDelayMs: 40,
          maxCharDelayMs: 120,
        });
        emailFilled = true;
      } catch (error) {
        logger.warn(
          `[bootstrap] Email otomatik doldurulamadı — manuel devam: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  logger.info(
    "[bootstrap] Şifre ve OTP otomatik doldurulmaz — siz girdikten sonra devam edilecek.",
  );

  await waitForManualAuthCompletion(page, { allowEnterToContinue: true });

  return { manualAuthRequired: true, emailFilled };
}
