import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { logger } from "../../utils/logger.js";

/**
 * Phase: chrome-fresh
 * Temiz Chrome profili açar (CHROME_FRESH_PROFILE=true + chrome:debug).
 */
export async function runChromeFreshPhase(
  projectRoot: string,
  profileId: string,
): Promise<{ ok: boolean; detail: string }> {
  const script = resolve(projectRoot, "scripts/start-chrome-debug.ps1");
  logger.info(`[scenario] chrome-fresh — profil=${profileId}`);

  await runPowerShell(script, ["-Profile", profileId], {
    CHROME_FRESH_PROFILE: "true",
    CHROME_START_MAXIMIZED: "true",
  });

  return {
    ok: true,
    detail: `Chrome temiz profil ile açıldı (${profileId})`,
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
