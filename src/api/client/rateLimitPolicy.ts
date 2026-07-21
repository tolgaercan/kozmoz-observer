export { parsePortalBanDurationMs, parseRateLimitDurationMs, resolveRateLimitBackoffMs } from "../../control-panel/apiHealthStore.js";

export function formatDurationTr(ms: number): string {
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
