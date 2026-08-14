import { isCdpEndpointReady } from "../browser/cdpConnector.js";
import type { ProcessRegistry } from "./processRegistry.js";

export const CDP_PORT_MIN = 9222;
/** Aynı makinede çoklu profil — port aralığı geniş tutulur. */
export const CDP_PORT_MAX = 9299;

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

export function mergeClaimedCdpPorts(
  registry: ProcessRegistry,
  extra?: Iterable<number | null | undefined>,
): Set<number> {
  const ports = listReservedCdpPorts(registry);
  if (extra) {
    for (const value of extra) {
      if (
        typeof value === "number" &&
        value >= CDP_PORT_MIN &&
        value <= CDP_PORT_MAX
      ) {
        ports.add(value);
      }
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
  claimed?: Iterable<number | null | undefined>,
): Promise<number> {
  const blocked = mergeClaimedCdpPorts(registry, claimed);

  if (preferred && preferred >= CDP_PORT_MIN && preferred <= CDP_PORT_MAX && !blocked.has(preferred)) {
    if (await isCdpPortFree(preferred, registry)) {
      return preferred;
    }
  }

  for (let port = CDP_PORT_MIN; port <= CDP_PORT_MAX; port++) {
    if (blocked.has(port)) {
      continue;
    }
    if (await isCdpPortFree(port, registry)) {
      return port;
    }
  }

  throw new Error(
    `Boş CDP portu yok (${CDP_PORT_MIN}–${CDP_PORT_MAX}). Kullanılmayan Chrome/watcher süreçlerini kapatın veya port alanını boş bırakın.`,
  );
}

/** Yeni profil oluştururken çakışmayı önlemek için sıradaki port (sync). */
export function suggestPreferredCdpPortSync(
  claimed?: Iterable<number | null | undefined>,
): number {
  const blocked = new Set<number>();
  if (claimed) {
    for (const value of claimed) {
      if (
        typeof value === "number" &&
        value >= CDP_PORT_MIN &&
        value <= CDP_PORT_MAX
      ) {
        blocked.add(value);
      }
    }
  }

  for (let port = CDP_PORT_MIN; port <= CDP_PORT_MAX; port++) {
    if (!blocked.has(port)) {
      return port;
    }
  }

  return CDP_PORT_MAX;
}
