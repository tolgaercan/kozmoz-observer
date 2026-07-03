import https from "node:https";
import tls from "node:tls";

import { logger } from "../utils/logger.js";

export interface TelegramHttpOptions {
  tlsInsecure: boolean;
  timeoutMs: number;
}

let insecureWarningLogged = false;

function createAgent(tlsInsecure: boolean): https.Agent {
  if (tlsInsecure) {
    if (!insecureWarningLogged) {
      insecureWarningLogged = true;
      logger.warn(
        "TELEGRAM_TLS_INSECURE=true — Telegram için TLS sertifika doğrulaması kapalı.",
      );
    }
    return new https.Agent({ rejectUnauthorized: false });
  }

  const ca =
    typeof tls.getCACertificates === "function" ? tls.getCACertificates("default") : undefined;

  return new https.Agent(ca && ca.length > 0 ? { ca } : {});
}

export function postTelegramJson(
  url: string,
  body: unknown,
  options: TelegramHttpOptions,
): Promise<{ status: number; body: string }> {
  const payload = JSON.stringify(body);
  const parsedUrl = new URL(url);
  const agent = createAgent(options.tlsInsecure);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: "POST",
        agent,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error(`Telegram isteği zaman aşımı (${options.timeoutMs}ms)`));
    });

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}
