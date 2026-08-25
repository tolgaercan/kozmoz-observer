import { resolve } from "node:path";

import type { CaptchaConfig } from "./captchaConfig.js";
import {
  buildRektCaptchaLaunchArgs,
  isCaptchaExtensionAutoLoadEnabled,
  parseRektCaptchaSettingsFromEnv,
  resolveRektCaptchaExtensionDir,
  type RektCaptchaSettings,
} from "./rektCaptchaExtension.js";
import { logger } from "../utils/logger.js";

export interface ExtensionSetupResult {
  loaded: boolean;
  launchArgs: string[];
  extensionDir?: string;
  settings?: RektCaptchaSettings;
}

/**
 * Panel / chrome:debug Chrome başlatırken rektCaptcha eklentisini yükler.
 * Ayarlar CDP hazır olduktan sonra service worker üzerinden senkronize edilir.
 */
export function prepareExtensionLaunch(
  config: CaptchaConfig,
  projectRoot?: string,
): ExtensionSetupResult {
  const root = projectRoot ?? process.cwd();
  const autoLoad = isCaptchaExtensionAutoLoadEnabled();
  const settings = parseRektCaptchaSettingsFromEnv();

  if (!config.enabled || !autoLoad) {
    if (!autoLoad) {
      logger.info("[rektCaptcha] Otomatik yükleme kapalı (CAPTCHA_EXTENSION_AUTO_LOAD=false).");
    }
    return { loaded: false, launchArgs: [], settings };
  }

  const extensionDir = resolveRektCaptchaExtensionDir(root);
  if (!extensionDir) {
    logger.warn(
      "[rektCaptcha] Eklenti bulunamadı. Kurulum: npm run install:rektcaptcha " +
        `(veya ${resolve(root, "extensions/rektcaptcha")} içine unpacked kopyalayın).`,
    );
    return { loaded: false, launchArgs: [], settings };
  }

  logger.info(`[rektCaptcha] Chrome'a yüklenecek: ${extensionDir}`);
  logger.info(
    `[rektCaptcha] Hedef ayarlar — auto-open=${settings.recaptcha_auto_open}, ` +
      `auto-solve=${settings.recaptcha_auto_solve}, click=${settings.recaptcha_click_delay_time}ms, ` +
      `solve=${settings.recaptcha_solve_delay_time}ms`,
  );

  return {
    loaded: true,
    launchArgs: buildRektCaptchaLaunchArgs(extensionDir),
    extensionDir,
    settings,
  };
}
