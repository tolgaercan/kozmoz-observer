import {
  runChromeGoogleBootstrap,
  waitAndAcceptChromeProfileSyncPrompt,
} from "../../auth/chromeGoogleBootstrap.js";
import { prepareChromeForAutomation } from "../../browser/chromeStartupPrep.js";
import { isCdpEndpointReady } from "../../browser/cdpConnector.js";
import { ContextFactory } from "../../browser/contextFactory.js";
import { resolveChromeGoogleCredentials } from "../../profiles/profileCredentials.js";
import { logger } from "../../utils/logger.js";
import type { ScenarioRuntime } from "../scenarioRuntime.js";
import type { ScenarioStepParams } from "../types.js";

export interface ChromeLoginPhaseResult {
  ok: boolean;
  detail: string;
}

/**
 * Phase: chrome-login
 * CDP oturumu açar, Google girişi yapar — oturum ScenarioRuntime'da kalır.
 */
export async function runChromeLoginPhase(
  runtime: ScenarioRuntime,
  params?: ScenarioStepParams,
): Promise<ChromeLoginPhaseResult> {
  const attachOnly = params?.attachOnly === true;
  const allowReuseExisting = params?.allowReuseExisting === true;
  const skipSessionInject =
    params?.skipSessionInject === true || runtime.scenarioUsesSystemProfile === true || attachOnly;
  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
  const googleCredentials = resolveChromeGoogleCredentials(profile);

  if (!attachOnly && !googleCredentials.email) {
    throw new Error(
      `[scenario] chrome-login — GOOGLE_EMAIL_${runtime.profileId.replace(/-/g, "_").toUpperCase()} .env'de yok.`,
    );
  }

  if (attachOnly) {
    logger.info("[scenario] chrome-login — attach modu: mevcut CDP sekmesine baglaniliyor.");
    const cdpEndpoint = profile.cdpEndpoint || runtime.settings.cdpEndpoint;
    if (!(await isCdpEndpointReady(cdpEndpoint))) {
      throw new Error(
        "[scenario] chrome-login — CDP hazir degil. Chrome'u kapatmadan CDP modunda acik tutun (port 9222).",
      );
    }
  } else {
    logger.info(
      `[scenario] chrome-login — ${googleCredentials.email!.replace(/(.{2}).*(@.*)/, "$1***$2")}`,
    );
  }

  const contextFactory = new ContextFactory(runtime.profileManager, runtime.settings);
  runtime.session = await contextFactory.launch(profile, {
    skipSession: skipSessionInject,
    skipStealth: attachOnly,
  });

  const { page, context } = runtime.session;

  if (attachOnly) {
    await page.bringToFront();
    const url = page.url();
    logger.info(`[scenario] chrome-login — attach: aktif sekme ${url}`);
    if (!/kosmosvize\.com\.tr/i.test(url)) {
      logger.warn(
        "[scenario] chrome-login — attach: portal sekmesi gorunmuyor. Randevu Al sekmesini one getirin.",
      );
    }
    if (skipSessionInject) {
      logger.info("[scenario] chrome-login — oturum enjeksiyonu atlandi (mevcut Chrome oturumu).");
    }
    return {
      ok: true,
      detail: `Mevcut sayfadan devam (${url})`,
    };
  }

  if (runtime.settings.preGotoDelayMs > 0) {
    await page.waitForTimeout(runtime.settings.preGotoDelayMs);
  }

  await prepareChromeForAutomation(page, context, runtime.settings);

  const result = await runChromeGoogleBootstrap(page, googleCredentials, profile, {
    allowReuseExisting,
  });

  await waitAndAcceptChromeProfileSyncPrompt(page, profile.name, { timeoutMs: 45_000 });

  if (!result.ready) {
    throw new Error("[scenario] chrome-login — Google oturumu doğrulanamadı.");
  }

  return {
    ok: true,
    detail: `Google oturum açık (signedIn=${result.signedInOnGoogle})`,
  };
}
