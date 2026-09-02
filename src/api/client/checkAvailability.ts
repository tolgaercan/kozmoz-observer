import type { Page } from "playwright";

import type { ApiServiceContext } from "./apiService.js";
import {
  apiFetch,
  apiFetchViaPage,
  buildApiHeaders,
  closedDateUrl,
  resolveAuthorizationForContext,
  resolvePortalReferer,
} from "./apiService.js";
import {
  computeActiveDates,
  filterPortalWeekdays,
  formatIsoDateLocal,
} from "./availabilityDates.js";
import { parseResponse } from "./closedDateParser.js";
import {
  logGetClosedDateAudit,
  logGetClosedDateHttpFailure,
} from "./apiResponseAuditLog.js";
import { enrichQueryParamsWithLiveMaxDate } from "./resolveLiveMaxDate.js";
import type { ApiQueryParams } from "./resolveApiQueryParams.js";
import { syncPortalAppointmentType } from "./syncPortalAppointmentType.js";
import type { ClosedDatePollResult } from "../types.js";
import { refreshBearerFromPortalPage } from "../auth/refreshPortalBearer.js";
import { rawJwtFromBearer, resolveBearerToken } from "../auth/tokenProvider.js";
import { loadSettings } from "../../config/settings.js";
import { ensurePortalAppointmentEntry } from "../../navigation/ensurePortalAppointmentEntry.js";
import { mergeWorkerApiIntoProfile } from "../../control-panel/workerWizardForm.js";
import { WorkerConfigStore } from "../../control-panel/workerConfigStore.js";
import { ensureWizardForApiPoll, isPortalSessionReadyForPoll } from "../../portal/ensureWizardForApiPoll.js";
import { getPortalBookingFlowLock } from "../../portal/portalBookingFlowGuard.js";
import { isBasvuruPortalUrl, isKosmosMarketingHome } from "../../portal/kosmosOrigin.js";
import { ProfileManager } from "../../profiles/profileManager.js";
import { TelegramNotifier } from "../../notifications/telegramNotifier.js";
import { logger } from "../../utils/logger.js";

function pageIsOnPortal(page: Page): boolean {
  const url = page.url().trim();
  if (!url || url === "about:blank") {
    return false;
  }
  return isBasvuruPortalUrl(url) || isKosmosMarketingHome(url);
}

function parseBody(contentType: string, bodyText: string): unknown {
  if (contentType.includes("json")) {
    try {
      return JSON.parse(bodyText);
    } catch {
      return bodyText;
    }
  }
  return bodyText;
}

function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function buildPollResult(
  ctx: ApiServiceContext,
  status: number,
  raw: unknown,
  queryParams: ApiQueryParams,
  auditOptions?: { retry?: boolean },
): ClosedDatePollResult {
  const bearer = resolveBearerToken(ctx.projectRoot, ctx.profileId) ?? "";
  const parsed = parseResponse(raw, bearer ? rawJwtFromBearer(bearer) : undefined);
  const todayIso = formatIsoDateLocal(new Date());
  const active = computeActiveDates(
    queryParams.date,
    queryParams.maxDate,
    parsed.closedDates,
    { todayIso },
  );
  const activeWeekdays = filterPortalWeekdays(active.activeDates);

  logGetClosedDateAudit({
    status,
    raw,
    queryParams,
    closedDates: parsed.closedDates,
    closedInRange: active.closedInRange,
    activeDates: activeWeekdays,
    bookableStart: active.bookableStart,
    bookableEnd: active.bookableEnd,
    retry: auditOptions?.retry,
  });

  logger.debug(
    `[checkAvailability] API ham kapali=${parsed.closedDates.length}, secilebilir=${activeWeekdays.length}, typeId=${queryParams.appointmentTypeId}`,
  );
  if (activeWeekdays.length === 0 && parsed.closedDates.length > 0) {
    logger.info(
      `[checkAvailability] GetClosedDate 0 secilebilir — kapali=${parsed.closedDates.length}, ` +
        `aralik=${queryParams.date}..${queryParams.maxDate}, typeId=${queryParams.appointmentTypeId}`,
    );
  }

  const excludesTodayNote =
    active.bookableStart > queryParams.date ? `, bugün ${todayIso} hariç` : "";

  return {
    ok: true,
    status,
    hasOpenSlots: activeWeekdays.length > 0,
    summary:
      `${activeWeekdays.length} seçilebilir gün (API, hafta içi), ` +
      `${active.closedInRange.length} kapalı (API+hesaplanan), ` +
      `aralık ${active.bookableStart} → ${active.bookableEnd}${excludesTodayNote}`,
    raw: parsed.raw,
    allowedDates: activeWeekdays,
    closedDates: parsed.closedDates,
    activeDates: activeWeekdays,
    openDates: activeWeekdays,
    bookableStart: active.bookableStart,
    bookableEnd: active.bookableEnd,
    closedInRange: active.closedInRange,
    queryDate: queryParams.date,
    queryMaxDate: queryParams.maxDate,
  };
}

function mapHttpFailure(
  status: number,
  raw: unknown,
  bodyText?: string,
): ClosedDatePollResult {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      status,
      hasOpenSlots: false,
      summary: `Yetkisiz (${status}) — token yenilenmeli`,
      unauthorized: true,
    };
  }

  if (status === 429) {
    return {
      ok: false,
      status,
      hasOpenSlots: false,
      summary: `HTTP 429 — rate limit (poll aralığını artırın)`,
      rateLimited: true,
      raw: bodyText ?? raw,
    };
  }

  if (status < 200 || status >= 300) {
    return {
      ok: false,
      status,
      hasOpenSlots: false,
      summary: `HTTP ${status}`,
      raw,
    };
  }

  throw new Error(`mapHttpFailure beklenmeyen başarılı status: ${status}`);
}

async function fetchClosedDateViaNode(
  ctx: ApiServiceContext,
  url: string,
  queryParams: ApiQueryParams,
): Promise<ClosedDatePollResult> {
  const response = await apiFetch(ctx, url, { queryParams });
  const status = response.status;
  const contentType = response.headers.get("content-type") ?? "";
  let raw: unknown;
  if (contentType.includes("json")) {
    raw = await response.json();
  } else {
    raw = await response.text();
  }

  if (status < 200 || status >= 300) {
    logGetClosedDateHttpFailure(
      status,
      raw,
      queryParams,
      typeof raw === "string" ? raw : undefined,
    );
    return mapHttpFailure(status, raw, typeof raw === "string" ? raw : undefined);
  }

  return buildPollResult(ctx, status, raw, queryParams);
}

async function fetchClosedDateViaPage(
  ctx: ApiServiceContext,
  url: string,
  queryParams: ApiQueryParams,
  page: Page,
  auditOptions?: { retry?: boolean },
): Promise<ClosedDatePollResult> {
  const referer = resolvePortalReferer(page.url(), ctx.settings.referer);
  const authorization = resolveAuthorizationForContext(ctx);
  const headers = buildApiHeaders(ctx, authorization, {}, referer);
  const browserResult = await apiFetchViaPage(page, url, headers, { queryParams });

  if (browserResult.networkError) {
    throw new Error(browserResult.networkError);
  }

  const raw = parseBody(browserResult.contentType, browserResult.bodyText);
  if (browserResult.status < 200 || browserResult.status >= 300) {
    logGetClosedDateHttpFailure(
      browserResult.status,
      raw,
      queryParams,
      browserResult.bodyText,
      auditOptions?.retry,
    );
    return mapHttpFailure(browserResult.status, raw, browserResult.bodyText);
  }

  return buildPollResult(ctx, browserResult.status, raw, queryParams, auditOptions);
}

export async function checkAvailability(
  ctx: ApiServiceContext,
  queryParams: ApiQueryParams,
  page?: Page,
): Promise<ClosedDatePollResult> {
  let effectiveParams: ApiQueryParams;
  try {
    ({ params: effectiveParams } = await enrichQueryParamsWithLiveMaxDate(ctx, queryParams, page));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[checkAvailability] ${message}`);
    return {
      ok: false,
      status: 0,
      hasOpenSlots: false,
      summary: message,
    };
  }

  const url = closedDateUrl(ctx, effectiveParams);
  logger.info(
    `[checkAvailability] GetClosedDate typeId=${effectiveParams.appointmentTypeId}` +
      ` (${effectiveParams.appointmentStyleLabel ?? "?"}) dealerId=${effectiveParams.dealerId}`,
  );
  logger.debug(`[checkAvailability] Poll URL → ${url}`);

  try {
    const forceNode = process.env.API_POLL_VIA_NODE === "true";
    const onPortal = page && !page.isClosed() && pageIsOnPortal(page);

    if (!onPortal && !forceNode) {
      return {
        ok: false,
        status: 0,
        hasOpenSlots: false,
        summary:
          "Portal sekmesi gerekli — once UI'dan appointmentForm acin, poll atlandi",
      };
    }

    if (onPortal && page && !page.isClosed()) {
      try {
        let pollPage = page;
        const bookingLock = await getPortalBookingFlowLock(pollPage);
        if (bookingLock.locked) {
          logger.info(
            `[checkAvailability] ${bookingLock.reason} — booking/odeme akisi, poll atlandi (wizard prep yok).`,
          );
          return {
            ok: false,
            status: 0,
            hasOpenSlots: false,
            skipped: true,
            summary: `Booking akisi aktif (${bookingLock.reason}) — poll atlandi`,
          };
        }

        const appSettings = loadSettings(ctx.projectRoot);
        const pollPrepRounds = 2;
        const pollSessionSettleMs = 1_500;
        let step2Transition = false;
        const telegram = new TelegramNotifier(appSettings.telegram);

        for (let round = 1; round <= pollPrepRounds; round++) {
          if (ctx.settings.apiWizardAutoNavigate) {
            const workerStore = new WorkerConfigStore(ctx.projectRoot);
            const worker = workerStore.getWorker(ctx.profileId, "", {
              pollIntervalMs: ctx.settings.pollIntervalMs,
              telegramReportIntervalMs: ctx.settings.telegramReportIntervalMs,
            });
            const baseProfile = new ProfileManager(ctx.projectRoot, appSettings.manifestPath).resolveProfile(
              ctx.profileId,
              appSettings,
            );
            const profile = mergeWorkerApiIntoProfile(baseProfile, worker.api);

            const entry = await ensurePortalAppointmentEntry(
              pollPage,
              pollPage.context(),
              appSettings,
              {
                allowGotoFallback:
                  process.env.API_AUTO_OPEN_PORTAL_TAB === "true" ||
                  process.env.PANEL_MANAGED_PORTAL_FLOW === "true",
                profile,
              },
            );
            pollPage = entry.page;
            if (!entry.ok) {
              logger.warn(`[checkAvailability] Portal girisi: ${entry.reason ?? entry.step ?? "?"}`);
            }

            const prep = await ensureWizardForApiPoll(
              pollPage,
              profile,
              appSettings.appointment,
              ctx.settings,
              effectiveParams,
              {
                manualAuthMaxWaitMs: Math.max(
                  ctx.settings.tokenCaptureWaitMs,
                  appSettings.intervention.loginMaxWaitMs,
                ),
                onManualAuthRequired: async (auth, url) => {
                  if (!telegram.isConfigured()) {
                    return;
                  }
                  const reason =
                    auth.kind === "otp"
                      ? "Portal OTP kodu girin — wizard devam edecek"
                      : auth.kind === "login_and_otp"
                        ? "Sifre + OTP ile giris yapin — wizard devam edecek"
                        : auth.kind === "login"
                          ? "Portal sifresi ile giris yapin — wizard devam edecek"
                          : "Portal dogrulama tamamlayin — wizard devam edecek";
                  await telegram.notifyManualHelpRequired({
                    profileId: ctx.profileId,
                    url,
                    reason,
                  });
                },
              },
            );
            if (!prep.ok) {
              logger.warn(`[checkAvailability] Wizard hazirlik: ${prep.reason}`);
            }
            if (prep.step2Transition) {
              step2Transition = true;
            }
          }

          const session = await isPortalSessionReadyForPoll(pollPage, ctx.settings, effectiveParams, {
            requireTypeReady: ctx.settings.apiPollFillStep2 && ctx.settings.syncPortalAppointmentType,
          });
          if (session.ready) {
            const settleMs = ctx.settings.pollPostStep2SettleMs;
            const shouldSettle =
              settleMs > 0 && (step2Transition || ctx.settings.apiWizardAutoNavigate);

            if (shouldSettle) {
              logger.info(
                `[checkAvailability] GetClosedDate oncesi sayfa yerlesmesi — ${settleMs}ms bekleniyor.`,
              );
              await pollPage.waitForTimeout(settleMs);
            }

            if (ctx.settings.syncPortalAppointmentType) {
              const typeSelector =
                ctx.settings.appointmentTypeSelectLocator.split("|")[0]?.trim() ??
                "select[name='appointmentTypeId']";
              const domTypeId = await pollPage
                .evaluate((sel) => {
                  const el = document.querySelector<HTMLSelectElement>(sel);
                  return el?.value?.trim() || null;
                }, typeSelector)
                .catch(() => null);

              if (domTypeId !== effectiveParams.appointmentTypeId) {
                logger.info(
                  `[checkAvailability] DOM typeId=${domTypeId ?? "—"} ≠ hedef ${effectiveParams.appointmentTypeId} — hizli senkron (TC yok).`,
                );
                const syncResult = await syncPortalAppointmentType(
                  pollPage,
                  effectiveParams,
                  ctx.settings,
                );
                if (syncResult.synced) {
                  step2Transition = true;
                } else if (syncResult.reason && !syncResult.skipped) {
                  logger.warn(`[checkAvailability] Basvuru sekli senkron: ${syncResult.reason}`);
                }
              }
            }

            const refreshed = await refreshBearerFromPortalPage(
              ctx.projectRoot,
              ctx.profileId,
              pollPage,
            );
            if (refreshed) {
              ctx.bearerToken = refreshed;
            }

            let result = await fetchClosedDateViaPage(ctx, url, effectiveParams, pollPage);

            if (
              result.ok &&
              !result.hasOpenSlots &&
              (result.activeDates?.length ?? 0) === 0 &&
              shouldSettle &&
              ctx.settings.syncPortalAppointmentType
            ) {
              const retryTypeSelector =
                ctx.settings.appointmentTypeSelectLocator.split("|")[0]?.trim() ??
                "select[name='appointmentTypeId']";
              const domTypeIdAfterPoll = await pollPage
                .evaluate((sel) => {
                  const el = document.querySelector<HTMLSelectElement>(sel);
                  return el?.value?.trim() || null;
                }, retryTypeSelector)
                .catch(() => null);

              if (domTypeIdAfterPoll !== effectiveParams.appointmentTypeId) {
                logger.info(
                  `[checkAvailability] GetClosedDate 0 gun + typeId uyumsuz — DOM=${domTypeIdAfterPoll ?? "—"}, ` +
                    `hedef=${effectiveParams.appointmentTypeId} — senkron + tek retry.`,
                );
                await syncPortalAppointmentType(pollPage, effectiveParams, ctx.settings);
                await pollPage.waitForTimeout(settleMs);
                const retryBearer = await refreshBearerFromPortalPage(
                  ctx.projectRoot,
                  ctx.profileId,
                  pollPage,
                );
                if (retryBearer) {
                  ctx.bearerToken = retryBearer;
                }
                result = await fetchClosedDateViaPage(ctx, url, effectiveParams, pollPage, {
                  retry: true,
                });
              } else {
                logger.debug(
                  `[checkAvailability] GetClosedDate 0 gun — typeId uyumlu, ikinci istek atlaniyor.`,
                );
              }
            }

            return result;
          }

          logger.warn(
            `[checkAvailability] Oturum hazir degil (${session.reason ?? "?"}) — tur ${round}/${pollPrepRounds}`,
          );
          if (round < pollPrepRounds) {
            await pollPage.waitForTimeout(pollSessionSettleMs);
          }
        }

        return {
          ok: false,
          status: 0,
          hasOpenSlots: false,
          skipped: true,
          summary: "Portal oturumu hazir degil (takvim/adim 3+ veya typeId) — poll atlandi",
        };
      } catch (browserError) {
        const message =
          browserError instanceof Error ? browserError.message : String(browserError);
        logger.warn(`[checkAvailability] Tarayici fetch basarisiz: ${message}`);
        return {
          ok: false,
          status: 0,
          hasOpenSlots: false,
          summary: message,
        };
      }
    }

    if (forceNode) {
      logger.debug("[checkAvailability] API_POLL_VIA_NODE=true — Node fetch");
      return await fetchClosedDateViaNode(ctx, url, effectiveParams);
    }

    return {
      ok: false,
      status: 0,
      hasOpenSlots: false,
      summary: "Portal sekmesi gerekli — poll atlandi",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? ` — ${error.cause.message}`
        : error instanceof Error && error.cause
          ? ` — ${String(error.cause)}`
          : "";
    logger.warn(`[checkAvailability] ${message}${cause}`);
    return {
      ok: false,
      status: 0,
      hasOpenSlots: false,
      summary: `${message}${cause}`,
    };
  }
}
