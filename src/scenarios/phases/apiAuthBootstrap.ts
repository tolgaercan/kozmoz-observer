import {
  gotoKosmosMarketingHome,
} from "../../navigation/kosmosHomeEntry.js";
import { ensurePortalAppointmentEntry } from "../../navigation/ensurePortalAppointmentEntry.js";
import { resolveAppointmentFormUrl } from "../../navigation/kosmosPortalNav.js";
import { detectManualAuthStep } from "../../auth/authStepDetector.js";
import { detectIntervention } from "../../challenge/interventionDetector.js";
import { isGoogleHomePage } from "../../auth/chromeGoogleBootstrap.js";
import { isBasvuruPortalUrl, isKosmosMarketingHome, isKosmosPortalUrl } from "../../portal/kosmosOrigin.js";
import { waitForManualPortalTab, findBasvuruPortalTab } from "../../browser/cdpConnector.js";
import { readStorageFile } from "../../session/sessionReader.js";
import { persistPortalStorage, readPortalLocalStorage } from "../../session/sessionPersister.js";
import { extractJwtFromStorage, stripBearerPrefix } from "../../api/token/jwtExtractor.js";
import type { ApiWatcherSettings } from "../../config/settings.js";
import {
  loadApiToken,
  saveApiToken,
} from "../../api/token/tokenStore.js";
import {
  resolveBearerToken,
  setRuntimeBearerToken,
} from "../../api/auth/tokenProvider.js";
import { TelegramNotifier } from "../../notifications/telegramNotifier.js";
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

function skipTokenCache(params?: ScenarioStepParams): boolean {
  return params?.skipTokenCache === true || params?.forceNavigate === true;
}

function isBlankOrOffPortal(url: string): boolean {
  const trimmed = url.trim();
  return (
    !trimmed ||
    trimmed === "about:blank" ||
    (!isKosmosPortalUrl(trimmed) && !isGoogleHomePage(trimmed))
  );
}

function shouldAllowPortalGotoFallback(
  runtime: ScenarioRuntime,
  params?: ScenarioStepParams,
): boolean {
  if (params?.allowGotoFallback === true || params?.forceNavigate === true) {
    return true;
  }
  if (process.env.PANEL_MANAGED_PORTAL_FLOW === "true") {
    return true;
  }
  return !runtime.banSafe;
}

function isPanelManagedPortalFlow(params?: ScenarioStepParams): boolean {
  return params?.panelPortalFlow === true || process.env.PANEL_MANAGED_PORTAL_FLOW === "true";
}

async function resolvePortalBootstrapPage(
  runtime: ScenarioRuntime,
): Promise<import("playwright").Page> {
  const { page, context } = runtime.session!;
  const candidates = context.pages().filter((candidate) => !candidate.isClosed());

  const portalPage = candidates.find(
    (candidate) =>
      isBasvuruPortalUrl(candidate.url()) || isKosmosMarketingHome(candidate.url()),
  );
  if (portalPage) {
    await portalPage.bringToFront();
    runtime.session!.page = portalPage;
    return portalPage;
  }

  let activePage = page;
  if (isBlankOrOffPortal(activePage.url()) || isGoogleHomePage(activePage.url())) {
    await gotoKosmosMarketingHome(activePage);
  }

  runtime.session!.page = activePage;
  return activePage;
}

/**
 * Kosmos ana sayfa → DUYURU kapat → basvuru portalı → JWT (panel ortak akis).
 */
export async function runPortalBootstrapForJwt(
  runtime: ScenarioRuntime,
  params?: ScenarioStepParams,
): Promise<ApiAuthBootstrapResult> {
  if (!runtime.session?.context) {
    return { ok: false, detail: "CDP oturumu gerekli" };
  }

  const { context } = runtime.session;
  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
  const sessionPaths = runtime.profileManager.toSessionPaths(profile);
  const apiSettings = runtime.settings.apiWatcher;
  const allowGotoFallback = shouldAllowPortalGotoFallback(runtime, params);

  logger.info(
    `[api-auth] Otomatik portal akisi basliyor (gotoFallback=${allowGotoFallback ? "acik" : "kapali"}).`,
  );

  let activePage = await resolvePortalBootstrapPage(runtime);

  const entry = await ensurePortalAppointmentEntry(activePage, context, runtime.settings, {
    allowGotoFallback,
    maxRounds: 8,
  });
  activePage = entry.page;
  runtime.session.page = activePage;

  if (!entry.ok) {
    logger.warn(`[api-auth] Portal girisi kismen: ${entry.reason ?? entry.step ?? "?"}`);
  }

  const jwt = await readTokenFromPortalPage(runtime, activePage);
  if (jwt) {
    const record = saveApiToken(runtime.projectRoot, profile.id, jwt, "localStorage");
    setRuntimeBearerToken(record.authorization);
    return {
      ok: true,
      detail: `Token localStorage (${activePage.url()}) — otomatik portal akisi`,
    };
  }

  if (isBasvuruPortalUrl(activePage.url()) || /\/appointmentForm\b/i.test(activePage.url())) {
    const captured = await waitForPortalJwtSession(
      runtime,
      activePage,
      context,
      apiSettings,
      Math.max(apiSettings.tokenCaptureWaitMs, 180_000),
    );
    if (captured) {
      await persistPortalStorage(activePage, sessionPaths.storageFile);
      const record = saveApiToken(
        runtime.projectRoot,
        profile.id,
        captured.token,
        captured.source,
      );
      setRuntimeBearerToken(record.authorization);
      return {
        ok: true,
        detail: `Token kaydedildi (${captured.source}) — otomatik portal akisi`,
      };
    }
  }

  return {
    ok: false,
    detail:
      entry.reason ??
      "Portal akisi tamamlanamadi — appointmentForm girisi (sifre/OTP) bekleniyor",
  };
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

function manualAuthTelegramReason(kind: import("../../auth/authStepDetector.js").ManualAuthState["kind"]): string {
  switch (kind) {
    case "otp":
      return "Portal OTP kodu girin — JWT oluşunca API Watcher devam edecek";
    case "login_and_otp":
      return "Şifre + OTP ile giriş yapın — JWT oluşunca API Watcher devam edecek";
    case "login":
      return "Portal şifresi ile giriş yapın — JWT oluşunca API Watcher devam edecek";
    default:
      return "Portal girişi tamamlayın — JWT oluşunca API Watcher devam edecek";
  }
}

/** appointmentForm — sifre/OTP/challenge sonrasi JWT bekle (30 dk'ya kadar) */
async function waitForPortalJwtSession(
  runtime: ScenarioRuntime,
  page: import("playwright").Page,
  context: import("playwright").BrowserContext,
  apiSettings: ApiWatcherSettings,
  maxWaitOverrideMs?: number,
): Promise<{ token: string; source: "network" | "localStorage" } | null> {
  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
  const telegram = new TelegramNotifier(runtime.settings.telegram);
  const maxWaitMs =
    maxWaitOverrideMs ??
    Math.max(apiSettings.tokenCaptureWaitMs, runtime.settings.intervention.loginMaxWaitMs);
  let authNotified = false;
  let challengeNotified = false;
  let networkToken: string | null = null;
  const started = Date.now();

  const onRequest = (request: { headers: () => Record<string, string> }): void => {
    const auth = request.headers().authorization;
    if (auth?.trim()) {
      networkToken = stripBearerPrefix(auth);
    }
  };

  context.on("request", onRequest);

  try {
    while (Date.now() - started < maxWaitMs) {
      if (networkToken) {
        logger.info("[api-auth] Authorization header yakalandi (network).");
        return { token: networkToken, source: "network" };
      }

      const storage = await readPortalLocalStorage(page);
      const jwt = extractJwtFromStorage(storage);
      if (jwt) {
        logger.info("[api-auth] JWT localStorage'dan alindi.");
        return { token: jwt, source: "localStorage" };
      }

      const manualAuth = await detectManualAuthStep(page);
      if (manualAuth.required && !authNotified) {
        authNotified = true;
        const reason = manualAuthTelegramReason(manualAuth.kind);
        logger.warn(`[api-auth] Manuel giris bekleniyor (${manualAuth.kind}): ${page.url()}`);
        if (telegram.isConfigured()) {
          await telegram.notifyManualHelpRequired({
            profileId: profile.id,
            url: page.url(),
            reason,
          });
        }
      }

      const intervention = await detectIntervention(page);
      if (intervention.type === "challenge" && !challengeNotified) {
        challengeNotified = true;
        logger.warn("[api-auth] Cloudflare/doğrulama bekleniyor.");
        if (telegram.isConfigured()) {
          await telegram.notifyInterventionRequired("challenge", {
            profileId: profile.id,
            url: page.url(),
            title: await page.title().catch(() => "—"),
            reasons: intervention.reasons,
          });
        }
      }

      await page.waitForTimeout(1500);
    }
  } finally {
    context.off("request", onRequest);
  }

  logger.warn(`[api-auth] JWT zaman aşımı (${Math.round(maxWaitMs / 1000)}s).`);
  if (telegram.isConfigured()) {
    await telegram.notifyManualHelpRequired({
      profileId: profile.id,
      url: page.url(),
      reason: "JWT alınamadı — appointmentForm girişi (şifre/OTP) tamamlanmadı veya süre doldu",
    });
  }
  return null;
}

/**
 * apiOnly: navigasyon yok — açık portal sekmesinden / cache'den JWT oku.
 */
async function runApiAuthBootstrapPassive(
  runtime: ScenarioRuntime,
  params?: ScenarioStepParams,
): Promise<ApiAuthBootstrapResult> {
  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);

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

  if (!skipTokenCache(params)) {
    const cached = loadApiToken(runtime.projectRoot, profile.id);
    if (cached) {
      setRuntimeBearerToken(cached.authorization);
      logger.info(`[api-auth] api-token.json cache kullaniliyor (${cached.capturedAt})`);
      return {
        ok: true,
        detail: `Token cache (${cached.capturedAt}) — navigasyon yok`,
      };
    }
  }

  const marketingPage = context.pages().find(
    (candidate) => !candidate.isClosed() && isKosmosMarketingHome(candidate.url()),
  );
  if (marketingPage) {
    runtime.session.page = marketingPage;
    logger.info(
      `[api-auth] Kosmos ana sayfa açık (${marketingPage.url()}) — registerform gerekli`,
    );
  }

  return {
    ok: false,
    detail:
      "JWT bulunamadi — portal ana sayfasina gidilecek (about:blank veya oturum yok).",
  };
}

/** Kosmos ana sayfa → appointmentForm → JWT bekle (sifre/OTP dahil) */
async function runApiAuthBootstrapActive(
  runtime: ScenarioRuntime,
  params?: ScenarioStepParams,
): Promise<ApiAuthBootstrapResult> {
  const { page, context } = runtime.session!;
  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
  const sessionPaths = runtime.profileManager.toSessionPaths(profile);
  const apiSettings = runtime.settings.apiWatcher;
  const appointmentUrl = resolveAppointmentFormUrl(runtime.settings.visaPortalHomeUrl);

  let activePage = page;

  const appointmentTab = context.pages().find(
    (candidate) => !candidate.isClosed() && /\/appointmentForm\b/i.test(candidate.url()),
  );
  if (appointmentTab) {
    activePage = appointmentTab;
    runtime.session!.page = activePage;
    logger.info(`[api-auth] appointmentForm sekmesi kullanılıyor: ${activePage.url()}`);
  } else if (
    isBlankOrOffPortal(activePage.url()) ||
    (!isBasvuruPortalUrl(activePage.url()) && !isKosmosMarketingHome(activePage.url()))
  ) {
    await gotoKosmosMarketingHome(activePage);
    runtime.session!.page = activePage;
  }

  if (!/\/appointmentForm\b/i.test(activePage.url())) {
    logger.info(`[api-auth] appointmentForm'a gidiliyor: ${appointmentUrl}`);
    await activePage.goto(appointmentUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    runtime.session!.page = activePage;
  } else {
    logger.info(`[api-auth] appointmentForm sekmesi: ${activePage.url()}`);
  }

  runtime.session!.page = activePage;

  const captured = await waitForPortalJwtSession(runtime, activePage, context, apiSettings);

  if (captured) {
    await persistPortalStorage(activePage, sessionPaths.storageFile);
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

  await persistPortalStorage(activePage, sessionPaths.storageFile);
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

  if (!skipTokenCache(params)) {
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
  }

  return {
    ok: false,
    detail: "Authorization/JWT bulunamadi — appointmentForm girisi (sifre/OTP) tamamlanmali",
  };
}

function allowActiveAuthNavigation(runtime: ScenarioRuntime, params?: ScenarioStepParams): boolean {
  if (params?.forceNavigate === true) {
    return true;
  }
  if (runtime.banSafe) {
    return false;
  }
  return process.env.API_AUTO_OPEN_PORTAL_TAB === "true";
}

function manualAuthRequiredDetail(): string {
  return (
    "Portal UI adimi tamamlanmadi — panel Chrome'unda elle appointmentForm acip giris yapin, " +
    "sonra watcher'i yeniden baslatin (otomatik navigasyon kapali)."
  );
}

/** @deprecated runPortalBootstrapForJwt kullanin */
async function tryHumanPortalEntryForJwt(
  runtime: ScenarioRuntime,
  params?: ScenarioStepParams,
): Promise<ApiAuthBootstrapResult | null> {
  if (!runtime.settings.apiWatcher.apiWizardAutoNavigate || !runtime.session?.context) {
    return null;
  }
  const result = await runPortalBootstrapForJwt(runtime, params);
  return result.ok ? result : null;
}

/** banSafe: portali kullanicinin acmasini bekle, JWT yakala — page.goto yok */
async function waitForManualPortalJwt(
  runtime: ScenarioRuntime,
): Promise<ApiAuthBootstrapResult> {
  const { context } = runtime.session!;
  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
  const apiSettings = runtime.settings.apiWatcher;
  const maxWaitMs = runtime.settings.intervention.loginMaxWaitMs;

  logger.info(
    `[api-auth] UI → token sirasi: portal sekmesi bekleniyor (max ${Math.round(maxWaitMs / 60_000)} dk)…`,
  );

  const tab = await waitForManualPortalTab(context, maxWaitMs);
  if (tab.blocked) {
    return {
      ok: false,
      detail: "Cloudflare block — birkac saat bekleyip portali elle acmayi deneyin.",
    };
  }
  if (!tab.onPortal) {
    return { ok: false, detail: manualAuthRequiredDetail() };
  }

  runtime.session!.page = tab.page;

  const jwt = await readTokenFromPortalPage(runtime, tab.page);
  if (jwt) {
    const record = saveApiToken(runtime.projectRoot, profile.id, jwt, "localStorage");
    setRuntimeBearerToken(record.authorization);
    return {
      ok: true,
      detail: `Token localStorage (${tab.page.url()}) — UI adimi tamam`,
    };
  }

  const captured = await waitForPortalJwtSession(
    runtime,
    tab.page,
    context,
    apiSettings,
    Math.min(maxWaitMs, 120_000),
  );
  if (captured) {
    const sessionPaths = runtime.profileManager.toSessionPaths(profile);
    await persistPortalStorage(tab.page, sessionPaths.storageFile);
    const record = saveApiToken(
      runtime.projectRoot,
      profile.id,
      captured.token,
      captured.source,
    );
    setRuntimeBearerToken(record.authorization);
    return {
      ok: true,
      detail: `Token kaydedildi (${captured.source}) — UI adimi tamam`,
    };
  }

  return { ok: false, detail: manualAuthRequiredDetail() };
}

/**
 * Phase: api-auth-bootstrap
 * apiOnly: önce cache/sekme; JWT yoksa Kosmos ana sayfa → appointmentForm → sifre/OTP bekle.
 * Tam mod: doğrudan navigasyon + token yakala.
 */
export async function runApiAuthBootstrapPhase(
  runtime: ScenarioRuntime,
  params?: ScenarioStepParams,
): Promise<ApiAuthBootstrapResult> {
  if (!runtime.session) {
    return { ok: false, detail: "CDP oturumu gerekli — önce chrome-login" };
  }

  if (isApiOnlyMode(params) && !skipTokenCache(params)) {
    logger.info("[api-auth] apiOnly — mevcut oturum deneniyor.");
    const passive = await runApiAuthBootstrapPassive(runtime, params);
    if (passive.ok) {
      return passive;
    }

    if (runtime.settings.apiWatcher.apiWizardAutoNavigate || isPanelManagedPortalFlow(params)) {
      const portalFlow = await runPortalBootstrapForJwt(runtime, params);
      if (portalFlow.ok) {
        return portalFlow;
      }
      logger.warn(`[api-auth] Otomatik portal akisi: ${portalFlow.detail}`);
    } else {
      const humanEntry = await tryHumanPortalEntryForJwt(runtime, params);
      if (humanEntry?.ok) {
        return humanEntry;
      }
    }

    if (runtime.banSafe && !shouldAllowPortalGotoFallback(runtime, params)) {
      return waitForManualPortalJwt(runtime);
    }
    if (!allowActiveAuthNavigation(runtime, params)) {
      return { ok: false, detail: manualAuthRequiredDetail() };
    }
    logger.warn(`[api-auth] ${passive.detail} Aktif navigasyon başlatılıyor.`);
  }

  if (!allowActiveAuthNavigation(runtime, params)) {
    return { ok: false, detail: manualAuthRequiredDetail() };
  }

  return runApiAuthBootstrapActive(runtime, params);
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

    const manualAuth = await detectManualAuthStep(page);
    const quickWaitMs = 8_000;
    const authWaitMs = manualAuth.required
      ? Math.max(
          runtime.settings.apiWatcher.tokenCaptureWaitMs,
          runtime.settings.intervention.loginMaxWaitMs,
        )
      : quickWaitMs;

    const captured = await waitForPortalJwtSession(
      runtime,
      page,
      session.context,
      runtime.settings.apiWatcher,
      authWaitMs,
    );
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
