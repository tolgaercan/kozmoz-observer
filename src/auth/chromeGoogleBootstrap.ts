import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { Page } from "playwright";

import { isChromeProfileLinkedToGoogle } from "../browser/chromeProfileIdentity.js";
import {
  isChromeInterceptDialogPresent,
  probeChromeInterceptDialog,
  tryClickChromeInterceptDialogInContext,
} from "./chromeInterceptDialog.js";
import { humanClickLocator } from "../interaction/humanClick.js";
import { humanTypeIntoLocator } from "../interaction/humanType.js";
import type { ChromeGoogleCredentials } from "../profiles/profileCredentials.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";
import { maskEmail } from "../profiles/profileCredentials.js";

const GOOGLE_HOME_URL = "https://www.google.com/";
const GOOGLE_SIGNIN_URL =
  "https://accounts.google.com/v3/signin/identifier?continue=https://www.google.com/&flowName=GlifWebSignIn&flowEntry=ServiceLogin";

const GOOGLE_SIGNED_IN_SELECTORS = [
  'a[aria-label*="Google Hesab"]',
  'a[aria-label*="Google Account"]',
  'img[alt*="Google Hesab"]',
  'a[href^="https://accounts.google.com/SignOutOptions"]',
  'a[href*="accounts.google.com/SignOutOptions"]',
];

export interface ChromeGoogleBootstrapOptions {
  /** false = kayitli oturumu kullanma, her seferinde giris akisi */
  allowReuseExisting?: boolean;
}

export interface ChromeGoogleBootstrapResult {
  ready: boolean;
  signedInOnGoogle: boolean;
  syncPromptHandled: boolean;
  skippedExistingSession: boolean;
  confirmedByUser: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveChromeButtonFirstName(profileName: string): string {
  const trimmed = profileName.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

function isGoogleHomePage(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "www.google.com" || hostname === "google.com" || hostname === "www.google.com.tr";
  } catch {
    return false;
  }
}

function isGoogleAccountsPage(url: string): boolean {
  return /accounts\.google\.com/i.test(url);
}

function isGoogleSignInRejected(url: string): boolean {
  return /signin\/rejected|signin\/challenge\/blocked/i.test(url);
}

export async function detectGoogleSignedIn(page: Page): Promise<boolean> {
  const url = page.url();

  if (isGoogleAccountsPage(url)) {
    return false;
  }

  if (!isGoogleHomePage(url)) {
    return false;
  }

  for (const selector of GOOGLE_SIGNED_IN_SELECTORS) {
    const visible = await page
      .locator(selector)
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (visible) {
      return true;
    }
  }

  return false;
}

async function isGoogleSignInLinkVisible(page: Page): Promise<boolean> {
  return page
    .getByRole("link", { name: /oturum aç|sign in|giriş yap/i })
    .first()
    .isVisible({ timeout: 1500 })
    .catch(() => false);
}

export async function navigateToGoogleHome(page: Page): Promise<void> {
  logger.info(`[chrome] Google anasayfaya gidiliyor: ${GOOGLE_HOME_URL}`);
  await page.goto(GOOGLE_HOME_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
}

async function clickGoogleFormNext(
  page: Page,
  step: "identifier" | "password",
): Promise<void> {
  const container = step === "identifier" ? "#identifierNext" : "#passwordNext";
  const containerButton = page.locator(`${container} button`).first();
  if (await containerButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await containerButton.click();
    return;
  }

  const containerDiv = page.locator(container).first();
  if (await containerDiv.isVisible({ timeout: 2000 }).catch(() => false)) {
    await containerDiv.click();
    return;
  }

  const namedNext = page.getByRole("button", { name: /^(ileri|next)$/i }).first();
  if (await namedNext.isVisible({ timeout: 2000 }).catch(() => false)) {
    await namedNext.click();
  }
}

async function waitForGooglePasswordField(page: Page): Promise<boolean> {
  const passwordInput = page.locator(
    'input[type="password"], input[name="Passwd"], input[name="password"]',
  ).first();

  try {
    await passwordInput.waitFor({ state: "visible", timeout: 30_000 });
    logger.info("[chrome] Sifre ekrani acildi.");
    return true;
  } catch {
    return false;
  }
}

async function fillGoogleEmailIfNeeded(page: Page, googleEmail: string): Promise<void> {
  const emailInput = page.locator(
    'input[type="email"], input[name="identifier"], input[autocomplete="username"]',
  ).first();
  const visible = await emailInput.isVisible({ timeout: 8000 }).catch(() => false);
  if (!visible) {
    return;
  }

  logger.info(`[chrome] Google email dolduruluyor: ${maskEmail(googleEmail)}`);
  await emailInput.click();
  await emailInput.fill("");
  await humanTypeIntoLocator(page, emailInput, googleEmail, {
    label: "Google email",
    minCharDelayMs: 35,
    maxCharDelayMs: 110,
  });

  logger.info("[chrome] Email sonrasi İleri tiklaniyor...");
  await clickGoogleFormNext(page, "identifier");
  await page.waitForTimeout(1200);

  const passwordReady = await waitForGooglePasswordField(page);
  if (!passwordReady) {
    logger.warn("[chrome] Sifre ekrani gelmedi — Enter ile deneniyor.");
    await emailInput.press("Enter");
    await page.waitForTimeout(1500);
    await waitForGooglePasswordField(page);
  }
}

async function fillGooglePasswordIfNeeded(page: Page, password: string): Promise<boolean> {
  if (!password) {
    logger.info("[chrome] Google sifre env'de yok — manuel girin.");
    return false;
  }

  const passwordReady = await waitForGooglePasswordField(page);
  if (!passwordReady) {
    logger.warn("[chrome] Sifre alani bulunamadi.");
    return false;
  }

  const passwordInput = page.locator(
    'input[type="password"], input[name="Passwd"], input[name="password"]',
  ).first();

  logger.info("[chrome] Google sifre dolduruluyor...");
  await passwordInput.click();
  await humanTypeIntoLocator(page, passwordInput, password, {
    label: "Google password",
    minCharDelayMs: 35,
    maxCharDelayMs: 110,
  });

  logger.info("[chrome] Sifre sonrasi İleri tiklaniyor...");
  await clickGoogleFormNext(page, "password");
  await page.waitForTimeout(2000);

  logger.info("[chrome] Sifre gonderildi — 2FA cikarsa manuel tamamlayin.");
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function clickSyncContinueButton(page: Page, locator: ReturnType<Page["locator"]>): Promise<boolean> {
  if (!(await locator.isVisible({ timeout: 1500 }).catch(() => false))) {
    return false;
  }
  await humanClickLocator(page, locator.first(), { label: "Chrome devam et", waitTimeoutMs: 10_000 });
  await page.waitForTimeout(800);
  return true;
}

/**
 * Chrome senkron popup — opsiyonel, yoksa hata degil.
 * Ornek: "Tolga olarak devam et" / "Continue as ..."
 *
 * Chrome native UI: #interceptDialog > cr-button#accept-button
 */
export async function tryAcceptChromeProfileSyncPrompt(
  page: Page,
  profileName?: string,
): Promise<boolean> {
  const context = page.context();

  if (await tryClickChromeInterceptDialogInContext(context)) {
    return true;
  }

  const firstName = profileName ? resolveChromeButtonFirstName(profileName) : "";

  const chromeNativeSelectors = [
    "#interceptDialog #accept-button",
    "cr-button#accept-button",
    "#accept-button",
    "#interceptDialog cr-button.action-button",
  ];

  for (const selector of chromeNativeSelectors) {
    const button = page.locator(selector).first();
    if (await clickSyncContinueButton(page, button)) {
      logger.info(`[chrome] Chrome senkron popup — accept-button tiklandi (${selector}).`);
      return true;
    }
  }

  if (firstName) {
    const ariaLabelButton = page.locator(
      `#accept-button[aria-label*="${firstName}"][aria-label*="olarak devam et" i]`,
    );
    if (await clickSyncContinueButton(page, ariaLabelButton)) {
      logger.info("[chrome] Chrome senkron popup — aria-label ile devam et tiklandi.");
      return true;
    }

    const namedButton = page.getByRole("button", {
      name: new RegExp(`${escapeRegExp(firstName)}.*olarak devam et`, "i"),
    });
    if (await clickSyncContinueButton(page, namedButton)) {
      logger.info("[chrome] Chrome senkron popup — profil adi ile devam et tiklandi.");
      return true;
    }

    const namedTextButton = page.locator(`button:has-text("${firstName} olarak devam et")`);
    if (await clickSyncContinueButton(page, namedTextButton)) {
      logger.info("[chrome] Chrome senkron popup — devam et tiklandi.");
      return true;
    }
  }

  const genericRole = page.getByRole("button", { name: /olarak devam et|continue as/i });
  if (await clickSyncContinueButton(page, genericRole)) {
    logger.info("[chrome] Chrome senkron popup — devam et tiklandi.");
    return true;
  }

  const cssSelectors = [
    'button:has-text("olarak devam et")',
    'button:has-text("Continue as")',
    '[role="button"]:has-text("devam et")',
  ];

  for (const selector of cssSelectors) {
    const button = page.locator(selector).first();
    if (await clickSyncContinueButton(page, button)) {
      logger.info("[chrome] Chrome senkron popup — devam et tiklandi.");
      return true;
    }
  }

  return false;
}

/** Popup gecikmeli cikabilir — poll ile bekler, yoksa hata vermez. */
export async function waitAndAcceptChromeProfileSyncPrompt(
  page: Page,
  profileName: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const pollMs = options.pollMs ?? 1000;
  const started = Date.now();

  logger.info(
    `[chrome] Chrome profil popup bekleniyor ("${resolveChromeButtonFirstName(profileName)} olarak devam et", max ${Math.round(timeoutMs / 1000)}s)...`,
  );

  while (Date.now() - started < timeoutMs) {
    await page.bringToFront();

    if (Date.now() - started > 3000) {
      const signedIn = await detectGoogleSignedIn(page);
      const dialogPresent = await isChromeInterceptDialogPresent(page);
      if (signedIn && !dialogPresent) {
        logger.info(
          "[chrome] Google oturumu acik ve senkron popup gorunmuyor — adim atlaniyor.",
        );
        return true;
      }
    }

    const dialogVisible = await isChromeInterceptDialogPresent(page);
    const bannerVisible =
      dialogVisible ||
      (await page
        .getByText(/Chrome.*uyarlay|Customize Chrome|oturum açmak istiyor musunuz/i)
        .first()
        .isVisible({ timeout: 400 })
        .catch(() => false));

    if (bannerVisible || Date.now() - started > 2000) {
      if (await tryAcceptChromeProfileSyncPrompt(page, profileName)) {
        const stillOpen =
          (await isChromeInterceptDialogPresent(page)) ||
          (await page
            .getByText(/Chrome.*uyarlay|Customize Chrome/i)
            .first()
            .isVisible({ timeout: 800 })
            .catch(() => false));
        if (!stillOpen) {
          logger.info("[chrome] Chrome profil popup kapatildi.");
          return true;
        }
      }
    }

    if ((Date.now() - started) % 10_000 < pollMs) {
      const probe = await probeChromeInterceptDialog(page);
      logger.info(
        `[chrome] Popup bekleniyor — ${Math.round((Date.now() - started) / 1000)}s (CDP dialog=${probe.dialogCount}, accept=${probe.acceptCount})`,
      );
    }

    await sleep(pollMs);
  }

  logger.info("[chrome] Senkron popup bulunamadi — atlaniyor (normal olabilir).");
  return false;
}

async function waitForGoogleSignInCompletion(
  page: Page,
  profileName: string,
): Promise<boolean> {
  logger.info("[chrome] 2FA veya ek adim varsa tarayicida tamamlayin.");
  logger.info("[chrome] Bitince google.com acilacak veya Enter'a basabilirsiniz.");

  return new Promise<boolean>((resolve) => {
    const rl = readline.createInterface({ input, output });
    let settled = false;

    const finish = (confirmedByUser: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      rl.close();
      resolve(confirmedByUser);
    };

    const onSigint = (): void => {
      logger.info("[chrome] Ctrl+C — bekleme sonlandirildi, devam ediliyor.");
      finish(true);
    };

    process.once("SIGINT", onSigint);

    void rl
      .question("\n[chrome] Google girisi tamamlandiysa Enter'a basin...\n")
      .then(() => {
        logger.info("[chrome] Enter alindi — devam ediliyor.");
        finish(true);
      })
      .catch(() => {
        finish(true);
      })
      .finally(() => {
        process.off("SIGINT", onSigint);
      });

    void (async () => {
      const started = Date.now();
      while (!settled) {
        const syncHandled = await tryAcceptChromeProfileSyncPrompt(page, profileName);
        if (syncHandled) {
          logger.info("[chrome] Senkron popup kapatildi.");
        }

        if (await detectGoogleSignedIn(page)) {
          logger.info("[chrome] Google anasayfada oturum algilandi.");
          finish(false);
          return;
        }

        if (Date.now() - started > 1_800_000) {
          logger.error("[chrome] Google giris zaman asimi (30 dk).");
          finish(false);
          return;
        }

        if ((Date.now() - started) % 30_000 < 2500) {
          logger.info(
            `[chrome] Google girisi bekleniyor — ${Math.round((Date.now() - started) / 1000)}s`,
          );
        }

        await sleep(2500);
      }
    })();
  });
}

function buildResult(partial: Partial<ChromeGoogleBootstrapResult>): ChromeGoogleBootstrapResult {
  return {
    ready: false,
    signedInOnGoogle: false,
    syncPromptHandled: false,
    skippedExistingSession: false,
    confirmedByUser: false,
    ...partial,
  };
}

async function evaluateGoogleHomeReady(page: Page): Promise<boolean> {
  if (await detectGoogleSignedIn(page)) {
    return true;
  }
  if (!(await isGoogleSignInLinkVisible(page))) {
    logger.info("[chrome] Oturum Ac linki yok — google.com hazir kabul ediliyor.");
    return true;
  }
  return false;
}

/**
 * Asama 1: Chrome profil + Google oturumu.
 * Popup yoksa hata vermez; tekrar calistirmada mevcut oturumu kullanir.
 */
export async function runChromeGoogleBootstrap(
  page: Page,
  credentials: ChromeGoogleCredentials,
  profile: ResolvedProfile,
  options: ChromeGoogleBootstrapOptions = {},
): Promise<ChromeGoogleBootstrapResult> {
  const { email: googleEmail, password: googlePassword, profileName } = credentials;
  const allowReuseExisting = options.allowReuseExisting ?? false;
  const profileDirectory = profile.browser?.profileDirectory ?? "Default";
  const linkedOnDisk = isChromeProfileLinkedToGoogle(
    profile.absoluteUserDataDir,
    profileDirectory,
  );

  logger.info("[chrome] Chrome profil / Google giris asamasi basliyor...");
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
    return buildResult({
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
    return buildResult({
      ready: true,
      signedInOnGoogle: await detectGoogleSignedIn(page),
      syncPromptHandled: syncHandled,
    });
  }

  logger.info("[chrome] Google oturumu yok — giris sayfasina yonlendiriliyor.");
  await page.goto(GOOGLE_SIGNIN_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  if (isGoogleSignInRejected(page.url())) {
    logger.error(
      "[chrome] Google oturum acmayi reddetti (signin/rejected). " +
        "Chrome'u kapatip 'npm run chrome:debug' ile yeniden baslatin; " +
        "otomasyon banner'i (--enable-automation) olmamali. Gerekirse girisi bu pencerede manuel tamamlayin.",
    );
  }

  if (googleEmail) {
    try {
      await fillGoogleEmailIfNeeded(page, googleEmail);
      await fillGooglePasswordIfNeeded(page, googlePassword);
    } catch (error) {
      logger.warn(
        `[chrome] Google giris otomasyonu kismen basarisiz — manuel devam: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } else {
    logger.warn("[chrome] GOOGLE_EMAIL_PROFILE_* tanimli degil — email manuel girilmeli.");
  }

  const confirmedByUser = await waitForGoogleSignInCompletion(page, profileName);

  if (!isGoogleHomePage(page.url())) {
    await navigateToGoogleHome(page);
  }

  const syncHandled = await waitAndAcceptChromeProfileSyncPrompt(page, profileName, {
    timeoutMs: 25_000,
  });

  const signedInOnGoogle = await detectGoogleSignedIn(page);
  const googleHomeReady = signedInOnGoogle || (await evaluateGoogleHomeReady(page));

  if (googleHomeReady || confirmedByUser) {
    return buildResult({
      ready: true,
      signedInOnGoogle,
      syncPromptHandled: syncHandled,
      confirmedByUser,
    });
  }

  logger.warn(
    "[chrome] Google oturumu otomatik dogrulanamadi — Enter ile devam ettiyseniz sorun yok.",
  );
  return buildResult({
    ready: confirmedByUser,
    signedInOnGoogle,
    syncPromptHandled: syncHandled,
    confirmedByUser,
  });
}

/** @deprecated tryAcceptChromeProfileSyncPrompt kullanin */
export const acceptChromeProfileSyncPrompt = tryAcceptChromeProfileSyncPrompt;
