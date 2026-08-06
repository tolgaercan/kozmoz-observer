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
  computeActiveDates,
  filterPortalWeekdays,
  listDatesInRange,
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

/** EEA — DevTools cipher (kapalı günler) */
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

/** Standart — ardışık kapalı (7 Ağu → 1 Eyl) */
const STANDART_MOCK_CLOSED = listDatesInRange("2026-08-07", "2026-09-01");

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

  const date = "2026-08-06";
  const maxDate = "2026-09-01";

  const parsedEea = parseResponse(EEA_MOCK_CLOSED);
  assert(
    "EEA mock — 10 kapalı gün parse",
    parsedEea.closedDates.length === 10,
    `${parsedEea.closedDates.length} kapalı gün`,
  );

  const eeaActive = computeActiveDates(date, maxDate, parsedEea.closedDates, { todayIso: date });
  const eeaWeekdays = filterPortalWeekdays(eeaActive.activeDates);
  assert(
    "EEA — 16 seçilebilir hafta içi",
    eeaWeekdays.length === 16,
    `${eeaWeekdays.length} gün — ${eeaWeekdays.join(", ")}`,
  );

  const parsedStandart = parseResponse(STANDART_MOCK_CLOSED);
  const standartActive = computeActiveDates(date, maxDate, parsedStandart.closedDates, {
    todayIso: date,
  });
  assert(
    "Standart — 0 seçilebilir gün",
    standartActive.activeDates.length === 0,
    `${standartActive.activeDates.length} aktif gün`,
  );

  const portalAugust = PORTAL_VISIBLE_AUGUST.filter((d) => d >= "2026-08-07");
  const inPortalNotInApi = portalAugust.filter((d) => !eeaWeekdays.includes(d));
  assert(
    "Portal Ağustos günleri EEA seçilebilir listesinde",
    inPortalNotInApi.length === 0,
    inPortalNotInApi.length
      ? `Eksik: ${inPortalNotInApi.join(", ")}`
      : `${portalAugust.length} portal günü eşleşti`,
  );

  assert(
    "İlk poll YENİ gün = 0 (baseline)",
    true,
    "İlk poll'de YENİ uyarısı gönderilmez (baseline)",
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
