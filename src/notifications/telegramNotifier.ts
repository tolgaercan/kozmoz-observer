import type { TelegramSettings } from "../config/settings.js";
import { postTelegramJson } from "./telegramHttpClient.js";
import { logger } from "../utils/logger.js";

export type InterventionAlertType = "challenge" | "login" | "blocked";

const SEND_MAX_ATTEMPTS = 3;
const SEND_RETRY_DELAY_MS = 1200;
const FAILURE_BACKOFF_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatHttpError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts = [error.message];
  const code = (error as NodeJS.ErrnoException).code;
  if (code) {
    parts.push(`code=${code}`);
  }

  return parts.join(" | ");
}

function isTlsVerificationError(error: unknown): boolean {
  const message = formatHttpError(error);
  return (
    message.includes("UNABLE_TO_VERIFY") ||
    message.includes("CERT_") ||
    message.includes("self signed") ||
    message.includes("certificate")
  );
}

export class TelegramNotifier {
  private lastAlertAt = new Map<string, number>();
  private failureBackoffUntil = new Map<string, number>();
  private sendInFlight = new Map<string, Promise<boolean>>();

  constructor(private readonly settings: TelegramSettings) {}

  isConfigured(): boolean {
    return Boolean(this.settings.enabled && this.settings.botToken && this.settings.chatId);
  }

  async sendStartupPing(profileId: string, detail?: string): Promise<boolean> {
    const text = [
      `<b>✅ Observer başladı</b>`,
      `<b>Profil:</b> ${escapeHtml(profileId)}`,
      detail ? escapeHtml(detail) : "Telegram bildirimleri aktif.",
    ].join("\n");

    return this.send(text, "startup:ping", true);
  }

  async notifyInterventionRequired(
    type: InterventionAlertType,
    details: { profileId: string; url: string; title: string; reasons: string[] },
  ): Promise<void> {
    const label =
      type === "login"
        ? "🔐 LOGIN GEREKLİ"
        : type === "blocked"
          ? "🚫 CLOUDFLARE BAN / BLOK"
          : "🛡️ DOĞRULAMA GEREKLİ";
    const text = [
      `<b>${label}</b>`,
      ``,
      `<b>Profil:</b> ${escapeHtml(details.profileId)}`,
      `<b>URL:</b> ${escapeHtml(details.url)}`,
      `<b>Sayfa:</b> ${escapeHtml(details.title)}`,
      `<b>Sinyaller:</b> ${escapeHtml(details.reasons.join(", ") || "—")}`,
      ``,
      type === "login"
        ? "Oturum düşmüş olabilir. Tarayıcıda manuel giriş yapın — sistem bekliyor."
        : type === "blocked"
          ? "HARD BLOCK — otomasyonu DURDUR. Normal Chrome ile manuel giriş dene. 24 saat bekle."
          : "reCAPTCHA/Cloudflare doğrulaması algılandı. Eklenti çözüyor veya manuel müdahale gerekebilir — sistem bekliyor.",
    ].join("\n");

    await this.send(text, `intervention:${type}`);
  }

  async notifyInterventionResolved(
    type: InterventionAlertType,
    details: { profileId: string; url: string },
  ): Promise<void> {
    if (!this.settings.notifyOnResolved) {
      return;
    }

    const label =
      type === "login"
        ? "✅ Login tamamlandı"
        : type === "blocked"
          ? "✅ Blok kalktı"
          : "✅ Doğrulama geçildi";
    const text = [
      `<b>${label}</b>`,
      `<b>Profil:</b> ${escapeHtml(details.profileId)}`,
      `<b>URL:</b> ${escapeHtml(details.url)}`,
    ].join("\n");

    await this.send(text, `resolved:${type}`, true);
  }

  async notifyManualHelpRequired(details: {
    profileId: string;
    url: string;
    reason: string;
  }): Promise<void> {
    const text = [
      `<b>⚠️ MANUEL MÜDAHALE</b>`,
      `<b>Profil:</b> ${escapeHtml(details.profileId)}`,
      `<b>URL:</b> ${escapeHtml(details.url)}`,
      `<b>Sebep:</b> ${escapeHtml(details.reason)}`,
      ``,
      "Otomatik çözüm zaman aşımına uğradı. Sistem hâlâ bekliyor.",
    ].join("\n");

    await this.send(text, `manual:${details.reason.slice(0, 40)}`);
  }

  /** GetClosedDate API watcher — aktif gün özeti */
  async notifyApiAvailability(details: {
    profileId: string;
    city?: string;
    appointmentStyle?: string;
    textSummary: string;
    activeDates: string[];
    isEmpty: boolean;
    hasNewDays?: boolean;
    periodicReport?: boolean;
  }): Promise<void> {
    const emoji = details.isEmpty ? "📭" : details.hasNewDays ? "🟢" : "📅";
    const title = details.isEmpty
      ? "API — aktif gün yok"
      : details.hasNewDays
        ? "API — YENİ aktif gün(ler)!"
        : "API — aktif günler";
    const styleLine = details.appointmentStyle
      ? `<b>Şekil:</b> ${escapeHtml(details.appointmentStyle)}`
      : "";
    const text = [
      `<b>${emoji} ${title}</b>`,
      details.city ? `<b>Ofis:</b> ${escapeHtml(details.city)}` : "",
      styleLine,
      `<b>Profil:</b> ${escapeHtml(details.profileId)}`,
      "",
      escapeHtml(details.textSummary),
    ]
      .filter(Boolean)
      .join("\n");

    const dedupeKey = details.isEmpty
      ? `api:empty:${details.profileId}`
      : details.hasNewDays
        ? `api:new:${details.profileId}`
        : `api:active:${details.profileId}`;

    await this.send(text, dedupeKey, details.periodicReport === true);
  }

  async notifyAvailableSlots(details: {
    profileId: string;
    city?: string;
    textSummary: string;
    dates?: string[];
    isEmpty: boolean;
    hasConfirmedTimes?: boolean;
    /** Watcher kendi aralığını yönetiyorsa Telegram cooldown atlanır */
    periodicReport?: boolean;
  }): Promise<void> {
    const emoji = details.isEmpty ? "📭" : details.hasConfirmedTimes ? "🟢" : "📅";
    const title = details.isEmpty
      ? "Müsait gün yok"
      : details.hasConfirmedTimes
        ? "DOLU — Randevu saati doğrulandı!"
        : "Takvimde müsait görünen günler";
    const text = [
      `<b>${emoji} ${title}</b>`,
      details.city ? `<b>İl:</b> ${escapeHtml(details.city)}` : "",
      `<b>Profil:</b> ${escapeHtml(details.profileId)}`,
      "",
      escapeHtml(details.textSummary),
    ]
      .filter(Boolean)
      .join("\n");

    const dedupeKey = details.isEmpty
      ? `slots:empty:${details.profileId}`
      : `slots:found:${details.profileId}`;

    await this.send(text, dedupeKey, details.periodicReport === true);
  }

  private async send(text: string, dedupeKey: string, skipCooldown = false): Promise<boolean> {
    if (!this.isConfigured()) {
      logger.warn("Telegram bildirimi atlanıyor — TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.");
      return false;
    }

    const failureUntil = this.failureBackoffUntil.get(dedupeKey) ?? 0;
    if (Date.now() < failureUntil) {
      logger.debug(`Telegram hata backoff aktif (${dedupeKey})`);
      return false;
    }

    if (!skipCooldown) {
      const last = this.lastAlertAt.get(dedupeKey) ?? 0;
      if (Date.now() - last < this.settings.notifyCooldownMs) {
        logger.debug(`Telegram cooldown aktif (${dedupeKey})`);
        return false;
      }
    }

    const inFlight = this.sendInFlight.get(dedupeKey);
    if (inFlight) {
      await inFlight;
      return this.lastAlertAt.has(dedupeKey);
    }

    const task = this.sendWithRetry(text, dedupeKey);
    this.sendInFlight.set(dedupeKey, task);

    try {
      return await task;
    } finally {
      this.sendInFlight.delete(dedupeKey);
    }
  }

  private async sendWithRetry(text: string, dedupeKey: string): Promise<boolean> {
    let lastError = "bilinmeyen hata";
    const url = `https://api.telegram.org/bot${this.settings.botToken}/sendMessage`;
    const payload = {
      chat_id: this.settings.chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };

    for (let attempt = 1; attempt <= SEND_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await postTelegramJson(url, payload, {
          tlsInsecure: this.settings.tlsInsecure,
          timeoutMs: 15_000,
        });

        if (response.status < 200 || response.status >= 300) {
          throw new Error(`HTTP ${response.status}: ${response.body}`);
        }

        this.lastAlertAt.set(dedupeKey, Date.now());
        this.failureBackoffUntil.delete(dedupeKey);
        logger.info(`Telegram bildirimi gönderildi (${dedupeKey}).`);
        return true;
      } catch (error) {
        lastError = formatHttpError(error);

        if (
          !this.settings.tlsInsecure &&
          isTlsVerificationError(error) &&
          attempt === 1
        ) {
          logger.warn(
            "Telegram TLS doğrulama hatası — TELEGRAM_TLS_INSECURE=true ile tekrar deneniyor.",
          );
          try {
            const retryResponse = await postTelegramJson(url, payload, {
              tlsInsecure: true,
              timeoutMs: 15_000,
            });
            if (retryResponse.status >= 200 && retryResponse.status < 300) {
              this.lastAlertAt.set(dedupeKey, Date.now());
              this.failureBackoffUntil.delete(dedupeKey);
              logger.info(`Telegram bildirimi gönderildi (${dedupeKey}, TLS insecure).`);
              logger.warn(
                ".env dosyasına TELEGRAM_TLS_INSECURE=true ekleyin (antivirüs/kurumsal proxy TLS kesintisi).",
              );
              return true;
            }
            lastError = `HTTP ${retryResponse.status}: ${retryResponse.body}`;
          } catch (retryError) {
            lastError = formatHttpError(retryError);
          }
        }

        if (attempt < SEND_MAX_ATTEMPTS) {
          logger.warn(
            `Telegram denemesi ${attempt}/${SEND_MAX_ATTEMPTS} başarısız (${dedupeKey}): ${lastError}`,
          );
          await sleep(SEND_RETRY_DELAY_MS * attempt);
        }
      }
    }

    this.failureBackoffUntil.set(dedupeKey, Date.now() + FAILURE_BACKOFF_MS);
    logger.error(`Telegram bildirimi gönderilemedi (${dedupeKey}): ${lastError}`);
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
