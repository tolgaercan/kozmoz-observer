/**
 * GetClosedDate — Standart (16) vs EEA AB Eşi (2339) karşılaştırması.
 * Kullanım: npx tsx scripts/compare-appointment-types.ts [--profile profile-1]
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { fileURLToPath } from "node:url";

import { parseResponse } from "../src/api/client/closedDateParser.js";
import { normalizeClosedDates } from "../src/api/client/availabilityDates.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const profileId = process.argv.includes("--profile")
  ? process.argv[process.argv.indexOf("--profile") + 1] ?? "profile-1"
  : "profile-1";

function loadBearerToken(): string {
  const storagePath = resolve(projectRoot, `data/sessions/${profileId}/storage.json`);
  if (!existsSync(storagePath)) {
    throw new Error(`storage.json yok: ${storagePath}`);
  }
  const storage = JSON.parse(readFileSync(storagePath, "utf-8")) as Record<string, string>;
  const jwtKey = Object.keys(storage).find((k) => storage[k]?.startsWith("eyJ"));
  if (!jwtKey) {
    throw new Error("JWT bulunamadı — portal oturumu gerekli");
  }
  return storage[jwtKey]!;
}

async function fetchClosedDates(appointmentTypeId: string, bearer: string): Promise<{
  typeId: string;
  status: number;
  count: number;
  dates: string[];
  cipherPrefix: string;
}> {
  const date = "2026-08-06";
  const maxDate = "2026-09-18";
  const url =
    `https://api.kosmosvize.com.tr/api/AppointmentClosedDates/GetClosedDate` +
    `?dealerId=1014&date=${date}&maxDate=${maxDate}&appointmentTypeId=${appointmentTypeId}&_=${Date.now()}`;

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${bearer}`,
      Referer: "https://basvuru.kosmosvize.com.tr/appointmentForm",
      Accept: "application/json, text/plain, */*",
    },
  });

  const bodyText = await response.text();
  let raw: unknown = bodyText;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    // düz metin / şifreli
  }

  const parsed = parseResponse(raw, bearer);
  const dates = normalizeClosedDates(parsed.allowedDates);

  return {
    typeId: appointmentTypeId,
    status: response.status,
    count: dates.length,
    dates,
    cipherPrefix: bodyText.slice(0, 48),
  };
}

function datesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((d) => setB.has(d));
}

async function main(): Promise<void> {
  const bearer = loadBearerToken();
  console.log(`Profil: ${profileId}`);
  console.log("─".repeat(60));

  const standart = await fetchClosedDates("16", bearer);
  const eea = await fetchClosedDates("2339", bearer);

  console.log(`Standart (16):     HTTP ${standart.status} → ${standart.count} gün`);
  console.log(`EEA AB Eşi (2339): HTTP ${eea.status} → ${eea.count} gün`);
  console.log(`Ham yanıt aynı mı (prefix): ${standart.cipherPrefix === eea.cipherPrefix ? "EVET ⚠️" : "HAYIR"}`);
  console.log(`Tarih listesi aynı mı: ${datesEqual(standart.dates, eea.dates) ? "EVET ⚠️" : "HAYIR"}`);

  if (standart.count > 0) {
    console.log("\nStandart ilk 5:", standart.dates.slice(0, 5).join(", "));
  }
  if (eea.count > 0 && !datesEqual(standart.dates, eea.dates)) {
    console.log("EEA ilk 5:", eea.dates.slice(0, 5).join(", "));
  }

  console.log("\n─".repeat(60));
  if (datesEqual(standart.dates, eea.dates) && standart.count === eea.count) {
    console.log(
      "SONUÇ: API her iki appointmentTypeId için AYNI listeyi döndürüyor.\n" +
        "       Bu kod/cache hatası değil — GetClosedDate dealer bazlı whitelist olabilir.\n" +
        "       Portal Standart boş gösteriyorsa saat kotası / wizard filtresi devreye girer.",
    );
  } else {
    console.log("SONUÇ: Tip ID'leri farklı yanıt üretiyor — watcher doğru tip ile sorguluyor olmalı.");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && "cause" in error ? String(error.cause) : "";
  console.error(message, cause ? `\nCause: ${cause}` : "");
  process.exit(1);
});
