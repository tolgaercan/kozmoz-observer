import type { Page } from "playwright";

import { humanClickLocator } from "../interaction/humanClick.js";
import { logger } from "../utils/logger.js";

export type WizardStepId = 1 | 2 | 3 | 4 | 5;

/**
 * Randevu slot gözlemi bu ilerleme adımında başlar.
 * Portal 5 adımlı: 1 İkamet, 2 Şube, 3 Bilgiler, 4 Takvim, 5 Onay/OTP.
 */
export const WIZARD_OBSERVE_TARGET_STEP = 4 as WizardStepId;

export interface WizardStepItem {
  step: WizardStepId;
  title: string;
  /** Ekranda şu an bu adımın içeriği görünüyor (wizard-icon-container) */
  isViewStep: boolean;
  /** Bu adıma kadar ilerlenmiş (wizard-icon-circle.checked) */
  isChecked: boolean;
  /** li.active — BootstrapVue nav vurgusu */
  isNavActive: boolean;
}

export interface WizardStepState {
  isOnWizard: boolean;
  /**
   * Ekranda görünen adım — tıklanan sekme (.wizard-icon-container dolu arka plan).
   * Form alanları buna göre değişir.
   */
  viewStep: WizardStepId | null;
  viewTitle: string | null;
  /**
   * Gerçek ilerleme adımı — en yüksek .checked kutucuk.
   * Yenileme / kurtarma kararları buna göre verilir.
   */
  progressStep: WizardStepId | null;
  progressTitle: string | null;
  /** Görünüm geride kalmış (ör. ilerleme=2 ama ekranda adım 1) */
  isViewingPastStep: boolean;
  items: WizardStepItem[];
  observeTargetReached: boolean;
  detectedVia: "nav" | "content" | "merged";
  /** @deprecated progressStep kullanın */
  activeStep: WizardStepId | null;
  /** @deprecated progressTitle kullanın */
  activeTitle: string | null;
}

interface RawNavItem {
  stepNumber: number;
  title: string;
  isChecked: boolean;
  isNavActive: boolean;
  hasViewContainer: boolean;
  isTitleActive: boolean;
}

function parseWizardStepId(value: number): WizardStepId | null {
  if (value >= 1 && value <= 5) {
    return value as WizardStepId;
  }
  return null;
}

function splitNavLocators(navLocator: string): string[] {
  return navLocator
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function detectWizardStepFromNav(
  page: Page,
  navLocator = "ul.wizard-nav-pills",
): Promise<WizardStepState | null> {
  for (const selector of splitNavLocators(navLocator)) {
    const nav = page.locator(selector).first();
    if ((await nav.count()) === 0) {
      continue;
    }

    let visible = false;
    try {
      visible = await nav.isVisible();
    } catch {
      visible = false;
    }
    if (!visible) {
      continue;
    }

    const rawItems = await nav.evaluate((root) => {
      const items = [...root.querySelectorAll("li")];
      return items
        .map((li) => {
          const icon = li.querySelector(".wizard-icon");
          const stepNumber = Number.parseInt(icon?.textContent?.trim() ?? "", 10);
          const title =
            li.querySelector(".stepTitle")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
          const circle = li.querySelector(".wizard-icon-circle");
          const isChecked = circle?.classList.contains("checked") ?? false;
          const isNavActive = li.classList.contains("active");
          const hasViewContainer = li.querySelector(".wizard-icon-container") !== null;
          const stepTitleEl = li.querySelector(".stepTitle");
          const isTitleActive = stepTitleEl?.classList.contains("active") ?? false;
          return { stepNumber, title, isChecked, isNavActive, hasViewContainer, isTitleActive };
        })
        .filter((item) => !Number.isNaN(item.stepNumber));
    });

    if (rawItems.length > 0) {
      return buildWizardStateFromNav(rawItems);
    }
  }

  return null;
}

function buildWizardStateFromNav(rawItems: RawNavItem[]): WizardStepState {
  const items: WizardStepItem[] = rawItems
    .map((item) => {
      const step = parseWizardStepId(item.stepNumber);
      if (!step) {
        return null;
      }
      return {
        step,
        title: item.title,
        isViewStep: item.hasViewContainer,
        isChecked: item.isChecked,
        isNavActive: item.isNavActive,
      };
    })
    .filter((item): item is WizardStepItem => item !== null);

  const viewItem =
    rawItems.find((item) => item.isTitleActive) ??
    rawItems.find((item) => item.isNavActive) ??
    rawItems.find((item) => item.hasViewContainer);
  const checkedItems = rawItems.filter((item) => item.isChecked);
  const highestChecked =
    checkedItems.length > 0
      ? Math.max(...checkedItems.map((item) => item.stepNumber))
      : null;

  const viewStep = viewItem ? parseWizardStepId(viewItem.stepNumber) : null;
  const progressStep = highestChecked ? parseWizardStepId(highestChecked) : viewStep;

  const viewTitle = viewItem?.title ?? null;
  const progressTitle =
    rawItems.find((item) => item.stepNumber === highestChecked)?.title ??
    viewTitle;

  const isViewingPastStep =
    viewStep !== null && progressStep !== null && viewStep < progressStep;

  return {
    isOnWizard: true,
    viewStep,
    viewTitle,
    progressStep,
    progressTitle,
    isViewingPastStep,
    items,
    observeTargetReached:
      (progressStep ?? 0) >= WIZARD_OBSERVE_TARGET_STEP &&
      (viewStep ?? 0) >= WIZARD_OBSERVE_TARGET_STEP,
    detectedVia: "nav",
    activeStep: progressStep,
    activeTitle: progressTitle,
  };
}

/** Ekrandaki form içeriğine göre görünüm adımı (5 adımlı Kosmos randevu wizard) */
export async function detectViewStepFromContent(page: Page): Promise<WizardStepId | null> {
  const checks: Array<{ step: WizardStepId; selector: string }> = [
    { step: 5, selector: "text=Telefonuma Doğrulama Kodu Gönder" },
    { step: 5, selector: "text=sms kodu talep edin" },
    { step: 4, selector: "text=Randevu Tarihi Seçimi" },
    { step: 4, selector: "text=Randevu Tarihi Seçin" },
    { step: 4, selector: "text=Randevu Saatini seçiniz" },
    { step: 4, selector: ".dp__calendar" },
    { step: 4, selector: "div.dp__main" },
    { step: 3, selector: "text=Bilgilerinizi Girin" },
    { step: 3, selector: "select[name='applicationTypeId']" },
    { step: 3, selector: "input[name='nationalityNumber']" },
    { step: 2, selector: "select[name='appointmentTypeId']" },
    { step: 2, selector: "text=Şube Seçimi" },
    { step: 2, selector: "text=Başvuru Şubesi" },
    { step: 1, selector: "text=Yetki Alanları" },
    { step: 1, selector: "text=İkamet Yerini Seçin" },
    { step: 1, selector: "#cities" },
    { step: 1, selector: "select[name='cities']" },
    { step: 1, selector: "text=Seçilen İl" },
  ];

  let highest: WizardStepId | null = null;
  for (const check of checks) {
    const locator = page.locator(check.selector).first();
    try {
      if (await locator.isVisible({ timeout: 300 })) {
        if (!highest || check.step > highest) {
          highest = check.step;
        }
      }
    } catch {
      // görünür değil
    }
  }

  return highest;
}

function splitLocatorList(raw: string): string[] {
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Takvim DOM ekranda görünüyor mu — slot watcher yalnızca buna güvenmeli */
export async function isCalendarStepVisible(
  page: Page,
  calendarLocator = ".dp__calendar|div.dp__main",
): Promise<boolean> {
  for (const selector of splitLocatorList(calendarLocator)) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 300 })) {
        return true;
      }
    } catch {
      // görünür değil
    }
  }

  const textChecks = [
    "text=Randevu Tarihi Seçimi",
    "text=Randevu Tarihi Seçin",
    "text=Randevu Saatini seçiniz",
  ];
  for (const selector of textChecks) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 200 })) {
        return true;
      }
    } catch {
      // görünür değil
    }
  }

  return false;
}

/** Slot gözlemi için hem ilerleme hem takvim içeriği gerekli */
export async function isObserveTargetReady(
  page: Page,
  navLocator: string,
  calendarLocator: string,
): Promise<{ ready: boolean; state: WizardStepState | null; calendarVisible: boolean }> {
  const state = await detectWizardStep(page, navLocator);
  const calendarVisible = await isCalendarStepVisible(page, calendarLocator);
  const progress = state?.progressStep ?? 0;
  const ready =
    calendarVisible ||
    (progress >= WIZARD_OBSERVE_TARGET_STEP &&
      (state?.viewStep ?? 0) >= WIZARD_OBSERVE_TARGET_STEP);
  return { ready, state, calendarVisible };
}

export async function detectWizardStep(
  page: Page,
  navLocator = "ul.wizard-nav-pills",
): Promise<WizardStepState | null> {
  const fromNav = await detectWizardStepFromNav(page, navLocator);
  const viewFromContent = await detectViewStepFromContent(page);

  if (fromNav) {
    if (viewFromContent && fromNav.viewStep !== viewFromContent) {
      logger.info(
        `Wizard görünüm birleştirildi: nav-view=${fromNav.viewStep ?? "?"} content-view=${viewFromContent}`,
      );
      const contentTitle =
        fromNav.items.find((item) => item.step === viewFromContent)?.title ?? fromNav.viewTitle;
      return {
        ...fromNav,
        viewStep: viewFromContent,
        viewTitle: contentTitle,
        isViewingPastStep:
          viewFromContent < (fromNav.progressStep ?? viewFromContent),
        observeTargetReached:
          (fromNav.progressStep ?? 0) >= WIZARD_OBSERVE_TARGET_STEP &&
          viewFromContent >= WIZARD_OBSERVE_TARGET_STEP,
        detectedVia: "merged",
      };
    }
    return fromNav;
  }

  if (viewFromContent) {
    return {
      isOnWizard: true,
      viewStep: viewFromContent,
      viewTitle: null,
      progressStep: viewFromContent,
      progressTitle: null,
      isViewingPastStep: false,
      items: [],
      observeTargetReached: viewFromContent >= WIZARD_OBSERVE_TARGET_STEP,
      detectedVia: "content",
      activeStep: viewFromContent,
      activeTitle: null,
    };
  }

  return null;
}

export function formatWizardStepLog(state: WizardStepState): string {
  const view = state.viewStep ?? "?";
  const progress = state.progressStep ?? "?";
  const viewTitle = state.viewTitle ? ` ${state.viewTitle}` : "";
  const progressTitle = state.progressTitle ? ` ${state.progressTitle}` : "";
  const past = state.isViewingPastStep ? " | geri görünüm" : "";
  return `görünüm=${view}${viewTitle} | ilerleme=${progress}${progressTitle}${past} [${state.detectedVia}]`;
}

/** İlerleme adımının form ekranına geç — wizard sekmesine tıkla */
export async function navigateToWizardViewStep(
  page: Page,
  step: WizardStepId,
  navLocator = "ul.wizard-nav-pills",
): Promise<void> {
  for (const selector of splitNavLocators(navLocator)) {
    const stepTab = page
      .locator(selector)
      .locator("li")
      .filter({
        has: page.locator(".wizard-icon", { hasText: String(step) }),
      })
      .first();

    if ((await stepTab.count()) === 0) {
      continue;
    }

    logger.info(`Wizard sekmesine geçiliyor: adım ${step}`);
    await humanClickLocator(page, stepTab, {
      label: `Wizard adım ${step}`,
      waitTimeoutMs: 15_000,
    });
    await page.waitForTimeout(500);
    return;
  }

  throw new Error(`Wizard sekmesi bulunamadı: adım ${step}`);
}

/** Form doldurmadan önce görünümü ilerleme adımıyla hizala */
export async function ensureWizardViewMatchesProgress(
  page: Page,
  state: WizardStepState,
  navLocator: string,
): Promise<WizardStepState> {
  const targetStep = state.progressStep;
  if (!targetStep) {
    return state;
  }

  if (state.viewStep === targetStep) {
    return state;
  }

  logger.info(
    `Görünüm (${state.viewStep}) ile ilerleme (${targetStep}) uyumsuz — sekme ${targetStep} açılıyor.`,
  );
  await navigateToWizardViewStep(page, targetStep, navLocator);
  const updated = await detectWizardStep(page, navLocator);
  return updated ?? state;
}
