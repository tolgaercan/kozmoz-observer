import { existsSync, mkdirSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";

import { isCdpEndpointReady } from "../browser/cdpConnector.js";
import {
  resolveChromeExecutable as resolvePlatformChromeExecutable,
  resolveSystemChromeUserDataDir,
} from "../browser/chromePlatform.js";
import { detectHomePublicIp } from "../config/publicIpDetect.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { killProcessesOnPort, waitForCdpPortFree } from "./cdpPortKill.js";
import type { ProcessRegistry } from "./processRegistry.js";
import { logger } from "../utils/logger.js";

export interface ChromeLaunchResult {
  ok: boolean;
  message: string;
  cdpEndpoint: string;
  cdpPort: number;
  reusedExisting: boolean;
  processId?: string;
  proxyApplied?: string;
}

function resolveChromeExecutable(): string {
  return resolvePlatformChromeExecutable() ?? "";
}

function resolveProfilePaths(profile: ResolvedProfile): {
  userDataDir: string;
  profileDirectory: string;
  cdpPort: number;
} {
  const useSystemProfile = process.env.CHROME_USE_SYSTEM_PROFILE === "true";
  let userDataDir = profile.absoluteUserDataDir;
  let profileDirectory = profile.browser?.profileDirectory ?? "Default";

  if (useSystemProfile) {
    userDataDir = resolveSystemChromeUserDataDir();
    profileDirectory =
      process.env.CHROME_PROFILE_DIRECTORY?.trim() ||
      profile.browser?.profileDirectory ||
      "Default";
  }

  const cdpPort = profile.browser?.cdpPort ?? 9222;
  if (!existsSync(userDataDir)) {
    mkdirSync(userDataDir, { recursive: true });
  }

  return { userDataDir, profileDirectory, cdpPort };
}

function buildChromeArgs(
  userDataDir: string,
  profileDirectory: string,
  cdpPort: number,
  proxyUrl?: string,
  directMode = false,
): string[] {
  const args = [
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileDirectory}`,
    "--disable-infobars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--start-maximized",
  ];

  if (proxyUrl?.trim()) {
    args.push(`--proxy-server=${proxyUrl.trim()}`);
  } else if (directMode) {
    args.push("--proxy-server=direct://");
  }

  const startUrl =
    process.env.CHROME_STARTUP_URL?.trim() ||
    (process.env.CHROME_USE_SYSTEM_PROFILE === "true" ? "about:blank" : "about:blank");
  args.push(startUrl);
  return args;
}

async function waitForCdp(cdpEndpoint: string, attempts = 20): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await isCdpEndpointReady(cdpEndpoint)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function findActiveOwnerProfileOnPort(
  registry: ProcessRegistry,
  cdpPort: number,
): string | undefined {
  for (const proc of registry.list()) {
    if (
      proc.cdpPort === cdpPort &&
      (proc.status === "running" || proc.status === "starting")
    ) {
      return proc.profileId;
    }
  }
  return undefined;
}

async function clearCdpPortForRelaunch(
  profileId: string,
  cdpPort: number,
  registry: ProcessRegistry,
): Promise<void> {
  const owner = findActiveOwnerProfileOnPort(registry, cdpPort);
  if (owner && owner !== profileId) {
    throw new Error(
      `CDP port ${cdpPort} «${owner}» profili tarafından kullanılıyor. Port alanını boş bırakın (otomatik atanır) veya farklı port seçin.`,
    );
  }

  for (const job of registry.findByProfile(profileId, "chrome")) {
    registry.kill(job.id);
  }
  const killed = killProcessesOnPort(cdpPort);
  if (killed.length > 0) {
    logger.info(`[chrome] CDP port ${cdpPort} temizlendi (${killed.length} süreç)`);
  }
  await waitForCdpPortFree(cdpPort);
}

export async function launchChromeForProfile(
  profile: ResolvedProfile,
  registry: ProcessRegistry,
  proxyUrl?: string,
  directMode = false,
  options?: { forceFresh?: boolean; cdpPort?: number },
): Promise<ChromeLaunchResult> {
  const paths = resolveProfilePaths(profile);
  const userDataDir = paths.userDataDir;
  const profileDirectory = paths.profileDirectory;
  const cdpPort = options?.cdpPort ?? paths.cdpPort;
  const cdpEndpoint = `http://127.0.0.1:${cdpPort}`;
  const proxyApplied = proxyUrl?.trim()
    ? proxyUrl.trim()
    : directMode
      ? "direct://"
      : undefined;

  const forceFresh = options?.forceFresh ?? true;
  const cdpReady = await isCdpEndpointReady(cdpEndpoint, { exact: true });

  if (cdpReady && !forceFresh) {
    const existing = registry.findByProfile(profile.id, "chrome");
    return {
      ok: true,
      message: "Chrome zaten çalışıyor (CDP hazır).",
      cdpEndpoint,
      cdpPort,
      reusedExisting: true,
      processId: existing[0]?.id,
      proxyApplied: undefined,
    };
  }

  if (cdpReady && forceFresh) {
    logger.info(
      `[chrome] Port ${cdpPort} meşgul — proxy/ayar uygulamak için mevcut Chrome kapatılıyor…`,
    );
    await clearCdpPortForRelaunch(profile.id, cdpPort, registry);
  }

  const chromeExe = resolveChromeExecutable();
  if (!chromeExe || !existsSync(chromeExe)) {
    return {
      ok: false,
      message:
        "Google Chrome bulunamadı. Kurun veya .env içinde CHROME_PATH / CHROME_EXECUTABLE_PATH tanımlayın.",
      cdpEndpoint,
      cdpPort,
      reusedExisting: false,
    };
  }

  const args = buildChromeArgs(userDataDir, profileDirectory, cdpPort, proxyUrl, directMode);
  logger.info(
    `[chrome] Yeni oturum: port=${cdpPort}, proxy=${proxyApplied ?? "sistem varsayılanı (ev IP riski)"}`,
  );
  const record = registry.register({
    kind: "chrome",
    profileId: profile.id,
    label: `Chrome CDP :${cdpPort}`,
    cdpPort,
  });

  const child: ChildProcess = spawn(chromeExe, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();

  if (child.pid) {
    registry.markRunning(record.id, { pid: child.pid });
  }

  child.on("exit", () => {
    registry.markExited(record.id, "Chrome kapandı");
  });

  const ready = await waitForCdp(cdpEndpoint);
  if (!ready) {
    registry.markFailed(record.id, `CDP port ${cdpPort} açılmadı`);
    return {
      ok: false,
      message: `Chrome başlatıldı ama CDP hazır değil (port ${cdpPort}).`,
      cdpEndpoint,
      cdpPort,
      reusedExisting: false,
      processId: record.id,
    };
  }

  registry.markRunning(record.id, { pid: child.pid ?? undefined });
  return {
    ok: true,
    message: proxyApplied
      ? `Chrome debug modunda başlatıldı (proxy: ${proxyApplied}).`
      : "Chrome debug modunda başlatıldı.",
    cdpEndpoint,
    cdpPort,
    reusedExisting: false,
    processId: record.id,
    proxyApplied,
  };
}

export async function getChromeStatus(cdpPort: number): Promise<{ ready: boolean; endpoint: string }> {
  const endpoint = `http://127.0.0.1:${cdpPort}`;
  return { ready: await isCdpEndpointReady(endpoint, { exact: true }), endpoint };
}

export function readProfileProxyUrl(profile: ResolvedProfile): string | undefined {
  const fromManifest = profile.browser?.proxy?.trim();
  if (fromManifest) {
    return fromManifest;
  }
  const envKey = `PROXY_URL_${profile.id.toUpperCase().replace(/-/g, "_")}`;
  return process.env[envKey]?.trim() || process.env.API_PROXY_URL?.trim() || undefined;
}

export function readProxyPoolFromEnv(): string[] {
  const raw = process.env.PROXY_POOL?.trim();
  if (!raw) {
    return [];
  }
  return raw.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
}

export async function detectPublicIp(projectRoot?: string): Promise<string> {
  return detectHomePublicIp(projectRoot);
}
