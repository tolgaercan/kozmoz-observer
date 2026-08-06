import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { exec } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";
import { ControlPanelService } from "./controlPanelService.js";
import { ProcessRegistry } from "./processRegistry.js";
import type { WorkerConfig } from "./workerConfigStore.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const PUBLIC_DIR = resolve(PROJECT_ROOT, "public/control-panel");

loadSettings(PROJECT_ROOT);
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

  if (method === "GET" && pathname === "/api/network/ip") {
    const url = new URL(req.url ?? "", "http://local");
    const profileId = url.searchParams.get("profileId") ?? "profile-1";
    const proxyMode = url.searchParams.get("proxyMode");
    const proxyId = url.searchParams.get("proxyId");
    const measureViaChrome = url.searchParams.get("measureViaChrome") !== "false";
    const skipServerMeasure = url.searchParams.get("skipServerMeasure") === "true";
    const data = await service.getNetworkIp(
      profileId,
      {
        proxyMode: proxyMode === "proxy" || proxyMode === "direct" ? proxyMode : undefined,
        proxyId: proxyId ?? undefined,
      },
      { measureViaChrome, autoLock: true, skipServerMeasure },
    );
    sendJson(res, 200, data);
    return;
  }

  if (method === "POST" && pathname === "/api/network/set-home-ip") {
    const body = await readJsonBody<{ profileId: string; ip: string }>(req);
    const data = await service.setManualHomeIp(body.profileId, body.ip);
    sendJson(res, 200, data);
    return;
  }

  if (method === "POST" && pathname === "/api/network/ensure-home-ip") {
    const body = await readJsonBody<{ profileId: string; ip?: string }>(req);
    const data = await service.ensureDirectHomeIpPublic(body.profileId, body.ip);
    sendJson(res, 200, data);
    return;
  }

  if (method === "POST" && pathname === "/api/run/api-watcher-workflow") {
    const body = await readJsonBody<{
      profileId: string;
      api: { dealerOffice: string; appointmentStyle: string };
      timing?: { pollIntervalMs?: number; telegramReportIntervalMs?: number };
    }>(req);
    const result = await service.startApiWatcherWorkflow(body.profileId, body.api, body.timing);
    sendJson(res, 200, result);
    return;
  }

  if (method === "POST" && pathname === "/api/run/api-watcher/stop") {
    const body = await readJsonBody<{ profileId: string }>(req);
    const result = service.stopApiWatcher(body.profileId);
    sendJson(res, 200, result);
    return;
  }

  if (method === "GET" && pathname === "/api/diagnostics/validate-api-dates") {
    const report = service.runApiDateValidation();
    sendJson(res, 200, report);
    return;
  }

  if (method === "POST" && pathname === "/api/process/runtime-config") {
    const body = await readJsonBody<{
      processId: string;
      pollIntervalMs?: number;
      telegramReportIntervalMs?: number;
    }>(req);
    if (!body.processId?.trim()) {
      sendJson(res, 400, { error: "processId gerekli" });
      return;
    }
    const result = service.updateProcessRuntimeConfig(body.processId, {
      pollIntervalMs: body.pollIntervalMs,
      telegramReportIntervalMs: body.telegramReportIntervalMs,
    });
    sendJson(res, 200, result);
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

function openPanelInBrowser(url: string): void {
  if (process.env.CONTROL_PANEL_OPEN_BROWSER === "false") {
    return;
  }
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (error) => {
    if (error) {
      logger.warn(`[panel] Tarayıcı açılamadı: ${error.message}`);
    }
  });
}

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  logger.info(`Kozmoz Control Panel → ${url}`);
  openPanelInBrowser(url);
});
