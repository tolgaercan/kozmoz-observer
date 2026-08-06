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
    return {
      synced: false,
      skipped: false,
      previousValue,
      targetValue,
      targetLabel,
      reason: `insani secim basarisiz: ${message}`,
    };
  }

  const afterValue = await readSelectedTypeId(page, selector);
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
