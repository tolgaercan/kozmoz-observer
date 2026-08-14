import { runChromeDebug } from "../../browser/chromeDebugProcess.js";
import { logger } from "../../utils/logger.js";

/**
 * Phase: chrome-fresh
 * Temiz Chrome profili açar (CHROME_FRESH_PROFILE=true + chrome:debug).
 */
export async function runChromeFreshPhase(
  projectRoot: string,
  profileId: string,
): Promise<{ ok: boolean; detail: string }> {
  logger.info(`[scenario] chrome-fresh — profil=${profileId}`);

  await runChromeDebug(
    projectRoot,
    profileId,
    {
      CHROME_FRESH_PROFILE: "true",
      CHROME_START_MAXIMIZED: "true",
    },
    ["--fresh"],
  );

  return {
    ok: true,
    detail: `Chrome temiz profil ile açıldı (${profileId})`,
  };
}
