import type { Locator, Page } from "playwright";

import { logger } from "../utils/logger.js";

export const KVKK_PROGRESS_SELECTOR = "progress#file";

const KVKK_SCROLL_CONTAINER_SELECTORS = [
  "progress#file ~ div[style*='overflow-y']",
  "div[style*='overflow-y: scroll']:has(h1:text('AYDINLATMA METNİ'))",
  "div[style*='overflow-y: scroll']",
];

const KVKK_PROGRESS_COMPLETE = 99.5;

function randomIn(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export async function readKvkkScrollProgress(page: Page): Promise<number> {
  const progress = page.locator(KVKK_PROGRESS_SELECTOR).first();
  if (!(await progress.count())) {
    return 0;
  }
  const value = Number((await progress.getAttribute("value")) ?? 0);
  const max = Number((await progress.getAttribute("max")) ?? 100);
  if (max <= 0 || max === 100) {
    return value;
  }
  return Math.round((value / max) * 100);
}

export async function areKvkkCheckboxesEnabled(page: Page): Promise<boolean> {
  const checkboxes = page.locator("input.form-check-input[type='checkbox']");
  const count = await checkboxes.count();
  if (count === 0) {
    return false;
  }
  for (let i = 0; i < count; i++) {
    const box = checkboxes.nth(i);
    if (await box.isDisabled().catch(() => true)) {
      return false;
    }
  }
  return true;
}

export async function isKvkkScrollComplete(page: Page): Promise<boolean> {
  const progress = await readKvkkScrollProgress(page);
  if (progress >= KVKK_PROGRESS_COMPLETE) {
    return true;
  }
  return areKvkkCheckboxesEnabled(page);
}

async function resolveKvkkScrollContainer(page: Page): Promise<Locator> {
  for (const selector of KVKK_SCROLL_CONTAINER_SELECTORS) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 1200 }).catch(() => false)) {
      return locator;
    }
  }
  throw new Error(
    `KVKK metin kutusu bulunamadı. Denenen: ${KVKK_SCROLL_CONTAINER_SELECTORS.join(" | ")}`,
  );
}

async function scrollContainerTo(page: Page, container: Locator, scrollTop: number): Promise<void> {
  await container.evaluate((element, top) => {
    const node = element as HTMLElement;
    node.scrollTop = top;
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, scrollTop);

  const box = await container.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55);
    await page.mouse.wheel(0, 120);
  }
}

/**
 * KVKK / sözleşme metnini en alta kaydırır — progress ~100 veya checkbox'lar aktif olana kadar.
 */
export async function ensureRegisterKvkkTextScrolled(
  page: Page,
  options: { maxAttempts?: number } = {},
): Promise<boolean> {
  const maxAttempts = options.maxAttempts ?? 45;

  if (await isKvkkScrollComplete(page)) {
    const progress = await readKvkkScrollProgress(page);
    logger.info(`[register][kvkk] Metin zaten okunabilir (progress=${progress}).`);
    return true;
  }

  const container = await resolveKvkkScrollContainer(page);
  await container.hover({ timeout: 5000 }).catch(() => {});

  let progress = await readKvkkScrollProgress(page);
  logger.info(`[register][kvkk] Metin kaydırılıyor — başlangıç progress=${progress}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await isKvkkScrollComplete(page)) {
      progress = await readKvkkScrollProgress(page);
      logger.info(`[register][kvkk] Scroll tamam (${attempt} adım) — progress=${progress}`);
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

    await scrollContainerTo(page, container, nextTop);
    await page.waitForTimeout(randomIn(100, 220));

    if (attempt % 6 === 0) {
      logger.info(`[register][kvkk] Kaydırma devam — progress=${await readKvkkScrollProgress(page)}`);
    }
  }

  await scrollContainerTo(page, container, Number.MAX_SAFE_INTEGER);
  await page.waitForTimeout(350);

  if (await isKvkkScrollComplete(page)) {
    progress = await readKvkkScrollProgress(page);
    logger.info(`[register][kvkk] Scroll tamam (son zorlama) — progress=${progress}`);
    return true;
  }

  progress = await readKvkkScrollProgress(page);
  logger.warn(`[register][kvkk] Scroll progress hedefe ulaşamadı — progress=${progress}`);
  return false;
}
