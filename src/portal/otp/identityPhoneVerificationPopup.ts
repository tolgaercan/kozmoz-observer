import type { Locator, Page } from "playwright";

import {
  isSupabaseOtpConfigured,
  waitSupabaseOtp,
  type WaitSupabaseOtpOptions,
} from "../../integrations/supabaseOtp.js";
import { humanTypeIntoLocator } from "../../interaction/humanType.js";
import {
  resolvePortalIdentityVerificationData,
  resolveProfilePhone,
  type PortalIdentityVerificationData,
} from "../../profiles/profileCredentials.js";
import type { ResolvedProfile } from "../../profiles/profileManager.js";
import { logger } from "../../utils/logger.js";
import { PORTAL_INTERVENTION_PROBE_MS } from "../interventions/portalInterventionTiming.js";
import {
  IDENTITY_PHONE_VERIFICATION_SELECTORS,
  IDENTITY_PHONE_VERIFICATION_TITLE,
  mapApplicationTypeToPopupValue,
  personFieldSelectors,
  type PopupApplicationTypeValue,
} from "./identityPhoneVerificationSelectors.js";

export interface IdentityPhoneVerificationOptions {
  profile: ResolvedProfile;
  /** Form alanlarını override et */
  verificationData?: Partial<PortalIdentityVerificationData>;
  phone?: string;
  /** «Kodu gönder» zaten tıklandıysa */
  since?: Date;
  /** Doğrula butonuna tıkla (varsayılan true) */
  clickSubmit?: boolean;
  waitOptions?: Pick<WaitSupabaseOtpOptions, "timeoutMs" | "intervalMs" | "consume">;
  /** OTP input bekleme (kod gönder sonrası) */
  otpInputWaitMs?: number;
}

export interface IdentityPhoneVerificationResult {
  visible: boolean;
  resolved: boolean;
  step:
    | "none"
    | "form"
    | "send-code"
    | "wait-otp"
    | "fill-otp"
    | "verify"
    | "done";
  filledForm: boolean;
  codeRequested: boolean;
  otpFilled: boolean;
  submitted: boolean;
  detail?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function isIdentityPhoneVerificationPopupVisible(
  page: Page,
  probeMs: number = PORTAL_INTERVENTION_PROBE_MS,
): Promise<boolean> {
  const title = page.locator(IDENTITY_PHONE_VERIFICATION_SELECTORS.popupTitle).filter({
    hasText: IDENTITY_PHONE_VERIFICATION_TITLE,
  });
  return title.first().isVisible({ timeout: probeMs }).catch(() => false);
}

export async function resolveIdentityPhonePopupScope(
  page: Page,
  probeMs: number = PORTAL_INTERVENTION_PROBE_MS,
): Promise<Locator | null> {
  const popup = page
    .locator(IDENTITY_PHONE_VERIFICATION_SELECTORS.popupContent)
    .filter({ has: page.locator(IDENTITY_PHONE_VERIFICATION_SELECTORS.popupTitle, { hasText: IDENTITY_PHONE_VERIFICATION_TITLE }) })
    .first();

  if (await popup.isVisible({ timeout: probeMs }).catch(() => false)) {
    return popup;
  }
  return null;
}

async function waitForInputEnabled(input: Locator, timeoutMs: number): Promise<void> {
  await input.waitFor({ state: "visible", timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await input.isEnabled().catch(() => false)) {
      return;
    }
    await sleep(200);
  }
  throw new Error("Kimlik/pasaport alanı etkinleşmedi (başvuru tipi seçimi sonrası).");
}

async function fillTextIfEmpty(
  page: Page,
  input: Locator,
  value: string,
  label: string,
): Promise<void> {
  const current = (await input.inputValue().catch(() => "")).trim();
  if (current === value.trim()) {
    logger.info(`[identity-phone] ${label} zaten dolu — atlanıyor.`);
    return;
  }
  await humanTypeIntoLocator(page, input, value, {
    label,
    minCharDelayMs: 55,
    maxCharDelayMs: 130,
  });
}

async function selectApplicationTypeIfNeeded(
  scope: Locator,
  targetValue: PopupApplicationTypeValue,
): Promise<void> {
  const select = scope.locator(IDENTITY_PHONE_VERIFICATION_SELECTORS.applicationType).first();
  if (!(await select.isVisible({ timeout: 800 }).catch(() => false))) {
    return;
  }

  const current = (await select.inputValue().catch(() => "")).trim().toLowerCase();
  if (current === targetValue) {
    logger.info(`[identity-phone] Başvuru tipi zaten ${targetValue}.`);
    return;
  }

  await select.selectOption({ value: targetValue });
  logger.info(`[identity-phone] Başvuru tipi seçildi: ${targetValue}`);
  await sleep(600);
}

async function fillPersonIdentityFields(
  page: Page,
  scope: Locator,
  data: PortalIdentityVerificationData,
  personIndex: number,
): Promise<void> {
  const fields = personFieldSelectors(personIndex);
  const tcknInput = scope.locator(fields.tckn).first();
  const passportInput = scope.locator(fields.passport).first();

  await waitForInputEnabled(tcknInput, 12_000);
  await waitForInputEnabled(passportInput, 12_000);

  await fillTextIfEmpty(page, tcknInput, data.tckn, "TC kimlik");
  await fillTextIfEmpty(page, passportInput, data.passportNumber, "Pasaport no");
}

async function clickSendCode(scope: Locator): Promise<boolean> {
  const button = scope.locator(IDENTITY_PHONE_VERIFICATION_SELECTORS.sendCodeButton).first();
  if (!(await button.isVisible({ timeout: 800 }).catch(() => false))) {
    return false;
  }
  if (!(await button.isEnabled().catch(() => false))) {
    logger.warn("[identity-phone] «Telefonuma kod gönder» butonu devre dışı.");
    return false;
  }
  await button.click({ timeout: 8000 });
  logger.info("[identity-phone] «Telefonuma kod gönder» tıklandı.");
  return true;
}

async function waitForOtpInput(scope: Locator, timeoutMs: number): Promise<Locator> {
  const input = scope.locator(IDENTITY_PHONE_VERIFICATION_SELECTORS.otpInput).first();
  await input.waitFor({ state: "visible", timeout: timeoutMs });
  return input;
}

function mergeVerificationData(
  profile: ResolvedProfile,
  overrides?: Partial<PortalIdentityVerificationData>,
): PortalIdentityVerificationData {
  const base = resolvePortalIdentityVerificationData(profile);
  if (!overrides) {
    return base;
  }
  return {
    applicationTypeValue:
      overrides.applicationTypeValue ??
      (overrides.applicationTypeDisplay
        ? mapApplicationTypeToPopupValue(overrides.applicationTypeDisplay)
        : base.applicationTypeValue),
    applicationTypeDisplay: overrides.applicationTypeDisplay ?? base.applicationTypeDisplay,
    tckn: overrides.tckn?.trim() || base.tckn,
    passportNumber: overrides.passportNumber?.trim() || base.passportNumber,
  };
}

function validateVerificationData(data: PortalIdentityVerificationData): void {
  const missing: string[] = [];
  if (!data.tckn) {
    missing.push("panel Worker TC / form.nationalityNumber");
  }
  if (!data.passportNumber) {
    missing.push("panel Worker pasaport / form.passportNumber");
  }
  if (missing.length > 0) {
    throw new Error(`Kimlik doğrulama verisi eksik: ${missing.join(", ")}`);
  }
}

/**
 * «Kimlik ve Telefon Doğrulama» popup — tam akış.
 * Popup yoksa `{ visible: false }` döner.
 */
export async function handleIdentityPhoneVerificationPopupIfPresent(
  page: Page,
  options: IdentityPhoneVerificationOptions,
): Promise<IdentityPhoneVerificationResult> {
  const scope = await resolveIdentityPhonePopupScope(page);
  if (!scope) {
    return {
      visible: false,
      resolved: false,
      step: "none",
      filledForm: false,
      codeRequested: false,
      otpFilled: false,
      submitted: false,
    };
  }

  logger.info(`[identity-phone] Popup tespit: ${IDENTITY_PHONE_VERIFICATION_TITLE}`);

  const otpInput = scope.locator(IDENTITY_PHONE_VERIFICATION_SELECTORS.otpInput).first();
  const otpAlreadyVisible = await otpInput.isVisible({ timeout: 400 }).catch(() => false);

  let filledForm = false;
  let codeRequested = false;
  let since: Date | undefined;
  let otpFilled = false;
  let submitted = false;

  if (!otpAlreadyVisible) {
    const data = mergeVerificationData(options.profile, options.verificationData);
    validateVerificationData(data);

    await selectApplicationTypeIfNeeded(scope, data.applicationTypeValue);
    await fillPersonIdentityFields(page, scope, data, 1);
    filledForm = true;

    codeRequested = await clickSendCode(scope);
    if (!codeRequested) {
      return {
        visible: true,
        resolved: false,
        step: "send-code",
        filledForm,
        codeRequested: false,
        otpFilled: false,
        submitted: false,
        detail: "Kod gönder butonu tıklanamadı",
      };
    }

    since = new Date();
    await sleep(800);
  } else {
    logger.info("[identity-phone] OTP alanı zaten görünür — form adımı atlanıyor.");
    since = options.since ?? new Date();
  }

  const otpInputWaitMs = options.otpInputWaitMs ?? 20_000;
  try {
    await waitForOtpInput(scope, otpInputWaitMs);
  } catch {
    return {
      visible: true,
      resolved: false,
      step: "wait-otp",
      filledForm,
      codeRequested,
      otpFilled: false,
      submitted: false,
      detail: "Doğrulama kodu input alanı görünmedi",
    };
  }

  if (!isSupabaseOtpConfigured()) {
    return {
      visible: true,
      resolved: false,
      step: "wait-otp",
      filledForm,
      codeRequested,
      otpFilled: false,
      submitted: false,
      detail: "SB_URL / SB_SERVICE_KEY tanımlı değil",
    };
  }

  const phone =
    options.phone?.trim() || resolveProfilePhone(options.profile.id) || resolveProfilePhone(options.profile);
  if (!phone) {
    return {
      visible: true,
      resolved: false,
      step: "wait-otp",
      filledForm,
      codeRequested,
      otpFilled: false,
      submitted: false,
      detail: "Panel Worker OTP telefonu tanımlı değil",
    };
  }

  let otp: string;
  try {
    otp = await waitSupabaseOtp(phone, {
      since: since ?? new Date(),
      ...options.waitOptions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      visible: true,
      resolved: false,
      step: "wait-otp",
      filledForm,
      codeRequested,
      otpFilled: false,
      submitted: false,
      detail: message,
    };
  }

  const otpField = scope.locator(IDENTITY_PHONE_VERIFICATION_SELECTORS.otpInput).first();
  await fillTextIfEmpty(page, otpField, otp, "Doğrulama kodu");
  otpFilled = true;

  const shouldSubmit = options.clickSubmit !== false;
  if (shouldSubmit) {
    const verifyButton = scope.locator(IDENTITY_PHONE_VERIFICATION_SELECTORS.verifyButton).first();
    if (await verifyButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await verifyButton.click({ timeout: 8000 });
      submitted = true;
      logger.info("[identity-phone] «Doğrula» tıklandı.");
      await sleep(1200);
    }
  }

  const stillVisible = await isIdentityPhoneVerificationPopupVisible(page);
  return {
    visible: true,
    resolved: !stillVisible || (otpFilled && submitted),
    step: submitted ? "done" : "fill-otp",
    filledForm,
    codeRequested,
    otpFilled,
    submitted,
    detail: stillVisible ? "Popup hâlâ açık — doğrulama sonucu bekleniyor olabilir" : "Popup kapandı",
  };
}
