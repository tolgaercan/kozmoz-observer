#!/usr/bin/env node
/**
 * Cross-platform Chrome CDP launcher (Windows / macOS / Linux).
 * npm run chrome:debug -- --profile profile-1
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launchChromeDebug } from "./lib/chrome.mjs";
import { loadEnvFile } from "./lib/env.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const result = {
    profileId: process.env.DEFAULT_PROFILE_ID?.trim() || "profile-1",
    fresh: process.env.CHROME_FRESH_PROFILE === "true",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--profile" || arg === "-p" || arg === "-Profile") {
      result.profileId = argv[++i] ?? result.profileId;
    } else if (arg === "--fresh") {
      result.fresh = true;
    }
  }

  return result;
}

loadEnvFile(PROJECT_ROOT);
const cli = parseArgs(process.argv.slice(2));

try {
  await launchChromeDebug({
    projectRoot: PROJECT_ROOT,
    profileId: cli.profileId,
    fresh: cli.fresh,
    skipIfCdpReady: !cli.fresh,
  });
} catch (error) {
  console.error(`[chrome:debug] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
