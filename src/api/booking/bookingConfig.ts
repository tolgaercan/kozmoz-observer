import type { ApiWatcherSettings } from "../../config/settings.js";



export interface BookingRuntimeConfig {

  enabled: boolean;

  hourProbeMaxRequests: number;

  hourProbeBatchSize: number;

  hourProbeDelayMs: number;

  /** @deprecated captchaPatienceMs kullanın */

  captchaWaitMs: number;

  /** Captcha/extension için max sabır (ms) — kısa fail yok */

  captchaPatienceMs: number;

  tokenMaxAgeMs: number;

  tokenPollIntervalMs: number;

  tokenLogEveryMs: number;

  tokenStaleBumpEnabled: boolean;

  tokenStaleBumpCooldownMs: number;

  /** Gün başına UI saat paneli max bekleme */

  uiDayAttemptMs: number;

  step2RetryMax: number;

  paymentAutoSubmit: boolean;
  paymentPageWaitMs: number;
  paymentSubmitWaitMs: number;
  paymentOutcomeWaitMs: number;
  /** 3DS SS1→SS2 Supabase OTP — varsayılan kapalı */
  payment3dsAutoEnabled: boolean;
  payment3dsDetectWaitMs: number;
}



export function resolveBookingConfig(apiSettings: ApiWatcherSettings): BookingRuntimeConfig {

  const captchaPatienceMs =

    apiSettings.bookingCaptchaPatienceMs > 0

      ? apiSettings.bookingCaptchaPatienceMs

      : apiSettings.bookingCaptchaWaitMs;



  return {

    enabled: apiSettings.bookingEnabled,

    hourProbeMaxRequests: apiSettings.bookingHourProbeMaxRequests,

    hourProbeBatchSize: apiSettings.bookingHourProbeBatchSize,

    hourProbeDelayMs: apiSettings.bookingHourProbeDelayMs,

    captchaWaitMs: apiSettings.bookingCaptchaWaitMs,

    captchaPatienceMs,

    tokenMaxAgeMs: apiSettings.bookingTokenMaxAgeMs,

    tokenPollIntervalMs: apiSettings.bookingTokenPollIntervalMs,

    tokenLogEveryMs: apiSettings.bookingTokenLogEveryMs,

    tokenStaleBumpEnabled: apiSettings.bookingTokenStaleBumpEnabled,

    tokenStaleBumpCooldownMs: apiSettings.bookingTokenStaleBumpCooldownMs,

    uiDayAttemptMs: apiSettings.bookingUiDayAttemptMs,

    step2RetryMax: apiSettings.bookingStep2RetryMax,

    paymentAutoSubmit: apiSettings.bookingPaymentAutoSubmit,
    paymentPageWaitMs: apiSettings.bookingPaymentPageWaitMs,
    paymentSubmitWaitMs: apiSettings.bookingPaymentSubmitWaitMs,
    paymentOutcomeWaitMs: apiSettings.bookingPaymentOutcomeWaitMs,
    payment3dsAutoEnabled: apiSettings.bookingPayment3dsAutoEnabled,
    payment3dsDetectWaitMs: apiSettings.bookingPayment3dsDetectWaitMs,

  };

}



export function buildCaptchaKeeperConfig(config: BookingRuntimeConfig) {

  return {

    tokenMaxAgeMs: config.tokenMaxAgeMs,

    pollIntervalMs: config.tokenPollIntervalMs,

    patienceMs: config.captchaPatienceMs,

    logEveryMs: config.tokenLogEveryMs,

    staleBumpEnabled: config.tokenStaleBumpEnabled,

    staleBumpCooldownMs: config.tokenStaleBumpCooldownMs,

  };

}


