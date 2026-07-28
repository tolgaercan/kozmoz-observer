import { startAvailabilityWatcher } from "../../api/watcher/watcher.js";
import { closedDateUrl } from "../../api/client/apiService.js";
import { resolveCdpApiPollPage } from "../../browser/cdpConnector.js";
import {
  logResolvedApiQueryParams,
  resolveApiQueryParams,
  type ApiQueryParamOverrides,
} from "../../api/client/resolveApiQueryParams.js";
import { TelegramNotifier } from "../../notifications/telegramNotifier.js";
import { WorkerConfigStore } from "../../control-panel/workerConfigStore.js";
import { detectPublicIp } from "../../control-panel/chromeLauncher.js";
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
  const queryParams = resolveApiQueryParams(profile, apiSettings, paramOverrides);
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
    runtime.session.page = await resolveCdpApiPollPage(runtime.session.context);
    logger.info(
      `[api-watcher] Poll sekmesi: ${runtime.session.page.url()} — ` +
        `dealerId=${queryParams.dealerId}, typeId=${queryParams.appointmentTypeId}`,
    );
  }

  const resolveFreshQueryParams = (): ReturnType<typeof resolveApiQueryParams> =>
    resolveApiQueryParams(profile, apiSettings, paramOverrides);

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

  const workerStore = new WorkerConfigStore(runtime.projectRoot);
  const publicIp = await detectPublicIp(runtime.projectRoot);
  const worker = workerStore.getWorker(profile.id, publicIp);

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
      lockedIp: worker.lockedIp || publicIp,
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
        runtime.session.page = await resolveCdpApiPollPage(runtime.session.context);
        return runtime.session.page;
      },
      onUnauthorized: async () => {
        const quick = await tryRefreshTokenFromActivePage(runtime);
        if (quick) {
          return quick;
        }
        const refreshed = await runApiAuthBootstrapPhase(runtime, {
          ...params,
          skipTokenCache: true,
        });
        if (!refreshed.ok) {
          return null;
        }
        if (runtime.session?.context) {
          runtime.session.page = await resolveCdpApiPollPage(runtime.session.context);
        }
        return getBearerTokenForProfile(runtime);
      },
    },
    runtime.settings.telegram,
  );

  const telegram = new TelegramNotifier(runtime.settings.telegram);
  if (runtime.settings.apiWatcher.telegramReportEnabled && telegram.isConfigured()) {
    const pollMin = Math.round(apiSettings.pollIntervalMs / 60_000);
    await telegram.sendStartupPing(
      profile.id,
      `${queryParams.dealerOfficeLabel ?? "?"} / ${queryParams.appointmentStyleLabel ?? "Standart"}\n` +
        `İlk GetClosedDate sorgusu hemen yapılır; sonraki aralık: ${pollMin} dk`,
      "API Watcher başladı",
    );
  }

  logger.info("[api-watcher] Ctrl+C ile durdurun.");
  await waitUntilInterrupted();

  runtime.observeHandles.apiWatcher?.stop();
  runtime.observeHandles.apiWatcher = null;

  return { ok: true, detail: "API watcher durduruldu" };
}
