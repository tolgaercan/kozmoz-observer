import type { ApiWatcherSettings } from "../../config/settings.js";
import type { ResolvedProfile } from "../../profiles/profileManager.js";
import { extractRawForm } from "../../profiles/profileContext.js";
import { logger } from "../../utils/logger.js";
import {
  API_APPOINTMENT_CITY_IDS,
  API_DEALER_IDS,
  APPOINTMENT_STYLE_IDS,
  APPLICATION_TYPE_IDS,
  resolveCatalogId,
} from "./portalApiCatalog.js";

export interface ApiQueryParams {
  /** GetClosedDate — portal dealerId (Ankara=1014) */
  dealerId: string;
  /** GetClosedDate — aralık başlangıcı yyyy-MM-dd */
  date: string;
  /** GetClosedDate — aralık bitişi yyyy-MM-dd */
  maxDate: string;
  /** Eski/alternatif endpoint ve HourQouta için */
  cityId: string;
  cityLabel?: string;
  /** Başvuru şekli — appointmentTypeId (Standart=16, EEA AB Eşi=2339) */
  appointmentTypeId: string;
  appointmentStyleLabel?: string;
  /** Başvuru tipi — applicationTypeId (Bireysel=1, Aile=2) */
  applicationTypeId: string;
  applicationTypeLabel?: string;
  /** GetAppointmentHourQoutaInfo — seçili gün (yyyy-MM-dd) */
  appointmentDate?: string;
}

export interface ApiQueryParamOverrides {
  dealerId?: string;
  date?: string;
  maxDate?: string;
  cityId?: string;
  appointmentTypeId?: string;
  applicationTypeId?: string;
  appointmentDate?: string;
}

function profileEnvKey(profileId: string, suffix: string): string {
  return `${suffix}_${profileId.toUpperCase().replace(/-/g, "_")}`;
}

function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function readProfileForm(profile: ResolvedProfile) {
  return extractRawForm(profile);
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T12:00:00`);
  base.setDate(base.getDate() + days);
  return formatIsoDate(base);
}

function resolveCityId(
  profile: ResolvedProfile,
  apiSettings: ApiWatcherSettings,
  overrides?: ApiQueryParamOverrides,
): string {
  const fromOverride = overrides?.cityId?.trim();
  if (fromOverride) {
    return fromOverride;
  }

  const fromProfileEnv = readEnv(profileEnvKey(profile.id, "API_CITY_ID"));
  if (fromProfileEnv) {
    return fromProfileEnv;
  }

  const fromGlobal = readEnv("API_CITY_ID");
  if (fromGlobal) {
    return fromGlobal;
  }

  const form = readProfileForm(profile);
  const cityLabel = form.appointmentCity?.trim();
  const fromCatalog = cityLabel
    ? resolveCatalogId(API_APPOINTMENT_CITY_IDS, cityLabel, apiSettings.defaultCityId)
    : undefined;

  return fromCatalog ?? apiSettings.defaultCityId;
}

function resolveDealerId(
  profile: ResolvedProfile,
  apiSettings: ApiWatcherSettings,
  overrides?: ApiQueryParamOverrides,
): string {
  const fromOverride = overrides?.dealerId?.trim();
  if (fromOverride) {
    return fromOverride;
  }

  const fromProfileEnv = readEnv(profileEnvKey(profile.id, "API_DEALER_ID"));
  if (fromProfileEnv) {
    return fromProfileEnv;
  }

  const fromGlobal = readEnv("API_DEALER_ID");
  if (fromGlobal) {
    return fromGlobal;
  }

  const form = readProfileForm(profile);
  const cityLabel = form.appointmentCity?.trim();
  const fromCatalog = cityLabel
    ? resolveCatalogId(API_DEALER_IDS, cityLabel, apiSettings.defaultDealerId)
    : undefined;

  return fromCatalog ?? apiSettings.defaultDealerId;
}

function resolveClosedDateRange(
  apiSettings: ApiWatcherSettings,
  overrides?: ApiQueryParamOverrides,
): { date: string; maxDate: string } {
  const date =
    overrides?.date?.trim() ||
    readEnv("API_CLOSED_DATE") ||
    formatIsoDate(new Date());

  const maxDate =
    overrides?.maxDate?.trim() ||
    readEnv("API_CLOSED_DATE_MAX") ||
    addDaysIso(date, apiSettings.closedDateRangeDays);

  return { date, maxDate };
}

function resolveAppointmentTypeId(
  profile: ResolvedProfile,
  apiSettings: ApiWatcherSettings,
  overrides?: ApiQueryParamOverrides,
): { id: string; label?: string } {
  const form = readProfileForm(profile);

  const fromOverride = overrides?.appointmentTypeId?.trim();
  if (fromOverride) {
    return { id: fromOverride, label: form.appointmentStyle };
  }

  const fromProfileEnv = readEnv(profileEnvKey(profile.id, "API_APPOINTMENT_TYPE_ID"));
  if (fromProfileEnv) {
    return { id: fromProfileEnv, label: form.appointmentStyle };
  }

  const fromGlobal = readEnv("API_APPOINTMENT_TYPE_ID");
  if (fromGlobal) {
    return { id: fromGlobal, label: form.appointmentStyle };
  }

  const styleLabel =
    readEnv(profileEnvKey(profile.id, "APPOINTMENT_STYLE")) ??
    form.appointmentStyle?.trim() ??
    readEnv("APPOINTMENT_STYLE") ??
    apiSettings.defaultAppointmentStyle;

  const id =
    resolveCatalogId(APPOINTMENT_STYLE_IDS, styleLabel, apiSettings.defaultAppointmentTypeId) ??
    apiSettings.defaultAppointmentTypeId;

  return { id, label: styleLabel };
}

function resolveApplicationTypeId(
  profile: ResolvedProfile,
  apiSettings: ApiWatcherSettings,
  overrides?: ApiQueryParamOverrides,
): { id: string; label?: string } {
  const form = readProfileForm(profile);

  const fromOverride = overrides?.applicationTypeId?.trim();
  if (fromOverride) {
    return { id: fromOverride, label: form.applicationType };
  }

  const fromProfileEnv = readEnv(profileEnvKey(profile.id, "API_APPLICATION_TYPE_ID"));
  if (fromProfileEnv) {
    return { id: fromProfileEnv, label: form.applicationType };
  }

  const fromGlobal = readEnv("API_APPLICATION_TYPE_ID");
  if (fromGlobal) {
    return { id: fromGlobal, label: form.applicationType };
  }

  const typeLabel =
    readEnv(profileEnvKey(profile.id, "APPLICATION_TYPE")) ??
    form.applicationType?.trim() ??
    readEnv("APPLICATION_TYPE") ??
    apiSettings.defaultApplicationType;

  const id =
    resolveCatalogId(APPLICATION_TYPE_IDS, typeLabel, apiSettings.defaultApplicationTypeId) ??
    apiSettings.defaultApplicationTypeId;

  return { id, label: typeLabel };
}

function resolveAppointmentDate(
  closedDateStart: string,
  overrides?: ApiQueryParamOverrides,
): string | undefined {
  return (
    overrides?.appointmentDate?.trim() ||
    readEnv("API_APPOINTMENT_DATE") ||
    closedDateStart
  );
}

/**
 * API istek parametreleri — öncelik: senaryo params → API_*_PROFILE_X → API_* → manifest etiket → settings default.
 */
export function resolveApiQueryParams(
  profile: ResolvedProfile,
  apiSettings: ApiWatcherSettings,
  overrides?: ApiQueryParamOverrides,
): ApiQueryParams {
  const appointmentType = resolveAppointmentTypeId(profile, apiSettings, overrides);
  const applicationType = resolveApplicationTypeId(profile, apiSettings, overrides);
  const { date, maxDate } = resolveClosedDateRange(apiSettings, overrides);

  return {
    dealerId: resolveDealerId(profile, apiSettings, overrides),
    date,
    maxDate,
    cityId: resolveCityId(profile, apiSettings, overrides),
    cityLabel: readProfileForm(profile).appointmentCity,
    appointmentTypeId: appointmentType.id,
    appointmentStyleLabel: appointmentType.label,
    applicationTypeId: applicationType.id,
    applicationTypeLabel: applicationType.label,
    appointmentDate: resolveAppointmentDate(date, overrides),
  };
}

export function formatApiQueryParamsSummary(params: ApiQueryParams): string {
  const parts = [
    `dealerId=${params.dealerId}${params.cityLabel ? ` (${params.cityLabel})` : ""}`,
    `date=${params.date}`,
    `maxDate=${params.maxDate}`,
    `appointmentTypeId=${params.appointmentTypeId}${params.appointmentStyleLabel ? ` (${params.appointmentStyleLabel})` : ""}`,
    `applicationTypeId=${params.applicationTypeId}${params.applicationTypeLabel ? ` (${params.applicationTypeLabel})` : ""}`,
  ];
  return parts.join(", ");
}

export function logResolvedApiQueryParams(
  profileId: string,
  params: ApiQueryParams,
): void {
  logger.info(`[api] Sorgu parametreleri (${profileId}): ${formatApiQueryParamsSummary(params)}`);
}
