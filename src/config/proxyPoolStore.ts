import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ProxyDefinition {
  id: string;
  label: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol?: "http" | "https";
  /** ipify / test ile doğrulanmış çıkış IP — panelde gösterilir */
  exitIp?: string;
  /** ProxyNet ISP statik WAN — HTTP proxy gate değil; Chrome --proxy-server kullanılmaz */
  ispStatic?: boolean;
  /** false ise panelde görünür ama "rezerve" etiketi alır */
  enabled?: boolean;
  /** Önerilen profiller — boş bırakılırsa otomatik eşleme yok */
  profiles?: string[];
}

export interface ProxyPoolFile {
  proxies: ProxyDefinition[];
}

export interface ProxyPanelOption {
  id: string;
  label: string;
  host: string;
  port: number;
  protocol: string;
  exitIp?: string;
  ispStatic?: boolean;
  enabled: boolean;
  profiles: string[];
  hasAuth: boolean;
}

function configDir(projectRoot: string): string {
  return resolve(projectRoot, "data/config");
}

function readPoolFile(path: string): ProxyPoolFile {
  if (!existsSync(path)) {
    return { proxies: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ProxyPoolFile;
    return { proxies: parsed.proxies ?? [] };
  } catch {
    return { proxies: [] };
  }
}

export class ProxyPoolStore {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  loadAll(): ProxyDefinition[] {
    const example = readPoolFile(resolve(configDir(this.projectRoot), "proxy-pool.example.json"));
    const local = readPoolFile(resolve(configDir(this.projectRoot), "proxy-pool.local.json"));
    const byId = new Map<string, ProxyDefinition>();
    for (const proxy of example.proxies) {
      byId.set(proxy.id, proxy);
    }
    for (const proxy of local.proxies) {
      byId.set(proxy.id, proxy);
    }
    return [...byId.values()];
  }

  getById(id: string): ProxyDefinition | undefined {
    return this.loadAll().find((proxy) => proxy.id === id);
  }

  listForPanel(): ProxyPanelOption[] {
    const localPath = resolve(configDir(this.projectRoot), "proxy-pool.local.json");
    const local = readPoolFile(localPath).proxies;
    // Panelde yalnızca gerçek proxy'ler (local). example.json şablon — dropdown'a karışmasın.
    const source =
      local.length > 0
        ? local
        : readPoolFile(resolve(configDir(this.projectRoot), "proxy-pool.example.json")).proxies.filter(
            (proxy) => !proxy.id.includes("example") && proxy.username !== "YOUR_USERNAME",
          );

    return source.map((proxy) => ({
      id: proxy.id,
      label: proxy.label,
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol ?? "http",
      exitIp: proxy.exitIp,
      ispStatic: proxy.ispStatic === true,
      enabled: proxy.enabled !== false,
      profiles: proxy.profiles ?? [],
      hasAuth: Boolean(proxy.username),
    }));
  }

  resolveForProfile(profileId: string, proxyId?: string): ProxyDefinition | undefined {
    if (proxyId) {
      return this.getById(proxyId);
    }
    return this.loadAll().find((proxy) => proxy.profiles?.includes(profileId));
  }
}

export function buildProxyUrl(def: ProxyDefinition): string {
  const protocol = def.protocol ?? "http";
  if (def.username) {
    return `${protocol}://${encodeURIComponent(def.username)}:${encodeURIComponent(def.password ?? "")}@${def.host}:${def.port}`;
  }
  return `${protocol}://${def.host}:${def.port}`;
}

/** Eski PROXY_POOL env satırları — geriye dönük uyumluluk */
export function parseProxyUrl(raw: string): ProxyDefinition | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    return {
      id: `env-${url.host}`,
      label: url.host,
      host: url.hostname,
      port: Number.parseInt(url.port || "80", 10),
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      protocol: url.protocol.replace(":", "") as "http" | "https",
    };
  } catch {
    const [host, port] = trimmed.split(":");
    if (!host) {
      return undefined;
    }
    return {
      id: `env-${host}`,
      label: host,
      host,
      port: Number.parseInt(port ?? "80", 10),
      protocol: "http",
    };
  }
}

export function readLegacyProxyPoolFromEnv(): ProxyDefinition[] {
  const raw = process.env.PROXY_POOL?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(/[,;\n]/)
    .map((part) => parseProxyUrl(part.trim()))
    .filter((item): item is ProxyDefinition => item !== undefined);
}
