import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSettings } from "../config/settings.js";
import { ProfileManager } from "../profiles/profileManager.js";
import { ensureChromeProfileIdentity, seedChromeProfileDisplayName } from "./chromeProfileIdentity.js";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

function parseCliArgs(argv: string[]): {
  userDataDir?: string;
  name?: string;
  profileRef?: string;
} {
  const result: ReturnType<typeof parseCliArgs> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--user-data-dir") {
      result.userDataDir = argv[++i];
    } else if (arg === "--name") {
      result.name = argv[++i];
    } else if (arg === "--profile" || arg === "-p") {
      result.profileRef = argv[++i];
    }
  }

  return result;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const settings = loadSettings(PROJECT_ROOT);

  if (args.userDataDir && args.name) {
    seedChromeProfileDisplayName(resolve(args.userDataDir), args.name);
    logger.info(`[chrome-profil] Yazildi: ${args.name} -> ${args.userDataDir}`);
    return;
  }

  const profileManager = new ProfileManager(settings.projectRoot, settings.manifestPath);
  const profileRef = args.profileRef ?? settings.defaultProfileId;
  const profile = profileManager.resolveProfile(profileRef, settings);
  const result = ensureChromeProfileIdentity(profile);

  if (!result.ready) {
    process.exitCode = 1;
    logger.error("[chrome-profil] Profil adi ayarlanamadi.");
    return;
  }

  logger.info(`[chrome-profil] Hazir: ${result.displayName}`);
}

main().catch((error) => {
  logger.error("Chrome profil seed basarisiz.", error);
  process.exitCode = 1;
});
