import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { isCdpEndpointReady } from "../browser/cdpConnector.js";
import { detectHomePublicIp } from "../config/publicIpDetect.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import type { ProcessRegistry } from "./processRegistry.js";

const DEFAULT_CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export interface ChromeLaunchResult {
  ok: boolean;
  message: string;
  cdpEndpoint: string;
  cdpPort: number;
  reusedExisting: boolean;
  processId?: string;
}

function resolveChromeExecutable(): string {
  return process.env.CHROME_EXECUTABLE_PATH?.trim() || DEFAULT_CHROME_PATH;
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
    userDataDir = resolve(homedir(), "AppData/Local/Google/Chrome/User Data");
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

export async function launchChromeForProfile(
  profile: ResolvedProfile,
  registry: ProcessRegistry,
  proxyUrl?: string,
  directMode = false,
): Promise<ChromeLaunchResult> {
  const { userDataDir, profileDirectory, cdpPort } = resolveProfilePaths(profile);
  const cdpEndpoint = `http://127.0.0.1:${cdpPort}`;

  const existing = registry.findByProfile(profile.id, "chrome");
  if (existing.length > 0 && (await isCdpEndpointReady(cdpEndpoint, { exact: true }))) {
    return {
      ok: true,
      message: "Chrome zaten çalışıyor (CDP hazır).",
      cdpEndpoint,
      cdpPort,
      reusedExisting: true,
      processId: existing[0]?.id,
    };
  }

  if (await isCdpEndpointReady(cdpEndpoint, { exact: true })) {
    const attached = registry.register({
      kind: "chrome",
      profileId: profile.id,
      label: `Chrome CDP :${cdpPort}`,
      cdpPort,
      status: "running",
      pid: undefined,
    });
    return {
      ok: true,
      message: "Mevcut CDP oturumu bulundu — yeni Chrome açılmadı.",
      cdpEndpoint,
      cdpPort,
      reusedExisting: true,
      processId: attached.id,
    };
  }

  const chromeExe = resolveChromeExecutable();
  if (!existsSync(chromeExe)) {
    return {
      ok: false,
      message: `Chrome bulunamadı: ${chromeExe}`,
      cdpEndpoint,
      cdpPort,
      reusedExisting: false,
    };
  }

  const args = buildChromeArgs(userDataDir, profileDirectory, cdpPort, proxyUrl, directMode);
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
    message: "Chrome debug modunda başlatıldı.",
    cdpEndpoint,
    cdpPort,
    reusedExisting: false,
    processId: record.id,
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
