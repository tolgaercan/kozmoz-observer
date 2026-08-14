import { loadSettings } from "../config/settings.js";
import { ChromeProfileStore } from "../control-panel/chromeProfileStore.js";
import { WorkerConfigStore } from "../control-panel/workerConfigStore.js";
import type { ProfileDefinition, ResolvedProfile } from "./profileManager.js";

export interface ProfileCredentials {
  email: string;
  password: string;
}

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

/** Panel worker-config.json — .env kullanılmaz */
export function readPanelWorkerApi(profileId: string) {
  try {
    const { projectRoot } = loadSettings(process.cwd());
    return new WorkerConfigStore(projectRoot).load().workers[profileId]?.api;
  } catch {
    return undefined;
  }
}

/** Panel chrome-profiles.json — Google / portal şifre kaynağı */
export function readPanelChromeProfile(profileId: string) {
  try {
    const { projectRoot } = loadSettings(process.cwd());
    return new ChromeProfileStore(projectRoot).get(profileId);
  } catch {
    return undefined;
  }
}

export function resolveProfileCredentials(profile: ResolvedProfile): ProfileCredentials {
  const panelApi = readPanelWorkerApi(profile.id);
  const chrome = readPanelChromeProfile(profile.id);

  const email = pickString(panelApi?.portalEmail, chrome?.chromeEmail, profile.credentials?.email);
  const password = pickString(chrome?.chromePassword, profile.credentials?.password);

  return {
    email: email ?? "",
    password: password ?? "",
  };
}

/** Chrome profil Google girişi */
export function resolveChromeGoogleEmail(profile: ResolvedProfile): string {
  const chrome = readPanelChromeProfile(profile.id);
  return pickString(chrome?.chromeEmail, profile.credentials?.email) ?? "";
}

export function resolveChromeGooglePassword(profile: ResolvedProfile): string {
  const chrome = readPanelChromeProfile(profile.id);
  return pickString(chrome?.chromePassword, profile.credentials?.password) ?? "";
}

export interface PortalIdentityVerificationData {
  /** Popup select value: bireysel | aile */
  applicationTypeValue: "bireysel" | "aile";
  /** Orijinal profil metni — Bireysel, Aile */
  applicationTypeDisplay: string;
  tckn: string;
  passportNumber: string;
}

/** «Kimlik ve Telefon Doğrulama» popup form verisi */
export function resolvePortalIdentityVerificationData(
  profile: ResolvedProfile | string,
): PortalIdentityVerificationData {
  const profileId = typeof profile === "string" ? profile : profile.id;
  const form =
    typeof profile === "string" ? undefined : (profile as ProfileDefinition).form;
  const panelApi = readPanelWorkerApi(profileId);

  const applicationTypeDisplay =
    pickString(
      panelApi?.applicationType,
      form?.applicationType,
      (profile as ProfileDefinition).applicationType,
      "Bireysel",
    ) ?? "Bireysel";

  const tckn =
    pickString(
      panelApi?.nationalityNumber,
      form?.nationalityNumber,
      (profile as ProfileDefinition).nationalityNumber,
    ) ?? "";

  const passportNumber =
    pickString(panelApi?.passportNumber, form?.passportNumber) ?? "";

  const normalized = applicationTypeDisplay.trim().toLocaleLowerCase("tr-TR");
  const applicationTypeValue = normalized.includes("aile") ? "aile" : "bireysel";

  return {
    applicationTypeValue,
    applicationTypeDisplay,
    tckn,
    passportNumber,
  };
}

/** Portal / SMS OTP — panel worker-config otpPhone */
export function resolveProfilePhone(profile: ResolvedProfile | string): string {
  const profileId = typeof profile === "string" ? profile : profile.id;
  const raw =
    typeof profile === "string"
      ? undefined
      : (profile as ProfileDefinition).form?.phone;
  const panelApi = readPanelWorkerApi(profileId);

  return pickString(panelApi?.otpPhone, raw) ?? "";
}

export interface ChromeGoogleCredentials {
  email: string;
  password: string;
  profileName: string;
}

export function resolveChromeGoogleCredentials(profile: ResolvedProfile): ChromeGoogleCredentials {
  return {
    email: resolveChromeGoogleEmail(profile),
    password: resolveChromeGooglePassword(profile),
    profileName: profile.name?.trim() || profile.id,
  };
}

export function validateProfileCredentials(
  credentials: ProfileCredentials,
  profileId: string,
  required: boolean,
): string[] {
  if (!required) {
    return [];
  }

  const errors: string[] = [];
  if (!credentials.email) {
    errors.push(`Profil "${profileId}" için email eksik (panel Worker veya Chrome profil email).`);
  }
  if (!credentials.password) {
    errors.push(`Profil "${profileId}" için şifre eksik (panel Chrome profil şifresi).`);
  }
  return errors;
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 1) {
    return "***";
  }
  return `${email.slice(0, 2)}***${email.slice(at)}`;
}
