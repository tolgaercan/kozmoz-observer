import type { Browser, BrowserContext, Page } from "playwright";

import {
  runChromeGoogleBootstrap,
  waitAndAcceptChromeProfileSyncPrompt,
} from "../auth/chromeGoogleBootstrap.js";
import { connectOverCdp, isCdpEndpointReady } from "../browser/cdpConnector.js";
import { isChromeProfileLinkedToGoogle } from "../browser/chromeProfileIdentity.js";
import { prepareChromeForAutomation } from "../browser/chromeStartupPrep.js";
import type { AppSettings } from "../config/settings.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import type { ChromeGoogleCredentials } from "../profiles/profileCredentials.js";
import { logger } from "../utils/logger.js";
import type { PanelChromeProfile } from "./chromeProfileStore.js";
import type { ChromeLaunchResult } from "./chromeLauncher.js";

const PROFILE_PICKER_URL = "chrome://profile-picker";

async function waitForExactCdp(cdpEndpoint: string, attempts = 40): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await isCdpEndpointReady(cdpEndpoint, { exact: true })) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

export interface ChromeGoogleLoginResult {
  skipped: boolean;
  ready: boolean;
  detail: string;
}

function buildPanelAutomationSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    chromeProfileGateEnabled: true,
    chromeStartupUrl: process.env.CHROME_STARTUP_URL?.trim() || PROFILE_PICKER_URL,
  };
}

function buildCredentials(
  profile: ResolvedProfile,
  panelProfile: PanelChromeProfile,
): ChromeGoogleCredentials {
  return {
    email: panelProfile.chromeEmail.trim(),
    password: panelProfile.chromePassword,
    profileName: panelProfile.name.trim() || profile.name?.trim() || profile.id,
  };
}

async function openChromeProfilePickerIfNeeded(
  page: Page,
  profile: ResolvedProfile,
): Promise<void> {
  const profileDirectory = profile.browser?.profileDirectory ?? "Default";
  if (
    isChromeProfileLinkedToGoogle(profile.absoluteUserDataDir, profileDirectory)
  ) {
    return;
  }

  const currentUrl = page.url();
  if (!currentUrl.startsWith("chrome://")) {
    try {
      await page.goto(PROFILE_PICKER_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    } catch {
      await page.goto("chrome://settings/manageProfile", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    }
  }

  const signInButton = page
    .getByRole("button", { name: /oturum aç|sign in to chrome|sign in/i })
    .first();
  if (await signInButton.isVisible({ timeout: 4000 }).catch(() => false)) {
    logger.info("[panel] Chrome profil ekranı — Oturum aç tıklanıyor...");
    await signInButton.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
  }
}

async function pickAutomationPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages().filter((tab) => !tab.isClosed());
  const external = pages.find((tab) => {
    const url = tab.url();
    return url && !url.startsWith("devtools://");
  });
  if (external) {
    return external;
  }
  if (pages[0]) {
    return pages[0];
  }
  return context.newPage();
}

/**
 * Panelden yeni Chrome açıldığında Google email/şifre akışını çalıştırır.
 * Chrome zaten CDP'de açıksa (reusedExisting) hiçbir şey yapmaz.
 */
export async function ensureChromeGoogleLoginAfterLaunch(
  profile: ResolvedProfile,
  panelProfile: PanelChromeProfile,
  settings: AppSettings,
  launch: ChromeLaunchResult,
): Promise<ChromeGoogleLoginResult> {
  if (!launch.ok) {
    return { skipped: true, ready: false, detail: "Chrome başlatılamadı — giriş akışı atlandı" };
  }

  if (launch.reusedExisting) {
    logger.info("[panel] Chrome zaten açık — Google giriş akışı atlandı.");
    return {
      skipped: true,
      ready: true,
      detail: "Chrome zaten açık — giriş akışı atlandı",
    };
  }

  if (!panelProfile.chromeEmail?.trim()) {
    return { skipped: true, ready: false, detail: "Chrome email tanımlı değil" };
  }
  if (!panelProfile.chromePassword?.trim()) {
    return { skipped: true, ready: false, detail: "Chrome şifre tanımlı değil" };
  }

  const cdpEndpoint = launch.cdpEndpoint || profile.cdpEndpoint || settings.cdpEndpoint;
  const credentials = buildCredentials(profile, panelProfile);
  let browser: Browser | undefined;

  try {
    logger.info(
      `[panel] Google giriş akışı başlıyor (${profile.id}, ${credentials.email.replace(/(.{2}).*(@.*)/, "$1***$2")})`,
    );

    const cdpReady = await waitForExactCdp(cdpEndpoint);
    if (!cdpReady) {
      return {
        skipped: false,
        ready: false,
        detail: `CDP hazır değil (${cdpEndpoint}) — Google giriş akışı başlatılamadı`,
      };
    }

    const connected = await connectOverCdp(cdpEndpoint, { skipStealth: false });
    browser = connected.browser;
    const { context } = connected;
    const page = await pickAutomationPage(context);

    if (settings.preGotoDelayMs > 0) {
      await page.waitForTimeout(settings.preGotoDelayMs);
    }

    const automationSettings = buildPanelAutomationSettings(settings);
    await prepareChromeForAutomation(page, context, automationSettings);
    await openChromeProfilePickerIfNeeded(page, profile);

    const result = await runChromeGoogleBootstrap(page, credentials, profile, {
      allowReuseExisting: true,
    });

    await waitAndAcceptChromeProfileSyncPrompt(page, credentials.profileName, {
      timeoutMs: 45_000,
    });

    if (!result.ready) {
      return {
        skipped: false,
        ready: false,
        detail: "Google oturumu doğrulanamadı — tarayıcıda manuel tamamlayın",
      };
    }

    const detail = result.skippedExistingSession
      ? "Chrome/Google oturumu zaten hazırdı"
      : "Google email/şifre akışı tamamlandı";

    logger.info(`[panel] ${detail} (${profile.id})`);
    return { skipped: false, ready: true, detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[panel] Google giriş akışı hatası (${profile.id}): ${message}`);
    return { skipped: false, ready: false, detail: message };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
