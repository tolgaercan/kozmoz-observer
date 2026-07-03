export type LogLevel = "info" | "warn" | "error" | "debug";

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
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
