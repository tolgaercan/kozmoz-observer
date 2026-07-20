import type { BrowserContext, Page } from "playwright";

import { logger } from "../../utils/logger.js";
import { readPortalLocalStorage } from "../../session/sessionPersister.js";
import { extractJwtFromStorage, stripBearerPrefix } from "./jwtExtractor.js";

const AUTH_HEADER = "authorization";

/** Register / portal sayfasında Authorization header veya JWT yakala */
export async function capturePortalAuthorizationToken(
  page: Page,
  context: BrowserContext,
  waitMs = 45_000,
): Promise<{ token: string; source: "network" | "localStorage" } | null> {
  let networkToken: string | null = null;

  const onRequest = (request: { headers: () => Record<string, string> }): void => {
    const auth = request.headers()[AUTH_HEADER];
    if (auth?.trim()) {
      networkToken = stripBearerPrefix(auth);
    }
  };

  context.on("request", onRequest);

  const started = Date.now();
  try {
    while (Date.now() - started < waitMs) {
      if (networkToken) {
        logger.info("[api-auth] Authorization header yakalandi (network).");
        return { token: networkToken, source: "network" };
      }

      const storage = await readPortalLocalStorage(page);
      const jwt = extractJwtFromStorage(storage);
      if (jwt) {
        logger.info("[api-auth] JWT localStorage'dan alindi.");
        return { token: jwt, source: "localStorage" };
      }

      await page.waitForTimeout(1500);
    }
  } finally {
    context.off("request", onRequest);
  }

  return null;
}
