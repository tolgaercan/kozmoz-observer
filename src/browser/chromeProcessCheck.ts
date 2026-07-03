import { execSync } from "node:child_process";

import { logger } from "../utils/logger.js";

export function isChromeRunning(): boolean {
  try {
    const output = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.toLowerCase().includes("chrome.exe");
  } catch {
    return false;
  }
}

export function assertChromeClosed(): void {
  if (isChromeRunning()) {
    throw new Error(
      "Chrome hâlâ çalışıyor. Observer başlamadan TÜM Chrome pencerelerini kapatın.\n" +
        "Görev Yöneticisi → chrome.exe → Görevi sonlandır\n" +
        "Sonra tekrar: npm run observer -- --profile profile-1 --pause",
    );
  }
}

export function warnIfChromeRunning(): void {
  if (isChromeRunning()) {
    logger.warn(
      "chrome.exe çalışıyor — profil kilidi ve 'Mevcut tarayıcı oturumunda açılıyor' hatasına yol açar.",
    );
  }
}
