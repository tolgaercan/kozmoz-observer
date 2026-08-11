import type { Page } from "playwright";

import type { ResolvedProfile } from "../../profiles/profileManager.js";
import { logger } from "../../utils/logger.js";
import { handlePortalPhoneOtpIfPresent } from "../otp/portalOtpAutomation.js";
import { PORTAL_INTERVENTION_PROBE_MS } from "./portalInterventionTiming.js";

export { PORTAL_INTERVENTION_PROBE_MS };

export interface PortalCheckpointContext {
  profile: ResolvedProfile;
  /** Doğrula butonuna tıkla (varsayılan true) */
  clickSubmit?: boolean;
}

export interface PortalCheckpointResult {
  checked: true;
  identityPopupVisible: boolean;
  handled: boolean;
  resolved: boolean;
  variantId?: string;
  detail?: string;
}

/**
 * Wizard / navigasyon herhangi bir noktasında — OTP popup varsa otomasyon dener.
 * Yoksa ~PORTAL_INTERVENTION_PROBE_MS içinde döner.
 */
export async function drainPortalInterventions(
  page: Page,
  ctx: PortalCheckpointContext,
): Promise<PortalCheckpointResult> {
  const result = await handlePortalPhoneOtpIfPresent(page, {
    profileId: ctx.profile.id,
    profile: ctx.profile,
    clickSubmit: ctx.clickSubmit !== false,
    clickRequestCode: true,
    detectTimeoutMs: PORTAL_INTERVENTION_PROBE_MS,
  });

  if (!result.detected) {
    return {
      checked: true,
      identityPopupVisible: false,
      handled: false,
      resolved: true,
    };
  }

  if (result.variantId === "identity-phone-verification-popup") {
    logger.info("[portal-checkpoint] Kimlik ve Telefon Doğrulama işlendi.");
  }

  return {
    checked: true,
    identityPopupVisible: result.variantId === "identity-phone-verification-popup",
    handled: true,
    resolved: Boolean(result.filled && result.submitted),
    variantId: result.variantId,
    detail: result.skippedReason,
  };
}

/** Aksiyon öncesi/sonrası popup kontrolü. */
export async function withPortalCheckpoint<T>(
  page: Page,
  ctx: PortalCheckpointContext,
  action: () => Promise<T>,
): Promise<T> {
  const before = await drainPortalInterventions(page, ctx);
  if (before.handled && !before.resolved) {
    logger.warn(
      `[portal-checkpoint] Popup tamamlanamadi: ${before.detail ?? resultDetail(before)}`,
    );
  }

  const output = await action();
  await drainPortalInterventions(page, ctx);
  return output;
}

function resultDetail(before: PortalCheckpointResult): string {
  return before.variantId ?? "bilinmiyor";
}
