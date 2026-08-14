import { runChromeDebug } from "../../browser/chromeDebugProcess.js";
import { isCdpEndpointReady } from "../../browser/cdpConnector.js";
import { logger } from "../../utils/logger.js";
import type { ScenarioStepParams } from "../types.js";

/**
 * Phase: chrome-connect
 * Kayıtlı Chrome profili açar (fresh değil — oturum reuse).
 * useSystemProfile=true → kişisel Chrome User Data (JWT/cookies aynı kalır).
 * skipIfCdpReady=true → CDP zaten aciksa Chrome kill/restart yapilmaz (banSafe).
 */
export async function runChromeConnectPhase(
  projectRoot: string,
  profileId: string,
  params?: ScenarioStepParams,
): Promise<{ ok: boolean; detail: string }> {
  const skipIfCdpReady = params?.skipIfCdpReady === true;
  const cdpEndpoint =
    typeof params?.cdpEndpoint === "string" ? params.cdpEndpoint.trim() : "http://127.0.0.1:9222";

  if (skipIfCdpReady && (await isCdpEndpointReady(cdpEndpoint))) {
    logger.info(
      `[scenario] chrome-connect — CDP zaten acik (${cdpEndpoint}), Chrome kill atlandi (banSafe).`,
    );
    return {
      ok: true,
      detail: "CDP zaten hazir — mevcut Chrome korundu",
    };
  }

  const useSystemProfile = params?.useSystemProfile === true;
  const profileDirectory =
    typeof params?.chromeProfileDirectory === "string"
      ? params.chromeProfileDirectory.trim()
      : "Default";

  if (useSystemProfile) {
    logger.info(
      `[scenario] chrome-connect — SISTEM Chrome profili (${profileDirectory}) — kisisel oturum`,
    );
    logger.warn("[scenario] Normal Chrome pencerelerini kapatın, sonra devam edin.");
  } else {
    logger.info(`[scenario] chrome-connect — profil=${profileId} (izole oturum)`);
  }

  const envExtra: Record<string, string> = {
    CHROME_FRESH_PROFILE: "false",
    CHROME_START_MAXIMIZED: "true",
  };

  if (useSystemProfile) {
    envExtra.CHROME_USE_SYSTEM_PROFILE = "true";
    envExtra.CHROME_PROFILE_DIRECTORY = profileDirectory;
  }

  await runChromeDebug(projectRoot, profileId, envExtra);

  return {
    ok: true,
    detail: useSystemProfile
      ? `Sistem Chrome açıldı (${profileDirectory})`
      : `Chrome izole profil ile açıldı (${profileId})`,
  };
}
