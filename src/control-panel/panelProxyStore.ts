import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface PanelProxyEntry {
  id: string;
  label: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol?: "http" | "https";
  exitIp?: string;
  ispStatic?: boolean;
  enabled?: boolean;
  profiles?: string[];
  createdAt: string;
  updatedAt: string;
}

interface PanelProxyFile {
  proxies: PanelProxyEntry[];
}

function slugifyProxyId(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base ? `proxy-${base}` : `proxy-${Date.now()}`;
}

export class PanelProxyStore {
  private readonly storePath: string;

  constructor(projectRoot: string) {
    this.storePath = resolve(projectRoot, "data/control-panel/proxy-pool.json");
    mkdirSync(dirname(this.storePath), { recursive: true });
  }

  private load(): PanelProxyFile {
    if (!existsSync(this.storePath)) {
      return { proxies: [] };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.storePath, "utf-8")) as PanelProxyFile;
      return { proxies: Array.isArray(parsed.proxies) ? parsed.proxies : [] };
    } catch {
      return { proxies: [] };
    }
  }

  private save(store: PanelProxyFile): void {
    writeFileSync(this.storePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  }

  listAll(): PanelProxyEntry[] {
    return this.load().proxies;
  }

  listEnabled(): PanelProxyEntry[] {
    return this.load().proxies.filter((p) => p.enabled !== false);
  }

  get(id: string): PanelProxyEntry | undefined {
    return this.load().proxies.find((p) => p.id === id);
  }

  getOrThrow(id: string): PanelProxyEntry {
    const entry = this.get(id);
    if (!entry) {
      throw new Error(`Proxy kaydı bulunamadı: ${id}`);
    }
    return entry;
  }

  create(input: {
    label: string;
    host: string;
    port: number;
    id?: string;
    username?: string;
    password?: string;
    protocol?: "http" | "https";
    exitIp?: string;
    ispStatic?: boolean;
    enabled?: boolean;
    profiles?: string[];
  }): PanelProxyEntry {
    const store = this.load();
    const id = input.id?.trim() || slugifyProxyId(input.label);
    if (store.proxies.some((p) => p.id === id)) {
      throw new Error(`Proxy id zaten var: ${id}`);
    }

    const port = Number(input.port);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      throw new Error("Geçerli bir port girin (1–65535).");
    }

    const host = input.host.trim();
    if (!host) {
      throw new Error("Host zorunlu.");
    }

    const now = new Date().toISOString();
    const entry: PanelProxyEntry = {
      id,
      label: input.label.trim(),
      host,
      port,
      username: input.username?.trim() || undefined,
      password: input.password?.trim() || undefined,
      protocol: input.protocol ?? "http",
      exitIp: input.exitIp?.trim() || undefined,
      ispStatic: input.ispStatic === true,
      enabled: input.enabled !== false,
      profiles: input.profiles?.filter(Boolean) ?? [],
      createdAt: now,
      updatedAt: now,
    };

    store.proxies.push(entry);
    this.save(store);
    return entry;
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        PanelProxyEntry,
        | "label"
        | "host"
        | "port"
        | "username"
        | "password"
        | "protocol"
        | "exitIp"
        | "ispStatic"
        | "enabled"
        | "profiles"
      >
    >,
  ): { entry: PanelProxyEntry; passwordUpdated: boolean } {
    const store = this.load();
    const index = store.proxies.findIndex((p) => p.id === id);
    if (index < 0) {
      throw new Error(`Proxy kaydı bulunamadı: ${id}`);
    }

    const existing = store.proxies[index]!;
    const { password, port, ...rest } = patch;

    let passwordUpdated = false;
    let nextPassword = existing.password;
    if (password !== undefined) {
      const trimmed = password.trim();
      if (trimmed !== "" && trimmed !== existing.password) {
        nextPassword = trimmed;
        passwordUpdated = true;
      }
    }

    const nextPort = port !== undefined ? Number(port) : existing.port;
    if (!Number.isFinite(nextPort) || nextPort < 1 || nextPort > 65535) {
      throw new Error("Geçerli bir port girin (1–65535).");
    }

    const next: PanelProxyEntry = {
      ...existing,
      ...rest,
      port: nextPort,
      password: nextPassword,
      host: patch.host !== undefined ? patch.host.trim() : existing.host,
      label: patch.label !== undefined ? patch.label.trim() : existing.label,
      profiles: patch.profiles !== undefined ? patch.profiles.filter(Boolean) : existing.profiles,
      updatedAt: new Date().toISOString(),
    };

    if (!next.host) {
      throw new Error("Host zorunlu.");
    }
    if (!next.label) {
      throw new Error("Etiket zorunlu.");
    }

    store.proxies[index] = next;
    this.save(store);
    return { entry: next, passwordUpdated };
  }

  updateExitIp(id: string, exitIp: string): PanelProxyEntry {
    return this.update(id, { exitIp: exitIp.trim() }).entry;
  }

  delete(id: string): void {
    const store = this.load();
    const next = store.proxies.filter((p) => p.id !== id);
    if (next.length === store.proxies.length) {
      throw new Error(`Proxy kaydı bulunamadı: ${id}`);
    }
    store.proxies = next;
    this.save(store);
  }

  replaceAll(proxies: PanelProxyEntry[]): void {
    this.save({ proxies });
  }

  getStorePath(): string {
    return this.storePath;
  }
}
