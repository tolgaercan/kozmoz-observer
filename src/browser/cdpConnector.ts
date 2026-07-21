import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { detectWizardStepFromNav } from "../appointment/wizardStepDetector.js";
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

export async function connectOverCdp(endpoint: string): Promise<{
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
  const pages = context.pages().filter((candidate) => !candidate.isClosed());

  let best: Page | null = null;
  let bestScore = -1;

  for (const candidate of pages) {
    const score = scorePortalTabUrl(candidate.url());
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (best && bestScore > 0) {
    logger.info(`Portal sekmesi kullaniliyor (skor=${bestScore}): ${best.url()}`);
    await best.bringToFront();
    return best;
  }

  const reusable = pages.find((candidate) => isUsableTabUrl(candidate.url()));

  if (reusable) {
    logger.info(`Mevcut Chrome sekmesi kullaniliyor: ${reusable.url() || "about:blank"}`);
    await reusable.bringToFront();
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

/** GetClosedDate poll — mevcut portal sekmesi; navigasyon / wizard yok */
export async function resolveCdpApiPollPage(context: BrowserContext): Promise<Page> {
  return resolveCdpObserverPage(context);
}

/** @deprecated resolveCdpApiPollPage kullanın */
export async function resolveCdpApiWatcherPage(context: BrowserContext): Promise<Page> {
  return resolveCdpApiPollPage(context);
}
