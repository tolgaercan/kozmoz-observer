import https from "node:https";
import tls from "node:tls";

import { logger } from "../utils/logger.js";

/** Canlı OTP önbelleği — otomasyon buradan okur (telefon başına tek satır, UPSERT). */
export const OTP_BY_PHONE_TABLE = "otp_by_phone";

/** Geçmiş / arşiv — append-only log; polling için kullanılmaz. */
export const OTP_CODES_HISTORY_TABLE = "otp_codes";

const DEFAULT_TABLE = OTP_BY_PHONE_TABLE;

export interface SupabaseOtpConfig {
  sbUrl: string;
  serviceKey: string;
  table?: string;
}

/** Portal SMS OTP bekleme — popup süresi ~3 dk; marj ile 3.5 dk. */
export const DEFAULT_SUPABASE_OTP_TIMEOUT_MS = 210_000;

export interface WaitSupabaseOtpOptions {
  /** Toplam bekleme süresi (ms). Varsayılan 210000 (3.5 dk). */
  timeoutMs?: number;
  /** Poll aralığı (ms). Varsayılan 2000. */
  intervalMs?: number;
  /** Okunduktan sonra `used=true` işaretle. Varsayılan true. */
  consume?: boolean;
  /**
   * Yalnızca bu zamandan sonra gelen OTP'leri kabul et (ör. «kodu gönder» tıklanmadan hemen önce).
   * Verilmezse expires_at > now + used=false yeterli.
   */
  since?: Date | string;
  sbUrl?: string;
  serviceKey?: string;
  table?: string;
}

export interface SupabaseOtpRow {
  otp: string;
  received_at?: string;
  phone?: string;
  expires_at?: string;
  used?: boolean;
}

/** TR numarası → son 10 hane (5XXXXXXXXX). */
export function normalizePhoneLast10(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) {
    throw new Error(`Geçersiz telefon numarası (en az 10 hane): ${phone}`);
  }
  return digits.slice(-10);
}

export function resolveSupabaseOtpConfig(
  overrides?: Partial<SupabaseOtpConfig>,
): SupabaseOtpConfig {
  const sbUrl = (overrides?.sbUrl ?? process.env.SB_URL ?? process.env.SUPABASE_URL)?.trim();
  const serviceKey = (
    overrides?.serviceKey ??
    process.env.SB_SERVICE_KEY ??
    process.env.SB_SERVICE ??
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();

  if (!sbUrl) {
    throw new Error("Supabase URL tanımlı değil (SB_URL veya SUPABASE_URL).");
  }
  if (!serviceKey) {
    throw new Error("Supabase service key tanımlı değil (SB_SERVICE_KEY veya SB_SERVICE).");
  }

  return {
    sbUrl: sbUrl.replace(/\/$/, ""),
    serviceKey,
    table: overrides?.table ?? DEFAULT_TABLE,
  };
}

/** `.env` içinde SB_URL + service key tanımlı mı (hata fırlatmaz). */
export function isSupabaseOtpConfigured(overrides?: Partial<SupabaseOtpConfig>): boolean {
  try {
    resolveSupabaseOtpConfig(overrides);
    return true;
  } catch {
    return false;
  }
}

/** REST erişimini doğrular — tabloya en az bir HEAD/GET isteği. */
export async function verifySupabaseOtpConnection(
  overrides?: Partial<SupabaseOtpConfig>,
): Promise<{ ok: boolean; message: string }> {
  const config = resolveSupabaseOtpConfig(overrides);
  const url = `${config.sbUrl}/rest/v1/${config.table}?select=phone&limit=1`;

  try {
    const response = await supabaseFetch(url, { headers: authHeaders(config.serviceKey) });
    if (response.ok) {
      return {
        ok: true,
        message: `Supabase bağlantısı OK (${config.table}, ${config.sbUrl})`,
      };
    }
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      message: `Supabase sorgusu başarısız (${response.status}): ${body.slice(0, 200)}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Supabase bağlantı hatası: ${msg}` };
  }
}

function authHeaders(serviceKey: string): Record<string, string> {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

function isSupabaseTlsInsecure(): boolean {
  return (
    process.env.SB_TLS_INSECURE === "true" ||
    process.env.TELEGRAM_TLS_INSECURE === "true"
  );
}

function createSupabaseHttpsAgent(): https.Agent {
  if (isSupabaseTlsInsecure()) {
    return new https.Agent({ rejectUnauthorized: false });
  }

  const ca =
    typeof tls.getCACertificates === "function" ? tls.getCACertificates("default") : undefined;

  return new https.Agent(ca && ca.length > 0 ? { ca } : {});
}

interface SupabaseHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** Antivirüs/kurumsal proxy TLS kesintisi — Telegram ile aynı .env bayrağı. */
function supabaseFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<SupabaseHttpResponse> {
  const parsed = new URL(url);
  const agent = createSupabaseHttpsAgent();

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: init.method ?? "GET",
        agent,
        headers: init.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          const status = response.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: async () => body,
            json: async () => JSON.parse(body) as unknown,
          });
        });
      },
    );

    request.on("error", reject);
    if (init.body) {
      request.write(init.body);
    }
    request.end();
  });
}

function buildOtpQueryUrl(
  config: SupabaseOtpConfig,
  phoneLast10: string,
  since?: Date | string,
): string {
  const nowIso = new Date().toISOString();
  const params = new URLSearchParams();
  params.set("phone", `eq.${phoneLast10}`);
  params.set("expires_at", `gt.${nowIso}`);
  params.set("used", "eq.false");
  params.set("select", "otp,received_at,phone,expires_at");
  params.set("order", "received_at.desc");
  params.set("limit", "1");

  if (since) {
    const sinceIso = since instanceof Date ? since.toISOString() : since;
    params.set("received_at", `gt.${sinceIso}`);
  }

  return `${config.sbUrl}/rest/v1/${config.table}?${params.toString()}`;
}

async function fetchLatestOtp(
  config: SupabaseOtpConfig,
  phoneLast10: string,
  since?: Date | string,
): Promise<SupabaseOtpRow | undefined> {
  const url = buildOtpQueryUrl(config, phoneLast10, since);
  const response = await supabaseFetch(url, { headers: authHeaders(config.serviceKey) });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Supabase OTP sorgusu başarısız (${response.status}): ${body.slice(0, 200)}`,
    );
  }

  const rows = (await response.json()) as SupabaseOtpRow[];
  return rows[0];
}

async function consumeOtpRow(
  config: SupabaseOtpConfig,
  phoneLast10: string,
): Promise<void> {
  const url = `${config.sbUrl}/rest/v1/${config.table}?phone=eq.${phoneLast10}`;
  const response = await supabaseFetch(url, {
    method: "PATCH",
    headers: {
      ...authHeaders(config.serviceKey),
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      used: true,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.warn(
      `[supabase-otp] Consume (used=true) başarısız (${response.status}): ${body.slice(0, 120)}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Supabase `otp_by_phone` tablosundan SMS OTP bekler (polling).
 * Kod bulununca döndürür; varsayılan olarak satırı `used=true` işaretler (consume).
 */
export async function waitSupabaseOtp(
  phone: string,
  options: WaitSupabaseOtpOptions = {},
): Promise<string> {
  const phoneLast10 = normalizePhoneLast10(phone);
  const config = resolveSupabaseOtpConfig({
    sbUrl: options.sbUrl,
    serviceKey: options.serviceKey,
    table: options.table,
  });

  const timeoutMs = options.timeoutMs ?? DEFAULT_SUPABASE_OTP_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? 2_000;
  const consume = options.consume !== false;
  const started = Date.now();

  logger.info(
    `[supabase-otp] OTP bekleniyor (***${phoneLast10.slice(-4)}, timeout ${timeoutMs}ms)`,
  );

  while (Date.now() - started < timeoutMs) {
    const row = await fetchLatestOtp(config, phoneLast10, options.since);
    const otp = row?.otp?.trim();

    if (otp) {
      logger.info(`[supabase-otp] OTP alındı (***${phoneLast10.slice(-4)})`);
      if (consume) {
        await consumeOtpRow(config, phoneLast10);
      }
      return otp;
    }

    await sleep(intervalMs);
  }

  throw new Error(`OTP gelmedi (timeout ${timeoutMs}ms): ***${phoneLast10.slice(-4)}`);
}

/** Tek seferlik okuma — bekleme yok. */
export async function peekSupabaseOtp(
  phone: string,
  options: Omit<WaitSupabaseOtpOptions, "timeoutMs" | "intervalMs"> = {},
): Promise<string | undefined> {
  const phoneLast10 = normalizePhoneLast10(phone);
  const config = resolveSupabaseOtpConfig({
    sbUrl: options.sbUrl,
    serviceKey: options.serviceKey,
    table: options.table,
  });
  const row = await fetchLatestOtp(config, phoneLast10, options.since);
  return row?.otp?.trim() || undefined;
}
