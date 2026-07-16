import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { Page } from "playwright";

import { loadCaptchaRuntime } from "../captcha/captchaConfig.js";
import type { BrowserSession } from "../browser/contextFactory.js";
import { ContextFactory } from "../browser/contextFactory.js";
import { InterventionWatcher } from "../challenge/interventionWatcher.js";
import type { AppSettings, ObserverPhase } from "../config/settings.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { executeProfileFlow } from "../flows/flowExecutor.js";
import { getFlow, listFlows, resolveBootstrapFlowId, resolveFlowId } from "../flows/flowRegistry.js";
import {
  maskEmail,
  resolveChromeGoogleCredentials,
  resolveProfileCredentials,
} from "../profiles/profileCredentials.js";
import { runChromeProfileGate } from "../auth/chromeProfileBootstrap.js";
import { runChromeGoogleBootstrap, waitAndAcceptChromeProfileSyncPrompt } from "../auth/chromeGoogleBootstrap.js";
import { prepareChromeForAutomation } from "../browser/chromeStartupPrep.js";
import { runPortalBootstrap } from "../auth/portalBootstrapRunner.js";
import { runCheckpoint } from "../flows/flowCheckpoint.js";
import { createPageCollection } from "../pages/PageFactory.js";
import { startWizardStepGuard, type WizardStepGuardHandle } from "../appointment/wizardStepGuard.js";
import type { AppointmentSlotWatcherHandle } from "../appointment/appointmentSlotWatcher.js";
import { maskNationalityNumber } from "../appointment/nationalityNumberInput.js";
import { clickNavigationTarget } from "../navigation/targetNavigator.js";
import { resolveAppointmentProceduresUrl } from "../navigation/kosmosPortalNav.js";
import { ProfileManager } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";

export interface ObserverOptions {
  profileRef?: string;
  flowRef?: string;
  homeUrl?: string;
  pauseOnReady?: boolean;
  phase?: ObserverPhase;
}

export interface ObserverState {
  profile: ResolvedProfile;
  flowId: string;
  page: Page;
  context: BrowserSession["context"];
  homeUrl: string;
  isReady: boolean;
  appointmentCity?: string;
  applicationType?: string;
  nationalityNumber?: string;
  appointmentStyle?: string;
  wizardStep?: number;
}

export class Observer {
  private session: BrowserSession | null = null;
  private state: ObserverState | null = null;
  private interventionWatcher: InterventionWatcher | null = null;
  private wizardStepGuard: WizardStepGuardHandle | null = null;
  private slotWatcher: AppointmentSlotWatcherHandle | null = null;

  private readonly profileManager: ProfileManager;
  private readonly contextFactory: ContextFactory;

  constructor(private readonly settings: AppSettings) {
    this.profileManager = new ProfileManager(
      settings.projectRoot,
      settings.manifestPath,
    );
    this.contextFactory = new ContextFactory(this.profileManager, settings);
  }

  listAvailableProfiles(): void {
    const profiles = this.profileManager.listProfiles();
    logger.info("Mevcut profiller:");
    for (const [index, profile] of profiles.entries()) {
      const flow = profile.flowId ?? this.settings.defaultFlowId;
      logger.info(`  [${index}] ${profile.id} — ${profile.name} (akış: ${flow})`);
    }
  }

  listAvailableFlows(): void {
    const flows = listFlows();
    logger.info("Mevcut akışlar (test senaryoları):");
    for (const flow of flows) {
      logger.info(`  ${flow.id} — ${flow.name}`);
      if (flow.description) {
        logger.info(`    ${flow.description}`);
      }
    }
  }

  async start(options: ObserverOptions = {}): Promise<ObserverState> {
    const profileRef = options.profileRef ?? this.settings.defaultProfileId;
    const homeUrl = options.homeUrl ?? this.settings.visaPortalHomeUrl;
    const pauseOnReady = options.pauseOnReady ?? false;
    const phase = options.phase ?? this.settings.observerPhase;

    try {
      const profile = this.profileManager.resolveProfile(profileRef, this.settings);
      const flowId = resolveFlowId(options.flowRef, profile.flowId, this.settings.defaultFlowId);
      const flow = getFlow(flowId);
      const bootstrapFlowId = resolveBootstrapFlowId(profile.bootstrapFlowId);
      const credentials = resolveProfileCredentials(profile);
      const googleCredentials = resolveChromeGoogleCredentials(profile);
      const sessionPaths = this.profileManager.toSessionPaths(profile);
      const expectedOrigin = new URL(homeUrl).origin;

      logger.info(`Seçilen profil: ${profile.name} (${profile.id})`);
      logger.info(`Mod: ${profile.mode ?? "observer"} | lifecycle: ${profile.lifecycle?.state ?? "ready"}`);
      logger.info(`Chrome user-data: ${profile.absoluteUserDataDir}`);
      logger.info(`CDP: ${profile.cdpEndpoint}`);
      logger.info(`Chrome temiz profil: ${this.settings.chromeFreshProfile ? "evet (her run sifir)" : "hayir (oturum reuse)"}`);
      logger.info(`Bootstrap akışı: ${bootstrapFlowId}`);
      logger.info(`Ana akış: ${flow.name} (${flow.id})`);
      logger.info(`Çalışma aşaması: ${phase}`);
      if (credentials.email) {
        logger.info(`  Portal email: ${maskEmail(credentials.email)}`);
      }
      if (googleCredentials.email) {
        logger.info(`  Chrome Google email: ${maskEmail(googleCredentials.email)}`);
      }
      if (googleCredentials.password) {
        logger.info("  Chrome Google sifre: env'den yuklenecek");
      }

      this.session = await runCheckpoint(
        "cdp-baglanti",
        () => this.contextFactory.launch(profile),
      ) as BrowserSession;
      const { page, context } = this.session!;

      this.interventionWatcher = new InterventionWatcher(
        this.settings.projectRoot,
        this.settings,
        loadCaptchaRuntime(this.settings.projectRoot),
        profile.id,
      );
      const interventionWatcher = this.interventionWatcher;

      if (this.settings.preGotoDelayMs > 0) {
        logger.info(`Navigasyon öncesi ${this.settings.preGotoDelayMs}ms bekleniyor...`);
        await page.waitForTimeout(this.settings.preGotoDelayMs);
      }

      await runCheckpoint("chrome-hazirlik", () =>
        prepareChromeForAutomation(page, context, this.settings),
      );

      const bootstrapResult = await runCheckpoint(
        "chrome-google-giris",
        () =>
          runChromeGoogleBootstrap(page, googleCredentials, profile, {
            allowReuseExisting: !this.settings.chromeFreshProfile,
          }),
        { soft: true },
      );

      if (bootstrapResult?.ready) {
        logger.info(
          `[chrome] Google asamasi tamam (oturum=${bootstrapResult.signedInOnGoogle}, ` +
            `senkron=${bootstrapResult.syncPromptHandled}, ` +
            `atlandi=${bootstrapResult.skippedExistingSession}).`,
        );
      } else {
        logger.warn(
          "[chrome] Google asamasi otomatik dogrulanamadi — tarayici durumunu kontrol edin, Enter ile devam edebilirsiniz.",
        );
      }

      const syncHandled = await runCheckpoint(
        "chrome-profil-senkron",
        () => waitAndAcceptChromeProfileSyncPrompt(page, profile.name, { timeoutMs: 45_000 }),
        { soft: true },
      );

      if (syncHandled) {
        logger.info("[chrome] Profil senkron adimi tamam.");
      }

      if (phase === "chrome-profile") {
        logger.info(
          "[phase] Chrome + Google asamasi bitti.\n" +
            "  Chrome penceresini KAPATMAYIN — portal icin hemen:\n" +
            `    npm run observer -- --profile ${profile.id} --pause\n` +
            "  veya tek komutla (Chrome+Google+portal): npm run run:profile-1",
        );

        if (pauseOnReady) {
          await this.waitForUserSignal(
            "Google anasayfada oturum aciksa Enter'a basin (cikis)...",
          );
        }

        this.state = {
          profile,
          flowId,
          page,
          context,
          homeUrl,
          isReady: true,
        };

        return this.state;
      }

      if (
        this.settings.chromeProfileGateEnabled &&
        this.settings.browserMode !== "isolated"
      ) {
        await runCheckpoint("chrome-profil-ekrani", () =>
          runChromeProfileGate(page, this.settings.chromeStartupUrl),
        );
      }

      const portalEntryUrl = resolveAppointmentProceduresUrl(homeUrl);
      await runCheckpoint("portal-anasayfa", () =>
        this.navigateToHome(page, portalEntryUrl),
      );

      await runCheckpoint(
        "portal-bootstrap",
        () => runPortalBootstrap(page, credentials),
        { soft: true },
      );

      await runCheckpoint("mudahale-kontrol", () =>
        interventionWatcher.waitUntilReady(
          page,
          context,
          sessionPaths,
          expectedOrigin,
        ),
      );

      await runCheckpoint("sayfa-dogrulama", () => this.confirmPageLoaded(page, homeUrl));

      await runCheckpoint("randevu-navigasyon", () =>
        clickNavigationTarget(page, this.settings.navigation, { homeUrl }),
      );

      let appointmentCity: string | undefined;
      let applicationType: string | undefined;
      let nationalityNumber: string | undefined;
      let appointmentStyle: string | undefined;
      let wizardStep: number | undefined;
      let observeTargetReached = false;

      try {
        const flowResult = await runCheckpoint(
          "wizard-kurulum",
          () =>
            executeProfileFlow(page, profile, this.settings, {
              flowRef: options.flowRef,
              softValidate: true,
            }),
          { soft: true },
        );
        if (flowResult) {
          appointmentCity = flowResult.city;
          applicationType = flowResult.applicationType;
          nationalityNumber = flowResult.nationalityNumber;
          appointmentStyle = flowResult.appointmentStyle;
          wizardStep = flowResult.wizardStep;
          observeTargetReached = flowResult.observeTargetReached;
        }
      } catch (error) {
        logger.error(
          `[flow:${flowId}] Kurulum başarısız — observer açık kalıyor.`,
          error instanceof Error ? error.message : error,
        );
        logger.warn("Tarayıcıda sayfayı kontrol edin; gerekirse adımları manuel tamamlayın.");
      }

      this.interventionWatcher.startContinuousWatch(page, context, sessionPaths, expectedOrigin);

      this.wizardStepGuard = startWizardStepGuard(page, profile, this.settings, {
        targetReached: observeTargetReached,
        flowRef: options.flowRef ?? flowId,
      });

      if (observeTargetReached) {
        const pages = createPageCollection(page, this.settings);
        this.slotWatcher = pages.calendar.startSlotWatcher(profile, appointmentCity);
      }

      this.state = {
        profile,
        flowId,
        page,
        context,
        homeUrl,
        isReady: true,
        appointmentCity,
        applicationType,
        nationalityNumber,
        appointmentStyle,
        wizardStep,
      };

      logger.info("Observer hazır — login/doğrulama gözlemi + Telegram aktif.");
      logger.info(`  URL: ${page.url()}`);
      logger.info(`  Title: ${await page.title()}`);
      logger.info(`  Akış: ${flowId}`);
      if (appointmentCity) {
        logger.info(`  Kayıtlı il (appointmentCity): ${appointmentCity}`);
      }
      if (applicationType) {
        logger.info(`  Başvuru tipi (applicationType): ${applicationType}`);
      }
      if (nationalityNumber) {
        logger.info(`  TC Kimlik (nationalityNumber): ${maskNationalityNumber(nationalityNumber)}`);
      }
      if (appointmentStyle) {
        logger.info(`  Başvuru şekli (appointmentStyle): ${appointmentStyle}`);
      }
      if (wizardStep) {
        logger.info(`  Wizard adımı: ${wizardStep}`);
      }

      if (pauseOnReady) {
        await this.waitForUserSignal(
          "Sayfa hazır. Enter'a basın (tarayıcı açık kalır, Ctrl+C ile çık)...",
        );
      }

      return this.state;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  getPage(): Page {
    if (!this.state?.page) {
      throw new Error("Observer henüz hazır değil. Önce start() çağırın.");
    }
    return this.state.page;
  }

  getState(): ObserverState {
    if (!this.state) {
      throw new Error("Observer henüz hazır değil. Önce start() çağırın.");
    }
    return this.state;
  }

  async stop(options: { keepBrowserPage?: boolean } = {}): Promise<void> {
    this.slotWatcher?.stop();
    this.slotWatcher = null;
    this.wizardStepGuard?.stop();
    this.wizardStepGuard = null;
    this.interventionWatcher?.stopContinuousWatch();
    this.interventionWatcher = null;

    if (this.session) {
      await this.contextFactory.close(this.session, { keepPage: options.keepBrowserPage });
      this.session = null;
      this.state = null;
    }
  }

  private async navigateToHome(page: Page, targetUrl: string): Promise<void> {
    try {
      logger.info(`Portal sayfasına gidiliyor: ${targetUrl}`);
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
    } catch (error) {
      throw new Error(
        `Portal sayfası yüklenemedi (${targetUrl}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async confirmPageLoaded(page: Page, expectedUrl: string): Promise<void> {
    try {
      await page.waitForLoadState("networkidle", { timeout: 60_000 });
    } catch {
      logger.warn("networkidle zaman aşımı — domcontentloaded ile devam ediliyor.");
      await page.waitForLoadState("domcontentloaded");
    }

    logger.info(`Sayfa yüklendi: ${page.url()}`);

    if (!page.url().startsWith(new URL(expectedUrl).origin)) {
      logger.warn(`Origin farklı olabilir: ${page.url()}`);
    }
  }

  private async waitForUserSignal(message: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const rl = readline.createInterface({ input, output });
      const finish = (): void => {
        rl.close();
        resolve();
      };
      process.once("SIGINT", finish);
      void rl
        .question(`\n${message}\n`)
        .then(finish)
        .catch(finish)
        .finally(() => {
          process.off("SIGINT", finish);
        });
    });
  }
}
