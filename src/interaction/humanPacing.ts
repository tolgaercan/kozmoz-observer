import type { Page } from "playwright";

import { logger } from "../utils/logger.js";

function randomMs(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

/** Rastgele insan benzeri bekleme — bot hızından kaçınmak için */
export async function humanPause(
  page: Page | null | undefined,
  minMs = 1200,
  maxMs = 2800,
  label?: string,
): Promise<void> {
  if (!page) {
    return;
  }
  const ms = randomMs(minMs, maxMs);
  if (label) {
    logger.info(`[human] ${label} — ${ms}ms`);
  }
  await page.waitForTimeout(ms);
}
