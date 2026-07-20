import type { Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import type { ResolvedProfile } from "../profiles/profileManager.js";
import { TelegramNotifier } from "../notifications/telegramNotifier.js";
import { logger } from "../utils/logger.js";
import { buildMultiMonthSlotTextSummary } from "./calendarSlotScanner.js";
import { scanAvailableCalendarMonths } from "./calendarMultiMonthScanner.js";
import { withSlotCycleLock } from "./slotCycleLock.js";
import {
  ensureStableRecaptchaOrEscape,
  isCaptchaLockEngaged,
} from "./captchaSession.js";
import {
  detectWizardStep,
  formatWizardStepLog,
  isCalendarStepVisible,
  navigateToWizardViewStep,
  WIZARD_OBSERVE_TARGET_STEP,
} from "./wizardStepDetector.js";
import { detectRecaptchaState } from "./recaptchaGate.js";

export interface AppointmentSlotWatcherHandle {
  stop: () => void;
}

export interface AppointmentSlotWatcherOptions {
  city?: string;
}

/**
 * Adım 4 (takvim) — tek zamanlayıcılı döngü:
 * captcha çöz → (gerekirse ay ileri/geri) → tarama → bekle
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

  const telegram = new TelegramNotifier(telegramSettings);

  let running = false;
  let lastKnownDates = new Set<string>();
  let lastEmptyNotifyAt = 0;
  let lastSlotsNotifyAt = 0;
  let lastManualCaptchaNotifyAt = 0;

  const intervalMs = appointmentSettings.slotWatchIntervalMs;
  const emptyNotifyMs = appointmentSettings.slotNotifyEmptyCooldownMs;
  const slotsNotifyMs = appointmentSettings.slotNotifySlotsCooldownMs;
  const manualNotifyMs = Math.max(emptyNotifyMs, slotsNotifyMs);
  logger.info(
    `Randevu günü gözlemi — tek döngü (${intervalMs}ms): captcha → çoklu ay tarama (+${appointmentSettings.slotMonthsAhead}) → Telegram.`,
  );

  const datesEqual = (a: Set<string>, b: Set<string>): boolean => {
    if (a.size !== b.size) {
      return false;
    }
    return [...a].every((date) => b.has(date));
  };

  const ensureOnCalendarView = async (): Promise<boolean> => {
    const state = await detectWizardStep(page, appointmentSettings.wizardNavLocator);
    const progress = state?.progressStep ?? 0;
    const calendarVisible = await isCalendarStepVisible(
      page,
      appointmentSettings.slotCalendarLocator,
    );

    if (!calendarVisible && progress < WIZARD_OBSERVE_TARGET_STEP) {
      logger.info(
        `[slot-cycle] Takvim adımı değil (görünüm=${state?.viewStep ?? "?"}, ilerleme=${progress}) — tarama atlandı.`,
      );
      return false;
    }

    if (!calendarVisible) {
      logger.info(
        `[slot-cycle] İlerleme=${progress} ama takvim DOM yok — tarama atlandı (henüz Sonraki ile geçilmedi?).`,
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
        return ensureStableRecaptchaOrEscape(page, appointmentSettings);
      }
      return true;
    }

    logger.info("[slot-cycle] reCAPTCHA bekleniyor (eklenti + captcha-lock)...");
    return ensureStableRecaptchaOrEscape(page, appointmentSettings);
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
          if (Date.now() - lastManualCaptchaNotifyAt >= manualNotifyMs) {
            lastManualCaptchaNotifyAt = Date.now();
            await telegram.notifyManualHelpRequired({
              profileId: profile.id,
              url: page.url(),
              reason: "reCAPTCHA çözülemedi — takvim taraması yapılamadı.",
            });
          }
          return;
        }

        if (isCaptchaLockEngaged()) {
          logger.warn("[slot-cycle] Captcha kilidi hâlâ aktif — tarama atlandı.");
          return;
        }

        await page.waitForTimeout(appointmentSettings.captchaRecoveryStepWaitMs);

        logger.info(
          `[slot-cycle] Çoklu ay taraması (baz + ${appointmentSettings.slotMonthsAhead} ileri)...`,
        );
        if (isCaptchaLockEngaged()) {
          logger.warn("[slot-cycle] Captcha kilidi aktif — tarama atlandı.");
          return;
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
        const sameAsPrevious =
          lastKnownDates.size > 0 && datesEqual(currentDates, lastKnownDates);
        const now = Date.now();

        if (currentDates.size === 0) {
          if (
            appointmentSettings.slotNotifyOnEmpty &&
            now - lastEmptyNotifyAt >= emptyNotifyMs
          ) {
            await telegram.notifyAvailableSlots({
              profileId: profile.id,
              city: options.city,
              textSummary,
              isEmpty: true,
              periodicReport: true,
            });
            lastEmptyNotifyAt = now;
            logger.info("[slot-cycle] Müsait gün yok — periyodik Telegram gönderildi.");
          }
        } else if (now - lastSlotsNotifyAt >= slotsNotifyMs) {
          const hasConfirmedTimes = scan.availableDays.some(
            (day) => day.times && day.times.length > 0,
          );
          await telegram.notifyAvailableSlots({
            profileId: profile.id,
            city: options.city,
            textSummary,
            dates: [...currentDates].sort(),
            isEmpty: false,
            hasConfirmedTimes,
            periodicReport: true,
          });
          lastSlotsNotifyAt = now;
          if (hasNewSlots) {
            logger.info("[slot-cycle] Yeni müsait gün — Telegram gönderildi.");
          } else if (sameAsPrevious) {
            logger.info(
              "[slot-cycle] Aynı müsait günler — tüm aylar toplu Telegram (periyodik).",
            );
          } else {
            logger.info("[slot-cycle] Müsait gün listesi güncellendi — Telegram gönderildi.");
          }
        }

        lastKnownDates = currentDates;
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
