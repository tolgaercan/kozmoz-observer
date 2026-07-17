import type { Page } from "playwright";

import { logger } from "../utils/logger.js";

/** "Kimlik ve Telefon Doğrulama" modal başlığı — randevu / davet akışında rastgele çıkabilir */
export const PORTAL_IDENTITY_PHONE_GATE_TITLE = "Kimlik ve Telefon Doğrulama";

/** Modal kök — başlık metni ile eşleşir */
export const PORTAL_IDENTITY_PHONE_GATE_ROOT_SELECTORS = [
  `.modal:has-text('${PORTAL_IDENTITY_PHONE_GATE_TITLE}')`,
  `[role='dialog']:has-text('${PORTAL_IDENTITY_PHONE_GATE_TITLE}')`,
  `div:has(> *:text-is('${PORTAL_IDENTITY_PHONE_GATE_TITLE}'))`,
];

/** Form alanları — ileride doldurulacak */
export const PORTAL_IDENTITY_PHONE_GATE_FIELD_SELECTORS = {
  applicationType: "select, [role='combobox'], .p-dropdown",
  nationalityNumber: "input[name*='kimlik' i], input[placeholder*='kimlik' i]",
  passportNumber: "input[name*='pasaport' i], input[placeholder*='pasaport' i]",
  sendCodeButton: "button:has-text('Telefonuma kod gönder')",
  otpInput: "input[name*='otp' i], input[placeholder*='kod' i], input[autocomplete='one-time-code']",
} as const;

export type PortalIdentityPhoneGateStep =
  | "detect"
  | "fill-form"
  | "send-sms"
  | "enter-otp"
  | "confirm";

export interface PortalIdentityPhoneGateContext {
  profileId: string;
  /** Hangi akıştan çağrıldı — log / OTP sağlayıcı için */
  flowLabel?: string;
}

export interface PortalIdentityPhoneGateResult {
  /** Modal ekranda mı */
  visible: boolean;
  /** Tamamen çözüldü mü (form + SMS OTP) */
  resolved: boolean;
  /** Hangi aşamada kaldı — stub modda genelde detect veya fill-form */
  step: PortalIdentityPhoneGateStep | null;
  detail: string;
}

/**
 * Portal genelinde rastgele çıkan "Kimlik ve Telefon Doğrulama" modalını sorgular ve çözer.
 *
 * TODO (sistemsel OTP entegrasyonu):
 * 1. Modal görünür mü kontrol et (başlık + dialog)
 * 2. Başvuru Tipi seç (profil / .env — bireysel vb.)
 * 3. 1. Kişi kimlik numarası + pasaport numarası doldur (profil credentials)
 * 4. "Telefonuma kod gönder" — insan benzeri tıklama + bekleme
 * 5. SMS OTP alanını bekle; generik OTP sağlayıcıdan kod al ve doldur
 * 6. Doğrulama tamamlanana kadar modal kapanışını doğrula
 *
 * Her senaryo fazında (portal-url-login, randevu-navigate, observe, register-wizard)
 * ve observer checkpoint'lerinde periyodik çağrılacak — ban riskini azaltmak için
 * otomatik doldurma yerine stub modda yalnızca log + visible=true döner.
 */
export async function resolvePortalIdentityPhoneGateIfVisible(
  page: Page,
  context: PortalIdentityPhoneGateContext,
): Promise<PortalIdentityPhoneGateResult> {
  const flow = context.flowLabel ?? "unknown";

  // TODO: isPortalIdentityPhoneGateVisible(page) ile modal tespiti
  // TODO: visible ise fillPortalIdentityPhoneForm + sendSmsCode + fillOtpFromProvider
  // TODO: resolved=true yalnızca modal kapandığında

  logger.info(
    `[portal][identity-phone] Stub — akış=${flow}, profil=${context.profileId} (henüz uygulanmadı)`,
  );

  return {
    visible: false,
    resolved: false,
    step: null,
    detail: "Stub — Kimlik ve Telefon Doğrulama henüz otomatik çözülmüyor",
  };
}

/**
 * Modal açık mı — hızlı sorgu (ileride resolvePortalIdentityPhoneGateIfVisible içinde kullanılacak).
 */
export async function isPortalIdentityPhoneGateVisible(page: Page): Promise<boolean> {
  for (const selector of PORTAL_IDENTITY_PHONE_GATE_ROOT_SELECTORS) {
    const visible = await page
      .locator(selector)
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);
    if (visible) {
      return true;
    }
  }

  const byTitle = page.getByText(PORTAL_IDENTITY_PHONE_GATE_TITLE, { exact: true }).first();
  return byTitle.isVisible({ timeout: 300 }).catch(() => false);
}
