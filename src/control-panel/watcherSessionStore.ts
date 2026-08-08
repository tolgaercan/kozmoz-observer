import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { WorkerApiParams, WorkerTimingParams, ProxyMode } from "./workerConfigStore.js";

export interface WatcherSessionNetwork {
  proxyMode: ProxyMode;
  proxyId?: string;
  proxyUrl?: string;
  lockedIp: string;
  assignedCdpPort: number;
}

export interface WatcherSession {
  profileId: string;
  network: WatcherSessionNetwork;
  api: WorkerApiParams;
  timing: WorkerTimingParams;
  startedAt: string;
  updatedAt: string;
}

interface WatcherSessionFile {
  sessions: Record<string, WatcherSession>;
}

export class WatcherSessionStore {
  private readonly storePath: string;

  constructor(projectRoot: string) {
    this.storePath = resolve(projectRoot, "data/control-panel/watcher-sessions.json");
    mkdirSync(dirname(this.storePath), { recursive: true });
  }

  private load(): WatcherSessionFile {
    if (!existsSync(this.storePath)) {
      return { sessions: {} };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.storePath, "utf-8")) as WatcherSessionFile;
      return { sessions: parsed.sessions ?? {} };
    } catch {
      return { sessions: {} };
    }
  }

  private save(store: WatcherSessionFile): void {
    writeFileSync(this.storePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  }

  get(profileId: string): WatcherSession | undefined {
    return this.load().sessions[profileId];
  }

  list(): WatcherSession[] {
    return Object.values(this.load().sessions);
  }

  upsert(session: WatcherSession): WatcherSession {
    const store = this.load();
    const now = new Date().toISOString();
    store.sessions[session.profileId] = {
      ...session,
      updatedAt: now,
      startedAt: session.startedAt || now,
    };
    this.save(store);
    return store.sessions[session.profileId]!;
  }

  clear(profileId: string): void {
    const store = this.load();
    delete store.sessions[profileId];
    this.save(store);
  }
}
