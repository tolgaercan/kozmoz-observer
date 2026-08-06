export const RUNTIME_INTERVAL_OPTIONS_MS = [
  60_000,
  180_000,
  300_000,
  600_000,
  900_000,
] as const;

export const MIN_RUNTIME_INTERVAL_MS = 60_000;
export const MAX_RUNTIME_INTERVAL_MS = 3_600_000;

export interface RuntimeIntervalDefaults {
  pollIntervalMs: number;
  telegramReportIntervalMs: number;
}

export function clampRuntimeIntervalMs(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_RUNTIME_INTERVAL_MS;
  }
  return Math.min(MAX_RUNTIME_INTERVAL_MS, Math.max(MIN_RUNTIME_INTERVAL_MS, Math.round(value)));
}

export function normalizeRuntimeIntervalMs(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return clampRuntimeIntervalMs(fallback);
  }
  return clampRuntimeIntervalMs(parsed);
}
