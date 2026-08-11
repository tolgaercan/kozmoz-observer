/**
 * «Kimlik ve Telefon Doğrulama» popup — sabit locator'lar (HTML name/id).
 * Akış: başvuru tipi → TC → pasaport → kod gönder → Supabase OTP → doğrula.
 */

export const IDENTITY_PHONE_VERIFICATION_TITLE = "Kimlik ve Telefon Doğrulama";

export const IDENTITY_PHONE_VERIFICATION_SELECTORS = {
  /** Popup kök — başlık ile scope */
  popupContent: ".popup-content:has(h5.popup-title)",
  popupTitle: "h5.popup-title",
  applicationType: "select[name='applicationType']",
  tckn1: "input[name='verificationPopupTckn1']",
  passport1: "input[name='verificationPopupPassportNumber1']",
  sendCodeButton: "button:has-text('Telefonuma kod gönder')",
  otpInput: "input#code",
  verifyButton: "button:has-text('Doğrula')",
  resendCodeButton: "button:has-text('Yeniden doğrulama kodu gönder')",
  remainingTime: ".remaining-time strong",
} as const;

/** Bireysel = 1. kişi; Aile = ileride çoklu kişi genişletilecek */
export function personFieldSelectors(personIndex: number): {
  tckn: string;
  passport: string;
} {
  const index = Math.max(1, Math.min(6, personIndex));
  return {
    tckn: `input[name='verificationPopupTckn${index}']`,
    passport: `input[name='verificationPopupPassportNumber${index}']`,
  };
}

export type PopupApplicationTypeValue = "bireysel" | "aile";

/** Profil metni → popup select value */
export function mapApplicationTypeToPopupValue(display: string): PopupApplicationTypeValue {
  const normalized = display.trim().toLocaleLowerCase("tr-TR");
  if (normalized.includes("aile")) {
    return "aile";
  }
  return "bireysel";
}
