import type { Page } from "playwright";

import { logger } from "../utils/logger.js";

export type RegisterWizardStepId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const REGISTER_WIZARD_NAV_LOCATOR = "ul.wizard-nav.wizard-nav-pills|ul.wizard-nav-pills";

export const REGISTER_STEP_TITLES: Record<RegisterWizardStepId, string> = {
  1: "Kimlik Doğrulama",
  2: "Kişisel Bilgiler",
  3: "İletişim / İkamet",
  4: "Meslek Bilgileri",
  5: "Seyahat Bilgileri",
  6: "Kalacak Yer Bilgileri",
  7: "Masraflar",
  8: "KVKK Onaylar",
  9: "Email Doğrulama",
};

export interface RegisterWizardStepItem {
  step: RegisterWizardStepId;
  title: string;
  isViewStep: boolean;
  isChecked: boolean;
  isNavActive: boolean;
}

export interface RegisterWizardStepState {
  isOnRegisterWizard: boolean;
  viewStep: RegisterWizardStepId | null;
  viewTitle: string | null;
  progressStep: RegisterWizardStepId | null;
  progressTitle: string | null;
  isViewingPastStep: boolean;
  items: RegisterWizardStepItem[];
  detectedVia: "nav" | "content" | "merged";
}

interface RawNavItem {
  stepNumber: number;
  title: string;
  isChecked: boolean;
  isNavActive: boolean;
  hasViewContainer: boolean;
  isTitleActive: boolean;
}

function parseRegisterStepId(value: number): RegisterWizardStepId | null {
  if (value >= 1 && value <= 9) {
    return value as RegisterWizardStepId;
  }
  return null;
}

function splitNavLocators(navLocator: string): string[] {
  return navLocator
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isRegisterFormUrl(url: string): boolean {
  return /\/registerForm\b/i.test(url);
}

export async function isRegisterFormPage(page: Page): Promise<boolean> {
  if (!isRegisterFormUrl(page.url())) {
    return false;
  }
  const kimlikTitle = page.locator(".stepTitle:has-text('Kimlik Doğrulama')").first();
  return (await kimlikTitle.count()) > 0;
}

function buildRegisterWizardState(rawItems: RawNavItem[]): RegisterWizardStepState {
  const items: RegisterWizardStepItem[] = rawItems
    .map((item) => {
      const step = parseRegisterStepId(item.stepNumber);
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
    .filter((item): item is RegisterWizardStepItem => item !== null);

  const viewItem =
    rawItems.find((item) => item.hasViewContainer) ??
    rawItems.find((item) => item.isTitleActive) ??
    rawItems.find((item) => item.isNavActive);

  const checkedItems = rawItems.filter((item) => item.isChecked);
  const highestChecked =
    checkedItems.length > 0
      ? Math.max(...checkedItems.map((item) => item.stepNumber))
      : null;

  const viewStep = viewItem ? parseRegisterStepId(viewItem.stepNumber) : null;
  const progressStep = highestChecked
    ? parseRegisterStepId(highestChecked)
    : viewStep;

  const viewTitle = viewItem?.title ?? null;
  const progressTitle =
    rawItems.find((item) => item.stepNumber === highestChecked)?.title ?? viewTitle;

  const isViewingPastStep =
    viewStep !== null && progressStep !== null && viewStep < progressStep;

  return {
    isOnRegisterWizard: items.length > 0,
    viewStep,
    viewTitle,
    progressStep,
    progressTitle,
    isViewingPastStep,
    items,
    detectedVia: "nav",
  };
}

async function detectRegisterWizardFromNav(
  page: Page,
  navLocator = REGISTER_WIZARD_NAV_LOCATOR,
): Promise<RegisterWizardStepState | null> {
  for (const selector of splitNavLocators(navLocator)) {
    const nav = page.locator(selector).first();
    if ((await nav.count()) === 0) {
      continue;
    }
    const visible = await nav.isVisible({ timeout: 1500 }).catch(() => false);
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

    if (rawItems.length >= 5) {
      return buildRegisterWizardState(rawItems);
    }
  }

  return null;
}

async function detectRegisterViewFromContent(
  page: Page,
): Promise<RegisterWizardStepId | null> {
  const checks: Array<{ step: RegisterWizardStepId; selector: string }> = [
    { step: 9, selector: "text=Email Doğrulama" },
    { step: 8, selector: "text=KVKK Onaylar" },
    { step: 7, selector: "text=Masraflar" },
    { step: 6, selector: "text=Kalacak Yer Bilgileri" },
    { step: 5, selector: "text=Seyahat Bilgileri" },
    { step: 4, selector: "text=Meslek Bilgileri" },
    { step: 3, selector: "text=İletişim / İkamet" },
    { step: 2, selector: "text=Kişisel Bilgiler" },
    { step: 1, selector: "input[name='nameOriginal']" },
    { step: 1, selector: "h2:has-text('Kimlik Doğrulama')" },
  ];

  for (const check of checks) {
    const visible = await page
      .locator(check.selector)
      .first()
      .isVisible({ timeout: 400 })
      .catch(() => false);
    if (visible) {
      return check.step;
    }
  }

  return null;
}

export async function detectRegisterWizardStep(
  page: Page,
): Promise<RegisterWizardStepState | null> {
  if (!isRegisterFormUrl(page.url())) {
    return null;
  }

  const fromNav = await detectRegisterWizardFromNav(page);
  const viewFromContent = await detectRegisterViewFromContent(page);

  if (fromNav) {
    if (viewFromContent && fromNav.viewStep !== viewFromContent) {
      logger.info(
        `[register] Wizard görünüm birleştirildi: nav-view=${fromNav.viewStep ?? "?"} content-view=${viewFromContent}`,
      );
      const contentTitle = REGISTER_STEP_TITLES[viewFromContent];
      return {
        ...fromNav,
        viewStep: viewFromContent,
        viewTitle: contentTitle,
        isViewingPastStep:
          fromNav.progressStep !== null && viewFromContent < fromNav.progressStep,
        detectedVia: "merged",
      };
    }
    return fromNav;
  }

  if (viewFromContent) {
    return {
      isOnRegisterWizard: true,
      viewStep: viewFromContent,
      viewTitle: REGISTER_STEP_TITLES[viewFromContent],
      progressStep: viewFromContent,
      progressTitle: REGISTER_STEP_TITLES[viewFromContent],
      isViewingPastStep: false,
      items: [],
      detectedVia: "content",
    };
  }

  return null;
}

export function formatRegisterWizardLog(state: RegisterWizardStepState): string {
  const view = state.viewStep ?? "?";
  const progress = state.progressStep ?? "?";
  const viewTitle = state.viewTitle ? ` ${state.viewTitle}` : "";
  const progressTitle = state.progressTitle ? ` ${state.progressTitle}` : "";
  const past = state.isViewingPastStep ? " | geri atıldı — yeniden doldur" : "";
  return `görünüm=${view}${viewTitle} | ilerleme=${progress}${progressTitle}${past} [${state.detectedVia}]`;
}

export async function navigateToRegisterWizardViewStep(
  page: Page,
  step: RegisterWizardStepId,
): Promise<void> {
  for (const selector of splitNavLocators(REGISTER_WIZARD_NAV_LOCATOR)) {
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

    const clickable = stepTab.locator("a, .wizard-icon-circle").first();
    logger.info(`[register] Wizard sekmesine geçiliyor: adım ${step}`);
    await clickable.click({ timeout: 10_000 });
    await page.waitForTimeout(600);
    return;
  }
}
