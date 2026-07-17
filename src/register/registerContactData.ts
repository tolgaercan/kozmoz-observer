import type { AppSettings } from "../config/settings.js";
import type { ProfileDefinition, ResolvedProfile } from "../profiles/profileManager.js";
import { parseSelectEnvValue, type SelectResolution } from "./registerFormFieldHelpers.js";
import {
  normalizeRegisterPhone,
  parseResidenceAbroadEnv,
  type ResidenceAbroadChoice,
} from "./registerFormCatalogs.js";

const ENV_PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

export interface RegisterContactData {
  applicantCountry: SelectResolution;
  applicantCity: SelectResolution;
  street: string;
  postalCode: string;
  email: string;
  phone: string;
  residenceAbroad: ResidenceAbroadChoice;
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

function readManifestContact(profile: ProfileDefinition): Record<string, string | undefined> {
  const form = profile.form as Record<string, string | undefined> | undefined;
  return form ?? {};
}

export function resolveRegisterContact(
  profile: ResolvedProfile,
  _settings: AppSettings,
): RegisterContactData {
  const manifest = readManifestContact(profile);
  const id = profile.id;
  const credentialsEmail =
    typeof profile.credentials?.email === "string"
      ? resolveEnvPlaceholder(profile.credentials.email)
      : "";

  const residenceRaw = pickString(
    process.env[profileEnvKey(id, "RESIDENCE_ABROAD")],
    manifest.residenceAbroad,
    process.env.RESIDENCE_ABROAD,
    "Hayır",
  );

  const phoneRaw = pickString(
    process.env[profileEnvKey(id, "PHONE")],
    manifest.phone,
    process.env.PHONE,
  );

  return {
    applicantCountry: pickSelect(
      id,
      "APPLICANT_COUNTRY",
      manifest.applicantCountry,
      process.env.APPLICANT_COUNTRY,
      "685",
    ),
    applicantCity: pickSelect(
      id,
      "APPLICANT_CITY",
      manifest.applicantCity,
      process.env.APPLICANT_CITY,
      "44",
    ),
    street: pickString(
      process.env[profileEnvKey(id, "STREET")],
      manifest.street,
      process.env.STREET,
    ),
    postalCode: pickString(
      process.env[profileEnvKey(id, "POSTAL_CODE")],
      manifest.postalCode,
      process.env.POSTAL_CODE,
    ),
    email: pickString(
      process.env[profileEnvKey(id, "REGISTER_EMAIL")],
      manifest.registerEmail,
      process.env.REGISTER_EMAIL,
      credentialsEmail,
      process.env[profileEnvKey(id, "EMAIL")],
      process.env.EMAIL,
    ),
    phone: normalizeRegisterPhone(phoneRaw),
    residenceAbroad: parseResidenceAbroadEnv(residenceRaw),
  };
}

export function validateRegisterContact(data: RegisterContactData, profileId: string): string[] {
  const errors: string[] = [];
  if (!data.street) {
    errors.push(`Profil "${profileId}": STREET eksik`);
  }
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.push(`Profil "${profileId}": REGISTER_EMAIL veya EMAIL geçerli değil`);
  }
  if (!data.phone || data.phone.length < 10) {
    errors.push(
      `Profil "${profileId}": PHONE eksik veya geçersiz (başında 0 olmadan en az 10 rakam)`,
    );
  }
  return errors;
}

export function maskRegisterContact(data: RegisterContactData): RegisterContactData {
  const [local, domain] = data.email.split("@");
  return {
    ...data,
    street: data.street ? `${data.street.slice(0, 4)}***` : "",
    email: local && domain ? `${local.slice(0, 2)}***@${domain}` : "***",
    phone: data.phone ? `${data.phone.slice(0, 3)}***${data.phone.slice(-2)}` : "",
  };
}
