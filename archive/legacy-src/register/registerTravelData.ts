import type { AppSettings } from "../config/settings.js";
import type { ProfileDefinition, ResolvedProfile } from "../profiles/profileManager.js";
import {
  parseSchengenFingerprintEnv,
  type SchengenFingerprintValue,
} from "./registerFormCatalogs.js";
import { parseSelectEnvValue, type SelectResolution } from "./registerFormFieldHelpers.js";

const ENV_PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

export interface RegisterTravelData {
  travelType: SelectResolution;
  destinationCountry: SelectResolution;
  firstEntryCountry: SelectResolution;
  visaEntryType: SelectResolution;
  visaEntryDate: string;
  visaReturnDate: string;
  schengenFingerprint: SchengenFingerprintValue;
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

function readManifestTravel(profile: ProfileDefinition): Record<string, string | undefined> {
  const form = profile.form as Record<string, string | undefined> | undefined;
  return form ?? {};
}

export function resolveRegisterTravel(
  profile: ResolvedProfile,
  _settings: AppSettings,
): RegisterTravelData {
  const manifest = readManifestTravel(profile);
  const id = profile.id;

  const fingerprintRaw = pickString(
    process.env[profileEnvKey(id, "SCHENGEN_FINGERPRINT")],
    manifest.schengenFingerprint,
    process.env.SCHENGEN_FINGERPRINT,
    "Hayır",
  );

  return {
    travelType: pickSelect(
      id,
      "TRAVEL_TYPE",
      manifest.travelType,
      process.env.TRAVEL_TYPE,
      "Turistik",
    ),
    destinationCountry: pickSelect(
      id,
      "SCH_DESTINATION_COUNTRY",
      manifest.schDestinationCountry,
      process.env.SCH_DESTINATION_COUNTRY,
      "537",
    ),
    firstEntryCountry: pickSelect(
      id,
      "SCH_FIRST_ENTRY_COUNTRY",
      manifest.schFirstEntryCountry,
      process.env.SCH_FIRST_ENTRY_COUNTRY,
      "537",
    ),
    visaEntryType: pickSelect(
      id,
      "VISA_ENTRY_TYPE",
      manifest.visaEntryType,
      process.env.VISA_ENTRY_TYPE,
      "56",
    ),
    visaEntryDate: pickString(
      process.env[profileEnvKey(id, "VISA_ENTRY_DATE")],
      manifest.visaEntryDate,
      process.env.VISA_ENTRY_DATE,
    ),
    visaReturnDate: pickString(
      process.env[profileEnvKey(id, "VISA_RETURN_DATE")],
      manifest.visaReturnDate,
      process.env.VISA_RETURN_DATE,
    ),
    schengenFingerprint: parseSchengenFingerprintEnv(fingerprintRaw),
  };
}

export function validateRegisterTravel(data: RegisterTravelData, profileId: string): string[] {
  const errors: string[] = [];
  const datePattern = /^\d{2}\.\d{2}\.\d{4}$|^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(data.visaEntryDate)) {
    errors.push(`Profil "${profileId}": VISA_ENTRY_DATE gg.aa.yyyy veya yyyy-mm-dd`);
  }
  if (!datePattern.test(data.visaReturnDate)) {
    errors.push(`Profil "${profileId}": VISA_RETURN_DATE gg.aa.yyyy veya yyyy-mm-dd`);
  }
  return errors;
}

export function maskRegisterTravel(data: RegisterTravelData): RegisterTravelData {
  return data;
}
