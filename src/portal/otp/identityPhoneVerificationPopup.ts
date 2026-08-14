import type { Locator, Page } from "playwright";

import {
  DEFAULT_SUPABASE_OTP_TIMEOUT_MS,
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
import { maskNationalityNumber } from "../nationalityNumberInput.js";
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

async function fillIdentityField(
  page: Page,
  input: Locator,
  value: string,
  label: string,
  mask: (raw: string) => string = maskNationalityNumber,
): Promise<void> {
  const target = value.trim();
  if (!target) {
    return;
  }

  const current = (await input.inputValue().catch(() => "")).trim();
  if (current === target) {
    logger.info(`[identity-phone] ${label} panel degeri zaten alanda (${mask(target)}).`);
    return;
  }

  if (current) {
    logger.warn(
      `[identity-phone] ${label} alaninda farkli deger var (${mask(current)}) — panel degeri yaziliyor (${mask(target)}).`,
    );
  } else {
    logger.info(`[identity-phone] ${label} panelden yaziliyor (${mask(target)}).`);
  }

  await humanTypeIntoLocator(page, input, target, {
    label,
    minCharDelayMs: 55,
    maxCharDelayMs: 130,
    clearBeforeType: true,
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

  await fillIdentityField(page, tcknInput, data.tckn, "TC kimlik");
  await fillIdentityField(
    page,
    passportInput,
    data.passportNumber,
    "Pasaport no",
    (raw) => (raw.length <= 4 ? "***" : `***${raw.slice(-4)}`),
  );
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

async function clickResendCode(scope: Locator): Promise<boolean> {
  const link = scope.locator(IDENTITY_PHONE_VERIFICATION_SELECTORS.resendCodeLink).first();
  if (!(await link.isVisible({ timeout: 3000 }).catch(() => false))) {
    logger.warn("[identity-phone] «Yeniden doğrulama kodu gönder» linki bulunamadı.");
    return false;
  }
  await link.click({ timeout: 8000 });
  logger.info("[identity-phone] «Yeniden doğrulama kodu gönder» tıklandı (1 kez).");
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

    logger.info(
      `[identity-phone] Panel kimlik (profil=${options.profile.id}): TC=${maskNationalityNumber(data.tckn)} pasaport=***${data.passportNumber.slice(-4)} tip=${data.applicationTypeDisplay}`,
    );

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
    logger.warn(
      "[identity-phone] OTP alani zaten acik — TC/pasaport adimi atlandi (portal oturum degerleri kullanilmis olabilir).",
    );
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

  const otpTimeoutMs = options.waitOptions?.timeoutMs ?? DEFAULT_SUPABASE_OTP_TIMEOUT_MS;

  let otp: string;
  try {
    logger.info(
      `[identity-phone] Supabase OTP bekleniyor (panel tel ***${phone.slice(-4)}, timeout ${otpTimeoutMs}ms).`,
    );
    otp = await waitSupabaseOtp(phone, {
      since: since ?? new Date(),
      ...options.waitOptions,
      timeoutMs: otpTimeoutMs,
    });
  } catch (firstError) {
    const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
    logger.warn(`[identity-phone] OTP gelmedi (${otpTimeoutMs}ms) — yeniden gönder deneniyor: ${firstMessage}`);

    const resent = await clickResendCode(scope);
    if (!resent) {
      return {
        visible: true,
        resolved: false,
        step: "wait-otp",
        filledForm,
        codeRequested,
        otpFilled: false,
        submitted: false,
        detail: firstMessage,
      };
    }

    since = new Date();
    await sleep(800);

    try {
      logger.info(
        `[identity-phone] Yeniden gönder sonrası OTP bekleniyor (***${phone.slice(-4)}, timeout ${otpTimeoutMs}ms).`,
      );
      otp = await waitSupabaseOtp(phone, {
        since,
        ...options.waitOptions,
        timeoutMs: otpTimeoutMs,
      });
    } catch (secondError) {
      const message = secondError instanceof Error ? secondError.message : String(secondError);
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
  }

  const otpField = scope.locator(IDENTITY_PHONE_VERIFICATION_SELECTORS.otpInput).first();
  await fillIdentityField(page, otpField, otp, "Doğrulama kodu", () => "****");
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
