import { logger } from "../utils/logger.js";

export class FlowCheckpointError extends Error {
  constructor(
    public readonly step: string,
    message: string,
  ) {
    super(message);
    this.name = "FlowCheckpointError";
  }
}

export interface CheckpointOptions {
  /** true ise hata loglanır, akış devam eder */
  soft?: boolean;
}

export async function runCheckpoint<T>(
  step: string,
  fn: () => Promise<T>,
  options: CheckpointOptions = {},
): Promise<T | null> {
  logger.info(`[checkpoint] ▶ ${step}`);

  try {
    const result = await fn();
    logger.info(`[checkpoint] ✓ ${step}`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (options.soft) {
      logger.warn(`[checkpoint] ⚠ ${step} — ${message} (yumuşak devam)`);
      return null;
    }

    logger.error(`[checkpoint] ✗ ${step} — ${message}`);
    throw new FlowCheckpointError(step, message);
  }
}

export async function assertCheckpoint(condition: boolean, step: string, message: string): Promise<void> {
  if (!condition) {
    throw new FlowCheckpointError(step, message);
  }
  logger.info(`[checkpoint] ✓ ${step}`);
}
