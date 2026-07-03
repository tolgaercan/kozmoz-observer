import type { Locator, Page } from "playwright";

import { logger } from "../utils/logger.js";
import { getPageViewport } from "./viewport.js";
import { moveMouseHumanLike, type HumanMouseOptions } from "./humanMouse.js";

export interface HumanClickOptions extends HumanMouseOptions {
  waitTimeoutMs?: number;
  settleDelayMs?: number;
  preClickDelayMs?: number;
  postClickDelayMs?: number;
  label?: string;
}

function randomIn(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickClickPoint(box: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
} {
  const marginX = Math.min(box.width * 0.2, 12);
  const marginY = Math.min(box.height * 0.25, 10);

  return {
    x: box.x + marginX + randomIn(0, box.width - marginX * 2),
    y: box.y + marginY + randomIn(0, box.height - marginY * 2),
  };
}

export async function waitForLocatorReady(
  locator: Locator,
  timeoutMs: number,
  label = "hedef",
): Promise<void> {
  const started = Date.now();
  const progressTimer = setInterval(() => {
    void (async () => {
      const elapsedSec = Math.round((Date.now() - started) / 1000);
      try {
        const count = await locator.count();
        const visible = count > 0 && (await locator.first().isVisible());
        logger.info(
          `Locator bekleniyor (${elapsedSec}s / max ${Math.round(timeoutMs / 1000)}s): ${label} — adet=${count}, görünür=${visible}`,
        );
      } catch {
        logger.info(
          `Locator bekleniyor (${elapsedSec}s / max ${Math.round(timeoutMs / 1000)}s): ${label}`,
        );
      }
    })();
  }, 5000);

  try {
    await locator.first().waitFor({ state: "visible", timeout: timeoutMs });
    await locator.first().scrollIntoViewIfNeeded();
    logger.info(`Locator bulundu (${Math.round((Date.now() - started) / 1000)}s): ${label}`);
  } finally {
    clearInterval(progressTimer);
  }
}

export async function humanClickLocator(
  page: Page,
  locator: Locator,
  options: HumanClickOptions = {},
): Promise<void> {
  const waitTimeoutMs = options.waitTimeoutMs ?? 60_000;
  const settleDelayMs = options.settleDelayMs ?? randomIn(350, 900);

  await waitForLocatorReady(locator, waitTimeoutMs, options.label ?? "hedef");
  await page.waitForTimeout(settleDelayMs);

  const box = await locator.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error("Tıklama hedefinin bounding box bilgisi alınamadı.");
  }

  const target = pickClickPoint(box);
  logger.info(
    `İnsan benzeri fare hareketi — hedef: (${Math.round(target.x)}, ${Math.round(target.y)})`,
  );

  await moveMouseHumanLike(page, target, options);
  await page.waitForTimeout(options.preClickDelayMs ?? randomIn(60, 200));
  await page.mouse.down();
  await page.waitForTimeout(randomIn(45, 110));
  await page.mouse.up();
  await page.waitForTimeout(options.postClickDelayMs ?? randomIn(120, 350));
}

export async function humanClickSelector(
  page: Page,
  selector: string,
  options: HumanClickOptions = {},
): Promise<void> {
  await humanClickLocator(page, page.locator(selector).first(), {
    ...options,
    label: options.label ?? selector,
  });
}

/** Form dışı boş alana insan benzeri tıklama (dropdown kapatma vb.) */
export async function humanClickBlankArea(
  page: Page,
  options: HumanMouseOptions = {},
): Promise<void> {
  const viewport = await getPageViewport(page);

  const target = {
    x: randomIn(viewport.width * 0.55, viewport.width * 0.82),
    y: randomIn(viewport.height * 0.12, viewport.height * 0.32),
  };

  logger.info(
    `Boş alana tıklama — hedef: (${Math.round(target.x)}, ${Math.round(target.y)})`,
  );

  await moveMouseHumanLike(page, target, options);
  await page.waitForTimeout(randomIn(80, 200));
  await page.mouse.down();
  await page.waitForTimeout(randomIn(40, 100));
  await page.mouse.up();
  await page.waitForTimeout(randomIn(150, 350));
}
