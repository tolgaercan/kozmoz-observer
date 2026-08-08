import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import { isCdpEndpointReady } from "../browser/cdpConnector.js";

export type ManagedProcessKind = "chrome" | "api-watcher" | "dom-observer";

export type ManagedProcessStatus = "starting" | "running" | "exited" | "failed";

export interface ManagedProcess {
  id: string;
  kind: ManagedProcessKind;
  profileId: string;
  label: string;
  pid?: number;
  status: ManagedProcessStatus;
  startedAt: string;
  exitedAt?: string;
  exitCode?: number | null;
  lastError?: string;
  /** Chrome için CDP port */
  cdpPort?: number;
}

export class ProcessRegistry {
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly childById = new Map<string, ChildProcess>();

  list(): ManagedProcess[] {
    return [...this.processes.values()].sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt),
    );
  }

  get(id: string): ManagedProcess | undefined {
    return this.processes.get(id);
  }

  findByProfile(profileId: string, kind?: ManagedProcessKind): ManagedProcess[] {
    return this.list().filter(
      (entry) =>
        entry.profileId === profileId &&
        (!kind || entry.kind === kind) &&
        (entry.status === "running" || entry.status === "starting"),
    );
  }

  listActive(): ManagedProcess[] {
    return this.list().filter(
      (entry) => entry.status === "running" || entry.status === "starting",
    );
  }

  remove(id: string): boolean {
    this.childById.delete(id);
    return this.processes.delete(id);
  }

  markExited(id: string, message?: string): void {
    const record = this.processes.get(id);
    if (!record) {
      return;
    }
    record.status = "exited";
    record.exitedAt = new Date().toISOString();
    if (message) {
      record.lastError = message;
    }
    this.childById.delete(id);
  }

  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async reconcile(): Promise<void> {
    for (const record of this.listActive()) {
      if (record.kind === "chrome" && record.cdpPort) {
        const endpoint = `http://127.0.0.1:${record.cdpPort}`;
        const ready = await isCdpEndpointReady(endpoint, { exact: true });
        if (!ready) {
          this.markExited(record.id, "Chrome kapatıldı (CDP yanıt vermiyor)");
          continue;
        }
      }

      if (record.pid && !this.isPidAlive(record.pid)) {
        this.markExited(record.id, "Süreç PID artık çalışmıyor");
      }
    }
  }

  register(entry: Omit<ManagedProcess, "id" | "startedAt" | "status"> & { status?: ManagedProcessStatus }): ManagedProcess {
    const record: ManagedProcess = {
      id: randomUUID(),
      status: entry.status ?? "starting",
      startedAt: new Date().toISOString(),
      ...entry,
    };
    this.processes.set(record.id, record);
    return record;
  }

  attachChild(id: string, child: ChildProcess): void {
    this.childById.set(id, child);
    const record = this.processes.get(id);
    if (record && child.pid) {
      record.pid = child.pid;
      record.status = "running";
    }

    child.on("exit", (code, signal) => {
      const current = this.processes.get(id);
      if (!current) {
        return;
      }
      current.status = code === 0 ? "exited" : "failed";
      current.exitCode = code;
      current.exitedAt = new Date().toISOString();
      if (signal) {
        current.lastError = `Sinyal: ${signal}`;
      }
      this.childById.delete(id);
    });

    child.on("error", (error) => {
      const current = this.processes.get(id);
      if (!current) {
        return;
      }
      current.status = "failed";
      current.lastError = error.message;
      current.exitedAt = new Date().toISOString();
      this.childById.delete(id);
    });
  }

  markRunning(id: string, patch: Partial<ManagedProcess> = {}): void {
    const record = this.processes.get(id);
    if (!record) {
      return;
    }
    Object.assign(record, patch, { status: "running" });
  }

  markFailed(id: string, message: string): void {
    const record = this.processes.get(id);
    if (!record) {
      return;
    }
    record.status = "failed";
    record.lastError = message;
    record.exitedAt = new Date().toISOString();
  }

  kill(id: string): boolean {
    const child = this.childById.get(id);
    const record = this.processes.get(id);
    if (!record) {
      return false;
    }

    if (record.status === "exited" || record.status === "failed") {
      this.remove(id);
      return true;
    }

    if (!child && !record.pid) {
      this.markExited(id, "Süreç zaten kapalı");
      return true;
    }

    try {
      if (child?.pid) {
        process.kill(child.pid, "SIGTERM");
      } else if (record.pid) {
        process.kill(record.pid, "SIGTERM");
      }
      this.markExited(id);
      return true;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "ESRCH") {
        this.markExited(id, "Süreç zaten sonlanmış");
        return true;
      }
      record.lastError = error instanceof Error ? error.message : String(error);
      record.status = "failed";
      record.exitedAt = new Date().toISOString();
      this.childById.delete(id);
      return false;
    }
  }

  spawnManaged(
    kind: ManagedProcessKind,
    profileId: string,
    label: string,
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv; cdpPort?: number },
  ): ManagedProcess {
    const record = this.register({ kind, profileId, label, cdpPort: options.cdpPort });
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    const logPrefix = `[${kind}:${profileId}]`;
    child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(`${logPrefix} ${chunk.toString()}`);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`${logPrefix} ${chunk.toString()}`);
    });

    this.attachChild(record.id, child);
    return record;
  }
}
