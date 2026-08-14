import { execSync } from "node:child_process";

import { logger } from "../utils/logger.js";

function isWindows(): boolean {
  return process.platform === "win32";
}

function isMac(): boolean {
  return process.platform === "darwin";
}

export function isChromeRunning(): boolean {
  try {
    if (isWindows()) {
      const output = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return output.toLowerCase().includes("chrome.exe");
    }

    if (isMac()) {
      execSync('pgrep -f "Google Chrome"', {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return true;
    }

    execSync("pgrep -f 'google-chrome|chromium'", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function closeChromeHint(): string {
  if (isWindows()) {
    return "Görev Yöneticisi → chrome.exe → Görevi sonlandır";
  }
  if (isMac()) {
    return 'Activity Monitor veya: killall "Google Chrome"';
  }
  return "pkill -f google-chrome";
}

export function assertChromeClosed(): void {
  if (isChromeRunning()) {
    throw new Error(
      "Chrome hâlâ çalışıyor. Observer başlamadan TÜM Chrome pencerelerini kapatın.\n" +
        `${closeChromeHint()}\n` +
        "Sonra tekrar: npm start",
    );
  }
}

export function warnIfChromeRunning(): void {
  if (isChromeRunning()) {
    logger.warn(
      "Chrome çalışıyor — profil kilidi ve 'Mevcut tarayıcı oturumunda açılıyor' hatasına yol açar.",
    );
  }
}
