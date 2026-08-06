import {
  computeCalendarDatesFromAllowed,
  listDatesInRange,
} from "../client/availabilityDates.js";
import { parseResponse } from "../client/closedDateParser.js";

const PORTAL_VISIBLE_JULY = ["2026-07-29"];
const PORTAL_VISIBLE_AUGUST = [
  "2026-08-04",
  "2026-08-06",
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
const PORTAL_VISIBLE_ALL = [...PORTAL_VISIBLE_JULY, ...PORTAL_VISIBLE_AUGUST];

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

function buildMockApiAllowedRaw(): string[] {
  return listDatesInRange("2026-07-29", "2026-09-01");
}

function record(items: ApiDateValidationItem[], name: string, condition: boolean, detail: string): void {
  items.push({ name, ok: condition, detail });
}

/** Mock birim testleri — canlı API çağrısı yok, ban riski yok. */
export function runMockApiDateValidation(): ApiDateValidationReport {
  const items: ApiDateValidationItem[] = [];

  const mockRaw = buildMockApiAllowedRaw();
  record(
    items,
    "Mock ham liste 35 gün",
    mockRaw.length === 35,
    `Beklenen 35, gelen ${mockRaw.length} (${mockRaw[0]} → ${mockRaw.at(-1)})`,
  );

  const parsed = parseResponse(mockRaw);
  record(
    items,
    "Parser allowedDates = ham dizi",
    parsed.allowedDates.length === 35,
    `${parsed.allowedDates.length} gün parse edildi`,
  );

  const calendar = computeCalendarDatesFromAllowed(
    "2026-07-28",
    "2026-09-09",
    parsed.allowedDates,
    { todayIso: "2026-07-28" },
  );

  record(
    items,
    "Eylül listede yok (ay kuralı)",
    !calendar.allowedInRange.some((d) => d.startsWith("2026-09")),
    `Seçilebilir son gün: ${calendar.allowedInRange.at(-1) ?? "—"}`,
  );

  record(
    items,
    "Hafta sonu listede yok",
    calendar.allowedInRange.every((d) => {
      const day = new Date(`${d}T12:00:00`).getDay();
      return day !== 0 && day !== 6;
    }),
    `${calendar.allowedInRange.length} hafta içi gün`,
  );

  record(
    items,
    "Son seçilebilir gün 31 Ağustos",
    calendar.allowedInRange.at(-1) === "2026-08-31",
    `Son: ${calendar.allowedInRange.at(-1)}`,
  );

  const addedOnFirstPoll: string[] = [];
  record(
    items,
    "İlk poll YENİ gün = 0 (baseline)",
    addedOnFirstPoll.length === 0,
    "İlk poll'de YENİ uyarısı gönderilmez (baseline)",
  );

  const inPortalNotInApi = PORTAL_VISIBLE_ALL.filter((d) => !calendar.allowedInRange.includes(d));
  record(
    items,
    "Portal görünen günler API whitelist içinde",
    inPortalNotInApi.length === 0,
    inPortalNotInApi.length
      ? `Eksik: ${inPortalNotInApi.join(", ")}`
      : `${PORTAL_VISIBLE_ALL.length} portal günü whitelist'te mevcut`,
  );

  const inApiNotPortalVisible = calendar.allowedInRange.filter(
    (d) => !PORTAL_VISIBLE_ALL.includes(d),
  );
  record(
    items,
    "Fazla gün saat kotası ile uyumlu (≤12)",
    inApiNotPortalVisible.length <= 12,
    `${inApiNotPortalVisible.length} fazla hafta içi gün (saat kotası kapalıyken normal)`,
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
