import type { AppSettings } from "../config/settings.js";
import type { ProfileDefinition, ProfileFormData, ResolvedProfile } from "./profileManager.js";

const ENV_PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

function resolveEnvPlaceholder(value: string): string {
  const match = ENV_PLACEHOLDER.exec(value.trim());
  if (!match) {
    return value;
  }
  return process.env[match[1]!] ?? "";
}

function pickString(...candidates: (string | undefined)[]): string | undefined {
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
  return undefined;
}

/** Manifest'teki düz alanlar + form bloğunu birleştirir */
export function extractRawForm(profile: ProfileDefinition): Partial<ProfileFormData> {
  const nested = profile.form ?? {};
  return {
    appointmentCity: nested.appointmentCity ?? profile.appointmentCity,
    appointmentOffice: nested.appointmentOffice ?? profile.appointmentOffice,
    applicationType: nested.applicationType ?? profile.applicationType,
    appointmentStyle: nested.appointmentStyle ?? profile.appointmentStyle,
    nationalityNumber: nested.nationalityNumber ?? profile.nationalityNumber,
  };
}

/** Profil + panel/manifest → akışta kullanılacak form değişkenleri */
export function resolveProfileForm(
  profile: ResolvedProfile,
  settings: AppSettings,
): ProfileFormData {
  const raw = extractRawForm(profile);

  const appointmentCity = pickString(
    raw.appointmentCity,
    settings.appointment.defaultCity,
  );

  const applicationType = pickString(
    raw.applicationType,
    settings.appointment.defaultApplicationType,
  );

  const nationalityNumber = pickString(
    raw.nationalityNumber,
  );

  const appointmentStyle = pickString(
    raw.appointmentStyle,
    settings.appointment.defaultAppointmentStyle,
  );

  return {
    appointmentCity: appointmentCity ?? "",
    appointmentOffice: raw.appointmentOffice?.trim() || undefined,
    applicationType: applicationType ?? "",
    nationalityNumber: nationalityNumber ?? "",
    appointmentStyle: appointmentStyle ?? "",
  };
}

/** Akış için zorunlu alanları doğrular — test data validation */
export function validateProfileFormForFlow(
  form: ProfileFormData,
  requiredFields: (keyof ProfileFormData)[],
  flowId: string,
  profileId: string,
): string[] {
  const errors: string[] = [];

  for (const field of requiredFields) {
    if (!form[field]?.trim()) {
      errors.push(
        `[${flowId}] Profil "${profileId}" için zorunlu alan eksik: ${field}`,
      );
    }
  }

  return errors;
}

/** ResolvedProfile üzerinde form alanlarını düzleştirir — mevcut selector'lar uyumluluğu */
export function applyFormToProfile(
  profile: ResolvedProfile,
  form: ProfileFormData,
): ResolvedProfile {
  return {
    ...profile,
    appointmentCity: form.appointmentCity || profile.appointmentCity,
    applicationType: form.applicationType || profile.applicationType,
    appointmentStyle: form.appointmentStyle || profile.appointmentStyle,
    nationalityNumber: form.nationalityNumber || profile.nationalityNumber,
  };
}
