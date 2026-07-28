import { spawnSync } from "node:child_process";

import { ProxyPoolStore } from "./proxyPoolStore.js";

const IPIFY_URL = "http://api.ipify.org?format=json";

export interface HomePublicIpResult {
  /** Panelde gösterilecek ev IP */
  ip: string;
  /** ipify ile ölçülen ham WAN IP */
  measuredIp: string;
  /** Ölçülen IP, proxy havuzundaki bilinen çıkış IP'lerinden biri mi */
  isProxyIpDetected: boolean;
  source: "env" | "measured" | "unavailable";
  warning?: string;
}

function parseIpifyJson(raw: string): string | undefined {
  try {
    const body = JSON.parse(raw) as { ip?: string };
    return body.ip?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function curlBin(): string {
  return process.platform === "win32" ? "curl.exe" : "curl";
}

/** Ham WAN IP — proxy bypass (--noproxy) */
export function measureRawPublicIp(): string {
  const curl = spawnSync(
    curlBin(),
    ["-s", "--noproxy", "*", "--max-time", "15", IPIFY_URL],
    { encoding: "utf-8", windowsHide: true },
  );
  const fromCurl = curl.stdout ? parseIpifyJson(curl.stdout) : undefined;
  if (fromCurl) {
    return fromCurl;
  }
  return "unknown";
}

export function listKnownProxyExitIps(projectRoot: string): string[] {
  const store = new ProxyPoolStore(projectRoot);
  return [
    ...new Set(
      store
        .loadAll()
        .map((proxy) => proxy.exitIp?.trim())
        .filter((ip): ip is string => Boolean(ip && ip !== "0.0.0.0")),
    ),
  ];
}

function isKnownProxyIp(ip: string, knownProxyIps: string[]): boolean {
  return knownProxyIps.includes(ip);
}

/** Ev interneti IP — bilinen proxy çıkış IP'lerini ev IP sanmaz */
export async function resolveHomePublicIp(projectRoot: string): Promise<HomePublicIpResult> {
  const knownProxyIps = listKnownProxyExitIps(projectRoot);
  const measuredIp = measureRawPublicIp();
  const envHome = process.env.HOME_PUBLIC_IP?.trim();

  if (envHome) {
    return {
      ip: envHome,
      measuredIp,
      isProxyIpDetected: isKnownProxyIp(measuredIp, knownProxyIps),
      source: "env",
      warning: isKnownProxyIp(measuredIp, knownProxyIps)
        ? `WAN ${measuredIp} ProxyNet IP — panel HOME_PUBLIC_IP kullanıyor`
        : undefined,
    };
  }

  if (measuredIp !== "unknown" && isKnownProxyIp(measuredIp, knownProxyIps)) {
    return {
      ip: "unavailable",
      measuredIp,
      isProxyIpDetected: true,
      source: "unavailable",
      warning:
        `WAN ${measuredIp} ProxyNet statik IP — ev interneti değil. ` +
        "ProxyNet'i kapatın veya .env içine HOME_PUBLIC_IP=... yazın.",
    };
  }

  return {
    ip: measuredIp,
    measuredIp,
    isProxyIpDetected: false,
    source: "measured",
  };
}

/** Geriye dönük uyumluluk — mümkünse projectRoot ile resolveHomePublicIp kullanın */
export async function detectHomePublicIp(projectRoot?: string): Promise<string> {
  if (projectRoot) {
    const resolved = await resolveHomePublicIp(projectRoot);
    return resolved.ip === "unavailable" ? "unknown" : resolved.ip;
  }

  const measuredIp = measureRawPublicIp();
  const envHome = process.env.HOME_PUBLIC_IP?.trim();
  if (envHome) {
    return envHome;
  }
  return measuredIp;
}
