import type { Page } from "playwright";

import { detectChallenge } from "./challengeDetector.js";
import { detectManualAuthStep } from "../auth/authStepDetector.js";

export type InterventionType = "none" | "challenge" | "login" | "blocked";

export interface InterventionSignals {
  type: InterventionType;
  reasons: string[];
}

const LOGIN_URL_PATTERNS = [
  /\/login\b/i,
  /\/signin\b/i,
  /\/giris\b/i,
  /\/auth\b/i,
  /\/identity\b/i,
  /\/account\/login/i,
  /\/Account\/Login/i,
];

const LOGIN_SELECTORS = [
  "input[type='password']",
  "input[name='Password']",
  "input[name='password']",
  "input[id*='password' i]",
  "button:has-text('Giriş')",
  "button:has-text('Giriş Yap')",
  "a:has-text('Giriş Yap')",
];

const LOGIN_TEXT_PATTERNS = [
  /giriş\s*yap/i,
  /oturum\s*aç/i,
  /kullanıcı\s*adı/i,
  /sign\s*in/i,
  /log\s*in/i,
];

/** Oturum açıkken görülen sayfalar — tek başına "TC kimlik" vb. login sayılmaz */
const AUTHENTICATED_URL_PATTERNS = [
  /\/appointmentForm\b/i,
  /\/registerForm\b/i,
  /\/dashboard\b/i,
  /\/randevu\b/i,
];

const APP_READY_SELECTORS = [
  "[class*='dashboard' i]",
  "[class*='appointment' i]",
  "[class*='randevu' i]",
  "nav",
  "header",
];

const BLOCKED_TEXT_PATTERNS = [
  /sorry, you have been blocked/i,
  /you are unable to access/i,
  /you have been blocked/i,
  /access denied/i,
  /erişim engellendi/i,
];

export async function detectLogin(page: Page): Promise<{ isLogin: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  const url = page.url();

  for (const pattern of LOGIN_URL_PATTERNS) {
    if (pattern.test(url)) {
      reasons.push(`url:${pattern.source}`);
    }
  }

  for (const selector of LOGIN_SELECTORS) {
    try {
      if ((await page.locator(selector).count()) > 0) {
        reasons.push(`selector:${selector}`);
      }
    } catch {
      // yoksay
    }
  }

  try {
    const bodyText = await page.locator("body").innerText({ timeout: 3000 });
    for (const pattern of LOGIN_TEXT_PATTERNS) {
      if (pattern.test(bodyText)) {
        reasons.push(`text:${pattern.source}`);
        break;
      }
    }
  } catch {
    // yoksay
  }

  const onAuthenticatedPage = AUTHENTICATED_URL_PATTERNS.some((p) => p.test(url));
  const hasPasswordField = reasons.some((r) => r.includes("password") || r.includes("Password"));
  const hasLoginUrl = reasons.some((r) => r.startsWith("url:"));
  const hasLoginUi = reasons.some(
    (r) => r.startsWith("selector:") && (r.includes("Giriş") || r.includes("password")),
  );

  // Metin eşleşmesi tek başına yeterli değil (randevu formunda da "giriş" benzeri metinler olabilir).
  const isLogin =
    reasons.length > 0 &&
    !onAuthenticatedPage &&
    (hasLoginUrl || hasPasswordField || hasLoginUi);

  return { isLogin, reasons };
}

export async function detectBlocked(page: Page): Promise<{ isBlocked: boolean; reasons: string[] }> {
  const reasons: string[] = [];

  try {
    const title = await page.title();
    const bodyText = await page.locator("body").innerText({ timeout: 3000 });
    const combined = `${title}\n${bodyText}`;

    for (const pattern of BLOCKED_TEXT_PATTERNS) {
      if (pattern.test(combined)) {
        reasons.push(`blocked:${pattern.source}`);
      }
    }
  } catch {
    // yoksay
  }

  return { isBlocked: reasons.length > 0, reasons };
}

export async function detectIntervention(page: Page): Promise<InterventionSignals> {
  const blocked = await detectBlocked(page);
  if (blocked.isBlocked) {
    return { type: "blocked", reasons: blocked.reasons };
  }

  const challenge = await detectChallenge(page);
  if (challenge.isChallenge) {
    return { type: "challenge", reasons: challenge.reasons };
  }

  const manualAuth = await detectManualAuthStep(page);
  if (manualAuth.required) {
    return {
      type: "login",
      reasons: [`manual-auth:${manualAuth.kind}`, ...manualAuth.reasons],
    };
  }

  return { type: "none", reasons: [] };
}

export async function isAppReady(page: Page, expectedOrigin: string): Promise<boolean> {
  const url = page.url();
  if (!url || url === "about:blank") {
    return false;
  }

  try {
    if (!url.startsWith(new URL(expectedOrigin).origin)) {
      return false;
    }
  } catch {
    return false;
  }

  const manualAuth = await detectManualAuthStep(page);
  if (manualAuth.required) {
    return false;
  }

  const intervention = await detectIntervention(page);
  if (intervention.type !== "none") {
    return false;
  }

  for (const selector of APP_READY_SELECTORS) {
    try {
      if ((await page.locator(selector).count()) > 0) {
        return true;
      }
    } catch {
      // yoksay
    }
  }

  return intervention.type === "none";
}
