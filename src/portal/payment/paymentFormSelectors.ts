/** Kosmos güvenli ödeme sayfası — /Payment/Index (iframe veya doğrudan) */

export const PAYMENT_FORM_SELECTORS = {
  form: "#payment-form",
  wrapper: "#payment-wrapper",
  loadingOverlay: "#payment-loading-overlay",
  cardNumber: "#CreditCardNumber",
  cardholderName: "#CardholderName",
  expireMonth: "#CreditCardExpireMonth",
  expireYear: "#CreditCardExpireYear",
  cvv: "#CreditCardCvv2",
  email: "#Email",
  phone: "#Phone",
  amount: "#Amount",
  submitButton: "#btnSubmit",
} as const;

/** Submit — emoji/metin varyantları dahil */
export const PAYMENT_SUBMIT_SELECTORS = [
  PAYMENT_FORM_SELECTORS.submitButton,
  "button#btnSubmit.btn-primary",
  "form#payment-form button[type='submit']",
  "button.btn-primary[type='submit']",
  "button:has-text('Ödemeyi Tamamla')",
  "button:has-text('Complete Payment')",
  "button:has-text('Ödemeyi Tamamla / Complete Payment')",
] as const;

export const PAYMENT_FIELD_ERROR_SELECTORS = [
  "#cardNumberError",
  "#cardHolderError",
  "#cvvError",
  "#emailError",
  "#phoneError",
  ".error-message:visible",
] as const;

/** Sayfa / iframe tespiti — en az biri görünür olmalı */
export const PAYMENT_PAGE_MARKERS = [
  PAYMENT_FORM_SELECTORS.form,
  PAYMENT_FORM_SELECTORS.wrapper,
  PAYMENT_FORM_SELECTORS.cardNumber,
  PAYMENT_FORM_SELECTORS.cardholderName,
  PAYMENT_FORM_SELECTORS.submitButton,
  "input[name='CreditCardNumber']",
  "input#CreditCardNumber",
  "label[for='CreditCardNumber']",
  "text=Güvenli Ödeme Sayfası",
  "text=Ödemeyi Tamamla / Complete Payment",
  "text=Ödemeyi Tamamla",
  "text=Complete Payment",
  "text=Ödenecek Miktar",
  "text=Amount Payment",
  "text=Kart Numarası / Card Number",
  "text=Kart Numarası",
  "text=Card Number",
  "text=Fatura Bilgileri / Billing Information",
  ".amount-display",
] as const;
