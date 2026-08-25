import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const STORE_IDS = ["bbdhfoclddncoaomddgkaaphcnddbpdh", "bpfdbfnkjelhloljelooneehdalcmljb"];

function resolveSystemChromeUserDataDir() {
  if (process.env.FIXED_BROWSER_USER_DATA_DIR?.trim()) {
    return resolve(process.env.FIXED_BROWSER_USER_DATA_DIR.trim());
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Google", "Chrome");
  }
  if (process.platform === "linux") {
    return join(homedir(), ".config", "google-chrome");
  }
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) {
    return join(localAppData, "Google", "Chrome", "User Data");
  }
  return join(homedir(), "AppData", "Local", "Google", "Chrome", "User Data");
}

export const DEFAULT_REKT_CAPTCHA_SETTINGS = {
  recaptcha_auto_open: true,
  recaptcha_auto_solve: true,
  recaptcha_click_delay_time: 300,
  recaptcha_solve_delay_time: 1000,
};

function boolEnv(key, fallback) {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  return raw !== "false" && raw !== "0" && raw !== "no";
}

function intEnv(key, fallback) {
  const raw = process.env[key]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isCaptchaExtensionAutoLoadEnabled() {
  const raw = process.env.CAPTCHA_EXTENSION_AUTO_LOAD?.trim().toLowerCase();
  if (!raw) {
    return process.env.CAPTCHA_ENABLED !== "false";
  }
  return raw !== "false" && raw !== "0" && raw !== "no";
}

export function parseRektCaptchaSettingsFromEnv() {
  return {
    recaptcha_auto_open: boolEnv("REKT_CAPTCHA_AUTO_OPEN", DEFAULT_REKT_CAPTCHA_SETTINGS.recaptcha_auto_open),
    recaptcha_auto_solve: boolEnv("REKT_CAPTCHA_AUTO_SOLVE", DEFAULT_REKT_CAPTCHA_SETTINGS.recaptcha_auto_solve),
    recaptcha_click_delay_time: intEnv(
      "REKT_CAPTCHA_CLICK_DELAY_MS",
      DEFAULT_REKT_CAPTCHA_SETTINGS.recaptcha_click_delay_time,
    ),
    recaptcha_solve_delay_time: intEnv(
      "REKT_CAPTCHA_SOLVE_DELAY_MS",
      DEFAULT_REKT_CAPTCHA_SETTINGS.recaptcha_solve_delay_time,
    ),
  };
}

function hasManifest(dir) {
  return existsSync(join(dir, "manifest.json"));
}

function newestVersionDir(extensionRoot) {
  if (!existsSync(extensionRoot)) {
    return null;
  }

  const dirs = readdirSync(extensionRoot)
    .map((name) => join(extensionRoot, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory() && hasManifest(path);
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  return dirs[0] ?? null;
}

function findInstalledChromeStoreExtension() {
  const userDataDir = resolveSystemChromeUserDataDir();
  for (const extensionId of STORE_IDS) {
    const fromDefault = newestVersionDir(join(userDataDir, "Default", "Extensions", extensionId));
    if (fromDefault) {
      return fromDefault;
    }
  }
  return null;
}

export function resolveRektCaptchaExtensionDir(projectRoot) {
  const envPath = process.env.REKT_CAPTCHA_PATH?.trim();
  const candidates = [
    envPath ? resolve(envPath) : null,
    resolve(projectRoot, "extensions", "rektcaptcha"),
    resolve(projectRoot, "extensions", "rektcaptcha", "dist"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (hasManifest(candidate)) {
      return candidate;
    }
  }

  return findInstalledChromeStoreExtension();
}

export function buildRektCaptchaLaunchArgs(extensionDir) {
  const normalized = resolve(extensionDir);
  return [`--load-extension=${normalized}`, "--enable-unsafe-extension-debugging"];
}

function buildStorageSyncExpression(settings) {
  const payload = JSON.stringify(settings);
  return `(async () => {
    try {
      const manifest = chrome.runtime.getManifest?.();
      if (!manifest || manifest.name !== "rektCaptcha") {
        return { ok: false, reason: "not_rektcaptcha", name: manifest?.name ?? null };
      }
      await chrome.storage.local.set(${payload});
      return { ok: true, name: manifest.name };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  })()`;
}

async function cdpSend(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1_000_000);
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP zaman aşımı: ${method}`)), 10_000);
    const onMessage = (event) => {
      const payload = JSON.parse(String(event.data));
      if (payload.id !== id) {
        return;
      }
      clearTimeout(timeout);
      ws.removeEventListener("message", onMessage);
      if (payload.error) {
        reject(new Error(payload.error.message ?? `CDP hata: ${method}`));
        return;
      }
      resolvePromise(payload.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

export async function syncRektCaptchaSettingsViaCdp(cdpEndpoint, settings) {
  if (typeof WebSocket === "undefined") {
    return false;
  }

  const base = cdpEndpoint.replace(/\/$/, "");
  const response = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    return false;
  }

  const targets = await response.json();
  const workers = targets.filter(
    (target) => target.type === "service_worker" && target.url?.startsWith("chrome-extension://"),
  );

  const expression = buildStorageSyncExpression(settings);
  for (const worker of workers) {
    if (!worker.webSocketDebuggerUrl) {
      continue;
    }

    const ws = new WebSocket(worker.webSocketDebuggerUrl);
    try {
      await new Promise((resolvePromise, reject) => {
        ws.addEventListener("open", () => resolvePromise(), { once: true });
        ws.addEventListener("error", () => reject(new Error("CDP WebSocket hatası")), { once: true });
      });
      await cdpSend(ws, "Runtime.enable");
      const result = await cdpSend(ws, "Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.result?.value?.ok) {
        return true;
      }
    } catch {
      // sonraki worker
    } finally {
      ws.close();
    }
  }

  return false;
}

export async function waitAndSyncRektCaptchaSettings(cdpEndpoint, settings, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    if (await syncRektCaptchaSettingsViaCdp(cdpEndpoint, settings)) {
      return true;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  return false;
}

export async function installAndConfigureRektCaptcha(cdpEndpoint, extensionDir, settings, attempts = 12) {
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

async function withBrowserCdpSession(cdpEndpoint, run) {
  if (typeof WebSocket === "undefined") {
    return null;
  }

  const version = await fetch(`${cdpEndpoint.replace(/\/$/, "")}/json/version`, {
    signal: AbortSignal.timeout(5000),
  }).then((r) => r.json());

  if (!version.webSocketDebuggerUrl) {
    return null;
  }

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    ws.addEventListener("open", () => resolvePromise(), { once: true });
    ws.addEventListener("error", () => reject(new Error("browser CDP ws error")), { once: true });
  });

  try {
    const send = (method, params = {}) => cdpSend(ws, method, params);
    return await run(send);
  } finally {
    ws.close();
  }
}

async function loadRektCaptchaExtensionViaCdp(cdpEndpoint, extensionDir) {
  const absolutePath = resolve(extensionDir);
  try {
    const result = await withBrowserCdpSession(cdpEndpoint, async (send) => {
      const existing = await send("Extensions.getExtensions");
      const match = (existing.extensions ?? []).find(
        (ext) =>
          ext.path?.replace(/\\/g, "/").toLowerCase() === absolutePath.replace(/\\/g, "/").toLowerCase() ||
          String(ext.name ?? "").includes("rektCaptcha"),
      );
      if (match?.id) {
        return { id: match.id };
      }
      const loaded = await send("Extensions.loadUnpacked", { path: absolutePath });
      return { id: loaded.id };
    });
    return result?.id ?? null;
  } catch {
    return null;
  }
}

async function applyRektCaptchaSettingsViaCdpExtensionApi(cdpEndpoint, extensionId, settings) {
  try {
    await withBrowserCdpSession(cdpEndpoint, async (send) => {
      await send("Extensions.setStorageItems", {
        id: extensionId,
        storageArea: "local",
        values: settings,
      });
    });
    return true;
  } catch {
    return false;
  }
}

export function prepareRektCaptchaForChromeLaunch(projectRoot) {
  if (!isCaptchaExtensionAutoLoadEnabled() || process.env.CAPTCHA_ENABLED === "false") {
    return { launchArgs: [], settings: parseRektCaptchaSettingsFromEnv(), loaded: false };
  }

  const extensionDir = resolveRektCaptchaExtensionDir(projectRoot);
  if (!extensionDir) {
    return { launchArgs: [], settings: parseRektCaptchaSettingsFromEnv(), loaded: false };
  }

  return {
    loaded: true,
    extensionDir,
    launchArgs: buildRektCaptchaLaunchArgs(extensionDir),
    settings: parseRektCaptchaSettingsFromEnv(),
  };
}
