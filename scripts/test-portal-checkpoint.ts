/**
 * Kimlik/Telefon popup checkpoint — manuel Supabase OTP testi.
 *
 * 1) Panel worker ayarları kayıtlı (OTP telefon, TC, pasaport)
 * 2) .env: SB_URL + SB_SERVICE_KEY
 * 3) Chrome CDP açık, portala gidilmiş
 * 4) npm run portal:checkpoint-test
 * 5) Chrome'da popup'ı tetikleyin (veya zaten açıksa bekleyin)
 * 6) «Telefonuma kod gönder» sonrası Supabase otp_by_phone'a kodu elle yazın
 *
 * Script popup'ı yakalayıp SB'den kodu çeker ve doğrular.
 */
import { resolve } from "node:path";

import { connectOverCdp, findPortalTab } from "../src/browser/cdpConnector.js";
import { loadSettings } from "../src/config/settings.js";
import { mergeWorkerApiIntoProfile } from "../src/control-panel/workerWizardForm.js";
import { WorkerConfigStore } from "../src/control-panel/workerConfigStore.js";
import { isSupabaseOtpConfigured } from "../src/integrations/supabaseOtp.js";
import { ProfileManager } from "../src/profiles/profileManager.js";
import { drainPortalInterventions, PORTAL_INTERVENTION_PROBE_MS } from "../src/portal/interventions/portalCheckpoint.js";

const projectRoot = resolve(import.meta.dirname, "..");
const settings = loadSettings(projectRoot);
const profileId = process.argv[2]?.trim() || settings.defaultProfileId || "profile-1";
const pollMs = Number.parseInt(process.argv[3] ?? "3000", 10);
const maxRounds = Number.parseInt(process.argv[4] ?? "120", 10);

if (!isSupabaseOtpConfigured()) {
  console.error("SB_URL ve SB_SERVICE_KEY .env içinde tanımlı olmalı.");
  process.exit(1);
}

const workerStore = new WorkerConfigStore(projectRoot);
const worker = workerStore.getWorker(profileId, "", {
  pollIntervalMs: settings.apiWatcher.pollIntervalMs,
  telegramReportIntervalMs: settings.apiWatcher.telegramReportIntervalMs,
});
const baseProfile = new ProfileManager(projectRoot, settings.manifestPath).resolveProfile(
  profileId,
  settings,
);
const profile = mergeWorkerApiIntoProfile(baseProfile, worker.api);

if (!worker.api.otpPhone?.trim()) {
  console.error(`Profil ${profileId}: panelde OTP telefonu kayıtlı değil.`);
  process.exit(1);
}

const endpoint = process.env.CDP_ENDPOINT?.trim() || `http://127.0.0.1:${process.env.CDP_PORT ?? "9222"}`;
console.log(`CDP: ${endpoint}`);
console.log(`Profil: ${profileId} · OTP tel: ***${worker.api.otpPhone.slice(-4)}`);
console.log(`Probe: ${PORTAL_INTERVENTION_PROBE_MS}ms · tur: ${pollMs}ms · max ${maxRounds} tur`);
console.log("Popup'ı Chrome'da açın — «Telefonuma kod gönder» sonrası kodu Supabase'e yazın.\n");

const { browser, context } = await connectOverCdp(endpoint, { skipStealth: true });
try {
  for (let round = 1; round <= maxRounds; round++) {
    const page = (await findPortalTab(context)) ?? context.pages().find((p) => !p.isClosed());
    if (!page) {
      console.log(`[${round}] Portal sekmesi yok — bekleniyor…`);
      await sleep(pollMs);
      continue;
    }

    await page.bringToFront().catch(() => undefined);
    const result = await drainPortalInterventions(page, { profile });

    if (result.handled) {
      console.log(
        `[${round}] ${result.variantId ?? "?"} — filled/submit: resolved=${result.resolved}${result.detail ? ` (${result.detail})` : ""}`,
      );
      if (result.resolved) {
        console.log("\n✓ Popup otomasyonu tamamlandı.");
        process.exit(0);
      }
    } else if (round === 1 || round % 10 === 0) {
      console.log(`[${round}] Popup yok — ${page.url().slice(0, 80)}…`);
    }

    await sleep(pollMs);
  }

  console.log("\nSüre doldu — popup görülmedi veya OTP tamamlanmadı.");
  process.exit(1);
} finally {
  await browser.close().catch(() => undefined);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
