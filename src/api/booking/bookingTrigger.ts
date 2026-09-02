import type { GhostDayStore } from "./ghostDayStore.js";

/**
 * Booking campaign tetik günleri:
 * - Öncelik: baseline sonrası yeni açılan günler (`addedAllowed`)
 * - Yedek: aktif günler (`currentAllowed`) — baseline'da kayıtlı dolu günlerde takılmayı önler
 * - Ghost günler (saat probe boş) filtrelenir
 */
export function resolveBookingTriggerDays(
  profileId: string,
  addedAllowed: string[],
  currentAllowed: string[],
  ghostStore: GhostDayStore,
): string[] {
  if (currentAllowed.length === 0) {
    return [];
  }

  ghostStore.syncAllowedSnapshot(profileId, currentAllowed);

  const candidates = addedAllowed.length > 0 ? addedAllowed : [...currentAllowed];
  const fresh = ghostStore.filterFreshTriggerDays(profileId, candidates);
  return [...fresh].sort();
}
