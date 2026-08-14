import type { AppSettings } from "../config/settings.js";
import type { ProfileDefinition, ProfileFormData, ResolvedProfile } from "./profileManager.js";
import { readPanelWorkerApi } from "./profileCredentials.js";

function pickString(...candidates: (string | undefined)[]): string | undefined {
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.startsWith("${")) {
      continue;
    }
    return trimmed;
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

/** Profil + panel → akışta kullanılacak form değişkenleri */
export function resolveProfileForm(
  profile: ResolvedProfile,
  settings: AppSettings,
): ProfileFormData {
  const raw = extractRawForm(profile);
  const panelApi = readPanelWorkerApi(profile.id);

  const appointmentCity = pickString(raw.appointmentCity, settings.appointment.defaultCity);

  const applicationType = pickString(
    raw.applicationType,
    panelApi?.applicationType,
    settings.appointment.defaultApplicationType,
  );

  const nationalityNumber = pickString(raw.nationalityNumber, panelApi?.nationalityNumber);

  const appointmentStyle = pickString(
    raw.appointmentStyle,
    panelApi?.appointmentStyle,
    settings.appointment.defaultAppointmentStyle,
  );

  return {
    appointmentCity: appointmentCity ?? "",
    appointmentOffice: raw.appointmentOffice?.trim() || panelApi?.dealerOffice?.trim() || undefined,
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
