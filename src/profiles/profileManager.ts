import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { AppSettings } from "../config/settings.js";
import type { SessionPaths } from "../session/sessionLoader.js";

export interface ProfileFormData {
  appointmentCity: string;
  applicationType: string;
  appointmentStyle: string;
  nationalityNumber: string;
}

export interface ProfileDefinition {
  id: string;
  name: string;
  userDataDir: string;
  cookiesFile: string;
  storageFile: string;
  userAgent: string;
  /** Bağlı test senaryosu / akış ID (örn. kosmos-bireysel-standart) */
  flowId?: string;
  /** Form fixture — düz alanlar yerine tercih edilir */
  form?: Partial<ProfileFormData>;
  /** @deprecated form.appointmentCity kullanın */
  appointmentCity?: string;
  /** @deprecated form.applicationType kullanın */
  applicationType?: string;
  /** @deprecated form.appointmentStyle kullanın */
  appointmentStyle?: string;
  /** @deprecated form.nationalityNumber veya .env kullanın */
  nationalityNumber?: string;
}

interface ProfileManifest {
  profiles: ProfileDefinition[];
}

export interface ResolvedProfile extends ProfileDefinition {
  absoluteUserDataDir: string;
  absoluteCookiesFile: string;
  absoluteStorageFile: string;
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
    return [...this.profiles];
  }

  resolveProfile(profileRef?: string, settings?: AppSettings): ResolvedProfile {
    const profile = this.findProfile(profileRef);

    const isFixedBrowser = settings?.browserMode === "fixed" && settings.fixedBrowser !== null;

    const absoluteUserDataDir = isFixedBrowser
      ? settings.fixedBrowser!.profilePath
      : resolve(this.projectRoot, profile.userDataDir);

    if (isFixedBrowser && !existsSync(absoluteUserDataDir)) {
      throw new Error(
        `Sabit Chrome profili bulunamadı: ${absoluteUserDataDir} — FIXED_BROWSER_USER_DATA_DIR ve CHROME_PROFILE_DIRECTORY değerlerini kontrol edin.`,
      );
    }

    if (!isFixedBrowser) {
      mkdirSync(absoluteUserDataDir, { recursive: true });
    }

    const absoluteCookiesFile = resolve(this.projectRoot, profile.cookiesFile);
    const absoluteStorageFile = resolve(this.projectRoot, profile.storageFile);

    return {
      ...profile,
      absoluteUserDataDir,
      absoluteCookiesFile,
      absoluteStorageFile,
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

      if (!Array.isArray(manifest.profiles) || manifest.profiles.length === 0) {
        throw new Error("Manifest içinde en az bir profil tanımlı olmalı.");
      }

      return manifest.profiles;
    } catch (error) {
      throw new Error(
        `Profil manifest okunamadı: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private findProfile(profileRef?: string): ProfileDefinition {
    if (!profileRef) {
      throw new Error(
        "Profil belirtilmedi. --profile <id|index> parametresi kullanın veya DEFAULT_PROFILE_ID ayarlayın.",
      );
    }

    const byId = this.profiles.find((profile) => profile.id === profileRef);
    if (byId) {
      return byId;
    }

    const index = Number.parseInt(profileRef, 10);
    if (!Number.isNaN(index) && index >= 0 && index < this.profiles.length) {
      return this.profiles[index];
    }

    const available = this.profiles
      .map((profile, i) => `${i}: ${profile.id} (${profile.name})`)
      .join(", ");

    throw new Error(
      `Profil bulunamadı: "${profileRef}". Mevcut profiller: ${available}`,
    );
  }
}
