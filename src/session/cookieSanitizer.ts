import type { Cookie } from "playwright";

/** Cloudflare geçişi için gerekli çerezler */
export const CLOUDFLARE_COOKIE_NAMES = [
  "__cf_bm",
  "_cfuvid",
  "cf_clearance",
] as const;

/** Varsa tutulacak oturum çerezleri (tam eşleşme, case-insensitive) */
export const SESSION_COOKIE_NAMES = [
  "PHPSESSID",
  "ASP.NET_SessionId",
  ".AspNetCore.Session",
  "auth",
  "token",
  "session",
  "sessionid",
] as const;

/** İsteğe bağlı — uygulama tercihleri, CF bypass için gerekli değil */
export const OPTIONAL_APP_COOKIE_NAMES = ["Kosmos-language"] as const;

export interface BrowserExportCookie {
  domain: string;
  expirationDate?: number;
  hostOnly?: boolean;
  httpOnly?: boolean;
  name: string;
  path?: string;
  sameSite?: string;
  secure?: boolean;
  session?: boolean;
  storeId?: string;
  id?: number;
  value: string;
}

export interface SanitizeResult {
  cookies: Cookie[];
  kept: string[];
  skipped: string[];
  missingCloudflare: string[];
}

function mapSameSite(raw?: string): Cookie["sameSite"] {
  switch (raw?.toLowerCase()) {
    case "no_restriction":
    case "none":
      return "None";
    case "strict":
      return "Strict";
    case "lax":
    case "unspecified":
    default:
      return "Lax";
  }
}

export function isBrowserExportFormat(cookies: unknown[]): boolean {
  const first = cookies[0];
  return (
    typeof first === "object" &&
    first !== null &&
    ("storeId" in first || "expirationDate" in first || "hostOnly" in first)
  );
}

function isAllowedCookie(name: string, includeOptional = false): boolean {
  const lower = name.toLowerCase();

  if (CLOUDFLARE_COOKIE_NAMES.some((n) => n.toLowerCase() === lower)) {
    return true;
  }

  if (SESSION_COOKIE_NAMES.some((n) => n.toLowerCase() === lower)) {
    return true;
  }

  if (includeOptional && OPTIONAL_APP_COOKIE_NAMES.some((n) => n.toLowerCase() === lower)) {
    return true;
  }

  return false;
}

export function browserExportToPlaywright(raw: BrowserExportCookie): Cookie {
  const expires =
    raw.session || raw.expirationDate === undefined
      ? -1
      : Math.floor(raw.expirationDate);

  return {
    name: raw.name,
    value: raw.value,
    domain: raw.domain,
    path: raw.path ?? "/",
    expires,
    httpOnly: raw.httpOnly ?? false,
    secure: raw.secure ?? false,
    sameSite: mapSameSite(raw.sameSite),
  };
}

/**
 * Tarayıcı export'undan yalnızca CF + oturum çerezlerini ayıklar,
 * Playwright formatına dönüştürür.
 */
export function sanitizeCookies(
  rawCookies: unknown[],
  options: { includeOptional?: boolean } = {},
): SanitizeResult {
  const kept: string[] = [];
  const skipped: string[] = [];
  const cookies: Cookie[] = [];

  for (const item of rawCookies) {
    if (typeof item !== "object" || item === null || !("name" in item)) {
      continue;
    }

    const exportCookie = item as BrowserExportCookie;
    const name = exportCookie.name;

    if (!isAllowedCookie(name, options.includeOptional)) {
      skipped.push(name);
      continue;
    }

    kept.push(name);
    cookies.push(
      isBrowserExportFormat([item])
        ? browserExportToPlaywright(exportCookie)
        : (item as Cookie),
    );
  }

  const missingCloudflare = CLOUDFLARE_COOKIE_NAMES.filter(
    (cfName) => !kept.some((k) => k.toLowerCase() === cfName.toLowerCase()),
  );

  return { cookies, kept, skipped, missingCloudflare };
}

export function normalizeCookies(rawCookies: unknown[]): Cookie[] {
  if (rawCookies.length === 0) {
    return [];
  }

  if (isBrowserExportFormat(rawCookies)) {
    return sanitizeCookies(rawCookies, { includeOptional: true }).cookies;
  }

  return sanitizeCookies(rawCookies).cookies;
}
