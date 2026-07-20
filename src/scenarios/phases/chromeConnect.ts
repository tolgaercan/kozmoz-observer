import { spawn } from "node:child_process";
import { resolve } from "node:path";

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

  const script = resolve(projectRoot, "scripts/start-chrome-debug.ps1");
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

  await runPowerShell(script, ["-Profile", profileId], envExtra);

  return {
    ok: true,
    detail: useSystemProfile
      ? `Sistem Chrome açıldı (${profileDirectory})`
      : `Chrome izole profil ile açıldı (${profileId})`,
  };
}

function runPowerShell(
  scriptPath: string,
  args: string[],
  envExtra: Record<string, string>,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "powershell",
      ["-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
      {
        env: { ...process.env, ...envExtra },
        stdio: "inherit",
        windowsHide: true,
      },
    );

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`chrome:debug çıkış kodu ${code}`));
    });
  });
}
