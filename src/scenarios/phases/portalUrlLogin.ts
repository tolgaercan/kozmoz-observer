import { resolvePortalUrl } from "../../portal/portalUrlStore.js";
import { logPortalPageState } from "../../portal/portalPageState.js";
import { loadSession, applySessionStorageOnPage } from "../../session/sessionLoader.js";
import { hasJwtInStorage, readPortalLocalStorage } from "../../session/sessionPersister.js";
import { readStorageFile } from "../../session/sessionReader.js";
import { runPortalBootstrap } from "../../auth/portalBootstrapRunner.js";
import { resolveProfileCredentials } from "../../profiles/profileCredentials.js";
import { humanPause } from "../../interaction/humanPacing.js";
import { logger } from "../../utils/logger.js";
import type { ScenarioRuntime } from "../scenarioRuntime.js";
import type { ScenarioStepParams } from "../types.js";
import type { PortalUrlType } from "../../portal/portalUrlTypes.js";

export interface PortalUrlLoginPhaseResult {
  ok: boolean;
  detail: string;
}

function resolveEntryUrl(
  runtime: ScenarioRuntime,
  params?: ScenarioStepParams,
): { url: string; label: string } {
  const fromParams = typeof params?.entryUrl === "string" ? params.entryUrl.trim() : "";
  if (fromParams) {
    return { url: fromParams, label: "step.params.entryUrl" };
  }

  const urlId = typeof params?.portalUrlId === "string" ? params.portalUrlId.trim() : undefined;
  const urlType =
    typeof params?.portalUrlType === "string"
      ? (params.portalUrlType.trim() as PortalUrlType)
      : "register-form";

  if (params?.portalUrlRef !== false) {
    const resolved = resolvePortalUrl(runtime.projectRoot, {
      profileId: runtime.profileId,
      urlId,
      type: urlType,
      prefer: params?.preferTracking === true ? "tracking" : "portal",
    });
    return {
      url: resolved.gotoUrl,
      label: `${resolved.entry.id} (${resolved.source})`,
    };
  }

  const fromEnv = process.env.VISA_PORTAL_HOME_URL?.trim();
  return {
    url: fromEnv || runtime.settings.visaPortalHomeUrl,
    label: "VISA_PORTAL_HOME_URL",
  };
}

/**
 * Phase: portal-url-login
 * Davet URL açar. reuseChromeSession=true ise Chrome profilindeki JWT korunur (storage.json enjekte edilmez).
 */
export async function runPortalUrlLoginPhase(
  runtime: ScenarioRuntime,
  params?: ScenarioStepParams,
): Promise<PortalUrlLoginPhaseResult> {
  if (!runtime.session) {
    throw new Error("[scenario] portal-url-login — önce chrome-login çalışmalı (oturum yok).");
  }

  const { page, context } = runtime.session;
  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
  const credentials = resolveProfileCredentials(profile);
  const { url: entryUrl, label: urlSource } = resolveEntryUrl(runtime, params);
  const reuseChromeSession = params?.reuseChromeSession === true;

  const sessionPaths = runtime.profileManager.toSessionPaths(profile);

  if (reuseChromeSession) {
    logger.info(
      "[scenario] portal-url-login — reuseChromeSession: Chrome user-data oturumu kullanılacak (storage.json enjekte edilmez).",
    );
    await loadSession(context, page, sessionPaths, {
      skipCookies: true,
      skipStorage: true,
    });
  } else {
    await loadSession(context, page, sessionPaths, {
      skipCookies: false,
      skipStorage: false,
    });
    logger.info("[scenario] portal-url-login — cookies + storage.json enjekte edildi.");
  }

  logger.info(`[scenario] portal-url-login — kaynak=${urlSource}`);
  logger.info(`[scenario] portal-url-login — ${entryUrl}`);

  if (runtime.settings.preGotoDelayMs > 0) {
    await page.waitForTimeout(runtime.settings.preGotoDelayMs);
  }
  await humanPause(page, 1500, 3500, "URL acilmadan once");

  await page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });

  if (runtime.settings.navigation.waitAfterLoadMs > 0) {
    await page.waitForTimeout(runtime.settings.navigation.waitAfterLoadMs);
  }
  await humanPause(page, 2000, 4500, "URL yuklendi");
  await logPortalPageState(page, "portal-url-login sonrasi");

  if (!reuseChromeSession) {
    await applySessionStorageOnPage(page, sessionPaths);
  } else {
    const live = await readPortalLocalStorage(page);
    const hasJwt = hasJwtInStorage(live);
    logger.info(
      `[scenario] portal-url-login — Chrome localStorage JWT=${hasJwt ? "var" : "yok"} (${Object.keys(live).length} anahtar)`,
    );
    if (!hasJwt) {
      const fileStorage = readStorageFile(sessionPaths.storageFile);
      if (hasJwtInStorage(fileStorage)) {
        logger.warn(
          "[scenario] portal-url-login — Chrome'da JWT yok; storage.json'dan yedek enjekte ediliyor.",
        );
        await applySessionStorageOnPage(page, sessionPaths);
      } else {
        logger.warn(
          "[scenario] portal-url-login — JWT bulunamadı. Aynı Chrome'da kayıt tamamlayın veya storage.json güncelleyin.",
        );
      }
    }
  }

  const openOnly =
    params?.openOnly === true || runtime.runOptions.openUrlOnly === true;

  if (openOnly) {
    logger.info("[scenario] portal-url-login — openOnly: bootstrap/OTP atlandı, sayfa açık.");
    return {
      ok: true,
      detail: `URL açıldı (${urlSource})`,
    };
  }

  const bootstrap = await runPortalBootstrap(page, credentials);

  return {
    ok: true,
    detail: bootstrap.manualAuthRequired
      ? `Portal giriş/OTP tamamlandı (${urlSource})`
      : `Portal oturumu hazır (${urlSource})`,
  };
}
