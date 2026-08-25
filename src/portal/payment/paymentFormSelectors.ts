/** Kosmos randevu — kart ödeme sayfası locator'ları */

export const PAYMENT_FORM_SELECTORS = {
  cardNumber: "#CreditCardNumber",
  cardholderName: "#CardholderName",
  expireMonth: "#CreditCardExpireMonth",
  expireYear: "#CreditCardExpireYear",
  cvv: "#CreditCardCvv2",
  email: "#Email",
  phone: "#Phone",
  submitButton: "#btnSubmit",
} as const;

export const PAYMENT_PAGE_MARKERS = [
  PAYMENT_FORM_SELECTORS.cardNumber,
  PAYMENT_FORM_SELECTORS.submitButton,
  "text=Ödemeyi Tamamla",
  "text=Complete Payment",
  "text=Kart Numarası",
  "text=Card Number",
] as const;
