import { fillRegisterOtpIfVisible } from "../../register/registerOtpFill.js";
import { humanPause } from "../../interaction/humanPacing.js";
import { logger } from "../../utils/logger.js";
import type { ScenarioRuntime } from "../scenarioRuntime.js";

export interface PortalInviteGatePhaseResult {
  ok: boolean;
  detail: string;
}

/**
 * Phase: portal-invite-gate
 * Davet URL (registerform?guid) açıldıktan sonra — yalnızca OTP stub.
 * Kayıt formu doldurulmaz; kayıtlı kullanıcı Randevu İşlemleri'ne geçer.
 */
export async function runPortalInviteGatePhase(
  runtime: ScenarioRuntime,
): Promise<PortalInviteGatePhaseResult> {
  if (!runtime.session) {
    throw new Error("[scenario] portal-invite-gate — aktif oturum gerekli.");
  }

  const { page } = runtime.session;
  logger.info(`[scenario] portal-invite-gate — ${page.url()}`);
  logger.info("[scenario] portal-invite-gate — kayıt wizard YOK; yalnızca OTP stub.");
  await humanPause(page, 2000, 4500, "Davet sayfasi okunuyor");

  const otp = await fillRegisterOtpIfVisible(page, {
    profileId: runtime.profileId,
    step: "identity",
  });

  if (otp.visible) {
    return {
      ok: true,
      detail: otp.filled ? "OTP alanı dolduruldu" : "OTP alanı görünür (stub — manuel/eklenti bekleniyor)",
    };
  }

  return {
    ok: true,
    detail: "Davet sayfası hazır — OTP alanı yok",
  };
}
