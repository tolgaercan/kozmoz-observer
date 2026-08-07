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
  addDaysIso,
  computeActiveDates,
  filterPortalWeekdays,
  formatIsoDateLocal,
  resolvePortalGetClosedDateMaxDate,
} from "./availabilityDates.js";
import { parseResponse } from "./closedDateParser.js";
import { fetchMaxAppointmentDate } from "./maxAppointmentDate.js";
import type { ApiQueryParams } from "./resolveApiQueryParams.js";
import { syncPortalAppointmentType } from "./syncPortalAppointmentType.js";
import type { ClosedDatePollResult } from "../types.js";
import { rawJwtFromBearer, resolveBearerToken } from "../auth/tokenProvider.js";
import { loadSettings } from "../../config/settings.js";
import { ensurePortalAppointmentEntry } from "../../navigation/ensurePortalAppointmentEntry.js";
import { mergeWorkerApiIntoProfile } from "../../control-panel/workerWizardForm.js";
import { WorkerConfigStore } from "../../control-panel/workerConfigStore.js";
import { ensureWizardForApiPoll, isPortalSessionReadyForPoll } from "../../portal/ensureWizardForApiPoll.js";
import { isBasvuruPortalUrl, isKosmosMarketingHome } from "../../portal/kosmosOrigin.js";
import { ProfileManager } from "../../profiles/profileManager.js";
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

/** Her poll öncesi maxDate — AdminDatas (varsayılan), portal formülü veya env override. */
async function enrichQueryParamsWithLiveMaxDate(
  ctx: ApiServiceContext,
  params: ApiQueryParams,
  page?: Page,
): Promise<ApiQueryParams> {
  const maxDateOverride = readEnv("API_CLOSED_DATE_MAX");
  if (maxDateOverride) {
    return { ...params, maxDate: maxDateOverride };
  }

  const mode = (readEnv("API_CLOSED_DATE_MAX_MODE") ?? "api").toLowerCase();
  if (mode === "offset" || mode === "fixed") {
    return {
      ...params,
      maxDate: addDaysIso(params.date, ctx.settings.closedDateRangeDays),
    };
  }
  if (mode === "portal") {
    return {
      ...params,
      maxDate: resolvePortalGetClosedDateMaxDate(params.date),
    };
  }

  const fetched = await fetchMaxAppointmentDate(ctx, page);
  if (fetched) {
    if (fetched !== params.maxDate) {
      logger.info(`[api] maxDate AdminDatas → ${fetched}`);
    }
    return { ...params, maxDate: fetched };
  }

  const fallback = resolvePortalGetClosedDateMaxDate(params.date);
  logger.warn(`[api] AdminDatas maxDate alınamadi — portal formulu: ${fallback}`);
  return { ...params, maxDate: fallback };
}

function buildPollResult(
  ctx: ApiServiceContext,
  status: number,
  raw: unknown,
  queryParams: ApiQueryParams,
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

  logger.debug(
    `[checkAvailability] API ham kapali=${parsed.closedDates.length}, secilebilir=${activeWeekdays.length}, typeId=${queryParams.appointmentTypeId}`,
  );

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
    return mapHttpFailure(status, raw, typeof raw === "string" ? raw : undefined);
  }

  return buildPollResult(ctx, status, raw, queryParams);
}

async function fetchClosedDateViaPage(
  ctx: ApiServiceContext,
  url: string,
  queryParams: ApiQueryParams,
  page: Page,
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
    return mapHttpFailure(browserResult.status, raw, browserResult.bodyText);
  }

  return buildPollResult(ctx, browserResult.status, raw, queryParams);
}

export async function checkAvailability(
  ctx: ApiServiceContext,
  queryParams: ApiQueryParams,
  page?: Page,
): Promise<ClosedDatePollResult> {
  const effectiveParams = await enrichQueryParamsWithLiveMaxDate(ctx, queryParams, page);
  const url = closedDateUrl(ctx, effectiveParams);
  logger.debug(
    `[checkAvailability] typeId=${effectiveParams.appointmentTypeId} (${effectiveParams.appointmentStyleLabel ?? "?"}) → ${url}`,
  );

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
        const appSettings = loadSettings(ctx.projectRoot);
        const pollPrepRounds = 2;
        const pollSessionSettleMs = 1_500;

        for (let round = 1; round <= pollPrepRounds; round++) {
          if (ctx.settings.apiWizardAutoNavigate) {
            const entry = await ensurePortalAppointmentEntry(
              pollPage,
              pollPage.context(),
              appSettings,
              { allowGotoFallback: process.env.API_AUTO_OPEN_PORTAL_TAB === "true" },
            );
            pollPage = entry.page;
            if (!entry.ok) {
              logger.warn(`[checkAvailability] Portal girisi: ${entry.reason ?? entry.step ?? "?"}`);
            }
          }

          if (ctx.settings.syncPortalAppointmentType) {
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

            if (ctx.settings.apiWizardAutoNavigate) {
              const prep = await ensureWizardForApiPoll(
                pollPage,
                profile,
                appSettings.appointment,
                ctx.settings,
                effectiveParams,
              );
              if (!prep.ok) {
                logger.warn(`[checkAvailability] Wizard hazirlik: ${prep.reason}`);
              }
            }

            const syncResult = await syncPortalAppointmentType(pollPage, effectiveParams, ctx.settings);
            if (syncResult.synced) {
              logger.info(
                `[checkAvailability] Portal typeId=${syncResult.targetValue} senkron OK — GetClosedDate poll`,
              );
            } else if (
              syncResult.skipped &&
              syncResult.reason &&
              syncResult.reason !== "zaten eslesiyor"
            ) {
              logger.warn(
                `[checkAvailability] Portal basvuru sekli senkron atlandi: ${syncResult.reason}`,
              );
            } else if (!syncResult.skipped && !syncResult.synced && syncResult.reason) {
              logger.warn(
                `[checkAvailability] Portal basvuru sekli senkron basarisiz: ${syncResult.reason}`,
              );
            }
          }

          const session = await isPortalSessionReadyForPoll(pollPage, ctx.settings, effectiveParams, {
            requireTypeReady: ctx.settings.syncPortalAppointmentType,
          });
          if (session.ready) {
            return await fetchClosedDateViaPage(ctx, url, effectiveParams, pollPage);
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
