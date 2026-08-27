import type { Page } from "playwright";

import type { ResolvedProfile } from "../../profiles/profileManager.js";
import { logger } from "../../utils/logger.js";
import {
  analyzePaymentFormBeforeSubmit,
  detectPaymentOutcomeAfterSubmit,
  type PaymentFormAnalysis,
  type PaymentOutcome,
} from "./paymentFormAnalysis.js";
import { fillPaymentForm, submitPaymentFormWhenReady, type FillPaymentFormResult } from "./fillPaymentForm.js";
import { waitForPaymentPage } from "./paymentPageDetect.js";
import {
  handleThreeDsSecureIfPresent,
  isThreeDsSecureVisible,
  type ThreeDsSecureResult,
} from "./threeDsSecureAutomation.js";

export interface RunPaymentStepOptions {
  profile: ResolvedProfile;
  /** true ise submit enabled + hata yoksa «Ödemeyi Tamamla» tıklanır */
  autoSubmit?: boolean;
  /** true ise 3DS SS1→SS2 Supabase OTP (varsayılan false — hazır bekler) */
  threeDsAutoEnabled?: boolean;
  paymentPageWaitMs?: number;
  submitWaitMs?: number;
  outcomeWaitMs?: number;
  threeDsDetectWaitMs?: number;
}

export type PaymentStepPhase =
  | "payment_page_missing"
  | "payment_data_invalid"
  | "payment_fill_failed"
  | "payment_blocked"
  | "payment_ready"
  | "payment_submitted"
  | "payment_3ds_manual"
  | "payment_3ds_complete"
  | "payment_success"
  | "payment_error"
  | "payment_unknown";

export interface RunPaymentStepResult {
  ok: boolean;
  phase: PaymentStepPhase;
  fill: FillPaymentFormResult;
  preSubmit?: PaymentFormAnalysis;
  postSubmit?: PaymentOutcome;
  threeDs?: ThreeDsSecureResult;
  reason?: string;
}

async function waitForThreeDsSurface(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isThreeDsSecureVisible(page, 450)) {
      return true;
    }
    await page.waitForTimeout(400);
  }
  return false;
}

async function tryThreeDsAutomation(
  page: Page,
  options: RunPaymentStepOptions,
  since?: Date,
): Promise<ThreeDsSecureResult | undefined> {
  if (!options.threeDsAutoEnabled) {
    return undefined;
  }

  const visible = await waitForThreeDsSurface(page, options.threeDsDetectWaitMs ?? 15_000);
  if (!visible) {
    logger.info("[payment] 3DS otomasyon açık — yüzey bulunamadı.");
    return undefined;
  }

  logger.info("[payment] 3DS otomasyon başlıyor (SS1 → SS2 Supabase OTP).");
  return handleThreeDsSecureIfPresent(page, {
    enabled: true,
    profileId: options.profile.id,
    since,
    advanceMethodStep: true,
    clickSubmit: true,
    allowResend: true,
  });
}

function buildThreeDsManualResult(
  fill: FillPaymentFormResult,
  preSubmit: PaymentFormAnalysis | undefined,
  postSubmit: PaymentOutcome | undefined,
  reason: string,
  threeDs?: ThreeDsSecureResult,
): RunPaymentStepResult {
  return {
    ok: true,
    phase: "payment_3ds_manual",
    fill: { ...fill, submitted: true },
    preSubmit,
    postSubmit,
    threeDs,
    reason,
  };
}

async function finalizeAfterThreeDs(
  page: Page,
  fill: FillPaymentFormResult,
  preSubmit: PaymentFormAnalysis | undefined,
  postSubmit: PaymentOutcome | undefined,
  threeDs: ThreeDsSecureResult | undefined,
  outcomeWaitMs: number,
): Promise<RunPaymentStepResult> {
  if (threeDs?.resolved) {
    const after = await detectPaymentOutcomeAfterSubmit(page, outcomeWaitMs);
    if (after.kind === "success") {
      return {
        ok: true,
        phase: "payment_success",
        fill: { ...fill, submitted: true },
        preSubmit,
        postSubmit: after,
        threeDs,
        reason: "3DS OTP doğrulandı — ödeme tamamlandı",
      };
    }
    return {
      ok: true,
      phase: "payment_3ds_complete",
      fill: { ...fill, submitted: true },
      preSubmit,
      postSubmit,
      threeDs,
      reason: threeDs.skippedReason ?? "3DS OTP gönderildi — sonucu manuel kontrol edin",
    };
  }

  if (threeDs?.otpFilled && !threeDs.submitted) {
    return buildThreeDsManualResult(
      fill,
      preSubmit,
      postSubmit,
      threeDs.skippedReason ?? "3DS OTP yazıldı — Devam manuel",
      threeDs,
    );
  }

  if (threeDs?.manualFallback) {
    return buildThreeDsManualResult(
      fill,
      preSubmit,
      postSubmit,
      threeDs.skippedReason ?? "3DS manuel onay bekliyor",
      threeDs,
    );
  }

  return buildThreeDsManualResult(
    fill,
    preSubmit,
    postSubmit,
    "Kart formu gönderildi — 3D Secure manuel onay bekliyor",
    threeDs,
  );
}

/**
 * Ödeme adımı: doldur → pre-submit analiz → (opsiyonel) submit → post-submit sonuç.
 * 3DS gerekiyorsa otomasyon durur; form dolu kalır (manuel onay).
 */
export async function runPaymentStep(
  page: Page,
  options: RunPaymentStepOptions,
): Promise<RunPaymentStepResult> {
  const pageReady = await waitForPaymentPage(page, options.paymentPageWaitMs ?? 45_000);
  if (!pageReady) {
    return {
      ok: false,
      phase: "payment_page_missing",
      fill: {
        ok: false,
        detected: false,
        filled: false,
        submitted: false,
        reason: "OTP sonrası ödeme sayfası yüklenmedi",
      },
      reason: "OTP sonrası ödeme sayfası yüklenmedi",
    };
  }

  logger.info("[payment] Ödeme sayfası hazır — form dolduruluyor.");

  const fill = await fillPaymentForm(page, {
    profile: options.profile,
    clickSubmit: false,
  });

  if (!fill.detected) {
    return {
      ok: false,
      phase: "payment_page_missing",
      fill,
      reason: fill.reason ?? "Ödeme sayfası tespit edilemedi",
    };
  }

  if (!fill.filled) {
    const phase = fill.reason?.includes("panel") || fill.reason?.includes("Kart")
      ? "payment_data_invalid"
      : "payment_fill_failed";
    return {
      ok: false,
      phase,
      fill,
      reason: fill.reason ?? "Ödeme formu doldurulamadı",
    };
  }

  const preSubmit = await analyzePaymentFormBeforeSubmit(page);

  if (!preSubmit.submitEnabled) {
    return {
      ok: false,
      phase: "payment_blocked",
      fill,
      preSubmit,
      reason:
        preSubmit.submitBlockedHint ??
        (preSubmit.fieldErrors[0] ?? "Ödemeyi Tamamla butonu etkin değil"),
    };
  }

  if (preSubmit.fieldErrors.length > 0) {
    return {
      ok: false,
      phase: "payment_blocked",
      fill,
      preSubmit,
      reason: preSubmit.fieldErrors.join("; "),
    };
  }

  if (options.autoSubmit === false) {
    logger.info(
      "[payment] Pre-submit OK — autoSubmit kapalı; form dolu, submit manuel bekleniyor.",
    );
    return {
      ok: true,
      phase: "payment_ready",
      fill,
      preSubmit,
      reason: "Form doğrulandı — submit manuel (API_BOOKING_PAYMENT_AUTO_SUBMIT=false)",
    };
  }

  logger.info("[payment] Pre-submit OK — «Ödemeyi Tamamla» tıklanıyor.");

  const submitted = await submitPaymentFormWhenReady(page, options.submitWaitMs ?? 30_000);

  if (!submitted) {
    return {
      ok: false,
      phase: "payment_blocked",
      fill: { ...fill, submitted: false },
      preSubmit,
      reason: "Submit tıklanamadı",
    };
  }

  const postSubmit = await detectPaymentOutcomeAfterSubmit(
    page,
    options.outcomeWaitMs ?? 12_000,
  );

  const submitSince = new Date();

  if (postSubmit.kind === "three_ds" || postSubmit.kind === "unknown") {
    const threeDs = await tryThreeDsAutomation(page, options, submitSince);
    if (threeDs?.detected) {
      return finalizeAfterThreeDs(
        page,
        fill,
        preSubmit,
        postSubmit,
        threeDs,
        options.outcomeWaitMs ?? 12_000,
      );
    }
    if (!options.threeDsAutoEnabled) {
      logger.info("[payment] 3DS otomasyon kapalı (API_BOOKING_PAYMENT_3DS_AUTO=false) — manuel.");
    }
    return buildThreeDsManualResult(
      fill,
      preSubmit,
      postSubmit,
      options.threeDsAutoEnabled
        ? "3DS yüzeyi algılandı — otomasyon eşleşmedi, manuel onay"
        : "Kart formu gönderildi — 3D Secure manuel (3DS otomasyon kapalı)",
    );
  }

  switch (postSubmit.kind) {
    case "success":
      return {
        ok: true,
        phase: "payment_success",
        fill: { ...fill, submitted: true },
        preSubmit,
        postSubmit,
        reason: "Ödeme tamamlandı",
      };
    case "error":
      return {
        ok: false,
        phase: "payment_error",
        fill: { ...fill, submitted: true },
        preSubmit,
        postSubmit,
        reason: postSubmit.detail ?? "Ödeme reddedildi veya hata",
      };
    case "still_on_form":
      return {
        ok: false,
        phase: "payment_error",
        fill: { ...fill, submitted: true },
        preSubmit,
        postSubmit,
        reason: postSubmit.detail ?? "Submit sonrası form hâlâ açık — portal yanıt vermedi",
      };
    default:
      const threeDs = await tryThreeDsAutomation(page, options, submitSince);
      if (threeDs?.detected) {
        return finalizeAfterThreeDs(
          page,
          fill,
          preSubmit,
          postSubmit,
          threeDs,
          options.outcomeWaitMs ?? 12_000,
        );
      }
      return {
        ok: true,
        phase: "payment_unknown",
        fill: { ...fill, submitted: true },
        preSubmit,
        postSubmit,
        reason:
          "Submit yapıldı — sonuç belirsiz (3DS veya başarı olabilir); sayfayı manuel kontrol edin",
      };
  }
}
