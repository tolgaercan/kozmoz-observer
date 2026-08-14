import {
  runChromeGoogleBootstrap,
  waitAndAcceptChromeProfileSyncPrompt,
} from "../../auth/chromeGoogleBootstrap.js";
import { prepareChromeForAutomation } from "../../browser/chromeStartupPrep.js";
import { findPortalTab, ensureCdpNavigablePage, isCdpEndpointReady } from "../../browser/cdpConnector.js";
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
  const banSafe = runtime.banSafe;
  const liteConnect = attachOnly || banSafe;
  const allowReuseExisting = params?.allowReuseExisting === true;
  const skipSessionInject =
    params?.skipSessionInject === true ||
    runtime.scenarioUsesSystemProfile === true ||
    liteConnect;
  const profile = runtime.profileManager.resolveProfile(runtime.profileId, runtime.settings);
  const googleCredentials = resolveChromeGoogleCredentials(profile);

  if (!liteConnect && !googleCredentials.email) {
    throw new Error(
      `[scenario] chrome-login — Panel Chrome profilinde email tanımlı değil (${runtime.profileId}).`,
    );
  }

  if (liteConnect) {
    logger.info(
      `[scenario] chrome-login — ${attachOnly ? "attach" : "banSafe"} modu: CDP'ye baglaniliyor (Google goto yok).`,
    );
    const cdpEndpoint = profile.cdpEndpoint || runtime.settings.cdpEndpoint;
    if (!(await isCdpEndpointReady(cdpEndpoint))) {
      throw new Error(
        "[scenario] chrome-login — CDP hazir degil. Once panelden «Chrome Ac» ile tarayiciyi acin.",
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
    skipStealth: liteConnect,
  });

  const { page, context } = runtime.session;

  if (liteConnect) {
    const portalPage = await findPortalTab(context);
    const activePage =
      portalPage ?? (await ensureCdpNavigablePage(context, page));
    runtime.session.page = activePage;

    if (portalPage) {
      await portalPage.bringToFront();
      logger.info(`[scenario] chrome-login — lite: portal sekmesi korundu (${portalPage.url()})`);
    } else {
      logger.info(`[scenario] chrome-login — lite: aktif sekme ${page.url() || "about:blank"}`);
      logger.warn(
        "[scenario] chrome-login — lite: portal sekmesi yok; panel Chrome'unda elle appointmentForm acin.",
      );
    }
    if (skipSessionInject) {
      logger.info("[scenario] chrome-login — oturum enjeksiyonu atlandi (mevcut Chrome oturumu).");
    }
    return {
      ok: true,
      detail: `${attachOnly ? "Attach" : "banSafe"} — CDP baglandi (${activePage.url()})`,
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
