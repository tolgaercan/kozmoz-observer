import { spawn } from "node:child_process";
import { resolve } from "node:path";

/**
 * Cross-platform Chrome CDP launcher (scripts/start-chrome-debug.mjs).
 */
export function runChromeDebug(
  projectRoot: string,
  profileId: string,
  envExtra: Record<string, string> = {},
  extraArgs: string[] = [],
): Promise<void> {
  const script = resolve(projectRoot, "scripts/start-chrome-debug.mjs");

  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [script, "--profile", profileId, ...extraArgs],
      {
        cwd: projectRoot,
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
