/**
 * Ödeme adımını mevcut Chrome CDP oturumunda çalıştırır (booking yeniden başlatmadan).
 *
 * 1) Chrome CDP açık, ödeme sayfası görünür
 * 2) Panel worker-config → payment alanları dolu
 * 3) npm run portal:payment-step -- profile-tolga2
 *
 * Varsayılan: worker panel booking ayarları (.env yedek).
 * Sadece doldur: --no-submit   Zorla submit: --submit
 */
import { resolve } from "node:path";

import { connectOverCdp, findPortalTab } from "../src/browser/cdpConnector.js";
import { loadSettings } from "../src/config/settings.js";
import { mergeWorkerApiIntoProfile } from "../src/control-panel/workerWizardForm.js";
import { WorkerConfigStore } from "../src/control-panel/workerConfigStore.js";
import { runPaymentStep } from "../src/portal/payment/runPaymentStep.js";
import { ProfileManager } from "../src/profiles/profileManager.js";
import { resolveProfileBrowserPaths } from "../src/profiles/profileBrowserResolver.js";

const projectRoot = resolve(import.meta.dirname, "..");
const settings = loadSettings(projectRoot);
const profileId = process.argv[2]?.trim() || settings.defaultProfileId || "profile-1";

const workerStore = new WorkerConfigStore(projectRoot);
const configDefaults = {
  pollIntervalMs: settings.apiWatcher.pollIntervalMs,
  telegramReportIntervalMs: settings.apiWatcher.telegramReportIntervalMs,
  paymentAutoSubmit: settings.apiWatcher.bookingPaymentAutoSubmit,
  payment3dsAuto: settings.apiWatcher.bookingPayment3dsAutoEnabled,
};
const worker = workerStore.getWorker(profileId, "", configDefaults);
const baseProfile = new ProfileManager(projectRoot, settings.manifestPath).resolveProfile(
  profileId,
  settings,
);
const profile = mergeWorkerApiIntoProfile(baseProfile, worker.api);

const endpoint =
  process.env.CDP_ENDPOINT?.trim() ||
  resolveProfileBrowserPaths(projectRoot, baseProfile, settings).cdpEndpoint ||
  `http://127.0.0.1:${process.env.CDP_PORT ?? "9222"}`;

const autoSubmit = process.argv.includes("--no-submit")
  ? false
  : process.argv.includes("--submit")
    ? true
    : worker.booking.paymentAutoSubmit;
const threeDsAuto = worker.booking.payment3dsAuto;

console.log(`CDP: ${endpoint}`);
console.log(`Profil: ${profileId} · autoSubmit=${autoSubmit} · 3dsAuto=${threeDsAuto}`);
console.log("Ödeme sayfası bekleniyor…\n");

const { browser, context } = await connectOverCdp(endpoint, { skipStealth: true });
try {
  const page = (await findPortalTab(context)) ?? context.pages().find((p) => !p.isClosed());
  if (!page) {
    console.error("Portal sekmesi bulunamadı.");
    process.exit(1);
  }

  await page.bringToFront().catch(() => undefined);
  console.log(`Sekme: ${page.url()}\n`);

  const result = await runPaymentStep(page, {
    profile,
    autoSubmit,
    threeDsAutoEnabled: threeDsAuto,
    paymentPageWaitMs: settings.apiWatcher.bookingPaymentPageWaitMs,
    submitWaitMs: settings.apiWatcher.bookingPaymentSubmitWaitMs,
    outcomeWaitMs: settings.apiWatcher.bookingPaymentOutcomeWaitMs,
    threeDsDetectWaitMs: settings.apiWatcher.bookingPayment3dsDetectWaitMs,
  });

  console.log("\n--- Sonuç ---");
  console.log(JSON.stringify(result, null, 2));

  process.exit(result.ok ? 0 : 1);
} finally {
  await browser.close().catch(() => undefined);
}
