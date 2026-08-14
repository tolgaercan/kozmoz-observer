#!/usr/bin/env node
/**
 * Sıfır bağımlılıklı kurulum kapısı — yeni PC'de `npm start` yeterli olsun diye.
 * Node / npm paketleri / .env / klasörler / Chrome yolunu kontrol eder, eksikleri yükler.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launchChromeDebug, resolveChromeExecutable } from "./lib/chrome.mjs";
import { loadEnvFile } from "./lib/env.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_NODE_MAJOR = 18;
const REQUIRED_DIRS = [
  "data/chrome",
  "data/sessions",
  "data/cookies",
  "data/control-panel",
];

function log(level, message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] [bootstrap] ${message}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function nodeMajor() {
  return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
}

function supportsUseSystemCa() {
  const [major, minor] = process.versions.node.split(".").map((part) => Number.parseInt(part, 10));
  return major > 22 || (major === 22 && minor >= 8);
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function packageNeedsInstall() {
  const pkgPath = join(PROJECT_ROOT, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error("package.json bulunamadı.");
  }

  if (!existsSync(join(PROJECT_ROOT, "node_modules"))) {
    return "node_modules yok";
  }

  const pkg = readJson(pkgPath);
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };

  for (const name of Object.keys(deps)) {
    if (!existsSync(join(PROJECT_ROOT, "node_modules", name, "package.json"))) {
      return `eksik paket: ${name}`;
    }
  }

  const tsxCli = join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  if (!existsSync(tsxCli)) {
    return "tsx CLI yok";
  }

  return null;
}

function runNpmInstall() {
  log("info", "npm install çalışıyor...");
  const result = spawnSync(npmCommand(), ["install"], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error("npm install başarısız oldu.");
  }
}

function ensureEnvFile() {
  const envPath = join(PROJECT_ROOT, ".env");
  const examplePath = join(PROJECT_ROOT, ".env.example");

  if (existsSync(envPath)) {
    loadEnvFile(PROJECT_ROOT);
    log("info", ".env bulundu.");
    return { created: false };
  }

  if (!existsSync(examplePath)) {
    throw new Error(".env yok ve .env.example da bulunamadı.");
  }

  copyFileSync(examplePath, envPath);
  loadEnvFile(PROJECT_ROOT);
  log(
    "warn",
    ".env yoktu — .env.example kopyalandı. EMAIL/PASSWORD/TELEGRAM alanlarını doldurun.",
  );
  return { created: true };
}

function ensureDirectories() {
  for (const relative of REQUIRED_DIRS) {
    mkdirSync(join(PROJECT_ROOT, relative), { recursive: true });
  }
  log("info", "Çalışma klasörleri hazır.");
}

function ensureNodeVersion() {
  const major = nodeMajor();
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    throw new Error(
      `Node.js ${MIN_NODE_MAJOR}+ gerekli (şu an: ${process.versions.node}). https://nodejs.org`,
    );
  }
  log("info", `Node.js ${process.versions.node} OK`);
}

function ensureChrome() {
  const chromePath = resolveChromeExecutable();
  if (!chromePath) {
    throw new Error(
      "Google Chrome bulunamadı. Kurun veya .env içinde CHROME_PATH=/tam/yol tanımlayın.",
    );
  }
  log("info", `Chrome: ${chromePath}`);
  return chromePath;
}

export async function ensureProjectReady() {
  if (process.env.SKIP_BOOTSTRAP === "true") {
    loadEnvFile(PROJECT_ROOT);
    log("info", "SKIP_BOOTSTRAP=true — kurulum atlandı.");
    return { skipped: true, envCreated: false };
  }

  log("info", `Proje kökü: ${PROJECT_ROOT}`);
  log("info", `OS: ${process.platform} (${process.arch})`);

  ensureNodeVersion();

  const missingReason = packageNeedsInstall();
  if (missingReason) {
    log("warn", `Bağımlılıklar eksik (${missingReason}) — yükleniyor.`);
    runNpmInstall();
    const stillMissing = packageNeedsInstall();
    if (stillMissing) {
      throw new Error(`npm install sonrası hâlâ eksik: ${stillMissing}`);
    }
  } else {
    log("info", "npm paketleri OK");
  }

  const { created: envCreated } = ensureEnvFile();
  ensureDirectories();
  ensureChrome();

  log("info", "Ortam hazır.");
  return { skipped: false, envCreated };
}

function parseBootstrapArgs(argv) {
  if (argv[0] === "--run") {
    return {
      mode: "run",
      script: argv[1],
      profileId: null,
      fresh: false,
      extra: argv.slice(2),
    };
  }

  const result = {
    mode: "setup",
    script: null,
    profileId: null,
    fresh: false,
    extra: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--start") {
      result.mode = "start";
    } else if (arg === "--chrome") {
      result.mode = result.mode === "start" ? "start" : "chrome";
    } else if (arg === "--setup") {
      result.mode = "setup";
    } else if (arg === "--profile" || arg === "-p" || arg === "-Profile") {
      result.profileId = argv[++i];
    } else if (arg === "--fresh") {
      result.fresh = true;
      process.env.CHROME_FRESH_PROFILE = "true";
    } else if (arg === "--") {
      result.extra.push(...argv.slice(i + 1));
      break;
    } else {
      result.extra.push(arg);
    }
  }

  return result;
}

function resolveProfileId(cliProfile) {
  return (
    cliProfile?.trim() ||
    process.env.DEFAULT_PROFILE_ID?.trim() ||
    "profile-1"
  );
}

function runTsx(scriptRel, extraArgs) {
  const script = resolve(PROJECT_ROOT, scriptRel);
  if (!existsSync(script)) {
    throw new Error(`Çalıştırılacak dosya yok: ${script}`);
  }

  const nodeArgs = [];
  if (supportsUseSystemCa()) {
    nodeArgs.push("--use-system-ca");
  }

  nodeArgs.push(
    join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
    script,
    ...extraArgs,
  );

  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

async function main() {
  const cli = parseBootstrapArgs(process.argv.slice(2));
  await ensureProjectReady();

  const profileId = resolveProfileId(cli.profileId);

  if (cli.mode === "setup") {
    log("info", "Kurulum tamam. Sonraki: npm start");
    return;
  }

  if (cli.mode === "run") {
    if (!cli.script) {
      throw new Error("--run için bir dosya yolu gerekli.");
    }
    runTsx(cli.script, cli.extra);
    return;
  }

  if (cli.mode === "chrome") {
    await launchChromeDebug({
      projectRoot: PROJECT_ROOT,
      profileId,
      fresh: cli.fresh,
      skipIfCdpReady: !cli.fresh,
    });
    return;
  }

  if (cli.mode === "start") {
    log("info", "Control panel başlatılıyor → http://127.0.0.1:8787");
    runTsx("src/control-panel/server.ts", cli.extra);
  }
}

main().catch((error) => {
  log("error", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
