import { startAvailabilityWatcher } from "../../api/watcher/watcher.js";
import { resolveAppointmentFormUrl } from "../../navigation/kosmosPortalNav.js";
import { closedDateUrl } from "../../api/client/apiService.js";
import { resolvePortalTabForApiPoll } from "../../browser/cdpConnector.js";
import {
  logResolvedApiQueryParams,
  resolveApiQueryParams,
  type ApiQueryParamOverrides,
} from "../../api/client/resolveApiQueryParams.js";
import { WorkerConfigStore, normalizeLockedIp } from "../../control-panel/workerConfigStore.js";
import { WorkerRuntimeStore } from "../../control-panel/workerRuntimeStore.js";
import { detectPublicIpForWorker } from "../../config/proxyResolver.js";
import { logger } from "../../utils/logger.js";
import type { ScenarioRuntime } from "../scenarioRuntime.js";
import type { ScenarioStepParams } from "../types.js";
import {
  getBearerTokenForProfile,
  runApiAuthBootstrapPhase,
  tryRefreshTokenFromActivePage,
} from "./apiAuthBootstrap.js";

export interface ApiWatcherPhaseResult {
  ok: boolean;
  detail: string;
}

function waitUntilInterrupted(): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = (): void => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

function readParamOverrides(params?: ScenarioStepParams): ApiQueryParamOverrides {
  return {
    dealerId: params?.dealerId as string | undefined,
    dealerOffice: params?.dealerOffice as string | undefined,
    date: params?.date as string | undefined,
    maxDate: params?.maxDate as string | undefined,
    cityId: params?.cityId as string | undefined,
    appointmentTypeId: params?.appointmentTypeId as string | undefined,
    appointmentStyle: params?.appointmentStyle as string | undefined,
    applicationTypeId: params?.applicationTypeId as string | undefined,
    appointmentDate: params?.appointmentDate as string | undefined,
  };
}

/**
 * Phase: api-watcher
 * GetClosedDate HTTP poll — parametreler panel/env'den; wizard navigasyonu yok.
 */
export async function runApiWatcherPhase(
  runtime: ScenarioRuntime,
  params?: ScenarioStepParams,
): Promise<ApiWatcherPhaseResult> {
  const apiSettings = runtime.settings.apiWatcher;
  if (!apiSettings.enabled) {
    return { ok: false, detail: "API_WATCHER_ENABLED=false" };
  }

  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
  const paramOverrides = readParamOverrides(params);
  const workerStore = new WorkerConfigStore(runtime.projectRoot);
  const timingDefaults = {
    pollIntervalMs: apiSettings.pollIntervalMs,
    telegramReportIntervalMs: apiSettings.telegramReportIntervalMs,
  };

  const buildQueryOverrides = (): ApiQueryParamOverrides => {
    const worker = workerStore.getWorker(profile.id, "", timingDefaults);
    return {
      ...paramOverrides,
      dealerOffice: worker.api.dealerOffice,
      appointmentStyle: worker.api.appointmentStyle,
    };
  };

  const queryParams = resolveApiQueryParams(profile, apiSettings, buildQueryOverrides());
  logResolvedApiQueryParams(profile.id, queryParams);

  const bootstrap = await runApiAuthBootstrapPhase(runtime, params);
  if (!bootstrap.ok) {
    return bootstrap;
  }

  const authBearer = getBearerTokenForProfile(runtime);
  if (!authBearer) {
    return { ok: false, detail: "Token yok — api-auth-bootstrap başarısız" };
  }

  if (runtime.session?.context) {
    const appointmentFormUrl = resolveAppointmentFormUrl(runtime.settings.visaPortalHomeUrl);
    const pollTab = await resolvePortalTabForApiPoll(
      runtime.session.context,
      appointmentFormUrl,
      0,
    );
    runtime.session.page = pollTab.page;
    if (pollTab.blocked) {
      return {
        ok: false,
        detail:
          "Cloudflare block — portali elle acmayi deneyin veya birkac saat bekleyin.",
      };
    }
    if (!pollTab.onPortal) {
      return {
        ok: false,
        detail:
          "Portal sekmesi yok — once panel Chrome'unda elle appointmentForm acip giris yapin, sonra watcher baslatin.",
      };
    }
    logger.info(
      `[api-watcher] Poll sekmesi: ${runtime.session.page.url()} — ` +
        `dealerId=${queryParams.dealerId}, typeId=${queryParams.appointmentTypeId}`,
    );
  }

  const resolveFreshQueryParams = (): ReturnType<typeof resolveApiQueryParams> =>
    resolveApiQueryParams(profile, apiSettings, buildQueryOverrides());

  const pollUrl = closedDateUrl(
    {
      projectRoot: runtime.projectRoot,
      profileId: profile.id,
      settings: apiSettings,
      bearerToken: authBearer,
    },
    queryParams,
  );
  logger.info(`[api-watcher] Poll URL: ${pollUrl}`);

  const worker = workerStore.getWorker(profile.id, "", timingDefaults);
  const publicIp = await detectPublicIpForWorker(runtime.projectRoot, profile, worker);
  const lockedIp = normalizeLockedIp(worker.lockedIp) || publicIp;

  const runtimeStore = new WorkerRuntimeStore(runtime.projectRoot);
  runtimeStore.ensure(profile.id, {
    pollIntervalMs: apiSettings.pollIntervalMs,
    telegramReportIntervalMs: apiSettings.telegramReportIntervalMs,
  });

  if (!apiSettings.hourQuotaEnabled) {
    logger.debug(
      "[api-watcher] Saat kotası modülü hazır (checkHourQuota) — API_HOUR_QUOTA_ENABLED=false, tetiklenmiyor.",
    );
  }

  runtime.observeHandles.apiWatcher = startAvailabilityWatcher(
    {
      projectRoot: runtime.projectRoot,
      profileId: profile.id,
      profileName: profile.name,
      lockedIp,
      cdpPort: profile.browser?.cdpPort,
      settings: runtime.settings,
      queryParams,
      page: runtime.session?.page,
      getBearerToken: () => getBearerTokenForProfile(runtime),
      resolveQueryParams: resolveFreshQueryParams,
      resolvePage: async () => {
        if (!runtime.session?.context) {
          return runtime.session?.page;
        }
        const appointmentFormUrl = resolveAppointmentFormUrl(runtime.settings.visaPortalHomeUrl);
        const pollTab = await resolvePortalTabForApiPoll(
          runtime.session.context,
          appointmentFormUrl,
          0,
        );
        runtime.session.page = pollTab.page;
        if (pollTab.blocked) {
          logger.error("[api-watcher] Cloudflare block — poll atlaniyor.");
        }
        return runtime.session.page;
      },
      onUnauthorized: async () => {
        const quick = await tryRefreshTokenFromActivePage(runtime);
        if (quick) {
          return quick;
        }
        logger.warn(
          "[api-watcher] Token gecersiz (401/403) — panel Chrome'unda portali yenileyip giris yapin.",
        );
        return null;
      },
    },
    runtime.settings.telegram,
  );

  if (runtime.settings.apiWatcher.telegramReportEnabled) {
    logger.info("[api-watcher] İlk poll sonucu Telegram'a gönderilecek.");
  }

  logger.info("[api-watcher] Ctrl+C ile durdurun.");
  await waitUntilInterrupted();

  runtime.observeHandles.apiWatcher?.stop();
  runtime.observeHandles.apiWatcher = null;

  return { ok: true, detail: "API watcher durduruldu" };
}
