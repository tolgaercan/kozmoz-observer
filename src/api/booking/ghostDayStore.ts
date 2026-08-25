import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { logger } from "../../utils/logger.js";

export type GhostDayReason = "hour_quota_empty" | "hour_probe_error" | "ui_select_failed";

export interface GhostDayRecord {
  date: string;
  reason: GhostDayReason;
  markedAt: string;
  /** Son poll'da allowed listesinde görüldü mü */
  inAllowedList: boolean;
}

interface GhostDayFile {
  profiles: Record<string, GhostDayRecord[]>;
}

export class GhostDayStore {
  private readonly storePath: string;

  constructor(projectRoot: string) {
    this.storePath = resolve(projectRoot, "data/control-panel/booking-ghost-days.json");
    mkdirSync(dirname(this.storePath), { recursive: true });
  }

  private load(): GhostDayFile {
    if (!existsSync(this.storePath)) {
      return { profiles: {} };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.storePath, "utf-8")) as GhostDayFile;
      return { profiles: parsed.profiles ?? {} };
    } catch {
      return { profiles: {} };
    }
  }

  private save(store: GhostDayFile): void {
    writeFileSync(this.storePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  }

  list(profileId: string): GhostDayRecord[] {
    return this.load().profiles[profileId] ?? [];
  }

  isGhost(profileId: string, date: string): boolean {
    return this.list(profileId).some((entry) => entry.date === date);
  }

  /**
   * Poll sonrası allowed listesini güncelle.
   * Listeden düşen ghost günler tekrar `addedAllowed` ile gelirse probe edilebilir.
   */
  syncAllowedSnapshot(profileId: string, allowedDates: string[]): void {
    const store = this.load();
    const allowedSet = new Set(allowedDates);
    const existing = store.profiles[profileId] ?? [];
    const next: GhostDayRecord[] = [];

    for (const entry of existing) {
      if (allowedSet.has(entry.date)) {
        next.push({ ...entry, inAllowedList: true });
      } else {
        next.push({ ...entry, inAllowedList: false });
      }
    }

    store.profiles[profileId] = next;
    this.save(store);
  }

  /** addedAllowed içinden ghost olmayan veya listeden düşüp yeniden gelen günler. */
  filterFreshTriggerDays(profileId: string, addedAllowed: string[]): string[] {
    const ghosts = this.list(profileId);
    const ghostMap = new Map(ghosts.map((g) => [g.date, g]));

    return addedAllowed.filter((date) => {
      const ghost = ghostMap.get(date);
      if (!ghost) {
        return true;
      }
      if (!ghost.inAllowedList) {
        logger.info(`[booking] Ghost gün yeniden açıldı — probe adayı: ${date}`);
        return true;
      }
      logger.debug(`[booking] Ghost gün atlandı (saat yok kanıtlandı): ${date}`);
      return false;
    });
  }

  markGhost(profileId: string, dates: string[], reason: GhostDayReason): void {
    if (dates.length === 0) {
      return;
    }
    const store = this.load();
    const existing = store.profiles[profileId] ?? [];
    const byDate = new Map(existing.map((e) => [e.date, e]));
    const now = new Date().toISOString();

    for (const date of dates) {
      byDate.set(date, {
        date,
        reason,
        markedAt: now,
        inAllowedList: true,
      });
    }

    store.profiles[profileId] = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    this.save(store);
    logger.info(`[booking] Ghost işaretlendi (${reason}): ${dates.join(", ")}`);
  }

  clearProfile(profileId: string): void {
    const store = this.load();
    delete store.profiles[profileId];
    this.save(store);
  }
}
