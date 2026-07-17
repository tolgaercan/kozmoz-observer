import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSettings } from "./settings.js";
import { loadEnvOverlay } from "./envLoader.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Demo kayıt: form sahte veriler, Google girişi profile-1 (.env) gerçek hesabı.
 */
export function loadDemoRecordingEnv(
  projectRoot: string = PROJECT_ROOT,
  googleSourceProfileId = "profile-1",
): boolean {
  loadSettings(projectRoot);

  const demoPath = resolve(projectRoot, "env/demo-recording.env");
  if (!loadEnvOverlay(demoPath, { override: true })) {
    return false;
  }

  applyGoogleCredentialsFromProfile(googleSourceProfileId);
  applyRegisterDropdownsFromProfile(googleSourceProfileId);
  return true;
}

function profileEnvSuffix(profileId: string): string {
  return profileId.replace(/-/g, "_").toUpperCase();
}

/** Gerçek Google oturumu — kaynak profilden demo profiline kopyala. */
export function applyGoogleCredentialsFromProfile(sourceProfileId: string): void {
  const suffix = profileEnvSuffix(sourceProfileId);
  const demoSuffix = profileEnvSuffix("profile-demo");

  const email =
    process.env[`GOOGLE_EMAIL_${suffix}`]?.trim() ??
    process.env.GOOGLE_EMAIL?.trim() ??
    process.env[`EMAIL_${suffix}`]?.trim() ??
    "";

  const password =
    process.env[`GOOGLE_PASSWORD_${suffix}`]?.trim() ??
    process.env.GOOGLE_PASSWORD?.trim() ??
    process.env[`PASSWORD_${suffix}`]?.trim() ??
    "";

  if (email) {
    process.env[`GOOGLE_EMAIL_${demoSuffix}`] = email;
  }
  if (password) {
    process.env[`GOOGLE_PASSWORD_${demoSuffix}`] = password;
  }
}

/** Dropdown ülke alanları — profile-1'de çalışan değerleri demo'ya kopyala. */
export function applyRegisterDropdownsFromProfile(sourceProfileId: string): void {
  const src = profileEnvSuffix(sourceProfileId);
  const demoSuffix = profileEnvSuffix("profile-demo");

  const fields = [
    "BIRTH_COUNTRY",
    "CURRENT_NATIONALITY",
    "APPLICANT_COUNTRY",
    "APPLICANT_CITY",
    "GENDER",
    "MARITAL_STATUS",
    "PASSPORT_TYPE",
  ] as const;

  for (const field of fields) {
    const value = process.env[`${field}_${src}`]?.trim();
    if (value) {
      process.env[`${field}_${demoSuffix}`] = value;
    }
  }
}
