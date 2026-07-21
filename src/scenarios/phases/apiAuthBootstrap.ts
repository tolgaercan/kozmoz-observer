import { bootstrapFromKosmosHome } from "../../navigation/kosmosHomeEntry.js";
import { isBasvuruPortalUrl, isKosmosMarketingHome } from "../../portal/kosmosOrigin.js";
import { readStorageFile } from "../../session/sessionReader.js";
import { persistPortalStorage } from "../../session/sessionPersister.js";
import { capturePortalAuthorizationToken } from "../../api/token/networkTokenCapture.js";
import { extractJwtFromStorage } from "../../api/token/jwtExtractor.js";
import {
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

function isApiOnlyMode(params?: ScenarioStepParams): boolean {
  return params?.apiOnly === true || params?.noNavigate === true;
}

async function readTokenFromPortalPage(
  runtime: ScenarioRuntime,
  page: import("playwright").Page,
): Promise<string | null> {
  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
  const sessionPaths = runtime.profileManager.toSessionPaths(profile);

  await persistPortalStorage(page, sessionPaths.storageFile);
  const storage = readStorageFile(sessionPaths.storageFile);
  return extractJwtFromStorage(storage);
}

/**
 * apiOnly: navigasyon yok — açık portal sekmesinden / cache'den JWT oku.
 */
async function runApiAuthBootstrapPassive(
  runtime: ScenarioRuntime,
): Promise<ApiAuthBootstrapResult> {
  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);

  const cached = loadApiToken(runtime.projectRoot, profile.id);
  if (cached) {
    setRuntimeBearerToken(cached.authorization);
    return {
      ok: true,
      detail: `api-token.json (${cached.capturedAt}) — navigasyon yok`,
    };
  }

  const fromEnv = resolveBearerToken(runtime.projectRoot, profile.id);
  if (fromEnv) {
    return { ok: true, detail: "Token .env / RAM — navigasyon yok" };
  }

  if (!runtime.session?.context) {
    return { ok: false, detail: "CDP oturumu gerekli" };
  }

  const { context } = runtime.session;
  const portalPages = context.pages().filter(
    (candidate) => !candidate.isClosed() && isBasvuruPortalUrl(candidate.url()),
  );

  for (const candidate of portalPages) {
    runtime.session.page = candidate;
    const jwt = await readTokenFromPortalPage(runtime, candidate);
    if (jwt) {
      const record = saveApiToken(runtime.projectRoot, profile.id, jwt, "localStorage");
      setRuntimeBearerToken(record.authorization);
      logger.info(`[api-auth] JWT okundu (${candidate.url()}) — navigasyon yok`);
      return {
        ok: true,
        detail: `Token localStorage (${new URL(candidate.url()).pathname}) — navigasyon yok`,
      };
    }
  }

  const marketingPage = context.pages().find(
    (candidate) => !candidate.isClosed() && isKosmosMarketingHome(candidate.url()),
  );
  if (marketingPage) {
    runtime.session.page = marketingPage;
    logger.info(
      `[api-auth] Portal home açık (${marketingPage.url()}) — JWT için basvuru sekmesi gerekli`,
    );
  }

  return {
    ok: false,
    detail:
      "JWT bulunamadi — once portalda giris yapin (apiOnly: sayfa degistirilmedi). basvuru.kosmosvize.com.tr acik olmali.",
  };
}

/**
 * Phase: api-auth-bootstrap
 * Varsayilan (apiOnly): cache / acik sekme JWT — navigasyon yok.
 * Tam mod: Kosmos ana sayfa → registerform → token yakala.
 */
export async function runApiAuthBootstrapPhase(
  runtime: ScenarioRuntime,
  params?: ScenarioStepParams,
): Promise<ApiAuthBootstrapResult> {
  if (!runtime.session) {
    return { ok: false, detail: "CDP oturumu gerekli — önce chrome-login" };
  }

  if (isApiOnlyMode(params)) {
    logger.info("[api-auth] apiOnly modu — navigasyon atlandi, mevcut oturum kullaniliyor.");
    return runApiAuthBootstrapPassive(runtime);
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
 * appointmentForm / portal sekmesinden JWT yenile — navigasyon yapmaz.
 */
export async function tryRefreshTokenFromActivePage(
  runtime: ScenarioRuntime,
): Promise<string | null> {
  const session = runtime.session;
  if (!session?.context) {
    return null;
  }

  const pages = session.context.pages().filter((candidate) => !candidate.isClosed());
  const candidates = [
    ...pages.filter((candidate) => /\/appointmentForm\b/i.test(candidate.url())),
    ...pages.filter((candidate) => isBasvuruPortalUrl(candidate.url())),
    ...(session.page && !session.page.isClosed() ? [session.page] : []),
  ];

  const seen = new Set<import("playwright").Page>();
  for (const page of candidates) {
    if (seen.has(page) || page.isClosed() || !isBasvuruPortalUrl(page.url())) {
      continue;
    }
    seen.add(page);
    session.page = page;

    const jwt = await readTokenFromPortalPage(runtime, page);
    if (jwt) {
      const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
      const record = saveApiToken(runtime.projectRoot, profile.id, jwt, "localStorage");
      setRuntimeBearerToken(record.authorization);
      logger.info(`[api-auth] JWT yenilendi (${page.url()}).`);
      return record.authorization;
    }

    const captured = await capturePortalAuthorizationToken(page, session.context, 5_000);
    if (captured) {
      const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
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
  }

  return null;
}
