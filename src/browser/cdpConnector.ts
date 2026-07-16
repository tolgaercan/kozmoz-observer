import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

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

export async function resolveCdpObserverPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages().filter((candidate) => !candidate.isClosed());

  const reusable = pages.find((candidate) => {
    const url = candidate.url();
    return (
      !url.startsWith("chrome-extension://") &&
      !url.startsWith("devtools://") &&
      !url.startsWith("chrome://settings/")
    );
  });

  if (reusable) {
    logger.info(`Mevcut Chrome sekmesi kullaniliyor: ${reusable.url() || "about:blank"}`);
    await reusable.bringToFront();
    return reusable;
  }

  const page = await context.newPage();
  logger.info("Observer sekmesi acildi (CDP — yeni tab).");
  return page;
}
