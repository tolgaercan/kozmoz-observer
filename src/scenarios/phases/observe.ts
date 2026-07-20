import { loadCaptchaRuntime } from "../../captcha/captchaConfig.js";
import { resolveCdpObserverPageWithWizard } from "../../browser/cdpConnector.js";
import { isAppReady } from "../../challenge/interventionDetector.js";
import { InterventionWatcher } from "../../challenge/interventionWatcher.js";
import { executeProfileFlow } from "../../flows/flowExecutor.js";
import { resolveFlowId } from "../../flows/flowRegistry.js";
import { bootstrapFromKosmosHome } from "../../navigation/kosmosHomeEntry.js";
import { clickNavigationTarget } from "../../navigation/targetNavigator.js";
import {
  detectPortalNavState,
  resolveAppointmentProceduresUrl,
} from "../../navigation/kosmosPortalNav.js";
import { TelegramNotifier } from "../../notifications/telegramNotifier.js";
import { createPageCollection } from "../../pages/PageFactory.js";
import { startWizardStepGuard } from "../../appointment/wizardStepGuard.js";
import {
  formatWizardStepLog,
  isObserveTargetReady,
} from "../../appointment/wizardStepDetector.js";
import { isBasvuruPortalUrl, isKosmosMarketingHome, isKosmosPortalUrl } from "../../portal/kosmosOrigin.js";
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

  let { page, context } = runtime.session;
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
    const appointment = runtime.settings.appointment;

    const marketingTab = context.pages().find(
      (candidate) => !candidate.isClosed() && isKosmosMarketingHome(candidate.url()),
    );
    if (marketingTab) {
      page = marketingTab;
      logger.info(`[scenario] observe — attach: ana sayfa sekmesi: ${page.url()}`);
    } else {
      page = await resolveCdpObserverPageWithWizard(context, appointment.wizardNavLocator);
    }
    runtime.session.page = page;

    const url = page.url();
    if (!isKosmosPortalUrl(url)) {
      throw new Error(
        `[scenario] observe — attach: Kosmos sekmesi yok (${url}). kosmosvize.com.tr veya basvuru portalini acin.`,
      );
    }

    page = await bootstrapFromKosmosHome(page, context, runtime.settings);
    runtime.session.page = page;

    const ready = await isAppReady(page, expectedOrigin);
    if (!ready) {
      logger.warn(
        "[scenario] observe — attach: sayfa tam hazir degil (dogrulama/challenge olabilir). Elle cozun, sonra devam ediliyor.",
      );
    } else {
      logger.info(`[scenario] observe — attach: portal hazir (${page.url()}).`);
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
  } else if (attachOnly) {
    const portalState = detectPortalNavState(page.url());
    if (
      isKosmosMarketingHome(page.url()) ||
      portalState === "registerForm" ||
      (isBasvuruPortalUrl(page.url()) && portalState !== "appointmentForm")
    ) {
      logger.info(
        `[scenario] observe — attach: randevu akisina geciliyor (${portalState}).`,
      );
      await clickNavigationTarget(page, runtime.settings.navigation, { homeUrl });
    } else {
      logger.info("[scenario] observe — randevu navigasyonu atlandı (mevcut sayfa uygun).");
    }
  } else {
    logger.info("[scenario] observe — randevu navigasyonu atlandı (önceki adımda yapıldı).");
  }

  let observeTargetReached = false;
  let appointmentCity: string | undefined;

  const runWizardAutomation = async (): Promise<void> => {
    try {
      const flowResult = await executeProfileFlow(page, profile, runtime.settings, {
        softValidate: true,
        flowRef: flowId,
      });
      observeTargetReached = flowResult.observeTargetReached;
      appointmentCity = flowResult.city;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (afterRegister) {
        logger.warn(`[scenario] observe — wizard kurulumu tamamlanamadı: ${message}`);
        throw error;
      }
      if (attachOnly) {
        logger.warn(`[scenario] observe — attach: wizard otomasyonu kısmen tamamlandı: ${message}`);
      } else {
        throw error;
      }
    }
  };

  if (attachOnly) {
    logger.info(
      "[scenario] observe — attach: Randevu İşlemleri / wizard otomasyonu başlıyor (takvime kadar).",
    );
    await runWizardAutomation();

    const appointment = runtime.settings.appointment;
    const readiness = await isObserveTargetReady(
      page,
      appointment.wizardNavLocator,
      appointment.slotCalendarLocator,
    );
    if (readiness.ready) {
      observeTargetReached = true;
    }
    logger.info(
      `[scenario] observe — attach: ${readiness.state ? formatWizardStepLog(readiness.state) : "wizard yok"} | takvim=${readiness.calendarVisible} | slot watcher=${observeTargetReached}`,
    );
  } else {
    await runWizardAutomation();
  }

  interventionWatcher.startContinuousWatch(page, context, sessionPaths, expectedOrigin);

  const pages = createPageCollection(page, runtime.settings);

  const startSlotWatcherIfNeeded = (): void => {
    if (runtime.observeHandles.slotWatcher) {
      return;
    }
    runtime.observeHandles.slotWatcher = pages.calendar.startSlotWatcher(
      profile,
      appointmentCity,
    );
    observeTargetReached = true;
    logger.info("[scenario] observe — slot watcher aktif (Telegram bildirimi açık).");
  };

  runtime.observeHandles.wizardStepGuard = startWizardStepGuard(page, profile, runtime.settings, {
    targetReached: observeTargetReached,
    flowRef: flowId,
    onObserveTargetReady: startSlotWatcherIfNeeded,
  });

  if (observeTargetReached) {
    startSlotWatcherIfNeeded();
  } else {
    logger.warn(
      "[scenario] observe — takvim henüz hazır değil; wizard guard otomasyonu sürdürecek.",
    );
  }

  const telegram = new TelegramNotifier(runtime.settings.telegram);
  const startupDetail = observeTargetReached
    ? "Takvim gözlemi aktif."
    : "Wizard otomasyonu çalışıyor — takvime ulaşınca tarama başlayacak.";
  await telegram.sendStartupPing(profile.id, startupDetail);

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
    ok: attachOnly || observeTargetReached,
    detail: observeTargetReached
      ? "Observer durduruldu (slot watcher kapatıldı)"
      : attachOnly
        ? "Observer durduruldu (takvim bekleniyordu)"
        : "Observer wizard hedefine ulaşamadan durdu",
  };
}
