import type { AppSettings } from "../config/settings.js";
import { ProfileManager } from "../profiles/profileManager.js";
import { humanPause } from "../interaction/humanPacing.js";
import { logger } from "../utils/logger.js";
import { runChromeConnectPhase } from "./phases/chromeConnect.js";
import { runChromeFreshPhase } from "./phases/chromeFresh.js";
import { runChromeLoginPhase } from "./phases/chromeLogin.js";
import { runApiAuthBootstrapPhase } from "./phases/apiAuthBootstrap.js";
import { runApiWatcherPhase } from "./phases/apiWatcher.js";
import { loadScenario } from "./scenarioLoader.js";
import { ScenarioRuntime } from "./scenarioRuntime.js";
import type {
  ScenarioPhaseId,
  ScenarioRunOptions,
  ScenarioRunResult,
  ScenarioStep,
  ScenarioStepResult,
} from "./types.js";

export interface ScenarioRunOutcome {
  result: ScenarioRunResult;
  runtime: ScenarioRuntime;
}

/** API watcher senaryoları — JSON steps sırasıyla phase çalıştırır. */
export async function runScenario(
  projectRoot: string,
  settings: AppSettings,
  options: ScenarioRunOptions,
): Promise<ScenarioRunOutcome> {
  const scenario = loadScenario(projectRoot, options.scenarioId);
  const profileManager = new ProfileManager(projectRoot, settings.manifestPath);
  const runtime = new ScenarioRuntime(
    projectRoot,
    settings,
    profileManager,
    options.profileId,
    options,
  );

  runtime.scenarioUsesSystemProfile = scenario.steps.some(
    (step) => step.phase === "chrome-connect" && step.params?.useSystemProfile === true,
  );
  runtime.banSafe = options.banSafe === true || scenario.banSafe === true;

  if (runtime.scenarioUsesSystemProfile) {
    logger.info("[scenario] Sistem Chrome profili — chrome-login oturum enjeksiyonu atlanacak.");
  }
  if (runtime.banSafe) {
    logger.info("[scenario] banSafe modu — gereksiz navigasyon atlanır.");
  }

  const stepsToRun = options.stopAfterPhase
    ? truncateAtPhase(scenario.steps, options.stopAfterPhase)
    : scenario.steps;

  logger.info(`════════════════════════════════════════════`);
  logger.info(`[scenario] ${scenario.id} — ${scenario.name}`);
  if (scenario.status) {
    logger.info(`[scenario] durum: ${scenario.status}`);
  }
  if (scenario.note) {
    logger.info(`[scenario] not: ${scenario.note}`);
  }
  logger.info(`[scenario] profil: ${options.profileId}`);
  logger.info(`[scenario] adımlar: ${stepsToRun.map((s) => s.phase).join(" → ")}`);
  if (options.stopAfterPhase) {
    logger.info(`[scenario] durma noktası: ${options.stopAfterPhase} sonrası`);
  }
  if (options.attach) {
    logger.info("[scenario] attach modu — mevcut CDP sekmesine bağlanılır.");
  }
  logger.info(`════════════════════════════════════════════`);

  const stepResults: ScenarioStepResult[] = [];

  try {
    for (let i = 0; i < stepsToRun.length; i++) {
      const step = stepsToRun[i]!;
      const label = step.label ?? step.phase;
      logger.info(`[scenario] ▶ (${i + 1}/${stepsToRun.length}) ${label}`);

      const result = await executePhase(step, runtime);

      stepResults.push({
        phase: step.phase,
        ok: result.ok,
        detail: result.detail,
      });

      logger.info(`[scenario] ${result.ok ? "✓" : "✗"} ${step.phase} — ${result.detail ?? "ok"}`);

      if (runtime.session?.page && i < stepsToRun.length - 1) {
        await humanPause(runtime.session.page, 1800, 4000, "Sonraki adim oncesi");
      }
    }

    const ready = stepResults.every((s) => s.ok);
    logger.info(`[scenario] ${ready ? "TAMAM" : "KISMEN"} — ${scenario.id} (${options.profileId})`);
    return {
      result: {
        scenarioId: scenario.id,
        profileId: options.profileId,
        steps: stepResults,
        ready,
      },
      runtime,
    };
  } finally {
    if (!options.keepBrowserOpen) {
      await runtime.closeSession();
    }
  }
}

function truncateAtPhase(steps: ScenarioStep[], stopAfter: ScenarioPhaseId): ScenarioStep[] {
  const index = steps.findIndex((s) => s.phase === stopAfter);
  if (index < 0) {
    throw new Error(
      `stopAfterPhase "${stopAfter}" senaryoda yok. Adımlar: ${steps.map((s) => s.phase).join(", ")}`,
    );
  }
  return steps.slice(0, index + 1);
}

async function executePhase(
  step: ScenarioStep,
  runtime: ScenarioRuntime,
): Promise<{ ok: boolean; detail?: string }> {
  const { phase, params } = step;

  switch (phase) {
    case "chrome-fresh":
      return runChromeFreshPhase(runtime.projectRoot, runtime.profileId);

    case "chrome-connect": {
      const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
      return runChromeConnectPhase(runtime.projectRoot, runtime.profileId, {
        ...params,
        skipIfCdpReady: runtime.banSafe || params?.skipIfCdpReady === true,
        cdpEndpoint: profile.cdpEndpoint || runtime.settings.cdpEndpoint,
      });
    }

    case "chrome-login":
      return runChromeLoginPhase(runtime, params);

    case "api-auth-bootstrap":
      return runApiAuthBootstrapPhase(runtime, params);

    case "api-watcher":
      return runApiWatcherPhase(runtime, params);

    default: {
      const _exhaustive: never = phase;
      throw new Error(`Phase henüz yok: ${String(_exhaustive)}`);
    }
  }
}
