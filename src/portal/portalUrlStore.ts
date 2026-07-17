import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { logger } from "../utils/logger.js";
import type {
  PortalUrlEntry,
  PortalUrlStore,
  ResolvePortalUrlOptions,
  ResolvedPortalUrl,
} from "./portalUrlTypes.js";

const STORE_FILE = "urls.json";

export function resolvePortalUrlsDir(projectRoot: string): string {
  return resolve(projectRoot, "data/portal-urls");
}

export function resolvePortalUrlsPath(projectRoot: string): string {
  return join(resolvePortalUrlsDir(projectRoot), STORE_FILE);
}

export function loadPortalUrlStore(projectRoot: string): PortalUrlStore {
  const path = resolvePortalUrlsPath(projectRoot);
  if (!existsSync(path)) {
    return { version: 1, urls: [] };
  }

  const raw = JSON.parse(readFileSync(path, "utf-8")) as PortalUrlStore;
  if (!Array.isArray(raw.urls)) {
    throw new Error(`${path}: urls dizisi zorunlu`);
  }
  return raw;
}

/**
 * AWS awstrack / benzeri redirect URL içinden portal adresini çıkarır.
 * Örn: …/L0/https:%2F%2Fbasvuru.kosmosvize.com.tr%2Fregisterform%3Fguid=…/…
 */
export function extractPortalUrlFromTracking(trackingUrl: string): string | null {
  const trimmed = trackingUrl.trim();
  if (!trimmed) {
    return null;
  }

  const l0Match = trimmed.match(/\/L0\/([^/]+)\//i);
  if (l0Match?.[1]) {
    try {
      return decodeURIComponent(l0Match[1]);
    } catch {
      return l0Match[1];
    }
  }

  try {
    const parsed = new URL(trimmed);
    const embedded = parsed.searchParams.get("url") ?? parsed.searchParams.get("u");
    if (embedded) {
      return decodeURIComponent(embedded);
    }
  } catch {
    // ignore
  }

  return null;
}

function pickEntry(store: PortalUrlStore, options: ResolvePortalUrlOptions): PortalUrlEntry {
  const { profileId, urlId, type } = options;

  if (urlId) {
    const found = store.urls.find((u) => u.id === urlId);
    if (!found) {
      throw new Error(`Portal URL bulunamadı: id="${urlId}"`);
    }
    if (found.profileId !== profileId) {
      throw new Error(`Portal URL "${urlId}" profil ${found.profileId} için — beklenen ${profileId}`);
    }
    return found;
  }

  const candidates = store.urls.filter(
    (u) =>
      u.profileId === profileId &&
      u.status === "active" &&
      (type ? u.type === type : true),
  );

  if (candidates.length === 0) {
    throw new Error(
      `Profil "${profileId}" için active portal URL yok — data/portal-urls/urls.json kontrol edin.`,
    );
  }

  return candidates[candidates.length - 1]!;
}

function resolveGotoUrl(entry: PortalUrlEntry, prefer: "portal" | "tracking"): ResolvedPortalUrl {
  const portal = entry.portalUrl?.trim();
  const tracking = entry.trackingUrl?.trim();

  if (prefer === "portal" && portal) {
    return { entry, gotoUrl: portal, source: "portalUrl" };
  }

  if (prefer === "tracking" && tracking) {
    return { entry, gotoUrl: tracking, source: "trackingUrl" };
  }

  if (portal) {
    return { entry, gotoUrl: portal, source: "portalUrl" };
  }

  if (tracking) {
    const decoded = extractPortalUrlFromTracking(tracking);
    if (decoded) {
      return { entry, gotoUrl: decoded, source: "tracking-decoded" };
    }
    return { entry, gotoUrl: tracking, source: "trackingUrl" };
  }

  throw new Error(`Portal URL kaydı boş: id="${entry.id}" — portalUrl veya trackingUrl gerekli`);
}

export function resolvePortalUrl(
  projectRoot: string,
  options: ResolvePortalUrlOptions,
): ResolvedPortalUrl {
  const store = loadPortalUrlStore(projectRoot);
  const entry = pickEntry(store, options);
  const prefer = options.prefer ?? "portal";
  const resolved = resolveGotoUrl(entry, prefer);

  logger.info(
    `[portal-url] ${entry.id} — goto=${resolved.source} type=${entry.type} guid=${entry.guid ?? "-"}`,
  );

  return resolved;
}

export function listPortalUrlsForProfile(
  projectRoot: string,
  profileId: string,
): PortalUrlEntry[] {
  return loadPortalUrlStore(projectRoot).urls.filter((u) => u.profileId === profileId);
}
