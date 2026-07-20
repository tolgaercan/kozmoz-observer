import type { AppSettings } from "../config/settings.js";
import { ProfileManager } from "../profiles/profileManager.js";
import { validateRegisterEnvForProfile } from "../register/validateRegisterEnv.js";
import { humanPause } from "../interaction/humanPacing.js";
import { logger } from "../utils/logger.js";
import { runChromeConnectPhase } from "./phases/chromeConnect.js";
import { runChromeFreshPhase } from "./phases/chromeFresh.js";
import { runChromeLoginPhase } from "./phases/chromeLogin.js";
import { runObservePhase } from "./phases/observe.js";
import { runPortalInviteGatePhase } from "./phases/portalInviteGate.js";
import { runPortalUrlLoginPhase } from "./phases/portalUrlLogin.js";
import { runRandevuNavigatePhase } from "./phases/randevuNavigate.js";
import { runApiAuthBootstrapPhase } from "./phases/apiAuthBootstrap.js";
import { runApiWatcherPhase } from "./phases/apiWatcher.js";
import { runRegisterWizardPhase } from "./phases/registerWizard.js";
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

/**
 * Senaryo motoru — JSON'daki steps sırasıyla phase çalıştırır.
 * chrome-login sonrası oturum açık kalır; sonraki adımlar aynı sekmeyi kullanır.
 */
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
    logger.info(
      "[scenario] banSafe modu — CDP kill/Google goto/gereksiz nav atlanir (observe-attach benzeri).",
    );
  }

  if (scenario.steps.some((s) => s.phase === "register-wizard")) {
    const envErrors = validateRegisterEnvForProfile(options.profileId);
    if (envErrors.length > 0) {
      throw new Error(`Kayıt alanları eksik:\n${envErrors.join("\n")}`);
    }
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
    logger.info("[scenario] attach modu — mevcut CDP sekmesine baglanilir (chrome-connect yok).");
  }
  logger.info(`════════════════════════════════════════════`);

  if (scenario.status === "experimental") {
    logger.warn("[scenario] Deneysel senaryo — bazı adımlar OTP vb. nedeniyle tamamlanmayabilir.");
  }

  const stepResults: ScenarioStepResult[] = [];

  try {
    for (let i = 0; i < stepsToRun.length; i++) {
      const step = stepsToRun[i]!;
      const label = step.label ?? step.phase;
      logger.info(`[scenario] ▶ (${i + 1}/${stepsToRun.length}) ${label}`);

      const result = await executePhase(step, projectRoot, runtime);

      stepResults.push({
        phase: step.phase,
        ok: result.ok,
        detail: result.detail,
      });

      logger.info(`[scenario] ${result.ok ? "✓" : "✗"} ${step.phase} — ${result.detail ?? "ok"}`);

      if (runtime.session?.page && i < stepsToRun.length - 1) {
        await humanPause(runtime.session.page, 1800, 4000, "Sonraki adim oncesi");
      }

      if (!result.ok && step.phase === "observe" && step.params?.afterRegister) {
        logger.warn("[scenario] Beklenen durum — OTP çözülünce senaryo 4 (url-login-observe) kullanın.");
        break;
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
  projectRoot: string,
  runtime: ScenarioRuntime,
): Promise<{ ok: boolean; detail?: string }> {
  const { phase, params } = step;

  switch (phase) {
    case "chrome-fresh":
      return runChromeFreshPhase(projectRoot, runtime.profileId);

    case "chrome-connect": {
      const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
      return runChromeConnectPhase(projectRoot, runtime.profileId, {
        ...params,
        skipIfCdpReady: runtime.banSafe || params?.skipIfCdpReady === true,
        cdpEndpoint: profile.cdpEndpoint || runtime.settings.cdpEndpoint,
      });
    }

    case "chrome-login":
      return runChromeLoginPhase(runtime, params);

    case "portal-url-login":
      return runPortalUrlLoginPhase(runtime, params);

    case "portal-invite-gate":
      return runPortalInviteGatePhase(runtime);

    case "randevu-navigate":
      return runRandevuNavigatePhase(runtime);

    case "register-wizard":
      return runRegisterWizardPhase(runtime, params);

    case "observe":
      return runObservePhase(runtime, {
        ...params,
        attachOnly: params?.attachOnly === true || runtime.banSafe,
      });

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
