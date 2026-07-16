import type { BrowserContext, Page } from "playwright";

import { logger } from "../utils/logger.js";

const ACCEPT_SELECTORS = [
  "#accept-button",
  "cr-button#accept-button",
  "#interceptDialog #accept-button",
  "#interceptDialog cr-button.action-button",
];

const DIALOG_SELECTORS = ["#interceptDialog", "#interceptDialog #title"];

async function withCdpSession<T>(
  page: Page,
  fn: (session: Awaited<ReturnType<BrowserContext["newCDPSession"]>>) => Promise<T>,
): Promise<T | null> {
  let session: Awaited<ReturnType<BrowserContext["newCDPSession"]>> | null = null;
  try {
    session = await page.context().newCDPSession(page);
    await session.send("DOM.enable");
    return await fn(session);
  } catch (error) {
    logger.warn(
      `[chrome] CDP oturumu basarisiz: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  } finally {
    await session?.detach().catch(() => undefined);
  }
}

async function cdpSearchCount(page: Page, query: string): Promise<number> {
  const result = await withCdpSession(page, async (session) => {
    const search = await session.send("DOM.performSearch", {
      query,
      includeUserAgentShadowDOM: true,
    });
    await session.send("DOM.discardSearchResults", { searchId: search.searchId });
    return search.resultCount;
  });
  return result ?? 0;
}

async function cdpClickSelector(page: Page, selector: string): Promise<boolean> {
  const clicked = await withCdpSession(page, async (session) => {
    const search = await session.send("DOM.performSearch", {
      query: selector,
      includeUserAgentShadowDOM: true,
    });

    if (search.resultCount === 0) {
      await session.send("DOM.discardSearchResults", { searchId: search.searchId });
      return false;
    }

    const { nodeIds } = await session.send("DOM.getSearchResults", {
      searchId: search.searchId,
      fromIndex: 0,
      toIndex: 1,
    });
    await session.send("DOM.discardSearchResults", { searchId: search.searchId });

    const nodeId = nodeIds[0];
    if (!nodeId) {
      return false;
    }

    await session.send("DOM.scrollIntoViewIfNeeded", { nodeId });
    const { model } = await session.send("DOM.getBoxModel", { nodeId });
    const content = model.content;
    const x = (content[0] + content[2] + content[4] + content[6]) / 4;
    const y = (content[1] + content[3] + content[5] + content[7]) / 4;

    await session.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
    });
    await session.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    return true;
  });

  return clicked === true;
}

async function evaluateClickAcceptInFrame(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    try {
      const clicked = await frame.evaluate(() => {
        const candidates = [
          document.querySelector("#accept-button"),
          document.querySelector("cr-button#accept-button"),
          document.querySelector("#interceptDialog #accept-button"),
        ];

        for (const node of candidates) {
          if (node instanceof HTMLElement) {
            node.click();
            return true;
          }
        }
        return false;
      });
      if (clicked) {
        logger.info(`[chrome] evaluate click — accept-button (${frame.url()})`);
        return true;
      }
    } catch {
      // cross-origin frame
    }
  }
  return false;
}

export async function probeChromeInterceptDialog(page: Page): Promise<{
  dialogCount: number;
  acceptCount: number;
  url: string;
}> {
  const result = await withCdpSession(page, async (session) => {
    const dialogSearch = await session.send("DOM.performSearch", {
      query: "#interceptDialog",
      includeUserAgentShadowDOM: true,
    });
    const acceptSearch = await session.send("DOM.performSearch", {
      query: "#accept-button",
      includeUserAgentShadowDOM: true,
    });

    await session.send("DOM.discardSearchResults", { searchId: dialogSearch.searchId });
    await session.send("DOM.discardSearchResults", { searchId: acceptSearch.searchId });

    return {
      dialogCount: dialogSearch.resultCount,
      acceptCount: acceptSearch.resultCount,
    };
  });

  return {
    dialogCount: result?.dialogCount ?? 0,
    acceptCount: result?.acceptCount ?? 0,
    url: page.url(),
  };
}

export async function tryClickChromeInterceptDialog(page: Page): Promise<boolean> {
  for (const selector of ACCEPT_SELECTORS) {
    const count = await cdpSearchCount(page, selector);
    if (count === 0) {
      continue;
    }

    logger.info(`[chrome] CDP popup bulundu (${selector}, adet=${count}) — tiklaniyor...`);
    if (await cdpClickSelector(page, selector)) {
      logger.info(`[chrome] CDP ile popup kabul edildi (${selector}).`);
      await page.waitForTimeout(800);
      return true;
    }
  }

  if (await evaluateClickAcceptInFrame(page)) {
    await page.waitForTimeout(800);
    return true;
  }

  return false;
}

export async function tryClickChromeInterceptDialogInContext(
  context: BrowserContext,
): Promise<boolean> {
  for (const page of context.pages()) {
    if (page.isClosed()) {
      continue;
    }
    if (await tryClickChromeInterceptDialog(page)) {
      return true;
    }
  }
  return false;
}

export async function isChromeInterceptDialogPresent(page: Page): Promise<boolean> {
  for (const selector of DIALOG_SELECTORS) {
    if ((await cdpSearchCount(page, selector)) > 0) {
      return true;
    }
  }
  return page
    .locator("#interceptDialog")
    .first()
    .isVisible({ timeout: 300 })
    .catch(() => false);
}
