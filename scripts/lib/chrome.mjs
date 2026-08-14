import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function log(message) {
  console.log(`[chrome:debug] ${message}`);
}

export function getPlatform() {
  if (process.platform === "win32") {
    return "win32";
  }
  if (process.platform === "darwin") {
    return "darwin";
  }
  return "linux";
}

export function resolveSystemChromeUserDataDir() {
  if (process.env.FIXED_BROWSER_USER_DATA_DIR?.trim()) {
    return resolve(process.env.FIXED_BROWSER_USER_DATA_DIR.trim());
  }

  const plat = getPlatform();
  if (plat === "darwin") {
    return join(homedir(), "Library", "Application Support", "Google", "Chrome");
  }
  if (plat === "linux") {
    return join(homedir(), ".config", "google-chrome");
  }

  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) {
    return join(localAppData, "Google", "Chrome", "User Data");
  }
  return join(homedir(), "AppData", "Local", "Google", "Chrome", "User Data");
}

function chromeCandidates() {
  const plat = getPlatform();
  if (plat === "win32") {
    return [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    ];
  }
  if (plat === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      join(homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
}

function whichChrome() {
  try {
    const cmd = getPlatform() === "win32" ? "where chrome" : "command -v google-chrome || command -v google-chrome-stable || command -v chromium";
    const output = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    }).trim();
    const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first && existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

export function resolveChromeExecutable() {
  const fromEnv = process.env.CHROME_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }

  for (const candidate of chromeCandidates()) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return whichChrome();
}

export function isChromeRunning() {
  try {
    if (getPlatform() === "win32") {
      const output = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return output.toLowerCase().includes("chrome.exe");
    }

    if (getPlatform() === "darwin") {
      execSync('pgrep -f "Google Chrome"', { stdio: ["pipe", "pipe", "pipe"] });
      return true;
    }

    execSync("pgrep -f 'google-chrome|chromium'", { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

export function killChromeProcesses() {
  try {
    if (getPlatform() === "win32") {
      execSync("taskkill /F /IM chrome.exe /T", { stdio: ["pipe", "pipe", "pipe"] });
      return;
    }
    if (getPlatform() === "darwin") {
      execSync('killall -9 "Google Chrome"', { stdio: ["pipe", "pipe", "pipe"] });
      return;
    }
    execSync("pkill -9 -f 'google-chrome|chromium' || true", {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });
  } catch {
    // zaten kapalı olabilir
  }
}

export async function isCdpEndpointReady(endpoint) {
  const bases = [
    endpoint.replace(/\/$/, ""),
    "http://127.0.0.1:9222",
    "http://localhost:9222",
  ];
  const unique = [...new Set(bases)];

  for (const base of unique) {
    try {
      const response = await fetch(`${base}/json/version`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // sonraki endpoint
    }
  }

  return false;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForCdp(port, attempts = 20) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  for (let i = 1; i <= attempts; i++) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        return true;
      }
    } catch {
      log(`CDP bekleniyor (${i}/${attempts})...`);
    }
    await sleep(1000);
  }
  return false;
}

function cleanChromeExitState(userDataDir) {
  const prefsPath = join(userDataDir, "Default", "Preferences");
  if (!existsSync(prefsPath)) {
    return;
  }

  let content = readFileSync(prefsPath, "utf-8");
  content = content.replace(/"exit_type"\s*:\s*"Crashed"/g, '"exit_type":"Normal"');
  content = content.replace(/"exited_cleanly"\s*:\s*false/g, '"exited_cleanly":true');
  writeFileSync(prefsPath, content, "utf-8");
  log("Chrome çıkış durumu temizlendi.");
}

function readProfileFromManifest(projectRoot, profileId) {
  const manifestPath = join(projectRoot, "data", "profiles", "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest bulunamadı: ${manifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const profileDef = (manifest.profiles || []).find((item) => item.id === profileId);
  if (!profileDef) {
    throw new Error(`Profil bulunamadı: ${profileId}`);
  }

  return profileDef;
}

export async function launchChromeDebug(options) {
  const {
    projectRoot,
    profileId,
    fresh = process.env.CHROME_FRESH_PROFILE === "true",
    maximized = process.env.CHROME_START_MAXIMIZED !== "false",
    useSystemProfile = process.env.CHROME_USE_SYSTEM_PROFILE === "true",
    skipIfCdpReady = true,
  } = options;

  const profileDef = readProfileFromManifest(projectRoot, profileId);
  const port = String(
    profileDef.browser?.cdpPort || process.env.CDP_PORT?.trim() || "9222",
  );
  const cdpEndpoint = `http://127.0.0.1:${port}`;

  if (skipIfCdpReady && (await isCdpEndpointReady(cdpEndpoint))) {
    log(`CDP zaten açık (${cdpEndpoint}) — yeni Chrome açılmadı.`);
    return { port, userDataDir: "", skipped: true };
  }

  const chromeExe = resolveChromeExecutable();
  if (!chromeExe) {
    throw new Error(
      "Google Chrome bulunamadı. Chrome kurun veya .env içinde CHROME_PATH=... tanımlayın.",
    );
  }

  const chromeProfileDirectory =
    process.env.CHROME_PROFILE_DIRECTORY?.trim() ||
    profileDef.browser?.profileDirectory ||
    "Default";

  let userDataDir;
  if (useSystemProfile) {
    userDataDir = resolveSystemChromeUserDataDir();
    log("Mod: SİSTEM Chrome profili (kişisel oturum)");
    log("  ÖNEMLİ: Normal Chrome pencerelerini kapatın.");
  } else {
    const relative =
      profileDef.browser?.userDataDir || profileDef.userDataDir || `data/chrome/${profileId}`;
    userDataDir = resolve(projectRoot, relative);
    log("Mod: izole Chrome profili (data/chrome/...)");
  }

  if (fresh && useSystemProfile) {
    throw new Error("CHROME_FRESH_PROFILE=true sistem Chrome profili ile kullanılamaz.");
  }

  log("Bu profil için Chrome açılıyor (diğer Chrome pencereleri kapatılmıyor)...");

  if (fresh) {
    if (existsSync(userDataDir)) {
      rmSync(userDataDir, { recursive: true, force: true });
      log("Temiz Chrome profili: eski klasör silindi.");
    }
    mkdirSync(userDataDir, { recursive: true });
    log("Yeni boş Chrome profil klasörü oluşturuldu.");
  } else {
    mkdirSync(userDataDir, { recursive: true });
    cleanChromeExitState(userDataDir);
  }

  const chromeArgs = [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${chromeProfileDirectory}`,
    "--disable-infobars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
  ];

  if (maximized) {
    chromeArgs.push("--start-maximized");
    log("Pencere: tam ekran (start-maximized)");
  }

  chromeArgs.push(process.env.CHROME_STARTUP_URL?.trim() || "about:blank");

  log("Chrome CDP başlatılıyor...");
  log(`  OS        : ${getPlatform()}`);
  log(`  Chrome    : ${chromeExe}`);
  log(`  Profil ID : ${profileId}`);
  log(`  Port      : ${port}`);
  log(`  UserData  : ${userDataDir}`);
  log(`  ProfileDir: ${chromeProfileDirectory}`);

  const child = spawn(chromeExe, chromeArgs, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();

  const ready = await waitForCdp(port);
  if (!ready) {
    throw new Error(`CDP portu açılmadı (${port}). Chrome debug modunda başlamadı.`);
  }

  log("CDP hazır!");
  return { port, userDataDir, skipped: false };
}
