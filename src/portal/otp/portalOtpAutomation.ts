import type { Locator, Page } from "playwright";



import type { ResolvedProfile } from "../../profiles/profileManager.js";

import {

  handleIdentityPhoneVerificationPopupIfPresent,

  isIdentityPhoneVerificationPopupVisible,

} from "./identityPhoneVerificationPopup.js";



import {

  consumeSupabaseOtpForPhone,

  DEFAULT_SUPABASE_OTP_TIMEOUT_MS,

  isSupabaseOtpConfigured,

  normalizePhoneLast10,

  peekSupabaseOtp,

  type WaitSupabaseOtpOptions,

} from "../../integrations/supabaseOtp.js";

import { humanTypeIntoLocator } from "../../interaction/humanType.js";

import { resolveProfilePhone } from "../../profiles/profileCredentials.js";

import { logger } from "../../utils/logger.js";
import { detectWizardStep } from "../wizardStepDetector.js";
import { WIZARD_STEP } from "../wizardSteps.js";

import {

  DEFAULT_OTP_DIALOG_SELECTORS,

  getPortalOtpScreenVariants,

  WIZARD_INLINE_SMS_FORM_VARIANT,

  type OtpScreenVariant,

} from "./otpScreenCatalog.js";



export interface DetectedOtpScreen {

  variant: OtpScreenVariant;

  /** OTP alanı araması bu kapsamda yapılır */

  scope: Locator;

  containerLabel: string;

}



export interface PortalOtpHandledScreen {

  variantId: string;

  variantLabel?: string;

  containerLabel?: string;

  filled: boolean;

  codeRequested: boolean;

  submitted: boolean;

  skippedReason?: string;

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

  /** Doldurma sonrası doğrula butonuna tıkla (varsayılan: false) */

  clickSubmit?: boolean;

  waitOptions?: Pick<WaitSupabaseOtpOptions, "timeoutMs" | "intervalMs" | "consume">;

  /** Katalog yerine özel varyant listesi */

  variants?: OtpScreenVariant[];

  detectTimeoutMs?: number;

  /**

   * Ardışık OTP ekranları (kimlik popup → wizard Adım 5 vb.).

   * Varsayılan 2 — drain/checkpoint senaryoları için yeterli.

   */

  maxPasses?: number;

}



export interface PortalOtpAutomationResult {

  /** Herhangi bir OTP UI tespit edildi mi */

  detected: boolean;

  variantId?: string;

  variantLabel?: string;

  containerLabel?: string;

  /** Supabase'den kod alınıp alana yazıldı mı (son ekran veya tek ekran) */

  filled: boolean;

  /** Kod iste butonuna tıklandı mı (son geçiş) */

  codeRequested: boolean;

  submitted: boolean;

  skippedReason?: string;

  /** Birden fazla OTP alanı işlendiyse (kimlik + wizard) */

  handledScreens?: PortalOtpHandledScreen[];

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



type PortalOtpWaitResult =

  | { kind: "supabase"; otp: string }

  | { kind: "manual_dismiss" }

  | { kind: "timeout"; message: string };



async function isPortalOtpScreenVisible(

  variant: OtpScreenVariant,

  scope: Locator,

  probeMs: number,

): Promise<boolean> {

  const selectorHit = await isAnyVisible(scope, variant.detectSelectors, probeMs);

  if (selectorHit) {

    return true;

  }

  if (variant.detectTextPatterns?.length) {

    return matchesTextPatterns(scope, variant.detectTextPatterns);

  }

  return false;

}



/**

 * Wizard / genel portal OTP — Supabase poll + ekran kapandıysa manuel kabul.

 * Sabit 210sn bloklamaz; her turde OTP UI gorunurlugu kontrol edilir.

 */

async function waitForPortalOtpResolution(

  page: Page,

  phone: string,

  variant: OtpScreenVariant,

  scope: Locator,

  options: {

    since?: Date;

    timeoutMs?: number;

    pollIntervalMs?: number;

    waitOptions?: Pick<WaitSupabaseOtpOptions, "timeoutMs" | "intervalMs" | "consume" | "sbUrl" | "serviceKey" | "table">;

  } = {},

): Promise<PortalOtpWaitResult> {

  const timeoutMs =

    options.timeoutMs ?? options.waitOptions?.timeoutMs ?? DEFAULT_SUPABASE_OTP_TIMEOUT_MS;

  const pollMs = options.pollIntervalMs ?? options.waitOptions?.intervalMs ?? 2_500;

  const consume = options.waitOptions?.consume !== false;

  const since = options.since;

  const started = Date.now();

  let lastProgressLogAt = 0;

  const phoneLast10 = normalizePhoneLast10(phone);



  logger.info(

    `[portal-otp] OTP izleme — ekran poll ${pollMs}ms, timeout ${timeoutMs}ms` +

      (isSupabaseOtpConfigured(options.waitOptions) ? ", Supabase acik" : ", yalnizca manuel/ekran kapanisi"),

  );



  while (Date.now() - started < timeoutMs) {

    const stillVisible = await isPortalOtpScreenVisible(variant, scope, pollMs);

    if (!stillVisible) {

      logger.info("[portal-otp] OTP ekrani kapandi — manuel dogrulama kabul edildi, devam ediliyor.");

      return { kind: "manual_dismiss" };

    }



    if (isSupabaseOtpConfigured(options.waitOptions)) {

      try {

        const otp = await peekSupabaseOtp(phone, {

          since,

          consume: false,

          ...options.waitOptions,

        });

        if (otp) {

          logger.info(`[portal-otp] Supabase OTP alindi (***${phoneLast10.slice(-4)}).`);

          if (consume) {

            await consumeSupabaseOtpForPhone(phone, options.waitOptions);

          }

          return { kind: "supabase", otp };

        }

      } catch (error) {

        const message = error instanceof Error ? error.message : String(error);

        logger.warn(`[portal-otp] Supabase poll hatasi: ${message}`);

      }

    }



    const elapsed = Date.now() - started;

    if (elapsed - lastProgressLogAt >= 15_000) {

      lastProgressLogAt = elapsed;

      logger.info(

        `[portal-otp] OTP bekleniyor (${Math.round(elapsed / 1000)}s) — ekran acik, manuel giris veya SMS...`,

      );

    }



    await page.waitForTimeout(pollMs);

  }



  const stillVisible = await isPortalOtpScreenVisible(variant, scope, pollMs);

  if (!stillVisible) {

    logger.info("[portal-otp] Timeout sonrasi OTP ekrani kapali — manuel dogrulama kabul edildi.");

    return { kind: "manual_dismiss" };

  }



  return {

    kind: "timeout",

    message: `OTP gelmedi ve ekran acik (timeout ${timeoutMs}ms): ***${phoneLast10.slice(-4)}`,

  };

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



      if (variant.id === "wizard-phone-sms" || variant.id === "wizard-inline-sms-form") {
        const wizard = await detectWizardStep(page).catch(() => null);
        if (wizard?.viewStep === WIZARD_STEP.SUMMARY) {
          logger.debug("[portal-otp] Wizard Adım 4 (özet) — SMS OTP sayılmadi.");
          continue;
        }
      }

      const inputVisible = await isAnyVisible(scope, variant.inputSelectors, detectTimeoutMs);

      if (!inputVisible && variant.channel === "phone") {

        // Wizard: önce «kodu gönder», input sonra gelir — buton görünür olmalı

        if (!variant.requestCodeSelectors?.length) {

          continue;

        }

        const requestVisible = await isAnyVisible(
          scope,
          variant.requestCodeSelectors,
          detectTimeoutMs,
        );

        if (!requestVisible) {

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

  if (await button.isDisabled().catch(() => false)) {

    return false;

  }

  await button.click({ timeout: 5000 });

  logger.info(`[portal-otp] Tıklandı: ${label}`);

  return true;

}



/** Submit — disabled kalkana kadar poll (6 haneli kod sonrası aktifleşir). */

async function clickFirstEnabled(

  page: Page,

  scope: Locator,

  selectors: string[],

  label: string,

  timeoutMs = 20_000,

): Promise<boolean> {

  const deadline = Date.now() + timeoutMs;



  while (Date.now() < deadline) {

    for (const selector of selectors) {

      const button = scope.locator(selector).first();

      try {

        if (!(await button.isVisible({ timeout: 300 }))) {

          continue;

        }

        if (await button.isDisabled()) {

          continue;

        }

        await button.click({ timeout: 5000 });

        logger.info(`[portal-otp] Tıklandı: ${label}`);

        return true;

      } catch {

        // sonraki selector / poll

      }

    }

    await page.waitForTimeout(250);

  }



  return false;

}



async function waitForWizardInlineSmsForm(page: Page, timeoutMs = 15_000): Promise<boolean> {

  const input = page

    .locator(".sms-form-wrapper input.form-control[maxlength='6']")

    .first();

  try {

    await input.waitFor({ state: "visible", timeout: timeoutMs });

    return true;

  } catch {

    return false;

  }

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



function toHandledScreen(result: PortalOtpAutomationResult): PortalOtpHandledScreen {

  return {

    variantId: result.variantId ?? "unknown",

    variantLabel: result.variantLabel,

    containerLabel: result.containerLabel,

    filled: result.filled,

    codeRequested: result.codeRequested,

    submitted: result.submitted,

    skippedReason: result.skippedReason,

  };

}



function aggregateResults(screens: PortalOtpHandledScreen[]): PortalOtpAutomationResult {

  if (screens.length === 0) {

    return { detected: false, filled: false, codeRequested: false, submitted: false };

  }



  const last = screens[screens.length - 1]!;

  const anyFilled = screens.some((screen) => screen.filled);

  const anyRequested = screens.some((screen) => screen.codeRequested);

  const allResolved = screens.every(

    (screen) => screen.filled && (screen.submitted || !screen.skippedReason),

  );



  return {

    detected: true,

    variantId: last.variantId,

    variantLabel: last.variantLabel,

    containerLabel: last.containerLabel,

    filled: anyFilled && screens.every((screen) => screen.filled || Boolean(screen.skippedReason)),

    codeRequested: anyRequested,

    submitted: last.submitted,

    skippedReason: last.skippedReason,

    handledScreens: screens,

    ...(allResolved ? {} : { skippedReason: last.skippedReason ?? "OTP tamamlanamadi" }),

  };

}



/**

 * Tek geçiş — bir OTP ekranı (kimlik popup veya wizard).

 */

async function handlePortalPhoneOtpSinglePass(

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

      since: options.since,

      clickSubmit: options.clickSubmit !== false,

      waitOptions: options.waitOptions,

    });



    return {

      detected: identityResult.visible,

      variantId: "identity-phone-verification-popup",

      variantLabel: "Kimlik ve Telefon Doğrulama",

      containerLabel: "popup-content",

      filled: identityResult.otpFilled || Boolean(identityResult.manualDismiss),

      codeRequested: identityResult.codeRequested,

      submitted: identityResult.submitted || Boolean(identityResult.manualDismiss),

      skippedReason: identityResult.resolved ? undefined : identityResult.detail,

    };

  }



  return handleGenericPortalPhoneOtp(page, options);

}



/**

 * OTP ekranı varsa doldurmayı dener.

 * İki alan desteklenir:

 * 1. «Kimlik ve Telefon Doğrulama» popup (form + Supabase + doğrula)

 * 2. Randevu wizard Adım 5 (kodu gönder → inline SMS form → ödeme adımı)

 */

export async function handlePortalPhoneOtpIfPresent(

  page: Page,

  options: PortalOtpAutomationOptions,

): Promise<PortalOtpAutomationResult> {

  const maxPasses = options.maxPasses ?? 2;

  const screens: PortalOtpHandledScreen[] = [];



  for (let pass = 0; pass < maxPasses; pass++) {

    const result = await handlePortalPhoneOtpSinglePass(page, options);

    if (!result.detected) {

      break;

    }



    screens.push(toHandledScreen(result));



    const stuck = !result.filled && Boolean(result.skippedReason);

    const done = result.filled && (result.submitted || options.clickSubmit === false);



    if (stuck) {

      break;

    }



    if (done) {

      if (pass + 1 < maxPasses) {

        await page.waitForTimeout(900);

        const stillOtp = await detectPortalOtpScreen(page, {

          variants: options.variants,

          detectTimeoutMs: options.detectTimeoutMs ?? 400,

        });

        if (!stillOtp || stillOtp.variant.id === result.variantId) {

          break;

        }

        logger.info(

          `[portal-otp] Ek OTP ekranı (${stillOtp.variant.id}) — geçiş ${pass + 2}/${maxPasses}`,

        );

        continue;

      }

      break;

    }



    if (!result.filled && result.codeRequested) {

      break;

    }



    break;

  }



  if (screens.length === 0) {

    return { detected: false, filled: false, codeRequested: false, submitted: false };

  }



  if (screens.length === 1) {

    const only = screens[0]!;

    return {

      detected: true,

      variantId: only.variantId,

      variantLabel: only.variantLabel,

      containerLabel: only.containerLabel,

      filled: only.filled,

      codeRequested: only.codeRequested,

      submitted: only.submitted,

      skippedReason: only.skippedReason,

      handledScreens: screens,

    };

  }



  return aggregateResults(screens);

}



async function handleGenericPortalPhoneOtp(

  page: Page,

  options: PortalOtpAutomationOptions,

): Promise<PortalOtpAutomationResult> {

  let detected = await detectPortalOtpScreen(page, {

    variants: options.variants,

    detectTimeoutMs: options.detectTimeoutMs,

  });



  if (!detected) {

    return { detected: false, filled: false, codeRequested: false, submitted: false };

  }



  let { variant, scope, containerLabel } = detected;



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

      await page.waitForTimeout(1200);



      await waitForWizardInlineSmsForm(page, 15_000);



      const redetected = await detectPortalOtpScreen(page, {

        variants: options.variants,

        detectTimeoutMs: options.detectTimeoutMs ?? 500,

      });

      if (redetected && redetected.variant.id !== variant.id) {

        logger.info(

          `[portal-otp] Kod iste sonrası ekran: ${redetected.variant.id} (${redetected.variant.label})`,

        );

        variant = redetected.variant;

        scope = redetected.scope;

        containerLabel = redetected.containerLabel;

      } else if (variant.id === "wizard-phone-sms") {

        const inlineScope = page.locator(".sms-form-wrapper").first();

        if (await inlineScope.isVisible({ timeout: 500 }).catch(() => false)) {

          variant = WIZARD_INLINE_SMS_FORM_VARIANT;

          scope = inlineScope;

          containerLabel = "wizard-inline-sms";

          logger.info("[portal-otp] Inline SMS formu hazır — wizard-inline-sms-form");

        }

      }

    }

  }



  if (!since) {

    since = new Date();

  }



  const phone = resolveAutomationPhone(options.profileId, options.phone);



  const resolution = await waitForPortalOtpResolution(page, phone, variant, scope, {

    since,

    waitOptions: options.waitOptions,

  });



  if (resolution.kind === "manual_dismiss") {

    return {

      detected: true,

      variantId: variant.id,

      variantLabel: variant.label,

      containerLabel,

      filled: true,

      codeRequested,

      submitted: true,

    };

  }



  if (resolution.kind === "timeout") {

    logger.warn(`[portal-otp] Supabase OTP alınamadı (${variant.id}): ${resolution.message}`);

    return {

      detected: true,

      variantId: variant.id,

      variantLabel: variant.label,

      containerLabel,

      filled: false,

      codeRequested,

      submitted: false,

      skippedReason: resolution.message,

    };

  }



  const otp = resolution.otp;



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

    submitted = await clickFirstEnabled(page, scope, variant.submitSelectors, "dogrula");

  }



  return {

    detected: true,

    variantId: variant.id,

    variantLabel: variant.label,

    containerLabel,

    filled: true,

    codeRequested,

    submitted,

    skippedReason: submitted || !options.clickSubmit ? undefined : "Doğrula butonu tıklanamadı",

  };

}



/** Yalnızca hangi OTP ekranının açık olduğunu logla — doldurma yok */

export async function probePortalOtpScreen(page: Page): Promise<DetectedOtpScreen | null> {

  return detectPortalOtpScreen(page);

}



/** Wizard Adım 5 veya kimlik popup görünür mü — hızlı probe */

export async function isPortalPhoneOtpVisible(

  page: Page,

  detectTimeoutMs = 350,

): Promise<boolean> {

  if (await isIdentityPhoneVerificationPopupVisible(page, detectTimeoutMs)) {

    return true;

  }

  const detected = await detectPortalOtpScreen(page, { detectTimeoutMs });

  return detected !== null && detected.variant.channel === "phone";

}


