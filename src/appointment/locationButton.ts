import type { Locator, Page } from "playwright";

import type { AppointmentSettings } from "../config/settings.js";
import { humanClickLocator } from "../interaction/humanClick.js";
import { humanScrollToLocator } from "../interaction/humanScroll.js";
import { logger } from "../utils/logger.js";

function normalizeLocationName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");
}

function locationNamesMatch(buttonText: string, cityName: string): boolean {
  return normalizeLocationName(buttonText) === normalizeLocationName(cityName);
}

async function listButtonLabels(buttons: Locator): Promise<string[]> {
  const count = await buttons.count();
  const labels: string[] = [];
  for (let index = 0; index < count; index++) {
    const text = (await buttons.nth(index).innerText()).replace(/\s+/g, " ").trim();
    if (text) {
      labels.push(text);
    }
  }
  return labels;
}

async function resolveLocationButton(
  page: Page,
  cityName: string,
  settings: AppointmentSettings,
): Promise<{ locator: Locator; label: string }> {
  const timeoutMs = settings.citySelectTimeoutMs;
  const containerSelectors = settings.locationButtonContainer
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  let lastLabels: string[] = [];

  for (const containerSelector of containerSelectors) {
    const container = page.locator(containerSelector).first();
    try {
      await container.waitFor({ state: "visible", timeout: timeoutMs });
    } catch {
      continue;
    }

    const buttons = container.locator(settings.locationButtonSelector);
    await buttons.first().waitFor({ state: "visible", timeout: timeoutMs }).catch(() => undefined);

    const count = await buttons.count();
    const exactMatches: Locator[] = [];

    for (let index = 0; index < count; index++) {
      const button = buttons.nth(index);
      const text = (await button.innerText()).replace(/\s+/g, " ").trim();
      if (locationNamesMatch(text, cityName)) {
        exactMatches.push(button);
      }
    }

    if (exactMatches.length === 1) {
      return { locator: exactMatches[0], label: cityName };
    }

    if (exactMatches.length > 1) {
      for (const button of exactMatches) {
        const sectionText = await button
          .locator("xpath=ancestor::div[contains(@class,'col-')][1]")
          .innerText()
          .catch(() => "");
        if (/Merkezimiz/i.test(sectionText)) {
          logger.info(`Birden fazla "${cityName}" butonu — Merkezimiz bölümü seçildi.`);
          return { locator: button, label: `${cityName} (Merkez)` };
        }
      }
      logger.warn(`Birden fazla "${cityName}" butonu — ilki seçiliyor.`);
      return { locator: exactMatches[0], label: cityName };
    }

    lastLabels = await listButtonLabels(buttons);
  }

  throw new Error(
    `"${cityName}" merkez/şube butonu bulunamadı. Görünen butonlar: ${lastLabels.join(", ") || "—"}`,
  );
}

/** appointmentCity ile eşleşen merkez/şube kartına insan gibi tıkla */
export async function clickAppointmentLocationButton(
  page: Page,
  cityName: string,
  settings: AppointmentSettings,
): Promise<void> {
  if (!settings.locationButtonEnabled) {
    logger.info("Merkez/şube tıklaması kapalı — LOCATION_BUTTON_ENABLED=false");
    return;
  }

  logger.info(`Merkez/şube butonu aranıyor (isim): ${cityName}`);

  const { locator, label } = await resolveLocationButton(page, cityName, settings);

  await humanScrollToLocator(page, locator, `Konum butonu: ${label}`, {
    timeoutMs: settings.citySelectTimeoutMs,
    maxSteps: 25,
  });

  await humanClickLocator(page, locator, {
    ...{
      minStepDelayMs: settings.minStepDelayMs,
      maxStepDelayMs: settings.maxStepDelayMs,
      overshootProbability: settings.overshootProbability,
    },
    waitTimeoutMs: settings.citySelectTimeoutMs,
    label: `Konum: ${label}`,
  });

  logger.info(`Konum butonuna tıklandı: ${label}`);
}
