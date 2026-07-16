import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import type { ExtensionSetupResult } from "../captcha/extensionLoader.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";

/** Playwright persistent context için anti-detection init script */
export const STEALTH_INIT_SCRIPT = `
(() => {
  Object.defineProperty(navigator, "webdriver", {
    get: () => undefined,
    configurable: true,
  });

  if (window.navigator.chrome === undefined) {
    Object.defineProperty(window.navigator, "chrome", {
      get: () => ({ runtime: {} }),
      configurable: true,
    });
  }

  const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
  window.navigator.permissions.query = (parameters) =>
    parameters.name === "notifications"
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters);

  Object.defineProperty(navigator, "plugins", {
    get: () => [1, 2, 3, 4, 5],
    configurable: true,
  });

  Object.defineProperty(navigator, "languages", {
    get: () => ["tr-TR", "tr", "en-US", "en"],
    configurable: true,
  });
})();
`;

export async function applyStealthToContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(STEALTH_INIT_SCRIPT);

  for (const page of context.pages()) {
    if (page.isClosed()) {
      continue;
    }
    await applyStealthToPage(page);
  }
}

export async function applyStealthToPage(page: Page): Promise<void> {
  await page.evaluate(STEALTH_INIT_SCRIPT).catch(() => undefined);
}

type PersistentContextOptions = NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;

export const STEALTH_LAUNCH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-infobars",
  "--no-first-run",
  "--no-default-browser-check",
];

/** CDP ile acilan gercek Chrome icin (Playwright launch degil). enable-automation KULLANMA — Google reddeder. */
export const STEALTH_CDP_LAUNCH_ARGS = [
  ...STEALTH_LAUNCH_ARGS,
  "--disable-session-crashed-bubble",
  "--auto-accept-browser-signin-for-tests",
];

export const STEALTH_IGNORE_DEFAULT_ARGS = [
  "--enable-automation",
  "--disable-extensions",
  "--disable-component-extensions-with-background-pages",
];

export function buildContextOptions(
  profile: ResolvedProfile,
  settings: AppSettings,
  extensionSetup?: ExtensionSetupResult,
): PersistentContextOptions {
  const extraArgs = [...(extensionSetup?.launchArgs ?? [])];

  // profilePath doğrudan Default klasörü — --profile-directory gerekmez

  const options: PersistentContextOptions = {
    headless: false,
    viewport: null,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    acceptDownloads: true,
    ignoreHTTPSErrors: false,
    args: [...STEALTH_LAUNCH_ARGS, ...extraArgs],
    ignoreDefaultArgs: STEALTH_IGNORE_DEFAULT_ARGS,
  };

  if (settings.useChromeChannel) {
    options.channel = "chrome";
  } else if (settings.browserMode !== "fixed") {
    options.userAgent = profile.userAgent;
    options.viewport = { width: 1366, height: 768 };
  }

  return options;
}
