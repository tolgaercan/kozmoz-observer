import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { ApiTokenRecord } from "../types.js";
import { stripBearerPrefix, toBearerToken } from "./jwtExtractor.js";

export function resolveApiTokenPath(projectRoot: string, profileId: string): string {
  return resolve(projectRoot, "data/sessions", profileId, "api-token.json");
}

export function loadApiToken(projectRoot: string, profileId: string): ApiTokenRecord | null {
  const path = resolveApiTokenPath(projectRoot, profileId);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ApiTokenRecord;
    if (!parsed.authorization?.trim()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveApiToken(
  projectRoot: string,
  profileId: string,
  authorization: string,
  source: ApiTokenRecord["source"],
): ApiTokenRecord {
  const path = resolveApiTokenPath(projectRoot, profileId);
  mkdirSync(dirname(path), { recursive: true });

  const record: ApiTokenRecord = {
    authorization: stripBearerPrefix(authorization),
    capturedAt: new Date().toISOString(),
    source,
    profileId,
  };

  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
  return record;
}

export function bearerFromRecord(record: ApiTokenRecord): string {
  return toBearerToken(record.authorization);
}
