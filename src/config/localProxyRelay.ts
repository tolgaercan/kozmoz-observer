import http from "node:http";
import net from "node:net";

import type { ProxyDefinition } from "./proxyPoolStore.js";
import { logger } from "../utils/logger.js";

const relays = new Map<string, { server: http.Server; port: number }>();

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf-8").toString("base64")}`;
}

function relayConnectThroughUpstream(
  clientSocket: net.Socket,
  upstreamHost: string,
  upstreamPort: number,
  target: string,
  authHeader: string,
  head: Buffer,
): void {
  const upstream = net.connect(upstreamPort, upstreamHost);

  upstream.once("connect", () => {
    upstream.write(
      `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: ${authHeader}\r\nProxy-Connection: keep-alive\r\n\r\n`,
    );
  });

  let headerBuffer = Buffer.alloc(0);
  const onUpstreamData = (chunk: Buffer) => {
    headerBuffer = Buffer.concat([headerBuffer, chunk]);
    const headerEnd = headerBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return;
    }

    upstream.removeListener("data", onUpstreamData);
    const statusLine = headerBuffer.subarray(0, headerBuffer.indexOf("\r\n")).toString("utf-8");
    if (!/^HTTP\/\d(?:\.\d)?\s+200/i.test(statusLine)) {
      logger.warn(`[proxy] CONNECT upstream rejected (${target}): ${statusLine}`);
      clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\n\r\n`);
      clientSocket.end();
      upstream.destroy();
      return;
    }

    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    const remaining = headerBuffer.subarray(headerEnd + 4);
    if (remaining.length > 0) {
      clientSocket.write(remaining);
    }
    if (head.length > 0) {
      upstream.write(head);
    }

    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  };

  upstream.on("data", onUpstreamData);
  upstream.on("error", (error) => {
    logger.warn(`[proxy] CONNECT upstream error (${target}): ${error.message}`);
    clientSocket.destroy();
  });
  clientSocket.on("error", () => {
    upstream.destroy();
  });
  clientSocket.on("close", () => {
    upstream.destroy();
  });
}

function relayHttpThroughUpstream(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
  upstreamHost: string,
  upstreamPort: number,
  authHeader: string,
): void {
  const upstream = net.connect(upstreamPort, upstreamHost, () => {
    const path = clientReq.url ?? "/";
    const lines = [
      `${clientReq.method ?? "GET"} ${path} HTTP/1.1`,
      `Host: ${clientReq.headers.host ?? upstreamHost}`,
      `Proxy-Authorization: ${authHeader}`,
    ];
    for (const [key, value] of Object.entries(clientReq.headers)) {
      const lower = key.toLowerCase();
      if (lower === "host" || lower === "proxy-authorization" || lower === "proxy-connection") {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          lines.push(`${key}: ${item}`);
        }
      } else if (value) {
        lines.push(`${key}: ${value}`);
      }
    }
    lines.push("", "");
    upstream.write(lines.join("\r\n"));
    clientReq.pipe(upstream);
    upstream.pipe(clientRes);
  });

  upstream.on("error", (error) => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502);
    }
    clientRes.end(error.message);
  });
}

/**
 * Chrome --proxy-server user:pass desteklemez.
 * Upstream auth proxy için localhost relay (auth'suz) başlatır.
 */
export async function ensureLocalProxyRelay(def: ProxyDefinition): Promise<string> {
  if (!def.username) {
    return `${def.host}:${def.port}`;
  }

  const cached = relays.get(def.id);
  if (cached) {
    return `127.0.0.1:${cached.port}`;
  }

  const authHeader = basicAuthHeader(def.username, def.password ?? "");
  const upstreamHost = def.host;
  const upstreamPort = def.port;

  const server = http.createServer((clientReq, clientRes) => {
    relayHttpThroughUpstream(clientReq, clientRes, upstreamHost, upstreamPort, authHeader);
  });

  server.on("connect", (req, clientSocket, head) => {
    const target = req.url ?? "";
    relayConnectThroughUpstream(
      clientSocket as net.Socket,
      upstreamHost,
      upstreamPort,
      target,
      authHeader,
      head,
    );
  });

  const port = await new Promise<number>((resolvePort, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Local proxy relay port alınamadı"));
        return;
      }
      resolvePort(address.port);
    });
    server.on("error", reject);
  });

  relays.set(def.id, { server, port });
  logger.info(`[proxy] Local relay ${def.id} → 127.0.0.1:${port} → ${upstreamHost}:${upstreamPort}`);
  return `127.0.0.1:${port}`;
}
