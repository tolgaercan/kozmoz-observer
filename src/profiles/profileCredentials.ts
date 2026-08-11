import { loadSettings } from "../config/settings.js";
import { WorkerConfigStore } from "../control-panel/workerConfigStore.js";
import type { ProfileDefinition, ResolvedProfile } from "./profileManager.js";

const ENV_PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

export interface ProfileCredentials {
  email: string;
  password: string;
}

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

function readPanelWorkerApi(profileId: string) {
  try {
    const { projectRoot } = loadSettings(process.cwd());
    return new WorkerConfigStore(projectRoot).load().workers[profileId]?.api;
  } catch {
    return undefined;
  }
}

export function resolveProfileCredentials(profile: ResolvedProfile): ProfileCredentials {
  const raw = profile.credentials ?? {};
  const panelApi = readPanelWorkerApi(profile.id);

  const email = pickString(panelApi?.portalEmail, raw.email);

  const password = pickString(raw.password);

  return {
    email: email ?? "",
    password: password ?? "",
  };
}

/** Chrome profil Google girisi — portal email'den ayri tutulabilir */
export function resolveChromeGoogleEmail(profile: ResolvedProfile): string {
  const raw = profile.credentials ?? {};
  return pickString(raw.email) ?? "";
}

export function resolveChromeGooglePassword(profile: ResolvedProfile): string {
  const raw = profile.credentials ?? {};
  return pickString(raw.password) ?? "";
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
      form?.applicationType,
      (profile as ProfileDefinition).applicationType,
      panelApi?.applicationType,
      "Bireysel",
    ) ?? "Bireysel";

  const tckn =
    pickString(
      form?.nationalityNumber,
      (profile as ProfileDefinition).nationalityNumber,
      panelApi?.nationalityNumber,
    ) ?? "";

  const passportNumber =
    pickString(form?.passportNumber, panelApi?.passportNumber) ?? "";

  const normalized = applicationTypeDisplay.trim().toLocaleLowerCase("tr-TR");
  const applicationTypeValue = normalized.includes("aile") ? "aile" : "bireysel";

  return {
    applicationTypeValue,
    applicationTypeDisplay,
    tckn,
    passportNumber,
  };
}

/** Portal / SMS OTP — panel worker-config (form.phone veya otpPhone) */
export function resolveProfilePhone(profile: ResolvedProfile | string): string {
  const profileId = typeof profile === "string" ? profile : profile.id;
  const raw =
    typeof profile === "string"
      ? undefined
      : (profile as ProfileDefinition).form?.phone;
  const panelApi = readPanelWorkerApi(profileId);

  return pickString(raw, panelApi?.otpPhone) ?? "";
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
    errors.push(`Profil "${profileId}" için email eksik (panel Worker veya credentials.email).`);
  }
  if (!credentials.password) {
    errors.push(`Profil "${profileId}" için şifre eksik (Chrome profil şifresi veya credentials.password).`);
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
