import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSettings, type ObserverPhase } from "./config/settings.js";
import { ProfileQueue } from "./profiles/profileQueue.js";
import { Observer } from "./observer/observer.js";
import { runPreflight } from "./preflight/preflightCheck.js";
import { logger } from "./utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

interface CliArgs {
  profile?: string;
  flow?: string;
  listProfiles: boolean;
  listFlows: boolean;
  homeUrl?: string;
  pauseOnReady: boolean;
  phase?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    listProfiles: false,
    listFlows: false,
    pauseOnReady: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--profile" || arg === "-p") {
      args.profile = argv[++i];
    } else if (arg === "--flow" || arg === "-f") {
      args.flow = argv[++i];
    } else if (arg === "--list-profiles" || arg === "-l") {
      args.listProfiles = true;
    } else if (arg === "--list-flows") {
      args.listFlows = true;
    } else if (arg === "--url" || arg === "-u") {
      args.homeUrl = argv[++i];
    } else if (arg === "--pause") {
      args.pauseOnReady = true;
    } else if (arg === "--phase") {
      args.phase = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
Kozmoz Observer — Vize Portalı Playwright Botu

Kullanım:
  npm run observer -- [seçenekler]

Seçenekler:
  -p, --profile <id|index>   Profil ID veya sıra numarası (örn: profile-1 veya 0)
  -f, --flow <flow-id>       Akış ID (örn: kosmos-observe-v1)
  -l, --list-profiles        Tanımlı profilleri listele
      --list-flows           Tanımlı akışları listele
  -u, --url <url>            Ana sayfa URL'i
      --pause                  Sayfa hazır olunca Enter ile devam et
      --phase <full|chrome-profile>  Calisma asamasi (varsayilan: full)
  -h, --help                 Bu yardım metni

Profil kuyruğu:
  data/profile-queue.json    activeProfileId + sıra ( --profile verilmezse kullanılır)
  data/profile-pool.json     İleride eklenecek profiller

Örnekler:
  npm run observer -- --profile profile-1 --phase chrome-profile --pause
  OBSERVER_PHASE=full npm run observer -- --profile profile-1
  npm run observer -- --list-flows

Dosyalar:
  docs/ARCHITECTURE.md       Mimari tasarım ve yol haritası
  data/profiles/manifest.json
`);
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const settings = loadSettings(PROJECT_ROOT);
  const observer = new Observer(settings);

  if (cli.listProfiles) {
    observer.listAvailableProfiles();
    return;
  }

  if (cli.listFlows) {
    observer.listAvailableFlows();
    return;
  }

  try {
    const profileQueue = new ProfileQueue(PROJECT_ROOT);
    const profileRef = profileQueue.resolveProfileRef(cli.profile);

    const preflight = await runPreflight(PROJECT_ROOT, profileRef, cli.flow);
    for (const warning of preflight.warnings) {
      logger.warn(`[preflight] ${warning}`);
    }
    if (!preflight.ready) {
      for (const error of preflight.errors) {
        logger.error(`[preflight] ${error}`);
      }
      process.exit(1);
    }
    logger.info("[preflight] Session dosyaları, profil ve akış yapılandırması hazır.");

    const state = await observer.start({
      profileRef,
      flowRef: cli.flow,
      homeUrl: cli.homeUrl,
      pauseOnReady: cli.pauseOnReady,
      phase: cli.phase as ObserverPhase | undefined,
    });

    const activePhase = cli.phase ?? settings.observerPhase;

    if (activePhase === "chrome-profile") {
      logger.info("Chrome profil asamasi tamamlandi.");
      await observer.stop({ keepBrowserPage: true });
      return;
    }

    logger.info(
      `Observer oturumu aktif (${state.profile.id}, akış: ${state.flowId}). Çıkış için Ctrl+C.`,
    );

    process.on("SIGINT", async () => {
      logger.info("Kapatılıyor...");
      await observer.stop();
      process.exit(0);
    });

    await new Promise<void>(() => {});
  } catch (error) {
    logger.error("Observer başlatılamadı.", error);
    const activePhase = cli.phase ?? settings.observerPhase;
    await observer.stop({ keepBrowserPage: activePhase === "chrome-profile" });
    process.exit(1);
  }
}

main();
