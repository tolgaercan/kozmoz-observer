#!/usr/bin/env node
/**
 * rektCaptcha unpacked eklentisini extensions/rektcaptcha/ altına kurar.
 *
 * 1) Sistem Chrome'unda Web Store kurulumu varsa kopyalar (en hızlı)
 * 2) Yoksa GitHub kaynağını klonlayıp webpack build çalıştırır
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

import { sanitizeExtensionForUnpackedLoad } from "./lib/rektCaptchaInstall.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const targetDir = resolve(projectRoot, "extensions", "rektcaptcha");
const STORE_IDS = ["bbdhfoclddncoaomddgkaaphcnddbpdh", "bpfdbfnkjelhloljelooneehdalcmljb"];

function log(message) {
  console.log(`[install:rektcaptcha] ${message}`);
}

function hasManifest(dir) {
  return existsSync(join(dir, "manifest.json"));
}

function newestVersionDir(extensionRoot) {
  if (!existsSync(extensionRoot)) {
    return null;
  }

  const dirs = readdirSync(extensionRoot)
    .map((name) => join(extensionRoot, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory() && hasManifest(path);
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  return dirs[0] ?? null;
}

function resolveSystemChromeUserDataDir() {
  if (process.env.FIXED_BROWSER_USER_DATA_DIR?.trim()) {
    return resolve(process.env.FIXED_BROWSER_USER_DATA_DIR.trim());
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Google", "Chrome");
  }
  if (process.platform === "linux") {
    return join(homedir(), ".config", "google-chrome");
  }
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) {
    return join(localAppData, "Google", "Chrome", "User Data");
  }
  return join(homedir(), "AppData", "Local", "Google", "Chrome", "User Data");
}

function copyFromChromeStore() {
  const userDataDir = resolveSystemChromeUserDataDir();
  for (const extensionId of STORE_IDS) {
    const source = newestVersionDir(join(userDataDir, "Default", "Extensions", extensionId));
    if (source) {
      log(`Chrome Web Store kurulumu bulundu: ${source}`);
      rmSync(targetDir, { recursive: true, force: true });
      mkdirSync(targetDir, { recursive: true });
      cpSync(source, targetDir, { recursive: true });
      return true;
    }
  }
  return false;
}

function finalizeInstall(sourceLabel) {
  sanitizeExtensionForUnpackedLoad(targetDir);
  log("Extension hazır (_metadata kaldırıldı, auto-open/solve ayarları patch'lendi).");
  log(`Tamamlandı (${sourceLabel}): ${targetDir}`);
}

function buildFromGitHub() {
  const workDir = resolve(projectRoot, ".runtime", "rektCaptcha-extension");
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  log("GitHub kaynağı klonlanıyor (Wikidepia/rektCaptcha-extension)...");
  execSync(
    "git clone --depth 1 https://github.com/Wikidepia/rektCaptcha-extension.git .",
    { cwd: workDir, stdio: "inherit" },
  );

  log("Bağımlılıklar kuruluyor (birkaç dakika sürebilir)...");
  execSync("npm install", { cwd: workDir, stdio: "inherit" });

  log("Webpack build çalıştırılıyor...");
  execSync("npm run build", { cwd: workDir, stdio: "inherit" });

  const builtDir = join(workDir, "dist");
  if (!hasManifest(builtDir)) {
    throw new Error(`Build sonrası manifest bulunamadı: ${builtDir}`);
  }

  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  cpSync(builtDir, targetDir, { recursive: true });
  return true;
}

function main() {
  if (hasManifest(targetDir)) {
    log(`Zaten kurulu: ${targetDir}`);
    log("Yeniden kurmak için klasörü silin veya --force kullanın.");
    if (!process.argv.includes("--force")) {
      return;
    }
    rmSync(targetDir, { recursive: true, force: true });
  }

  mkdirSync(resolve(projectRoot, "extensions"), { recursive: true });

  if (copyFromChromeStore()) {
    finalizeInstall("Chrome kopyası");
    return;
  }

  log("Chrome Web Store kurulumu bulunamadı — GitHub build deneniyor...");
  buildFromGitHub();
  finalizeInstall("GitHub build");
}

try {
  main();
} catch (error) {
  console.error(`[install:rektcaptcha] Hata: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
