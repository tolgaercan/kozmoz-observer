import { isRegisterFormPage } from "../../register/registerFormWizardDetector.js";
import { loadSession } from "../../session/sessionLoader.js";
import { runPortalBootstrap } from "../../auth/portalBootstrapRunner.js";
import { resolveProfileCredentials } from "../../profiles/profileCredentials.js";
import { logger } from "../../utils/logger.js";
import {
  resolveRegisterEnableCodeRequest,
} from "../../register/registerFormStep9EmailVerification.js";
import { runRegisterFormSetup } from "../../register/registerFormRunner.js";
import { persistPortalStorage } from "../../session/sessionPersister.js";
import type { ScenarioRuntime } from "../scenarioRuntime.js";
import type { ScenarioStepParams } from "../types.js";

export interface RegisterWizardPhaseResult {
  ok: boolean;
  detail: string;
}

/**
 * Phase: register-wizard
 * Kayıt formu wizard (Adım 1–9).
 * continueFromCurrentPage=true ise davet URL'sinden devam eder (portal bootstrap yok).
 */
export async function runRegisterWizardPhase(
  runtime: ScenarioRuntime,
  params?: ScenarioStepParams,
): Promise<RegisterWizardPhaseResult> {
  if (!runtime.session) {
    throw new Error("[scenario] register-wizard — önce chrome-login çalışmalı (oturum yok).");
  }

  const { page, context } = runtime.session;
  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
  const credentials = resolveProfileCredentials(profile);
  const homeUrl = runtime.settings.visaPortalHomeUrl;
  const continueFromCurrentPage = params?.continueFromCurrentPage === true;

  const sessionPaths = runtime.profileManager.toSessionPaths(profile);
  if (!continueFromCurrentPage) {
    await loadSession(context, page, sessionPaths, {
      skipCookies: false,
      skipStorage: false,
    });
    logger.info("[scenario] register-wizard — portal session enjekte edildi.");

    logger.info("[scenario] register-wizard — portal bootstrap...");
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await runPortalBootstrap(page, credentials);
  } else if (await isRegisterFormPage(page)) {
    logger.info(`[scenario] register-wizard — mevcut kayıt formundan devam: ${page.url()}`);
  } else {
    logger.warn("[scenario] register-wizard — kayıt formu görünmüyor, portal-url-login sonrası bekleniyordu.");
  }

  const enableCodeRequest = resolveRegisterEnableCodeRequest({});
  logger.info(`[scenario] register-wizard — wizard (enableCodeRequest=${enableCodeRequest})...`);

  const result = await runRegisterFormSetup(page, profile, runtime.settings, {
    homeUrl,
    softValidate: false,
    enableCodeRequest,
    maxRounds: 20,
  });

  if (!result.emailVerificationStepReached) {
    throw new Error(
      `[scenario] register-wizard — Adım 9'a ulaşılamadı (progress=${result.progressStep ?? "?"}).`,
    );
  }

  await persistPortalStorage(page, sessionPaths.storageFile);

  return {
    ok: true,
    detail: `Adım 9 hazır (progress=${result.progressStep})`,
  };
}
