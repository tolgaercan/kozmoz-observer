import type { BrowserContext, Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import { humanClickLocator } from "../interaction/humanClick.js";
import { isBasvuruPortalUrl, isKosmosMarketingHome } from "../portal/kosmosOrigin.js";
import { logger } from "../utils/logger.js";
import { detectPortalNavState } from "./kosmosPortalNav.js";

const POPUP_CLOSE_SELECTORS = [
  "a.close-popup-btn",
  ".close-popup-btn",
  "a.close-popup-btn.close-btn-image-container",
  "a.close-popup-btn img[src*='popup-close']",
];

const COOKIE_CONSENT_SELECTORS = [
  "button:has-text('Tamam')",
  "a.button:has-text('Tamam')",
  ".cookie-banner button:has-text('Tamam')",
  "#cookieConsent button:has-text('Tamam')",
];

export const VIZE_BASVURU_ADIMLARI_SELECTORS = [
  "li.nav-item a.btn-online-services[href*='registerform']",
  "a.btn-online-services[href*='registerform']",
  "a.button.btn-blue-gradient[href*='registerform']",
  "a.btn-blue-gradient:has-text('Vize Başvuru Adımları')",
  "a:has-text('Vize Başvuru Adımları')",
  "a[href*='basvuru.kosmosvize.com.tr/registerform']",
];

/** Kosmos tanitim ana sayfa — JWT oturumu icin giris noktasi */
export function fixDuplicateTrPath(url: string): string {
  try {
    const parsed = new URL(url);
    let path = parsed.pathname;
    while (/\/tr\/tr/i.test(path)) {
      path = path.replace(/\/tr\/tr/gi, "/tr");
    }
    parsed.pathname = path;
    return parsed.toString();
  } catch {
    return url.replace(/(\/tr){2,}/gi, "/tr");
  }
}

/** Env / varsayilan — cift /tr ve gereksiz path birlestirmelerini temizler */
export function normalizeKosmosMarketingHomeUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    let path = url.pathname || "/";
    while (/\/tr\/tr/i.test(path)) {
      path = path.replace(/\/tr\/tr/gi, "/tr");
    }
    if (path === "/" || path === "") {
      return `${url.origin}/`;
    }
    if (/^\/tr\/?$/i.test(path)) {
      return `${url.origin}/tr`;
    }
    url.pathname = path;
    return fixDuplicateTrPath(url.toString());
  } catch {
    return "https://www.kosmosvize.com.tr/";
  }
}

export function resolveKosmosMarketingHomeUrl(): string {
  const raw = process.env.KOSMOS_MARKETING_HOME_URL?.trim() ?? "https://www.kosmosvize.com.tr/";
  return normalizeKosmosMarketingHomeUrl(raw);
}

/** Zaten gecerli tanitim ana sayfada mi (cift /tr haric) */
export function isKosmosMarketingEntryUrl(url: string): boolean {
  if (!isKosmosMarketingHome(url)) {
    return false;
  }
  return !/\/tr\/tr/i.test(url);
}

/** Kosmos tanitim ana sayfaya git — cift /tr olusmasini onler */
export async function gotoKosmosMarketingHome(page: import("playwright").Page): Promise<void> {
  const target = resolveKosmosMarketingHomeUrl();
  const current = page.url();

  if (isKosmosMarketingEntryUrl(current)) {
    logger.info(`[home] Zaten Kosmos ana sayfada — goto atlandi (${current})`);
    return;
  }

  if (/\/tr\/tr/i.test(current)) {
    const fixed = fixDuplicateTrPath(current);
    logger.warn(`[home] Cift /tr algilandi — duzeltiliyor: ${fixed}`);
    await page.goto(fixed, { waitUntil: "domcontentloaded", timeout: 90_000 });
    return;
  }

  logger.info(`[home] Kosmos ana sayfaya gidiliyor: ${target}`);
  try {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 90_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/detached|closed|target/i.test(message)) {
      throw error;
    }
    const context = page.context();
    const fresh = await context.newPage();
    logger.warn(`[home] Sekme geçersiz (${message}) — yeni sekmede deneniyor.`);
    await fresh.goto(target, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await fresh.bringToFront().catch(() => undefined);
    return;
  }

  const after = page.url();
  if (/\/tr\/tr/i.test(after)) {
    const fixed = fixDuplicateTrPath(after);
    logger.warn(`[home] Yonlendirme sonrasi cift /tr — duzeltiliyor: ${fixed}`);
    await page.goto(fixed, { waitUntil: "domcontentloaded", timeout: 90_000 });
  }
}

export function resolveRegisterFormUrl(homeUrl?: string): string {
  const explicit = process.env.PORTAL_REGISTER_FORM_URL?.trim();
  if (explicit) {
    return explicit;
  }
  if (homeUrl) {
    try {
      const host = new URL(homeUrl).hostname;
      if (/basvuru\./i.test(host)) {
        return new URL("/registerform", homeUrl).toString();
      }
    } catch {
      // yoksay
    }
  }
  return "https://basvuru.kosmosvize.com.tr/registerform";
}

/** Duyuru popup + cerez — varsa kapat, yoksa sessizce devam (patlamaz). */
export async function dismissKosmosHomeOverlays(page: Page): Promise<void> {
  await dismissKosmosHomePopup(page).catch(() => undefined);
  await dismissKosmosCookieBanner(page).catch(() => undefined);
}

/** Duyuru popup — varsa kapat, yoksa sessizce devam */
export async function dismissKosmosHomePopup(page: Page): Promise<boolean> {
  if (await dismissDuyuruAnnouncementModal(page)) {
    return true;
  }

  for (const selector of POPUP_CLOSE_SELECTORS) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 800 })) {
        logger.info(`[home] Duyuru popup kapatiliyor: ${selector}`);
        await locator.click({ timeout: 5000 });
        await page.waitForTimeout(400);
        return true;
      }
    } catch {
      // sonraki selector
    }
  }

  logger.info("[home] Popup bulunamadi — atlaniyor (normal).");
  return false;
}

/** Kosmos ana sayfa DUYURU modal — sag ust X / Atla benzeri kapatma */
async function dismissDuyuruAnnouncementModal(page: Page): Promise<boolean> {
  const announcement = page.getByText(/^DUYURU:?$/i).first();
  const hasAnnouncement = await announcement.isVisible({ timeout: 1200 }).catch(() => false);
  const hasModalTitle = await page
    .getByText(/duyuru|announcement/i)
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);

  if (!hasAnnouncement && !hasModalTitle) {
    return false;
  }

  logger.info("[home] DUYURU popup algilandi — kapatiliyor...");

  const modalRoots = [
    page.locator(".modal.show").first(),
    page.locator(".modal.in").first(),
    page.locator("[role='dialog']").first(),
    page.locator(".popup-container").first(),
    page.locator(".modal-dialog").first(),
  ];

  for (const modal of modalRoots) {
    if (!(await modal.isVisible({ timeout: 500 }).catch(() => false))) {
      continue;
    }

    const closeCandidates = [
      modal.locator("a.close-popup-btn").first(),
      modal.locator(".close-popup-btn").first(),
      modal.locator("button.close").first(),
      modal.locator(".close").first(),
      modal.locator('[aria-label="Close"]').first(),
      modal.locator('[aria-label="Kapat"]').first(),
      modal.getByRole("button", { name: /^kapat$|^close$|^×$/i }).first(),
    ];

    for (const closeBtn of closeCandidates) {
      try {
        if (await closeBtn.isVisible({ timeout: 500 })) {
          await closeBtn.click({ timeout: 5000 });
          await page.waitForTimeout(400);
          logger.info("[home] DUYURU popup kapatildi.");
          return true;
        }
      } catch {
        // sonraki aday
      }
    }
  }

  const globalClose = page
    .locator(
      '.modal.show .close, .modal.show button.close, .modal.show [aria-label="Close"], .modal.show a.close-popup-btn',
    )
    .first();
  if (await globalClose.isVisible({ timeout: 800 }).catch(() => false)) {
    await globalClose.click({ timeout: 5000 });
    await page.waitForTimeout(400);
    logger.info("[home] DUYURU popup kapatildi (global close).");
    return true;
  }

  return false;
}

/** Çerez banner — varsa Tamam (insani tıklama) */
export async function dismissKosmosCookieBanner(page: Page): Promise<boolean> {
  for (const selector of COOKIE_CONSENT_SELECTORS) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 600 })) {
        logger.info(`[home] Cerez banner kapatiliyor: ${selector}`);
        await humanClickLocator(page, locator, {
          label: "Cerez Tamam",
          waitTimeoutMs: 5000,
        });
        await page.waitForTimeout(350);
        return true;
      }
    } catch {
      // sonraki selector
    }
  }
  return false;
}

async function findVisibleRegisterButton(page: Page) {
  for (const selector of VIZE_BASVURU_ADIMLARI_SELECTORS) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1200 })) {
        return { locator, selector };
      }
    } catch {
      // görünür değil
    }
  }
  return null;
}

async function waitForBasvuruPortalPage(
  context: BrowserContext,
  primary: Page,
  timeoutMs = 20_000,
): Promise<Page> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const candidate of context.pages()) {
      if (candidate.isClosed()) {
        continue;
      }
      if (isBasvuruPortalUrl(candidate.url())) {
        await candidate.bringToFront();
        return candidate;
      }
    }
    if (isBasvuruPortalUrl(primary.url())) {
      return primary;
    }
    await primary.waitForTimeout(350);
  }
  return primary;
}

async function openRegisterFormViaClick(
  page: Page,
  context: BrowserContext,
  settings: AppSettings,
): Promise<Page> {
  const button = await findVisibleRegisterButton(page);
  if (!button) {
    return page;
  }

  logger.info(`[home] Vize Başvuru Adimlari butonu: ${button.selector}`);

  const newTabPromise = context.waitForEvent("page", { timeout: 12_000 }).catch(() => null);

  await humanClickLocator(page, button.locator, {
    label: "Vize Başvuru Adımları",
    waitTimeoutMs: 10_000,
    minStepDelayMs: settings.appointment.minStepDelayMs,
    maxStepDelayMs: settings.appointment.maxStepDelayMs,
    overshootProbability: settings.appointment.overshootProbability,
  });

  const newTab = await newTabPromise;
  if (newTab && !newTab.isClosed()) {
    try {
      await newTab.waitForLoadState("domcontentloaded", { timeout: 45_000 });
    } catch {
      logger.warn("[home] Yeni sekme domcontentloaded zaman asimi — devam.");
    }
    await newTab.bringToFront();
    logger.info(`[home] Yeni sekme acildi: ${newTab.url()}`);
    return newTab;
  }

  return waitForBasvuruPortalPage(context, page);
}

async function openRegisterFormViaGoto(
  page: Page,
  registerUrl: string,
): Promise<Page> {
  logger.info(`[home] Basvuru portalina yonlendirme: ${registerUrl}`);
  await page.goto(registerUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(500);
  return page;
}

/**
 * Kosmos ana sayfa (kosmosvize.com.tr) → popup kapat → registerform.
 * Zaten basvuru portalindaysa dokunmaz.
 */
export async function bootstrapFromKosmosHome(
  page: Page,
  context: BrowserContext,
  settings: AppSettings,
  options: { allowGotoFallback?: boolean } = {},
): Promise<Page> {
  const allowGotoFallback = options.allowGotoFallback !== false;
  const url = page.url();

  if (isBasvuruPortalUrl(url)) {
    logger.info(`[home] Zaten basvuru portalinda — bootstrap atlandi (${url}).`);
    return page;
  }

  if (!isKosmosMarketingHome(url)) {
    logger.info(`[home] Kosmos ana sayfa degil — bootstrap atlandi (${url}).`);
    return page;
  }

  logger.info("[home] Kosmos ana sayfa — overlay + basvuru portalina gecis.");

  await dismissKosmosHomeOverlays(page);

  const registerUrl = resolveRegisterFormUrl(settings.visaPortalHomeUrl);
  let activePage = await openRegisterFormViaClick(page, context, settings);

  if (!isBasvuruPortalUrl(activePage.url())) {
    if (allowGotoFallback) {
      logger.info("[home] Buton yeni sekme acmadi — dogrudan URL deneniyor.");
      activePage = await openRegisterFormViaGoto(activePage, registerUrl);
    } else {
      logger.info("[home] Goto kapali — acik basvuru sekmesi araniyor.");
    }
  }

  activePage = await waitForBasvuruPortalPage(context, activePage);
  await activePage.bringToFront();

  logger.info(
    `[home] Basvuru portalina gecildi: ${activePage.url()} (${detectPortalNavState(activePage.url())})`,
  );
  return activePage;
}
