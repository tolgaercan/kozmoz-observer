import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type ProxyMode = "direct" | "proxy";

export interface WorkerApiParams {
  dealerOffice: string;
  appointmentStyle: string;
}

export interface WorkerConfig {
  profileId: string;
  proxyMode: ProxyMode;
  /** Ev interneti veya proxy IP — kilitleme için */
  lockedIp: string;
  /** İleride: http://user:pass@host:port */
  proxyUrl?: string;
  /** data/config/proxy-pool.local.json içindeki id */
  proxyId?: string;
  api: WorkerApiParams;
  updatedAt: string;
}

export interface ControlPanelStore {
  defaultProfileId?: string;
  workers: Record<string, WorkerConfig>;
}

function defaultWorkerConfig(profileId: string, lockedIp: string): WorkerConfig {
  return {
    profileId,
    proxyMode: "direct",
    lockedIp,
    api: {
      dealerOffice: "Ankara",
      appointmentStyle: "Standart",
    },
    updatedAt: new Date().toISOString(),
  };
}

export class WorkerConfigStore {
  private readonly storePath: string;

  constructor(projectRoot: string) {
    this.storePath = resolve(projectRoot, "data/control-panel/worker-config.json");
  }

  load(): ControlPanelStore {
    if (!existsSync(this.storePath)) {
      return { workers: {} };
    }
    try {
      const raw = readFileSync(this.storePath, "utf-8");
      return JSON.parse(raw) as ControlPanelStore;
    } catch {
      return { workers: {} };
    }
  }

  save(store: ControlPanelStore): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    writeFileSync(this.storePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  }

  getWorker(profileId: string, fallbackIp: string): WorkerConfig {
    const store = this.load();
    return store.workers[profileId] ?? defaultWorkerConfig(profileId, fallbackIp);
  }

  updateWorker(profileId: string, patch: Partial<WorkerConfig>): WorkerConfig {
    const store = this.load();
    const existing = store.workers[profileId] ?? defaultWorkerConfig(profileId, patch.lockedIp ?? "");
    const next: WorkerConfig = {
      ...existing,
      ...patch,
      profileId,
      api: { ...existing.api, ...patch.api },
      updatedAt: new Date().toISOString(),
    };
    store.workers[profileId] = next;
    store.defaultProfileId = store.defaultProfileId ?? profileId;
    this.save(store);
    return next;
  }
}
