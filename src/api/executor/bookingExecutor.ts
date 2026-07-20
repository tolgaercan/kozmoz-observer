import type { ApiWatcherSettings } from "../../config/settings.js";
import type { ClosedDatePollResult } from "../types.js";
import { logger } from "../../utils/logger.js";

/** Booking POST — captcha/UI gerekirse headful moda geçiş (ileride CapSolver) */
export async function runBookingExecutorStub(details: {
  profileId: string;
  settings: ApiWatcherSettings;
  pollResult: ClosedDatePollResult;
}): Promise<void> {
  logger.info(
    `[api-executor] Randevu açık — booking stub (profil: ${details.profileId}). ` +
      `Headful + CapSolver burada devreye girecek. Özet: ${details.pollResult.summary}`,
  );

  if (details.settings.fallbackToBrowserOnCaptcha) {
    logger.info(
      "[api-executor] API_CAPTCHA_FALLBACK_BROWSER=true — tarayıcı captcha modu (henüz bağlanmadı).",
    );
  }
}
