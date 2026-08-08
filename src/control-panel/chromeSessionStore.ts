import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { ProxyMode } from "./workerConfigStore.js";

/** Chrome Aç anında seçilen ağ + atanmış CDP portu — kalıcı Chrome profilinden ayrı */
export interface ChromeLaunchSession {
  profileId: string;
  assignedCdpPort: number;
  proxyMode: ProxyMode;
  proxyId?: string;
  proxyUrl?: string;
  lockedIp?: string;
  lastKnownHomeIp?: string;
  draftApi?: {
    dealerOffice: string;
    appointmentStyle: string;
    applicationType: string;
    nationalityNumber: string;
  };
  draftTiming?: {
    pollIntervalMs: number;
    telegramReportIntervalMs: number;
  };
  updatedAt: string;
}

interface ChromeSessionFile {
  sessions: Record<string, ChromeLaunchSession>;
}

export class ChromeSessionStore {
  private readonly storePath: string;

  constructor(projectRoot: string) {
    this.storePath = resolve(projectRoot, "data/control-panel/chrome-sessions.json");
    mkdirSync(dirname(this.storePath), { recursive: true });
  }

  private load(): ChromeSessionFile {
    if (!existsSync(this.storePath)) {
      return { sessions: {} };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.storePath, "utf-8")) as ChromeSessionFile;
      return { sessions: parsed.sessions ?? {} };
    } catch {
      return { sessions: {} };
    }
  }

  private save(store: ChromeSessionFile): void {
    writeFileSync(this.storePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  }

  get(profileId: string): ChromeLaunchSession | undefined {
    return this.load().sessions[profileId];
  }

  upsert(session: ChromeLaunchSession): ChromeLaunchSession {
    const store = this.load();
    store.sessions[session.profileId] = {
      ...session,
      updatedAt: new Date().toISOString(),
    };
    this.save(store);
    return store.sessions[session.profileId]!;
  }

  patch(profileId: string, patch: Partial<ChromeLaunchSession>): ChromeLaunchSession {
    const store = this.load();
    const existing = store.sessions[profileId] ?? {
      profileId,
      assignedCdpPort: 9222,
      proxyMode: "direct" as ProxyMode,
      updatedAt: new Date().toISOString(),
    };
    const next: ChromeLaunchSession = {
      ...existing,
      ...patch,
      profileId,
      updatedAt: new Date().toISOString(),
    };
    if ("draftApi" in patch && patch.draftApi === undefined) {
      delete next.draftApi;
    }
    if ("draftTiming" in patch && patch.draftTiming === undefined) {
      delete next.draftTiming;
    }
    store.sessions[profileId] = next;
    this.save(store);
    return store.sessions[profileId]!;
  }

  clear(profileId: string): void {
    const store = this.load();
    delete store.sessions[profileId];
    this.save(store);
  }
}
