import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function chromeCandidates(): string[] {
  if (process.platform === "win32") {
    return [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      join(homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
}

function whichChrome(): string | null {
  try {
    const command =
      process.platform === "win32"
        ? "where chrome"
        : "sh -c 'command -v google-chrome || command -v google-chrome-stable || command -v chromium'";
    const output = execSync(command, { encoding: "utf-8" }).trim();
    const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first && existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

/** Windows / macOS / Linux Chrome yolu. CHROME_PATH veya CHROME_EXECUTABLE_PATH override. */
export function resolveChromeExecutable(): string | null {
  const fromEnv =
    process.env.CHROME_PATH?.trim() || process.env.CHROME_EXECUTABLE_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }

  for (const candidate of chromeCandidates()) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return whichChrome();
}

export function resolveSystemChromeUserDataDir(): string {
  if (process.env.FIXED_BROWSER_USER_DATA_DIR?.trim()) {
    return resolve(process.env.FIXED_BROWSER_USER_DATA_DIR.trim());
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Google", "Chrome");
  }
  if (process.platform === "linux") {
    return join(homedir(), ".config", "google-chrome");
  }
  if (process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data");
  }
  return join(homedir(), "AppData", "Local", "Google", "Chrome", "User Data");
}
