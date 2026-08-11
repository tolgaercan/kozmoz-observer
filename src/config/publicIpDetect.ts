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
  source: "measured" | "unavailable";
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

function measureHomeIpViaWebClient(): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }
  const ps = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "$ProgressPreference='SilentlyContinue'; " +
        "$wc = New-Object System.Net.WebClient; " +
        "$wc.Proxy = $null; " +
        "$wc.DownloadString('http://api.ipify.org?format=json')",
    ],
    { encoding: "utf-8", timeout: 20_000, windowsHide: true },
  );
  if (ps.status !== 0 || !ps.stdout?.trim()) {
    return undefined;
  }
  return parseIpifyJson(ps.stdout);
}

function measureHomeIpViaPowerShell(): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }
  const ps = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "$ProgressPreference='SilentlyContinue'; " +
        "[System.Net.WebRequest]::DefaultWebProxy = [System.Net.GlobalProxySelection]::GetEmptyWebProxy(); " +
        "(Invoke-RestMethod -Uri 'http://api.ipify.org?format=json' -Proxy $null -TimeoutSec 15).ip",
    ],
    { encoding: "utf-8", timeout: 20_000, windowsHide: true },
  );
  if (ps.status !== 0 || !ps.stdout?.trim()) {
    return undefined;
  }
  return parseIpifyJson(ps.stdout) ?? ps.stdout.trim();
}

/** Ham WAN IP — sistem proxy bypass (--noproxy + Windows PowerShell yedek) */
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

  const fromPs = measureHomeIpViaPowerShell();
  if (fromPs) {
    return fromPs;
  }

  return "unknown";
}

/** Doğrudan mod — bilinen proxy çıkış IP'lerini atlayarak ev IP ölçer */
export function measureDirectHomeIp(projectRoot: string): string {
  const knownProxyIps = listKnownProxyExitIps(projectRoot);

  for (const candidate of [
    measureHomeIpViaWebClient(),
    measureHomeIpViaPowerShell(),
    (() => {
      const curlBypass = spawnSync(
        curlBin(),
        ["-s", "--noproxy", "*", "--max-time", "15", IPIFY_URL],
        { encoding: "utf-8", windowsHide: true },
      );
      return curlBypass.stdout ? parseIpifyJson(curlBypass.stdout) : undefined;
    })(),
  ]) {
    if (candidate && !isKnownProxyIp(candidate, knownProxyIps)) {
      return candidate;
    }
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

/** Ev interneti IP — sunucu ölçümü (panel .env HOME_PUBLIC_IP kullanmaz) */
export async function resolveHomePublicIp(projectRoot: string): Promise<HomePublicIpResult> {
  const knownProxyIps = listKnownProxyExitIps(projectRoot);
  const measuredIp = measureRawPublicIp();

  if (measuredIp !== "unknown") {
    const sameAsPool = isKnownProxyIp(measuredIp, knownProxyIps);
    return {
      ip: measuredIp,
      measuredIp,
      isProxyIpDetected: sameAsPool,
      source: "measured",
      warning: sameAsPool
        ? `${measuredIp} ev interneti WAN IP — proxy havuzu kaydı ile aynı (ayrı proxy gate gerekmez).`
        : undefined,
    };
  }

  return {
    ip: "unavailable",
    measuredIp,
    isProxyIpDetected: false,
    source: "unavailable",
    warning: "Ev IP ölçülemedi — panelden tarayıcı ölçümü veya manuel IP girin.",
  };
}

/** Geriye dönük uyumluluk — mümkünse projectRoot ile resolveHomePublicIp kullanın */
export async function detectHomePublicIp(projectRoot?: string): Promise<string> {
  if (projectRoot) {
    const resolved = await resolveHomePublicIp(projectRoot);
    return resolved.ip === "unavailable" ? "unknown" : resolved.ip;
  }

  const measuredIp = measureRawPublicIp();
  return measuredIp;
}
