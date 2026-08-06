import type { Locator, Page } from "playwright";

import { detectWizardStep } from "../portal/wizardStepDetector.js";
import type { NavigationSettings } from "../config/settings.js";
import { humanClickLocator } from "../interaction/humanClick.js";
import { logger } from "../utils/logger.js";

export function resolveAppointmentProceduresUrl(homeUrl: string): string {
  const explicit = process.env.PORTAL_APPOINTMENT_PROCEDURES_URL?.trim();
  if (explicit) {
    return explicit;
  }
  return new URL("/appointmentProcedures", homeUrl).toString();
}

export function resolveAppointmentFormUrl(homeUrl: string): string {
  const explicit = process.env.PORTAL_APPOINTMENT_FORM_URL?.trim();
  if (explicit) {
    return explicit;
  }
  return new URL("/appointmentForm", homeUrl).toString();
}

/** Başvuru Formu — menü tıklaması yerine doğrudan URL tercih edilir */
function isRegisterFormPage(url: string): boolean {
  return /\/registerForm\b/i.test(url);
}

export type PortalNavState =
  | "registerForm"
  | "appointmentProcedures"
  | "appointmentForm"
  | "portalHome"
  | "unknown";

export function detectPortalNavState(url: string): PortalNavState {
  if (/\/registerForm\b/i.test(url)) {
    return "registerForm";
  }
  if (/\/appointmentForm\b/i.test(url)) {
    return "appointmentForm";
  }
  if (/\/appointmentProcedures\b/i.test(url)) {
    return "appointmentProcedures";
  }
  if (/kosmosvize\.com\.tr\/?$/i.test(url)) {
    return "portalHome";
  }
  return "unknown";
}

/** Kosmos üst menü: li.nav-link > a[href='/appointmentProcedures'] > span.nav-item-title */
export const RANDEVU_ISLEMLERI_SELECTORS = [
  "li.nav-link a[href='/appointmentProcedures']",
  "a[href='/appointmentProcedures']",
  "li.nav-link:has(a[href='/appointmentProcedures']) a",
  "li.nav-link span.nav-item-title:has-text('Randevu İşlemleri')",
  "span.nav-item-title:has-text('Randevu İşlemleri')",
  "header a:has-text('Randevu İşlemleri')",
  "nav a:has-text('Randevu İşlemleri')",
];

export const RANDEVU_AL_SELECTORS = [
  "a.tab-link:has-text('Randevu Al')",
  "a[href='/appointmentForm']",
  "a:has-text('Randevu Al')",
  "role=link[name='Randevu Al']",
];

const MAX_NAV_ROUNDS = 4;

type NavClickStrategy = "playwright" | "evaluate" | "human" | "goto";

export async function isRandevuProceduresOpen(page: Page): Promise<boolean> {
  const url = page.url();
  if (isRegisterFormPage(url)) {
    return false;
  }
  if (/\/appointmentProcedures\b|\/appointmentForm\b/i.test(url)) {
    return true;
  }
  const randevuAlCount = await page.locator("a.tab-link:has-text('Randevu Al')").count();
  return randevuAlCount > 0;
}

export async function isAppointmentWizardReady(page: Page): Promise<boolean> {
  const url = page.url();
  if (!/\/appointmentForm\b/i.test(url)) {
    return false;
  }
  const wizard = await detectWizardStep(page);
  if (wizard?.isOnWizard) {
    return true;
  }
  return (await page.locator("#cities, select[name='cities']").count()) > 0;
}

/** @deprecated isRandevuProceduresOpen veya isAppointmentWizardReady kullanın */
export async function isAppointmentSectionReady(page: Page): Promise<boolean> {
  return (await isRandevuProceduresOpen(page)) || (await isAppointmentWizardReady(page));
}

export async function waitForRandevuProcedures(
  page: Page,
  timeoutMs = 15_000,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isRandevuProceduresOpen(page)) {
      return true;
    }
    await page.waitForTimeout(400);
  }
  return false;
}

export async function waitForAppointmentWizard(
  page: Page,
  timeoutMs = 15_000,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isAppointmentWizardReady(page)) {
      return true;
    }
    await page.waitForTimeout(400);
  }
  return false;
}

export async function waitForAppointmentSection(
  page: Page,
  timeoutMs = 15_000,
): Promise<boolean> {
  return waitForRandevuProcedures(page, timeoutMs);
}

async function findFirstVisibleNavLocator(
  page: Page,
  selectors: string[],
): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible({ timeout: 1500 }).catch(() => false);
    if (visible) {
      return locator;
    }
  }
  return null;
}

async function navigateToPortalUrl(
  page: Page,
  targetUrl: string,
  settings?: NavigationSettings,
): Promise<void> {
  if (settings?.waitBetweenStepsMs) {
    await page.waitForTimeout(settings.waitBetweenStepsMs);
  }
  logger.info(`[nav] Doğrudan URL (son çare): ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (settings?.waitAfterLoadMs) {
    await page.waitForTimeout(settings.waitAfterLoadMs);
  }
}

async function navigateSameOriginPath(page: Page, path: string, homeUrl?: string, settings?: NavigationSettings): Promise<void> {
  if (homeUrl) {
    await navigateToPortalUrl(page, new URL(path, homeUrl).toString(), settings);
    return;
  }
  const origin = new URL(page.url()).origin;
  await navigateToPortalUrl(
    page,
    `${origin}${path.startsWith("/") ? path : `/${path}`}`,
    settings,
  );
}

async function clickNavLocator(
  page: Page,
  locator: Locator,
  selector: string,
  strategy: NavClickStrategy,
  settings: NavigationSettings,
  stepLabel: string,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  if (strategy === "playwright") {
    logger.info(`[${stepLabel}] Playwright click: ${selector}`);
    await locator.click({ timeout: 10_000 });
    return;
  }

  if (strategy === "evaluate") {
    logger.info(`[${stepLabel}] DOM click: ${selector}`);
    await locator.evaluate((element: HTMLElement) => {
      element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
      );
      element.click();
    });
    return;
  }

  if (strategy === "human") {
    logger.info(`[${stepLabel}] İnsan benzeri click: ${selector}`);
    await humanClickLocator(page, locator, {
      label: selector,
      waitTimeoutMs: 10_000,
      minStepDelayMs: settings.minStepDelayMs,
      maxStepDelayMs: settings.maxStepDelayMs,
      overshootProbability: settings.overshootProbability,
    });
    return;
  }

  throw new Error(`Bilinmeyen nav stratejisi: ${strategy}`);
}

async function tryNavSelectors(
  page: Page,
  selectors: string[],
  strategy: NavClickStrategy,
  settings: NavigationSettings,
  stepLabel: string,
): Promise<boolean> {
  if (strategy === "goto") {
    return false;
  }

  const locator = await findFirstVisibleNavLocator(page, selectors);
  if (!locator) {
    logger.warn(`[${stepLabel}] Görünür menü linki bulunamadı (${strategy}).`);
    return false;
  }

  await clickNavLocator(page, locator, selectors[0] ?? stepLabel, strategy, settings, stepLabel);
  return true;
}

function strategiesForProceduresRound(round: number): NavClickStrategy[] {
  // İnsan benzeri: menü tıklaması önce, doğrudan URL en son (ban riski)
  if (round === 1) {
    return ["human", "playwright", "evaluate", "goto"];
  }
  if (round === 2) {
    return ["human", "evaluate", "playwright", "goto"];
  }
  return ["human", "goto"];
}

function strategiesForRandevuAlRound(round: number): NavClickStrategy[] {
  if (round === 1) {
    return ["human", "playwright", "evaluate", "goto"];
  }
  if (round === 2) {
    return ["human", "playwright", "evaluate", "goto"];
  }
  return ["human", "goto"];
}

async function ensureRandevuIslemleri(
  page: Page,
  settings: NavigationSettings,
  round: number,
  homeUrl?: string,
): Promise<boolean> {
  if (await isRandevuProceduresOpen(page)) {
    return true;
  }

  const beforeUrl = page.url();
  const strategies = strategiesForProceduresRound(round);
  const proceduresUrl = homeUrl ? resolveAppointmentProceduresUrl(homeUrl) : undefined;

  for (const strategy of strategies) {
    if (strategy === "goto") {
      if (proceduresUrl) {
        await navigateToPortalUrl(page, proceduresUrl, settings);
      } else {
        await navigateSameOriginPath(page, "/appointmentProcedures", undefined, settings);
      }
    } else {
      const clicked = await tryNavSelectors(
        page,
        RANDEVU_ISLEMLERI_SELECTORS,
        strategy,
        settings,
        "Randevu İşlemleri",
      );
      if (!clicked) {
        continue;
      }
    }

    if (settings.waitBetweenStepsMs > 0) {
      await page.waitForTimeout(settings.waitBetweenStepsMs);
    }

    if (await waitForRandevuProcedures(page, 10_000)) {
      logger.info(`[nav] Randevu İşlemleri açıldı — URL: ${page.url()}`);
      return true;
    }

    if (page.url() !== beforeUrl) {
      logger.info(`[nav] URL değişti (${beforeUrl} → ${page.url()}) — doğrulama bekleniyor.`);
      if (await waitForRandevuProcedures(page, 5000)) {
        return true;
      }
    }
  }

  return false;
}

async function ensureRandevuAl(
  page: Page,
  settings: NavigationSettings,
  round: number,
  homeUrl?: string,
): Promise<boolean> {
  if (await isAppointmentWizardReady(page)) {
    return true;
  }

  const beforeUrl = page.url();
  const strategies = strategiesForRandevuAlRound(round);
  const formUrl = homeUrl ? resolveAppointmentFormUrl(homeUrl) : undefined;

  for (const strategy of strategies) {
    if (strategy === "goto") {
      if (formUrl) {
        await navigateToPortalUrl(page, formUrl, settings);
      } else {
        await navigateSameOriginPath(page, "/appointmentForm", undefined, settings);
      }
    } else {
      const clicked = await tryNavSelectors(
        page,
        RANDEVU_AL_SELECTORS,
        strategy,
        settings,
        "Randevu Al",
      );
      if (!clicked) {
        continue;
      }
    }

    if (settings.waitBetweenStepsMs > 0) {
      await page.waitForTimeout(settings.waitBetweenStepsMs);
    }

    if (await waitForAppointmentWizard(page, 10_000)) {
      logger.info(`[nav] Randevu wizard açıldı — URL: ${page.url()}`);
      return true;
    }

    if (page.url() !== beforeUrl) {
      logger.info(`[nav] URL değişti (${beforeUrl} → ${page.url()}) — wizard bekleniyor.`);
      if (await waitForAppointmentWizard(page, 5000)) {
        return true;
      }
    }
  }

  return false;
}

/** @deprecated ensureRandevuIslemleri kullanın */
export async function clickRandevuIslemleri(
  page: Page,
  settings: NavigationSettings,
): Promise<void> {
  const opened = await ensureRandevuIslemleri(page, settings, 1);
  if (!opened) {
    throw new Error(
      "Randevu İşlemleri açılamadı. Menü görünür mü kontrol edin.",
    );
  }
}

/** @deprecated ensureRandevuAl kullanın */
export async function clickRandevuAl(
  page: Page,
  settings: NavigationSettings,
): Promise<void> {
  const opened = await ensureRandevuAl(page, settings, 1);
  if (!opened) {
    throw new Error("Randevu Al tıklandı ancak randevu wizard açılmadı.");
  }
}

/**
 * Portal menü navigasyonu — wizard gibi durum makinesi.
 * registerForm / procedures / appointmentForm konumuna göre ilerler;
 * SPA menü tıklaması, DOM click ve en son same-origin goto dener (F5 değil).
 */
export async function navigateKosmosAppointmentFlow(
  page: Page,
  settings: NavigationSettings,
  options: { homeUrl?: string } = {},
): Promise<void> {
  const homeUrl = options.homeUrl;

  for (let round = 1; round <= MAX_NAV_ROUNDS; round++) {
    const state = detectPortalNavState(page.url());
    logger.info(`[nav] Tur ${round}/${MAX_NAV_ROUNDS} — portal durumu: ${state} (${page.url()})`);

    if (await isAppointmentWizardReady(page)) {
      logger.info("[nav] Randevu wizard hazır — navigasyon tamam.");
      return;
    }

    if (state === "registerForm" || state === "portalHome" || state === "unknown") {
      logger.info("[nav] Randevu İşlemleri — menü tıklaması öncelikli (URL son çare).");
      const opened = await ensureRandevuIslemleri(page, settings, round, homeUrl);
      if (!opened) {
        if (round === MAX_NAV_ROUNDS) {
          throw new Error(
            "Randevu İşlemleri açılamadı. Menü görünür ama SPA tıklaması yanıt vermedi.",
          );
        }
        continue;
      }
    }

    if (await isAppointmentWizardReady(page)) {
      return;
    }

    const afterProcedures = detectPortalNavState(page.url());
    if (
      afterProcedures === "appointmentProcedures" ||
      afterProcedures === "registerForm" ||
      (await isRandevuProceduresOpen(page))
    ) {
      logger.info("[nav] Randevu Al sekmesine geçiliyor.");
      const opened = await ensureRandevuAl(page, settings, round, homeUrl);
      if (!opened) {
        if (round === MAX_NAV_ROUNDS) {
          throw new Error("Randevu Al açılamadı — randevu wizard yüklenmedi.");
        }
        continue;
      }
    }

    if (await isAppointmentWizardReady(page)) {
      logger.info("[nav] Randevu wizard hazır — navigasyon tamam.");
      return;
    }
  }

  throw new Error(
    `[nav] Randevu akışına ${MAX_NAV_ROUNDS} turda ulaşılamadı — son URL: ${page.url()}`,
  );
}
