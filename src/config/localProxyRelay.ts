import http from "node:http";
import net from "node:net";

import type { ProxyDefinition } from "./proxyPoolStore.js";
import { logger } from "../utils/logger.js";

const relays = new Map<string, { server: http.Server; port: number }>();

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf-8").toString("base64")}`;
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
    const upstream = net.connect(upstreamPort, upstreamHost, () => {
      const path = clientReq.url ?? "/";
      const headers = [
        `${clientReq.method ?? "GET"} ${path} HTTP/1.1`,
        `Host: ${clientReq.headers.host ?? upstreamHost}`,
        `Proxy-Authorization: ${authHeader}`,
      ];
      for (const [key, value] of Object.entries(clientReq.headers)) {
        if (key.toLowerCase() === "host" || key.toLowerCase() === "proxy-authorization") {
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            headers.push(`${key}: ${item}`);
          }
        } else if (value) {
          headers.push(`${key}: ${value}`);
        }
      }
      headers.push("", "");
      upstream.write(headers.join("\r\n"));
      clientReq.pipe(upstream);
      upstream.pipe(clientRes);
    });
    upstream.on("error", (error) => {
      clientRes.writeHead(502);
      clientRes.end(error.message);
    });
  });

  server.on("connect", (req, clientSocket, head) => {
    const target = req.url ?? "";
    const upstream = net.connect(upstreamPort, upstreamHost, () => {
      upstream.write(
        `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: ${authHeader}\r\n\r\n`,
      );
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) {
        upstream.write(head);
      }
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => {
      clientSocket.end();
    });
    clientSocket.on("error", () => {
      upstream.end();
    });
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
