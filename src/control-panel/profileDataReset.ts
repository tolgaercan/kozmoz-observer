import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { logger } from "../utils/logger.js";
import { CDP_PORT_MAX, CDP_PORT_MIN } from "./cdpPortAllocator.js";
import { killProcessesOnPort } from "./cdpPortKill.js";
import type { ProcessRegistry } from "./processRegistry.js";

export interface ProfileDataResetResult {
  ok: true;
  stoppedProcesses: number;
  killedCdpPorts: number[];
  clearedPaths: string[];
  message: string;
}

function writeJsonFile(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function removeDirectoryContents(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
    return;
  }
  for (const entry of readdirSync(dirPath)) {
    rmSync(resolve(dirPath, entry), { recursive: true, force: true });
  }
}

function stopManagedProcesses(registry: ProcessRegistry): number {
  let stopped = 0;
  for (const proc of registry.list()) {
    if (proc.status !== "running" && proc.status !== "starting") {
      continue;
    }
    if (registry.kill(proc.id)) {
      stopped += 1;
    }
  }
  return stopped;
}

function killResidualCdpListeners(): number[] {
  const killed: number[] = [];
  for (let port = CDP_PORT_MIN; port <= CDP_PORT_MAX; port++) {
    const pids = killProcessesOnPort(port);
    if (pids.length > 0) {
      killed.push(port);
    }
  }
  return killed;
}

/**
 * Panel profil/worker kayıtlarını ve Chrome oturum klasörlerini sıfırlar.
 * .env ve panel proxy havuzu korunur.
 */
export function resetAllProfilePanelData(
  projectRoot: string,
  registry: ProcessRegistry,
): ProfileDataResetResult {
  const controlPanelDir = resolve(projectRoot, "data/control-panel");
  const manifestPath = resolve(projectRoot, "data/profiles/manifest.json");
  const chromeDir = resolve(projectRoot, "data/chrome");
  const sessionsDir = resolve(projectRoot, "data/sessions");
  const clearedPaths: string[] = [];

  const stoppedProcesses = stopManagedProcesses(registry);
  const killedCdpPorts = killResidualCdpListeners();

  const jsonResets: Array<{ path: string; data: unknown }> = [
    { path: resolve(controlPanelDir, "worker-config.json"), data: { workers: {} } },
    { path: resolve(controlPanelDir, "chrome-profiles.json"), data: { profiles: [] } },
    { path: resolve(controlPanelDir, "chrome-sessions.json"), data: { sessions: {} } },
    { path: resolve(controlPanelDir, "watcher-sessions.json"), data: { sessions: {} } },
    { path: resolve(controlPanelDir, "api-health.json"), data: { profiles: {} } },
    { path: resolve(controlPanelDir, "worker-runtime.json"), data: { workers: {} } },
    { path: manifestPath, data: { profiles: [] } },
    {
      path: resolve(projectRoot, "data/profile-queue.json"),
      data: {
        strategy: "sequential",
        activeProfileId: "",
        queue: [],
        poolFile: "data/profile-pool.json",
        notes: "Panelden profil ekleyin.",
      },
    },
  ];

  for (const { path, data } of jsonResets) {
    writeJsonFile(path, data);
    clearedPaths.push(path);
  }

  removeDirectoryContents(chromeDir);
  clearedPaths.push(`${chromeDir}/*`);
  removeDirectoryContents(sessionsDir);
  clearedPaths.push(`${sessionsDir}/*`);

  logger.warn(
    `[panel] Profil verileri sıfırlandı — ${stoppedProcesses} süreç durduruldu, ` +
      `${clearedPaths.length} kaynak temizlendi.`,
  );

  return {
    ok: true,
    stoppedProcesses,
    killedCdpPorts,
    clearedPaths,
    message:
      "Tüm profil kayıtları silindi. «+ Yeni profil» ile baştan oluşturun; Chrome ve watcher yeniden başlatılır.",
  };
}
