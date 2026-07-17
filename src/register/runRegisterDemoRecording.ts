import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDemoRecordingEnv } from "../config/demoRecordingEnv.js";
import { loadSettings } from "../config/settings.js";
import { runChromeGoogleBootstrap, waitAndAcceptChromeProfileSyncPrompt } from "../auth/chromeGoogleBootstrap.js";
import { prepareChromeForAutomation } from "../browser/chromeStartupPrep.js";
import { ContextFactory } from "../browser/contextFactory.js";
import { runPortalBootstrap } from "../auth/portalBootstrapRunner.js";
import { ProfileManager } from "../profiles/profileManager.js";
import { loadSession } from "../session/sessionLoader.js";
import {
  resolveChromeGoogleCredentials,
  resolveProfileCredentials,
} from "../profiles/profileCredentials.js";
import { logger } from "../utils/logger.js";
import { runPreflight } from "../preflight/preflightCheck.js";
import { resolveRegisterEnableCodeRequest } from "./registerFormStep9EmailVerification.js";
import { runRegisterFormSetup } from "./registerFormRunner.js";
import { validateRegisterEnvForProfile } from "./validateRegisterEnv.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEMO_PROFILE_ID = "profile-demo";

function parseProfileArg(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--profile" || argv[i] === "-p") {
      return argv[i + 1] ?? DEMO_PROFILE_ID;
    }
  }
  return DEMO_PROFILE_ID;
}

async function waitForEnter(message: string): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(`\n${message}\n`);
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const profileId = parseProfileArg(argv);
  const skipWait = argv.includes("--no-wait");
  const freshBootstrap = !argv.includes("--no-fresh");

  if (!loadDemoRecordingEnv(PROJECT_ROOT, "profile-1")) {
    logger.error("[demo-recording] Demo env bulunamadı: env/demo-recording.env");
    process.exit(1);
  }

  logger.info(
    "[demo-recording] Sahte kimlik verileri yüklendi; Google girişi profile-1 (.env) hesabı kullanılacak.",
  );
  logger.info(
    "[demo-recording] Ekran kaydı: formda Demo Kullanici + geçerli sahte TC/pasaport görünür.",
  );

  const settings = loadSettings(PROJECT_ROOT);

  const envErrors = validateRegisterEnvForProfile(profileId);
  if (envErrors.length > 0) {
    logger.error("[demo-recording] Demo env eksik / geçersiz alanlar:");
    for (const err of envErrors) {
      logger.error(`  - ${err}`);
    }
    process.exit(1);
  }

  const googleEmail = process.env.GOOGLE_EMAIL_PROFILE_DEMO?.trim();
  if (!googleEmail) {
    logger.error(
      "[demo-recording] GOOGLE_EMAIL_PROFILE_1 .env'de tanımlı değil — Google girişi yapılamaz.",
    );
    process.exit(1);
  }
  logger.info("[demo-recording] Google hesabı .env'den alındı (profile-1).");

  const preflight = await runPreflight(PROJECT_ROOT, profileId);
  for (const warning of preflight.warnings) {
    logger.warn(`[preflight] ${warning}`);
  }
  if (!preflight.ready) {
    for (const error of preflight.errors) {
      logger.error(`[preflight] ${error}`);
    }
    process.exit(1);
  }

  const profileManager = new ProfileManager(PROJECT_ROOT, settings.manifestPath);
  const profile = profileManager.resolveProfile(profileId, settings);
  const credentials = resolveProfileCredentials(profile);
  const googleCredentials = resolveChromeGoogleCredentials(profile);
  const contextFactory = new ContextFactory(profileManager, settings);
  const homeUrl = settings.visaPortalHomeUrl;

  const session = await contextFactory.launch(profile);
  const page = session.page;
  const { context } = session;

  try {
    if (freshBootstrap) {
      logger.info("[demo-recording] Temiz demo Chrome profili + Google girişi...");
      if (settings.preGotoDelayMs > 0) {
        await page.waitForTimeout(settings.preGotoDelayMs);
      }
      await prepareChromeForAutomation(page, context, settings);

      const googleResult = await runChromeGoogleBootstrap(page, googleCredentials, profile, {
        allowReuseExisting: !settings.chromeFreshProfile,
      });
      logger.info(
        `[demo-recording] Google — oturum=${googleResult.signedInOnGoogle}, atlandi=${googleResult.skippedExistingSession}`,
      );
      await waitAndAcceptChromeProfileSyncPrompt(page, profile.name, { timeoutMs: 45_000 });

      const sessionPaths = profileManager.toSessionPaths(profile);
      await loadSession(context, page, sessionPaths, {
        skipCookies: false,
        skipStorage: false,
      });
      logger.info("[demo-recording] Portal session enjekte edildi.");
    }

    logger.info("[demo-recording] Portal bootstrap...");
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await runPortalBootstrap(page, credentials);

    const enableCodeRequest = resolveRegisterEnableCodeRequest({});
    logger.info(`[demo-recording] Wizard başlıyor (sahte veriler, enableCodeRequest=${enableCodeRequest})...`);

    const result = await runRegisterFormSetup(page, profile, settings, {
      homeUrl,
      softValidate: false,
      enableCodeRequest,
      maxRounds: 16,
    });

    logger.info("[demo-recording] Sonuç:");
    logger.info(`  emailVerificationStepReached: ${result.emailVerificationStepReached}`);
    logger.info(`  progressStep: ${result.progressStep ?? "?"}`);
    logger.info(`  URL: ${page.url()}`);

    if (!result.emailVerificationStepReached) {
      logger.error("[demo-recording] Adım 9'a ulaşılamadı.");
      process.exit(1);
    }

    logger.info("[demo-recording] BAŞARILI — Adım 9 hazır (kod gönderilmedi). Ekran kaydını durdurabilirsiniz.");
    if (!skipWait) {
      await waitForEnter(
        "Kayıt videosu için ekranı kontrol edin. Bitince Enter'a basın (Chrome açık kalır).",
      );
    }
  } finally {
    await session.context.close().catch(() => {});
  }
}

main().catch((error) => {
  logger.error("[demo-recording] Hata:", error instanceof Error ? error.message : error);
  process.exit(1);
});
