import { isCdpEndpointReady } from "../browser/cdpConnector.js";
import type { ProcessRegistry } from "./processRegistry.js";

export const CDP_PORT_MIN = 9222;
export const CDP_PORT_MAX = 9230;

export function listReservedCdpPorts(registry: ProcessRegistry): Set<number> {
  const ports = new Set<number>();
  for (const proc of registry.list()) {
    if (
      (proc.kind === "chrome" || proc.kind === "api-watcher") &&
      proc.cdpPort &&
      (proc.status === "running" || proc.status === "starting")
    ) {
      ports.add(proc.cdpPort);
    }
  }
  return ports;
}

export async function isCdpPortFree(port: number, registry: ProcessRegistry): Promise<boolean> {
  if (listReservedCdpPorts(registry).has(port)) {
    return false;
  }
  return !(await isCdpEndpointReady(`http://127.0.0.1:${port}`, { exact: true }));
}

export async function allocateCdpPort(
  registry: ProcessRegistry,
  preferred?: number | null,
): Promise<number> {
  if (preferred && preferred >= CDP_PORT_MIN && preferred <= CDP_PORT_MAX) {
    if (await isCdpPortFree(preferred, registry)) {
      return preferred;
    }
  }

  for (let port = CDP_PORT_MIN; port <= CDP_PORT_MAX; port++) {
    if (await isCdpPortFree(port, registry)) {
      return port;
    }
  }

  throw new Error(
    `Boş CDP portu yok (${CDP_PORT_MIN}–${CDP_PORT_MAX}). Başka Chrome/watcher süreçlerini kapatın.`,
  );
}
