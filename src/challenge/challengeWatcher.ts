import { readFileSync, writeFileSync } from "node:fs";
import type { BrowserContext, Cookie, Page } from "playwright";

import type { CaptchaConfig } from "../captcha/captchaConfig.js";
import { saveCaptchaRuntime, type CaptchaRuntimeState } from "../captcha/captchaConfig.js";
import { logger } from "../utils/logger.js";
import { CLOUDFLARE_COOKIE_NAMES, OPTIONAL_APP_COOKIE_NAMES } from "../session/cookieSanitizer.js";
import type { SessionPaths } from "../session/sessionLoader.js";
import { detectChallenge, isPageAccessible } from "./challengeDetector.js";

export interface ChallengeWatchResult {
  resolved: boolean;
  challengeSeen: boolean;
  cookiesSaved: boolean;
  elapsedMs: number;
}

const ALLOWED_COOKIE_NAMES = new Set<string>([
  ...CLOUDFLARE_COOKIE_NAMES,
  ...OPTIONAL_APP_COOKIE_NAMES,
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readExistingCookies(cookiesFilePath: string): Cookie[] {
  try {
    const raw = readFileSync(cookiesFilePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Cookie[]) : [];
  } catch {
    return [];
  }
}

/** Challenge geçildikten sonra CF çerezlerini cookies.json'a merge eder (self-healing) */
export async function persistSessionCookies(
  context: BrowserContext,
  cookiesFilePath: string,
): Promise<number> {
  const liveCookies = await context.cookies();
  const relevantLive = liveCookies.filter((cookie) => ALLOWED_COOKIE_NAMES.has(cookie.name));

  if (relevantLive.length === 0) {
    return 0;
  }

  const existing = readExistingCookies(cookiesFilePath);
  const merged = new Map<string, Cookie>();

  for (const cookie of existing) {
    merged.set(`${cookie.domain}|${cookie.name}`, cookie);
  }

  for (const cookie of relevantLive) {
    merged.set(`${cookie.domain}|${cookie.name}`, cookie);
  }

  const result = [...merged.values()];
  writeFileSync(cookiesFilePath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
  logger.info(`Self-heal: ${relevantLive.length} çerez cookies.json'a kaydedildi.`);

  return relevantLive.length;
}

export class ChallengeWatcher {
  private continuousTimer: ReturnType<typeof setInterval> | null = null;
  private watching = false;

  constructor(
    private readonly projectRoot: string,
    private readonly config: CaptchaConfig,
    private readonly runtime: CaptchaRuntimeState,
  ) {}

  /**
   * Challenge kaybolana veya max süre dolana kadar bekler.
   * Eklentinin reCAPTCHA çözmesine geniş süre tanır.
   */
  async waitUntilClear(
    page: Page,
    context: BrowserContext,
    sessionPaths: SessionPaths,
    expectedOrigin: string,
  ): Promise<ChallengeWatchResult> {
    const started = Date.now();
    let challengeSeen = false;
    let cookiesSaved = false;

    while (Date.now() - started < this.config.maxChallengeWaitMs) {
      const signals = await detectChallenge(page);

      if (signals.isChallenge) {
        if (!challengeSeen) {
          challengeSeen = true;
          this.runtime.lastChallengeDetectedAt = new Date().toISOString();
          logger.warn(`Challenge algılandı — eklenti çözüm bekleniyor: ${signals.reasons.join(", ")}`);
        } else {
          logger.debug(`Challenge devam ediyor (${signals.reasons.length} sinyal)...`);
        }

        await sleep(this.config.pollIntervalMs);
        continue;
      }

      if (await isPageAccessible(page, expectedOrigin)) {
        if (challengeSeen && this.config.autoSaveCookies) {
          await persistSessionCookies(context, sessionPaths.cookiesFile);
          cookiesSaved = true;
          this.runtime.lastCookieSaveAt = new Date().toISOString();
          this.runtime.lastChallengeResolvedAt = new Date().toISOString();
          this.runtime.totalChallengesResolved += 1;
          saveCaptchaRuntime(this.projectRoot, this.runtime);
          logger.info("Challenge çözüldü — oturum çerezleri güncellendi (self-heal).");
        }

        return {
          resolved: true,
          challengeSeen,
          cookiesSaved,
          elapsedMs: Date.now() - started,
        };
      }

      await sleep(this.config.pollIntervalMs);
    }

    logger.error(`Challenge ${this.config.maxChallengeWaitMs}ms içinde çözülmedi.`);

    return {
      resolved: false,
      challengeSeen,
      cookiesSaved,
      elapsedMs: Date.now() - started,
    };
  }

  /** Sayfa açık kaldığı sürece arka planda challenge gözlemi */
  startContinuousWatch(
    page: Page,
    context: BrowserContext,
    sessionPaths: SessionPaths,
    expectedOrigin: string,
  ): void {
    if (this.watching) {
      return;
    }

    this.watching = true;
    logger.info(
      `Sürekli challenge gözlemi başladı (aralık: ${this.config.continuousWatchIntervalMs}ms).`,
    );

    this.continuousTimer = setInterval(async () => {
      try {
        const signals = await detectChallenge(page);
        if (!signals.isChallenge) {
          return;
        }

        logger.warn(`[watch] Challenge tekrar algılandı: ${signals.reasons.join(", ")}`);
        this.runtime.lastChallengeDetectedAt = new Date().toISOString();
        saveCaptchaRuntime(this.projectRoot, this.runtime);

        const result = await this.waitUntilClear(page, context, sessionPaths, expectedOrigin);
        if (!result.resolved) {
          logger.error("[watch] Challenge self-heal başarısız — manuel müdahale gerekebilir.");
        }
      } catch (error) {
        logger.debug(`[watch] gözlem döngüsü: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, this.config.continuousWatchIntervalMs);
  }

  stopContinuousWatch(): void {
    if (this.continuousTimer) {
      clearInterval(this.continuousTimer);
      this.continuousTimer = null;
    }
    this.watching = false;
    logger.info("Sürekli challenge gözlemi durduruldu.");
  }
}
