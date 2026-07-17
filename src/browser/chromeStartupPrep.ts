import type { BrowserContext, Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";

const RESTORE_BANNER_PATTERNS = [
  /sayfalar geri y[uü]klensin/i,
  /chrome.*do[gğ]ru.*kapat/i,
  /restore pages/i,
  /chrome didn.t shut down correctly/i,
];

const DISMISS_BUTTON_NAMES = [
  /^kapat$/i,
  /^close$/i,
  /^×$/,
  /^x$/i,
  /^dismiss$/i,
];

/**
 * Chrome yeni sekme / oturum geri yükleme bildirimini kapatır (Geri yükle değil).
 */
export async function dismissSessionRestoreBubble(context: BrowserContext): Promise<boolean> {
  let dismissed = false;

  for (const targetPage of context.pages()) {
    if (targetPage.isClosed()) {
      continue;
    }

    try {
      await targetPage.bringToFront();
    } catch {
      // sekme kapanmış olabilir
    }

    const hasBanner = await pageShowsRestoreBanner(targetPage);
    if (!hasBanner) {
      continue;
    }

    logger.info("[chrome] Oturum geri yükleme bildirimi algılandı — kapatılıyor...");

    for (const namePattern of DISMISS_BUTTON_NAMES) {
      const closeButton = targetPage.getByRole("button", { name: namePattern }).first();
      if (await closeButton.isVisible({ timeout: 800 }).catch(() => false)) {
        await closeButton.click({ timeout: 3000 });
        dismissed = true;
        break;
      }
    }

    if (!dismissed) {
      const iconClose = targetPage.locator('[aria-label="Kapat"], [aria-label="Close"]').first();
      if (await iconClose.isVisible({ timeout: 800 }).catch(() => false)) {
        await iconClose.click({ timeout: 3000 });
        dismissed = true;
      }
    }

    if (!dismissed) {
      await targetPage.keyboard.press("Escape").catch(() => undefined);
    }

    await targetPage.waitForTimeout(400);
  }

  if (dismissed) {
    logger.info("[chrome] Oturum geri yükleme bildirimi kapatıldı.");
  }

  return dismissed;
}

async function pageShowsRestoreBanner(page: Page): Promise<boolean> {
  for (const pattern of RESTORE_BANNER_PATTERNS) {
    const visible = await page
      .getByText(pattern)
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (visible) {
      return true;
    }
  }
  return false;
}

function resolveChromeStartMaximized(): boolean {
  return process.env.CHROME_START_MAXIMIZED?.trim().toLowerCase() !== "false";
}

/** CDP üzerinden Chrome penceresini maximize eder (--start-maximized yedek). */
export async function maximizeChromeWindow(
  page: Page,
  context: BrowserContext,
): Promise<boolean> {
  if (!resolveChromeStartMaximized()) {
    return false;
  }

  try {
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "maximized" },
    });
    logger.info("[chrome] Pencere tam ekran (maximized) yapıldı.");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[chrome] Pencere maximize edilemedi: ${message}`);
    return false;
  }
}

/**
 * CDP bağlantısından sonra Chrome'u otomasyon için hazırlar.
 * Izole modda profil seçim ekranı atlanır; doğrudan portal navigasyonuna geçilir.
 */
export async function prepareChromeForAutomation(
  page: Page,
  context: BrowserContext,
  settings: AppSettings,
): Promise<void> {
  await dismissSessionRestoreBubble(context);
  await page.bringToFront();
  await maximizeChromeWindow(page, context);

  const currentUrl = page.url();
  logger.info(`[chrome] Aktif sekme: ${currentUrl || "about:blank"}`);

  if (settings.browserMode === "isolated") {
    logger.info("[chrome] Izole profil modu — profil seçim ekranı atlanıyor.");
    return;
  }

  if (!settings.chromeProfileGateEnabled) {
    return;
  }

  logger.info(`[chrome] Profil ekranına gidiliyor: ${settings.chromeStartupUrl}`);
  await page.goto(settings.chromeStartupUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
}
