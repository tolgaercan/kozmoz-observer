import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { detectWizardStepFromNav } from "../portal/wizardStepDetector.js";
import { applyStealthToContext } from "./stealth.js";
import { detectIntervention } from "../challenge/interventionDetector.js";
import { isBasvuruPortalUrl } from "../portal/kosmosOrigin.js";
import { logger } from "../utils/logger.js";

export async function isCdpEndpointReady(endpoint: string): Promise<boolean> {
  const bases = [endpoint.replace(/\/$/, ""), "http://127.0.0.1:9222", "http://localhost:9222"];
  const unique = [...new Set(bases)];

  for (const base of unique) {
    try {
      const response = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        return true;
      }
    } catch {
      // sonraki endpoint dene
    }
  }

  return false;
}

export async function connectOverCdp(
  endpoint: string,
  options: { skipStealth?: boolean } = {},
): Promise<{
  browser: Browser;
  context: BrowserContext;
}> {
  logger.info(`CDP bağlantısı kuruluyor: ${endpoint}`);

  const browser = await chromium.connectOverCDP(endpoint, { timeout: 30_000 });
  const context = browser.contexts()[0];

  if (!context) {
    throw new Error("CDP: açık browser context bulunamadı.");
  }

  logger.info("CDP bağlantısı başarılı — gerçek Chrome oturumuna bağlandı.");
  if (!options.skipStealth) {
    await applyStealthToContext(context);
  }
  return { browser, context };
}

function isUsableTabUrl(url: string): boolean {
  return (
    !url.startsWith("chrome-extension://") &&
    !url.startsWith("devtools://") &&
    !url.startsWith("chrome://settings/")
  );
}

/** Randevu / wizard sekmesini ana siteye tercih et */
export function scorePortalTabUrl(url: string): number {
  if (!url || !isUsableTabUrl(url)) {
    return -1;
  }

  if (!/kosmosvize\.com\.tr/i.test(url)) {
    return 0;
  }

  let score = 10;

  if (/basvuru\.kosmosvize\.com\.tr/i.test(url)) {
    score += 50;
  }
  if (/appointmentProcedures/i.test(url)) {
    score += 20;
  }
  if (/appointmentForm/i.test(url)) {
    score += 60;
  }
  if (/registerForm/i.test(url)) {
    score += 20;
  }
  if (/^https?:\/\/(www\.)?kosmosvize\.com\.tr(\/tr)?\/?$/i.test(url.replace(/#.*$/, ""))) {
    score += 18;
  }
  if (/randevu/i.test(url)) {
    score += 15;
  }
  if (/\/#\s*$/.test(url) || url.endsWith("#")) {
    score -= 8;
  }

  return score;
}

export async function resolveCdpObserverPage(context: BrowserContext): Promise<Page> {
  const portalPage = await findPortalTab(context);
  if (portalPage) {
    const score = scorePortalTabUrl(portalPage.url());
    logger.info(`Portal sekmesi kullaniliyor (skor=${score}): ${portalPage.url()}`);
    await portalPage.bringToFront();
    return portalPage;
  }

  const pages = context.pages().filter((candidate) => !candidate.isClosed());
  const reusable = pages.find((candidate) => isUsableTabUrl(candidate.url()));

  if (reusable) {
    logger.info(`Mevcut Chrome sekmesi kullaniliyor: ${reusable.url() || "about:blank"}`);
    return reusable;
  }

  const page = await context.newPage();
  logger.info("Observer sekmesi acildi (CDP — yeni tab).");
  return page;
}

/** Wizard nav görünen en uygun sekmeyi seç (attach modu) */
export async function resolveCdpObserverPageWithWizard(
  context: BrowserContext,
  wizardNavLocator = "ul.wizard-nav-pills",
): Promise<Page> {
  const pages = context.pages().filter((candidate) => !candidate.isClosed());

  let wizardPage: Page | null = null;
  let wizardScore = -1;

  for (const candidate of pages) {
    const score = scorePortalTabUrl(candidate.url());
    if (score < 0) {
      continue;
    }

    try {
      const state = await detectWizardStepFromNav(candidate, wizardNavLocator);
      if (state?.isOnWizard && score >= wizardScore) {
        wizardPage = candidate;
        wizardScore = score + 100;
      }
    } catch {
      // sekme geçişinde yoksay
    }
  }

  if (wizardPage) {
    logger.info(`Wizard sekmesi kullaniliyor (skor=${wizardScore}): ${wizardPage.url()}`);
    await wizardPage.bringToFront();
    return wizardPage;
  }

  return resolveCdpObserverPage(context);
}

export interface PortalPollTabResult {
  page: Page;
  onPortal: boolean;
  blocked: boolean;
}

/** Açık portal sekmesini bul — navigasyon yok */
export async function findPortalTab(context: BrowserContext): Promise<Page | null> {
  let best: Page | null = null;
  let bestScore = -1;

  for (const candidate of context.pages()) {
    if (candidate.isClosed()) {
      continue;
    }
    const score = scorePortalTabUrl(candidate.url());
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore > 0 ? best : null;
}

/** basvuru.kosmosvize.com.tr — tanitim ana sayfa (www) haric */
export async function findBasvuruPortalTab(context: BrowserContext): Promise<Page | null> {
  let best: Page | null = null;
  let bestScore = -1;

  for (const candidate of context.pages()) {
    if (candidate.isClosed() || !isBasvuruPortalUrl(candidate.url())) {
      continue;
    }
    const score = scorePortalTabUrl(candidate.url());
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore > 0 ? best : null;
}

async function assessPortalTab(page: Page): Promise<PortalPollTabResult> {
  const intervention = await detectIntervention(page);
  if (intervention.type === "blocked") {
    logger.error("[portal] Cloudflare block — poll yapilmamali.");
    return { page, onPortal: false, blocked: true };
  }
  return { page, onPortal: true, blocked: false };
}

/**
 * Kullanicinin elle portali acmasini bekler — page.goto YOK (ban onlemi).
 */
export async function waitForManualPortalTab(
  context: BrowserContext,
  maxWaitMs: number,
  pollIntervalMs = 3000,
): Promise<PortalPollTabResult> {
  const started = Date.now();
  let loggedWait = false;

  while (Date.now() - started < maxWaitMs) {
    const portalPage = await findBasvuruPortalTab(context);
    if (portalPage) {
      await portalPage.bringToFront();
      logger.info(`[portal] Basvuru sekmesi hazir: ${portalPage.url()}`);
      return assessPortalTab(portalPage);
    }

    if (!loggedWait) {
      logger.warn(
        "[portal] Basvuru sekmesi bekleniyor — ana sayfadan Vize Basvuru Adimlari veya " +
          "appointmentForm (API_WIZARD_AUTO_NAVIGATE aciksa otomasyon dener).",
      );
      loggedWait = true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const page = await resolveCdpObserverPage(context);
  return { page, onPortal: false, blocked: false };
}

function parsePreGotoDelayMs(): number {
  const raw = process.env.PRE_GOTO_DELAY_MS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 2500;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2500;
}

/**
 * Poll sekmesi — UI → token → poll sirasi.
 * Varsayilan: otomatik navigasyon YOK; kullanici portali elle acar (veya maxWaitMs kadar beklenir).
 * API_AUTO_OPEN_PORTAL_TAB=true ile otomatik goto (ban riski).
 */
export async function resolvePortalTabForApiPoll(
  context: BrowserContext,
  appointmentFormUrl: string,
  maxWaitMs = 0,
): Promise<PortalPollTabResult> {
  const portalPage = await findPortalTab(context);
  if (portalPage) {
    await portalPage.bringToFront();
    return assessPortalTab(portalPage);
  }

  if (process.env.API_AUTO_OPEN_PORTAL_TAB === "true") {
    const page = await resolveCdpObserverPage(context);
    const delayMs = parsePreGotoDelayMs();
    if (delayMs > 0) {
      logger.info(`[api-watcher] Navigasyon oncesi bekleme: ${delayMs}ms`);
      await page.waitForTimeout(delayMs);
    }

    logger.info(
      `[api-watcher] Portal sekmesi aciliyor (API_AUTO_OPEN_PORTAL_TAB=true): ${appointmentFormUrl}`,
    );
    await page.goto(appointmentFormUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    return assessPortalTab(page);
  }

  if (maxWaitMs > 0) {
    return waitForManualPortalTab(context, maxWaitMs);
  }

  logger.warn(
    "[portal] Portal sekmesi yok — once UI'dan appointmentForm acin, sonra watcher baslatin.",
  );
  const page = await resolveCdpObserverPage(context);
  return { page, onPortal: false, blocked: false };
}

/** @deprecated resolvePortalTabForApiPoll kullanın */
export async function ensurePortalTabForApiPoll(
  context: BrowserContext,
  appointmentFormUrl: string,
): Promise<Page> {
  const result = await resolvePortalTabForApiPoll(context, appointmentFormUrl);
  return result.page;
}

/** GetClosedDate poll — mevcut portal sekmesi; navigasyon / wizard yok */
export async function resolveCdpApiPollPage(context: BrowserContext): Promise<Page> {
  return resolveCdpObserverPage(context);
}

/** @deprecated resolveCdpApiPollPage kullanın */
export async function resolveCdpApiWatcherPage(context: BrowserContext): Promise<Page> {
  return resolveCdpApiPollPage(context);
}
