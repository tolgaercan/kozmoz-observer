import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface LoadEnvOverlayOptions {
  /** true = mevcut process.env değerlerinin üzerine yazar */
  override?: boolean;
}

/**
 * Ek .env dosyası yükler (demo kayıt profili vb.).
 */
export function loadEnvOverlay(
  envPath: string,
  options: LoadEnvOverlayOptions = {},
): boolean {
  const absolutePath = resolve(envPath);
  if (!existsSync(absolutePath)) {
    return false;
  }

  const override = options.override ?? true;
  const content = readFileSync(absolutePath, "utf-8");

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
    if (!key) {
      continue;
    }

    if (override || !(key in process.env)) {
      process.env[key] = value;
    }
  }

  return true;
}
