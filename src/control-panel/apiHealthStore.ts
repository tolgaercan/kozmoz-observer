import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type ApiHealthStatus = "idle" | "ok" | "empty" | "error" | "unauthorized" | "rate_limited" | "banned";

export interface ApiHealthRecord {
  profileId: string;
  profileName?: string;
  /** Ban/poll anındaki public IP */
  publicIp?: string;
  /** Worker config'deki kilitli IP */
  lockedIp?: string;
  cdpPort?: number;
  status: ApiHealthStatus;
  lastPollAt?: string;
  lastOkAt?: string;
  lastError?: string;
  lastHttpStatus?: number;
  lastSummary?: string;
  pollIntervalMs?: number;
  requestsLastHour?: number;
  /** Yerel backoff — watcher bu zamana kadar poll atmaz */
  backoffUntil?: string;
  /** Portal ban mesajından parse edilen süre */
  portalBanUntil?: string;
  dealerOffice?: string;
  appointmentStyle?: string;
  appointmentTypeId?: string;
  updatedAt: string;
}

export interface ApiHealthStoreData {
  profiles: Record<string, ApiHealthRecord>;
}

interface RateLimitJsonBody {
  retryAfterSeconds?: number;
  blockPeriod?: string;
  messageKey?: string;
  messageParams?: { hours?: number; minutes?: number; seconds?: number };
}

/** Portal / API Türkçe ban mesajından ms hesapla */
export function parsePortalBanDurationMs(text: string): number | undefined {
  const normalized = text.toLocaleLowerCase("tr-TR");
  if (!normalized.includes("çok fazla istek") && !normalized.includes("rate limit")) {
    return undefined;
  }

  const hours = normalized.match(/(\d+)\s*saat/);
  const minutes = normalized.match(/(\d+)\s*dakika/);
  const seconds = normalized.match(/(\d+)\s*saniye/);

  let totalMs = 0;
  if (hours) {
    totalMs += Number.parseInt(hours[1]!, 10) * 3_600_000;
  }
  if (minutes) {
    totalMs += Number.parseInt(minutes[1]!, 10) * 60_000;
  }
  if (seconds) {
    totalMs += Number.parseInt(seconds[1]!, 10) * 1_000;
  }

  return totalMs > 0 ? totalMs : undefined;
}

/** GetClosedDate 429 JSON veya Türkçe UI metninden ban süresi */
export function parseRateLimitDurationMs(bodyText?: string): number | undefined {
  if (!bodyText?.trim()) {
    return undefined;
  }

  try {
    const json = JSON.parse(bodyText) as RateLimitJsonBody;
    if (typeof json.retryAfterSeconds === "number" && json.retryAfterSeconds > 0) {
      return json.retryAfterSeconds * 1_000;
    }
    const params = json.messageParams;
    if (params) {
      const fromParams =
        (params.hours ?? 0) * 3_600_000 +
        (params.minutes ?? 0) * 60_000 +
        (params.seconds ?? 0) * 1_000;
      if (fromParams > 0) {
        return fromParams;
      }
    }
  } catch {
    // JSON değil — Türkçe metne düş
  }

  return parsePortalBanDurationMs(bodyText);
}

function formatDurationTr(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1_000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours} saat`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} dk`);
  }
  if (seconds > 0 && hours === 0) {
    parts.push(`${seconds} sn`);
  }
  return parts.join(" ") || "0 sn";
}

function normalizeRecord(record: ApiHealthRecord): ApiHealthRecord {
  if (!record.lastPollAt) {
    return record;
  }
  const sourceText = record.lastError ?? "";
  const durationMs = parseRateLimitDurationMs(sourceText);
  if (!durationMs) {
    return record;
  }

  const banUntil = new Date(Date.parse(record.lastPollAt) + durationMs).toISOString();
  const isLongBan = durationMs >= 3_600_000 || sourceText.includes("blockPeriod");
  const remainingMs = Date.parse(banUntil) - Date.now();

  return {
    ...record,
    backoffUntil: banUntil,
    portalBanUntil: isLongBan ? banUntil : record.portalBanUntil,
    status:
      remainingMs > 0 && (record.lastHttpStatus === 429 || record.status === "rate_limited")
        ? isLongBan
          ? "banned"
          : "rate_limited"
        : record.status,
    lastSummary:
      remainingMs > 0
        ? `Portal ban — ${formatDurationTr(remainingMs)} kaldı`
        : record.lastSummary,
  };
}

export function resolveRateLimitBackoffMs(options: {
  pollIntervalMs: number;
  bodyText?: string;
  retryAfterHeader?: string | null;
}): number {
  const fromHeader = options.retryAfterHeader?.trim();
  if (fromHeader) {
    const asSeconds = Number.parseInt(fromHeader, 10);
    if (Number.isFinite(asSeconds) && asSeconds > 0) {
      return asSeconds * 1_000;
    }
  }

  const fromBody = parseRateLimitDurationMs(options.bodyText);
  if (fromBody) {
    return fromBody;
  }

  const envMs = Number.parseInt(process.env.API_RATE_LIMIT_BACKOFF_MS ?? "", 10);
  if (Number.isFinite(envMs) && envMs > 0) {
    return envMs;
  }

  return Math.max(options.pollIntervalMs * 30, 3_600_000);
}

export class ApiHealthStore {
  private readonly storePath: string;

  constructor(projectRoot: string) {
    this.storePath = resolve(projectRoot, "data/control-panel/api-health.json");
  }

  load(): ApiHealthStoreData {
    if (!existsSync(this.storePath)) {
      return { profiles: {} };
    }
    try {
      return JSON.parse(readFileSync(this.storePath, "utf-8")) as ApiHealthStoreData;
    } catch {
      return { profiles: {} };
    }
  }

  save(data: ApiHealthStoreData): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    writeFileSync(this.storePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  }

  get(profileId: string): ApiHealthRecord | undefined {
    const record = this.load().profiles[profileId];
    return record ? normalizeRecord(record) : undefined;
  }

  listAll(): ApiHealthRecord[] {
    const store = this.load();
    return Object.values(store.profiles).map(normalizeRecord);
  }

  listBlocked(): Array<{ record: ApiHealthRecord; until: string; reason: string }> {
    return this.listAll()
      .map((record) => {
        const blocked = this.isBlocked(record.profileId);
        if (!blocked.blocked || !blocked.until) {
          return null;
        }
        return {
          record,
          until: blocked.until,
          reason: blocked.reason ?? "Rate limit / ban aktif",
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  update(profileId: string, patch: Partial<ApiHealthRecord>): ApiHealthRecord {
    const store = this.load();
    const existing = store.profiles[profileId] ?? {
      profileId,
      status: "idle" as const,
      updatedAt: new Date().toISOString(),
    };
    const next: ApiHealthRecord = {
      ...existing,
      ...patch,
      profileId,
      updatedAt: new Date().toISOString(),
    };
    store.profiles[profileId] = next;
    this.save(store);
    return next;
  }

  isBlocked(profileId: string): { blocked: boolean; until?: string; reason?: string } {
    const record = this.get(profileId);
    if (!record) {
      return { blocked: false };
    }
    const now = Date.now();
    const candidates = [record.portalBanUntil, record.backoffUntil].filter(Boolean) as string[];
    const bestUntil = candidates
      .map((iso) => Date.parse(iso))
      .filter((ms) => Number.isFinite(ms))
      .sort((a, b) => b - a)[0];
    if (bestUntil && bestUntil > now) {
      const untilIso = new Date(bestUntil).toISOString();
      let reason = "Rate limit / ban aktif";
      if (record.lastError) {
        try {
          const json = JSON.parse(record.lastError) as RateLimitJsonBody;
          if (json.messageKey === "common.rateLimitExceeded") {
            reason = "Çok fazla istek — portal banı aktif";
          }
        } catch {
          reason = record.lastError.slice(0, 200);
        }
      }
      return { blocked: true, until: untilIso, reason };
    }
    return { blocked: false };
  }
}
