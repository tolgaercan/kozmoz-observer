import type { BrowserContext, Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";
import { bootstrapFromKosmosHome, dismissKosmosHomeOverlays } from "./kosmosHomeEntry.js";
import {
  ensureRandevuAl,
  ensureRandevuIslemleri,
  isAppointmentWizardReady,
  waitForAppointmentWizard,
} from "./kosmosPortalNav.js";
import {
  formatPortalEntryStep,
  portalEntryStepRank,
  resolvePortalEntrySnapshot,
  type PortalEntryStepId,
} from "./portalEntryState.js";

export interface EnsurePortalAppointmentEntryOptions {
  /** banSafe: goto yedegi kapali — yalnizca insani tiklama */
  allowGotoFallback?: boolean;
  maxRounds?: number;
}

export interface EnsurePortalAppointmentEntryResult {
  page: Page;
  navigated: boolean;
  ok: boolean;
  step?: PortalEntryStepId;
  reason?: string;
}

const DEFAULT_MAX_ROUNDS = 6;

async function advancePortalEntryStep(
  step: PortalEntryStepId,
  page: Page,
  context: BrowserContext,
  settings: AppSettings,
  allowGotoFallback: boolean,
): Promise<{ page: Page; advanced: boolean }> {
  switch (step) {
    case "done":
      return { page, advanced: false };

    case "marketingHome":
      await dismissKosmosHomeOverlays(page);
      return {
        page: await bootstrapFromKosmosHome(page, context, settings, { allowGotoFallback }),
        advanced: true,
      };

    case "registerForm":
      logger.info("[nav-entry] Adim 3 — Randevu İşlemleri (insani).");
      return {
        page,
        advanced: await ensureRandevuIslemleri(page, settings.navigation, 1, {
          homeUrl: settings.visaPortalHomeUrl,
          allowGotoFallback,
        }),
      };

    case "appointmentProcedures":
      logger.info("[nav-entry] Adim 4 — Randevu Al (insani).");
      return {
        page,
        advanced: await ensureRandevuAl(page, settings.navigation, 1, {
          homeUrl: settings.visaPortalHomeUrl,
          allowGotoFallback,
        }),
      };

    case "appointmentFormLoading":
      logger.info("[nav-entry] Randevu wizard yukleniyor — bekleniyor.");
      await waitForAppointmentWizard(page, 12_000);
      return { page, advanced: false };

    default:
      logger.warn(`[nav-entry] Bilinmeyen konum (${page.url()}) — ana sayfa bootstrap deneniyor.`);
      if (allowGotoFallback) {
        return {
          page: await bootstrapFromKosmosHome(page, context, settings, { allowGotoFallback }),
          advanced: true,
        };
      }
      return { page, advanced: false };
  }
}

/**
 * Kosmos giriş akışı — wizard gibi: nerede olduğunu tespit et, eksik adımları tamamla.
 * Popup/cerez yoksa sessizce devam. Son adımda throw yok — ok:false ile döner.
 */
export async function ensurePortalAppointmentEntry(
  page: Page,
  context: BrowserContext,
  settings: AppSettings,
  options: EnsurePortalAppointmentEntryOptions = {},
): Promise<EnsurePortalAppointmentEntryResult> {
  const allowGotoFallback = options.allowGotoFallback !== false;
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  let activePage = page;
  let navigated = false;
  let lastStep: PortalEntryStepId = "unknown";

  for (let round = 1; round <= maxRounds; round++) {
    const snap = await resolvePortalEntrySnapshot(activePage, context);
    activePage = snap.page;
    lastStep = snap.step;
    await activePage.bringToFront().catch(() => undefined);

    logger.info(
      `[nav-entry] Tur ${round}/${maxRounds} — ${formatPortalEntryStep(snap.step)} (${snap.url})`,
    );

    if (snap.step === "done" && (await isAppointmentWizardReady(activePage))) {
      return { page: activePage, navigated, ok: true, step: "done" };
    }

    try {
      const result = await advancePortalEntryStep(
        snap.step,
        activePage,
        context,
        settings,
        allowGotoFallback,
      );
      activePage = result.page;
      if (result.advanced) {
        navigated = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[nav-entry] Tur ${round} adim hatasi (${snap.step}): ${message}`);
    }

    const after = await resolvePortalEntrySnapshot(activePage, context);
    activePage = after.page;
    lastStep = after.step;

    if (after.step === "done" && (await isAppointmentWizardReady(activePage))) {
      logger.info(`[nav-entry] Il secimi wizard hazir: ${activePage.url()}`);
      return { page: activePage, navigated, ok: true, step: "done" };
    }

    if (portalEntryStepRank(after.step) <= portalEntryStepRank(snap.step) && round >= 2) {
      await activePage.waitForTimeout(600);
    }
  }

  const final = await resolvePortalEntrySnapshot(activePage, context);
  if (final.step === "done" && (await isAppointmentWizardReady(final.page))) {
    return { page: final.page, navigated, ok: true, step: "done" };
  }

  const reason =
    `Randevu wizard acilamadi — son adim: ${formatPortalEntryStep(final.step)} (${final.url})`;
  logger.warn(`[nav-entry] ${reason}`);
  return {
    page: final.page,
    navigated,
    ok: false,
    step: final.step,
    reason,
  };
}
