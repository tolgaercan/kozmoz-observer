import type { Frame, Page } from "playwright";

import {
  DEFAULT_SUPABASE_OTP_TIMEOUT_MS,
  isSupabaseOtpConfigured,
  waitSupabaseOtp,
  type WaitSupabaseOtpOptions,
} from "../../integrations/supabaseOtp.js";
import { humanTypeIntoLocator } from "../../interaction/humanType.js";
import { resolveProfilePhone } from "../../profiles/profileCredentials.js";
import { logger } from "../../utils/logger.js";
import {
  THREE_DS_PAGE_MARKERS,
  THREE_DS_SELECTORS,
  type ThreeDsScreenKind,
} from "./threeDsSecureSelectors.js";

export interface ThreeDsSecureOptions {
  profileId: string;
  phone?: string;
  /** SS1 «Devam» veya OTP iste anı */
  since?: Date;
  /** SS1: SMS seç + Devam (varsayılan true) */
  advanceMethodStep?: boolean;
  /** SS2: OTP doldur + Devam (varsayılan true) */
  clickSubmit?: boolean;
  waitOptions?: Pick<WaitSupabaseOtpOptions, "timeoutMs" | "intervalMs" | "consume">;
  detectTimeoutMs?: number;
  otpInputWaitMs?: number;
  /** OTP gelmezse «Tekrar SMS Gönder» dene (varsayılan true) */
  allowResend?: boolean;
}

export interface ThreeDsSecureResult {
  detected: boolean;
  screen: ThreeDsScreenKind;
  contextLabel: string;
  methodStepCompleted: boolean;
  codeRequested: boolean;
  otpFilled: boolean;
  submitted: boolean;
  resolved: boolean;
  manualFallback: boolean;
  skippedReason?: string;
}

type ThreeDsContext = Page | Frame;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectThreeDsContexts(page: Page): Array<{ ctx: ThreeDsContext; label: string }> {
  const contexts: Array<{ ctx: ThreeDsContext; label: string }> = [{ ctx: page, label: "page" }];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) {
      continue;
    }
    contexts.push({ ctx: frame, label: `frame:${frame.url().slice(0, 80)}` });
  }
  return contexts;
}

async function isAnyVisible(
  ctx: ThreeDsContext,
  selectors: string[],
  timeoutMs: number,
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      if (await ctx.locator(selector).first().isVisible({ timeout: timeoutMs })) {
        return true;
      }
    } catch {
      // sonraki
    }
  }
  return false;
}

export async function detectThreeDsSecureScreen(
  page: Page,
  detectTimeoutMs = 400,
): Promise<{ ctx: ThreeDsContext; label: string; screen: ThreeDsScreenKind } | null> {
  for (const { ctx, label } of collectThreeDsContexts(page)) {
    const markerHit = await isAnyVisible(ctx, [...THREE_DS_PAGE_MARKERS], detectTimeoutMs);
    if (!markerHit) {
      continue;
    }

    const otpVisible = await ctx
      .locator(THREE_DS_SELECTORS.otpInput)
      .first()
      .isVisible({ timeout: detectTimeoutMs })
      .catch(() => false);

    if (otpVisible) {
      logger.info(`[3ds] OTP ekranı (SS2) — ${label}`);
      return { ctx, label, screen: "otp_entry" };
    }

    const methodVisible = await ctx
      .locator(THREE_DS_SELECTORS.methodStepTitle)
      .first()
      .isVisible({ timeout: detectTimeoutMs })
      .catch(() => false);

    if (methodVisible) {
      logger.info(`[3ds] Yöntem seçimi (SS1) — ${label}`);
      return { ctx, label, screen: "method_select" };
    }

    logger.info(`[3ds] 3DS yüzeyi (bilinmeyen adım) — ${label}`);
    return { ctx, label, screen: "unknown" };
  }

  return null;
}

export async function isThreeDsSecureVisible(page: Page, detectTimeoutMs = 400): Promise<boolean> {
  return (await detectThreeDsSecureScreen(page, detectTimeoutMs)) !== null;
}

async function ensureSmsMethodSelected(ctx: ThreeDsContext): Promise<void> {
  const smsLabel = ctx.locator(THREE_DS_SELECTORS.smsMethodLabel).first();
  if (await smsLabel.isVisible({ timeout: 1500 }).catch(() => false)) {
    await smsLabel.click({ timeout: 5000 });
    logger.info("[3ds] SS1 — «SMS ile Doğrula» seçildi.");
    await sleep(400);
    return;
  }

  const radios = ctx.locator(THREE_DS_SELECTORS.smsMethodRadio);
  const count = await radios.count().catch(() => 0);
  for (let index = 0; index < count; index++) {
    const radio = radios.nth(index);
    const parentText = (await radio.locator("xpath=ancestor::*[position()<=3]").innerText().catch(() => "")).toLowerCase();
    if (parentText.includes("sms")) {
      if (!(await radio.isChecked().catch(() => false))) {
        await radio.check({ force: true });
        logger.info("[3ds] SS1 — SMS radio seçildi.");
        await sleep(400);
      }
      return;
    }
  }
}

async function clickContinueWhenEnabled(
  ctx: ThreeDsContext,
  page: Page,
  label: string,
  timeoutMs = 20_000,
): Promise<boolean> {
  const button = ctx.locator(THREE_DS_SELECTORS.continueButton).first();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      if (!(await button.isVisible({ timeout: 300 }))) {
        await page.waitForTimeout(250);
        continue;
      }
      if (await button.isDisabled()) {
        await page.waitForTimeout(250);
        continue;
      }
      await button.click({ timeout: 8000 });
      logger.info(`[3ds] «Devam» tıklandı (${label}).`);
      return true;
    } catch {
      await page.waitForTimeout(250);
    }
  }

  return false;
}

async function clickResendOtp(ctx: ThreeDsContext): Promise<boolean> {
  const button = ctx.locator(THREE_DS_SELECTORS.resendOtpButton).first();
  if (!(await button.isVisible({ timeout: 3000 }).catch(() => false))) {
    return false;
  }
  if (await button.isDisabled().catch(() => false)) {
    logger.warn("[3ds] «Tekrar SMS Gönder» devre dışı.");
    return false;
  }
  await button.click({ timeout: 8000 });
  logger.info("[3ds] «Tekrar SMS Gönder» tıklandı.");
  return true;
}

async function waitForOtpInput(ctx: ThreeDsContext, timeoutMs: number): Promise<boolean> {
  try {
    await ctx.locator(THREE_DS_SELECTORS.otpInput).first().waitFor({
      state: "visible",
      timeout: timeoutMs,
    });
    return true;
  } catch {
    return false;
  }
}

async function advanceMethodSelectionStep(
  page: Page,
  ctx: ThreeDsContext,
  label: string,
): Promise<{ ok: boolean; since?: Date; reason?: string }> {
  await ensureSmsMethodSelected(ctx);
  const clicked = await clickContinueWhenEnabled(ctx, page, "SS1-Devam", 15_000);
  if (!clicked) {
    return { ok: false, reason: "SS1 «Devam» tıklanamadı" };
  }
  const since = new Date();
  await sleep(900);
  return { ok: true, since };
}

async function fillOtpAndSubmit(
  page: Page,
  ctx: ThreeDsContext,
  options: ThreeDsSecureOptions,
  since: Date,
): Promise<Pick<ThreeDsSecureResult, "otpFilled" | "submitted" | "resolved" | "skippedReason" | "manualFallback">> {
  if (!isSupabaseOtpConfigured()) {
    return {
      otpFilled: false,
      submitted: false,
      resolved: false,
      manualFallback: true,
      skippedReason: "SB_URL / SB_SERVICE_KEY tanımlı değil — 3DS OTP manuel",
    };
  }

  const phone = options.phone?.trim() || resolveProfilePhone(options.profileId);
  if (!phone) {
    return {
      otpFilled: false,
      submitted: false,
      resolved: false,
      manualFallback: true,
      skippedReason: "OTP telefonu yok — 3DS manuel",
    };
  }

  const otpTimeoutMs = options.waitOptions?.timeoutMs ?? DEFAULT_SUPABASE_OTP_TIMEOUT_MS;

  let otp: string;
  try {
    logger.info(`[3ds] Supabase OTP bekleniyor (***${phone.slice(-4)}, ${otpTimeoutMs}ms).`);
    otp = await waitSupabaseOtp(phone, {
      since,
      ...options.waitOptions,
      timeoutMs: otpTimeoutMs,
    });
  } catch (firstError) {
    const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
    logger.warn(`[3ds] OTP gelmedi — yeniden gönder deneniyor: ${firstMessage}`);

    if (options.allowResend !== false && (await clickResendOtp(ctx))) {
      const resentSince = new Date();
      await sleep(800);
      try {
        otp = await waitSupabaseOtp(phone, {
          since: resentSince,
          ...options.waitOptions,
          timeoutMs: otpTimeoutMs,
        });
      } catch (secondError) {
        const message = secondError instanceof Error ? secondError.message : String(secondError);
        return {
          otpFilled: false,
          submitted: false,
          resolved: false,
          manualFallback: true,
          skippedReason: `${message} — elle giriş için sayfa açık`,
        };
      }
    } else {
      return {
        otpFilled: false,
        submitted: false,
        resolved: false,
        manualFallback: true,
        skippedReason: `${firstMessage} — elle giriş için sayfa açık`,
      };
    }
  }

  const input = ctx.locator(THREE_DS_SELECTORS.otpInput).first();
  await humanTypeIntoLocator(page, input, otp, {
    label: "3DS-OTP",
    minCharDelayMs: 45,
    maxCharDelayMs: 110,
    clearBeforeType: true,
  });
  logger.info(`[3ds] OTP dolduruldu (***${phone.slice(-4)}).`);

  let submitted = false;
  if (options.clickSubmit !== false) {
    submitted = await clickContinueWhenEnabled(ctx, page, "SS2-Devam", 20_000);
    if (!submitted) {
      return {
        otpFilled: true,
        submitted: false,
        resolved: false,
        manualFallback: true,
        skippedReason: "OTP yazıldı — SS2 «Devam» tıklanamadı (manuel)",
      };
    }
    await sleep(1200);
  }

  const stillOnOtp = await ctx
    .locator(THREE_DS_SELECTORS.otpInput)
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);

  return {
    otpFilled: true,
    submitted,
    resolved: submitted && !stillOnOtp,
    manualFallback: !submitted || stillOnOtp,
    skippedReason: stillOnOtp ? "3DS OTP gönderildi — sonuç bekleniyor olabilir" : undefined,
  };
}

/**
 * 3D Secure SS1 → SS2 OTP akışı.
 * Kapalıyken çağrılmaz; `enabled: false` ile probe-only.
 */
export async function handleThreeDsSecureIfPresent(
  page: Page,
  options: ThreeDsSecureOptions & { enabled?: boolean },
): Promise<ThreeDsSecureResult> {
  const empty: ThreeDsSecureResult = {
    detected: false,
    screen: "unknown",
    contextLabel: "",
    methodStepCompleted: false,
    codeRequested: false,
    otpFilled: false,
    submitted: false,
    resolved: false,
    manualFallback: false,
  };

  if (options.enabled === false) {
    return empty;
  }

  const detectMs = options.detectTimeoutMs ?? 500;
  let detected = await detectThreeDsSecureScreen(page, detectMs);
  if (!detected) {
    return empty;
  }

  let { ctx, label, screen } = detected;
  let methodStepCompleted = false;
  let codeRequested = false;
  let since = options.since;

  const shouldAdvanceMethod = options.advanceMethodStep !== false;

  if (screen === "method_select" && shouldAdvanceMethod) {
    const step1 = await advanceMethodSelectionStep(page, ctx, label);
    if (!step1.ok) {
      return {
        ...empty,
        detected: true,
        screen,
        contextLabel: label,
        manualFallback: true,
        skippedReason: step1.reason,
      };
    }
    methodStepCompleted = true;
    codeRequested = true;
    since = step1.since ?? since ?? new Date();

    const otpInputWaitMs = options.otpInputWaitMs ?? 15_000;
    const otpReady = await waitForOtpInput(ctx, otpInputWaitMs);
    if (!otpReady) {
      detected = await detectThreeDsSecureScreen(page, detectMs);
      if (detected?.screen === "otp_entry") {
        ctx = detected.ctx;
        label = detected.label;
        screen = detected.screen;
      } else {
        for (const candidate of collectThreeDsContexts(page)) {
          if (await waitForOtpInput(candidate.ctx, 3000)) {
            ctx = candidate.ctx;
            label = candidate.label;
            screen = "otp_entry";
            break;
          }
        }
      }
    } else {
      screen = "otp_entry";
    }
  }

  if (screen === "otp_entry" || (await ctx.locator(THREE_DS_SELECTORS.otpInput).first().isVisible({ timeout: 400 }).catch(() => false))) {
    screen = "otp_entry";
    if (!since) {
      since = new Date();
      codeRequested = true;
    }

    const otpResult = await fillOtpAndSubmit(page, ctx, options, since);

    return {
      detected: true,
      screen: "otp_entry",
      contextLabel: label,
      methodStepCompleted,
      codeRequested,
      ...otpResult,
    };
  }

  if (screen === "method_select") {
    return {
      detected: true,
      screen,
      contextLabel: label,
      methodStepCompleted,
      codeRequested,
      otpFilled: false,
      submitted: false,
      resolved: false,
      manualFallback: true,
      skippedReason: "SS1 tamamlandı — SS2 OTP ekranı gelmedi",
    };
  }

  return {
    ...empty,
    detected: true,
    screen,
    contextLabel: label,
    manualFallback: true,
    skippedReason: "3DS ekranı tanınamadı",
  };
}

/** 3DS yüzeyi var mı — doldurma yok */
export async function probeThreeDsSecureScreen(page: Page) {
  return detectThreeDsSecureScreen(page);
}
