import { parseResponse } from "../src/api/client/closedDateParser.js";
import {
  computeActiveDates,
  filterPortalWeekdays,
} from "../src/api/client/availabilityDates.js";

const cipher = process.argv[2];
if (!cipher) {
  console.error("Usage: npx tsx scripts/decrypt-cipher-sample.ts <cipher>");
  process.exit(1);
}

const parsed = parseResponse(cipher);
const date = "2026-08-06";
const maxDate = "2026-09-01";

console.log("=== HAM API (decrypt) — kapalı günler ===");
console.log("summary:", parsed.summary);
console.log("ham closedDates count:", parsed.closedDates.length);
console.log("first 5:", parsed.closedDates.slice(0, 5).join(", "));
console.log("last 5:", parsed.closedDates.slice(-5).join(", "));
console.log("all dates:", parsed.closedDates.join(", "));

const active = computeActiveDates(date, maxDate, parsed.closedDates, { todayIso: date });
const activeWeekdays = filterPortalWeekdays(active.activeDates);

console.log(`\n=== maxDate=${maxDate} ===`);
console.log(`bookable: ${active.bookableStart} -> ${active.bookableEnd}`);
console.log(`seçilebilir (hafta içi): ${activeWeekdays.length}`);
console.log("dates:", activeWeekdays.join(", ") || "(bos)");
