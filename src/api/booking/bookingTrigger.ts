import type { GhostDayStore } from "./ghostDayStore.js";

/**
 * Booking campaign yalnızca yeni günlerle tetiklenir.
 * Ghost günler (saat probe boş) aynı allowed listesinde kaldıkça tekrar istek atılmaz.
 */
export function resolveBookingTriggerDays(
  profileId: string,
  addedAllowed: string[],
  currentAllowed: string[],
  ghostStore: GhostDayStore,
): string[] {
  if (addedAllowed.length === 0) {
    return [];
  }

  ghostStore.syncAllowedSnapshot(profileId, currentAllowed);
  const fresh = ghostStore.filterFreshTriggerDays(profileId, addedAllowed);
  return [...fresh].sort();
}
