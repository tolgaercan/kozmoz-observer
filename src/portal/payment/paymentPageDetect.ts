import type { Frame, Locator, Page } from "playwright";

import { logger } from "../../utils/logger.js";
import {
  PAYMENT_FORM_SELECTORS,
  PAYMENT_PAGE_MARKERS,
  PAYMENT_SUBMIT_SELECTORS,
} from "./paymentFormSelectors.js";

export type PaymentSearchRoot = Page | Frame;

export function getPaymentSearchRoots(page: Page): PaymentSearchRoot[] {
  const roots: PaymentSearchRoot[] = [page];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) {
      continue;
    }
    roots.push(frame);
  }
  return roots;
}

export async function scrollPaymentFormIntoView(page: Page): Promise<void> {
  for (const root of getPaymentSearchRoots(page)) {
    const scrolled = await root
      .evaluate((selectors) => {
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            element.scrollIntoView({ block: "center", inline: "nearest" });
            return true;
          }
        }
        return false;
      }, [PAYMENT_FORM_SELECTORS.cardNumber, PAYMENT_FORM_SELECTORS.submitButton])
      .catch(() => false);
    if (scrolled) {
      return;
    }
  }
}

/** «Ödeme sayfasına yönlendiriliyorsunuz» overlay kaybolana kadar bekle */
export async function waitForPaymentLoadingDismissed(
  page: Page,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let blocking = false;

    for (const root of getPaymentSearchRoots(page)) {
      const overlay = root.locator(PAYMENT_FORM_SELECTORS.loadingOverlay).first();
      try {
        if (!(await overlay.count())) {
          continue;
        }
        if (!(await overlay.isVisible({ timeout: 150 }))) {
          continue;
        }
        const ariaHidden = (await overlay.getAttribute("aria-hidden")) ?? "true";
        if (ariaHidden !== "true") {
          blocking = true;
          break;
        }
      } catch {
        // overlay yok — devam
      }
    }

    if (!blocking) {
      return;
    }

    await page.waitForTimeout(350);
  }

  logger.warn("[payment] Loading overlay zaman aşımı — form yine de denenecek.");
}

export async function resolvePaymentSubmitButton(
  root: PaymentSearchRoot,
): Promise<Locator | null> {
  for (const selector of PAYMENT_SUBMIT_SELECTORS) {
    const button = root.locator(selector).first();
    try {
      if (await button.isVisible({ timeout: 350 })) {
        return button;
      }
    } catch {
      // sonraki selector
    }
  }
  return null;
}

async function isMarkerVisibleInRoot(
  root: PaymentSearchRoot,
  selector: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    return await root.locator(selector).first().isVisible({ timeout: timeoutMs });
  } catch {
    return false;
  }
}

/** Ödeme formu hangi frame/sekmede — doldurma burada yapılır. */
export async function resolvePaymentFormRoot(page: Page): Promise<PaymentSearchRoot | null> {
  for (const root of getPaymentSearchRoots(page)) {
    if (await isMarkerVisibleInRoot(root, PAYMENT_FORM_SELECTORS.cardNumber, 400)) {
      return root;
    }
    if (await isMarkerVisibleInRoot(root, PAYMENT_FORM_SELECTORS.submitButton, 400)) {
      return root;
    }
  }
  return null;
}

export async function isPaymentPageVisible(page: Page, timeoutMs = 800): Promise<boolean> {
  const perMarker = Math.max(150, Math.floor(timeoutMs / Math.max(PAYMENT_PAGE_MARKERS.length, 1)));

  for (const root of getPaymentSearchRoots(page)) {
    for (const selector of PAYMENT_PAGE_MARKERS) {
      if (await isMarkerVisibleInRoot(root, selector, perMarker)) {
        return true;
      }
    }
  }
  return false;
}

async function logPaymentProbeFailure(page: Page): Promise<void> {
  const hits: string[] = [];
  const misses: string[] = [];

  for (const root of getPaymentSearchRoots(page)) {
    const label =
      root === page
        ? "main"
        : `frame:${root.url().slice(0, 80) || "about:blank"}`;

    for (const selector of PAYMENT_PAGE_MARKERS) {
      const visible = await isMarkerVisibleInRoot(root, selector, 250);
      const entry = `${label} ${selector}`;
      if (visible) {
        hits.push(entry);
      } else {
        misses.push(entry);
      }
    }
  }

  logger.warn(
    `[payment] Odeme sayfasi bulunamadi — url=${page.url()} | gorunur=${hits.length ? hits.join("; ") : "yok"}`,
  );
  if (misses.length > 0 && misses.length <= 12) {
    logger.debug(`[payment] Odeme probe (ornek): ${misses.slice(0, 6).join("; ")}`);
  }
}

export async function waitForPaymentPage(page: Page, timeoutMs = 45_000): Promise<boolean> {
  const started = Date.now();
  let lastLogAt = 0;

  while (Date.now() - started < timeoutMs) {
    await waitForPaymentLoadingDismissed(page, 1500).catch(() => {});
    await scrollPaymentFormIntoView(page).catch(() => {});

    if (await isPaymentPageVisible(page, 700)) {
      const root = await resolvePaymentFormRoot(page);
      logger.info(
        `[payment] Odeme sayfasi hazir — ${root === page ? "main" : "iframe"} | ${page.url()}`,
      );
      return true;
    }

    const elapsed = Date.now() - started;
    if (elapsed - lastLogAt >= 5000) {
      lastLogAt = elapsed;
      logger.info(
        `[payment] Odeme sayfasi bekleniyor (${Math.round(elapsed / 1000)}s) — ${page.url()}`,
      );
    }

    await page.waitForTimeout(450);
  }

  await logPaymentProbeFailure(page);
  return false;
}
