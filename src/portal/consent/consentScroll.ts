import type { Locator, Page } from "playwright";

import { logger } from "../../utils/logger.js";

/** Portal Step 4 — sözleşme metin kutusu (400px, overflow-y: scroll). */
export const CONSENT_SCROLL_CONTAINER_SELECTORS = [
  "div[style*='overflow-y: scroll']",
  "div[style*='overflow-y:scroll']",
  "div[style*='overflow-y: auto']",
  "div[style*='overflow-y:auto']",
];

function randomIn(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function scrollContainerTo(container: Locator, scrollTop: number): Promise<void> {
  await container.evaluate((element, top) => {
    const node = element as HTMLElement;
    node.scrollTop = top;
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, scrollTop);
}

export async function isCheckboxEnabled(checkbox: Locator): Promise<boolean> {
  try {
    return !(await checkbox.isDisabled());
  } catch {
    return false;
  }
}

/**
 * Scroll kutusunu bul — önce h2 başlığına göre, yoksa checkbox'ın hemen üstündeki overflow div.
 */
export async function resolveConsentScrollContainer(
  page: Page,
  options: { headingText?: string; checkbox?: Locator },
): Promise<Locator | null> {
  if (options.headingText?.trim()) {
    for (const baseSelector of CONSENT_SCROLL_CONTAINER_SELECTORS) {
      const byHeading = page
        .locator(baseSelector)
        .filter({ has: page.getByRole("heading", { name: options.headingText }) })
        .first();
      if ((await byHeading.count()) > 0) {
        return byHeading;
      }

      const byH2 = page
        .locator(baseSelector)
        .filter({ has: page.locator("h2", { hasText: options.headingText }) })
        .first();
      if ((await byH2.count()) > 0) {
        return byH2;
      }
    }
  }

  if (options.checkbox) {
    const preceding = resolveScrollContainerBeforeCheckbox(options.checkbox);
    if ((await preceding.count()) > 0) {
      return preceding.first();
    }
  }

  return null;
}

/**
 * Sözleşme metin kutusunu kaydır — checkbox aktif olana kadar.
 */
export async function scrollUntilCheckboxEnabled(
  page: Page,
  container: Locator,
  checkbox: Locator,
  options: { maxAttempts?: number; label?: string } = {},
): Promise<boolean> {
  const maxAttempts = options.maxAttempts ?? 45;
  const label = options.label ?? "onay kutusu";

  if (await isCheckboxEnabled(checkbox)) {
    logger.info(`[consent] ${label} zaten aktif — scroll atlandı.`);
    return true;
  }

  await container.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  await container.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  await container.hover({ timeout: 3000 }).catch(() => undefined);

  logger.info(`[consent] Metin kaydırılıyor — ${label}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await isCheckboxEnabled(checkbox)) {
      logger.info(`[consent] Scroll tamam (${attempt} adım) — ${label}`);
      return true;
    }

    const metrics = await container.evaluate((element) => {
      const node = element as HTMLElement;
      return {
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      };
    });

    const atBottom = metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - 4;
    const step = Math.max(90, Math.floor(metrics.clientHeight * 0.72));
    const nextTop = atBottom
      ? metrics.scrollHeight
      : Math.min(metrics.scrollTop + step, metrics.scrollHeight);

    await scrollContainerTo(container, nextTop);

    const box = await container.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55);
      await page.mouse.wheel(0, 120);
    }

    await page.waitForTimeout(randomIn(100, 220));

    if (attempt % 8 === 0) {
      logger.info(`[consent] Kaydırma devam — ${label} (adım ${attempt})`);
    }
  }

  await scrollContainerTo(container, Number.MAX_SAFE_INTEGER);
  await page.waitForTimeout(350);

  if (await isCheckboxEnabled(checkbox)) {
    logger.info(`[consent] Scroll tamam (son zorlama) — ${label}`);
    return true;
  }

  logger.warn(`[consent] Scroll sonrası checkbox hâlâ pasif — ${label}`);
  return false;
}

/** Checkbox'ın hemen üstündeki overflow-y metin kutusu. */
export function resolveScrollContainerBeforeCheckbox(checkbox: Locator): Locator {
  return checkbox.locator('xpath=preceding::div[contains(@style,"overflow-y")][1]');
}