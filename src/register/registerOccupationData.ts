import type { AppSettings } from "../config/settings.js";
import type { ProfileDefinition, ResolvedProfile } from "../profiles/profileManager.js";
import { parseSelectEnvValue, type SelectResolution } from "./registerFormFieldHelpers.js";
import { DEFAULT_REGISTER_JOB_VALUE } from "./registerFormCatalogs.js";

const ENV_PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

export interface RegisterOccupationData {
  job: SelectResolution;
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

function pickSelect(
  profileId: string,
  fieldBase: string,
  manifestValue: string | undefined,
  globalEnv: string | undefined,
  defaultRaw: string,
): SelectResolution {
  const raw = pickString(
    process.env[profileEnvKey(profileId, fieldBase)],
    manifestValue,
    globalEnv,
    defaultRaw,
  );
  return parseSelectEnvValue(raw || defaultRaw);
}

function readManifestOccupation(profile: ProfileDefinition): Record<string, string | undefined> {
  const form = profile.form as Record<string, string | undefined> | undefined;
  return form ?? {};
}

export function resolveRegisterOccupation(
  profile: ResolvedProfile,
  _settings: AppSettings,
): RegisterOccupationData {
  const manifest = readManifestOccupation(profile);
  const id = profile.id;

  return {
    job: pickSelect(id, "JOB", manifest.job, process.env.JOB, DEFAULT_REGISTER_JOB_VALUE),
  };
}

export function validateRegisterOccupation(
  data: RegisterOccupationData,
  profileId: string,
): string[] {
  if (!data.job.value.trim()) {
    return [`Profil "${profileId}": JOB eksik`];
  }
  return [];
}

export function maskRegisterOccupation(data: RegisterOccupationData): RegisterOccupationData {
  return data;
}
