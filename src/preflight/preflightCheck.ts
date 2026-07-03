import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadSettings } from "../config/settings.js";
import { getFlow, resolveFlowId } from "../flows/flowRegistry.js";
import { ProfileManager } from "../profiles/profileManager.js";
import {
  resolveProfileForm,
  validateProfileFormForFlow,
} from "../profiles/profileContext.js";
import { sanitizeCookies } from "../session/cookieSanitizer.js";
import { isChromeRunning } from "../browser/chromeProcessCheck.js";
import { isCdpEndpointReady } from "../browser/cdpConnector.js";
import { TelegramNotifier } from "../notifications/telegramNotifier.js";
import { logger } from "../utils/logger.js";

export interface PreflightReport {
  ready: boolean;
  errors: string[];
  warnings: string[];
}

export async function runPreflight(
  projectRoot: string,
  profileId?: string,
  flowRef?: string,
): Promise<PreflightReport> {
  const settings = loadSettings(projectRoot);
  const profileManager = new ProfileManager(projectRoot, settings.manifestPath);
  const errors: string[] = [];
  const warnings: string[] = [];

  const profileRef = profileId ?? settings.defaultProfileId;

  try {
    const profile = profileManager.resolveProfile(profileRef, settings);
    const paths = profileManager.toSessionPaths(profile);

    const flowId = resolveFlowId(flowRef, profile.flowId, settings.defaultFlowId);
    const flow = getFlow(flowId);
    const form = resolveProfileForm(profile, settings);
    const formErrors = validateProfileFormForFlow(
      form,
      flow.requiredProfileFields,
      flowId,
      profile.id,
    );
    for (const err of formErrors) {
      errors.push(err);
    }

    logger.info(`Preflight akış: ${flow.name} (${flowId})`);

    if (settings.browserConnectMethod === "cdp") {
      logger.info(`Mod: CDP bağlantı (${settings.cdpEndpoint})`);

      const cdpReady = await isCdpEndpointReady(settings.cdpEndpoint);
      if (!cdpReady) {
        errors.push(
          `CDP endpoint hazır değil: ${settings.cdpEndpoint}\n` +
            "  Önce: .\\scripts\\start-chrome-debug.ps1\n" +
            "  Sonra: npm run observer -- --profile profile-1 --pause",
        );
      }
    } else if (settings.browserMode === "fixed" && settings.fixedBrowser) {
      logger.info(`Mod: sabit Chrome profili (${settings.fixedBrowser.profileDirectory})`);
      logger.info(`Profil yolu: ${settings.fixedBrowser.profilePath}`);

      if (isChromeRunning()) {
        errors.push(
          "Chrome hâlâ çalışıyor — TÜM chrome.exe süreçlerini kapatın (Görev Yöneticisi).",
        );
      }

      if (!existsSync(settings.fixedBrowser.profilePath)) {
        errors.push(`Chrome profili bulunamadı: ${settings.fixedBrowser.profilePath}`);
      }
    }

    if (existsSync(paths.cookiesFile)) {
      const raw = JSON.parse(readFileSync(paths.cookiesFile, "utf-8")) as unknown[];
      const result = sanitizeCookies(raw, { includeOptional: true });

      if (result.missingCloudflare.length > 0) {
        warnings.push(`Eksik CF çerezleri: ${result.missingCloudflare.join(", ")}`);
      }
    } else if (settings.browserMode !== "fixed") {
      errors.push(`cookies.json bulunamadı: ${paths.cookiesFile}`);
    } else {
      warnings.push("cookies.json yok — sabit profildeki oturum kullanılacak.");
    }

    if (existsSync(paths.storageFile)) {
      const storage = JSON.parse(readFileSync(paths.storageFile, "utf-8")) as Record<string, string>;
      const hasJwt = Object.keys(storage).some(
        (key) => key.length > 10 && storage[key]?.startsWith("eyJ"),
      );
      if (!hasJwt) {
        warnings.push("storage.json içinde JWT token bulunamadı.");
      }
    } else if (settings.browserMode !== "fixed") {
      errors.push(`storage.json bulunamadı: ${paths.storageFile}`);
    } else {
      warnings.push("storage.json yok — sabit profildeki localStorage kullanılacak.");
    }

    if (settings.visaPortalHomeUrl.includes("example-visa-portal")) {
      errors.push(".env dosyasında gerçek VISA_PORTAL_HOME_URL tanımlı değil.");
    }

    if (!settings.useChromeChannel) {
      warnings.push("BROWSER_CHANNEL=chromium — sabit profil modunda chrome önerilir.");
    }

    if (settings.telegram.enabled) {
      if (!settings.telegram.botToken || !settings.telegram.chatId) {
        warnings.push("Telegram aktif ama TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.");
      } else {
        const telegram = new TelegramNotifier(settings.telegram);
        const sent = await telegram.sendStartupPing(profileRef);
        if (sent) {
          logger.info("Telegram bağlantı testi başarılı.");
        } else {
          warnings.push(
            "Telegram API'ye ulaşılamadı — observer yine de başlayacak. TELEGRAM_TLS_INSECURE=true deneyin.",
          );
        }
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return {
    ready: errors.length === 0,
    errors,
    warnings,
  };
}
