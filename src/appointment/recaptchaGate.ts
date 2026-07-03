import type { Page } from "playwright";

import { logger } from "../utils/logger.js";

export interface RecaptchaState {
  present: boolean;
  solved: boolean;
  solvedAtMs: number;
  tokenLength: number;
  checkboxChecked: boolean;
  solvedVia: "token" | "checkbox" | "none";
}

let lastCaptchaSolvedAtMs = 0;

export function markRecaptchaSolved(atMs = Date.now()): void {
  lastCaptchaSolvedAtMs = atMs;
}

const TOKEN_FIELD_SELECTORS = [
  "#g-recaptcha-response",
  "textarea[name='g-recaptcha-response']",
  "textarea[id^='g-recaptcha-response']",
  "input[name='g-recaptcha-response']",
];

async function readTokenLengthFromDom(page: Page): Promise<number> {
  let maxLen = 0;

  for (const selector of TOKEN_FIELD_SELECTORS) {
    const fields = page.locator(selector);
    const count = await fields.count();
    for (let index = 0; index < count; index++) {
      const field = fields.nth(index);
      let value = "";
      try {
        value = await field.inputValue({ timeout: 1000 });
      } catch {
        try {
          value = await field.evaluate(
            "el => ('value' in el && el.value) ? String(el.value) : ''",
          );
        } catch {
          value = "";
        }
      }
      maxLen = Math.max(maxLen, value.trim().length);
    }
  }

  if (maxLen <= 20) {
    try {
      const fromApi = await page.evaluate(
        `(() => {
          try {
            const g = window.grecaptcha;
            if (!g || typeof g.getResponse !== "function") return 0;
            const widgets = document.querySelectorAll(".g-recaptcha, [data-sitekey]");
            let max = 0;
            for (let i = 0; i < widgets.length; i++) {
              const r = g.getResponse(i) || "";
              if (r.length > max) max = r.length;
            }
            const single = g.getResponse() || "";
            return Math.max(max, single.length);
          } catch {
            return 0;
          }
        })()`,
      );
      if (typeof fromApi === "number") {
        maxLen = Math.max(maxLen, fromApi);
      }
    } catch {
      // yoksay
    }
  }

  return maxLen;
}

async function isRecaptchaCheckboxChecked(page: Page): Promise<boolean> {
  return (await page.locator(".recaptcha-checkbox-checked").count()) > 0;
}

async function isRecaptchaPresent(page: Page): Promise<boolean> {
  if ((await page.locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]').count()) > 0) {
    return true;
  }
  if ((await page.locator(".g-recaptcha, [data-sitekey]").count()) > 0) {
    return true;
  }
  return false;
}

export async function detectRecaptchaState(page: Page): Promise<RecaptchaState> {
  const present = await isRecaptchaPresent(page);

  if (!present) {
    return {
      present: false,
      solved: true,
      solvedAtMs: lastCaptchaSolvedAtMs,
      tokenLength: 0,
      checkboxChecked: false,
      solvedVia: "none",
    };
  }

  const tokenLength = await readTokenLengthFromDom(page);
  const checkboxChecked = await isRecaptchaCheckboxChecked(page);
  const solvedByToken = tokenLength > 20;
  const solvedByCheckbox = checkboxChecked;
  const solved = solvedByToken || solvedByCheckbox;

  if (solved) {
    markRecaptchaSolved();
  }

  return {
    present,
    solved,
    solvedAtMs: lastCaptchaSolvedAtMs,
    tokenLength,
    checkboxChecked,
    solvedVia: solvedByToken ? "token" : solvedByCheckbox ? "checkbox" : "none",
  };
}

export async function waitForRecaptchaSolution(
  page: Page,
  maxWaitMs: number,
  pollIntervalMs = 2000,
): Promise<boolean> {
  const started = Date.now();
  let lastLogAt = 0;

  while (Date.now() - started < maxWaitMs) {
    const state = await detectRecaptchaState(page);
    if (!state.present || state.solved) {
      if (state.solved && state.present) {
        logger.info(
          `reCAPTCHA çözüldü (${state.solvedVia}, token=${state.tokenLength}, checkbox=${state.checkboxChecked}).`,
        );
      }
      return true;
    }

    const elapsed = Date.now() - started;
    if (elapsed - lastLogAt >= 15_000) {
      lastLogAt = elapsed;
      logger.info(
        `[captcha] hâlâ bekleniyor (${Math.round(elapsed / 1000)}s) — token=${state.tokenLength}, checkbox=${state.checkboxChecked}`,
      );
    }

    await page.waitForTimeout(pollIntervalMs);
  }

  const finalState = await detectRecaptchaState(page);
  if (finalState.solved) {
    logger.info(
      `reCAPTCHA çözüldü (${finalState.solvedVia}, token=${finalState.tokenLength}).`,
    );
    return true;
  }

  logger.warn(
    `reCAPTCHA ${Math.round(maxWaitMs / 1000)}s içinde çözülmedi (token=${finalState.tokenLength}, checkbox=${finalState.checkboxChecked}).`,
  );
  return false;
}
