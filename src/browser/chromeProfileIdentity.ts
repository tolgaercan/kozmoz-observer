import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";

const UNNAMED_PROFILE_PATTERNS = [
  /^person\s*1$/i,
  /^kişi\s*1$/i,
  /^kisi\s*1$/i,
  /^your chrome$/i,
  /^chrome$/i,
  /^isimsiz$/i,
  /^unnamed$/i,
  /^$/,
];

export function isUnnamedChromeProfile(name: string | null | undefined): boolean {
  if (!name?.trim()) {
    return true;
  }
  return UNNAMED_PROFILE_PATTERNS.some((pattern) => pattern.test(name.trim()));
}

export function readChromeProfileDisplayName(
  userDataDir: string,
  profileDirectory = "Default",
): string | null {
  const prefsPath = join(userDataDir, profileDirectory, "Preferences");
  if (!existsSync(prefsPath)) {
    return null;
  }

  try {
    const prefs = JSON.parse(readFileSync(prefsPath, "utf-8")) as {
      profile?: { name?: string };
    };
    return prefs.profile?.name ?? null;
  } catch {
    return null;
  }
}

/** Daha once Google hesabi Chrome profiline baglandi mi? (tekrar giris atlanir) */
export function isChromeProfileLinkedToGoogle(
  userDataDir: string,
  profileDirectory = "Default",
): boolean {
  const prefsPath = join(userDataDir, profileDirectory, "Preferences");
  if (!existsSync(prefsPath)) {
    return false;
  }

  try {
    const prefs = JSON.parse(readFileSync(prefsPath, "utf-8")) as {
      account_info?: unknown[];
      sync?: { requested?: boolean };
    };
    if (Array.isArray(prefs.account_info) && prefs.account_info.length > 0) {
      return true;
    }
    return prefs.sync?.requested === true;
  } catch {
    return false;
  }
}

function patchLocalState(
  userDataDir: string,
  displayName: string,
  profileDirectory: string,
): void {
  const localStatePath = join(userDataDir, "Local State");
  let state: {
    profile?: {
      info_cache?: Record<string, Record<string, unknown>>;
      last_used?: string;
    };
  } = {};

  if (existsSync(localStatePath)) {
    try {
      state = JSON.parse(readFileSync(localStatePath, "utf-8")) as typeof state;
    } catch {
      state = {};
    }
  }

  state.profile ??= {};
  state.profile.info_cache ??= {};
  state.profile.info_cache[profileDirectory] ??= {};
  const entry = state.profile.info_cache[profileDirectory];
  entry.name = displayName;
  entry.user_name = displayName;
  entry.using_default_name = false;
  state.profile.last_used = profileDirectory;

  writeFileSync(localStatePath, JSON.stringify(state), "utf-8");
}

export function seedChromeProfileDisplayName(
  userDataDir: string,
  displayName: string,
  profileDirectory = "Default",
): void {
  const profileDir = join(userDataDir, profileDirectory);
  mkdirSync(profileDir, { recursive: true });

  const prefsPath = join(profileDir, "Preferences");
  let prefs: { profile?: Record<string, unknown> } = {};

  if (existsSync(prefsPath)) {
    try {
      prefs = JSON.parse(readFileSync(prefsPath, "utf-8")) as typeof prefs;
    } catch {
      prefs = {};
    }
  }

  prefs.profile ??= {};
  prefs.profile.name = displayName;
  prefs.profile.using_default_name = false;

  writeFileSync(prefsPath, JSON.stringify(prefs), "utf-8");
  patchLocalState(userDataDir, displayName, profileDirectory);
}

export interface ChromeProfileIdentityResult {
  displayName: string;
  previousName: string | null;
  seeded: boolean;
  ready: boolean;
}

/**
 * Chrome user-data profilinin isimsiz (Kisi 1 / Person 1) olmadigini garanti eder.
 * Chrome kapali iken calistirilmali — acikken degisiklik icin yeniden baslatma gerekir.
 */
export function ensureChromeProfileIdentity(
  profile: ResolvedProfile,
): ChromeProfileIdentityResult {
  const displayName = profile.name?.trim() || profile.id;
  const userDataDir = profile.absoluteUserDataDir;
  const profileDirectory = profile.browser?.profileDirectory ?? "Default";

  const previousName = readChromeProfileDisplayName(userDataDir, profileDirectory);
  let seeded = false;

  if (isUnnamedChromeProfile(previousName)) {
    logger.info(
      `[chrome-profil] Isimsiz Chrome profili algilandi (${previousName ?? "bos"}) — "${displayName}" yaziliyor...`,
    );
    seedChromeProfileDisplayName(userDataDir, displayName, profileDirectory);
    seeded = true;
  } else {
    logger.info(`[chrome-profil] Chrome profil adi: ${previousName}`);
  }

  const finalName = readChromeProfileDisplayName(userDataDir, profileDirectory) ?? displayName;
  const ready = !isUnnamedChromeProfile(finalName);

  if (seeded) {
    logger.warn(
      "[chrome-profil] Profil adi dosyaya yazildi. Chrome aciksa kapatip 'npm run chrome:debug' ile yeniden baslatin.",
    );
  }

  return {
    displayName: finalName,
    previousName,
    seeded,
    ready,
  };
}
