import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Proje kökündeki .env dosyasını process.env'e yükler.
 * Mevcut ortam değişkenlerinin üzerine yazmaz.
 */
export function loadEnvFile(projectRoot, envFileName = ".env") {
  const envPath = resolve(projectRoot, envFileName);
  if (!existsSync(envPath)) {
    return false;
  }

  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }

  return true;
}
