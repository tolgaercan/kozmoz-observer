import { isValidTurkishPassportNo } from "./turkishIdValidation.js";
import type { AppSettings } from "../config/settings.js";
import type { ProfileDefinition, ResolvedProfile } from "../profiles/profileManager.js";
import { parseSelectEnvValue, type SelectResolution } from "./registerFormFieldHelpers.js";

const ENV_PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

/** Dropdown katalog — .env örnekleri için (tüm seçenekler) */
export const REGISTER_SELECT_CATALOG = {
  birthCountryId: {
    field: "Doğduğu Ülke",
    name: "birthCountryId",
    env: "BIRTH_COUNTRY_PROFILE_1",
    format: "Sayısal option value (685) veya ülke adı (Türkiye). Önek: value:685 | label:Türkiye",
    common: [{ value: "685", label: "Türkiye" }],
    note: "Tam liste portal HTML select içinde — yüzlerce ülke. Varsayılan: 685",
  },
  nationalityId: {
    field: "Mevcut Uyruğunuz",
    name: "nationalityId",
    env: "CURRENT_NATIONALITY_PROFILE_1",
    format: "Sayısal value veya ülke adı — birthCountryId ile aynı liste",
    common: [{ value: "685", label: "Türkiye" }],
  },
  genderId: {
    field: "Cinsiyet",
    name: "genderId",
    env: "GENDER_PROFILE_1",
    format: "value veya Türkçe etiket",
    options: [
      { value: "9", label: "Kadın" },
      { value: "10", label: "Erkek" },
    ],
  },
  martialStatusId: {
    field: "Medeni Hal",
    name: "martialStatusId",
    env: "MARITAL_STATUS_PROFILE_1",
    format: "value veya Türkçe etiket (form alanı adı martialStatusId)",
    options: [
      { value: "35", label: "Bekar" },
      { value: "36", label: "Evli" },
      { value: "45", label: "Ayrı" },
      { value: "46", label: "Boşanmış" },
      { value: "47", label: "Dul" },
      { value: "148", label: "Diğer" },
      { value: "2337", label: "Kayıtlı Birliktelik" },
    ],
  },
  passportTypeId: {
    field: "Seyahat belgesinin türü",
    name: "passportTypeId",
    env: "PASSPORT_TYPE_PROFILE_1",
    format: "value veya Türkçe etiket",
    options: [
      { value: "48", label: "Normal Pasaport" },
      { value: "49", label: "Diplomatik Pasaport" },
      { value: "50", label: "Hizmet Pasaport" },
      { value: "51", label: "Resmi Pasaport" },
      { value: "52", label: "Hususi Pasaport" },
      { value: "53", label: "Diğer Seyahat Belgesi" },
    ],
  },
} as const;

export interface RegisterPersonalData {
  birthPlace: string;
  birthCountry: SelectResolution;
  gender: SelectResolution;
  maritalStatus: SelectResolution;
  currentNationality: SelectResolution;
  passportType: SelectResolution;
  passportIssueDate: string;
  passportExpiryDate: string;
  passportNo: string;
  issuingAuthority: string;
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

function readManifestPersonal(profile: ProfileDefinition): Record<string, string | undefined> {
  const form = profile.form as Record<string, string | undefined> | undefined;
  return form ?? {};
}

export function resolveRegisterPersonal(
  profile: ResolvedProfile,
  _settings: AppSettings,
): RegisterPersonalData {
  const manifest = readManifestPersonal(profile);
  const id = profile.id;

  return {
    birthPlace: pickString(
      process.env[profileEnvKey(id, "BIRTH_PLACE")],
      manifest.birthPlace,
      process.env.BIRTH_PLACE,
    ),
    birthCountry: pickSelect(
      id,
      "BIRTH_COUNTRY",
      manifest.birthCountry,
      process.env.BIRTH_COUNTRY,
      "685",
    ),
    gender: pickSelect(id, "GENDER", manifest.gender, process.env.GENDER, "10"),
    maritalStatus: pickSelect(
      id,
      "MARITAL_STATUS",
      manifest.maritalStatus,
      process.env.MARITAL_STATUS,
      "35",
    ),
    currentNationality: pickSelect(
      id,
      "CURRENT_NATIONALITY",
      manifest.currentNationality,
      process.env.CURRENT_NATIONALITY,
      "685",
    ),
    passportType: pickSelect(
      id,
      "PASSPORT_TYPE",
      manifest.passportType,
      process.env.PASSPORT_TYPE,
      "48",
    ),
    passportIssueDate: pickString(
      process.env[profileEnvKey(id, "PASSPORT_ISSUE_DATE")],
      manifest.passportIssueDate,
      process.env.PASSPORT_ISSUE_DATE,
    ),
    passportExpiryDate: pickString(
      process.env[profileEnvKey(id, "PASSPORT_EXPIRY_DATE")],
      manifest.passportExpiryDate,
      process.env.PASSPORT_EXPIRY_DATE,
    ),
    passportNo: pickString(
      process.env[profileEnvKey(id, "PASSPORT_NO")],
      manifest.passportNo,
      process.env.PASSPORT_NO,
    ),
    issuingAuthority: pickString(
      process.env[profileEnvKey(id, "ISSUING_AUTHORITY")],
      manifest.issuingAuthority,
      process.env.ISSUING_AUTHORITY,
    ),
  };
}

export function validateRegisterPersonal(
  data: RegisterPersonalData,
  profileId: string,
): string[] {
  const errors: string[] = [];
  if (!data.birthPlace) {
    errors.push(`Profil "${profileId}": BIRTH_PLACE eksik`);
  }
  if (!data.passportNo) {
    errors.push(`Profil "${profileId}": PASSPORT_NO eksik`);
  } else if (!isValidTurkishPassportNo(data.passportNo)) {
    errors.push(
      `Profil "${profileId}": PASSPORT_NO geçersiz (1 harf + 7–10 rakam, örn. U12345678)`,
    );
  }
  if (!data.issuingAuthority) {
    errors.push(`Profil "${profileId}": ISSUING_AUTHORITY eksik`);
  }
  const datePattern = /^\d{2}\.\d{2}\.\d{4}$|^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(data.passportIssueDate)) {
    errors.push(`Profil "${profileId}": PASSPORT_ISSUE_DATE gg.aa.yyyy veya yyyy-mm-dd`);
  }
  if (!datePattern.test(data.passportExpiryDate)) {
    errors.push(`Profil "${profileId}": PASSPORT_EXPIRY_DATE gg.aa.yyyy veya yyyy-mm-dd`);
  }
  return errors;
}

export function maskRegisterPersonal(data: RegisterPersonalData): RegisterPersonalData {
  return {
    ...data,
    birthPlace: data.birthPlace ? `${data.birthPlace.slice(0, 2)}***` : "",
    passportNo: data.passportNo
      ? `${data.passportNo.slice(0, 2)}***${data.passportNo.slice(-2)}`
      : "",
    issuingAuthority: data.issuingAuthority
      ? `${data.issuingAuthority.slice(0, 3)}***`
      : "",
  };
}
