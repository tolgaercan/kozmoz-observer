import type { Page } from "playwright";

import { isChromeProfileLinkedToGoogle } from "../browser/chromeProfileIdentity.js";
import type { ChromeGoogleCredentials } from "../profiles/profileCredentials.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";
import {
  detectChromeBootstrapPhase,
  detectChromeBootstrapState,
  formatChromeBootstrapLog,
  type ChromeBootstrapPhaseId,
} from "./chromeBootstrapDetector.js";
import {
  buildChromeGoogleBootstrapResult,
  CHROME_GOOGLE_SIGNIN_URL,
  detectGoogleSignedIn,
  evaluateGoogleHomeReady,
  fillGoogleEmailIfNeeded,
  fillGooglePasswordIfNeeded,
  navigateToGoogleHome,
  tryAcceptChromeProfileSyncPrompt,
  waitAndAcceptChromeProfileSyncPrompt,
  waitForGoogleSignInCompletion,
  type ChromeGoogleBootstrapOptions,
  type ChromeGoogleBootstrapResult,
} from "./chromeGoogleBootstrap.js";

export interface ChromeBootstrapRunnerOptions extends ChromeGoogleBootstrapOptions {
  maxRounds?: number;
  roundDelayMs?: number;
}

const DEFAULT_MAX_ROUNDS = 16;
const DEFAULT_ROUND_DELAY_MS = 900;

async function executeChromeBootstrapPhase(
  page: Page,
  phase: ChromeBootstrapPhaseId,
  credentials: ChromeGoogleCredentials,
  profile: ResolvedProfile,
): Promise<void> {
  const { email: googleEmail, password: googlePassword, profileName } = credentials;

  switch (phase) {
    case "google_home":
      logger.info("[chrome] Google giris sayfasina yonlendiriliyor...");
      await page.goto(CHROME_GOOGLE_SIGNIN_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      break;

    case "google_signin_email":
      if (!googleEmail) {
        logger.warn("[chrome] GOOGLE_EMAIL_PROFILE_* tanimli degil — email manuel girilmeli.");
        break;
      }
      await fillGoogleEmailIfNeeded(page, googleEmail);
      break;

    case "google_signin_password":
      if (!googlePassword) {
        logger.info("[chrome] Google sifre env'de yok — manuel girin.");
        break;
      }
      await fillGooglePasswordIfNeeded(page, googlePassword);
      break;

    case "google_signin_challenge":
      logger.info(
        "[chrome] 2FA veya ek adim algilandi — tarayicida tamamlayin; otomasyon bekleyecek.",
      );
      await tryAcceptChromeProfileSyncPrompt(page, profileName);
      await page.waitForTimeout(2500);
      break;

    case "google_signin_rejected":
      logger.error(
        "[chrome] Google oturum acmayi reddetti (signin/rejected). " +
          "Chrome'u kapatip 'npm run chrome:debug' ile yeniden baslatin; " +
          "otomasyon banner'i olmamali. Gerekirse girisi bu pencerede manuel tamamlayin.",
      );
      await page.waitForTimeout(3000);
      break;

    case "unknown":
      logger.warn("[chrome] Bilinmeyen sayfa — Google anasayfaya donuluyor.");
      await navigateToGoogleHome(page);
      break;

    case "ready":
      break;
  }
}

async function finalizeChromeBootstrap(
  page: Page,
  profile: ResolvedProfile,
  partial: Partial<ChromeGoogleBootstrapResult> = {},
): Promise<ChromeGoogleBootstrapResult> {
  if (!partial.ready && !(await detectGoogleSignedIn(page)) && !(await evaluateGoogleHomeReady(page))) {
    if (!(partial.confirmedByUser ?? false)) {
      return buildChromeGoogleBootstrapResult({
        ...partial,
        ready: false,
        signedInOnGoogle: await detectGoogleSignedIn(page),
      });
    }
  }

  if (!(await detectGoogleSignedIn(page)) && !(await evaluateGoogleHomeReady(page))) {
    await navigateToGoogleHome(page);
  }

  const syncHandled = await waitAndAcceptChromeProfileSyncPrompt(page, profile.name, {
    timeoutMs: 25_000,
  });

  const signedInOnGoogle = await detectGoogleSignedIn(page);
  const googleHomeReady = signedInOnGoogle || (await evaluateGoogleHomeReady(page));

  return buildChromeGoogleBootstrapResult({
    ready: partial.ready ?? googleHomeReady,
    signedInOnGoogle,
    syncPromptHandled: syncHandled || (partial.syncPromptHandled ?? false),
    skippedExistingSession: partial.skippedExistingSession ?? false,
    confirmedByUser: partial.confirmedByUser ?? false,
  });
}

/**
 * Chrome profil + Google oturumu — wizard gibi faz algilar, hata sonrasi kaldigi yerden devam eder.
 */
export async function runChromeBootstrapLoop(
  page: Page,
  credentials: ChromeGoogleCredentials,
  profile: ResolvedProfile,
  options: ChromeBootstrapRunnerOptions = {},
): Promise<ChromeGoogleBootstrapResult> {
  const { email: googleEmail, profileName } = credentials;
  const allowReuseExisting = options.allowReuseExisting ?? false;
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const roundDelayMs = options.roundDelayMs ?? DEFAULT_ROUND_DELAY_MS;
  const profileDirectory = profile.browser?.profileDirectory ?? "Default";
  const linkedOnDisk = isChromeProfileLinkedToGoogle(
    profile.absoluteUserDataDir,
    profileDirectory,
  );

  logger.info("[chrome] Chrome profil / Google giris asamasi basliyor (self-healing)...");
  if (!allowReuseExisting) {
    logger.info("[chrome] Temiz profil modu — kayitli oturum atlanmayacak, giris akisi calisacak.");
  }

  await navigateToGoogleHome(page);

  if (allowReuseExisting && linkedOnDisk && (await evaluateGoogleHomeReady(page))) {
    const syncHandled = await tryAcceptChromeProfileSyncPrompt(page, profileName);
    if (!syncHandled) {
      logger.info("[chrome] Senkron popup yok — mevcut Chrome profili ile devam (normal).");
    }
    logger.info("[chrome] Kayitli Chrome/Google oturumu kullaniliyor — giris atlandi.");
    return buildChromeGoogleBootstrapResult({
      ready: true,
      signedInOnGoogle: await detectGoogleSignedIn(page),
      syncPromptHandled: syncHandled,
      skippedExistingSession: true,
    });
  }

  if (allowReuseExisting && (await evaluateGoogleHomeReady(page))) {
    const syncHandled = await tryAcceptChromeProfileSyncPrompt(page, profileName);
    if (!syncHandled) {
      logger.info("[chrome] Senkron popup yok — google.com hazir (normal).");
    }
    return buildChromeGoogleBootstrapResult({
      ready: true,
      signedInOnGoogle: await detectGoogleSignedIn(page),
      syncPromptHandled: syncHandled,
    });
  }

  let confirmedByUser = false;
  let lastPhase: ChromeBootstrapPhaseId | null = null;
  let challengeRounds = 0;

  for (let round = 1; round <= maxRounds; round++) {
    await page.bringToFront().catch(() => {});
    await tryAcceptChromeProfileSyncPrompt(page, profileName);

    const state = await detectChromeBootstrapState(page);
    logger.info(`[chrome] [tur ${round}/${maxRounds}] ${formatChromeBootstrapLog(state)}`);

    if (state.phase === "ready" || state.googleHomeReady) {
      const syncHandled = await tryAcceptChromeProfileSyncPrompt(page, profileName);
      logger.info("[chrome] Google oturumu hazir — bootstrap tamamlandi.");
      return finalizeChromeBootstrap(page, profile, {
        ready: true,
        signedInOnGoogle: state.signedInOnGoogle,
        syncPromptHandled: syncHandled,
        confirmedByUser,
      });
    }

    if (state.phase === "google_signin_challenge") {
      challengeRounds += 1;
      if (challengeRounds >= 4 && !confirmedByUser) {
        logger.info(
          "[chrome] Challenge adimi uzun suruyor — Enter ile manuel onay da kullanilabilir.",
        );
        confirmedByUser = await waitForGoogleSignInCompletion(page, profileName);
        if (confirmedByUser || (await detectGoogleSignedIn(page))) {
          return finalizeChromeBootstrap(page, profile, {
            ready: true,
            confirmedByUser,
          });
        }
      }
    } else {
      challengeRounds = 0;
    }

    if (state.phase === lastPhase && state.phase !== "google_signin_challenge") {
      logger.info(`[chrome] Ayni faz tekrarlandi (${state.phase}) — ek deneme yapiliyor.`);
    }
    lastPhase = state.phase;

    try {
      await executeChromeBootstrapPhase(page, state.phase, credentials, profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `[chrome] Adim hatasi (${state.phase}) — tur tekrarlanacak: ${message}`,
      );
    }

    if (!googleEmail && state.phase === "google_signin_email") {
      logger.warn("[chrome] Email env yok — manuel giris bekleniyor (Enter)...");
      confirmedByUser = await waitForGoogleSignInCompletion(page, profileName);
      if (confirmedByUser || (await detectGoogleSignedIn(page))) {
        return finalizeChromeBootstrap(page, profile, {
          ready: true,
          confirmedByUser,
        });
      }
    }

    const afterPhase = await detectChromeBootstrapPhase(page);
    if (afterPhase === "ready") {
      return finalizeChromeBootstrap(page, profile, {
        ready: true,
        confirmedByUser,
      });
    }

    await page.waitForTimeout(roundDelayMs);
  }

  logger.warn(
    `[chrome] ${maxRounds} tur sonunda otomatik tamamlanamadi — manuel onay veya son durum kontrolu.`,
  );

  if (!confirmedByUser) {
    confirmedByUser = await waitForGoogleSignInCompletion(page, profileName);
  }

  return finalizeChromeBootstrap(page, profile, {
    ready: confirmedByUser || (await evaluateGoogleHomeReady(page)),
    confirmedByUser,
  });
}
