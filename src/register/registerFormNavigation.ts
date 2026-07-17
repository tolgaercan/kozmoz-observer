import type { Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanClickLocator } from "../interaction/humanClick.js";
import { logger } from "../utils/logger.js";

export const REGISTER_SONRAKI_SELECTORS = [
  ".wizard-footer-right button.wizard-btn:has-text('Sonraki')",
  "button.wizard-btn:has-text('Sonraki')",
  ".wizard-footer-right button:has-text('Sonraki')",
];

export async function clickRegisterWizardNext(
  page: Page,
  appointmentSettings: AppointmentSettings,
  stepLabel = "register",
): Promise<void> {
  const clickOptions = {
    waitTimeoutMs: appointmentSettings.citySelectTimeoutMs,
    minStepDelayMs: appointmentSettings.minStepDelayMs,
    maxStepDelayMs: appointmentSettings.maxStepDelayMs,
    overshootProbability: appointmentSettings.overshootProbability,
  };

  for (const selector of REGISTER_SONRAKI_SELECTORS) {
    const locator = page.locator(selector).first();
    if (!(await locator.isVisible({ timeout: 2000 }).catch(() => false))) {
      continue;
    }
    logger.info(`[${stepLabel}] Sonraki — ${selector}`);
    await humanClickLocator(page, locator, { ...clickOptions, label: "Sonraki" });
    return;
  }

  throw new Error(
    `Sonraki butonu bulunamadı. Denenen: ${REGISTER_SONRAKI_SELECTORS.join(" | ")}`,
  );
}
