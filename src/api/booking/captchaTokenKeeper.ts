import type { Page } from "playwright";

import type { AppointmentSettings } from "../../config/settings.js";
import { bumpCalendarMonthForwardBack } from "../../portal/calendar/calendarMonthNav.js";
import {
  readRecaptchaTokenFromPage,
  RECAPTCHA_TOKEN_SOLVED_MIN_LENGTH,
  markRecaptchaSolved,
} from "../../portal/recaptchaGate.js";
import { logger } from "../../utils/logger.js";

export interface CaptchaTokenKeeperConfig {
  tokenMaxAgeMs: number;
  pollIntervalMs: number;
  patienceMs: number;
  logEveryMs: number;
  staleBumpEnabled: boolean;
  staleBumpCooldownMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Step 3 boyunca reCAPTCHA token'ını poll eder; her API/UI adımından önce fresh token sağlar.
 */
export class CaptchaTokenKeeper {
  private lastToken = "";
  private capturedAtMs = 0;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastStaleBumpAtMs = 0;
  private waitStartedAtMs = 0;

  constructor(
    private readonly page: Page,
    private readonly config: CaptchaTokenKeeperConfig,
    private readonly appointmentSettings?: AppointmentSettings,
  ) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.refreshRead();
    this.pollTimer = setInterval(() => {
      void this.refreshRead();
    }, this.config.pollIntervalMs);
    logger.info("[captcha-keeper] Step 3 token izleme başladı.");
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.debug("[captcha-keeper] durduruldu.");
  }

  async refreshRead(): Promise<string> {
    if (this.page.isClosed()) {
      return this.lastToken;
    }

    const token = await readRecaptchaTokenFromPage(this.page);
    if (token.length > RECAPTCHA_TOKEN_SOLVED_MIN_LENGTH) {
      const wasEmpty = this.lastToken.length <= RECAPTCHA_TOKEN_SOLVED_MIN_LENGTH;
      this.lastToken = token;
      this.capturedAtMs = Date.now();
      markRecaptchaSolved(this.capturedAtMs);
      if (wasEmpty) {
        logger.info(`[captcha-keeper] Token alindi (len=${token.length}) — saat sorgusu devam edecek.`);
      }
    }
    return this.lastToken;
  }

  isStale(): boolean {
    if (!this.lastToken) {
      return true;
    }
    return Date.now() - this.capturedAtMs > this.config.tokenMaxAgeMs;
  }

  getToken(): string {
    return this.lastToken;
  }

  getTokenAgeMs(): number {
    if (!this.lastToken) {
      return Number.POSITIVE_INFINITY;
    }
    return Date.now() - this.capturedAtMs;
  }

  private async maybeBumpStaleCalendar(): Promise<void> {
    if (!this.config.staleBumpEnabled || !this.appointmentSettings || this.page.isClosed()) {
      return;
    }

    const now = Date.now();
    if (now - this.lastStaleBumpAtMs < this.config.staleBumpCooldownMs) {
      return;
    }

    this.lastStaleBumpAtMs = now;
    logger.info("[captcha-keeper] Token bayat — takvim ay bump denenecek.");
    try {
      await bumpCalendarMonthForwardBack(this.page, this.appointmentSettings);
    } catch (error) {
      logger.warn(
        `[captcha-keeper] Ay bump başarısız: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Extension/kullanıcı çözene kadar sabırla bekler — kısa campaign timeout yok. */
  async awaitFresh(patienceMs = this.config.patienceMs): Promise<string | null> {
    const deadline = Date.now() + patienceMs;
    this.waitStartedAtMs = Date.now();
    let lastLogAt = 0;

    while (Date.now() < deadline) {
      await this.refreshRead();
      if (this.lastToken && !this.isStale()) {
        return this.lastToken;
      }

      if (this.isStale()) {
        await this.maybeBumpStaleCalendar();
        await this.refreshRead();
        if (this.lastToken && !this.isStale()) {
          return this.lastToken;
        }
      }

      const elapsed = Date.now() - this.waitStartedAtMs;
      if (elapsed - lastLogAt >= this.config.logEveryMs) {
        lastLogAt = elapsed;
        logger.info(
          `[captcha-keeper] token bekleniyor (${Math.round(elapsed / 1000)}s, len=${this.lastToken.length}, age=${Math.round(this.getTokenAgeMs() / 1000)}s)`,
        );
      }

      await sleep(this.config.pollIntervalMs);
    }

    await this.refreshRead();
    if (this.lastToken && !this.isStale()) {
      return this.lastToken;
    }

    logger.warn(
      `[captcha-keeper] fresh token alınamadı (${Math.round(patienceMs / 1000)}s patience doldu).`,
    );
    return null;
  }
}
