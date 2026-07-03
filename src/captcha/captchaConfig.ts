import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { logger } from "../utils/logger.js";

export type CaptchaMode = "fixed-browser" | "extension-load";

export interface CaptchaConfig {
  mode: CaptchaMode;
  enabled: boolean;
  pollIntervalMs: number;
  maxChallengeWaitMs: number;
  continuousWatchIntervalMs: number;
  autoSaveCookies: boolean;
}

export interface CaptchaRuntimeState {
  lastChallengeDetectedAt?: string;
  lastChallengeResolvedAt?: string;
  lastCookieSaveAt?: string;
  totalChallengesResolved: number;
}

const DEFAULT_CONFIG: CaptchaConfig = {
  mode: "fixed-browser",
  enabled: true,
  pollIntervalMs: 4000,
  maxChallengeWaitMs: 180_000,
  continuousWatchIntervalMs: 8000,
  autoSaveCookies: true,
};

function configDir(projectRoot: string): string {
  return resolve(projectRoot, "data/config");
}

function configPath(projectRoot: string): string {
  return resolve(configDir(projectRoot), "captcha.json");
}

function runtimePath(projectRoot: string): string {
  return resolve(configDir(projectRoot), "captcha.runtime.json");
}

export function loadCaptchaConfig(projectRoot: string): CaptchaConfig {
  const path = configPath(projectRoot);
  let fileConfig: Partial<CaptchaConfig> = {};

  if (existsSync(path)) {
    try {
      fileConfig = JSON.parse(readFileSync(path, "utf-8")) as Partial<CaptchaConfig>;
    } catch (error) {
      logger.warn(
        `captcha.json okunamadı: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const mode =
    (process.env.CAPTCHA_MODE as CaptchaMode | undefined) ??
    fileConfig.mode ??
    DEFAULT_CONFIG.mode;

  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    mode,
    enabled: process.env.CAPTCHA_ENABLED !== "false" && (fileConfig.enabled ?? DEFAULT_CONFIG.enabled),
  };
}

export function saveCaptchaConfig(projectRoot: string, config: CaptchaConfig): void {
  mkdirSync(configDir(projectRoot), { recursive: true });
  writeFileSync(configPath(projectRoot), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export function loadCaptchaRuntime(projectRoot: string): CaptchaRuntimeState {
  const path = runtimePath(projectRoot);
  if (!existsSync(path)) {
    return { totalChallengesResolved: 0 };
  }

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CaptchaRuntimeState;
  } catch {
    return { totalChallengesResolved: 0 };
  }
}

export function saveCaptchaRuntime(projectRoot: string, state: CaptchaRuntimeState): void {
  mkdirSync(configDir(projectRoot), { recursive: true });
  writeFileSync(runtimePath(projectRoot), `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

export function buildCaptchaSettingsFromEnv(projectRoot: string): CaptchaConfig {
  const config = loadCaptchaConfig(projectRoot);

  if (process.env.CAPTCHA_POLL_INTERVAL_MS) {
    config.pollIntervalMs = Number.parseInt(process.env.CAPTCHA_POLL_INTERVAL_MS, 10);
  }
  if (process.env.CAPTCHA_MAX_WAIT_MS) {
    config.maxChallengeWaitMs = Number.parseInt(process.env.CAPTCHA_MAX_WAIT_MS, 10);
  }
  if (process.env.CAPTCHA_WATCH_INTERVAL_MS) {
    config.continuousWatchIntervalMs = Number.parseInt(process.env.CAPTCHA_WATCH_INTERVAL_MS, 10);
  }

  if (process.env.BROWSER_MODE === "fixed") {
    config.mode = "fixed-browser";
  }

  saveCaptchaConfig(projectRoot, config);
  return config;
}
