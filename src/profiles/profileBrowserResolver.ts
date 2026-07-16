import { resolve } from "node:path";

import type { AppSettings } from "../config/settings.js";
import type { ProfileDefinition, ResolvedProfile } from "./profileManager.js";

export function shouldUseManifestBrowserProfile(
  settings: AppSettings | undefined,
): boolean {
  if (!settings) {
    return true;
  }
  if (settings.browserConnectMethod !== "cdp") {
    return settings.browserMode === "isolated";
  }
  if (settings.browserMode === "isolated") {
    return true;
  }
  return settings.cdpUseManifestProfile;
}

export function resolveProfileBrowserPaths(
  projectRoot: string,
  profile: ProfileDefinition,
  settings?: AppSettings,
): Pick<ResolvedProfile, "absoluteUserDataDir" | "absoluteCookiesFile" | "absoluteStorageFile" | "cdpEndpoint"> {
  const useManifest = shouldUseManifestBrowserProfile(settings);

  const userDataRelative = profile.browser?.userDataDir ?? profile.userDataDir;
  const cookiesRelative = profile.session?.cookiesFile ?? profile.cookiesFile;
  const storageRelative = profile.session?.storageFile ?? profile.storageFile;
  const cdpPort = profile.browser?.cdpPort ?? settings?.cdpPort ?? 9222;

  const absoluteUserDataDir = useManifest
    ? resolve(projectRoot, userDataRelative)
    : settings?.fixedBrowser?.profilePath ?? resolve(projectRoot, userDataRelative);

  return {
    absoluteUserDataDir,
    absoluteCookiesFile: resolve(projectRoot, cookiesRelative),
    absoluteStorageFile: resolve(projectRoot, storageRelative),
    cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
  };
}
