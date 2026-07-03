import type { CaptchaConfig } from "./captchaConfig.js";
import { logger } from "../utils/logger.js";

export interface ExtensionSetupResult {
  loaded: boolean;
  launchArgs: string[];
}

/**
 * fixed-browser modunda eklenti Playwright tarafından yüklenmez —
 * kullanıcının sabit Chrome profilindeki kurulu eklentiler kullanılır.
 */
export function prepareExtensionLaunch(config: CaptchaConfig): ExtensionSetupResult {
  if (config.mode === "fixed-browser") {
    logger.info(
      "Captcha modu: fixed-browser — profildeki kurulu eklenti kullanılacak (API/ücretli servis gerekmez).",
    );
    return { loaded: false, launchArgs: [] };
  }

  logger.warn(
    "Captcha modu: extension-load — bu mod artık önerilmiyor. BROWSER_MODE=fixed kullanın.",
  );
  return { loaded: false, launchArgs: [] };
}
