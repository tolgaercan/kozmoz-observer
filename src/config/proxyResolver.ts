import { spawnSync } from "node:child_process";

import { detectHomePublicIp } from "./publicIpDetect.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import type { WorkerConfig } from "../control-panel/workerConfigStore.js";
import { ensureLocalProxyRelay } from "./localProxyRelay.js";
import {
  buildProxyUrl,
  parseProxyUrl,
  ProxyPoolStore,
  readLegacyProxyPoolFromEnv,
  type ProxyDefinition,
} from "./proxyPoolStore.js";

const IPIFY_URL = "http://api.ipify.org?format=json";

export function resolveWorkerProxyDefinition(
  projectRoot: string,
  profile: ResolvedProfile,
  worker: WorkerConfig,
): ProxyDefinition | undefined {
  if (worker.proxyMode !== "proxy") {
    return undefined;
  }

  const store = new ProxyPoolStore(projectRoot);
  if (worker.proxyId) {
    const fromPool = store.getById(worker.proxyId);
    if (fromPool) {
      return fromPool;
    }
  }

  if (worker.proxyUrl?.trim()) {
    return parseProxyUrl(worker.proxyUrl);
  }

  const fromProfileDefault = store.resolveForProfile(profile.id);
  if (fromProfileDefault) {
    return fromProfileDefault;
  }

  const fromManifest = profile.browser?.proxy?.trim();
  if (fromManifest) {
    return parseProxyUrl(fromManifest);
  }

  const envKey = `PROXY_URL_${profile.id.toUpperCase().replace(/-/g, "_")}`;
  const envUrl =
    process.env[envKey]?.trim() ||
    process.env.API_PROXY_URL?.trim();
  if (envUrl) {
    return parseProxyUrl(envUrl);
  }

  const legacyPool = readLegacyProxyPoolFromEnv();
  if (legacyPool[0]) {
    return legacyPool[0];
  }

  return undefined;
}

/** Chrome --proxy-server argümanı (auth varsa local relay). ISP statik WAN'da proxy kullanılmaz. */
export async function resolveChromeProxyServer(
  projectRoot: string,
  profile: ResolvedProfile,
  worker: WorkerConfig,
): Promise<string | undefined> {
  const def = resolveWorkerProxyDefinition(projectRoot, profile, worker);
  if (!def || def.ispStatic) {
    return undefined;
  }
  return ensureLocalProxyRelay(def);
}

function curlBin(): string {
  return process.platform === "win32" ? "curl.exe" : "curl";
}

export async function detectPublicIpThroughProxy(def: ProxyDefinition): Promise<string> {
  const relay = def.username ? await ensureLocalProxyRelay(def) : `${def.host}:${def.port}`;
  const proxyArg = relay.includes("127.0.0.1") ? relay : `${def.host}:${def.port}`;

  const curl = spawnSync(
    curlBin(),
    ["-s", "--proxy", proxyArg, "--max-time", "15", IPIFY_URL],
    { encoding: "utf-8", timeout: 15_000, windowsHide: true },
  );

  if (curl.status === 0 && curl.stdout) {
    try {
      const body = JSON.parse(curl.stdout) as { ip?: string };
      if (body.ip?.trim()) {
        return body.ip.trim();
      }
    } catch {
      // fall through
    }
  }

  if (def.username) {
    const direct = spawnSync(
      curlBin(),
      [
        "-s",
        "--proxy",
        `${def.host}:${def.port}`,
        "--proxy-user",
        `${def.username}:${def.password ?? ""}`,
        "--max-time",
        "15",
        IPIFY_URL,
      ],
      { encoding: "utf-8", timeout: 15_000, windowsHide: true },
    );
    if (direct.status === 0 && direct.stdout) {
      try {
        const body = JSON.parse(direct.stdout) as { ip?: string };
        if (body.ip?.trim()) {
          return body.ip.trim();
        }
      } catch {
        // fall through
      }
    }
  }

  return def.exitIp?.trim() || "unknown";
}

export async function resolveProxyPublicIp(
  projectRoot: string,
  profile: ResolvedProfile,
  worker: WorkerConfig,
): Promise<string> {
  const def = resolveWorkerProxyDefinition(projectRoot, profile, worker);
  if (!def) {
    return detectHomePublicIp(projectRoot);
  }

  if (def.ispStatic && def.exitIp?.trim()) {
    return def.exitIp.trim();
  }

  const measured = await detectPublicIpThroughProxy(def);
  if (measured !== "unknown") {
    return measured;
  }

  return def.exitIp?.trim() || "unknown";
}

export async function detectPublicIpForWorker(
  projectRoot: string,
  profile: ResolvedProfile,
  worker: WorkerConfig,
): Promise<string> {
  if (worker.proxyMode !== "proxy") {
    return detectHomePublicIp(projectRoot);
  }

  return resolveProxyPublicIp(projectRoot, profile, worker);
}

export function maskProxyForLog(def: ProxyDefinition): string {
  return `${def.label} (${def.host}:${def.port})`;
}

export { buildProxyUrl };
