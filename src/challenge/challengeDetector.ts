import type { Page } from "playwright";

import { detectRecaptchaState } from "../appointment/recaptchaGate.js";
import { isKosmosPortalUrl } from "../portal/kosmosOrigin.js";

export interface ChallengeSignals {
  isChallenge: boolean;
  reasons: string[];
}

const CHALLENGE_URL_PATTERNS = [
  /cdn-cgi\/challenge-platform/i,
  /challenges\.cloudflare\.com/i,
  /\/challenge\//i,
];

const CHALLENGE_SELECTORS = [
  "iframe[src*='recaptcha']",
  "iframe[src*='challenges.cloudflare']",
  "iframe[title*='reCAPTCHA']",
  ".cf-turnstile",
  "#cf-challenge-running",
  "#challenge-running",
  ".cf-browser-verification",
  "#challenge-form",
  ".g-recaptcha",
  "[data-sitekey]",
];

const CHALLENGE_TEXT_PATTERNS = [
  /just a moment/i,
  /checking your browser/i,
  /verify you are human/i,
  /ben robot değilim/i,
  /attention required/i,
  /please wait/i,
  /cloudflare/i,
];

export async function detectChallenge(page: Page): Promise<ChallengeSignals> {
  const reasons: string[] = [];

  const url = page.url();
  for (const pattern of CHALLENGE_URL_PATTERNS) {
    if (pattern.test(url)) {
      reasons.push(`url:${pattern.source}`);
    }
  }

  for (const selector of CHALLENGE_SELECTORS) {
    try {
      const locator = page.locator(selector);
      const count = await locator.count();
      for (let index = 0; index < count; index++) {
        const item = locator.nth(index);
        let visible = false;
        try {
          visible = await item.isVisible();
        } catch {
          visible = false;
        }
        if (visible) {
          reasons.push(`selector:${selector}`);
          break;
        }
      }
    } catch {
      // sayfa geçişinde locator hata verebilir — yoksay
    }
  }

  try {
    const title = await page.title();
    for (const pattern of CHALLENGE_TEXT_PATTERNS) {
      if (pattern.test(title)) {
        reasons.push(`title:${title}`);
        break;
      }
    }

    const bodyText = await page.locator("body").innerText({ timeout: 3000 });
    for (const pattern of CHALLENGE_TEXT_PATTERNS) {
      if (pattern.test(bodyText)) {
        reasons.push(`body:${pattern.source}`);
        break;
      }
    }
  } catch {
    // body henüz hazır olmayabilir
  }

  const recaptchaReasons = reasons.filter(
    (reason) =>
      reason.includes("recaptcha") ||
      reason.includes("reCAPTCHA") ||
      reason.includes("sitekey") ||
      reason.includes("g-recaptcha"),
  );
  if (recaptchaReasons.length > 0) {
    const recaptcha = await detectRecaptchaState(page);
    if (recaptcha.solved) {
      const remaining = reasons.filter((reason) => !recaptchaReasons.includes(reason));
      return {
        isChallenge: remaining.length > 0,
        reasons: remaining,
      };
    }
  }

  return {
    isChallenge: reasons.length > 0,
    reasons,
  };
}

export async function isPageAccessible(page: Page, expectedOrigin: string): Promise<boolean> {
  const url = page.url();
  if (!url || url === "about:blank") {
    return false;
  }

  if (isKosmosPortalUrl(url)) {
    return true;
  }

  try {
    return url.startsWith(new URL(expectedOrigin).origin);
  } catch {
    return false;
  }
}
