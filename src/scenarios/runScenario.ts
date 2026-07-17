import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSettings } from "../config/settings.js";
import { logger } from "../utils/logger.js";
import { listScenarios } from "./scenarioLoader.js";
import { runScenario } from "./scenarioRunner.js";
import type { ScenarioPhaseId } from "./types.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function parseArg(argv: string[], name: string, short?: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name || (short && argv[i] === short)) {
      return argv[i + 1];
    }
  }
  return undefined;
}

async function waitForEnter(message: string): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(`\n${message}\n`);
  } finally {
    rl.close();
  }
}

function printHelp(): void {
  console.log(`
Kozmoz Senaryo Runner

Kullanım:
  npm run scenario -- --id <senaryo> --profile <profil>

Örnek:
  npm run scenario -- --id fresh-chrome-login --profile profile-1
  npm run scenario -- --id url-login-observe --profile profile-1
  npm run scenario -- --id url-login-observe --stop-after portal-url-login --open-url-only
  npm run scenario -- --list

Ne nerede:
  data/scenarios/*.json     senaryo tarifleri
  src/scenarios/phases/     her adımın kodu
  src/scenarios/runScenario.ts  bu CLI
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  if (argv.includes("--list") || argv.includes("-l")) {
    const scenarios = listScenarios(PROJECT_ROOT);
    logger.info("Mevcut senaryolar:");
    for (const s of scenarios) {
      const status = s.status ? ` [${s.status}]` : "";
      logger.info(`  ${s.id}${status} — ${s.name}`);
      if (s.note) {
        logger.info(`    ${s.note}`);
      }
      logger.info(`    adımlar: ${s.steps.map((x) => x.phase).join(" → ")}`);
    }
    process.exit(0);
  }

  const scenarioId = parseArg(argv, "--id", "-s") ?? (argv.includes("--attach") ? "observe-attach" : "fresh-chrome-login");
  const profileId = parseArg(argv, "--profile", "-p") ?? "profile-1";
  const stopAfter = parseArg(argv, "--stop-after") as ScenarioPhaseId | undefined;
  const openUrlOnly = argv.includes("--open-url-only");
  const attach = argv.includes("--attach");
  const noWait = argv.includes("--no-wait");
  const keepBrowserOpen = !noWait;

  const settings = loadSettings(PROJECT_ROOT);
  const { result, runtime } = await runScenario(PROJECT_ROOT, settings, {
    scenarioId,
    profileId,
    pauseAtEnd: keepBrowserOpen,
    stopAfterPhase: stopAfter,
    keepBrowserOpen,
    openUrlOnly,
    attach,
  });

  if (!result.ready) {
    logger.error("[scenario] Senaryo tamamlanamadı.");
    if (keepBrowserOpen) {
      await runtime.closeSession();
    }
    process.exit(1);
  }

  logger.info("[scenario] Sonuç:");
  for (const step of result.steps) {
    logger.info(`  ${step.ok ? "✓" : "✗"} ${step.phase}${step.detail ? ` — ${step.detail}` : ""}`);
  }

  if (keepBrowserOpen) {
    const pauseMessage =
      stopAfter === "portal-invite-gate"
        ? "Davet URL tamam (Randevu Islemleri gorunuyorsa OK). Tam akis icin: npm run scenario:url-observe. Bitince Enter."
        : stopAfter === "portal-url-login" || openUrlOnly
          ? "Chrome'da davet URL / OTP ekranını kontrol edin. Tam akış: npm run scenario:url-observe. Enter ile kapat."
          : stopAfter === "randevu-navigate"
            ? "Randevu wizard hazir. Observer icin: npm run scenario:url-observe. Enter ile kapat."
            : "Observer calisiyorsa Ctrl+C; degilse Enter (Chrome acik kalir).";
    await waitForEnter(pauseMessage);
    await runtime.closeSession();
  }
}

main().catch((error) => {
  logger.error("[scenario] Hata:", error instanceof Error ? error.message : error);
  process.exit(1);
});
