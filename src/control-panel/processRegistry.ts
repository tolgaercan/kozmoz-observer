import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

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
    if (!child && !record?.pid) {
      if (record) {
        record.status = "exited";
        record.exitedAt = new Date().toISOString();
      }
      return false;
    }

    try {
      if (child?.pid) {
        process.kill(child.pid, "SIGTERM");
      } else if (record?.pid) {
        process.kill(record.pid, "SIGTERM");
      }
      if (record) {
        record.status = "exited";
        record.exitedAt = new Date().toISOString();
      }
      this.childById.delete(id);
      return true;
    } catch (error) {
      if (record) {
        record.lastError = error instanceof Error ? error.message : String(error);
      }
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
