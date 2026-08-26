export type LogLevel = "info" | "warn" | "error" | "debug";

/** Terminal loglari — yerel sistem saati (UTC degil). LOG_TIMEZONE ile sabitlenebilir. */
export function formatLogTimestamp(date = new Date()): string {
  const timeZone = process.env.LOG_TIMEZONE?.trim();
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hour12: false,
      timeZoneName: "shortOffset",
    }).formatToParts(date);

    const pick = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? "";

    const offset = pick("timeZoneName").replace(/^GMT/i, "UTC") || "UTC";
    return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}.${pick("fractionalSecond") || "000"} ${offset}`;
  }

  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = pad(date.getMilliseconds(), 3);
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const offH = pad(Math.floor(abs / 60));
  const offM = pad(abs % 60);

  return `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms} ${sign}${offH}:${offM}`;
}

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = formatLogTimestamp();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

export const logger = {
  info(message: string): void {
    console.log(formatMessage("info", message));
  },
  warn(message: string): void {
    console.warn(formatMessage("warn", message));
  },
  error(message: string, error?: unknown): void {
    console.error(formatMessage("error", message));
    if (error instanceof Error) {
      console.error(error.stack ?? error.message);
    } else if (error !== undefined) {
      console.error(error);
    }
  },
  debug(message: string): void {
    if (process.env.DEBUG === "true") {
      console.debug(formatMessage("debug", message));
    }
  },
};
