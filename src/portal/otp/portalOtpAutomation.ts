import type { Locator, Page } from "playwright";

import type { ResolvedProfile } from "../../profiles/profileManager.js";
import {
  handleIdentityPhoneVerificationPopupIfPresent,
  isIdentityPhoneVerificationPopupVisible,
} from "./identityPhoneVerificationPopup.js";

import {
  isSupabaseOtpConfigured,
  waitSupabaseOtp,
  type WaitSupabaseOtpOptions,
} from "../../integrations/supabaseOtp.js";
import { humanTypeIntoLocator } from "../../interaction/humanType.js";
import { resolveProfilePhone } from "../../profiles/profileCredentials.js";
import { logger } from "../../utils/logger.js";
import {
  DEFAULT_OTP_DIALOG_SELECTORS,
  getPortalOtpScreenVariants,
  type OtpScreenVariant,
} from "./otpScreenCatalog.js";

export interface DetectedOtpScreen {
  variant: OtpScreenVariant;
  /** OTP alanı araması bu kapsamda yapılır */
  scope: Locator;
  containerLabel: string;
}

export interface PortalOtpAutomationOptions {
  profileId: string;
  /** Kimlik popup için tam profil — verilirse popup akışı çalışır */
  profile?: ResolvedProfile;
  /** Panel worker-config / geçici numara override */
  phone?: string;
  /**
   * «Kodu gönder» zaten tıklandıysa o anı verin.
   * Verilmezse ve request butonu tıklanırsa tıklama anı kullanılır.
   */
  since?: Date;
  /** Kod iste butonuna otomatik tıkla (varsayılan: true) */
  clickRequestCode?: boolean;
  /** Doldurma sonrası doğrula butonuna tıkla (varsayılan: false — locator netleşince açılır) */
  clickSubmit?: boolean;
  waitOptions?: Pick<WaitSupabaseOtpOptions, "timeoutMs" | "intervalMs" | "consume">;
  /** Katalog yerine özel varyant listesi */
  variants?: OtpScreenVariant[];
  detectTimeoutMs?: number;
}

export interface PortalOtpAutomationResult {
  /** Herhangi bir OTP UI tespit edildi mi */
  detected: boolean;
  variantId?: string;
  variantLabel?: string;
  containerLabel?: string;
  /** Supabase'den kod alınıp alana yazıldı mı */
  filled: boolean;
  /** Kod iste butonuna tıklandı mı */
  codeRequested: boolean;
  submitted: boolean;
  skippedReason?: string;
}

async function isAnyVisible(
  scope: Locator,
  selectors: string[],
  timeoutMs: number,
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = scope.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: timeoutMs })) {
        return true;
      }
    } catch {
      // sonraki
    }
  }
  return false;
}

async function matchesTextPatterns(scope: Locator, patterns: RegExp[]): Promise<boolean> {
  try {
    const text = await scope.innerText({ timeout: 2000 });
    return patterns.some((pattern) => pattern.test(text));
  } catch {
    return false;
  }
}

async function buildSearchScopes(page: Page, variant: OtpScreenVariant): Promise<Locator[]> {
  const scopes: Locator[] = [];
  const dialogSelectors = variant.containerSelectors?.length
    ? variant.containerSelectors
    : DEFAULT_OTP_DIALOG_SELECTORS;

  for (const dialogSelector of dialogSelectors) {
    const dialog = page.locator(dialogSelector).first();
    try {
      if (await dialog.isVisible({ timeout: 200 })) {
        scopes.push(dialog);
      }
    } catch {
      // yoksay
    }
  }

  scopes.push(page.locator("body"));
  return scopes;
}

/** Hangi OTP ekranı açık — yoksa null */
export async function detectPortalOtpScreen(
  page: Page,
  options: { variants?: OtpScreenVariant[]; detectTimeoutMs?: number } = {},
): Promise<DetectedOtpScreen | null> {
  const variants = options.variants ?? getPortalOtpScreenVariants();
  const detectTimeoutMs = options.detectTimeoutMs ?? 350;

  for (const variant of variants) {
    const scopes = await buildSearchScopes(page, variant);

    for (let index = 0; index < scopes.length; index++) {
      const scope = scopes[index]!;
      const containerLabel =
        index < scopes.length - 1 ? `dialog#${variant.id}` : "page";

      const selectorHit = await isAnyVisible(scope, variant.detectSelectors, detectTimeoutMs);
      let textHit = false;
      if (!selectorHit && variant.detectTextPatterns?.length) {
        textHit = await matchesTextPatterns(scope, variant.detectTextPatterns);
      }

      if (!selectorHit && !textHit) {
        continue;
      }

      const inputVisible = await isAnyVisible(scope, variant.inputSelectors, detectTimeoutMs);
      if (!inputVisible && variant.channel === "phone") {
        // Wizard: önce «kodu gönder», input sonra gelir — yine eşleş
        if (!variant.requestCodeSelectors?.length) {
          continue;
        }
      }

      logger.info(
        `[portal-otp] Ekran tespit: ${variant.id} (${variant.label}) — kapsam=${containerLabel}`,
      );
      return { variant, scope, containerLabel };
    }
  }

  return null;
}

async function findFirstVisibleLocator(
  scope: Locator,
  selectors: string[],
  timeoutMs: number,
): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = scope.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: timeoutMs })) {
        return locator;
      }
    } catch {
      // sonraki
    }
  }
  return null;
}

async function clickFirstVisible(
  scope: Locator,
  selectors: string[],
  label: string,
): Promise<boolean> {
  const button = await findFirstVisibleLocator(scope, selectors, 500);
  if (!button) {
    return false;
  }
  await button.click({ timeout: 5000 });
  logger.info(`[portal-otp] Tıklandı: ${label}`);
  return true;
}

async function fillOtpInputs(
  page: Page,
  scope: Locator,
  variant: OtpScreenVariant,
  code: string,
): Promise<boolean> {
  const mode = variant.inputMode ?? "single";

  if (mode === "multi-box") {
    for (const selector of variant.inputSelectors) {
      const inputs = scope.locator(selector);
      const count = await inputs.count();
      if (count >= code.length) {
        for (let index = 0; index < code.length; index++) {
          await humanTypeIntoLocator(page, inputs.nth(index), code[index]!, {
            label: `OTP-${index + 1}`,
            minCharDelayMs: 50,
            maxCharDelayMs: 120,
          });
        }
        return true;
      }
    }
    return false;
  }

  const input = await findFirstVisibleLocator(scope, variant.inputSelectors, 800);
  if (!input) {
    return false;
  }

  await humanTypeIntoLocator(page, input, code, {
    label: "OTP",
    minCharDelayMs: 45,
    maxCharDelayMs: 115,
  });
  return true;
}

function resolveAutomationPhone(profileId: string, override?: string): string {
  const phone = override?.trim() || resolveProfilePhone(profileId);
  if (!phone) {
    throw new Error(
      `Profil "${profileId}" için telefon yok (panel Worker OTP telefonu veya phone parametresi).`,
    );
  }
  return phone;
}

/**
 * OTP ekranı varsa doldurmayı dener.
 * «Kimlik ve Telefon Doğrulama» popup öncelikli (form + Supabase + doğrula).
 */
export async function handlePortalPhoneOtpIfPresent(
  page: Page,
  options: PortalOtpAutomationOptions,
): Promise<PortalOtpAutomationResult> {
  const detectMs = options.detectTimeoutMs ?? 350;
  if (
    options.profile &&
    (await isIdentityPhoneVerificationPopupVisible(page, detectMs))
  ) {
    const identityResult = await handleIdentityPhoneVerificationPopupIfPresent(page, {
      profile: options.profile,
      phone: options.phone,
      clickSubmit: options.clickSubmit !== false,
      waitOptions: options.waitOptions,
    });

    return {
      detected: identityResult.visible,
      variantId: "identity-phone-verification-popup",
      variantLabel: "Kimlik ve Telefon Doğrulama",
      containerLabel: "popup-content",
      filled: identityResult.otpFilled,
      codeRequested: identityResult.codeRequested,
      submitted: identityResult.submitted,
      skippedReason: identityResult.resolved ? undefined : identityResult.detail,
    };
  }

  return handleGenericPortalPhoneOtp(page, options);
}

async function handleGenericPortalPhoneOtp(
  page: Page,
  options: PortalOtpAutomationOptions,
): Promise<PortalOtpAutomationResult> {
  const detected = await detectPortalOtpScreen(page, {
    variants: options.variants,
    detectTimeoutMs: options.detectTimeoutMs,
  });

  if (!detected) {
    return { detected: false, filled: false, codeRequested: false, submitted: false };
  }

  const { variant, scope, containerLabel } = detected;

  if (variant.channel !== "phone") {
    return {
      detected: true,
      variantId: variant.id,
      variantLabel: variant.label,
      containerLabel,
      filled: false,
      codeRequested: false,
      submitted: false,
      skippedReason: `Kanal=${variant.channel} — Supabase yalnızca telefon OTP`,
    };
  }

  if (!isSupabaseOtpConfigured()) {
    return {
      detected: true,
      variantId: variant.id,
      variantLabel: variant.label,
      containerLabel,
      filled: false,
      codeRequested: false,
      submitted: false,
      skippedReason: "SB_URL / SB_SERVICE_KEY tanımlı değil",
    };
  }

  let since = options.since;
  let codeRequested = false;
  const shouldRequest = options.clickRequestCode !== false;

  if (shouldRequest && variant.requestCodeSelectors?.length) {
    const clicked = await clickFirstVisible(scope, variant.requestCodeSelectors, "kod-iste");
    if (clicked) {
      since = new Date();
      codeRequested = true;
      await page.waitForTimeout(800);
    }
  }

  if (!since) {
    since = new Date();
  }

  const phone = resolveAutomationPhone(options.profileId, options.phone);

  let otp: string;
  try {
    otp = await waitSupabaseOtp(phone, {
      since,
      ...options.waitOptions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[portal-otp] Supabase OTP alınamadı (${variant.id}): ${message}`);
    return {
      detected: true,
      variantId: variant.id,
      variantLabel: variant.label,
      containerLabel,
      filled: false,
      codeRequested,
      submitted: false,
      skippedReason: message,
    };
  }

  const filled = await fillOtpInputs(page, scope, variant, otp);
  if (!filled) {
    logger.warn(`[portal-otp] OTP alanı bulunamadı — doldurulamadı (${variant.id})`);
    return {
      detected: true,
      variantId: variant.id,
      variantLabel: variant.label,
      containerLabel,
      filled: false,
      codeRequested,
      submitted: false,
      skippedReason: "OTP input locator eşleşmedi",
    };
  }

  logger.info(`[portal-otp] OTP dolduruldu (${variant.id}, ***${phone.slice(-4)})`);

  let submitted = false;
  if (options.clickSubmit && variant.submitSelectors?.length) {
    submitted = await clickFirstVisible(scope, variant.submitSelectors, "dogrula");
  }

  return {
    detected: true,
    variantId: variant.id,
    variantLabel: variant.label,
    containerLabel,
    filled: true,
    codeRequested,
    submitted,
  };
}

/** Yalnızca hangi OTP ekranının açık olduğunu logla — doldurma yok */
export async function probePortalOtpScreen(page: Page): Promise<DetectedOtpScreen | null> {
  return detectPortalOtpScreen(page);
}
