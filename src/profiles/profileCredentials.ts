import type { AppSettings } from "../config/settings.js";
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

function resolvePerProfileEnv(profileId: string, fieldBase: string): string | undefined {
  const suffix = profileId.replace(/-/g, "_").toUpperCase();
  return process.env[`${fieldBase}_${suffix}`]?.trim();
}

export function resolveProfileCredentials(profile: ResolvedProfile): ProfileCredentials {
  const raw = profile.credentials ?? {};

  const email = pickString(
    resolvePerProfileEnv(profile.id, "EMAIL"),
    raw.email,
    process.env.PORTAL_EMAIL,
  );

  const password = pickString(
    resolvePerProfileEnv(profile.id, "PASSWORD"),
    raw.password,
    process.env.PORTAL_PASSWORD,
  );

  return {
    email: email ?? "",
    password: password ?? "",
  };
}

/** Chrome profil Google girisi — portal email'den ayri tutulabilir */
export function resolveChromeGoogleEmail(profile: ResolvedProfile): string {
  const raw = profile.credentials ?? {};
  return (
    pickString(
      resolvePerProfileEnv(profile.id, "GOOGLE_EMAIL"),
      raw.email,
      resolvePerProfileEnv(profile.id, "EMAIL"),
      process.env.GOOGLE_EMAIL,
      process.env.PORTAL_EMAIL,
    ) ?? ""
  );
}

export function resolveChromeGooglePassword(profile: ResolvedProfile): string {
  const raw = profile.credentials ?? {};
  return (
    pickString(
      resolvePerProfileEnv(profile.id, "GOOGLE_PASSWORD"),
      resolvePerProfileEnv(profile.id, "PASSWORD"),
      raw.password,
      process.env.GOOGLE_PASSWORD,
      process.env.PORTAL_PASSWORD,
    ) ?? ""
  );
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
    errors.push(`Profil "${profileId}" için email eksik (EMAIL_PROFILE_* veya credentials.email).`);
  }
  if (!credentials.password) {
    errors.push(`Profil "${profileId}" için şifre eksik (PASSWORD_PROFILE_* veya credentials.password).`);
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
