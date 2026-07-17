import type { AppSettings } from "../config/settings.js";
import type { ProfileDefinition, ResolvedProfile } from "../profiles/profileManager.js";

const ENV_PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

export interface RegisterKvkkData {
  location: string;
  locationDate: string;
}

function resolveEnvPlaceholder(value: string): string {
  const match = ENV_PLACEHOLDER.exec(value.trim());
  if (!match) {
    return value;
  }
  return process.env[match[1]!] ?? "";
}

function pickString(...candidates: (string | undefined)[]): string {
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }
    const resolved = resolveEnvPlaceholder(trimmed).trim();
    if (resolved) {
      return resolved;
    }
  }
  return "";
}

function profileEnvKey(profileId: string, fieldBase: string): string {
  return `${fieldBase}_${profileId.replace(/-/g, "_").toUpperCase()}`;
}

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function readManifestKvkk(profile: ProfileDefinition): Record<string, string | undefined> {
  const form = profile.form as Record<string, string | undefined> | undefined;
  return form ?? {};
}

export function resolveRegisterKvkk(profile: ResolvedProfile, _settings: AppSettings): RegisterKvkkData {
  const manifest = readManifestKvkk(profile);
  const id = profile.id;

  return {
    location: pickString(
      process.env[profileEnvKey(id, "KVKK_LOCATION")],
      manifest.kvkkLocation,
      process.env.KVKK_LOCATION,
      process.env[profileEnvKey(id, "APPLICANT_CITY")],
      manifest.applicantCity,
      "Ankara",
    ),
    locationDate: pickString(
      process.env[profileEnvKey(id, "KVKK_LOCATION_DATE")],
      manifest.kvkkLocationDate,
      process.env.KVKK_LOCATION_DATE,
      todayIsoDate(),
    ),
  };
}

export function validateRegisterKvkk(data: RegisterKvkkData, profileId: string): string[] {
  const errors: string[] = [];
  if (!data.location) {
    errors.push(`Profil "${profileId}": KVKK_LOCATION eksik`);
  }
  const datePattern = /^\d{2}\.\d{2}\.\d{4}$|^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(data.locationDate)) {
    errors.push(`Profil "${profileId}": KVKK_LOCATION_DATE gg.aa.yyyy veya yyyy-mm-dd`);
  }
  return errors;
}
