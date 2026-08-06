import type { Page } from "playwright";

import type { NavigationSettings } from "../config/settings.js";
import { humanClickLocator } from "../interaction/humanClick.js";
import { logger } from "../utils/logger.js";
import { detectRegisterWizardStep, isRegisterFormPage } from "./registerFormWizardDetector.js";

export const BASVURU_FORMU_SELECTORS = [
  "li.nav-link a[href='/registerForm']",
  "a[href='/registerForm']",
  "li.nav-link span.nav-item-title:has-text('Başvuru Formu')",
  "span.nav-item-title:has-text('Başvuru Formu')",
  "nav a:has-text('Başvuru Formu')",
];

export function resolveRegisterFormUrl(homeUrl: string): string {
  const explicit = process.env.PORTAL_REGISTER_FORM_URL?.trim();
  if (explicit) {
    return explicit;
  }
  return new URL("/registerForm", homeUrl).toString();
}

async function gotoRegisterForm(page: Page, homeUrl: string): Promise<void> {
  const target = resolveRegisterFormUrl(homeUrl);
  logger.info(`[register] Doğrudan kayıt URL'sine gidiliyor: ${target}`);
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
}

async function clickBasvuruFormuNav(
  page: Page,
  settings: NavigationSettings,
): Promise<boolean> {
  for (const selector of BASVURU_FORMU_SELECTORS) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible({ timeout: 2000 }).catch(() => false);
    if (!visible) {
      continue;
    }

    logger.info(`[register] Başvuru Formu menüsü — ${selector}`);
    try {
      await humanClickLocator(page, locator, {
        label: "Başvuru Formu",
        waitTimeoutMs: Math.min(settings.locatorTimeoutMs, 15_000),
        minStepDelayMs: settings.minStepDelayMs,
        maxStepDelayMs: settings.maxStepDelayMs,
        overshootProbability: settings.overshootProbability,
      });
      return true;
    } catch {
      await locator.click({ timeout: 8000 }).catch(() => undefined);
      return true;
    }
  }
  return false;
}

export async function ensureRegisterFormOpen(
  page: Page,
  homeUrl: string,
  settings: NavigationSettings,
): Promise<void> {
  if (await isRegisterFormPage(page)) {
    const state = await detectRegisterWizardStep(page);
    if (state?.isOnRegisterWizard) {
      logger.info("[register] Kayıt formu zaten açık.");
      return;
    }
  }

  const beforeUrl = page.url();
  await gotoRegisterForm(page, homeUrl);

  if (await isRegisterFormPage(page)) {
    return;
  }

  if (page.url() === beforeUrl || !(await isRegisterFormPage(page))) {
    logger.info("[register] URL sonrası wizard yok — menüden Başvuru Formu deneniyor.");
    await clickBasvuruFormuNav(page, settings);
  }

  if (!(await isRegisterFormPage(page))) {
    await page.waitForTimeout(1500);
  }

  const ready = await isRegisterFormPage(page);
  if (!ready) {
    throw new Error(
      "Başvuru Formu açılamadı — /registerForm yüklenmedi veya wizard görünmüyor.",
    );
  }

  logger.info(`[register] Kayıt formu hazır — URL: ${page.url()}`);
}
