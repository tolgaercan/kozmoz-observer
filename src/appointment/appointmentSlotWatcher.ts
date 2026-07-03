import type { Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { TelegramNotifier } from "../notifications/telegramNotifier.js";
import { logger } from "../utils/logger.js";
import { buildMultiMonthSlotTextSummary } from "./calendarSlotScanner.js";
import { bumpCalendarMonthForwardBack } from "./calendarMonthNavigator.js";
import { scanAvailableCalendarMonths } from "./calendarMultiMonthScanner.js";
import { recoverCalendarPageAccess } from "./calendarPageRecovery.js";
import { withSlotCycleLock } from "./slotCycleLock.js";
import {
  detectWizardStep,
  navigateToWizardViewStep,
  WIZARD_OBSERVE_TARGET_STEP,
} from "./wizardStepDetector.js";
import {
  detectRecaptchaState,
  waitForRecaptchaSolution,
} from "./recaptchaGate.js";

export interface AppointmentSlotWatcherHandle {
  stop: () => void;
}

export interface AppointmentSlotWatcherOptions {
  city?: string;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

/**
 * Adım 3 — tek zamanlayıcılı döngü:
 * captcha çöz → (gerekirse ay ileri/geri) → tarama → bekle
 * Ayrı proaktif captcha timer yok — üst üste binme engellenir.
 */
export function startAppointmentSlotWatcher(
  page: Page,
  profile: ResolvedProfile,
  settings: AppSettings,
  options: AppointmentSlotWatcherOptions = {},
): AppointmentSlotWatcherHandle {
  const appointmentSettings = settings.appointment;
  const telegramSettings = settings.telegram;
  if (!appointmentSettings.slotWatchEnabled) {
    logger.info("Randevu günü gözlemi kapalı — SLOT_WATCH_ENABLED=false");
    return { stop: () => undefined };
  }

  const telegram = new TelegramNotifier({
    ...telegramSettings,
    notifyCooldownMs: appointmentSettings.slotNotifyCooldownMs,
  });

  let running = false;
  let lastKnownDates = new Set<string>();
  let firstScanDone = false;

  const intervalMs = appointmentSettings.slotWatchIntervalMs;
  logger.info(
    `Randevu günü gözlemi — tek döngü (${intervalMs}ms): captcha → ay ileri/geri tarama → bekle (+${appointmentSettings.slotMonthsAhead} ay).`,
  );

  const ensureOnCalendarView = async (): Promise<boolean> => {
    const state = await detectWizardStep(page, appointmentSettings.wizardNavLocator);
    const progress = state?.progressStep ?? 0;

    if (progress < WIZARD_OBSERVE_TARGET_STEP) {
      logger.warn(
        `[slot-cycle] Adım 3 değil (ilerleme=${progress}) — tarama atlandı, wizard guard kurtaracak.`,
      );
      return false;
    }

    if (state?.viewStep !== WIZARD_OBSERVE_TARGET_STEP) {
      logger.info(
        `[slot-cycle] Takvim görünümüne geçiliyor (görünüm=${state?.viewStep}, ilerleme=${progress}).`,
      );
      await navigateToWizardViewStep(
        page,
        WIZARD_OBSERVE_TARGET_STEP,
        appointmentSettings.wizardNavLocator,
      );
      await page.waitForTimeout(500);
    }

    return true;
  };

  const ensureCaptchaReady = async (): Promise<boolean> => {
    const state = await detectRecaptchaState(page);
    if (!state.present || state.solved) {
      if (state.solved && state.present) {
        logger.info(
          `[slot-cycle] Captcha hazır (${state.solvedVia}, token=${state.tokenLength}) — tarama başlıyor.`,
        );
      }
      return true;
    }

    logger.info("[slot-cycle] reCAPTCHA bekleniyor (eklenti)...");
    const solved = await waitForRecaptchaSolution(
      page,
      appointmentSettings.recaptchaWaitMs,
      appointmentSettings.recaptchaPollIntervalMs,
    );
    if (solved) {
      logger.info(
        `[slot-cycle] Captcha hazır (${(await detectRecaptchaState(page)).solvedVia}) — tarama başlıyor.`,
      );
      return true;
    }

    if (!appointmentSettings.captchaRecoveryEnabled) {
      return false;
    }

    logger.warn("[slot-cycle] reCAPTCHA süresi doldu — kurtarma devreye giriyor.");
    return recoverCalendarPageAccess(page, profile, settings);
  };

  const runCycle = async (): Promise<void> => {
    if (running) {
      logger.debug("[slot-cycle] Önceki döngü sürüyor — atlandı.");
      return;
    }

    await withSlotCycleLock(async () => {
      running = true;
      try {
        if (!(await ensureOnCalendarView())) {
          return;
        }

        const captchaBefore = await detectRecaptchaState(page);
        logger.info(
          `[slot-cycle] Captcha durumu: present=${captchaBefore.present} solved=${captchaBefore.solved} token=${captchaBefore.tokenLength} checkbox=${captchaBefore.checkboxChecked}`,
        );

        if (!(await ensureCaptchaReady())) {
          await telegram.notifyManualHelpRequired({
            profileId: profile.id,
            url: page.url(),
            reason: "reCAPTCHA çözülemedi — takvim taraması yapılamadı.",
          });
          return;
        }

        await page.waitForTimeout(appointmentSettings.captchaRecoveryStepWaitMs);

        logger.info("[slot-cycle] Ay ileri → geri (captcha sonrası)...");
        const bumped = await bumpCalendarMonthForwardBack(page, appointmentSettings);
        if (!bumped) {
          logger.warn("[slot-cycle] Ay oku tıklanamadı — tarama yine de denenecek.");
        }

        const scan = await scanAvailableCalendarMonths(page, appointmentSettings);
        if (!scan.calendarFound) {
          logger.warn("[slot-cycle] Takvim DOM bulunamadı.");
          return;
        }

        const currentDates = new Set(scan.availableDays.map((day) => day.isoDate));
        const textSummary = buildMultiMonthSlotTextSummary(
          scan.monthGroups,
          profile.id,
          options.city,
        );

        logger.info(`[slot-cycle]\n${textSummary}`);

        const hasNewSlots = [...currentDates].some((date) => !lastKnownDates.has(date));
        const slotsChanged = !setsEqual(currentDates, lastKnownDates);

        if (currentDates.size === 0) {
          if (appointmentSettings.slotNotifyOnEmpty && slotsChanged) {
            await telegram.notifyAvailableSlots({
              profileId: profile.id,
              city: options.city,
              textSummary,
              isEmpty: true,
            });
          }
        } else if (hasNewSlots || !firstScanDone || (appointmentSettings.slotNotifyOnChange && slotsChanged)) {
          const hasConfirmedTimes = scan.availableDays.some(
            (day) => day.times && day.times.length > 0,
          );
          await telegram.notifyAvailableSlots({
            profileId: profile.id,
            city: options.city,
            textSummary,
            dates: [...currentDates],
            isEmpty: false,
            hasConfirmedTimes,
          });
        }

        lastKnownDates = currentDates;
        firstScanDone = true;
        logger.info(
          `[slot-cycle] Döngü bitti — sonraki tarama ~${Math.round(intervalMs / 1000)}s sonra.`,
        );
      } catch (error) {
        logger.warn(
          `[slot-cycle] ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        running = false;
      }
    });
  };

  const scanTimer = setInterval(() => {
    void runCycle();
  }, intervalMs);

  void runCycle();

  return {
    stop: () => {
      clearInterval(scanTimer);
      logger.info("Randevu günü gözlemi durduruldu.");
    },
  };
}
