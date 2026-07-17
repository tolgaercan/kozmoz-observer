import type { Page } from "playwright";

import {
  detectGoogleSignedIn,
  evaluateGoogleHomeReady,
  isGoogleAccountsPage,
  isGoogleHomePage,
  isGoogleSignInLinkVisible,
  isGoogleSignInRejected,
  isGoogleSignInEmailFieldVisible,
  isGoogleSignInPasswordFieldVisible,
} from "./chromeGoogleBootstrap.js";

export type ChromeBootstrapPhaseId =
  | "ready"
  | "google_home"
  | "google_signin_email"
  | "google_signin_password"
  | "google_signin_challenge"
  | "google_signin_rejected"
  | "unknown";

export const CHROME_BOOTSTRAP_PHASE_TITLES: Record<ChromeBootstrapPhaseId, string> = {
  ready: "Google oturumu hazır",
  google_home: "Google anasayfa — giriş gerekli",
  google_signin_email: "Google email adımı",
  google_signin_password: "Google şifre adımı",
  google_signin_challenge: "Google ek doğrulama (2FA / challenge)",
  google_signin_rejected: "Google oturum reddedildi",
  unknown: "Bilinmeyen sayfa",
};

export interface ChromeBootstrapState {
  phase: ChromeBootstrapPhaseId;
  title: string;
  url: string;
  signedInOnGoogle: boolean;
  googleHomeReady: boolean;
}

export async function detectChromeBootstrapPhase(page: Page): Promise<ChromeBootstrapPhaseId> {
  const url = page.url();

  if (isGoogleSignInRejected(url)) {
    return "google_signin_rejected";
  }

  if (await isGoogleSignInPasswordFieldVisible(page)) {
    return "google_signin_password";
  }

  if (await isGoogleSignInEmailFieldVisible(page)) {
    return "google_signin_email";
  }

  if (isGoogleHomePage(url)) {
    if (await detectGoogleSignedIn(page)) {
      return "ready";
    }
    if (await isGoogleSignInLinkVisible(page)) {
      return "google_home";
    }
    if (await evaluateGoogleHomeReady(page)) {
      return "ready";
    }
    return "google_home";
  }

  if (isGoogleAccountsPage(url)) {
    return "google_signin_challenge";
  }

  if (await detectGoogleSignedIn(page)) {
    return "ready";
  }

  return "unknown";
}

export async function detectChromeBootstrapState(page: Page): Promise<ChromeBootstrapState> {
  const url = page.url();
  const phase = await detectChromeBootstrapPhase(page);
  const signedInOnGoogle = await detectGoogleSignedIn(page);
  const googleHomeReady =
    signedInOnGoogle || (isGoogleHomePage(url) && (await evaluateGoogleHomeReady(page)));

  return {
    phase,
    title: CHROME_BOOTSTRAP_PHASE_TITLES[phase],
    url,
    signedInOnGoogle,
    googleHomeReady,
  };
}

export function formatChromeBootstrapLog(state: ChromeBootstrapState): string {
  const shortUrl = state.url.length > 72 ? `${state.url.slice(0, 69)}...` : state.url;
  return (
    `faz=${state.phase} (${state.title}) | oturum=${state.signedInOnGoogle} | url=${shortUrl}`
  );
}
