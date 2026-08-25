/** Portal randevu wizard adım kimlikleri (güncel site — 2025+). */
export type WizardStepId = 1 | 2 | 3 | 4 | 5;

export const WIZARD_STEP = {
  /** İkamet + şube (birleşik ekran) */
  LOCATION: 1 as WizardStepId,
  /** Bilgiler — API watcher burada kalır */
  APPLICANT_INFO: 2 as WizardStepId,
  /** Takvim — captcha + saat seçimi */
  CALENDAR: 3 as WizardStepId,
  /** Onay / kayıt özeti */
  SUMMARY: 4 as WizardStepId,
  /** OTP */
  OTP: 5 as WizardStepId,
} as const;

/** Slot / saat doğrulama takvim adımında başlar. */
export const WIZARD_OBSERVE_TARGET_STEP = WIZARD_STEP.CALENDAR;

/** GetClosedDate poll — bilgi formu üst sınırı. */
export const WIZARD_API_POLL_MAX_STEP = WIZARD_STEP.APPLICANT_INFO;

/** API watcher / booking — takvime otomatik gitme yasağı eşiği. */
export const WIZARD_FORBIDDEN_STEP = WIZARD_STEP.CALENDAR;

export const WIZARD_STEP_LABELS: Record<WizardStepId, string> = {
  1: "İkamet + şube",
  2: "Bilgiler",
  3: "Takvim",
  4: "Onay / özet",
  5: "OTP",
};
