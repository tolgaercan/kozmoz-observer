import { existsSync, mkdirSync, rmSync } from "node:fs";

import { logger } from "../utils/logger.js";

/** Izole Chrome user-data klasorunu sifirlar — her calistirmada temiz profil. */
export function resetChromeUserDataDir(userDataDir: string): void {
  if (existsSync(userDataDir)) {
    rmSync(userDataDir, { recursive: true, force: true });
    logger.info(`[chrome] Eski profil silindi: ${userDataDir}`);
  }
  mkdirSync(userDataDir, { recursive: true });
  logger.info(`[chrome] Temiz profil klasoru hazir: ${userDataDir}`);
}
