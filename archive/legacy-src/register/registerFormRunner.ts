import type { Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { logger } from "../utils/logger.js";
import {
  maskRegisterContact,
  resolveRegisterContact,
  validateRegisterContact,
} from "./registerContactData.js";
import { ensureRegisterFormOpen } from "./registerFormNav.js";
import { fillRegisterStep1Identity, isIdentityStepVisible } from "./registerFormStep1Identity.js";
import { fillRegisterStep2Personal, isPersonalStepVisible } from "./registerFormStep2Personal.js";
import { fillRegisterStep3Contact, isContactStepVisible } from "./registerFormStep3Contact.js";
import { fillRegisterStep4Occupation, isOccupationStepVisible } from "./registerFormStep4Occupation.js";
import { fillRegisterStep5Travel, isTravelStepVisible } from "./registerFormStep5Travel.js";
import {
  fillRegisterStep6Accommodation,
  isAccommodationStepVisible,
} from "./registerFormStep6Accommodation.js";
import { fillRegisterStep7Expenses, isExpensesStepVisible } from "./registerFormStep7Expenses.js";
import { isKvkkStepVisible, fillRegisterStep8Kvkk } from "./registerFormStep8Kvkk.js";
import {
  fillRegisterStep9EmailVerification,
  isEmailVerificationStepVisible,
  isRegisterFlowComplete,
  resolveRegisterEnableCodeRequest,
} from "./registerFormStep9EmailVerification.js";
import { resolveRegisterKvkk, validateRegisterKvkk } from "./registerKvkkData.js";
import {
  detectRegisterWizardStep,
  formatRegisterWizardLog,
  navigateToRegisterWizardViewStep,
  type RegisterWizardStepId,
} from "./registerFormWizardDetector.js";
import {
  maskRegisterIdentity,
  resolveRegisterIdentity,
  validateRegisterIdentity,
} from "./registerIdentityData.js";
import {
  resolveRegisterOccupation,
  validateRegisterOccupation,
} from "./registerOccupationData.js";
import {
  maskRegisterPersonal,
  resolveRegisterPersonal,
  validateRegisterPersonal,
} from "./registerPersonalData.js";
import { resolveRegisterTravel, validateRegisterTravel } from "./registerTravelData.js";
import { resolveRegisterExpenses, validateRegisterExpenses } from "./registerExpensesData.js";
import {
  createRegisterStepFailureTracker,
  recoverRegisterWizardStep,
} from "./registerFormStepRecovery.js";

export interface RegisterFormSetupResult {
  identityStepComplete: boolean;
  personalStepComplete: boolean;
  contactStepComplete: boolean;
  occupationStepComplete: boolean;
  travelStepComplete: boolean;
  accommodationStepComplete: boolean;
  expensesStepComplete: boolean;
  kvkkScrollComplete: boolean;
  kvkkStepComplete: boolean;
  emailVerificationComplete: boolean;
  emailVerificationStepReached: boolean;
  randevuNavVerified: boolean;
  progressStep: RegisterWizardStepId | null;
  viewStep: RegisterWizardStepId | null;
}

export interface RegisterFormSetupOptions {
  maxRounds?: number;
  homeUrl?: string;
  softValidate?: boolean;
  /** @deprecated REGISTER_ENABLE_CODE_REQUEST env kullanın */
  stopBeforeVerificationActions?: boolean;
  enableCodeRequest?: boolean;
}

const IDENTITY_STEP = 1 as RegisterWizardStepId;
const PERSONAL_STEP = 2 as RegisterWizardStepId;
const CONTACT_STEP = 3 as RegisterWizardStepId;
const OCCUPATION_STEP = 4 as RegisterWizardStepId;
const TRAVEL_STEP = 5 as RegisterWizardStepId;
const ACCOMMODATION_STEP = 6 as RegisterWizardStepId;
const EXPENSES_STEP = 7 as RegisterWizardStepId;
const KVKK_STEP = 8 as RegisterWizardStepId;
const EMAIL_VERIFICATION_STEP = 9 as RegisterWizardStepId;
const IDENTITY_COMPLETE_STEP = 2 as RegisterWizardStepId;
const PERSONAL_COMPLETE_STEP = 3 as RegisterWizardStepId;
const CONTACT_COMPLETE_STEP = 4 as RegisterWizardStepId;
const OCCUPATION_COMPLETE_STEP = 5 as RegisterWizardStepId;
const TRAVEL_COMPLETE_STEP = 6 as RegisterWizardStepId;
const ACCOMMODATION_COMPLETE_STEP = 7 as RegisterWizardStepId;
const EXPENSES_COMPLETE_STEP = 8 as RegisterWizardStepId;
const KVKK_COMPLETE_STEP = 9 as RegisterWizardStepId;

const IMPLEMENTED_LAST_STEP = EMAIL_VERIFICATION_STEP;

function resolveActiveStep(
  state: NonNullable<Awaited<ReturnType<typeof detectRegisterWizardStep>>>,
): RegisterWizardStepId {
  return state.viewStep ?? state.progressStep ?? IDENTITY_STEP;
}

function isIdentityComplete(progress: RegisterWizardStepId | null | undefined): boolean {
  return (progress ?? 1) >= IDENTITY_COMPLETE_STEP;
}

function isPersonalComplete(progress: RegisterWizardStepId | null | undefined): boolean {
  return (progress ?? 1) >= PERSONAL_COMPLETE_STEP;
}

function isContactComplete(progress: RegisterWizardStepId | null | undefined): boolean {
  return (progress ?? 1) >= CONTACT_COMPLETE_STEP;
}

function isOccupationComplete(progress: RegisterWizardStepId | null | undefined): boolean {
  return (progress ?? 1) >= OCCUPATION_COMPLETE_STEP;
}

function isTravelComplete(progress: RegisterWizardStepId | null | undefined): boolean {
  return (progress ?? 1) >= TRAVEL_COMPLETE_STEP;
}

function isAccommodationComplete(progress: RegisterWizardStepId | null | undefined): boolean {
  return (progress ?? 1) >= ACCOMMODATION_COMPLETE_STEP;
}

function isExpensesComplete(progress: RegisterWizardStepId | null | undefined): boolean {
  return (progress ?? 1) >= EXPENSES_COMPLETE_STEP;
}

function isKvkkComplete(progress: RegisterWizardStepId | null | undefined): boolean {
  return (progress ?? 1) >= KVKK_COMPLETE_STEP;
}

function getTargetFillStep(progress: RegisterWizardStepId | null | undefined): RegisterWizardStepId {
  const p = progress ?? IDENTITY_STEP;
  if (p < IDENTITY_COMPLETE_STEP) {
    return IDENTITY_STEP;
  }
  if (p < PERSONAL_COMPLETE_STEP) {
    return PERSONAL_STEP;
  }
  if (p < CONTACT_COMPLETE_STEP) {
    return CONTACT_STEP;
  }
  if (p < OCCUPATION_COMPLETE_STEP) {
    return OCCUPATION_STEP;
  }
  if (p < TRAVEL_COMPLETE_STEP) {
    return TRAVEL_STEP;
  }
  if (p < ACCOMMODATION_COMPLETE_STEP) {
    return ACCOMMODATION_STEP;
  }
  if (p < EXPENSES_COMPLETE_STEP) {
    return EXPENSES_STEP;
  }
  if (p < KVKK_COMPLETE_STEP) {
    return KVKK_STEP;
  }
  return IMPLEMENTED_LAST_STEP;
}

function buildResult(
  state: Awaited<ReturnType<typeof detectRegisterWizardStep>>,
  extras: {
    kvkkScrollComplete?: boolean;
    emailVerificationComplete?: boolean;
    emailVerificationStepReached?: boolean;
    randevuNavVerified?: boolean;
  } = {},
): RegisterFormSetupResult {
  const progress = state?.progressStep ?? null;
  return {
    identityStepComplete: isIdentityComplete(progress),
    personalStepComplete: isPersonalComplete(progress),
    contactStepComplete: isContactComplete(progress),
    occupationStepComplete: isOccupationComplete(progress),
    travelStepComplete: isTravelComplete(progress),
    accommodationStepComplete: isAccommodationComplete(progress),
    expensesStepComplete: isExpensesComplete(progress),
    kvkkScrollComplete: extras.kvkkScrollComplete ?? isKvkkComplete(progress),
    kvkkStepComplete: isKvkkComplete(progress),
    emailVerificationComplete: extras.emailVerificationComplete ?? false,
    emailVerificationStepReached: extras.emailVerificationStepReached ?? false,
    randevuNavVerified: extras.randevuNavVerified ?? false,
    progressStep: progress,
    viewStep: state?.viewStep ?? null,
  };
}

/**
 * Kayıt formu wizard döngüsü — Adım 1–9 (Email Doğrulama dahil) otomatik + manuel OTP.
 */
export async function runRegisterFormSetup(
  page: Page,
  profile: ResolvedProfile,
  settings: AppSettings,
  options: RegisterFormSetupOptions = {},
): Promise<RegisterFormSetupResult> {
  const maxRounds = options.maxRounds ?? 20;
  const homeUrl = options.homeUrl ?? settings.visaPortalHomeUrl;
  const enableCodeRequest = resolveRegisterEnableCodeRequest({
    enableCodeRequest:
      options.enableCodeRequest ??
      (options.stopBeforeVerificationActions === undefined
        ? undefined
        : !options.stopBeforeVerificationActions),
  });
  const identity = resolveRegisterIdentity(profile, settings);
  const personal = resolveRegisterPersonal(profile, settings);
  const contact = resolveRegisterContact(profile, settings);
  const occupation = resolveRegisterOccupation(profile, settings);
  const travel = resolveRegisterTravel(profile, settings);
  const expenses = resolveRegisterExpenses(profile, settings);
  const kvkk = resolveRegisterKvkk(profile, settings);

  const validationErrors = [
    ...validateRegisterIdentity(identity, profile.id),
    ...validateRegisterPersonal(personal, profile.id),
    ...validateRegisterContact(contact, profile.id),
    ...validateRegisterOccupation(occupation, profile.id),
    ...validateRegisterTravel(travel, profile.id),
    ...validateRegisterExpenses(expenses, profile.id),
    ...validateRegisterKvkk(kvkk, profile.id),
  ];

  if (validationErrors.length > 0) {
    const message = validationErrors.join("\n");
    if (options.softValidate) {
      for (const err of validationErrors) {
        logger.warn(`[register] ${err}`);
      }
    } else {
      throw new Error(message);
    }
  } else {
    const maskedIdentity = maskRegisterIdentity(identity);
    const maskedPersonal = maskRegisterPersonal(personal);
    const maskedContact = maskRegisterContact(contact);
    logger.info(
      `[register] Profil ${profile.id} — ${maskedIdentity.firstName} ${maskedIdentity.lastName}; seyahat ${travel.travelType.value} → ${travel.destinationCountry.value}`,
    );
    logger.info(
      `[register] Pasaport ${maskedPersonal.passportNo}; ${maskedContact.email}; meslek ${occupation.job.value}`,
    );
  }

  await ensureRegisterFormOpen(page, homeUrl, settings.navigation);

  if (!enableCodeRequest) {
    logger.info(
      "[register] Adım 9 — yalnızca alan doğrulama (Kod Talep Et kapalı, kota koruması).",
    );
  }

  const stepFailures = createRegisterStepFailureTracker();

  for (let round = 1; round <= maxRounds; round++) {
    let state = await detectRegisterWizardStep(page);

    if (!state?.isOnRegisterWizard) {
      logger.warn(`[register] [tur ${round}/${maxRounds}] Wizard görünmüyor — form yeniden açılıyor.`);
      await ensureRegisterFormOpen(page, homeUrl, settings.navigation);
      state = await detectRegisterWizardStep(page);
    }

    if (!state?.isOnRegisterWizard) {
      continue;
    }

    logger.info(`[register] [tur ${round}/${maxRounds}] ${formatRegisterWizardLog(state)}`);

    if (await isRegisterFlowComplete(page)) {
      logger.info("[register] Kayıt formu tamamlandı — Randevu İşlemleri menüsü doğrulandı.");
      return buildResult(state, {
        emailVerificationComplete: true,
        randevuNavVerified: true,
      });
    }

    const progress = state.progressStep ?? IDENTITY_STEP;

    const targetStep = getTargetFillStep(progress);
    const activeStep = resolveActiveStep(state);

    if (state.isViewingPastStep) {
      logger.info(
        `[register] Geri atılma algılandı — hedef adım ${targetStep}, görünüm ${activeStep}.`,
      );
    }

    if (activeStep > targetStep) {
      logger.info(`[register] Adım ${targetStep} doldurulacak — görünüm ${activeStep}'ten dönülüyor.`);
      await navigateToRegisterWizardViewStep(page, targetStep);
      await page.waitForTimeout(600);
      state = await detectRegisterWizardStep(page);
    }

    try {
      if (targetStep === EMAIL_VERIFICATION_STEP && (await isEmailVerificationStepVisible(page))) {
        const step9 = await fillRegisterStep9EmailVerification(page, contact, settings.appointment, {
          enableCodeRequest,
        });
        stepFailures.clear(targetStep);
        if (step9.emailVerificationStepReached || step9.registerComplete) {
          return buildResult(await detectRegisterWizardStep(page), {
            emailVerificationStepReached: step9.emailVerificationStepReached ?? false,
            emailVerificationComplete: step9.registerComplete,
            randevuNavVerified: step9.randevuNavVerified,
          });
        }
        continue;
      }

      if (targetStep === KVKK_STEP && (await isKvkkStepVisible(page))) {
        await fillRegisterStep8Kvkk(page, kvkk, settings.appointment);
        stepFailures.clear(targetStep);
        continue;
      }

      if (targetStep === EXPENSES_STEP && (await isExpensesStepVisible(page))) {
        await fillRegisterStep7Expenses(page, expenses, settings.appointment);
        stepFailures.clear(targetStep);
        continue;
      }

      if (targetStep === ACCOMMODATION_STEP && (await isAccommodationStepVisible(page))) {
        await fillRegisterStep6Accommodation(page, settings.appointment);
        stepFailures.clear(targetStep);
        continue;
      }

      if (targetStep === TRAVEL_STEP && (await isTravelStepVisible(page))) {
        await fillRegisterStep5Travel(page, travel, settings.appointment);
        stepFailures.clear(targetStep);
        continue;
      }

      if (targetStep === OCCUPATION_STEP && (await isOccupationStepVisible(page))) {
        await fillRegisterStep4Occupation(page, occupation, settings.appointment);
        stepFailures.clear(targetStep);
        continue;
      }

      if (targetStep === CONTACT_STEP && (await isContactStepVisible(page))) {
        await fillRegisterStep3Contact(page, contact, settings.appointment);
        stepFailures.clear(targetStep);
        continue;
      }

      if (targetStep === PERSONAL_STEP && (await isPersonalStepVisible(page))) {
        await fillRegisterStep2Personal(page, personal, settings.appointment);
        stepFailures.clear(targetStep);
        continue;
      }

      if (targetStep === IDENTITY_STEP && (await isIdentityStepVisible(page))) {
        await fillRegisterStep1Identity(page, identity, settings.appointment, {
          profileId: profile.id,
        });
        stepFailures.clear(targetStep);
        continue;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempt = stepFailures.recordFailure(targetStep);
      logger.warn(`[register] Adım ${targetStep} hatası (toplam ${attempt}): ${message}`);

      const recovery = await recoverRegisterWizardStep(
        page,
        targetStep,
        attempt,
        homeUrl,
        settings.navigation,
      );

      if (recovery === "previous_step" || recovery === "refresh") {
        stepFailures.clear(targetStep);
      }

      continue;
    }

    logger.warn(
      `[register] Beklenmeyen durum (hedef=${targetStep}, active=${activeStep}, progress=${progress}) — tur tekrarlanıyor.`,
    );
  }

  return buildResult(await detectRegisterWizardStep(page));
}
