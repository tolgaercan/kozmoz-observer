import type { StorageEntries } from "../../session/sessionReader.js";

/** localStorage / storage.json içinden JWT (eyJ…) bulur */
export function extractJwtFromStorage(entries: StorageEntries): string | null {
  for (const value of Object.values(entries)) {
    const trimmed = value.trim();
    if (trimmed.startsWith("eyJ") && trimmed.length > 40) {
      return trimmed;
    }
  }
  return null;
}

export function toBearerToken(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed;
  }
  return `Bearer ${trimmed}`;
}

export function stripBearerPrefix(header: string): string {
  return header.replace(/^Bearer\s+/i, "").trim();
}
