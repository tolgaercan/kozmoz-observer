import type { Page } from "playwright";

import { loadSettings } from "../../config/settings.js";
import { ProfileManager } from "../../profiles/profileManager.js";
import { extractJwtFromStorage } from "../token/jwtExtractor.js";
import { bearerFromRecord, saveApiToken } from "../token/tokenStore.js";
import { persistPortalStorage, readPortalLocalStorage } from "../../session/sessionPersister.js";
import { logger } from "../../utils/logger.js";
import { setRuntimeBearerToken } from "./tokenProvider.js";

/** Poll öncesi sayfadaki güncel JWT'yi storage'a yazar ve runtime bearer'ı günceller. */
export async function refreshBearerFromPortalPage(
  projectRoot: string,
  profileId: string,
  page: Page,
): Promise<string | null> {
  const settings = loadSettings(projectRoot);
  const profileManager = new ProfileManager(projectRoot, settings.manifestPath);
  const profile = profileManager.resolveProfile(profileId, settings);
  const sessionPaths = profileManager.toSessionPaths(profile);

  await persistPortalStorage(page, sessionPaths.storageFile);
  const storage = await readPortalLocalStorage(page);
  const jwt = extractJwtFromStorage(storage);
  if (!jwt) {
    logger.warn("[api-auth] Poll oncesi JWT bulunamadi — mevcut token kullanilacak.");
    return null;
  }

  const record = saveApiToken(projectRoot, profileId, jwt, "localStorage");
  const bearer = bearerFromRecord(record);
  setRuntimeBearerToken(bearer);
  logger.info("[api-auth] Poll oncesi JWT sayfadan yenilendi.");
  return bearer;
}
