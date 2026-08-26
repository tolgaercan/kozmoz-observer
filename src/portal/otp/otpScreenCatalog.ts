/**
 * Portal OTP ekran varyantları — locator'lar OTP ekranı görüldükçe doldurulacak.
 * Her varyant: tespit + (opsiyonel) kod iste + input + (opsiyonel) gönder.
 */

export type OtpInputMode = "single" | "multi-box";

export type OtpChannel = "phone" | "email" | "unknown";

export interface OtpScreenVariant {
  /** Benzersiz kimlik — log / debug */
  id: string;
  label: string;
  /** SMS mi e-posta mı (Supabase yalnızca telefon için) */
  channel: OtpChannel;
  /**
   * Bu varyant eşleşsin diye en az biri görünür olmalı.
   * Locator string (Playwright) — sayfa veya container içinde aranır.
   */
  detectSelectors: string[];
  /** Metin tabanlı yedek tespit (body veya container innerText) */
  detectTextPatterns?: RegExp[];
  /**
   * Popup/modal içinde arama — verilmezse önce dialog adayları, sonra tüm sayfa taranır.
   * Örn: "[role='dialog']", ".modal-content"
   */
  containerSelectors?: string[];
  /** OTP giriş alanı(ları) */
  inputSelectors: string[];
  inputMode?: OtpInputMode;
  /** «Kodu gönder / talep et» — tıklanınca `since` başlatılır */
  requestCodeSelectors?: string[];
  /** Doldurma sonrası «Doğrula / Onayla» */
  submitSelectors?: string[];
}

/** Dialog / popup adayları — containerSelectors verilmeyen varyantlarda kullanılır */
export const DEFAULT_OTP_DIALOG_SELECTORS = [
  "[role='dialog']",
  ".modal.show",
  ".modal.in",
  ".modal-dialog",
  ".swal2-popup",
  "mat-dialog-container",
  ".cdk-overlay-pane",
];

/** Genel OTP input adayları — yeni varyant eklerken kopyalanabilir */
export const DEFAULT_OTP_INPUT_SELECTORS = [
  "input[name*='otp' i]",
  "input[name*='verification' i]",
  "input[name*='verify' i]",
  "input[name*='code' i]",
  "input[id*='otp' i]",
  "input[placeholder*='kod' i]",
  "input[placeholder*='OTP' i]",
  "input[autocomplete='one-time-code']",
  "input[inputmode='numeric']",
];

/**
 * «Kimlik ve Telefon Doğrulama» — ana sayfa / randevu öncesi popup (öncelikli).
 */
export const IDENTITY_PHONE_VERIFICATION_VARIANT: OtpScreenVariant = {
  id: "identity-phone-verification-popup",
  label: "Kimlik ve Telefon Doğrulama popup",
  channel: "phone",
  detectSelectors: [
    "h5.popup-title:text-is('Kimlik ve Telefon Doğrulama')",
    ".popup-content:has-text('Kimlik ve Telefon Doğrulama')",
  ],
  detectTextPatterns: [/kimlik\s*ve\s*telefon\s*doğrulama/i],
  containerSelectors: [".popup-content"],
  inputSelectors: ["input#code", "input[placeholder*='Doğrulama kodunu' i]"],
  inputMode: "single",
  requestCodeSelectors: ["button:has-text('Telefonuma kod gönder')"],
  submitSelectors: ["button:has-text('Doğrula')"],
};

/**
 * Randevu wizard Adım 5 — «Kodu Gönder» sonrası inline SMS formu (sayfa içi, popup değil).
 */
export const WIZARD_INLINE_SMS_FORM_VARIANT: OtpScreenVariant = {
  id: "wizard-inline-sms-form",
  label: "Randevu wizard — inline SMS doğrulama (Adım 5)",
  channel: "phone",
  detectSelectors: [
    ".sms-form-wrapper input.form-control[maxlength='6']",
    ".sms-form-wrapper button:has-text('Sms İle Gelen Kodu Doğrula')",
    ".sms-form-wrapper",
  ],
  detectTextPatterns: [
    /sms\s*ile\s*gelen\s*kodu\s*doğrula/i,
    /ödeme\s*adımına\s*geç/i,
  ],
  containerSelectors: [".sms-form-wrapper", ".wizard-tab-container"],
  inputSelectors: [
    ".sms-form-wrapper input.form-control[maxlength='6']",
    ".sms-form-wrapper input[type='text']",
    "input.form-control[maxlength='6'][pattern]",
  ],
  inputMode: "single",
  requestCodeSelectors: [],
  submitSelectors: [
    ".sms-form-wrapper button.btn-danger:has-text('Sms İle Gelen Kodu Doğrula')",
    "button:has-text('Sms İle Gelen Kodu Doğrula')",
    "button:has-text('Ödeme Adımına Geç')",
  ],
};

/**
 * Bilinen OTP ekranları — sıra önemli (ilk eşleşen kazanır).
 * Locator'ları OTP ekranı gelince birlikte güncelleyeceğiz.
 */
export const PORTAL_OTP_SCREEN_VARIANTS: OtpScreenVariant[] = [
  IDENTITY_PHONE_VERIFICATION_VARIANT,
  WIZARD_INLINE_SMS_FORM_VARIANT,
  {
    id: "wizard-phone-sms",
    label: "Randevu wizard — telefon SMS OTP (Adım 5)",
    channel: "phone",
    detectSelectors: [
      ".wizard-tab-container:has-text('sms kodu talep edin')",
      ".wizard-tab-container button:has-text('Telefonuma Doğrulama Kodu Gönder')",
      "button.btn.btn-md.btn-primary:has-text('Telefonuma Doğrulama Kodu Gönder')",
      "text=Telefonuma Doğrulama Kodu Gönder",
      "text=sms kodu talep edin",
    ],
    detectTextPatterns: [
      /telefonuma\s*doğrulama\s*kodu/i,
      /sms\s*kodu\s*talep/i,
      /telefon\s*numaranız/i,
    ],
    containerSelectors: [".wizard-tab-container"],
    inputSelectors: [...DEFAULT_OTP_INPUT_SELECTORS],
    inputMode: "single",
    requestCodeSelectors: [
      ".wizard-tab-container button.btn-primary:has-text('Telefonuma Doğrulama Kodu Gönder')",
      "button.btn.btn-md.btn-primary.w-20:has-text('Telefonuma Doğrulama Kodu Gönder')",
      "text=Telefonuma Doğrulama Kodu Gönder",
      "button:has-text('Doğrulama Kodu')",
      "button:has-text('Kod Gönder')",
    ],
    submitSelectors: [
      "button:has-text('Doğrula')",
      "button:has-text('Onayla')",
      "button[type='submit']",
    ],
  },
  {
    id: "modal-phone-otp",
    label: "Popup / modal — telefon OTP",
    channel: "phone",
    detectSelectors: [...DEFAULT_OTP_INPUT_SELECTORS],
    detectTextPatterns: [/doğrulama\s*kodu/i, /sms\s*kod/i],
    containerSelectors: [...DEFAULT_OTP_DIALOG_SELECTORS],
    inputSelectors: [...DEFAULT_OTP_INPUT_SELECTORS],
    inputMode: "single",
    requestCodeSelectors: [
      "button:has-text('Kod Gönder')",
      "button:has-text('Kod Talep')",
      "text=Kod Talep Et",
    ],
    submitSelectors: ["button:has-text('Doğrula')", "button:has-text('Tamam')"],
  },
  {
    id: "generic-inline-phone-otp",
    label: "Sayfa içi — telefon OTP (genel)",
    channel: "phone",
    detectSelectors: [...DEFAULT_OTP_INPUT_SELECTORS],
    detectTextPatterns: [/doğrulama\s*kodu/i, /onay\s*kodu/i, /sms\s*kod/i],
    inputSelectors: [...DEFAULT_OTP_INPUT_SELECTORS],
    inputMode: "single",
    submitSelectors: ["button:has-text('Doğrula')", "button[type='submit']"],
  },
  {
    id: "generic-email-otp",
    label: "E-posta OTP (Supabase telefon dışı — ileride ayrı sağlayıcı)",
    channel: "email",
    detectSelectors: [
      "input[name*='email' i][name*='code' i]",
      "input[placeholder*='e-posta' i][placeholder*='kod' i]",
    ],
    detectTextPatterns: [/e-?posta.*kod/i, /email.*verification/i],
    inputSelectors: [
      "input[name*='email' i][name*='code' i]",
      ...DEFAULT_OTP_INPUT_SELECTORS,
    ],
    inputMode: "single",
    submitSelectors: ["button:has-text('Doğrula')"],
  },
];

const extraVariants: OtpScreenVariant[] = [];

/** Çalışma anında yeni OTP ekranı tanımı ekle */
export function registerOtpScreenVariant(variant: OtpScreenVariant): void {
  extraVariants.push(variant);
}

export function getPortalOtpScreenVariants(): OtpScreenVariant[] {
  return [...PORTAL_OTP_SCREEN_VARIANTS, ...extraVariants];
}
