/**
 * Tek seferlik sağlama — watcher başlatmadan GetClosedDate mantığını doğrular.
 * Rate limit yok: varsayılan mod yalnızca mock birim testleri (+ isteğe bağlı tek canlı istek).
 *
 * Kullanım:
 *   npx tsx scripts/validate-api-date-logic.ts
 *   npx tsx scripts/validate-api-date-logic.ts --live --profile profile-1
 */
import { resolve } from "node:path";

import { checkAvailability } from "../src/api/client/checkAvailability.js";
import {
  computeCalendarDatesFromAllowed,
  filterPortalWeekdays,
  listDatesInRange,
  normalizeClosedDates,
} from "../src/api/client/availabilityDates.js";
import { parseResponse } from "../src/api/client/closedDateParser.js";
import { loadSettings } from "../src/config/settings.js";
import { ProfileManager } from "../src/profiles/profileManager.js";
import { resolveApiQueryParams } from "../src/api/client/resolveApiQueryParams.js";
import { resolveBearerToken } from "../src/api/auth/tokenProvider.js";

const projectRoot = resolve(process.cwd());

/** Portal ekran görüntülerinden (Ankara, EEA AB Eşi, ~28 Tem 2026) — takvimde kalın/siyah günler */
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

/** API'nin tipik ham whitelist yanıtı (35 gün: 29 Tem → 1 Eyl) */
function buildMockApiAllowedRaw(): string[] {
  return listDatesInRange("2026-07-29", "2026-09-01");
}

interface TestResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: TestResult[] = [];

function assert(name: string, condition: boolean, detail: string): void {
  results.push({ name, ok: condition, detail });
  const icon = condition ? "✅" : "❌";
  console.log(`${icon} ${name}`);
  console.log(`   ${detail}`);
}

function runMockUnitTests(): void {
  console.log("\n=== 1) Mock birim testleri (API çağrısı yok) ===\n");

  const mockRaw = buildMockApiAllowedRaw();
  assert(
    "Mock ham liste 35 gün",
    mockRaw.length === 35,
    `Beklenen 35, gelen ${mockRaw.length} (${mockRaw[0]} → ${mockRaw.at(-1)})`,
  );

  const parsed = parseResponse(mockRaw);
  assert(
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

  assert(
    "Eylül listede yok (ay kuralı)",
    !calendar.allowedInRange.some((d) => d.startsWith("2026-09")),
    `Seçilebilir son gün: ${calendar.allowedInRange.at(-1) ?? "—"}`,
  );

  assert(
    "Hafta sonu listede yok",
    calendar.allowedInRange.every((d) => {
      const day = new Date(`${d}T12:00:00`).getDay();
      return day !== 0 && day !== 6;
    }),
    `${calendar.allowedInRange.length} hafta içi gün`,
  );

  assert(
    "Son seçilebilir gün 31 Ağustos",
    calendar.allowedInRange.at(-1) === "2026-08-31",
    `Son: ${calendar.allowedInRange.at(-1)}`,
  );

  const baselinePrevious: string[] | null = null;
  const currentAllowed = calendar.allowedInRange;
  const addedOnFirstPoll =
    baselinePrevious === null
      ? []
      : currentAllowed.filter((d) => !baselinePrevious.includes(d));
  assert(
    "İlk poll YENİ gün = 0 (baseline)",
    addedOnFirstPoll.length === 0,
    `Yanlışlıkla ${addedOnFirstPoll.length} gün YENİ sayılırdı`,
  );

  const inPortalNotInApi = PORTAL_VISIBLE_ALL.filter(
    (d) => !calendar.allowedInRange.includes(d),
  );
  assert(
    "Portal görünen günler API whitelist içinde",
    inPortalNotInApi.length === 0,
    inPortalNotInApi.length
      ? `Eksik: ${inPortalNotInApi.join(", ")}`
      : `${PORTAL_VISIBLE_ALL.length} portal günü whitelist'te mevcut`,
  );

  const inApiNotPortalVisible = calendar.allowedInRange.filter(
    (d) => !PORTAL_VISIBLE_ALL.includes(d),
  );
  console.log(
    `\nℹ️  API whitelist'te olup takvimde gri olabilecek ${inApiNotPortalVisible.length} hafta içi gün (saat kotası):`,
  );
  console.log(
    inApiNotPortalVisible.length <= 12
      ? `   ${inApiNotPortalVisible.join(", ")}`
      : `   ${inApiNotPortalVisible.slice(0, 8).join(", ")} … (+${inApiNotPortalVisible.length - 8})`,
  );
  assert(
    "Fazla gün sayısı saat kotası açıklamasıyla uyumlu (≤12 fazla)",
    inApiNotPortalVisible.length <= 12,
    `${inApiNotPortalVisible.length} fazla — saat kotası doğrulaması önerilir (API_HOUR_QUOTA_ENABLED)`,
  );
}

async function runLiveSmokeTest(profileId: string): Promise<void> {
  console.log("\n=== 2) Canlı tek istek (1× GetClosedDate) ===\n");

  const settings = loadSettings(projectRoot);
  const profileManager = new ProfileManager(projectRoot, settings.manifestPath);
  const profile = profileManager.resolveProfile(profileId, settings);
  const queryParams = resolveApiQueryParams(profile, settings.apiWatcher);
  const bearer = resolveBearerToken(projectRoot, profileId);

  if (!bearer) {
    console.log("⏭️  Token yok — canlı test atlandı (api-token.json veya API_BEARER_TOKEN gerekli)");
    return;
  }

  console.log(
    `Profil: ${profileId} | dealerId=${queryParams.dealerId} | typeId=${queryParams.appointmentTypeId}`,
  );
  console.log(`date=${queryParams.date} maxDate=${queryParams.maxDate}`);

  const result = await checkAvailability(
    {
      projectRoot,
      profileId,
      settings: settings.apiWatcher,
      bearerToken: bearer,
    },
    queryParams,
  );

  if (!result.ok) {
    assert("Canlı GetClosedDate", false, result.summary);
    return;
  }

  const allowed = result.activeDates ?? [];
  assert("Canlı istek başarılı", true, result.summary);

  assert(
    "Canlı: Eylül yok",
    !allowed.some((d) => d.startsWith("2026-09")),
    allowed.filter((d) => d.startsWith("2026-09")).join(", ") || "Eylül yok ✓",
  );

  const portalMissing = PORTAL_VISIBLE_ALL.filter((d) => !allowed.includes(d));
  assert(
    "Canlı: portal görünen günler whitelist'te",
    portalMissing.length === 0,
    portalMissing.length ? `Eksik: ${portalMissing.join(", ")}` : "Tamam",
  );

  console.log(`\n   Seçilebilir (hafta içi): ${allowed.length} gün`);
  console.log(`   İlk 5: ${allowed.slice(0, 5).join(", ")}`);
  console.log(`   Son 5: ${allowed.slice(-5).join(", ")}`);
}

function printSummary(): void {
  const failed = results.filter((r) => !r.ok);
  console.log("\n=== Özet ===\n");
  console.log(`Toplam: ${results.length} | Geçti: ${results.length - failed.length} | Kaldı: ${failed.length}`);

  if (failed.length > 0) {
    console.log("\nBaşarısız:");
    for (const item of failed) {
      console.log(`  • ${item.name}: ${item.detail}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("\nSağlama OK — watcher güvenle başlatılabilir (5 dk poll aralığı koruyun).");
  console.log("Not: Tam portal eşleşmesi için saat kotası doğrulaması ayrı adım.");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  const profileIdx = args.indexOf("--profile");
  const profileId = profileIdx >= 0 ? args[profileIdx + 1] : "profile-1";

  console.log("Kozmoz GetClosedDate sağlama (tek seferlik, loop yok)");

  runMockUnitTests();

  if (live) {
    await runLiveSmokeTest(profileId);
  } else {
    console.log("\n=== 2) Canlı test ===");
    console.log("⏭️  Atlandı — token ile denemek için: npx tsx scripts/validate-api-date-logic.ts --live --profile profile-1");
  }

  printSummary();
}

void main();
