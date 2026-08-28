import type { Page } from "playwright";

import type { ApiWatcherSettings } from "../../config/settings.js";
import { humanSelectOptionByLabel } from "../../interaction/humanSelect.js";
import { logger } from "../../utils/logger.js";
import { findAppointmentStyleByTypeId } from "./portalApiCatalog.js";
import type { ApiQueryParams } from "./resolveApiQueryParams.js";

export interface SyncPortalAppointmentTypeResult {
  synced: boolean;
  skipped: boolean;
  previousValue: string | null;
  targetValue: string;
  targetLabel?: string;
  reason?: string;
}

async function readSelectedTypeId(page: Page, selector: string): Promise<string | null> {
  return page.evaluate((sel) => {
    const element = document.querySelector<HTMLSelectElement>(sel);
    return element?.value?.trim() || null;
  }, selector);
}

async function isSelectDisabled(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const element = document.querySelector<HTMLSelectElement>(sel);
    return !element || element.disabled;
  }, selector);
}

/** Disabled native select — Playwright force veya DOM value set (watch poll, TC doldurmadan). */
async function forceSetSelectValue(
  page: Page,
  selector: string,
  targetValue: string,
): Promise<boolean> {
  const locator = page.locator(selector).first();

  try {
    await locator.selectOption({ value: targetValue }, { force: true, timeout: 5000 });
    await locator.dispatchEvent("change");
    await page.waitForTimeout(200);
    if ((await readSelectedTypeId(page, selector)) === targetValue) {
      return true;
    }
  } catch {
    // evaluate yedek
  }

  return page.evaluate(
    ({ sel, value }) => {
      const element = document.querySelector<HTMLSelectElement>(sel);
      if (!element) {
        return false;
      }
      element.disabled = false;
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return element.value === value;
    },
    { sel: selector, value: targetValue },
  );
}

function buildHumanSelectOptions(
  settings: ApiWatcherSettings,
  selector: string,
): Parameters<typeof humanSelectOptionByLabel>[3] {
  return {
    locatorTimeoutMs: settings.syncPortalAppointmentTypeTimeoutMs,
    scrollAnchorSelectors: [selector],
    minStepDelayMs: settings.syncHumanMinStepDelayMs,
    maxStepDelayMs: settings.syncHumanMaxStepDelayMs,
    overshootProbability: settings.syncHumanOvershootProbability,
    pauseAfterSelectMs: settings.syncPortalAppointmentTypeWaitMs,
  };
}

/**
 * Panel typeId ile portal select[name=appointmentTypeId] eşleşmesi (insani select).
 * Wizard ilerlemesi ensureWizardForApiPoll ile yapılmalı — bu yalnızca değer senkronu.
 */
export async function syncPortalAppointmentType(
  page: Page,
  queryParams: ApiQueryParams,
  settings: ApiWatcherSettings,
): Promise<SyncPortalAppointmentTypeResult> {
  const targetValue = queryParams.appointmentTypeId.trim();
  const targetLabel =
    queryParams.appointmentStyleLabel?.trim() ??
    findAppointmentStyleByTypeId(targetValue);
  const selector = settings.appointmentTypeSelectLocator;

  if (!targetLabel) {
    return {
      synced: false,
      skipped: true,
      previousValue: null,
      targetValue,
      reason: `typeId=${targetValue} icin basvuru sekli etiketi bilinmiyor`,
    };
  }

  const previousValue = await readSelectedTypeId(page, selector);
  if (previousValue === targetValue) {
    logger.debug(
      `[api] Portal basvuru sekli zaten typeId=${targetValue} (${targetLabel})`,
    );
    return {
      synced: false,
      skipped: true,
      previousValue,
      targetValue,
      targetLabel,
      reason: "zaten eslesiyor",
    };
  }

  const selectLocator = page.locator(selector).first();
  try {
    await selectLocator.waitFor({
      state: "visible",
      timeout: settings.syncPortalAppointmentTypeTimeoutMs,
    });
  } catch {
    return {
      synced: false,
      skipped: true,
      previousValue,
      targetValue,
      targetLabel,
      reason: "Basvuru sekli select gorunur degil — wizard-prep gerekli",
    };
  }

  const disabled = await isSelectDisabled(page, selector);

  if (disabled) {
    logger.info(
      `[api] Basvuru sekli select disabled — force value=${targetValue} (${targetLabel})`,
    );
    const forced = await forceSetSelectValue(page, selector, targetValue);
    const afterForced = await readSelectedTypeId(page, selector);
    if (forced && afterForced === targetValue) {
      logger.info(
        `[api] Portal basvuru sekli force senkron: ${previousValue ?? "—"} → ${targetLabel} (typeId=${targetValue})`,
      );
      return {
        synced: true,
        skipped: false,
        previousValue,
        targetValue,
        targetLabel,
      };
    }
    logger.warn(
      `[api] Force senkron basarisiz (secili: ${afterForced ?? "—"}) — insani secim denenecek.`,
    );
  }

  try {
    logger.info(`[api] Basvuru sekli insani seciliyor: ${targetLabel} (typeId=${targetValue})`);
    await humanSelectOptionByLabel(
      page,
      selectLocator,
      targetLabel,
      buildHumanSelectOptions(settings, selector),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[api] Basvuru sekli insani secim basarisiz — force/value yedek: ${message}`);
    const forced = await forceSetSelectValue(page, selector, targetValue);
    if (!forced) {
      return {
        synced: false,
        skipped: false,
        previousValue,
        targetValue,
        targetLabel,
        reason: `insani secim basarisiz: ${message}; force value basarisiz`,
      };
    }
    await page.waitForTimeout(settings.syncPortalAppointmentTypeWaitMs);
  }

  let afterValue = await readSelectedTypeId(page, selector);
  if (afterValue !== targetValue) {
    logger.warn(
      `[api] Basvuru sekli dogrulanamadi (secili: ${afterValue ?? "—"}) — force value yedek deneniyor.`,
    );
    await forceSetSelectValue(page, selector, targetValue);
    await page.waitForTimeout(settings.syncPortalAppointmentTypeWaitMs);
    afterValue = await readSelectedTypeId(page, selector);
  }
  if (afterValue !== targetValue) {
    return {
      synced: false,
      skipped: false,
      previousValue,
      targetValue,
      targetLabel,
      reason: `dogrulanamadi (secili: ${afterValue ?? "—"})`,
    };
  }

  const prevLabel = previousValue
    ? findAppointmentStyleByTypeId(previousValue) ?? previousValue
    : "—";
  logger.info(
    `[api] Portal basvuru sekli senkron: ${prevLabel} → ${targetLabel} (typeId=${targetValue})`,
  );

  return {
    synced: true,
    skipped: false,
    previousValue,
    targetValue,
    targetLabel,
  };
}
