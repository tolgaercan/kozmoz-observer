import { bootstrapFromKosmosHome } from "../../navigation/kosmosHomeEntry.js";
import { isBasvuruPortalUrl, isKosmosMarketingHome } from "../../portal/kosmosOrigin.js";
import { readStorageFile } from "../../session/sessionReader.js";
import { persistPortalStorage } from "../../session/sessionPersister.js";
import { capturePortalAuthorizationToken } from "../../api/token/networkTokenCapture.js";
import { extractJwtFromStorage } from "../../api/token/jwtExtractor.js";
import {
  bearerFromRecord,
  loadApiToken,
  saveApiToken,
} from "../../api/token/tokenStore.js";
import {
  resolveBearerToken,
  setRuntimeBearerToken,
} from "../../api/auth/tokenProvider.js";
import { logger } from "../../utils/logger.js";
import type { ScenarioRuntime } from "../scenarioRuntime.js";
import type { ScenarioStepParams } from "../types.js";

export interface ApiAuthBootstrapResult {
  ok: boolean;
  detail: string;
}

/**
 * Phase: api-auth-bootstrap
 * Kosmos ana sayfa → registerform → Authorization/JWT yakala → api-token.json + RAM
 */
export async function runApiAuthBootstrapPhase(
  runtime: ScenarioRuntime,
  params?: ScenarioStepParams,
): Promise<ApiAuthBootstrapResult> {
  if (!runtime.session) {
    return { ok: false, detail: "CDP oturumu gerekli — önce chrome-login" };
  }

  const { page, context } = runtime.session;
  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
  const sessionPaths = runtime.profileManager.toSessionPaths(profile);
  const apiSettings = runtime.settings.apiWatcher;

  let activePage = page;

  const appointmentTab = context.pages().find(
    (candidate) => !candidate.isClosed() && /\/appointmentForm\b/i.test(candidate.url()),
  );
  if (appointmentTab) {
    activePage = appointmentTab;
    runtime.session.page = activePage;
    logger.info(`[api-auth] appointmentForm sekmesi kullanılıyor: ${activePage.url()}`);
  } else if (
    !isBasvuruPortalUrl(activePage.url()) &&
    !isKosmosMarketingHome(activePage.url())
  ) {
    const homeUrl = runtime.settings.visaPortalHomeUrl.replace(/\/registerform\/?$/i, "/");
    logger.info(`[api-auth] Portal sekmesi yok — ana sayfaya gidiliyor: ${homeUrl}`);
    await activePage.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }

  if (isKosmosMarketingHome(activePage.url())) {
    logger.info("[api-auth] Kosmos ana sayfa — registerform'a geçiliyor.");
    activePage = await bootstrapFromKosmosHome(activePage, context, runtime.settings);
    runtime.session.page = activePage;
  }

  if (!isBasvuruPortalUrl(activePage.url())) {
    const registerUrl =
      process.env.PORTAL_REGISTER_FORM_URL?.trim() ??
      "https://basvuru.kosmosvize.com.tr/registerform";
    logger.info(`[api-auth] Register sayfasına gidiliyor: ${registerUrl}`);
    await activePage.goto(registerUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } else {
    logger.info(`[api-auth] Portal sekmesi kullanılıyor: ${activePage.url()}`);
  }

  await persistPortalStorage(activePage, sessionPaths.storageFile);

  const captured = await capturePortalAuthorizationToken(
    activePage,
    context,
    apiSettings.tokenCaptureWaitMs,
  );

  if (captured) {
    const record = saveApiToken(
      runtime.projectRoot,
      profile.id,
      captured.token,
      captured.source,
    );
    setRuntimeBearerToken(record.authorization);
    return {
      ok: true,
      detail: `Token kaydedildi (${record.source}, ${record.authorization.slice(0, 12)}…)`,
    };
  }

  const storage = readStorageFile(sessionPaths.storageFile);
  const fromFile = extractJwtFromStorage(storage);
  if (fromFile) {
    const record = saveApiToken(runtime.projectRoot, profile.id, fromFile, "storage-file");
    setRuntimeBearerToken(record.authorization);
    return {
      ok: true,
      detail: `Token storage.json'dan (${record.authorization.slice(0, 12)}…)`,
    };
  }

  const cached = loadApiToken(runtime.projectRoot, profile.id);
  if (cached) {
    setRuntimeBearerToken(cached.authorization);
    return {
      ok: true,
      detail: `Önceki api-token.json kullanılıyor (${cached.capturedAt})`,
    };
  }

  const fromEnv = resolveBearerToken(runtime.projectRoot, profile.id);
  if (fromEnv) {
    return {
      ok: true,
      detail: "Token .env / RAM'den yüklendi",
    };
  }

  return {
    ok: false,
    detail: "Authorization/JWT bulunamadi — registerform oturumu acik olmali",
  };
}

export function getBearerTokenForProfile(runtime: ScenarioRuntime): string | null {
  return resolveBearerToken(runtime.projectRoot, runtime.profileId);
}

/**
 * appointmentForm / portal sekmesinden JWT yenile — UI oturumu açıkken hızlı yol.
 * Navigasyon yapmaz; localStorage + kısa network dinlemesi.
 */
export async function tryRefreshTokenFromActivePage(
  runtime: ScenarioRuntime,
): Promise<string | null> {
  const session = runtime.session;
  if (!session?.context) {
    return null;
  }

  const pages = session.context.pages().filter((candidate) => !candidate.isClosed());
  let page =
    pages.find((candidate) => /\/appointmentForm\b/i.test(candidate.url())) ??
    (session.page && !session.page.isClosed() ? session.page : pages[0]);

  if (!page || page.isClosed() || !isBasvuruPortalUrl(page.url())) {
    return null;
  }

  session.page = page;

  const { context } = session;

  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
  const sessionPaths = runtime.profileManager.toSessionPaths(profile);

  logger.info(`[api-auth] Aktif portal sekmesinden JWT yenileniyor: ${page.url()}`);
  await persistPortalStorage(page, sessionPaths.storageFile);

  const storage = readStorageFile(sessionPaths.storageFile);
  const fromStorage = extractJwtFromStorage(storage);
  if (fromStorage) {
    const record = saveApiToken(runtime.projectRoot, profile.id, fromStorage, "localStorage");
    setRuntimeBearerToken(record.authorization);
    logger.info("[api-auth] JWT localStorage'dan yenilendi.");
    return record.authorization;
  }

  const captured = await capturePortalAuthorizationToken(page, context, 5_000);
  if (captured) {
    const record = saveApiToken(
      runtime.projectRoot,
      profile.id,
      captured.token,
      captured.source,
    );
    setRuntimeBearerToken(record.authorization);
    logger.info(`[api-auth] JWT yakalandi (${captured.source}).`);
    return record.authorization;
  }

  return null;
}
