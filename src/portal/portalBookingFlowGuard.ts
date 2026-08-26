import type { Page } from "playwright";

import { isPaymentPageVisible } from "./payment/fillPaymentForm.js";
import { detectViewStepFromContent } from "./wizardStepDetector.js";
import { WIZARD_STEP } from "./wizardSteps.js";

export interface PortalBookingFlowLock {
  locked: boolean;
  reason?: string;
}

/**
 * Takvim sonrası booking akışı (özet / OTP / ödeme) — API poll wizard geri dönüşü yapılmamalı.
 */
export async function getPortalBookingFlowLock(page: Page): Promise<PortalBookingFlowLock> {
  if (await isPaymentPageVisible(page, 450)) {
    return { locked: true, reason: "odeme ekrani" };
  }

  const contentStep = await detectViewStepFromContent(page);
  if (contentStep !== null && contentStep >= WIZARD_STEP.SUMMARY) {
    const label =
      contentStep === WIZARD_STEP.SUMMARY
        ? "ozet/onay"
        : contentStep === WIZARD_STEP.OTP
          ? "OTP"
          : `adim ${contentStep}`;
    return { locked: true, reason: `wizard ${label} (${contentStep})` };
  }

  return { locked: false };
}
