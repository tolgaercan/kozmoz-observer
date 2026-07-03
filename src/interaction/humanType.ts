import type { Locator, Page } from "playwright";

import { logger } from "../utils/logger.js";
import { humanClickLocator, type HumanClickOptions } from "./humanClick.js";

function randomIn(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export interface HumanTypeOptions extends HumanClickOptions {
  minCharDelayMs?: number;
  maxCharDelayMs?: number;
  /** Her N karakterde kısa duraklama (örn. TC: 3+3+3+2) */
  groupPauseEveryChars?: number;
  groupPauseMinMs?: number;
  groupPauseMaxMs?: number;
  clearBeforeType?: boolean;
}

/** Input alanına odaklanıp karakter karakter insan benzeri yazım */
export async function humanTypeIntoLocator(
  page: Page,
  locator: Locator,
  text: string,
  options: HumanTypeOptions = {},
): Promise<void> {
  if (!text) {
    throw new Error("Yazılacak metin boş olamaz.");
  }

  const minCharDelayMs = options.minCharDelayMs ?? 90;
  const maxCharDelayMs = options.maxCharDelayMs ?? 190;
  const groupEvery = options.groupPauseEveryChars ?? 0;
  const label = options.label ?? "input";

  await locator.first().scrollIntoViewIfNeeded();
  await humanClickLocator(page, locator, { ...options, label });
  await page.waitForTimeout(randomIn(140, 320));

  if (options.clearBeforeType !== false) {
    await page.keyboard.press("Control+A");
    await page.waitForTimeout(randomIn(50, 120));
  }

  logger.info(`İnsan benzeri yazım başlıyor (${text.length} karakter): ${label}`);

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    await page.keyboard.press(char);
    await page.waitForTimeout(randomIn(minCharDelayMs, maxCharDelayMs));

    const typedCount = index + 1;
    if (groupEvery > 0 && typedCount % groupEvery === 0 && typedCount < text.length) {
      await page.waitForTimeout(
        randomIn(options.groupPauseMinMs ?? 200, options.groupPauseMaxMs ?? 480),
      );
    }
  }

  await page.waitForTimeout(randomIn(180, 420));
}
