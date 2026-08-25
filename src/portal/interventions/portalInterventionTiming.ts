/** Kimlik/Telefon popup ve portal müdahale tespiti — tek timeout (ms). */
export const PORTAL_INTERVENTION_PROBE_MS = 800;

function readPositiveIntEnv(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Kimlik popup — manuel OTP / popup kapanisi poll araligi (ms). */
export const IDENTITY_OTP_POPUP_POLL_MS = readPositiveIntEnv("IDENTITY_OTP_POPUP_POLL_MS", 2500);
