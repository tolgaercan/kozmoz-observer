import {
  computeActiveDates,
  filterPortalWeekdays,
  listDatesInRange,
} from "../client/availabilityDates.js";
import { parseResponse } from "../client/closedDateParser.js";

/** EEA AB Eşi — DevTools cipher (10 kapalı gün, hafta sonu blokları) */
const EEA_MOCK_CLOSED = [
  "2026-08-07",
  "2026-08-08",
  "2026-08-09",
  "2026-08-15",
  "2026-08-16",
  "2026-08-22",
  "2026-08-23",
  "2026-08-29",
  "2026-08-30",
  "2026-09-01",
];

/** Standart — DevTools cipher (7 Ağu → 1 Eyl ardışık kapalı) */
const STANDART_MOCK_CLOSED = listDatesInRange("2026-08-07", "2026-09-01");

const PORTAL_VISIBLE_AUGUST = [
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-17",
  "2026-08-18",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
  "2026-08-24",
  "2026-08-25",
  "2026-08-26",
  "2026-08-27",
  "2026-08-28",
  "2026-08-31",
];

export interface ApiDateValidationItem {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ApiDateValidationReport {
  passed: number;
  failed: number;
  total: number;
  ok: boolean;
  summary: string;
  items: ApiDateValidationItem[];
}

function record(items: ApiDateValidationItem[], name: string, condition: boolean, detail: string): void {
  items.push({ name, ok: condition, detail });
}

/** Mock birim testleri — canlı API çağrısı yok, ban riski yok. */
export function runMockApiDateValidation(): ApiDateValidationReport {
  const items: ApiDateValidationItem[] = [];
  const date = "2026-08-06";
  const maxDate = "2026-09-01";

  const parsedEea = parseResponse(EEA_MOCK_CLOSED);
  record(
    items,
    "Parser closedDates = ham dizi (EEA mock)",
    parsedEea.closedDates.length === 10,
    `${parsedEea.closedDates.length} kapalı gün parse edildi`,
  );

  const eeaActive = computeActiveDates(date, maxDate, parsedEea.closedDates, { todayIso: date });
  const eeaWeekdays = filterPortalWeekdays(eeaActive.activeDates);

  record(
    items,
    "EEA — 16 seçilebilir hafta içi gün",
    eeaWeekdays.length === 16,
    `Gelen: ${eeaWeekdays.length} — ${eeaWeekdays.join(", ")}`,
  );

  const parsedStandart = parseResponse(STANDART_MOCK_CLOSED);
  const standartActive = computeActiveDates(date, maxDate, parsedStandart.closedDates, {
    todayIso: date,
  });
  record(
    items,
    "Standart — 0 seçilebilir gün (tüm pencere kapalı)",
    standartActive.activeDates.length === 0,
    `${standartActive.activeDates.length} aktif gün`,
  );

  const inPortalNotInApi = PORTAL_VISIBLE_AUGUST.filter((d) => !eeaWeekdays.includes(d));
  record(
    items,
    "Portal Ağustos günleri EEA seçilebilir listesinde",
    inPortalNotInApi.length === 0,
    inPortalNotInApi.length
      ? `Eksik: ${inPortalNotInApi.join(", ")}`
      : `${PORTAL_VISIBLE_AUGUST.length} portal günü eşleşti`,
  );

  const addedOnFirstPoll: string[] = [];
  record(
    items,
    "İlk poll YENİ gün = 0 (baseline)",
    addedOnFirstPoll.length === 0,
    "İlk poll'de YENİ uyarısı gönderilmez (baseline)",
  );

  const failed = items.filter((item) => !item.ok).length;
  const passed = items.length - failed;

  return {
    passed,
    failed,
    total: items.length,
    ok: failed === 0,
    summary:
      failed === 0
        ? "Sağlama OK — watcher güvenle başlatılabilir (5 dk poll aralığı koruyun)."
        : `${failed} test başarısız — watcher başlatmadan önce düzeltin.`,
    items,
  };
}
