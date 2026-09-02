import type { Page } from "playwright";

import type { AppointmentSettings } from "../../config/settings.js";
import type { ResolvedProfile } from "../../profiles/profileManager.js";
import {
  resolveApplicationType,
  selectApplicationType,
} from "../../portal/applicationTypeSelector.js";
import { selectAppointmentStyle } from "../../portal/appointmentStyleSelector.js";
import {
  fillNationalityNumber,
  readNationalityNumberFromPage,
  resolveNationalityNumber,
} from "../../portal/nationalityNumberInput.js";
import { logger } from "../../utils/logger.js";
import type { ApiQueryParams } from "../client/resolveApiQueryParams.js";

export interface Step2FillResult {
  ok: boolean;
  reason?: string;
  skipped?: boolean;
}

export interface FillApplicantInfoStepOptions {
  /** Alanlar doğruysa doldurmayı atla — TC blur/API tetiklenmez */
  skipIfReady?: boolean;
  /** Captcha retry gibi durumlarda hazır kontrolünü yok say */
  force?: boolean;
}

interface Step2FieldState {
  applicationType: string;
  nationalityNumber: string;
  appointmentTypeId: string;
  styleSelectEnabled: boolean;
}

const DEALER_BRANCH_LOCATOR =
  "select[name='selectedDealerId']|select.form-select[name='selectedDealerId']";

function parseLocatorList(raw: string): string[] {
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function firstVisibleLocator(
  page: Page,
  selectors: string[],
): Promise<{ selector: string; locator: ReturnType<Page["locator"]> } | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 400 })) {
        return { selector, locator };
      }
    } catch {
      // görünür değil
    }
  }
  return null;
}

async function waitForInputEnabled(
  page: Page,
  selectors: string[],
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const found = await firstVisibleLocator(page, selectors);
    if (found) {
      try {
        if (!(await found.locator.isDisabled())) {
          return;
        }
      } catch {
        // devam
      }
    }
    await page.waitForTimeout(250);
  }

  throw new Error(`${label} alanı aktif olmadı (${timeoutMs}ms).`);
}

async function waitForSelectEnabled(
  page: Page,
  selectors: string[],
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const found = await firstVisibleLocator(page, selectors);
    if (found) {
      try {
        if (!(await found.locator.isDisabled())) {
          return;
        }
      } catch {
        // devam
      }
    }
    await page.waitForTimeout(300);
  }

  throw new Error(`${label} alanı aktif olmadı — TC doğrulama API yanıtı bekleniyor (${timeoutMs}ms).`);
}

async function readSelectValue(page: Page, selectors: string[]): Promise<string> {
  for (const selector of selectors) {
    try {
      const value = (await page.locator(selector).first().inputValue({ timeout: 400 })).trim();
      if (value) {
        return value;
      }
    } catch {
      // sonraki selector
    }
  }
  return "";
}

async function isSelectEnabled(page: Page, selectors: string[]): Promise<boolean> {
  const found = await firstVisibleLocator(page, selectors);
  if (!found) {
    return false;
  }
  try {
    return !(await found.locator.isDisabled());
  } catch {
    return false;
  }
}

async function readStep2FieldState(
  page: Page,
  settings: AppointmentSettings,
): Promise<Step2FieldState | null> {
  const applicationSelectors = parseLocatorList(settings.applicationTypeLocator);
  const styleSelectors = parseLocatorList(settings.appointmentStyleLocator);

  const step2Visible = await firstVisibleLocator(page, applicationSelectors);
  if (!step2Visible) {
    return null;
  }

  const applicationType = await readSelectValue(page, applicationSelectors);
  const nationalityNumber = await readNationalityNumberFromPage(page, settings);
  const appointmentTypeId = await readSelectValue(page, styleSelectors);
  const styleSelectEnabled = await isSelectEnabled(page, styleSelectors);

  return {
    applicationType,
    nationalityNumber,
    appointmentTypeId,
    styleSelectEnabled,
  };
}

function resolveExpectedStep2Values(
  profile: ResolvedProfile,
  settings: AppointmentSettings,
  queryParams: ApiQueryParams,
): { applicationType: string; nationalityNumber: string; appointmentTypeId: string } | null {
  const applicationType = resolveApplicationType(profile, settings.defaultApplicationType);
  const nationalityNumber = resolveNationalityNumber(profile, settings.defaultNationalityNumber);
  const appointmentTypeId = queryParams.appointmentTypeId.trim();

  if (!applicationType || !nationalityNumber || !appointmentTypeId) {
    return null;
  }

  return { applicationType, nationalityNumber, appointmentTypeId };
}

function isStep2Ready(
  state: Step2FieldState,
  expected: { applicationType: string; nationalityNumber: string; appointmentTypeId: string },
): boolean {
  return (
    state.applicationType === expected.applicationType &&
    state.nationalityNumber === expected.nationalityNumber &&
    state.appointmentTypeId === expected.appointmentTypeId &&
    state.styleSelectEnabled
  );
}

async function logPreselectedDealerBranch(page: Page): Promise<void> {
  const found = await firstVisibleLocator(page, parseLocatorList(DEALER_BRANCH_LOCATOR));
  if (!found) {
    logger.debug("[booking] Step 2 — başvuru şubesi select görünür değil (atlandı).");
    return;
  }

  const value = (await found.locator.inputValue().catch(() => "")).trim();
  const label = (
    await found.locator.locator("option:checked").innerText().catch(() => "")
  )
    .replace(/\s+/g, " ")
    .trim();

  const disabled = await found.locator.isDisabled().catch(() => false);
  logger.info(
    `[booking] Step 2 — başvuru şubesi ${disabled ? "önceden seçili" : "seçili"}: ${label || value || "—"}`,
  );
}

/**
 * Step 2 (Bilgiler) — sıra:
 * 1. Başvuru tipi (TC'yi açar)
 * 2. Şube zaten seçili — doğrula/atla
 * 3. TC Kimlik
 * 4. Boş alan tık → arka plan API
 * 5. Başvuru şekli (API sonrası aktif)
 */
export async function fillApplicantInfoStep(
  page: Page,
  profile: ResolvedProfile,
  settings: AppointmentSettings,
  queryParams: ApiQueryParams,
  options?: FillApplicantInfoStepOptions,
): Promise<Step2FillResult> {
  const applicationSelectors = parseLocatorList(settings.applicationTypeLocator);
  const nationalitySelectors = parseLocatorList(settings.nationalityNumberLocator);
  const styleSelectors = parseLocatorList(settings.appointmentStyleLocator);
  const skipIfReady = options?.skipIfReady !== false;
  const force = options?.force === true;

  const step2Visible = await firstVisibleLocator(page, applicationSelectors);
  if (!step2Visible) {
    return {
      ok: false,
      reason: "Step 2 formu görünür değil — select[name='applicationTypeId'] bekleniyor",
    };
  }

  const expected = resolveExpectedStep2Values(profile, settings, queryParams);
  if (!expected) {
    return { ok: false, reason: "Step 2 hedef değerleri çözülemedi (tip/TC/typeId)" };
  }

  const currentState = await readStep2FieldState(page, settings);
  if (skipIfReady && !force && currentState && isStep2Ready(currentState, expected)) {
    logger.info(
      "[booking] Step 2 zaten hazir — doldurma atlandi (TC API tetiklenmedi, typeId=" +
        `${expected.appointmentTypeId}).`,
    );
    return { ok: true, skipped: true };
  }

  const needsApplicationType =
    force || !currentState || currentState.applicationType !== expected.applicationType;
  const needsNationality =
    force || !currentState || currentState.nationalityNumber !== expected.nationalityNumber;
  const needsStyle =
    force ||
    !currentState ||
    currentState.appointmentTypeId !== expected.appointmentTypeId ||
    !currentState.styleSelectEnabled;

  if (needsApplicationType) {
    logger.info("[booking] Step 2 — başvuru tipi seçiliyor (TC alanını açar).");
    try {
      await selectApplicationType(page, profile, settings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `Başvuru tipi seçilemedi: ${message}` };
    }

    if (settings.waitAfterApplicationTypeMs > 0) {
      await page.waitForTimeout(settings.waitAfterApplicationTypeMs);
    }
  } else {
    logger.debug("[booking] Step 2 — başvuru tipi zaten seçili, atlandi.");
  }

  if (needsNationality || needsStyle) {
    try {
      await waitForInputEnabled(
        page,
        nationalitySelectors,
        settings.nationalityNumberTimeoutMs,
        "TC Kimlik No",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: message };
    }
  }

  await logPreselectedDealerBranch(page);

  if (needsNationality) {
    logger.info("[booking] Step 2 — TC Kimlik giriliyor.");
    try {
      await fillNationalityNumber(page, profile, settings, { triggerBlankClick: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `TC Kimlik girilemedi: ${message}` };
    }
  } else {
    logger.info("[booking] Step 2 — TC zaten dogru, giris/blur atlandi (ek TC API yok).");
  }

  if (needsStyle) {
    logger.info("[booking] Step 2 — TC doğrulama API bekleniyor (başvuru şekli aktifleşecek).");
    try {
      await waitForSelectEnabled(
        page,
        styleSelectors,
        settings.appointmentStyleTimeoutMs,
        "Başvuru şekli",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: message };
    }

    const styleLabel = queryParams.appointmentStyleLabel?.trim();
    logger.info("[booking] Step 2 — başvuru şekli seçiliyor.");
    try {
      await selectAppointmentStyle(page, profile, settings, styleLabel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `Başvuru şekli seçilemedi: ${message}` };
    }
  } else {
    logger.debug("[booking] Step 2 — başvuru şekli zaten hazir, atlandi.");
  }

  logger.info("[booking] Step 2 doldurma tamamlandi.");
  return { ok: true };
}

/** @deprecated fillApplicantInfoStep kullanın */
export async function fillApplicantInfoStepPlaceholder(
  page: Page,
  profile: ResolvedProfile,
  appointmentSettings: AppointmentSettings,
  queryParams: ApiQueryParams,
): Promise<Step2FillResult> {
  return fillApplicantInfoStep(page, profile, appointmentSettings, queryParams);
}
