import type { AppSettings } from "../config/settings.js";
import type { ProfileDefinition, ResolvedProfile } from "../profiles/profileManager.js";
import { isValidTckn } from "./turkishIdValidation.js";

const ENV_PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

export interface RegisterIdentityData {
  firstName: string;
  lastName: string;
  nationalityNumber: string;
  /** gg.aa.yyyy veya yyyy-mm-dd (HTML date input) */
  birthDate: string;
}

/** Env/manifest gg.aa.yyyy → input[type=date] değeri yyyy-mm-dd */
export function birthDateToHtmlInputValue(birthDate: string): string {
  const trimmed = birthDate.trim();
  const dotted = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(trimmed);
  if (dotted) {
    return `${dotted[3]}-${dotted[2]}-${dotted[1]}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  throw new Error(`Geçersiz doğum tarihi formatı: ${birthDate} (gg.aa.yyyy veya yyyy-mm-dd)`);
}

export function isValidBirthDateFormat(birthDate: string): boolean {
  const trimmed = birthDate.trim();
  return /^\d{2}\.\d{2}\.\d{4}$/.test(trimmed) || /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
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
  const suffix = profileId.replace(/-/g, "_").toUpperCase();
  return `${fieldBase}_${suffix}`;
}

function readManifestRegisterFields(profile: ProfileDefinition): Partial<RegisterIdentityData> {
  const form = profile.form as Record<string, string | undefined> | undefined;
  return {
    firstName: form?.firstName ?? form?.name,
    lastName: form?.lastName ?? form?.surname,
    nationalityNumber: form?.nationalityNumber ?? profile.nationalityNumber,
    birthDate: form?.birthDate,
  };
}

export function resolveRegisterIdentity(
  profile: ResolvedProfile,
  settings: AppSettings,
): RegisterIdentityData {
  const manifest = readManifestRegisterFields(profile);
  const id = profile.id;

  const firstName = pickString(
    process.env[profileEnvKey(id, "FIRST_NAME")],
    manifest.firstName,
    process.env.FIRST_NAME,
  );

  const lastName = pickString(
    process.env[profileEnvKey(id, "LAST_NAME")],
    manifest.lastName,
    process.env.LAST_NAME,
  );

  const nationalityNumber = pickString(
    process.env[profileEnvKey(id, "NATIONALITY_NUMBER")],
    manifest.nationalityNumber,
    process.env.NATIONALITY_NUMBER,
  );

  const birthDate = pickString(
    process.env[profileEnvKey(id, "BIRTH_DATE")],
    manifest.birthDate,
    process.env.BIRTH_DATE,
  );

  return { firstName, lastName, nationalityNumber, birthDate };
}

export function validateRegisterIdentity(
  data: RegisterIdentityData,
  profileId: string,
): string[] {
  const errors: string[] = [];
  if (!data.firstName) {
    errors.push(`Profil "${profileId}": FIRST_NAME / form.firstName eksik`);
  }
  if (!data.lastName) {
    errors.push(`Profil "${profileId}": LAST_NAME / form.lastName eksik`);
  }
  if (!data.nationalityNumber || data.nationalityNumber.length !== 11) {
    errors.push(`Profil "${profileId}": NATIONALITY_NUMBER 11 haneli olmalı`);
  } else if (!isValidTckn(data.nationalityNumber)) {
    errors.push(`Profil "${profileId}": NATIONALITY_NUMBER geçersiz TCKN (kontrol basamakları)`);
  }
  if (!isValidBirthDateFormat(data.birthDate)) {
    errors.push(`Profil "${profileId}": BIRTH_DATE gg.aa.yyyy veya yyyy-mm-dd formatında olmalı`);
  }
  return errors;
}

export function maskRegisterIdentity(data: RegisterIdentityData): RegisterIdentityData {
  return {
    firstName: data.firstName ? `${data.firstName.slice(0, 1)}***` : "",
    lastName: data.lastName ? `${data.lastName.slice(0, 1)}***` : "",
    nationalityNumber: data.nationalityNumber
      ? `${data.nationalityNumber.slice(0, 3)}***${data.nationalityNumber.slice(-2)}`
      : "",
    birthDate: data.birthDate ? "**.**." + data.birthDate.slice(-4) : "",
  };
}
