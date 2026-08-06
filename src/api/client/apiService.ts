import type { Page } from "playwright";

import type { ApiWatcherSettings } from "../../config/settings.js";
import { resolveBearerToken } from "../auth/tokenProvider.js";
import { toBearerToken } from "../token/jwtExtractor.js";
import type { ApiQueryParams } from "./resolveApiQueryParams.js";

export interface ApiServiceContext {
  projectRoot: string;
  profileId: string;
  settings: ApiWatcherSettings;
  /** Opsiyonel override — yoksa tokenProvider */
  bearerToken?: string | null;
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /** Tam parametre seti — URL şablonundaki {placeholder} alanları doldurulur */
  queryParams?: ApiQueryParams;
  /** @deprecated queryParams.cityId kullanın */
  cityId?: string;
}

function resolveAuthorization(ctx: ApiServiceContext): string {
  const bearer =
    ctx.bearerToken?.trim() ||
    resolveBearerToken(ctx.projectRoot, ctx.profileId) ||
    "";

  if (!bearer) {
    throw new Error(
      `[api] Authorization token yok — api-auth-bootstrap çalıştırın veya .env API_BEARER_TOKEN_* tanımlayın.`,
    );
  }

  return toBearerToken(bearer);
}

export function resolveAuthorizationForContext(ctx: ApiServiceContext): string {
  return resolveAuthorization(ctx);
}

function buildUrl(template: string, params: ApiQueryParams): string {
  const replacements: Record<string, string | undefined> = {
    dealerId: params.dealerId,
    date: params.date,
    maxDate: params.maxDate,
    cityId: params.cityId,
    appointmentTypeId: params.appointmentTypeId,
    applicationTypeId: params.applicationTypeId,
    appointmentDate: params.appointmentDate,
  };

  let url = template;
  for (const [key, value] of Object.entries(replacements)) {
    const placeholder = `{${key}}`;
    if (!url.includes(placeholder)) {
      continue;
    }
    url = url.replace(placeholder, encodeURIComponent(value ?? ""));
  }
  return url;
}

export function buildApiUrl(template: string, params: ApiQueryParams): string {
  return buildUrl(template, params);
}

/** Aktif portal sekmesine göre Referer — registerForm token'ı flaky GetClosedDate üretebilir */
export function resolvePortalReferer(pageUrl: string | undefined, fallbackReferer: string): string {
  if (!pageUrl?.trim()) {
    return fallbackReferer;
  }

  try {
    const parsed = new URL(pageUrl);
    if (/\/appointmentForm\b/i.test(parsed.pathname)) {
      return `${parsed.origin}/appointmentForm`;
    }
    if (/\/registerForm\b/i.test(parsed.pathname)) {
      return `${parsed.origin}/registerForm`;
    }
    if (/basvuru\.kosmosvize\.com\.tr/i.test(parsed.hostname)) {
      return `${parsed.origin}${parsed.pathname || "/"}`;
    }
  } catch {
    // fallback
  }

  return fallbackReferer;
}

export function buildApiHeaders(
  ctx: ApiServiceContext,
  authorization: string,
  extra: Record<string, string> = {},
  refererOverride?: string,
): Record<string, string> {
  const referer = refererOverride?.trim() || ctx.settings.referer;
  return {
    Accept: "application/json, text/plain, */*",
    Authorization: authorization,
    Referer: referer,
    Origin: new URL(referer).origin,
    ...extra,
  };
}

export interface BrowserFetchResult {
  status: number;
  contentType: string;
  bodyText: string;
  networkError?: string;
}

/** Cloudflare bypass — isteği açık portal sekmesinden gönderir */
export async function apiFetchViaPage(
  page: Page,
  url: string,
  headers: Record<string, string>,
  options: ApiFetchOptions = {},
): Promise<BrowserFetchResult> {
  return page.evaluate(
    async ({ targetUrl, requestHeaders, method, body }) => {
      try {
        const response = await fetch(targetUrl, {
          method,
          headers: requestHeaders,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          credentials: "include",
          cache: "no-store",
        });
        return {
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
          bodyText: await response.text(),
        };
      } catch (error) {
        return {
          status: 0,
          contentType: "",
          bodyText: "",
          networkError: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      targetUrl: url,
      requestHeaders: headers,
      method: options.method ?? "GET",
      body: options.body,
    },
  );
}

/** Her isteğe Authorization + Referer ekleyen fetch wrapper (Node) */
export async function apiFetch(
  ctx: ApiServiceContext,
  pathOrUrl: string,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const authorization = resolveAuthorization(ctx);
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${ctx.settings.baseUrl.replace(/\/$/, "")}/${pathOrUrl.replace(/^\//, "")}`;

  const headers: Record<string, string> = {
    ...buildApiHeaders(ctx, authorization, options.headers),
    "User-Agent":
      process.env.API_USER_AGENT?.trim() ??
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  };

  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  return fetch(url, init);
}

export function closedDateUrl(ctx: ApiServiceContext, params: ApiQueryParams): string {
  return buildApiUrl(ctx.settings.getClosedDateUrl, params);
}

export function hourQuotaUrl(ctx: ApiServiceContext, params: ApiQueryParams): string {
  return buildApiUrl(ctx.settings.getHourQuotaUrl, params);
}

export function maxAppointmentDateUrl(
  ctx: ApiServiceContext,
  adminDataId: string,
): string {
  return ctx.settings.getMaxAppointmentDateUrl.replace(
    "{adminDataId}",
    encodeURIComponent(adminDataId),
  );
}
