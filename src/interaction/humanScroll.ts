import type { Locator, Page } from "playwright";

import { logger } from "../utils/logger.js";
import { getPageViewport } from "./viewport.js";
import { resetMousePosition } from "./humanMouse.js";

export interface HumanScrollOptions {
  timeoutMs?: number;
  maxSteps?: number;
  minWheelDelta?: number;
  maxWheelDelta?: number;
  pauseAfterMs?: number;
  /** Hedefi dikeyde ekran ortasına hizala */
  centerVertically?: boolean;
}

function randomIn(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function parkMouseOnPage(page: Page): Promise<void> {
  const viewport = await getPageViewport(page);

  const point = {
    x: randomIn(viewport.width * 0.35, viewport.width * 0.72),
    y: randomIn(viewport.height * 0.25, viewport.height * 0.55),
  };
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(randomIn(80, 200));
}

async function isComfortablyInViewport(
  page: Page,
  locator: Locator,
  centerVertically = false,
): Promise<boolean> {
  const box = await locator.boundingBox();
  const viewport = await getPageViewport(page);
  if (!box) {
    return false;
  }

  if (centerVertically) {
    const elementCenterY = box.y + box.height / 2;
    const targetCenterY = viewport.height * 0.45;
    return Math.abs(elementCenterY - targetCenterY) <= 45;
  }

  const topMargin = viewport.height * 0.2;
  const bottomMargin = viewport.height * 0.75;
  return box.y >= topMargin && box.y + box.height <= bottomMargin;
}

async function getPageScrollY(page: Page): Promise<number> {
  return page.evaluate(() => window.scrollY);
}

async function applyScrollStep(page: Page, deltaY: number): Promise<void> {
  const beforeY = await getPageScrollY(page);
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(randomIn(40, 90));
  const afterWheelY = await getPageScrollY(page);

  if (Math.abs(afterWheelY - beforeY) < 2) {
    await page.evaluate((step) => {
      window.scrollBy({ top: step, behavior: "auto" });
    }, deltaY);
  }
}

async function getScrollDirection(
  page: Page,
  locator: Locator,
  fallbackDelta: number,
  centerVertically = false,
): Promise<number> {
  const box = await locator.boundingBox();
  const viewport = await getPageViewport(page);
  if (!box) {
    return Math.abs(fallbackDelta);
  }

  const targetCenterY = box.y + box.height / 2;
  const viewportCenterY = centerVertically ? viewport.height * 0.45 : viewport.height * 0.4;

  if (targetCenterY > viewportCenterY + 35) {
    return Math.abs(fallbackDelta);
  }
  if (targetCenterY < viewportCenterY - 35) {
    return -Math.abs(fallbackDelta);
  }

  return 0;
}

export async function humanScrollToLocator(
  page: Page,
  locator: Locator,
  label: string,
  options: HumanScrollOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxSteps = options.maxSteps ?? 55;
  const minWheelDelta = options.minWheelDelta ?? 55;
  const maxWheelDelta = options.maxWheelDelta ?? 175;
  const centerVertically = options.centerVertically ?? false;
  const started = Date.now();

  await locator.first().waitFor({ state: "attached", timeout: timeoutMs });

  logger.info(`İnsan benzeri scroll başlıyor: ${label}`);
  resetMousePosition();
  await parkMouseOnPage(page);

  for (let step = 0; step < maxSteps; step++) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Scroll zaman aşımı (${label})`);
    }

    if (await isComfortablyInViewport(page, locator, centerVertically)) {
      logger.info(
        `Scroll tamam (${step} tekerlek adımı${centerVertically ? ", ortalandı" : ""}): ${label}`,
      );
      await page.waitForTimeout(options.pauseAfterMs ?? randomIn(350, 800));
      return;
    }

    const baseDelta = randomIn(minWheelDelta, maxWheelDelta);
    const direction = await getScrollDirection(page, locator, baseDelta, centerVertically);
    const deltaY =
      direction === 0
        ? baseDelta * (Math.random() > 0.2 ? 1 : -0.4)
        : direction;

    if (step > 0 && step % 4 === 0) {
      const viewport = await getPageViewport(page);
      await page.mouse.move(
          randomIn(viewport.width * 0.3, viewport.width * 0.75),
          randomIn(viewport.height * 0.3, viewport.height * 0.65),
        );
    }

    await applyScrollStep(page, deltaY);
    await page.waitForTimeout(randomIn(55, 160));

    if (Math.random() < 0.14) {
      await page.waitForTimeout(randomIn(220, 520));
    }

    if (step > 0 && step % 8 === 0) {
      logger.info(`Scroll devam (${step} adım): ${label}`);
    }
  }

  logger.warn(`Scroll adım limiti doldu — scrollIntoViewIfNeeded fallback: ${label}`);
  await locator.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(options.pauseAfterMs ?? randomIn(350, 800));
}

export async function humanScrollToSelector(
  page: Page,
  selector: string,
  label: string,
  options: HumanScrollOptions = {},
): Promise<void> {
  await humanScrollToLocator(page, page.locator(selector).first(), label, options);
}
