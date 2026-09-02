import type { Page } from "playwright";



import { logger } from "../../utils/logger.js";

import type { ApiServiceContext } from "../client/apiService.js";

import { runBookingDayLoop } from "./bookingDayLoop.js";

import { buildCaptchaKeeperConfig, resolveBookingConfig } from "./bookingConfig.js";

import { CaptchaTokenKeeper } from "./captchaTokenKeeper.js";

import { GhostDayStore } from "./ghostDayStore.js";

import {
  logHourProbePreflight,
  validateHourProbePreflight,
} from "./bookingPreflight.js";
import { resolveBookingTriggerDays } from "./bookingTrigger.js";

import type { BookingCampaignInput, BookingCampaignResult } from "./bookingTypes.js";

import {

  advanceToApplicantInfoStep,

  advanceToCalendarStep,

  advanceToSummaryStep,
  advanceToOtpStep,
  ensureCalendarView,

  retreatToApplicantInfoStep,

} from "./wizardBookingNav.js";

import { fillApplicantInfoStep } from "./step2ApplicantInfoFill.js";
import {
  readNationalityNumberFromPage,
  resolveBookingNationalityNumber,
} from "../../portal/nationalityNumberInput.js";
import { fillSummaryConsentStep } from "./step4SummaryConsent.js";
import { handlePortalPhoneOtpIfPresent } from "../../portal/otp/portalOtpAutomation.js";
import { detectWizardStep } from "../../portal/wizardStepDetector.js";
import { WIZARD_STEP } from "../../portal/wizardSteps.js";
import { runBookingPaymentStep } from "./bookingPaymentStep.js";
import { isPaymentPageVisible } from "../../portal/payment/fillPaymentForm.js";
import { loadSettings } from "../../config/settings.js";
import { TelegramNotifier } from "../../notifications/telegramNotifier.js";
import { WorkerConfigStore } from "../../control-panel/workerConfigStore.js";

function buildApiContext(input: BookingCampaignInput): ApiServiceContext {

  return {

    projectRoot: input.projectRoot,

    profileId: input.profileId,

    settings: input.apiSettings,

    bearerToken: input.getBearerToken(),

  };

}



let campaignRunning = false;



export function isBookingCampaignRunning(): boolean {

  return campaignRunning;

}



/**

 * Yeni gün tetikli booking campaign.

 * Step 2 → Step 3 → gün döngüsü (API+UI, captcha keeper, L1 fallback).

 */

export async function runBookingCampaign(

  input: BookingCampaignInput,

): Promise<BookingCampaignResult> {

  const appSettings = loadSettings(input.projectRoot);
  const configDefaults = {
    pollIntervalMs: appSettings.apiWatcher.pollIntervalMs,
    telegramReportIntervalMs: appSettings.apiWatcher.telegramReportIntervalMs,
    paymentAutoSubmit: appSettings.apiWatcher.bookingPaymentAutoSubmit,
    payment3dsAuto: appSettings.apiWatcher.bookingPayment3dsAutoEnabled,
  };
  const worker = new WorkerConfigStore(input.projectRoot).getWorker(
    input.profileId,
    "",
    configDefaults,
  );
  const config = resolveBookingConfig(input.apiSettings, worker.booking);



  if (!config.enabled) {

    return {

      ok: false,

      phase: "skipped",

      reason: "Booking kapalı — API_BOOKING_ENABLED=false",

    };

  }



  if (campaignRunning) {

    return {

      ok: false,

      phase: "skipped",

      reason: "Başka bir booking campaign zaten çalışıyor",

    };

  }



  const ghostStore = new GhostDayStore(input.projectRoot);

  const currentAllowed =

    input.pollResult.activeDates ?? input.pollResult.allowedDates ?? input.addedAllowed;

  const triggerDays = resolveBookingTriggerDays(

    input.profileId,

    input.addedAllowed,

    currentAllowed,

    ghostStore,

  );



  if (triggerDays.length === 0) {

    return {

      ok: false,

      phase: "trigger_filter",

      reason: "Aktif gün yok veya tümü ghost — saat isteği atlanmadı",

    };

  }



  if (!input.page || input.page.isClosed()) {

    return {

      ok: false,

      phase: "skipped",

      reason: "Chrome sekmesi yok — booking atlandı",

      triggerDays,

    };

  }



  const page = input.page;

  const candidateDays = expandProbeCandidates(

    triggerDays,

    currentAllowed,

    config.hourProbeMaxRequests,

  );

  campaignRunning = true;



  try {

    logger.info(

      `[booking] Campaign başlıyor — profil=${input.profileId}, günler=[${candidateDays.join(", ")}]`,

    );



    const wizardState = await detectWizardStep(page, input.appointmentSettings.wizardNavLocator);

    const viewStep = wizardState?.viewStep ?? WIZARD_STEP.LOCATION;



    if (viewStep <= WIZARD_STEP.LOCATION) {

      await advanceToApplicantInfoStep(

        page,

        input.profile,

        input.appointmentSettings,

        input.queryParams,

      );

    } else {

      logger.info(

        `[booking] Wizard zaten adım ${viewStep} (${wizardState?.viewTitle ?? "?"}) — Step 1 doldurma atlanıyor.`,

      );

    }



    const fillResult = await fillApplicantInfoStep(

      page,

      input.profile,

      input.appointmentSettings,

      input.queryParams,

    );

    if (!fillResult.ok) {

      return {

        ok: false,

        phase: "fill_step2",

        reason: fillResult.reason,

        triggerDays,

      };

    }

    let nationalityNumber = resolveBookingNationalityNumber(
      input.profile,
      input.appointmentSettings.defaultNationalityNumber,
      input.queryParams.nationalityNumber,
    );
    if (!nationalityNumber.trim()) {
      nationalityNumber = await readNationalityNumberFromPage(page, input.appointmentSettings);
    }
    if (!nationalityNumber.trim()) {
      return {
        ok: false,
        phase: "fill_step2",
        reason: "nationalityNumber yok — panel Worker TC veya Step 2 alanı",
        triggerDays,
      };
    }

    logger.info(`[booking] Hour probe TC hazir (${nationalityNumber.slice(0, 3)}********).`);

    const preflight = validateHourProbePreflight(
      buildApiContext(input),
      input.queryParams,
      nationalityNumber,
      candidateDays[0] ?? "",
    );
    if (!preflight.ok) {
      return {
        ok: false,
        phase: "fill_step2",
        reason: preflight.reason ?? "Hour probe hazirlik basarisiz",
        triggerDays,
      };
    }
    logHourProbePreflight(
      buildApiContext(input),
      input.queryParams,
      nationalityNumber,
      candidateDays[0] ?? "",
      candidateDays.length,
      config.hourProbeMaxRequests,
    );

    let loopResult = await runCalendarPhase(input, page, config, candidateDays, nationalityNumber);



    if (loopResult.captchaFailed && config.step2RetryMax > 0) {

      logger.info("[booking] Captcha patience doldu — Step 2 retry denenecek.");

      await retreatToApplicantInfoStep(page, input.apiSettings.wizardNavLocator);



      const refill = await fillApplicantInfoStep(

        page,

        input.profile,

        input.appointmentSettings,

        input.queryParams,

        { force: true },

      );

      if (!refill.ok) {

        return {

          ok: false,

          phase: "fill_step2",

          reason: refill.reason ?? "Step 2 retry doldurma başarısız",

          triggerDays,

        };

      }



      await advanceToCalendarStep(page, input.profile, input.appointmentSettings);

      loopResult = await runCalendarPhase(input, page, config, candidateDays, nationalityNumber);

    }



    if (loopResult.captchaFailed) {

      await retreatToApplicantInfoStep(page, input.apiSettings.wizardNavLocator);

      return {

        ok: false,

        phase: "captcha",

        reason: loopResult.reason ?? "reCAPTCHA fresh token alınamadı",

        triggerDays,

        hourRequestsUsed: loopResult.requestsUsed,

      };

    }



    if (loopResult.rateLimited) {

      await retreatToApplicantInfoStep(page, input.apiSettings.wizardNavLocator);

      return {

        ok: false,

        phase: "hour_probe",

        reason: loopResult.reason,

        triggerDays,

        hourRequestsUsed: loopResult.requestsUsed,

      };

    }



    if (loopResult.ok && loopResult.verifiedSlot) {

      const tokenKeeper = new CaptchaTokenKeeper(

        page,

        buildCaptchaKeeperConfig(config),

        input.appointmentSettings,

      );

      tokenKeeper.start();

      try {

        const fresh = await tokenKeeper.awaitFresh(config.captchaPatienceMs);

        if (!fresh) {

          await retreatToApplicantInfoStep(page, input.apiSettings.wizardNavLocator);

          return {

            ok: false,

            phase: "captcha",

            reason: "Sonraki öncesi fresh captcha token alınamadı",

            triggerDays,

            hourRequestsUsed: loopResult.requestsUsed,

            verifiedSlot: loopResult.verifiedSlot,

          };

        }

      } finally {

        tokenKeeper.stop();

      }



      await advanceToSummaryStep(page, input.profile, input.appointmentSettings);

      const step4Result = await fillSummaryConsentStep(page, input.appointmentSettings);
      if (!step4Result.ok) {
        await retreatToApplicantInfoStep(page, input.apiSettings.wizardNavLocator);
        return {
          ok: false,
          phase: "fill_step4",
          reason: step4Result.reason ?? "Step 4 onay kutuları tamamlanamadı",
          triggerDays,
          hourRequestsUsed: loopResult.requestsUsed,
          verifiedSlot: loopResult.verifiedSlot,
        };
      }

      await advanceToOtpStep(page, input.profile, input.appointmentSettings);

      logger.info(
        `[booking] Step 5 (OTP) — ${loopResult.verifiedSlot.date} ${loopResult.selectedHourLabel ?? loopResult.verifiedSlot.hourLabel}`,
      );

      const otpResult = await handlePortalPhoneOtpIfPresent(page, {
        profileId: input.profileId,
        profile: input.profile,
        clickRequestCode: true,
        clickSubmit: true,
        maxPasses: 2,
      });

      const otpOk = otpResult.detected && otpResult.filled && otpResult.submitted;
      const onPayment = await isPaymentPageVisible(page, 800);

      if (!otpOk && !onPayment) {
        if (!otpResult.detected) {
          await retreatToApplicantInfoStep(page, input.apiSettings.wizardNavLocator);
          return {
            ok: false,
            phase: "otp_step5",
            reason: "Step 5 OTP ekranı tespit edilemedi",
            triggerDays,
            hourRequestsUsed: loopResult.requestsUsed,
            verifiedSlot: loopResult.verifiedSlot,
          };
        }

        await retreatToApplicantInfoStep(page, input.apiSettings.wizardNavLocator);
        return {
          ok: false,
          phase: "otp_step5",
          reason: otpResult.skippedReason ?? "Step 5 OTP tamamlanamadı",
          triggerDays,
          hourRequestsUsed: loopResult.requestsUsed,
          verifiedSlot: loopResult.verifiedSlot,
        };
      }

      if (!otpOk && onPayment) {
        logger.info(
          "[booking] OTP otomasyon tamamlanamadi ama odeme ekrani acik — odeme adimina devam.",
        );
      } else {
        logger.info(
          `[booking] OTP doğrulandı (${otpResult.variantId ?? "unknown"}) — ödeme adımına geçiliyor.`,
        );
      }

      const paymentResult = await runBookingPaymentStep(page, input.profile, config);

      const basePayload = {
        triggerDays,
        hourRequestsUsed: loopResult.requestsUsed,
        verifiedSlot: loopResult.verifiedSlot,
      };

      if (
        paymentResult.phase === "payment_3ds_manual" ||
        paymentResult.phase === "payment_3ds_complete"
      ) {
        logger.warn(
          `[booking] ${paymentResult.reason ?? "3D Secure"} — otomasyon durdu, manuel onay bekleniyor.`,
        );
        return {
          ok: true,
          phase: "payment_3ds_manual",
          reason: paymentResult.reason,
          ...basePayload,
        };
      }

      if (paymentResult.phase === "payment_success") {
        logger.info("[booking] Ödeme tamamlandı — randevu akışı bitti.");
        return {
          ok: true,
          phase: "success",
          reason: paymentResult.reason ?? "Ödeme ve randevu tamamlandı",
          ...basePayload,
        };
      }

      if (paymentResult.phase === "payment_unknown") {
        logger.warn(
          `[booking] ${paymentResult.reason ?? "Ödeme sonucu belirsiz"} — sayfayı manuel kontrol edin.`,
        );
        return {
          ok: true,
          phase: "payment_3ds_manual",
          reason: paymentResult.reason,
          ...basePayload,
        };
      }

      if (paymentResult.phase === "payment_ready") {
        const telegram = new TelegramNotifier(loadSettings(input.projectRoot).telegram);
        if (telegram.isConfigured()) {
          await telegram.notifyBookingPaymentReady({
            profileId: input.profileId,
            url: page.url(),
            date: loopResult.verifiedSlot?.date,
            hourLabel: loopResult.selectedHourLabel ?? loopResult.verifiedSlot?.hourLabel,
            submitEnabled: paymentResult.preSubmit?.submitEnabled,
            warnings: paymentResult.preSubmit?.pageWarnings,
          });
        }
        return {
          ok: true,
          phase: "payment_ready",
          reason: paymentResult.reason ?? "Form dolu — Telegram gönderildi, ödeme manuel",
          ...basePayload,
        };
      }

      const paymentPhase =
        paymentResult.phase === "payment_data_invalid" ||
        paymentResult.phase === "payment_fill_failed" ||
        paymentResult.phase === "payment_blocked"
          ? "fill_payment"
          : "fill_payment";

      logger.warn(`[booking] Ödeme adımı tamamlanamadı: ${paymentResult.reason ?? paymentResult.phase}`);
      return {
        ok: false,
        phase: paymentPhase,
        reason: paymentResult.reason ?? "Ödeme formu tamamlanamadı",
        ...basePayload,
      };

    }



    markExhaustedDaysGhost(ghostStore, input.profileId, loopResult);

    await retreatToApplicantInfoStep(page, input.apiSettings.wizardNavLocator);



    return {

      ok: false,

      phase: loopResult.uiFailedDays.length > 0 ? "ui_select" : "retreat_step2",

      reason: loopResult.reason ?? "Tüm aday günler denendi",

      triggerDays,

      hourRequestsUsed: loopResult.requestsUsed,

      ghostedDays: [...loopResult.uiFailedDays, ...loopResult.apiEmptyDays],

    };

  } catch (error) {

    const message = error instanceof Error ? error.message : String(error);

    logger.error(`[booking] Campaign hatası: ${message}`);

    try {

      await retreatToApplicantInfoStep(page, input.apiSettings.wizardNavLocator);

    } catch {

      // yoksay

    }

    return {

      ok: false,

      phase: "failed",

      reason: message,

      triggerDays,

    };

  } finally {

    campaignRunning = false;

  }

}



async function runCalendarPhase(

  input: BookingCampaignInput,

  page: Page,

  config: ReturnType<typeof resolveBookingConfig>,

  candidateDays: string[],

  nationalityNumber: string,

) {

  await advanceToCalendarStep(page, input.profile, input.appointmentSettings);

  await ensureCalendarView(page, input.apiSettings.wizardNavLocator);



  const tokenKeeper = new CaptchaTokenKeeper(

    page,

    buildCaptchaKeeperConfig(config),

    input.appointmentSettings,

  );

  tokenKeeper.start();



  try {

    return await runBookingDayLoop(

      page,

      buildApiContext(input),

      input.queryParams,

      input.appointmentSettings,

      config,

      candidateDays,

      nationalityNumber,

      tokenKeeper,

      input.apiSettings.wizardNavLocator,

    );

  } finally {

    tokenKeeper.stop();

  }

}



function markExhaustedDaysGhost(

  ghostStore: GhostDayStore,

  profileId: string,

  loopResult: Awaited<ReturnType<typeof runBookingDayLoop>>,

): void {

  if (loopResult.uiFailedDays.length > 0) {

    ghostStore.markGhost(profileId, loopResult.uiFailedDays, "ui_select_failed");

  }

  if (loopResult.apiEmptyDays.length > 0) {

    ghostStore.markGhost(profileId, loopResult.apiEmptyDays, "hour_quota_empty");

  }

}



/**
 * Yalnızca tetik günleri (addedAllowed / baseline listesi) — budget kadar.
 * Eski davranış tüm allowed listesine genişliyordu; UI 31.08'de takılınca 01.09'a kayıyordu.
 */
function expandProbeCandidates(
  triggerDays: string[],
  _currentAllowed: string[],
  maxRequests: number,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const date of [...triggerDays].sort()) {
    if (seen.has(date)) {
      continue;
    }
    seen.add(date);
    result.push(date);
    if (result.length >= maxRequests) {
      break;
    }
  }

  return result;
}


