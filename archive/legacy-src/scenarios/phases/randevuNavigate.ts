import { navigateKosmosAppointmentFlow, isAppointmentWizardReady } from "../../navigation/kosmosPortalNav.js";
import { humanPause } from "../../interaction/humanPacing.js";
import { logger } from "../../utils/logger.js";
import type { ScenarioRuntime } from "../scenarioRuntime.js";

export interface RandevuNavigatePhaseResult {
  ok: boolean;
  detail: string;
}

/**
 * Phase: randevu-navigate
 * Randevu İşlemleri → Randevu Al — observer randevu wizard girişi.
 */
export async function runRandevuNavigatePhase(
  runtime: ScenarioRuntime,
): Promise<RandevuNavigatePhaseResult> {
  if (!runtime.session) {
    throw new Error("[scenario] randevu-navigate — aktif oturum gerekli.");
  }

  const { page } = runtime.session;
  const homeUrl = runtime.settings.visaPortalHomeUrl;

  logger.info(`[scenario] randevu-navigate — başlangıç: ${page.url()}`);

  if (runtime.banSafe && (await isAppointmentWizardReady(page))) {
    logger.info("[scenario] randevu-navigate — banSafe: randevu wizard zaten acik, navigasyon atlandi.");
    return {
      ok: true,
      detail: "Randevu wizard zaten hazir — navigasyon atlandi",
    };
  }

  await humanPause(page, 2000, 5000, "Randevu menusu oncesi");
  await navigateKosmosAppointmentFlow(page, runtime.settings.navigation, { homeUrl });
  await humanPause(page, 1500, 3000, "Randevu wizard sonrasi");

  logger.info(`[scenario] randevu-navigate — wizard hazır: ${page.url()}`);
  return {
    ok: true,
    detail: "Randevu İşlemleri → Randevu Al tamamlandı",
  };
}
