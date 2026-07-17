import { loadCaptchaRuntime } from "../../captcha/captchaConfig.js";
import { isAppReady } from "../../challenge/interventionDetector.js";
import { InterventionWatcher } from "../../challenge/interventionWatcher.js";
import { executeProfileFlow } from "../../flows/flowExecutor.js";
import { resolveFlowId } from "../../flows/flowRegistry.js";
import { resolveAppointmentProceduresUrl } from "../../navigation/kosmosPortalNav.js";
import { clickNavigationTarget } from "../../navigation/targetNavigator.js";
import { createPageCollection } from "../../pages/PageFactory.js";
import { startWizardStepGuard } from "../../appointment/wizardStepGuard.js";
import { resolveProfileCredentials } from "../../profiles/profileCredentials.js";
import { runRegisterFormSetup } from "../../register/registerFormRunner.js";
import { logger } from "../../utils/logger.js";
import type { ScenarioRuntime } from "../scenarioRuntime.js";
import type { ScenarioStepParams } from "../types.js";

export interface ObservePhaseResult {
  ok: boolean;
  detail: string;
}

function waitUntilInterrupted(): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = (): void => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

/**
 * Phase: observe
 * Randevu wizard kurulumu + slot watcher + Telegram.
 */
export async function runObservePhase(
  runtime: ScenarioRuntime,
  params?: ScenarioStepParams,
): Promise<ObservePhaseResult> {
  if (!runtime.session) {
    throw new Error("[scenario] observe — aktif CDP oturumu gerekli.");
  }

  const skipRegisterWizard = params?.skipRegisterWizard === true;
  const navAlreadyDone = params?.navAlreadyDone === true;
  const attachOnly = params?.attachOnly === true;
  const afterRegister = params?.afterRegister === true;

  if (afterRegister) {
    logger.warn(
      "[scenario] observe — kayıt sonrası mod: OTP/email doğrulama otomatik değil.",
    );
  }

  const { page, context } = runtime.session;
  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
  const credentials = resolveProfileCredentials(profile);
  const homeUrl = runtime.settings.visaPortalHomeUrl;
  const flowId = resolveFlowId(undefined, profile.flowId, runtime.settings.defaultFlowId);
  const sessionPaths = runtime.profileManager.toSessionPaths(profile);
  const expectedOrigin = new URL(homeUrl).origin;

  const interventionWatcher = new InterventionWatcher(
    runtime.projectRoot,
    runtime.settings,
    loadCaptchaRuntime(runtime.projectRoot),
    profile.id,
  );
  runtime.observeHandles.interventionWatcher = interventionWatcher;

  if (attachOnly) {
    const url = page.url();
    if (!/kosmosvize\.com\.tr/i.test(url)) {
      throw new Error(
        `[scenario] observe — attach: portal sekmesi yok (${url}). Once Randevu Al sayfasini acin, sonra tekrar deneyin.`,
      );
    }
    const ready = await isAppReady(page, expectedOrigin);
    if (!ready) {
      logger.warn(
        "[scenario] observe — attach: sayfa tam hazir degil (dogrulama/challenge olabilir). Elle cozun, sonra devam ediliyor.",
      );
    } else {
      logger.info("[scenario] observe — attach: portal hazir, mudahale dongusu atlandi.");
    }
  } else {
    await interventionWatcher.waitUntilReady(page, context, sessionPaths, expectedOrigin);
  }

  if (!skipRegisterWizard) {
    await runRegisterFormSetup(page, profile, runtime.settings, {
      homeUrl,
      softValidate: true,
    });
  } else {
    logger.info("[scenario] observe — kayıt wizard atlandı (kayıtlı kullanıcı / davet URL akışı).");
  }

  if (!navAlreadyDone) {
    const portalEntryUrl = resolveAppointmentProceduresUrl(homeUrl);
    await page.goto(portalEntryUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await clickNavigationTarget(page, runtime.settings.navigation, { homeUrl });
  } else {
    logger.info("[scenario] observe — randevu navigasyonu atlandı (önceki adımda yapıldı).");
  }

  let observeTargetReached = false;
  let appointmentCity: string | undefined;

  try {
    const flowResult = await executeProfileFlow(page, profile, runtime.settings, {
      softValidate: true,
    });
    observeTargetReached = flowResult.observeTargetReached;
    appointmentCity = flowResult.city;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (afterRegister) {
      logger.warn(`[scenario] observe — wizard kurulumu tamamlanamadı: ${message}`);
      return {
        ok: false,
        detail: "OTP/email doğrulama eksik — observer başlatılamadı",
      };
    }
    throw error;
  }

  interventionWatcher.startContinuousWatch(page, context, sessionPaths, expectedOrigin);

  runtime.observeHandles.wizardStepGuard = startWizardStepGuard(page, profile, runtime.settings, {
    targetReached: observeTargetReached,
    flowRef: flowId,
  });

  if (observeTargetReached) {
    const pages = createPageCollection(page, runtime.settings);
    runtime.observeHandles.slotWatcher = pages.calendar.startSlotWatcher(profile, appointmentCity);
    logger.info("[scenario] observe — slot watcher aktif (Telegram bildirimi açık).");
  } else {
    logger.warn("[scenario] observe — hedef wizard adımına ulaşılamadı; slot watcher başlatılmadı.");
  }

  logger.info("════════════════════════════════════════════");
  logger.info("[scenario] observe — Observer çalışıyor. Durdurmak için Ctrl+C.");
  logger.info(`  Akış: ${flowId}`);
  logger.info(`  URL: ${page.url()}`);
  if (credentials.email) {
    logger.info(`  Portal: ${credentials.email.replace(/(.{2}).*(@.*)/, "$1***$2")}`);
  }
  logger.info("════════════════════════════════════════════");

  await waitUntilInterrupted();

  return {
    ok: observeTargetReached,
    detail: observeTargetReached
      ? "Observer durduruldu (slot watcher kapatıldı)"
      : "Observer wizard hedefine ulaşamadan durdu",
  };
}
