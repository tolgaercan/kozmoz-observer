import type { Page } from "playwright";

import type { AppointmentSettings } from "../../config/settings.js";
import {
  clickCalendarDay,
  clickHourButtonByLabel,
  readTimeSlotsForSelectedDay,
} from "../../portal/calendar/calendarDayActions.js";
import {
  readSelectedCalendarDayIso,
  waitForCalendarContainer,
} from "../../portal/calendar/calendarDom.js";
import { ensureDayVisible, scrollCalendarIntoView } from "../../portal/calendar/calendarMonthNav.js";
import { logger } from "../../utils/logger.js";
import type { VerifiedSlot } from "./bookingTypes.js";

export interface Step3SelectResult {
  ok: boolean;
  reason?: string;
  selectedHourLabel?: string;
}

export interface Step3SelectOptions {
  hourPanelTimeoutMs?: number;
}

/**
 * Step 3 (Takvim) — API ile doğrulanmış gün+saati UI'da seçer.
 * Sonraki (Step 4) bu modülde değil; campaign `advanceToSummaryStep` çağırır.
 */
export async function selectVerifiedSlotInCalendar(
  page: Page,
  verifiedSlot: VerifiedSlot,
  settings: AppointmentSettings,
  options?: Step3SelectOptions,
): Promise<Step3SelectResult> {
  const hourPanelTimeoutMs = options?.hourPanelTimeoutMs ?? settings.slotHourPanelTimeoutMs;
  const { date: isoDate, hourLabel } = verifiedSlot;

  logger.info(`[booking] Step 3 UI seçim: ${isoDate} ${hourLabel}`);

  const calendarReady = await waitForCalendarContainer(
    page,
    settings.slotCalendarLocator,
    settings.citySelectTimeoutMs || 15_000,
  );
  if (!calendarReady) {
    return { ok: false, reason: "Takvim görünür değil (.dp__calendar)" };
  }

  await scrollCalendarIntoView(page);

  const dayVisible = await ensureDayVisible(page, isoDate, settings);
  if (!dayVisible) {
    return { ok: false, reason: `Takvimde gün tıklanabilir değil: ${isoDate}` };
  }

  try {
    let panelState: Awaited<ReturnType<typeof clickCalendarDay>> = "timeout";
    for (let clickAttempt = 1; clickAttempt <= 2; clickAttempt++) {
      panelState = await clickCalendarDay(page, isoDate, settings, {
        hourPanelTimeoutMs,
      });

      const selectedDay = await readSelectedCalendarDayIso(page);
      if (selectedDay && selectedDay !== isoDate) {
        logger.warn(
          `[booking] Takvim gün uyumsuz: beklenen ${isoDate}, seçili ${selectedDay}` +
            (clickAttempt < 2 ? " — yeniden tıklanacak" : ""),
        );
        if (clickAttempt < 2) {
          await ensureDayVisible(page, isoDate, settings);
          continue;
        }
        return {
          ok: false,
          reason: `Yanlış gün seçildi: beklenen ${isoDate}, takvimde ${selectedDay}`,
        };
      }

      if (panelState !== "timeout") {
        break;
      }
      if (clickAttempt < 2) {
        logger.warn(`[booking] Saat paneli açılmadı (${isoDate}) — gün tıklaması tekrarlanacak`);
        await ensureDayVisible(page, isoDate, settings);
      }
    }

    if (panelState === "timeout") {
      return {
        ok: false,
        reason: `Saat alanı açılmadı (${hourPanelTimeoutMs}ms) — .appointment-hours-container`,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `Gün tıklanamadı (${isoDate}): ${message}` };
  }

  const slotCheck = await readTimeSlotsForSelectedDay(page, isoDate, settings);
  if (slotCheck.isEmpty) {
    return {
      ok: false,
      reason: `Gün tıklandı ama saat yok — ${slotCheck.emptyMessage ?? "boş"}`,
    };
  }
  if (!slotCheck.hasRealSlots) {
    return {
      ok: false,
      reason: `Saat alanı belirsiz (${isoDate}) — buton bulunamadı`,
    };
  }

  try {
    const selectedHourLabel = await clickHourButtonByLabel(page, hourLabel, settings);
    return { ok: true, selectedHourLabel };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const available = slotCheck.times.join(", ");
    return {
      ok: false,
      reason: `${message} (UI saatler: ${available || "—"})`,
    };
  }
}
