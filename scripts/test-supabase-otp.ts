/**
 * Supabase OTP bağlantı testi.
 *
 * 1) .env içinde SB_URL + SB_SERVICE_KEY tanımlayın
 * 2) npm run supabase:otp-test
 * 3) Opsiyonel: npm run supabase:otp-test -- 5551234567
 *    (telefon yoksa panel worker-config otpPhone kullanılır)
 */
import { resolve } from "node:path";

import { loadSettings } from "../src/config/settings.js";
import { WorkerConfigStore } from "../src/control-panel/workerConfigStore.js";
import {
  isSupabaseOtpConfigured,
  normalizePhoneLast10,
  peekSupabaseOtp,
  verifySupabaseOtpConnection,
} from "../src/integrations/supabaseOtp.js";

const projectRoot = resolve(import.meta.dirname, "..");
const settings = loadSettings(projectRoot);

function readPanelOtpPhone(profileId: string): string | undefined {
  const store = new WorkerConfigStore(projectRoot);
  const worker = store.getWorker(profileId, "");
  const phone = worker.api?.otpPhone?.trim();
  return phone || undefined;
}

if (!isSupabaseOtpConfigured()) {
  console.error(
    "SB_URL ve SB_SERVICE_KEY .env dosyasında tanımlı değil.\n" +
      "Supabase → Project Settings → API → service_role key",
  );
  process.exit(1);
}

const connection = await verifySupabaseOtpConnection();
console.log(connection.ok ? "✓" : "✗", connection.message);
if (!connection.ok) {
  process.exit(1);
}

const profileId = settings.defaultProfileId?.trim() || "profile-1";
const phoneArg = process.argv[2]?.trim() || readPanelOtpPhone(profileId);
if (!phoneArg) {
  console.log(
    "Telefon verilmedi — yalnızca bağlantı testi yapıldı.\n" +
      "Aktif OTP için: npm run supabase:otp-test -- 5XXXXXXXXX\n" +
      "veya panelde Worker ayarları → OTP telefonu kaydedin.",
  );
  process.exit(0);
}

const last10 = normalizePhoneLast10(phoneArg);
console.log(`\nPeek: otp_by_phone (***${last10.slice(-4)})`);

try {
  const otp = await peekSupabaseOtp(phoneArg, { consume: false });
  if (otp) {
    console.log(`  otp: ${otp.replace(/./g, "*")} (${otp.length} hane)`);
  } else {
    console.log("  Aktif OTP yok (used=false, expires_at > now koşuluyla).");
  }
} catch (error) {
  console.error("Peek hatası:", error instanceof Error ? error.message : error);
  process.exit(1);
}
