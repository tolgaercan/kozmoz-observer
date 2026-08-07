/**
 * Botun gorebildigi son sohbetlerin chat_id listesi.
 * 1) Botu hedef gruba ekleyin (ornegin AsVize bot — https://t.me/+2w9thGrrjuwwZjU8)
 * 2) Grupta bir mesaj yazin
 * 3) npm run telegram:discover-chats
 */
import { resolve } from "node:path";
import https from "node:https";

import { loadSettings } from "../src/config/settings.js";

const projectRoot = resolve(import.meta.dirname, "..");
const settings = loadSettings(projectRoot);
const token = settings.telegram.botToken?.trim();

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN .env dosyasinda tanimli degil.");
  process.exit(1);
}

const url = `https://api.telegram.org/bot${token}/getUpdates?limit=50`;

function fetchTelegram(apiUrl: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const parsed = new URL(apiUrl);
    const request = https.request(
      {
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        agent: new https.Agent({ rejectUnauthorized: !settings.telegram.tlsInsecure }),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolvePromise(Buffer.concat(chunks).toString("utf-8"));
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

const body = await fetchTelegram(url);

interface TelegramUpdate {
  message?: { chat?: { id: number; title?: string; type?: string; username?: string } };
  my_chat_member?: { chat?: { id: number; title?: string; type?: string } };
}

const parsed = JSON.parse(body) as { ok?: boolean; result?: TelegramUpdate[] };
if (!parsed.ok || !parsed.result?.length) {
  console.log("Guncelleme yok. Botu gruba ekleyip grupta mesaj yazin, tekrar calistirin.");
  process.exit(0);
}

const seen = new Map<number, { title: string; type: string }>();

for (const update of parsed.result) {
  const chat = update.message?.chat ?? update.my_chat_member?.chat;
  if (!chat?.id) {
    continue;
  }
  const title = chat.title ?? chat.username ?? "(isimsiz)";
  seen.set(chat.id, { title, type: chat.type ?? "?" });
}

console.log("Bulunan chat_id degerleri (.env TELEGRAM_EXTRA_CHAT_IDS icin):\n");
for (const [id, meta] of seen) {
  console.log(`  ${id}  — ${meta.title} (${meta.type})`);
}

console.log(
  "\nOrnek .env:\nTELEGRAM_CHAT_ID=-5494642849\nTELEGRAM_EXTRA_CHAT_IDS=-1001234567890",
);
console.log(
  "\nNot: t.me/+ davet linki kullanilamaz — yukaridaki sayisal id gerekir.",
);
