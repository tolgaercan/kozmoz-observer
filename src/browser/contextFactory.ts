import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import { buildCaptchaSettingsFromEnv } from "../captcha/captchaConfig.js";
import { prepareExtensionLaunch } from "../captcha/extensionLoader.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { ProfileManager } from "../profiles/profileManager.js";
import { loadSession } from "../session/sessionLoader.js";
import { clearBrowserCookies } from "../session/sessionReset.js";
import { logger } from "../utils/logger.js";
import {
  applyStealthToContext,
  buildContextOptions,
} from "./stealth.js";
import { connectOverCdp, resolveCdpObserverPage } from "./cdpConnector.js";
import { resolveObserverPage } from "./pageResolver.js";
import { assertChromeClosed, warnIfChromeRunning } from "./chromeProcessCheck.js";

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  sessionLoadResult: Awaited<ReturnType<typeof loadSession>>;
  browser?: Browser;
  viaCdp: boolean;
}

export interface LaunchOptions {
  /** true ise cookies.json / storage.json enjekte edilmez (kisisel Chrome oturumu) */
  skipSession?: boolean;
  /** true ise CDP'ye stealth script enjekte edilmez (ban riskini azaltir) */
  skipStealth?: boolean;
}

export class ContextFactory {
  constructor(
    private readonly profileManager: ProfileManager,
    private readonly settings: AppSettings,
  ) {}

  async launch(profile: ResolvedProfile, launchOptions: LaunchOptions = {}): Promise<BrowserSession> {
    try {
      if (this.settings.browserConnectMethod === "cdp") {
        return this.launchViaCdp(profile, launchOptions);
      }
      return this.launchViaPlaywright(profile, launchOptions);
    } catch (error) {
      throw new Error(
        `Browser context başlatılamadı: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async launchViaCdp(
    profile: ResolvedProfile,
    launchOptions: LaunchOptions = {},
  ): Promise<BrowserSession> {
    const cdpEndpoint = profile.cdpEndpoint || this.settings.cdpEndpoint;

    logger.info("Mod: CDP — Playwright Chrome BAŞLATMAZ, açık Chrome'a bağlanır.");
    logger.info(`  CDP endpoint: ${cdpEndpoint}`);
    logger.info(`  Chrome user-data: ${profile.absoluteUserDataDir}`);
    logger.info("  Chrome'u scripts/start-chrome-debug.ps1 -Profile <id> ile açmış olmalısınız.");

    const { browser, context } = await connectOverCdp(cdpEndpoint);
    if (!launchOptions.skipStealth) {
      await applyStealthToContext(context);
      logger.info("[stealth] CDP oturumuna anti-detection script uygulandi.");
    } else {
      logger.info("[stealth] CDP stealth atlandi (attach modu — mevcut Chrome oturumu).");
    }
    const page = await resolveCdpObserverPage(context);

    const skipSession =
      launchOptions.skipSession === true ||
      this.settings.chromeFreshProfile ||
      this.settings.chromeFreshStart ||
      this.settings.chromeUseSystemProfile ||
      this.settings.observerPhase === "chrome-profile";

    if (this.settings.chromeFreshProfile) {
      logger.info("Mod: temiz Chrome profili — portal cerez/storage enjekte edilmeyecek.");
    }
    if (this.settings.chromeUseSystemProfile) {
      logger.info("Mod: sistem Chrome profili — portal cerez/storage enjekte edilmeyecek (kisisel oturum).");
    }

    if (this.settings.chromeFreshStart) {
      await clearBrowserCookies(context);
    }

    const sessionPaths = this.profileManager.toSessionPaths(profile);
    const sessionLoadResult = await loadSession(context, page, sessionPaths, {
      skipCookies: skipSession,
      skipStorage: skipSession,
    });

    return {
      context,
      page,
      browser,
      viaCdp: true,
      sessionLoadResult,
    };
  }

  private async launchViaPlaywright(
    profile: ResolvedProfile,
    launchOptions: LaunchOptions = {},
  ): Promise<BrowserSession> {
    if (this.settings.browserMode === "fixed" && this.settings.fixedBrowser) {
      assertChromeClosed();
      logger.warn(
        "Playwright launch modu — Cloudflare tarafından algılanma riski YÜKSEK. BROWSER_CONNECT=cdp önerilir.",
      );
      logger.info("Sabit Chrome profili açılıyor:");
      logger.info(`  Profil yolu: ${this.settings.fixedBrowser.profilePath}`);
    } else {
      warnIfChromeRunning();
      logger.info(`Persistent context başlatılıyor: ${profile.name} (${profile.id})`);
    }

    const captchaConfig = buildCaptchaSettingsFromEnv(this.settings.projectRoot);
    const extensionSetup = prepareExtensionLaunch(captchaConfig);

    logger.info("Chrome başlatılıyor — profil yüklenirken 10-30 sn sürebilir...");

    const context = await chromium.launchPersistentContext(
      profile.absoluteUserDataDir,
      buildContextOptions(profile, this.settings, extensionSetup),
    );

    logger.info("Chrome başlatıldı (Playwright launch).");
    await applyStealthToContext(context);

    const page = await resolveObserverPage(context, {
      preferNewTab: this.settings.browserMode === "fixed",
    });

    const sessionLoadResult = await loadSession(
      context,
      page,
      this.profileManager.toSessionPaths(profile),
      {
        skipCookies: this.settings.browserMode === "fixed",
        skipStorage: this.settings.browserMode === "fixed",
      },
    );

    return { context, page, viaCdp: false, sessionLoadResult };
  }

  async close(session: BrowserSession, options: { keepPage?: boolean } = {}): Promise<void> {
    try {
      if (session.viaCdp) {
        if (options.keepPage) {
          logger.info(
            "Observer kapandi — Chrome penceresi acik kaldi.\n" +
              "  Portal icin Chrome'u kapatmadan: npm run observer -- --profile profile-1 --pause",
          );
          return;
        }
        await session.page.close();
        logger.info("Observer sekmesi kapatıldı — Chrome açık kaldı (CDP modu).");
        return;
      }

      await session.context.close();
      logger.info("Browser context kapatıldı.");
    } catch (error) {
      logger.error("Browser kapatılırken hata oluştu.", error);
    }
  }
}
