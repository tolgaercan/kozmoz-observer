import type { ResolvedProfile } from "../profiles/profileManager.js";
import {
  ensureChromeProfileIdentity,
  isUnnamedChromeProfile,
  readChromeProfileDisplayName,
  type ChromeProfileIdentityResult,
} from "./chromeProfileIdentity.js";
import { logger } from "../utils/logger.js";

export class ChromeProfileSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChromeProfileSetupError";
  }
}

/** Chrome kapali iken profil adini manifest'ten yazar (start-chrome-debug.ps1). */
export function seedChromeProfileFromManifest(profile: ResolvedProfile): ChromeProfileIdentityResult {
  return ensureChromeProfileIdentity(profile);
}

/**
 * Chrome acikken profil adini dogrular — yazmaz (Preferences kilitlenebilir).
 */
export function verifyChromeProfileIdentity(profile: ResolvedProfile): ChromeProfileIdentityResult {
  const displayName = profile.name?.trim() || profile.id;
  const userDataDir = profile.absoluteUserDataDir;
  const profileDirectory = profile.browser?.profileDirectory ?? "Default";
  const currentName = readChromeProfileDisplayName(userDataDir, profileDirectory);

  if (isUnnamedChromeProfile(currentName)) {
    throw new ChromeProfileSetupError(
      `Chrome profili hala isimsiz (${currentName ?? "bos"}). ` +
        "Chrome'u kapatip yeniden baslatin:\n" +
        "  npm run chrome:debug -- -Profile " +
        profile.id +
        "\n" +
        "Sonra tekrar:\n" +
        "  npm run observer -- --profile " +
        profile.id +
        " --phase chrome-profile",
    );
  }

  logger.info(`[chrome-profil] Dogrulandi: "${currentName}" (manifest: ${displayName})`);

  return {
    displayName: currentName ?? displayName,
    previousName: currentName,
    seeded: false,
    ready: true,
  };
}
