import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "../utils/logger.js";
import { ControlPanelService } from "./controlPanelService.js";
import { ProcessRegistry } from "./processRegistry.js";
import type { WorkerConfig } from "./workerConfigStore.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const PUBLIC_DIR = resolve(PROJECT_ROOT, "public/control-panel");
const PORT = Number.parseInt(process.env.CONTROL_PANEL_PORT ?? "8787", 10);

const registry = new ProcessRegistry();
const service = new ControlPanelService(PROJECT_ROOT, registry);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    return {} as T;
  }
  return JSON.parse(raw) as T;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body)}\n`);
}

function serveStatic(pathname: string, res: ServerResponse): boolean {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(PUBLIC_DIR, `.${safePath}`);
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    return false;
  }
  const ext = extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  res.end(readFileSync(filePath));
  return true;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const method = req.method ?? "GET";

  if (method === "GET" && pathname === "/api/bootstrap") {
    const profileId = new URL(req.url ?? "", "http://local").searchParams.get("profileId") ?? "profile-1";
    const data = await service.getBootstrap(profileId);
    sendJson(res, 200, data);
    return;
  }

  if (method === "GET" && pathname === "/api/processes") {
    sendJson(res, 200, { processes: service.listProcesses() });
    return;
  }

  if (method === "GET" && pathname === "/api/status") {
    const profileId = new URL(req.url ?? "", "http://local").searchParams.get("profileId") ?? "profile-1";
    const status = await service.getProfileStatus(profileId);
    sendJson(res, 200, status);
    return;
  }

  if (method === "GET" && pathname === "/api/api-health") {
    const data = await service.getAllApiHealth();
    sendJson(res, 200, data);
    return;
  }

  if (method === "POST" && pathname === "/api/worker-config") {
    const body = await readJsonBody<{ profileId: string; config: Partial<WorkerConfig> }>(req);
    const saved = service.saveWorkerConfig(body.profileId, body.config ?? {});
    sendJson(res, 200, { worker: saved });
    return;
  }

  if (method === "POST" && pathname === "/api/chrome/start") {
    const body = await readJsonBody<{ profileId: string }>(req);
    const result = await service.startChrome(body.profileId);
    sendJson(res, result.launch.ok ? 200 : 500, result);
    return;
  }

  if (method === "POST" && pathname === "/api/run/api-watcher") {
    const body = await readJsonBody<{
      profileId: string;
      api: { dealerOffice: string; appointmentStyle: string };
    }>(req);
    service.saveWorkerConfig(body.profileId, { api: body.api });
    const process = service.startApiWatcher(body.profileId, body.api);
    sendJson(res, 200, { process });
    return;
  }

  if (method === "POST" && pathname === "/api/run/dom-observer") {
    const body = await readJsonBody<{ profileId: string }>(req);
    const process = service.startDomObserver(body.profileId);
    sendJson(res, 200, { process });
    return;
  }

  if (method === "POST" && pathname === "/api/process/kill") {
    const body = await readJsonBody<{ processId: string }>(req);
    const ok = service.killProcess(body.processId);
    sendJson(res, ok ? 200 : 404, { ok, processes: service.listProcesses() });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    if (serveStatic(url.pathname, res)) {
      return;
    }
    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    logger.error(`[panel] ${error instanceof Error ? error.message : String(error)}`);
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  logger.info(`Kozmoz Control Panel → http://127.0.0.1:${PORT}`);
});
