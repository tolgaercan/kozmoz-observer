/** Slot taraması sürerken wizard guard tam kurtarma yapmasın */
let slotCycleRunning = false;

export function isSlotCycleRunning(): boolean {
  return slotCycleRunning;
}

export async function withSlotCycleLock<T>(task: () => Promise<T>): Promise<T> {
  slotCycleRunning = true;
  try {
    return await task();
  } finally {
    slotCycleRunning = false;
  }
}
