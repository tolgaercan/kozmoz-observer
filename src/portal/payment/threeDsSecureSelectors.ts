/** Garanti BBVA / QNBPAY 3D Secure — SS1 yöntem seçimi + SS2 OTP */

export const THREE_DS_SELECTORS = {
  /** SS1 — «Doğrulama Yöntemi Seçin» */
  methodStepTitle: "text=Doğrulama Yöntemi Seçin",
  smsMethodLabel: "text=SMS ile Doğrula",
  smsMethodRadio: "input[type='radio']",
  mobileMethodLabel: "text=Garanti BBVA Mobil ile Doğrula",
  /** SS1 + SS2 ortak */
  continueButton: "#js-verification-method-btn",
  /** SS2 — OTP girişi */
  otpInput: "#sixDigitNumber",
  otpToggleVisibility: "#toggleOTP",
  countdown: "#countdown",
  resendOtpButton: "button.sendOTP-btn, button:has-text('Tekrar SMS Gönder')",
  otpErrorTimeout: ".verification-info-content-error-info",
  otpErrorWrong: ".verification-info-content-error-password",
  cancelButton: "text=İşlemi İptal Et",
} as const;

export const THREE_DS_PAGE_MARKERS = [
  THREE_DS_SELECTORS.methodStepTitle,
  THREE_DS_SELECTORS.otpInput,
  "text=3D Secure Ödeme Doğrulama",
  "text=Doğrulama Yöntemi Seçin",
  THREE_DS_SELECTORS.continueButton,
] as const;

export type ThreeDsScreenKind = "method_select" | "otp_entry" | "unknown";
