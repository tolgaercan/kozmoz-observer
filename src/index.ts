import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSettings } from "./config/settings.js";
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
  -f, --flow <flow-id>       Test senaryosu / akış ID (örn: kosmos-bireysel-standart)
  -l, --list-profiles        Tanımlı profilleri listele
      --list-flows           Tanımlı akışları (test senaryolarını) listele
  -u, --url <url>            Ana sayfa URL'i (.env yerine geçersiz)
      --pause                  Sayfa hazır olunca Enter ile devam et
  -h, --help                 Bu yardım metni

Örnekler:
  npm run observer -- --profile profile-1
  npm run observer -- --flow kosmos-bireysel-standart --profile profile-1
  npm run observer -- -p 0 -f kosmos-bireysel-standart
  npm run observer -- --list-flows

Profil / akış dosyaları:
  data/profiles/manifest.json     Profil + form fixture tanımları
  src/flows/*.flow.ts             Test senaryoları (akış spec'leri)
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
    const preflight = await runPreflight(PROJECT_ROOT, cli.profile, cli.flow);
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
      profileRef: cli.profile,
      flowRef: cli.flow,
      homeUrl: cli.homeUrl,
      pauseOnReady: cli.pauseOnReady,
    });

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
    await observer.stop();
    process.exit(1);
  }
}

main();
