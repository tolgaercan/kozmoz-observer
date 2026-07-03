import { readFileSync, writeFileSync } from "node:fs";
import type { BrowserContext, Cookie, Page } from "playwright";

import type { AppSettings } from "../config/settings.js";
import { saveCaptchaRuntime, type CaptchaRuntimeState } from "../captcha/captchaConfig.js";
import { TelegramNotifier, type InterventionAlertType } from "../notifications/telegramNotifier.js";
import { logger } from "../utils/logger.js";
import { CLOUDFLARE_COOKIE_NAMES, OPTIONAL_APP_COOKIE_NAMES } from "../session/cookieSanitizer.js";
import type { SessionPaths } from "../session/sessionLoader.js";
import { detectIntervention, isAppReady, type InterventionType } from "./interventionDetector.js";

export interface InterventionWatchResult {
  resolved: boolean;
  interventionSeen: boolean;
  interventionType: InterventionType;
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

  writeFileSync(cookiesFilePath, `${JSON.stringify([...merged.values()], null, 2)}\n`, "utf-8");
  logger.info(`Self-heal: ${relevantLive.length} çerez kaydedildi.`);

  return relevantLive.length;
}

export class InterventionWatcher {
  private continuousTimer: ReturnType<typeof setInterval> | null = null;
  private watching = false;
  private waitUntilReadyInFlight: Promise<InterventionWatchResult> | null = null;
  private readonly telegram: TelegramNotifier;
  private activeIntervention: InterventionType = "none";

  constructor(
    private readonly projectRoot: string,
    private readonly settings: AppSettings,
    private readonly runtime: CaptchaRuntimeState,
    private readonly profileId: string,
  ) {
    this.telegram = new TelegramNotifier(settings.telegram);
  }

  async waitUntilReady(
    page: Page,
    context: BrowserContext,
    sessionPaths: SessionPaths,
    expectedOrigin: string,
  ): Promise<InterventionWatchResult> {
    return this.runWaitUntilReady(page, context, sessionPaths, expectedOrigin);
  }

  private async runWaitUntilReady(
    page: Page,
    context: BrowserContext,
    sessionPaths: SessionPaths,
    expectedOrigin: string,
  ): Promise<InterventionWatchResult> {
    if (this.waitUntilReadyInFlight) {
      return this.waitUntilReadyInFlight;
    }

    this.waitUntilReadyInFlight = this.waitUntilReadyLoop(
      page,
      context,
      sessionPaths,
      expectedOrigin,
    ).finally(() => {
      this.waitUntilReadyInFlight = null;
    });

    return this.waitUntilReadyInFlight;
  }

  private async waitUntilReadyLoop(
    page: Page,
    context: BrowserContext,
    sessionPaths: SessionPaths,
    expectedOrigin: string,
  ): Promise<InterventionWatchResult> {
    const started = Date.now();
    let interventionSeen = false;
    let interventionType: InterventionType = "none";
    let cookiesSaved = false;
    let challengeNotifiedTimeout = false;

    while (true) {
      const elapsed = Date.now() - started;
      const signals = await detectIntervention(page);

      if (signals.type !== "none") {
        interventionSeen = true;
        interventionType = signals.type;
        this.activeIntervention = signals.type;
        this.runtime.lastChallengeDetectedAt = new Date().toISOString();
        saveCaptchaRuntime(this.projectRoot, this.runtime);

        const maxWait =
          signals.type === "login"
            ? this.settings.intervention.loginMaxWaitMs
            : signals.type === "blocked"
              ? Number.MAX_SAFE_INTEGER
              : this.settings.intervention.challengeMaxWaitMs;

        if (elapsed < maxWait || signals.type === "login" || signals.type === "blocked") {
          if (this.activeIntervention === signals.type) {
            await this.notifyOnce(signals.type as InterventionAlertType, page, signals.reasons);
          }

          if (signals.type === "blocked") {
            logger.error(
              "HARD BLOCK algılandı — otomasyonu durdurun. Normal Chrome ile manuel deneyin, 24 saat bekleyin.",
            );
          }

          if (
            signals.type === "challenge" &&
            !challengeNotifiedTimeout &&
            elapsed >= this.settings.intervention.challengeMaxWaitMs
          ) {
            challengeNotifiedTimeout = true;
            await this.telegram.notifyManualHelpRequired({
              profileId: this.profileId,
              url: page.url(),
              reason: "Doğrulama süresi uzadı — eklenti veya manuel müdahale kontrol edin.",
            });
          }

          logger.warn(
            `[${signals.type}] Müdahale bekleniyor (${Math.round(elapsed / 1000)}s): ${signals.reasons.join(", ")}`,
          );
          await sleep(this.settings.intervention.pollIntervalMs);
          continue;
        }

        if (signals.type === "challenge") {
          await this.telegram.notifyManualHelpRequired({
            profileId: this.profileId,
            url: page.url(),
            reason: "Doğrulama çözülemedi — sistem beklemeye devam ediyor.",
          });
          await sleep(this.settings.intervention.pollIntervalMs);
          continue;
        }
      }

      if (await isAppReady(page, expectedOrigin)) {
        if (interventionSeen && this.settings.telegram.enabled) {
          await this.telegram.notifyInterventionResolved(
            interventionType as InterventionAlertType,
            { profileId: this.profileId, url: page.url() },
          );
        }

        if (interventionSeen) {
          await persistSessionCookies(context, sessionPaths.cookiesFile);
          cookiesSaved = true;
          this.runtime.lastCookieSaveAt = new Date().toISOString();
          this.runtime.lastChallengeResolvedAt = new Date().toISOString();
          this.runtime.totalChallengesResolved += 1;
          saveCaptchaRuntime(this.projectRoot, this.runtime);
        }

        this.activeIntervention = "none";
        this.resetNotifications();

        return {
          resolved: true,
          interventionSeen,
          interventionType,
          cookiesSaved,
          elapsedMs: Date.now() - started,
        };
      }

      await sleep(this.settings.intervention.pollIntervalMs);
    }
  }

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
    logger.info("Sürekli müdahale gözlemi aktif (login + doğrulama + Telegram).");

    this.continuousTimer = setInterval(async () => {
      try {
        const signals = await detectIntervention(page);
        if (signals.type === "none") {
          return;
        }

        if (this.waitUntilReadyInFlight) {
          return;
        }

        logger.warn(`[watch] ${signals.type} algılandı: ${signals.reasons.join(", ")}`);
        await this.runWaitUntilReady(page, context, sessionPaths, expectedOrigin);
      } catch (error) {
        logger.debug(`[watch] ${error instanceof Error ? error.message : String(error)}`);
      }
    }, this.settings.intervention.continuousWatchIntervalMs);
  }

  stopContinuousWatch(): void {
    if (this.continuousTimer) {
      clearInterval(this.continuousTimer);
      this.continuousTimer = null;
    }
    this.watching = false;
  }

  private notifiedTypes = new Set<InterventionAlertType>();

  private async notifyOnce(
    type: InterventionAlertType,
    page: Page,
    reasons: string[],
  ): Promise<void> {
    if (this.notifiedTypes.has(type)) {
      return;
    }

    this.notifiedTypes.add(type);

    await this.telegram.notifyInterventionRequired(type, {
      profileId: this.profileId,
      url: page.url(),
      title: await page.title().catch(() => "—"),
      reasons,
    });
  }

  private resetNotifications(): void {
    this.notifiedTypes.clear();
  }
}
