import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { WorkerConfigStore } from "./workerConfigStore.js";
import {
  RUNTIME_INTERVAL_OPTIONS_MS,
  type RuntimeIntervalDefaults,
} from "./workerTimingUtils.js";

export {
  RUNTIME_INTERVAL_OPTIONS_MS,
  MIN_RUNTIME_INTERVAL_MS,
  MAX_RUNTIME_INTERVAL_MS,
  clampRuntimeIntervalMs,
  normalizeRuntimeIntervalMs,
  type RuntimeIntervalDefaults,
} from "./workerTimingUtils.js";

export interface WorkerRuntimeConfig {
  profileId: string;
  pollIntervalMs: number;
  telegramReportIntervalMs: number;
  updatedAt: string;
}

interface LegacyRuntimeStoreFile {
  workers: Record<
    string,
    {
      profileId?: string;
      pollIntervalMs?: number;
      telegramReportIntervalMs?: number;
      updatedAt?: string;
    }
  >;
}

/** Canlı watcher ayarları — kalıcı depo worker-config.json timing alanı */
export class WorkerRuntimeStore {
  private readonly configStore: WorkerConfigStore;
  private readonly legacyStorePath: string;
  private migratedLegacy = false;

  constructor(projectRoot: string) {
    this.configStore = new WorkerConfigStore(projectRoot);
    this.legacyStorePath = resolve(projectRoot, "data/control-panel/worker-runtime.json");
  }

  private migrateLegacyOnce(defaults: RuntimeIntervalDefaults): void {
    if (this.migratedLegacy || !existsSync(this.legacyStorePath)) {
      this.migratedLegacy = true;
      return;
    }

    try {
      const raw = readFileSync(this.legacyStorePath, "utf-8");
      const legacy = JSON.parse(raw) as LegacyRuntimeStoreFile;
      for (const [profileId, entry] of Object.entries(legacy.workers ?? {})) {
        if (!entry) {
          continue;
        }
        const store = this.configStore.load();
        const raw = store.workers[profileId];
        if (raw?.timing) {
          continue;
        }
        this.configStore.updateWorker(
          profileId,
          {
            timing: {
              pollIntervalMs: entry.pollIntervalMs,
              telegramReportIntervalMs: entry.telegramReportIntervalMs,
            },
          },
          defaults,
        );
      }
    } catch {
      // Eski dosya okunamazsa yoksay
    }

    this.migratedLegacy = true;
  }

  private toRuntimeConfig(
    profileId: string,
    defaults: RuntimeIntervalDefaults,
  ): WorkerRuntimeConfig {
    const worker = this.configStore.getWorker(profileId, "", defaults);
    return {
      profileId,
      pollIntervalMs: worker.timing.pollIntervalMs,
      telegramReportIntervalMs: worker.timing.telegramReportIntervalMs,
      updatedAt: worker.updatedAt,
    };
  }

  get(profileId: string, defaults: RuntimeIntervalDefaults): WorkerRuntimeConfig {
    this.migrateLegacyOnce(defaults);
    return this.toRuntimeConfig(profileId, defaults);
  }

  ensure(profileId: string, defaults: RuntimeIntervalDefaults): WorkerRuntimeConfig {
    this.migrateLegacyOnce(defaults);
    const store = this.configStore.load();
    if (!store.workers[profileId]) {
      this.configStore.updateWorker(
        profileId,
        {
          timing: {
            pollIntervalMs: defaults.pollIntervalMs,
            telegramReportIntervalMs: defaults.telegramReportIntervalMs,
          },
        },
        defaults,
      );
    }

    return this.toRuntimeConfig(profileId, defaults);
  }

  update(
    profileId: string,
    patch: Partial<Pick<WorkerRuntimeConfig, "pollIntervalMs" | "telegramReportIntervalMs">>,
    defaults: RuntimeIntervalDefaults,
  ): WorkerRuntimeConfig {
    this.migrateLegacyOnce(defaults);
    this.configStore.updateWorker(
      profileId,
      {
        timing: {
          pollIntervalMs: patch.pollIntervalMs,
          telegramReportIntervalMs: patch.telegramReportIntervalMs,
        },
      },
      defaults,
    );
    return this.toRuntimeConfig(profileId, defaults);
  }
}
