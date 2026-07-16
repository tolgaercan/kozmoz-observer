import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { logger } from "../utils/logger.js";

export type ProfileLifecycleState =
  | "ready"
  | "observing"
  | "booking"
  | "cooldown"
  | "banned";

export interface ProfileQueueConfig {
  strategy: "sequential";
  activeProfileId: string;
  queue: string[];
  poolFile?: string;
  notes?: string;
}

export class ProfileQueue {
  private readonly queuePath: string;

  constructor(private readonly projectRoot: string) {
    this.queuePath = resolve(projectRoot, "data/profile-queue.json");
  }

  load(): ProfileQueueConfig {
    if (!existsSync(this.queuePath)) {
      throw new Error(`Profil kuyruğu bulunamadı: ${this.queuePath}`);
    }

    try {
      const raw = readFileSync(this.queuePath, "utf-8");
      const config = JSON.parse(raw) as ProfileQueueConfig;

      if (!config.activeProfileId?.trim()) {
        throw new Error("profile-queue.json: activeProfileId zorunlu.");
      }
      if (!Array.isArray(config.queue) || config.queue.length === 0) {
        throw new Error("profile-queue.json: queue en az bir profil içermeli.");
      }

      return config;
    } catch (error) {
      throw new Error(
        `Profil kuyruğu okunamadı: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** CLI --profile verilmediyse kuyruktaki aktif profil */
  resolveProfileRef(cliProfileRef?: string): string {
    if (cliProfileRef?.trim()) {
      return cliProfileRef.trim();
    }

    const config = this.load();
    logger.info(`Kuyruk aktif profil: ${config.activeProfileId} (${config.strategy})`);
    return config.activeProfileId;
  }

  /** İleride supervisor: sıradaki uygun profil */
  peekNextInQueue(currentProfileId: string): string | null {
    const config = this.load();
    const index = config.queue.indexOf(currentProfileId);
    if (index < 0 || index >= config.queue.length - 1) {
      return null;
    }
    return config.queue[index + 1] ?? null;
  }

  /** Runtime state güncelleme (supervisor v1.1) */
  setActiveProfileId(profileId: string): void {
    const config = this.load();
    config.activeProfileId = profileId;
    writeFileSync(this.queuePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
    logger.info(`Kuyruk güncellendi — activeProfileId: ${profileId}`);
  }
}
