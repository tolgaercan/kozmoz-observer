import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { AppSettings } from "../config/settings.js";
import type { SessionPaths } from "../session/sessionLoader.js";
import { resolveProfileBrowserPaths, shouldUseManifestBrowserProfile } from "./profileBrowserResolver.js";

export type ProfileMode = "observer" | "processor";

export type ProfileLifecycleState =
  | "ready"
  | "observing"
  | "booking"
  | "cooldown"
  | "banned";

export interface ProfileFormData {
  appointmentCity: string;
  /** Fiziksel başvuru ofisi — GetClosedDate dealerId (örn. Antalya, Ankara) */
  appointmentOffice?: string;
  applicationType: string;
  appointmentStyle: string;
  nationalityNumber: string;
  /** Pasaport no — Kimlik ve Telefon Doğrulama popup */
  passportNumber?: string;
  /** SMS OTP — başında 0 olmadan */
  phone?: string;
  /** Başvuru formu e-posta — OTP popup */
  registerEmail?: string;
}

export interface ProfileCredentialsRef {
  email?: string;
  password?: string;
}

export interface ProfileBrowserConfig {
  cdpPort?: number;
  userDataDir?: string;
  profileDirectory?: string;
  proxy?: string | null;
}

export interface ProfileSessionConfig {
  cookiesFile?: string;
  storageFile?: string;
  maxAgeHours?: number;
}

export interface ProfileLifecycleConfig {
  state?: ProfileLifecycleState;
  cooldownUntil?: string | null;
  lastBookingAt?: string | null;
}

export interface ProfileDefinition {
  id: string;
  name: string;
  enabled?: boolean;
  mode?: ProfileMode;
  flowId?: string;
  bootstrapFlowId?: string;
  userDataDir: string;
  cookiesFile: string;
  storageFile: string;
  userAgent: string;
  credentials?: ProfileCredentialsRef;
  form?: Partial<ProfileFormData>;
  browser?: ProfileBrowserConfig;
  session?: ProfileSessionConfig;
  lifecycle?: ProfileLifecycleConfig;
  /** @deprecated form.* kullanın */
  appointmentCity?: string;
  appointmentOffice?: string;
  applicationType?: string;
  appointmentStyle?: string;
  nationalityNumber?: string;
}

interface ProfileManifest {
  profiles: ProfileDefinition[];
}

export interface ResolvedProfile extends ProfileDefinition {
  absoluteUserDataDir: string;
  absoluteCookiesFile: string;
  absoluteStorageFile: string;
  cdpEndpoint: string;
}

function normalizeProfile(raw: ProfileDefinition): ProfileDefinition {
  const browserDir = raw.browser?.userDataDir ?? raw.userDataDir;
  const cookiesFile = raw.session?.cookiesFile ?? raw.cookiesFile;
  const storageFile = raw.session?.storageFile ?? raw.storageFile;

  return {
    ...raw,
    enabled: raw.enabled ?? true,
    mode: raw.mode ?? "observer",
    userDataDir: browserDir,
    cookiesFile,
    storageFile,
    browser: {
      cdpPort: raw.browser?.cdpPort ?? 9222,
      userDataDir: browserDir,
      profileDirectory: raw.browser?.profileDirectory ?? "Default",
      proxy: raw.browser?.proxy ?? null,
    },
    session: {
      cookiesFile,
      storageFile,
      maxAgeHours: raw.session?.maxAgeHours ?? 72,
    },
    lifecycle: {
      state: raw.lifecycle?.state ?? "ready",
      cooldownUntil: raw.lifecycle?.cooldownUntil ?? null,
      lastBookingAt: raw.lifecycle?.lastBookingAt ?? null,
    },
  };
}

export class ProfileManager {
  private readonly profiles: ProfileDefinition[];

  constructor(
    private readonly projectRoot: string,
    manifestPath: string,
  ) {
    this.profiles = this.loadManifest(manifestPath);
  }

  listProfiles(): ProfileDefinition[] {
    return this.profiles.filter((profile) => profile.enabled !== false);
  }

  listAllProfiles(): ProfileDefinition[] {
    return [...this.profiles];
  }

  reload(manifestPath: string): void {
    this.profiles.splice(0, this.profiles.length, ...this.loadManifest(manifestPath));
  }

  resolveProfile(profileRef?: string, settings?: AppSettings): ResolvedProfile {
    const profile = this.findProfile(profileRef);

    if (profile.enabled === false) {
      throw new Error(`Profil devre dışı: ${profile.id}`);
    }

    if (profile.lifecycle?.state === "cooldown" && profile.lifecycle.cooldownUntil) {
      const until = Date.parse(profile.lifecycle.cooldownUntil);
      if (!Number.isNaN(until) && until > Date.now()) {
        throw new Error(
          `Profil cooldown'da: ${profile.id} — ${profile.lifecycle.cooldownUntil} tarihine kadar bekleyin.`,
        );
      }
    }

    const browserPaths = resolveProfileBrowserPaths(this.projectRoot, profile, settings);
    const useManifest = shouldUseManifestBrowserProfile(settings);
    const isFixedBrowser = !useManifest && settings?.browserMode === "fixed" && settings.fixedBrowser !== null;

    const absoluteUserDataDir = browserPaths.absoluteUserDataDir;

    if (isFixedBrowser && !existsSync(absoluteUserDataDir)) {
      throw new Error(
        `Sabit Chrome profili bulunamadı: ${absoluteUserDataDir} — FIXED_BROWSER_USER_DATA_DIR ve CHROME_PROFILE_DIRECTORY değerlerini kontrol edin.`,
      );
    }

    if (!isFixedBrowser) {
      mkdirSync(absoluteUserDataDir, { recursive: true });
    }

    const absoluteCookiesFile = browserPaths.absoluteCookiesFile;
    const absoluteStorageFile = browserPaths.absoluteStorageFile;

    return {
      ...profile,
      absoluteUserDataDir,
      absoluteCookiesFile,
      absoluteStorageFile,
      cdpEndpoint: browserPaths.cdpEndpoint,
    };
  }

  toSessionPaths(profile: ResolvedProfile): SessionPaths {
    return {
      cookiesFile: profile.absoluteCookiesFile,
      storageFile: profile.absoluteStorageFile,
    };
  }

  private loadManifest(manifestPath: string): ProfileDefinition[] {
    if (!existsSync(manifestPath)) {
      throw new Error(`Profil manifest dosyası bulunamadı: ${manifestPath}`);
    }

    try {
      const raw = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as ProfileManifest;

      if (!Array.isArray(manifest.profiles)) {
        throw new Error("Manifest profiles alanı geçerli bir dizi olmalı.");
      }

      if (manifest.profiles.length === 0) {
        return [];
      }

      return manifest.profiles.map(normalizeProfile);
    } catch (error) {
      throw new Error(
        `Profil manifest okunamadı: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private findProfile(profileRef?: string): ProfileDefinition {
    if (!profileRef) {
      throw new Error(
        "Profil belirtilmedi. --profile <id|index> veya profile-queue.json activeProfileId kullanın.",
      );
    }

    const byId = this.profiles.find((profile) => profile.id === profileRef);
    if (byId) {
      return byId;
    }

    const index = Number.parseInt(profileRef, 10);
    if (!Number.isNaN(index) && index >= 0 && index < this.profiles.length) {
      return this.profiles[index]!;
    }

    const available = this.profiles
      .map((profile, i) => `${i}: ${profile.id} (${profile.name})`)
      .join(", ");

    throw new Error(
      `Profil bulunamadı: "${profileRef}". Mevcut profiller: ${available}`,
    );
  }
}
