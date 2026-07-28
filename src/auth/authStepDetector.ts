import type { Page } from "playwright";

export interface ManualAuthState {
  required: boolean;
  kind: "none" | "login" | "otp" | "login_and_otp";
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
];

const OTP_SELECTORS = [
  "input[name*='otp' i]",
  "input[name*='verification' i]",
  "input[name*='verify' i]",
  "input[name*='code' i]",
  "input[id*='otp' i]",
  "input[placeholder*='kod' i]",
  "input[placeholder*='OTP' i]",
  "input[autocomplete='one-time-code']",
];

const OTP_TEXT_PATTERNS = [
  /doğrulama\s*kodu/i,
  /onay\s*kodu/i,
  /sms\s*kod/i,
  /e-?posta.*kod/i,
  /\botp\b/i,
  /verification\s*code/i,
];

const EMAIL_SELECTORS = [
  "input[type='email']",
  "input[name='Email']",
  "input[name='email']",
  "input[name='Username']",
  "input[name='username']",
  "input[id*='email' i]",
];

/** Randevu formu açıksa login/OTP beklemeyi atla */
const AUTHENTICATED_URL_PATTERNS = [
  /\/appointmentForm\b/i,
  /\/registerForm\b/i,
  /\/dashboard\b/i,
];

export async function detectManualAuthStep(page: Page): Promise<ManualAuthState> {
  const reasons: string[] = [];
  const url = page.url();

  let hasPassword = false;
  for (const selector of LOGIN_SELECTORS) {
    try {
      const loc = page.locator(selector).first();
      if ((await loc.count()) > 0 && (await loc.isVisible())) {
        hasPassword = true;
        reasons.push(`password:${selector}`);
        break;
      }
    } catch {
      // yoksay
    }
  }

  let hasOtp = false;
  for (const selector of OTP_SELECTORS) {
    try {
      const loc = page.locator(selector).first();
      if ((await loc.count()) > 0 && (await loc.isVisible())) {
        hasOtp = true;
        reasons.push(`otp:${selector}`);
        break;
      }
    } catch {
      // yoksay
    }
  }

  if (!hasOtp) {
    try {
      const bodyText = await page.locator("body").innerText({ timeout: 3000 });
      for (const pattern of OTP_TEXT_PATTERNS) {
        if (pattern.test(bodyText)) {
          hasOtp = true;
          reasons.push(`otp-text:${pattern.source}`);
          break;
        }
      }
    } catch {
      // yoksay
    }
  }

  let hasLoginUrl = false;
  for (const pattern of LOGIN_URL_PATTERNS) {
    if (pattern.test(url)) {
      hasLoginUrl = true;
      reasons.push(`login-url:${pattern.source}`);
      break;
    }
  }

  const onAuthenticatedUrl = AUTHENTICATED_URL_PATTERNS.some((pattern) => pattern.test(url));
  const required = hasPassword || hasOtp || hasLoginUrl;

  // appointmentForm/registerForm acik olsa bile sifre/OTP formu gorunuyorsa bekle
  if (onAuthenticatedUrl && !required) {
    return { required: false, kind: "none", reasons: ["authenticated-url"] };
  }

  let kind: ManualAuthState["kind"] = "none";
  if (hasPassword && hasOtp) {
    kind = "login_and_otp";
  } else if (hasOtp) {
    kind = "otp";
  } else if (hasPassword || hasLoginUrl) {
    kind = "login";
  }

  return { required, kind, reasons };
}

export async function findVisibleEmailInput(page: Page): Promise<ReturnType<Page["locator"]> | null> {
  for (const selector of EMAIL_SELECTORS) {
    try {
      const loc = page.locator(selector).first();
      if ((await loc.count()) > 0 && (await loc.isVisible())) {
        return loc;
      }
    } catch {
      // sonraki
    }
  }
  return null;
}
