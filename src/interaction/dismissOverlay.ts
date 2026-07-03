import type { Page } from "playwright";

import { logger } from "../utils/logger.js";
import { getPageViewport } from "./viewport.js";
import { humanClickBlankArea } from "./humanClick.js";
import type { HumanMouseOptions } from "./humanMouse.js";

function randomIn(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Açık dropdown / overlay kapat — Escape + boş tık yedekleri */
export async function dismissOpenOverlay(
  page: Page,
  options: HumanMouseOptions = {},
): Promise<void> {
  logger.info("Açık dropdown kapatılıyor (Escape + boş tık)...");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(randomIn(150, 320));

  try {
    await humanClickBlankArea(page, options);
    return;
  } catch (error) {
    logger.warn(
      `Boş tık birincil yöntem başarısız: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const viewport = await getPageViewport(page);
  const target = {
    x: randomIn(viewport.width * 0.55, viewport.width * 0.82),
    y: randomIn(viewport.height * 0.12, viewport.height * 0.28),
  };

  logger.info(
    `Boş alana doğrudan tıklama (yedek) — hedef: (${Math.round(target.x)}, ${Math.round(target.y)})`,
  );

  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(randomIn(80, 180));
  await page.mouse.down();
  await page.waitForTimeout(randomIn(40, 90));
  await page.mouse.up();
  await page.waitForTimeout(randomIn(150, 300));

  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}
