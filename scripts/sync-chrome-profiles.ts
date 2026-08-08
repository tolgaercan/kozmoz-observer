import { resolve } from "node:path";

import { loadSettings } from "../src/config/settings.js";
import { ChromeProfileStore } from "../src/control-panel/chromeProfileStore.js";
import { ChromeSessionStore } from "../src/control-panel/chromeSessionStore.js";
import {
  migrateManifestToChromeProfiles,
  syncManifestFromChromeProfiles,
} from "../src/control-panel/profileBridge.js";

const projectRoot = resolve(import.meta.dirname, "..");
loadSettings(projectRoot);

const manifestPath = resolve(projectRoot, "data/profiles/manifest.json");
const store = new ChromeProfileStore(projectRoot);

if (store.listAll().length === 0) {
  const migrated = migrateManifestToChromeProfiles(manifestPath, process.env);
  if (migrated.length === 0) {
    console.error("Migrate edilecek profil yok.");
    process.exit(1);
  }
  store.replaceAll(migrated, migrated[0]?.id);
  console.log(`Migrate: ${migrated.length} profil → chrome-profiles.json`);
}

const profiles = store.listAll();
const sessionStore = new ChromeSessionStore(projectRoot);
const cdpPortById: Record<string, number> = {};
for (const profile of profiles) {
  cdpPortById[profile.id] =
    sessionStore.get(profile.id)?.assignedCdpPort ?? profile.preferredCdpPort ?? 9222;
}

syncManifestFromChromeProfiles(projectRoot, manifestPath, profiles, cdpPortById);
console.log(`Manifest sadeleştirildi: ${profiles.map((p) => p.id).join(", ")}`);
