import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface PanelChromeProfile {
  id: string;
  name: string;
  chromeEmail: string;
  chromePassword: string;
  userDataDir: string;
  /** Boş = Chrome Aç sırasında otomatik port */
  preferredCdpPort?: number | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ChromeProfileFile {
  profiles: PanelChromeProfile[];
  defaultProfileId?: string;
}

function defaultUserDataDir(profileId: string): string {
  return `data/chrome/${profileId}`;
}

function slugifyId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base ? `profile-${base}` : `profile-${Date.now()}`;
}

export class ChromeProfileStore {
  private readonly storePath: string;

  constructor(projectRoot: string) {
    this.storePath = resolve(projectRoot, "data/control-panel/chrome-profiles.json");
    mkdirSync(dirname(this.storePath), { recursive: true });
  }

  private load(): ChromeProfileFile {
    if (!existsSync(this.storePath)) {
      return { profiles: [] };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.storePath, "utf-8")) as ChromeProfileFile;
      return {
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
        defaultProfileId: parsed.defaultProfileId,
      };
    } catch {
      return { profiles: [] };
    }
  }

  private save(store: ChromeProfileFile): void {
    writeFileSync(this.storePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  }

  list(): PanelChromeProfile[] {
    return this.load().profiles.filter((p) => p.enabled !== false);
  }

  listAll(): PanelChromeProfile[] {
    return this.load().profiles;
  }

  get(profileId: string): PanelChromeProfile | undefined {
    return this.load().profiles.find((p) => p.id === profileId);
  }

  getOrThrow(profileId: string): PanelChromeProfile {
    const profile = this.get(profileId);
    if (!profile) {
      throw new Error(`Chrome profili bulunamadı: ${profileId}`);
    }
    return profile;
  }

  create(input: {
    name: string;
    chromeEmail: string;
    chromePassword: string;
    id?: string;
    preferredCdpPort?: number | null;
  }): PanelChromeProfile {
    const store = this.load();
    const id = input.id?.trim() || slugifyId(input.name);
    if (store.profiles.some((p) => p.id === id)) {
      throw new Error(`Profil id zaten var: ${id}`);
    }

    const now = new Date().toISOString();
    const profile: PanelChromeProfile = {
      id,
      name: input.name.trim(),
      chromeEmail: input.chromeEmail.trim(),
      chromePassword: input.chromePassword,
      userDataDir: defaultUserDataDir(id),
      preferredCdpPort: input.preferredCdpPort ?? null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    store.profiles.push(profile);
    store.defaultProfileId = store.defaultProfileId ?? id;
    this.save(store);
    return profile;
  }

  update(
    profileId: string,
    patch: Partial<
      Pick<
        PanelChromeProfile,
        "name" | "chromeEmail" | "chromePassword" | "preferredCdpPort" | "enabled"
      >
    >,
  ): { profile: PanelChromeProfile; passwordUpdated: boolean; emailUpdated: boolean } {
    const store = this.load();
    const index = store.profiles.findIndex((p) => p.id === profileId);
    if (index < 0) {
      throw new Error(`Chrome profili bulunamadı: ${profileId}`);
    }

    const existing = store.profiles[index]!;
    const { chromePassword, ...restPatch } = patch;
    const next: PanelChromeProfile = {
      ...existing,
      ...restPatch,
      id: existing.id,
      userDataDir: existing.userDataDir,
      updatedAt: new Date().toISOString(),
    };

    let passwordUpdated = false;
    if (chromePassword !== undefined) {
      const trimmed = chromePassword.trim();
      if (trimmed !== "" && trimmed !== existing.chromePassword) {
        next.chromePassword = trimmed;
        passwordUpdated = true;
      }
    }

    const emailUpdated =
      patch.chromeEmail !== undefined && patch.chromeEmail.trim() !== existing.chromeEmail;

    store.profiles[index] = next;
    this.save(store);
    return { profile: next, passwordUpdated, emailUpdated };
  }

  getStorePath(): string {
    return this.storePath;
  }

  delete(profileId: string): void {
    const store = this.load();
    const nextProfiles = store.profiles.filter((p) => p.id !== profileId);
    if (nextProfiles.length === store.profiles.length) {
      throw new Error(`Chrome profili bulunamadı: ${profileId}`);
    }
    if (nextProfiles.length === 0) {
      throw new Error("Son Chrome profili silinemez.");
    }
    store.profiles = nextProfiles;
    if (store.defaultProfileId === profileId) {
      store.defaultProfileId = nextProfiles[0]?.id;
    }
    this.save(store);
  }

  replaceAll(profiles: PanelChromeProfile[], defaultProfileId?: string): void {
    this.save({ profiles, defaultProfileId });
  }
}
