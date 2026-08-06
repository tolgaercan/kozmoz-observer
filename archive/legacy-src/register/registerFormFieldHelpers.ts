import type { Locator, Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanClickLocator } from "../interaction/humanClick.js";
import { humanTypeIntoLocator } from "../interaction/humanType.js";
import { logger } from "../utils/logger.js";
import { birthDateToHtmlInputValue } from "./registerIdentityData.js";
import {
  activeRegisterWizardPane,
  resolveVisibleRegisterSelect,
} from "./registerFormWizardPane.js";

function randomIn(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export async function fillTextFieldIfNeeded(
  page: Page,
  locator: Locator,
  value: string,
  label: string,
  options: { groupPauseEveryChars?: number } = {},
): Promise<boolean> {
  const current = (await locator.inputValue().catch(() => "")).trim();
  if (current === value.trim()) {
    logger.info(`[register] ${label} zaten dolu — atlanıyor.`);
    return false;
  }

  await humanTypeIntoLocator(page, locator, value, {
    label,
    minCharDelayMs: 45,
    maxCharDelayMs: 130,
    groupPauseEveryChars: options.groupPauseEveryChars,
    groupPauseMinMs: 180,
    groupPauseMaxMs: 420,
  });
  return true;
}

export async function fillDateFieldIfNeeded(
  page: Page,
  locator: Locator,
  dateValue: string,
  label: string,
): Promise<boolean> {
  const htmlValue = birthDateToHtmlInputValue(dateValue);
  const current = (await locator.inputValue().catch(() => "")).trim();
  if (current === htmlValue) {
    logger.info(`[register] ${label} zaten dolu — atlanıyor.`);
    return false;
  }

  await humanClickLocator(page, locator, { label, waitTimeoutMs: 10_000 });
  await locator.fill(htmlValue);
  logger.info(`[register] ${label} (date): ${htmlValue}`);
  await page.waitForTimeout(randomIn(150, 350));
  return true;
}

export type SelectResolution = { by: "value" | "label"; value: string };

/** Env: "685" veya "value:685" | "Türkiye" veya "label:Türkiye" */
export function parseSelectEnvValue(raw: string): SelectResolution {
  const trimmed = raw.trim();
  const valueMatch = /^value:(.+)$/i.exec(trimmed);
  if (valueMatch) {
    return { by: "value", value: valueMatch[1]!.trim() };
  }
  const labelMatch = /^label:(.+)$/i.exec(trimmed);
  if (labelMatch) {
    return { by: "label", value: labelMatch[1]!.trim() };
  }
  if (/^\d+$/.test(trimmed)) {
    return { by: "value", value: trimmed };
  }
  return { by: "label", value: trimmed };
}

async function readSelectValue(locator: Locator): Promise<string> {
  return (await locator.inputValue().catch(() => "")).trim();
}

async function waitForSelectOptionsLoaded(
  locator: Locator,
  minOptions = 2,
  timeoutMs = 45_000,
): Promise<number> {
  const page = locator.page();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await locator.evaluate(
      (select) => (select as HTMLSelectElement).options.length,
    );
    if (count >= minOptions) {
      return count;
    }
    await page.waitForTimeout(400);
  }
  const count = await locator.evaluate(
    (select) => (select as HTMLSelectElement).options.length,
  );
  throw new Error(
    `[register] Select seçenekleri yüklenmedi (beklenen≥${minOptions}, bulunan=${count}).`,
  );
}

async function resolveSelectTargetValue(
  locator: Locator,
  selection: SelectResolution,
  fieldLabel: string,
  selectName: string,
): Promise<string> {
  if (selection.by === "label") {
    const optionValue = await locator.evaluate((select, label) => {
      const options = Array.from((select as HTMLSelectElement).options);
      const normalized = label.trim().toLocaleLowerCase("tr-TR");
      const match = options.find(
        (opt) => opt.textContent?.trim().toLocaleLowerCase("tr-TR") === normalized,
      );
      return match?.value ?? "";
    }, selection.value);
    if (!optionValue) {
      throw new Error(
        `[register] ${fieldLabel}: "${selection.value}" seçeneği bulunamadı (select name=${selectName}).`,
      );
    }
    return optionValue;
  }

  const hasValue = await locator.evaluate((select, value) => {
    const options = Array.from((select as HTMLSelectElement).options);
    return options.some((opt) => opt.value === value);
  }, selection.value);

  if (hasValue) {
    return selection.value;
  }

  const turkeyFallback = await locator.evaluate((select) => {
    const options = Array.from((select as HTMLSelectElement).options);
    const match = options.find((opt) =>
      /türkiye|turkey/i.test(opt.textContent?.trim() ?? ""),
    );
    return match?.value ?? "";
  });

  if (turkeyFallback && selection.value === "685") {
    logger.warn(
      `[register] ${fieldLabel}: value=685 bulunamadı — Türkiye etiketi ile value=${turkeyFallback} deneniyor.`,
    );
    return turkeyFallback;
  }

  throw new Error(
    `[register] ${fieldLabel}: value="${selection.value}" seçeneği bulunamadı (select name=${selectName}).`,
  );
}

async function applySelectValue(locator: Locator, targetValue: string): Promise<void> {
  try {
    await locator.selectOption({ value: targetValue });
  } catch {
    await locator.evaluate((select, value) => {
      const el = select as HTMLSelectElement;
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, targetValue);
  }
  await locator.dispatchEvent("change");
}

export async function selectRegisterFieldIfNeeded(
  page: Page,
  selectName: string,
  selection: SelectResolution,
  fieldLabel: string,
  appointmentSettings: AppointmentSettings,
): Promise<boolean> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await selectRegisterFieldOnce(
        page,
        selectName,
        selection,
        fieldLabel,
        appointmentSettings,
      );
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts) {
        break;
      }
      logger.warn(
        `[register] ${fieldLabel} — alan denemesi ${attempt}/${maxAttempts} başarısız: ${message}`,
      );
      await page.waitForTimeout(500 * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`[register] ${fieldLabel} seçilemedi.`);
}

async function selectRegisterFieldOnce(
  page: Page,
  selectName: string,
  selection: SelectResolution,
  fieldLabel: string,
  appointmentSettings: AppointmentSettings,
): Promise<boolean> {
  const pane = activeRegisterWizardPane(page);
  await pane.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);

  const locator = await resolveVisibleRegisterSelect(page, selectName);
  await locator.waitFor({ state: "visible", timeout: 15_000 });
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(randomIn(300, 600));
  await waitForSelectOptionsLoaded(locator);

  const targetValue = await resolveSelectTargetValue(
    locator,
    selection,
    fieldLabel,
    selectName,
  );

  const current = await readSelectValue(locator);
  if (current === targetValue) {
    logger.info(`[register] ${fieldLabel} zaten seçili (value=${targetValue}).`);
    return false;
  }

  await locator.scrollIntoViewIfNeeded();
  try {
    await humanClickLocator(page, locator, {
      label: fieldLabel,
      waitTimeoutMs: appointmentSettings.citySelectTimeoutMs,
      minStepDelayMs: appointmentSettings.minStepDelayMs,
      maxStepDelayMs: appointmentSettings.maxStepDelayMs,
      overshootProbability: appointmentSettings.overshootProbability,
    });
    await page.waitForTimeout(randomIn(180, 400));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `[register] ${fieldLabel} — insan tıklama atlandı (${message}), doğrudan seçim deneniyor.`,
    );
  }

  await applySelectValue(locator, targetValue);
  await page.waitForTimeout(randomIn(200, 450));

  logger.info(`[register] ${fieldLabel} seçildi — value=${targetValue}`);
  return true;
}

export async function selectRegisterRadioIfNeeded(
  page: Page,
  radioName: string,
  targetValue: string,
  fieldLabel: string,
  appointmentSettings: AppointmentSettings,
): Promise<boolean> {
  const locator = page.locator(`input[type='radio'][name='${radioName}'][value='${targetValue}']`).first();
  await locator.waitFor({ state: "attached", timeout: 15_000 });

  if (await locator.isChecked().catch(() => false)) {
    logger.info(`[register] ${fieldLabel} zaten seçili (${targetValue}).`);
    return false;
  }

  await humanClickLocator(page, locator, {
    label: fieldLabel,
    waitTimeoutMs: appointmentSettings.citySelectTimeoutMs,
    minStepDelayMs: appointmentSettings.minStepDelayMs,
    maxStepDelayMs: appointmentSettings.maxStepDelayMs,
    overshootProbability: appointmentSettings.overshootProbability,
  });
  await page.waitForTimeout(randomIn(150, 350));
  logger.info(`[register] ${fieldLabel} seçildi — ${targetValue}`);
  return true;
}

export async function checkRegisterCheckboxIfNeeded(
  page: Page,
  checkboxValue: string,
  fieldLabel: string,
  appointmentSettings: AppointmentSettings,
): Promise<boolean> {
  const locator = page.locator(`input[type='checkbox'][value='${checkboxValue}']`).first();
  await locator.waitFor({ state: "attached", timeout: 10_000 });

  if (await locator.isChecked().catch(() => false)) {
    logger.info(`[register] ${fieldLabel} zaten işaretli.`);
    return false;
  }

  await humanClickLocator(page, locator, {
    label: fieldLabel,
    waitTimeoutMs: appointmentSettings.citySelectTimeoutMs,
    minStepDelayMs: appointmentSettings.minStepDelayMs,
    maxStepDelayMs: appointmentSettings.maxStepDelayMs,
    overshootProbability: appointmentSettings.overshootProbability,
  });
  await locator.dispatchEvent("change");
  await page.waitForTimeout(randomIn(120, 280));
  logger.info(`[register] ${fieldLabel} işaretlendi.`);
  return true;
}
