import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Web Store kopyasından sadece _metadata kaldırılır; key korunur (Chrome 137+ load için). */
export function sanitizeExtensionForUnpackedLoad(extensionDir) {
  const metadataDir = join(extensionDir, "_metadata");
  if (existsSync(metadataDir)) {
    rmSync(metadataDir, { recursive: true, force: true });
  }

  const backgroundPath = join(extensionDir, "background.js");
  if (!existsSync(backgroundPath)) {
    return;
  }

  let background = readFileSync(backgroundPath, "utf-8");
  background = background
    .replace(/recaptcha_auto_open:!1/g, "recaptcha_auto_open:!0")
    .replace(/recaptcha_auto_solve:!1/g, "recaptcha_auto_solve:!0");

  if (!background.includes("chrome.runtime.onStartup")) {
    background = background.replace(
      /\}\)\(\);?$/,
      ";chrome.runtime.onStartup.addListener((async()=>{await chrome.storage.local.set({recaptcha_auto_open:!0,recaptcha_auto_solve:!0,recaptcha_click_delay_time:300,recaptcha_solve_delay_time:1e3})}))})();",
    );
  }

  writeFileSync(backgroundPath, background, "utf-8");
}
