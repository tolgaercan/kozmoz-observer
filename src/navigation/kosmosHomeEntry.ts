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

export const VIZE_BASVURU_ADIMLARI_SELECTORS = [
  "a.btn-online-services[href*='registerform']",
  "a.button.btn-blue-gradient[href*='registerform']",
  "a.btn-blue-gradient:has-text('Vize Başvuru Adımları')",
  "a:has-text('Vize Başvuru Adımları')",
  "a[href*='basvuru.kosmosvize.com.tr/registerform']",
];

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

/** Duyuru popup — varsa kapat, yoksa sessizce devam */
export async function dismissKosmosHomePopup(page: Page): Promise<boolean> {
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
): Promise<Page> {
  const url = page.url();

  if (isBasvuruPortalUrl(url)) {
    logger.info(`[home] Zaten basvuru portalinda — bootstrap atlandi (${url}).`);
    return page;
  }

  if (!isKosmosMarketingHome(url)) {
    logger.info(`[home] Kosmos ana sayfa degil — bootstrap atlandi (${url}).`);
    return page;
  }

  logger.info("[home] Kosmos ana sayfa — popup + basvuru portalina gecis.");

  await dismissKosmosHomePopup(page);

  const registerUrl = resolveRegisterFormUrl(settings.visaPortalHomeUrl);
  let activePage = await openRegisterFormViaClick(page, context, settings);

  if (!isBasvuruPortalUrl(activePage.url())) {
    logger.info("[home] Buton yeni sekme acmadi — dogrudan URL deneniyor.");
    activePage = await openRegisterFormViaGoto(activePage, registerUrl);
  }

  activePage = await waitForBasvuruPortalPage(context, activePage);
  await activePage.bringToFront();

  logger.info(
    `[home] Basvuru portalina gecildi: ${activePage.url()} (${detectPortalNavState(activePage.url())})`,
  );
  return activePage;
}
