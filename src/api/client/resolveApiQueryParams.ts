import type { ApiWatcherSettings } from "../../config/settings.js";
import type { ResolvedProfile } from "../../profiles/profileManager.js";
import { extractRawForm } from "../../profiles/profileContext.js";
import { logger } from "../../utils/logger.js";
import { resolvePortalGetClosedDateMaxDate } from "./availabilityDates.js";
import {
  API_APPOINTMENT_CITY_IDS,
  API_DEALER_IDS,
  APPOINTMENT_STYLE_IDS,
  APPLICATION_TYPE_IDS,
  findDealerOfficeById,
  findDealerOfficeByName,
  findAppointmentStyleByTypeId,
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
  /** Fiziksel ofis adı — dealerId ile eşleşir (örn. Antalya, İzmir) */
  dealerOfficeLabel?: string;
  /** Başvuru şekli — appointmentTypeId (Standart=16, EEA AB Eşi=2339) */
  appointmentTypeId: string;
  appointmentStyleLabel?: string;
  /** GetAppointmentHourQoutaInfo için — GetClosedDate kullanmaz */
  applicationTypeId: string;
  applicationTypeLabel?: string;
  /** GetAppointmentHourQoutaInfo — seçili gün (yyyy-MM-dd); URL'de {date} olarak da yazılır */
  appointmentDate?: string;
  /**
   * Hour kota (AppointmentLayouts) — portal query.
   * GetClosedDate kullanmaz.
   */
  nationalityNumber?: string;
  /** Portal `applicationType` query (= applicationTypeId, örn. 1) */
  applicationType?: string;
  onlyAvailable?: string;
  /** Portal hour isteği — yoksa istek atılmamalı (captcha UI/token) */
  recaptchaToken?: string;
}

export interface ApiQueryParamOverrides {
  dealerId?: string;
  /** Fiziksel ofis adı — Antalya, Bodrum, Ankara … (API_DEALER_IDS) */
  dealerOffice?: string;
  date?: string;
  maxDate?: string;
  cityId?: string;
  appointmentTypeId?: string;
  /** Başvuru şekli etiketi — Standart, EEA AB Eşi … */
  appointmentStyle?: string;
  /** Başvuru tipi etiketi — Bireysel, Aile */
  applicationType?: string;
  /** Yalnızca saat kotası — GetClosedDate için gerekmez */
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

function resolveDealerSelection(
  profile: ResolvedProfile,
  apiSettings: ApiWatcherSettings,
  overrides?: ApiQueryParamOverrides,
): { dealerId: string; dealerOfficeLabel?: string } {
  const fromOverrideId = overrides?.dealerId?.trim();
  if (fromOverrideId) {
    return {
      dealerId: fromOverrideId,
      dealerOfficeLabel: findDealerOfficeById(fromOverrideId)?.name,
    };
  }

  const officeCandidates = [
    overrides?.dealerOffice?.trim(),
    readEnv(profileEnvKey(profile.id, "API_DEALER_OFFICE")),
    readEnv("API_DEALER_OFFICE"),
    readProfileForm(profile).appointmentOffice?.trim(),
  ].filter(Boolean) as string[];

  for (const officeLabel of officeCandidates) {
    const office = findDealerOfficeByName(officeLabel);
    if (office) {
      return { dealerId: office.dealerId, dealerOfficeLabel: office.name };
    }
    const fromCatalog = resolveCatalogId(API_DEALER_IDS, officeLabel);
    if (fromCatalog) {
      return {
        dealerId: fromCatalog,
        dealerOfficeLabel: findDealerOfficeById(fromCatalog)?.name ?? officeLabel,
      };
    }
  }

  const fromProfileEnv = readEnv(profileEnvKey(profile.id, "API_DEALER_ID"));
  if (fromProfileEnv) {
    return {
      dealerId: fromProfileEnv,
      dealerOfficeLabel: findDealerOfficeById(fromProfileEnv)?.name,
    };
  }

  const fromGlobal = readEnv("API_DEALER_ID");
  if (fromGlobal) {
    return {
      dealerId: fromGlobal,
      dealerOfficeLabel: findDealerOfficeById(fromGlobal)?.name,
    };
  }

  const cityLabel = readProfileForm(profile).appointmentCity?.trim();
  const fromCityAsOffice = cityLabel
    ? resolveCatalogId(API_DEALER_IDS, cityLabel, apiSettings.defaultDealerId)
    : undefined;

  if (fromCityAsOffice) {
    return {
      dealerId: fromCityAsOffice,
      dealerOfficeLabel: findDealerOfficeById(fromCityAsOffice)?.name ?? cityLabel,
    };
  }

  return {
    dealerId: apiSettings.defaultDealerId,
    dealerOfficeLabel: findDealerOfficeById(apiSettings.defaultDealerId)?.name,
  };
}

function resolveClosedDateRange(
  apiSettings: ApiWatcherSettings,
  overrides?: ApiQueryParamOverrides,
): { date: string; maxDate: string } {
  const date =
    overrides?.date?.trim() ||
    readEnv("API_CLOSED_DATE") ||
    formatIsoDate(new Date());

  const maxDateOverride = overrides?.maxDate?.trim() || readEnv("API_CLOSED_DATE_MAX");
  if (maxDateOverride) {
    return { date, maxDate: maxDateOverride };
  }

  const mode = (readEnv("API_CLOSED_DATE_MAX_MODE") ?? "api").toLowerCase();
  const maxDate =
    mode === "offset" || mode === "fixed"
      ? addDaysIso(date, apiSettings.closedDateRangeDays)
      : resolvePortalGetClosedDateMaxDate(date);

  return { date, maxDate };
}

/** Sorgu penceresi gün sayısı — Telegram / log için. */
export { resolveClosedDateRangeDays } from "./availabilityDates.js";

function resolveStyleLabel(
  profile: ResolvedProfile,
  apiSettings: ApiWatcherSettings,
  overrides?: ApiQueryParamOverrides,
): string {
  return (
    overrides?.appointmentStyle?.trim() ||
    readEnv(profileEnvKey(profile.id, "APPOINTMENT_STYLE")) ||
    readEnv("APPOINTMENT_STYLE") ||
    readProfileForm(profile).appointmentStyle?.trim() ||
    apiSettings.defaultAppointmentStyle
  );
}

function resolveAppointmentTypeId(
  profile: ResolvedProfile,
  apiSettings: ApiWatcherSettings,
  overrides?: ApiQueryParamOverrides,
): { id: string; label?: string } {
  const styleLabel = resolveStyleLabel(profile, apiSettings, overrides);

  const fromOverride = overrides?.appointmentTypeId?.trim();
  if (fromOverride) {
    return {
      id: fromOverride,
      label: overrides?.appointmentStyle?.trim() ?? findAppointmentStyleByTypeId(fromOverride) ?? styleLabel,
    };
  }

  const fromProfileEnv = readEnv(profileEnvKey(profile.id, "API_APPOINTMENT_TYPE_ID"));
  if (fromProfileEnv) {
    return {
      id: fromProfileEnv,
      label: findAppointmentStyleByTypeId(fromProfileEnv) ?? styleLabel,
    };
  }

  const fromGlobalTypeId = readEnv("API_APPOINTMENT_TYPE_ID");
  if (fromGlobalTypeId) {
    return {
      id: fromGlobalTypeId,
      label: findAppointmentStyleByTypeId(fromGlobalTypeId) ?? styleLabel,
    };
  }

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

  const fromOverrideLabel = overrides?.applicationType?.trim();
  if (fromOverrideLabel) {
    const id =
      resolveCatalogId(APPLICATION_TYPE_IDS, fromOverrideLabel, apiSettings.defaultApplicationTypeId) ??
      apiSettings.defaultApplicationTypeId;
    return { id, label: fromOverrideLabel };
  }

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
  const dealer = resolveDealerSelection(profile, apiSettings, overrides);

  return {
    dealerId: dealer.dealerId,
    date,
    maxDate,
    cityId: resolveCityId(profile, apiSettings, overrides),
    cityLabel: dealer.dealerOfficeLabel ?? readProfileForm(profile).appointmentCity,
    dealerOfficeLabel: dealer.dealerOfficeLabel,
    appointmentTypeId: appointmentType.id,
    appointmentStyleLabel: appointmentType.label,
    applicationTypeId: applicationType.id,
    applicationTypeLabel: applicationType.label,
    appointmentDate: resolveAppointmentDate(date, overrides),
  };
}

export function formatApiQueryParamsSummary(params: ApiQueryParams): string {
  const dealerLabel =
    params.dealerOfficeLabel ??
    params.cityLabel ??
    undefined;
  const parts = [
    `dealerId=${params.dealerId}${dealerLabel ? ` (${dealerLabel})` : ""}`,
    `date=${params.date}`,
    `maxDate=${params.maxDate}`,
    `appointmentTypeId=${params.appointmentTypeId}${params.appointmentStyleLabel ? ` (${params.appointmentStyleLabel})` : ""}`,
  ];
  return parts.join(", ");
}

export function logResolvedApiQueryParams(
  profileId: string,
  params: ApiQueryParams,
): void {
  logger.info(`[api] Sorgu parametreleri (${profileId}): ${formatApiQueryParamsSummary(params)}`);
}
