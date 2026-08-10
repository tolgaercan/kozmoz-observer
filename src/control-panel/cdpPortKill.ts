import { execSync } from "node:child_process";

import { isCdpEndpointReady } from "../browser/cdpConnector.js";
import { logger } from "../utils/logger.js";

function parseWindowsListeningPids(port: number): number[] {
  try {
    const output = execSync(`netstat -ano -p tcp | findstr :${port}`, {
      encoding: "utf-8",
      windowsHide: true,
    });
    const pids = new Set<number>();
    for (const line of output.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) {
        continue;
      }
      const parts = line.trim().split(/\s+/);
      const pid = Number.parseInt(parts[parts.length - 1] ?? "", 10);
      if (Number.isFinite(pid) && pid > 0) {
        pids.add(pid);
      }
    }
    return [...pids];
  } catch {
    return [];
  }
}

function parseUnixListeningPids(port: number): number[] {
  try {
    const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: "utf-8",
    });
    return output
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0);
  } catch {
    return [];
  }
}

export function findListeningPidsOnPort(port: number): number[] {
  if (process.platform === "win32") {
    return parseWindowsListeningPids(port);
  }
  return parseUnixListeningPids(port);
}

export function killProcessTree(pid: number): boolean {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /F /T`, { windowsHide: true });
    } else {
      process.kill(pid, "SIGTERM");
    }
    return true;
  } catch {
    return false;
  }
}

/** CDP portunu dinleyen Chrome süreçlerini sonlandırır. */
export function killProcessesOnPort(port: number): number[] {
  const killed: number[] = [];
  for (const pid of findListeningPidsOnPort(port)) {
    if (killProcessTree(pid)) {
      killed.push(pid);
      logger.info(`[chrome] Port ${port} dinleyen süreç sonlandırıldı (PID ${pid})`);
    }
  }
  return killed;
}

export async function waitForCdpPortFree(
  port: number,
  timeoutMs = 8000,
): Promise<boolean> {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listening = findListeningPidsOnPort(port);
    const ready = await isCdpEndpointReady(endpoint, { exact: true });
    if (listening.length === 0 && !ready) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return !(await isCdpEndpointReady(`http://127.0.0.1:${port}`, { exact: true }));
}
