import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
import {
  fillRegisterStep9EmailVerification,
  resolveRegisterEnableCodeRequest,
} from "./registerFormStep9EmailVerification.js";
import { runRegisterFormSetup } from "./registerFormRunner.js";
import { validateRegisterEnvForProfile } from "./validateRegisterEnv.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function parseProfileArg(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--profile" || argv[i] === "-p") {
      return argv[i + 1] ?? "profile-1";
    }
  }
  return process.env.DEFAULT_PROFILE_ID ?? "profile-1";
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
  const freshBootstrap =
    argv.includes("--fresh") ||
    process.env.REGISTER_DRY_RUN_FRESH?.trim().toLowerCase() === "true";
  const settings = loadSettings(PROJECT_ROOT);

  const envErrors = validateRegisterEnvForProfile(profileId);
  if (envErrors.length > 0) {
    logger.error("[register:dry-run] .env eksik / geçersiz alanlar:");
    for (const err of envErrors) {
      logger.error(`  - ${err}`);
    }
    process.exit(1);
  }
  logger.info("[register:dry-run] .env kayıt alanları doğrulandı — eksik yok.");

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
      logger.info(
        "[register:dry-run] Temiz bootstrap — Chrome/Google girisi + portal (CHROME_FRESH_PROFILE ile chrome:debug calistirin).",
      );
      if (settings.preGotoDelayMs > 0) {
        await page.waitForTimeout(settings.preGotoDelayMs);
      }
      await prepareChromeForAutomation(page, context, settings);
      const googleResult = await runChromeGoogleBootstrap(page, googleCredentials, profile, {
        allowReuseExisting: !settings.chromeFreshProfile,
      });
      logger.info(
        `[register:dry-run] Google — oturum=${googleResult.signedInOnGoogle}, atlandi=${googleResult.skippedExistingSession}`,
      );
      await waitAndAcceptChromeProfileSyncPrompt(page, profile.name, { timeoutMs: 45_000 });

      const sessionPaths = profileManager.toSessionPaths(profile);
      await loadSession(context, page, sessionPaths, {
        skipCookies: false,
        skipStorage: false,
      });
      logger.info("[register:dry-run] Google sonrasi portal session enjekte edildi.");
    }

    logger.info("[register:dry-run] Portal bootstrap...");
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await runPortalBootstrap(page, credentials);

    const enableCodeRequest = resolveRegisterEnableCodeRequest({});
    logger.info(
      `[register:dry-run] Wizard başlıyor (enableCodeRequest=${enableCodeRequest})...`,
    );

    const result = await runRegisterFormSetup(page, profile, settings, {
      homeUrl,
      softValidate: false,
      enableCodeRequest,
      maxRounds: 16,
    });

    logger.info("[register:dry-run] Sonuç:");
    logger.info(`  emailVerificationStepReached: ${result.emailVerificationStepReached}`);
    logger.info(`  kvkkStepComplete: ${result.kvkkStepComplete}`);
    logger.info(`  progressStep: ${result.progressStep ?? "?"}`);
    logger.info(`  viewStep: ${result.viewStep ?? "?"}`);
    logger.info(`  URL: ${page.url()}`);

    if (!result.emailVerificationStepReached) {
      logger.error("[register:dry-run] Email Doğrulama adımına ulaşılamadı.");
      process.exit(1);
    }

    logger.info("[register:dry-run] BAŞARILI — Adım 9 ekranında duruldu (kod gönderilmedi).");
    if (!skipWait) {
      await waitForEnter(
        "Tarayıcıda Email Doğrulama ekranını kontrol edin. Kapatmak için Enter'a basın (Chrome açık kalır).",
      );
    }
  } finally {
    await session.context.close().catch(() => {});
  }
}

main().catch((error) => {
  logger.error("[register:dry-run] Hata:", error instanceof Error ? error.message : error);
  process.exit(1);
});
