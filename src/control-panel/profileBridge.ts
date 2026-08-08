import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ProfileDefinition } from "../profiles/profileManager.js";
import { ChromeProfileStore, type PanelChromeProfile } from "./chromeProfileStore.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function minimalManifestEntry(profile: PanelChromeProfile, cdpPort: number): ProfileDefinition {
  return {
    id: profile.id,
    name: profile.name,
    enabled: profile.enabled !== false,
    mode: "observer",
    flowId: "kosmos-observe-v1",
    bootstrapFlowId: "kosmos-portal-bootstrap",
    userDataDir: profile.userDataDir,
    cookiesFile: `data/sessions/${profile.id}/cookies.json`,
    storageFile: `data/sessions/${profile.id}/storage.json`,
    userAgent: DEFAULT_USER_AGENT,
    credentials: {
      email: profile.chromeEmail,
      password: profile.chromePassword,
    },
    form: {
      appointmentCity: "Ankara",
      applicationType: "Bireysel",
      appointmentStyle: "Standart",
      nationalityNumber: "",
    },
    browser: {
      cdpPort,
      userDataDir: profile.userDataDir,
      profileDirectory: "Default",
      proxy: null,
    },
    session: {
      cookiesFile: `data/sessions/${profile.id}/cookies.json`,
      storageFile: `data/sessions/${profile.id}/storage.json`,
      maxAgeHours: 72,
    },
    lifecycle: {
      state: "ready",
      cooldownUntil: null,
      lastBookingAt: null,
    },
  };
}

export function syncManifestFromChromeProfiles(
  projectRoot: string,
  manifestPath: string,
  profiles: PanelChromeProfile[],
  cdpPortById: Record<string, number>,
): void {
  const entries = profiles.map((profile) =>
    minimalManifestEntry(profile, cdpPortById[profile.id] ?? profile.preferredCdpPort ?? 9222),
  );

  const manifest = { profiles: entries };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

  for (const profile of profiles) {
    const sessionDir = resolve(projectRoot, "data/sessions", profile.id);
    mkdirSync(sessionDir, { recursive: true });
    const cookiesPath = resolve(sessionDir, "cookies.json");
    const storagePath = resolve(sessionDir, "storage.json");
    if (!existsSync(cookiesPath)) {
      writeFileSync(cookiesPath, "[]\n", "utf-8");
    }
    if (!existsSync(storagePath)) {
      writeFileSync(storagePath, "{}\n", "utf-8");
    }
  }
}

export function migrateManifestToChromeProfiles(
  manifestPath: string,
  env: NodeJS.ProcessEnv,
): PanelChromeProfile[] {
  if (!existsSync(manifestPath)) {
    return [];
  }

  const raw = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as { profiles?: ProfileDefinition[] };
  const now = new Date().toISOString();

  return (manifest.profiles ?? []).map((entry) => {
    const suffix = entry.id.replace(/-/g, "_").toUpperCase();
    const emailFromEnv = env[`EMAIL_${suffix}`]?.trim();
    const passwordFromEnv = env[`PASSWORD_${suffix}`]?.trim();
    const googleEmail = env[`GOOGLE_EMAIL_${suffix}`]?.trim();

    let chromeEmail = emailFromEnv ?? googleEmail ?? "";
    let chromePassword = passwordFromEnv ?? env[`GOOGLE_PASSWORD_${suffix}`]?.trim() ?? "";

    const credEmail = entry.credentials?.email?.trim();
    if (credEmail && !credEmail.startsWith("${") && !chromeEmail) {
      chromeEmail = credEmail;
    }
    const credPass = entry.credentials?.password?.trim();
    if (credPass && !credPass.startsWith("${") && !chromePassword) {
      chromePassword = credPass;
    }

    return {
      id: entry.id,
      name: entry.name,
      chromeEmail,
      chromePassword,
      userDataDir: entry.browser?.userDataDir ?? entry.userDataDir ?? `data/chrome/${entry.id}`,
      preferredCdpPort: entry.browser?.cdpPort ?? 9222,
      enabled: entry.enabled !== false,
      createdAt: now,
      updatedAt: now,
    } satisfies PanelChromeProfile;
  });
}

function readManifestProfiles(manifestPath: string): ProfileDefinition[] {
  if (!existsSync(manifestPath)) {
    return [];
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      profiles?: ProfileDefinition[];
    };
    return manifest.profiles ?? [];
  } catch {
    return [];
  }
}

/**
 * manifest.json elle düzenlendiyse kimlik bilgilerini chrome-profiles.json'a aktarır.
 * Kalıcı kaynak: data/control-panel/chrome-profiles.json
 */
export function importManifestCredentialsIntoStore(
  manifestPath: string,
  store: ChromeProfileStore,
): number {
  let updated = 0;

  for (const entry of readManifestProfiles(manifestPath)) {
    const stored = store.get(entry.id);
    if (!stored) {
      continue;
    }

    const manifestEmail = entry.credentials?.email?.trim();
    const manifestPassword = entry.credentials?.password?.trim();
    if (manifestEmail?.startsWith("${") || manifestPassword?.startsWith("${")) {
      continue;
    }

    const patch: Partial<
      Pick<PanelChromeProfile, "name" | "chromeEmail" | "chromePassword" | "preferredCdpPort" | "enabled">
    > = {};

    if (manifestEmail && manifestEmail !== stored.chromeEmail) {
      patch.chromeEmail = manifestEmail;
    }
    if (manifestPassword && manifestPassword !== stored.chromePassword) {
      patch.chromePassword = manifestPassword;
    }

    if (Object.keys(patch).length > 0) {
      store.update(entry.id, patch);
      updated += 1;
    }
  }

  return updated;
}

export function shouldImportManifestCredentials(
  manifestPath: string,
  storePath: string,
): boolean {
  if (!existsSync(manifestPath) || !existsSync(storePath)) {
    return false;
  }
  return statSync(manifestPath).mtimeMs > statSync(storePath).mtimeMs;
}

export function buildChromeCredentialEnv(profile: PanelChromeProfile): NodeJS.ProcessEnv {
  const suffix = profile.id.replace(/-/g, "_").toUpperCase();
  return {
    [`EMAIL_${suffix}`]: profile.chromeEmail,
    [`PASSWORD_${suffix}`]: profile.chromePassword,
    [`GOOGLE_EMAIL_${suffix}`]: profile.chromeEmail,
    [`GOOGLE_PASSWORD_${suffix}`]: profile.chromePassword,
  };
}
