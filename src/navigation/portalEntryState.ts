import type { BrowserContext, Page } from "playwright";

import { isBasvuruPortalUrl, isKosmosMarketingHome } from "../portal/kosmosOrigin.js";
import {
  detectPortalNavState,
  isAppointmentWizardReady,
  type PortalNavState,
} from "./kosmosPortalNav.js";

/** Portal giriş akışı — wizard gibi adım sırası (düşük → yüksek). */
export type PortalEntryStepId =
  | "unknown"
  | "marketingHome"
  | "registerForm"
  | "appointmentProcedures"
  | "appointmentFormLoading"
  | "done";

export interface PortalEntrySnapshot {
  step: PortalEntryStepId;
  page: Page;
  url: string;
  navState: PortalNavState;
}

const STEP_RANK: Record<PortalEntryStepId, number> = {
  unknown: 0,
  marketingHome: 10,
  registerForm: 30,
  appointmentProcedures: 50,
  appointmentFormLoading: 70,
  done: 100,
};

export function portalEntryStepRank(step: PortalEntryStepId): number {
  return STEP_RANK[step] ?? 0;
}

export function formatPortalEntryStep(step: PortalEntryStepId): string {
  switch (step) {
    case "marketingHome":
      return "1/4 ana sayfa";
    case "registerForm":
      return "2/4 basvuru portal (registerform)";
    case "appointmentProcedures":
      return "3/4 Randevu İşlemleri";
    case "appointmentFormLoading":
      return "4/4 Randevu Al (yukleniyor)";
    case "done":
      return "tamam — il secimi wizard";
    default:
      return "bilinmeyen";
  }
}

async function snapshotPageEntryStep(page: Page): Promise<PortalEntrySnapshot> {
  const url = page.url().trim();
  const navState = detectPortalNavState(url);

  if (await isAppointmentWizardReady(page)) {
    return { step: "done", page, url, navState: "appointmentForm" };
  }

  if (navState === "appointmentForm" || /\/appointmentForm\b/i.test(url)) {
    return { step: "appointmentFormLoading", page, url, navState };
  }

  if (navState === "appointmentProcedures") {
    return { step: "appointmentProcedures", page, url, navState };
  }

  if (navState === "registerForm" || (isBasvuruPortalUrl(url) && navState === "unknown")) {
    return { step: "registerForm", page, url, navState };
  }

  if (isKosmosMarketingHome(url)) {
    return { step: "marketingHome", page, url, navState };
  }

  return { step: "unknown", page, url, navState };
}

/** Tüm sekmeleri tarar — en ileri adımı döner (wizard mantığı). */
export async function resolvePortalEntrySnapshot(
  page: Page,
  context: BrowserContext,
): Promise<PortalEntrySnapshot> {
  const candidates = context.pages().filter((candidate) => !candidate.isClosed());
  if (!candidates.includes(page)) {
    candidates.unshift(page);
  }

  let best: PortalEntrySnapshot | null = null;

  for (const candidate of candidates) {
    let snap: PortalEntrySnapshot;
    try {
      snap = await snapshotPageEntryStep(candidate);
    } catch {
      continue;
    }
    if (!best || portalEntryStepRank(snap.step) > portalEntryStepRank(best.step)) {
      best = snap;
    }
  }

  return best ?? (await snapshotPageEntryStep(page));
}
