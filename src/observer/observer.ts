import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { Page } from "playwright";

import { loadCaptchaRuntime } from "../captcha/captchaConfig.js";
import type { BrowserSession } from "../browser/contextFactory.js";
import { ContextFactory } from "../browser/contextFactory.js";
import { InterventionWatcher } from "../challenge/interventionWatcher.js";
import type { AppSettings } from "../config/settings.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { executeProfileFlow } from "../flows/flowExecutor.js";
import { getFlow, listFlows, resolveFlowId } from "../flows/flowRegistry.js";
import { createPageCollection } from "../pages/PageFactory.js";
import { startWizardStepGuard, type WizardStepGuardHandle } from "../appointment/wizardStepGuard.js";
import type { AppointmentSlotWatcherHandle } from "../appointment/appointmentSlotWatcher.js";
import { maskNationalityNumber } from "../appointment/nationalityNumberInput.js";
import { clickNavigationTarget } from "../navigation/targetNavigator.js";
import { ProfileManager } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";

export interface ObserverOptions {
  profileRef?: string;
  flowRef?: string;
  homeUrl?: string;
  pauseOnReady?: boolean;
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

    try {
      const profile = this.profileManager.resolveProfile(profileRef, this.settings);
      const flowId = resolveFlowId(options.flowRef, profile.flowId, this.settings.defaultFlowId);
      const flow = getFlow(flowId);
      const sessionPaths = this.profileManager.toSessionPaths(profile);
      const expectedOrigin = new URL(homeUrl).origin;

      logger.info(`Seçilen profil: ${profile.name} (${profile.id})`);
      logger.info(`Seçilen akış: ${flow.name} (${flow.id})`);

      this.session = await this.contextFactory.launch(profile);
      const { page, context } = this.session;

      this.interventionWatcher = new InterventionWatcher(
        this.settings.projectRoot,
        this.settings,
        loadCaptchaRuntime(this.settings.projectRoot),
        profile.id,
      );

      if (this.settings.preGotoDelayMs > 0) {
        logger.info(`Navigasyon öncesi ${this.settings.preGotoDelayMs}ms bekleniyor...`);
        await page.waitForTimeout(this.settings.preGotoDelayMs);
      }

      await this.navigateToHome(page, homeUrl);

      await this.interventionWatcher.waitUntilReady(
        page,
        context,
        sessionPaths,
        expectedOrigin,
      );

      await this.confirmPageLoaded(page, homeUrl);

      await clickNavigationTarget(page, this.settings.navigation);

      let appointmentCity: string | undefined;
      let applicationType: string | undefined;
      let nationalityNumber: string | undefined;
      let appointmentStyle: string | undefined;
      let wizardStep: number | undefined;
      let observeTargetReached = false;

      try {
        const flowResult = await executeProfileFlow(page, profile, this.settings, {
          flowRef: options.flowRef,
          softValidate: true,
        });
        appointmentCity = flowResult.city;
        applicationType = flowResult.applicationType;
        nationalityNumber = flowResult.nationalityNumber;
        appointmentStyle = flowResult.appointmentStyle;
        wizardStep = flowResult.wizardStep;
        observeTargetReached = flowResult.observeTargetReached;
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

  async stop(): Promise<void> {
    this.slotWatcher?.stop();
    this.slotWatcher = null;
    this.wizardStepGuard?.stop();
    this.wizardStepGuard = null;
    this.interventionWatcher?.stopContinuousWatch();
    this.interventionWatcher = null;

    if (this.session) {
      await this.contextFactory.close(this.session);
      this.session = null;
      this.state = null;
    }
  }

  private async navigateToHome(page: Page, homeUrl: string): Promise<void> {
    try {
      logger.info(`Ana sayfaya gidiliyor: ${homeUrl}`);
      await page.goto(homeUrl, {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
    } catch (error) {
      throw new Error(
        `Ana sayfa yüklenemedi (${homeUrl}): ${error instanceof Error ? error.message : String(error)}`,
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
    const rl = readline.createInterface({ input, output });
    try {
      await rl.question(`\n${message}\n`);
    } finally {
      rl.close();
    }
  }
}
