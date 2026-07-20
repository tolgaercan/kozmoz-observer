import { loadApiToken, bearerFromRecord } from "../token/tokenStore.js";
import { toBearerToken, stripBearerPrefix } from "../token/jwtExtractor.js";

/** RAM — login / api-auth-bootstrap sonrası token (hardcode yok) */
let runtimeBearer: string | null = null;

export function setRuntimeBearerToken(token: string | null): void {
  runtimeBearer = token?.trim() ? toBearerToken(token) : null;
}

export function getRuntimeBearerToken(): string | null {
  return runtimeBearer;
}

/** Öncelik: RAM → api-token.json → .env API_BEARER_TOKEN / API_JWT */
export function resolveBearerToken(projectRoot: string, profileId: string): string | null {
  if (runtimeBearer) {
    return runtimeBearer;
  }

  const fromFile = loadApiToken(projectRoot, profileId);
  if (fromFile) {
    runtimeBearer = bearerFromRecord(fromFile);
    return runtimeBearer;
  }

  const suffix = profileId.replace(/-/g, "_").toUpperCase();
  const perProfile = process.env[`API_BEARER_TOKEN_${suffix}`]?.trim();
  if (perProfile) {
    runtimeBearer = toBearerToken(perProfile);
    return runtimeBearer;
  }

  const global = process.env.API_BEARER_TOKEN?.trim() ?? process.env.API_JWT?.trim();
  if (global) {
    runtimeBearer = toBearerToken(global);
    return runtimeBearer;
  }

  return null;
}

export function rawJwtFromBearer(bearer: string): string {
  return stripBearerPrefix(bearer);
}
