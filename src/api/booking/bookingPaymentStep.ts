import type { Page } from "playwright";

import type { BookingRuntimeConfig } from "./bookingConfig.js";
import type { ResolvedProfile } from "../../profiles/profileManager.js";
import { runPaymentStep, type RunPaymentStepResult } from "../../portal/payment/runPaymentStep.js";

export type { RunPaymentStepResult };

export async function runBookingPaymentStep(
  page: Page,
  profile: ResolvedProfile,
  config: BookingRuntimeConfig,
): Promise<RunPaymentStepResult> {
  return runPaymentStep(page, {
    profile,
    autoSubmit: config.paymentAutoSubmit,
    threeDsAutoEnabled: config.payment3dsAutoEnabled,
    paymentPageWaitMs: config.paymentPageWaitMs,
    submitWaitMs: config.paymentSubmitWaitMs,
    outcomeWaitMs: config.paymentOutcomeWaitMs,
    threeDsDetectWaitMs: config.payment3dsDetectWaitMs,
  });
}
