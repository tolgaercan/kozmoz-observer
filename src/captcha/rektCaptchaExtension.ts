import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { resolveSystemChromeUserDataDir } from "../browser/chromePlatform.js";
import { logger } from "../utils/logger.js";

/** rektCaptcha chrome.storage.local anahtarları (kaynak: Wikidepia/rektCaptcha-extension). */
export interface RektCaptchaSettings {
  recaptcha_auto_open: boolean;
  recaptcha_auto_solve: boolean;
  recaptcha_click_delay_time: number;
  recaptcha_solve_delay_time: number;
}

export const DEFAULT_REKT_CAPTCHA_SETTINGS: RektCaptchaSettings = {
  recaptcha_auto_open: true,
  recaptcha_auto_solve: true,
  recaptcha_click_delay_time: 300,
  recaptcha_solve_delay_time: 1000,
};

/** Chrome Web Store rektCaptcha kimlikleri (sürüme göre değişebilir). */
const REKT_CAPTCHA_STORE_IDS = [
  "bbdhfoclddncoaomddgkaaphcnddbpdh",
  "bpfdbfnkjelhloljelooneehdalcmljb",
];

export function parseRektCaptchaSettingsFromEnv(): RektCaptchaSettings {
  const bool = (key: string, fallback: boolean): boolean => {
    const raw = process.env[key]?.trim().toLowerCase();
    if (raw === undefined || raw === "") {
      return fallback;
    }
    return raw !== "false" && raw !== "0" && raw !== "no";
  };

  const int = (key: string, fallback: number): number => {
    const raw = process.env[key]?.trim();
    if (!raw) {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    recaptcha_auto_open: bool("REKT_CAPTCHA_AUTO_OPEN", DEFAULT_REKT_CAPTCHA_SETTINGS.recaptcha_auto_open),
    recaptcha_auto_solve: bool("REKT_CAPTCHA_AUTO_SOLVE", DEFAULT_REKT_CAPTCHA_SETTINGS.recaptcha_auto_solve),
    recaptcha_click_delay_time: int(
      "REKT_CAPTCHA_CLICK_DELAY_MS",
      DEFAULT_REKT_CAPTCHA_SETTINGS.recaptcha_click_delay_time,
    ),
    recaptcha_solve_delay_time: int(
      "REKT_CAPTCHA_SOLVE_DELAY_MS",
      DEFAULT_REKT_CAPTCHA_SETTINGS.recaptcha_solve_delay_time,
    ),
  };
}

export function isCaptchaExtensionAutoLoadEnabled(): boolean {
  const raw = process.env.CAPTCHA_EXTENSION_AUTO_LOAD?.trim().toLowerCase();
  if (raw === undefined || raw === "") {
    return process.env.CAPTCHA_ENABLED !== "false";
  }
  return raw !== "false" && raw !== "0" && raw !== "no";
}

function isValidExtensionDir(dir: string): boolean {
  return existsSync(join(dir, "manifest.json"));
}

function newestVersionDir(extensionRoot: string): string | null {
  if (!existsSync(extensionRoot)) {
    return null;
  }

  const versionDirs = readdirSync(extensionRoot)
    .map((name) => join(extensionRoot, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory() && isValidExtensionDir(path);
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  return versionDirs[0] ?? null;
}

function findInstalledChromeStoreExtension(): string | null {
  const userDataDir = resolveSystemChromeUserDataDir();
  for (const extensionId of REKT_CAPTCHA_STORE_IDS) {
    const fromDefault = newestVersionDir(join(userDataDir, "Default", "Extensions", extensionId));
    if (fromDefault) {
      return fromDefault;
    }
  }
  return null;
}

/**
 * Unpacked rektCaptcha klasörünü bulur.
 * Öncelik: REKT_CAPTCHA_PATH → extensions/rektcaptcha → sistem Chrome kurulumu.
 */
export function resolveRektCaptchaExtensionDir(projectRoot: string): string | null {
  const envPath = process.env.REKT_CAPTCHA_PATH?.trim();
  const candidates = [
    envPath ? resolve(envPath) : null,
    resolve(projectRoot, "extensions", "rektcaptcha"),
    resolve(projectRoot, "extensions", "rektcaptcha", "dist"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (isValidExtensionDir(candidate)) {
      return candidate;
    }
  }

  return findInstalledChromeStoreExtension();
}

export function buildRektCaptchaLaunchArgs(extensionDir: string): string[] {
  ensureExtensionReadyForUnpackedLoad(extensionDir);
  const normalized = resolve(extensionDir);
  // Chrome 137+ resmi build: --load-extension tek başına çalışmaz; unsafe flag ile birlikte gerekir.
  return [`--load-extension=${normalized}`, "--enable-unsafe-extension-debugging"];
}

/** Web Store kopyasını Chrome 137+ --load-extension için hazırlar (_metadata sil, ayarları patch'le). */
export function ensureExtensionReadyForUnpackedLoad(extensionDir: string): void {
  const metadataDir = join(extensionDir, "_metadata");
  if (existsSync(metadataDir)) {
    rmSync(metadataDir, { recursive: true, force: true });
    logger.info("[rektCaptcha] _metadata klasörü kaldırıldı.");
  }

  const backgroundPath = join(extensionDir, "background.js");
  if (!existsSync(backgroundPath)) {
    return;
  }

  let background = readFileSync(backgroundPath, "utf-8");
  const patched = background
    .replace(/recaptcha_auto_open:!1/g, "recaptcha_auto_open:!0")
    .replace(/recaptcha_auto_solve:!1/g, "recaptcha_auto_solve:!0");

  if (patched !== background) {
    background = patched;
    logger.info("[rektCaptcha] background.js — auto-open/solve varsayılanları açık.");
  }

  if (!background.includes("chrome.runtime.onStartup")) {
    background = background.replace(
      /\}\)\(\);?$/,
      ";chrome.runtime.onStartup.addListener((async()=>{await chrome.storage.local.set({recaptcha_auto_open:!0,recaptcha_auto_solve:!0,recaptcha_click_delay_time:300,recaptcha_solve_delay_time:1e3})}))})();",
    );
  }

  writeFileSync(backgroundPath, background, "utf-8");
}

interface CdpTarget {
  id?: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

async function cdpSend<T = unknown>(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<T> {
  const id = Math.floor(Math.random() * 1_000_000);
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`CDP zaman aşımı: ${method}`));
    }, 10_000);

    const onMessage = (event: MessageEvent) => {
      const payload = JSON.parse(String(event.data)) as {
        id?: number;
        result?: T;
        error?: { message?: string };
      };
      if (payload.id !== id) {
        return;
      }
      clearTimeout(timeout);
      ws.removeEventListener("message", onMessage);
      if (payload.error) {
        reject(new Error(payload.error.message ?? `CDP hata: ${method}`));
        return;
      }
      resolvePromise(payload.result as T);
    };

    ws.addEventListener("message", onMessage);
    ws.send(
      JSON.stringify({
        id,
        method,
        params,
        sessionId,
      }),
    );
  });
}

async function withBrowserCdpSession<T>(
  cdpEndpoint: string,
  run: (send: (method: string, params?: Record<string, unknown>) => Promise<unknown>) => Promise<T>,
): Promise<T | null> {
  if (typeof WebSocket === "undefined") {
    return null;
  }

  const version = (await fetch(`${cdpEndpoint.replace(/\/$/, "")}/json/version`, {
    signal: AbortSignal.timeout(5000),
  }).then((r) => r.json())) as { webSocketDebuggerUrl?: string };

  if (!version.webSocketDebuggerUrl) {
    return null;
  }

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolvePromise, reject) => {
    ws.addEventListener("open", () => resolvePromise(), { once: true });
    ws.addEventListener("error", () => reject(new Error("browser CDP ws error")), { once: true });
  });

  try {
    const send = (method: string, params: Record<string, unknown> = {}) =>
      cdpSend(ws, method, params) as Promise<unknown>;
    return await run(send);
  } finally {
    ws.close();
  }
}

/** Chrome 137+ — CDP ile unpacked extension yükler (resmi Chrome'da --load-extension çalışmaz). */
export async function loadRektCaptchaExtensionViaCdp(
  cdpEndpoint: string,
  extensionDir: string,
): Promise<string | null> {
  ensureExtensionReadyForUnpackedLoad(extensionDir);
  const absolutePath = resolve(extensionDir);

  try {
    const result = await withBrowserCdpSession(cdpEndpoint, async (send) => {
      const existing = (await send("Extensions.getExtensions")) as {
        extensions?: Array<{ id?: string; path?: string; name?: string }>;
      };
      const match = (existing.extensions ?? []).find(
        (ext) =>
          ext.path?.replace(/\\/g, "/").toLowerCase() === absolutePath.replace(/\\/g, "/").toLowerCase() ||
          String(ext.name ?? "").includes("rektCaptcha"),
      );
      if (match?.id) {
        return { id: match.id, reused: true };
      }

      const loaded = (await send("Extensions.loadUnpacked", { path: absolutePath })) as { id?: string };
      return { id: loaded.id, reused: false };
    });

    if (!result?.id) {
      logger.warn("[rektCaptcha] CDP Extensions.loadUnpacked başarısız — chrome://extensions kontrol edin.");
      return null;
    }

    logger.info(
      `[rektCaptcha] Extension ${result.reused ? "zaten yüklü" : "yüklendi"} (id=${result.id}).`,
    );
    return result.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[rektCaptcha] CDP extension yükleme hatası: ${message}`);
    return null;
  }
}

export async function applyRektCaptchaSettingsViaCdpExtensionApi(
  cdpEndpoint: string,
  extensionId: string,
  settings: RektCaptchaSettings,
): Promise<boolean> {
  try {
    await withBrowserCdpSession(cdpEndpoint, async (send) => {
      await send("Extensions.setStorageItems", {
        id: extensionId,
        storageArea: "local",
        values: settings,
      });
    });
    logger.info(
      `[rektCaptcha] Ayarlar kaydedildi: auto-open=${settings.recaptcha_auto_open}, ` +
        `auto-solve=${settings.recaptcha_auto_solve}, click=${settings.recaptcha_click_delay_time}ms, ` +
        `solve=${settings.recaptcha_solve_delay_time}ms`,
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[rektCaptcha] Extensions.setStorageItems başarısız: ${message}`);
    return false;
  }
}

export async function installAndConfigureRektCaptcha(
  cdpEndpoint: string,
  extensionDir: string,
  settings: RektCaptchaSettings,
  attempts = 12,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const extensionId = await loadRektCaptchaExtensionViaCdp(cdpEndpoint, extensionDir);
    if (extensionId) {
      if (await applyRektCaptchaSettingsViaCdpExtensionApi(cdpEndpoint, extensionId, settings)) {
        return true;
      }
      if (await syncRektCaptchaSettingsViaCdp(cdpEndpoint, settings)) {
        return true;
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
  }
  return false;
}

async function discoverExtensionServiceWorkersViaBrowser(
  cdpEndpoint: string,
): Promise<CdpTarget[]> {
  if (typeof WebSocket === "undefined") {
    return [];
  }

  try {
    const version = (await fetch(`${cdpEndpoint.replace(/\/$/, "")}/json/version`, {
      signal: AbortSignal.timeout(5000),
    }).then((r) => r.json())) as { webSocketDebuggerUrl?: string };

    if (!version.webSocketDebuggerUrl) {
      return [];
    }

    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise<void>((resolvePromise, reject) => {
      ws.addEventListener("open", () => resolvePromise(), { once: true });
      ws.addEventListener("error", () => reject(new Error("browser CDP ws error")), { once: true });
    });

    await cdpSend(ws, "Target.setDiscoverTargets", { discover: true });
    const result = await cdpSend<{ targetInfos?: Array<{ type?: string; url?: string; targetId?: string }> }>(
      ws,
      "Target.getTargets",
    );
    ws.close();

    return (result.targetInfos ?? [])
      .filter((target) => target.type === "service_worker" && target.url?.startsWith("chrome-extension://"))
      .map((target) => ({
        type: target.type,
        url: target.url,
        id: target.targetId,
        webSocketDebuggerUrl: undefined,
      }));
  } catch {
    return [];
  }
}

async function evaluateOnExtensionServiceWorker(
  cdpEndpoint: string,
  targetId: string,
  expression: string,
): Promise<{ ok?: boolean; name?: string } | undefined> {
  if (typeof WebSocket === "undefined") {
    return undefined;
  }

  const version = (await fetch(`${cdpEndpoint.replace(/\/$/, "")}/json/version`, {
    signal: AbortSignal.timeout(5000),
  }).then((r) => r.json())) as { webSocketDebuggerUrl?: string };

  if (!version.webSocketDebuggerUrl) {
    return undefined;
  }

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolvePromise, reject) => {
    ws.addEventListener("open", () => resolvePromise(), { once: true });
    ws.addEventListener("error", () => reject(new Error("browser CDP ws error")), { once: true });
  });

  try {
    const attach = await cdpSend<{ sessionId?: string }>(ws, "Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    if (!attach.sessionId) {
      return undefined;
    }

    await cdpSend(ws, "Runtime.enable", {}, attach.sessionId);
    const result = await cdpSend<{ result?: { value?: { ok?: boolean; name?: string } } }>(
      ws,
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      attach.sessionId,
    );
    return result.result?.value;
  } finally {
    ws.close();
  }
}

function buildStorageSyncExpression(settings: RektCaptchaSettings): string {
  const payload = JSON.stringify(settings);
  return `(async () => {
    try {
      const manifest = chrome.runtime.getManifest?.();
      if (!manifest || !String(manifest.name ?? "").includes("rektCaptcha")) {
        return { ok: false, reason: "not_rektcaptcha", name: manifest?.name ?? null };
      }
      await chrome.storage.local.set(${payload});
      return { ok: true, name: manifest.name };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  })()`;
}

/**
 * CDP üzerinden rektCaptcha service worker'a ayarları yazar.
 * Playwright browser.close() Chrome'u kapatacağı için ham WebSocket kullanılır.
 */
export async function syncRektCaptchaSettingsViaCdp(
  cdpEndpoint: string,
  settings: RektCaptchaSettings,
): Promise<boolean> {
  if (typeof WebSocket === "undefined") {
    logger.warn("[rektCaptcha] WebSocket yok — ayar senkronu atlandı (Node 22+ önerilir).");
    return false;
  }

  const base = cdpEndpoint.replace(/\/$/, "");
  let targets: CdpTarget[];
  try {
    const response = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      return false;
    }
    targets = (await response.json()) as CdpTarget[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[rektCaptcha] CDP hedef listesi alınamadı: ${message}`);
    return false;
  }

  const workers = targets.filter(
    (target) => target.type === "service_worker" && target.url?.startsWith("chrome-extension://"),
  );

  if (workers.length === 0) {
    const discovered = await discoverExtensionServiceWorkersViaBrowser(cdpEndpoint);
    workers.push(...discovered);
  }

  if (workers.length === 0) {
    logger.warn("[rektCaptcha] Extension service worker bulunamadı — chrome://extensions boş mu kontrol edin.");
    return false;
  }

  const expression = buildStorageSyncExpression(settings);
  let synced = false;

  for (const worker of workers) {
    if (worker.id && !worker.webSocketDebuggerUrl) {
      try {
        const value = await evaluateOnExtensionServiceWorker(cdpEndpoint, worker.id, expression);
        if (value?.ok) {
          logger.info(
            `[rektCaptcha] Ayarlar uygulandı (${value.name ?? "rektCaptcha"}): ` +
              `auto-open=${settings.recaptcha_auto_open}, auto-solve=${settings.recaptcha_auto_solve}, ` +
              `click=${settings.recaptcha_click_delay_time}ms, solve=${settings.recaptcha_solve_delay_time}ms`,
          );
          synced = true;
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.debug(`[rektCaptcha] Target attach ayar denemesi başarısız: ${message}`);
      }
      continue;
    }

    if (!worker.webSocketDebuggerUrl) {
      continue;
    }

    const ws = new WebSocket(worker.webSocketDebuggerUrl);
    try {
      await new Promise<void>((resolvePromise, reject) => {
        ws.addEventListener("open", () => resolvePromise(), { once: true });
        ws.addEventListener("error", () => reject(new Error("CDP WebSocket bağlantı hatası")), {
          once: true,
        });
      });

      await cdpSend(ws, "Runtime.enable");
      const result = await cdpSend<{ result?: { value?: { ok?: boolean; name?: string } } }>(
        ws,
        "Runtime.evaluate",
        { expression, awaitPromise: true, returnByValue: true },
      );

      if (result.result?.value?.ok) {
        logger.info(
          `[rektCaptcha] Ayarlar uygulandı (${result.result.value.name ?? "rektCaptcha"}): ` +
            `auto-open=${settings.recaptcha_auto_open}, auto-solve=${settings.recaptcha_auto_solve}, ` +
            `click=${settings.recaptcha_click_delay_time}ms, solve=${settings.recaptcha_solve_delay_time}ms`,
        );
        synced = true;
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.debug(`[rektCaptcha] Service worker ayar denemesi başarısız: ${message}`);
    } finally {
      ws.close();
    }
  }

  if (!synced) {
    logger.warn(
      "[rektCaptcha] Ayar senkronu tamamlanamadı. Extension yüklü mü kontrol edin (`npm run install:rektcaptcha`).",
    );
  }

  return synced;
}

export async function waitAndSyncRektCaptchaSettings(
  cdpEndpoint: string,
  settings: RektCaptchaSettings,
  attempts = 20,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await syncRektCaptchaSettingsViaCdp(cdpEndpoint, settings)) {
      return true;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
  }
  return false;
}
