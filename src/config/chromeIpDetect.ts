import { chromium } from "playwright";

import { isCdpEndpointReady } from "../browser/cdpConnector.js";

const IPIFY_URL = "http://api.ipify.org?format=json";

/** Chrome (direct://) üzerinden ipify — curl'dan farklı çıkış IP verebilir */
export async function measureHomeIpViaChrome(cdpPort: number): Promise<string | undefined> {
  const endpoint = `http://127.0.0.1:${cdpPort}`;
  if (!(await isCdpEndpointReady(endpoint))) {
    return undefined;
  }

  let browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 12_000 });
    const context = browser.contexts()[0];
    if (!context) {
      return undefined;
    }

    const page = context.pages().find((tab) => !tab.url().startsWith("chrome://")) ?? context.pages()[0];
    if (!page) {
      return undefined;
    }

    return await page.evaluate(async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        return undefined;
      }
      const body = (await response.json()) as { ip?: string };
      return body.ip?.trim() || undefined;
    }, IPIFY_URL);
  } catch {
    return undefined;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
