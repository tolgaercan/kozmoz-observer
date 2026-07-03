import type { Locator, Page } from "playwright";

import type { HumanMouseOptions } from "./humanMouse.js";
import { humanClickLocator } from "./humanClick.js";
import { humanScrollToLocator } from "./humanScroll.js";
import { logger } from "../utils/logger.js";

export interface HumanSelectOptions extends HumanMouseOptions {
  locatorTimeoutMs?: number;
  /** Pipe ile ayrılmış scroll hedefleri parse edilip buraya verilir */
  scrollAnchorSelectors?: string[];
  pauseBeforeSelectMs?: number;
  pauseAfterSelectMs?: number;
}

function randomIn(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function resolveScrollAnchor(
  page: Page,
  selectLocator: Locator,
  scrollAnchorSelectors?: string[],
): Promise<{ locator: Locator; label: string }> {
  const candidates = scrollAnchorSelectors ?? [];

  for (const selector of candidates) {
    const candidate = page.locator(selector).first();
    try {
      await candidate.waitFor({ state: "attached", timeout: 3000 });
      return { locator: candidate, label: selector };
    } catch {
      logger.debug(`Scroll hedefi yok: ${selector}`);
    }
  }

  return { locator: selectLocator, label: "select" };
}

function normalizeCityName(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr-TR");
}

function cityNamesMatch(optionText: string, cityLabel: string): boolean {
  const option = normalizeCityName(optionText);
  const target = normalizeCityName(cityLabel);
  return option === target || option.startsWith(target) || target.startsWith(option);
}

async function listOptionLabels(locator: Locator): Promise<string[]> {
  const options = await locator.locator("option").allInnerTexts();
  return options.map((raw) => raw.replace(/\s+/g, " ").trim()).filter(Boolean);
}

async function findOptionLabel(locator: Locator, cityLabel: string): Promise<string> {
  const options = await listOptionLabels(locator);

  for (const normalized of options) {
    if (cityNamesMatch(normalized, cityLabel)) {
      return normalized;
    }
  }

  const preview = options.slice(0, 8).join(", ") || "—";
  throw new Error(
    `Select içinde il bulunamadı: "${cityLabel}". Mevcut seçenekler (ilk 8): ${preview}`,
  );
}

async function waitForCityOption(
  locator: Locator,
  cityLabel: string,
  timeoutMs: number,
): Promise<string> {
  const started = Date.now();
  let lastOptions: string[] = [];
  let lastLoggedSec = -1;

  while (Date.now() - started < timeoutMs) {
    lastOptions = await listOptionLabels(locator);
    const hasRealCities =
      lastOptions.length > 1 &&
      lastOptions.some((option) => !/^tümü$/i.test(option) && option.length > 1);

    if (hasRealCities) {
      try {
        return await findOptionLabel(locator, cityLabel);
      } catch {
        // Liste doldu ama hedef il henüz yok — kısa süre daha bekle
      }
    }

    const elapsedSec = Math.floor((Date.now() - started) / 1000);
    if (elapsedSec >= 5 && elapsedSec % 5 === 0 && elapsedSec !== lastLoggedSec) {
      lastLoggedSec = elapsedSec;
      logger.info(
        `İl listesi bekleniyor (${elapsedSec}s) — seçenek sayısı: ${lastOptions.length}`,
      );
    }

    await locator.page().waitForTimeout(400);
  }

  const preview = lastOptions.slice(0, 8).join(", ") || "—";
  throw new Error(
    `İl listesi zaman aşımı (${cityLabel}). Son seçenekler: ${preview}`,
  );
}

async function readSelectedLabel(locator: Locator): Promise<string> {
  return (
    (await locator
      .locator("option:checked")
      .first()
      .innerText({ timeout: 5000 })
      .catch(() => "")) || ""
  ).trim();
}

async function verifyCitySelected(locator: Locator, exactLabel: string): Promise<boolean> {
  const selected = (await readSelectedLabel(locator)).replace(/\s+/g, " ").trim();
  return cityNamesMatch(selected, exactLabel);
}

async function getCityOptionIndex(selectLocator: Locator, exactLabel: string): Promise<number> {
  return selectLocator.first().evaluate((select, city) => {
    const target = city.trim().toLocaleLowerCase("tr-TR");
    const options = Array.from((select as HTMLSelectElement).options);
    return options.findIndex(
      (option) =>
        option.textContent?.replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR") === target,
    );
  }, exactLabel);
}

/** Native select: option DOM'da görünmez — klavye ile seç (insan gibi) */
async function selectCityViaKeyboardIndex(
  page: Page,
  selectLocator: Locator,
  exactLabel: string,
): Promise<boolean> {
  const optionIndex = await getCityOptionIndex(selectLocator, exactLabel);
  if (optionIndex < 0) {
    return false;
  }

  logger.info(`Dropdown klavye (↑↓) ile seçiliyor: ${exactLabel} (index: ${optionIndex})`);

  await selectLocator.first().focus();
  await page.waitForTimeout(randomIn(100, 200));

  await page.keyboard.press("Home");
  await page.waitForTimeout(randomIn(80, 150));

  for (let step = 0; step < optionIndex; step++) {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(randomIn(45, 90));
  }

  await page.waitForTimeout(randomIn(120, 250));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(randomIn(200, 400));

  return verifyCitySelected(selectLocator, exactLabel);
}

async function selectCityViaTypeAhead(
  page: Page,
  selectLocator: Locator,
  exactLabel: string,
): Promise<boolean> {
  logger.info(`Dropdown type-ahead ile deneniyor: ${exactLabel}`);

  await selectLocator.first().focus();
  await page.waitForTimeout(randomIn(80, 160));
  await page.keyboard.type(exactLabel, { delay: randomIn(70, 130) });
  await page.waitForTimeout(randomIn(120, 220));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(randomIn(200, 380));

  return verifyCitySelected(selectLocator, exactLabel);
}

/** Dropdown açıkken seçim — native select için klavye öncelikli */
async function clickCityInOpenDropdown(
  page: Page,
  selectLocator: Locator,
  exactLabel: string,
  options: HumanSelectOptions,
): Promise<boolean> {
  const quickClickOpts = {
    ...options,
    waitTimeoutMs: 4000,
  };

  // Custom UI: görünür liste elemanı varsa tıkla (kısa timeout)
  const visibleCandidates = [
    page.locator(".select-city").getByText(exactLabel, { exact: true }),
    page.getByRole("option", { name: exactLabel }),
  ];

  for (const candidate of visibleCandidates) {
    try {
      const target = candidate.first();
      if ((await target.count()) > 0 && (await target.isVisible())) {
        logger.info(`Dropdown listesinden tıklanıyor (görünür UI): ${exactLabel}`);
        await humanClickLocator(page, target, {
          ...quickClickOpts,
          label: `liste: ${exactLabel}`,
          settleDelayMs: randomIn(120, 280),
        });
        if (await verifyCitySelected(selectLocator, exactLabel)) {
          return true;
        }
      }
    } catch {
      // sonraki aday
    }
  }

  // Native <select>: option görünür değil — klavye index (birincil)
  if (await selectCityViaKeyboardIndex(page, selectLocator, exactLabel)) {
    return true;
  }

  if (await selectCityViaTypeAhead(page, selectLocator, exactLabel)) {
    return true;
  }

  return false;
}

async function selectCityFallback(
  selectLocator: Locator,
  exactLabel: string,
  pauseAfterMs: number,
): Promise<void> {
  logger.info(`Klavye seçimi olmadı — selectOption yedek: ${exactLabel}`);
  await selectLocator.first().selectOption({ label: exactLabel });
  await selectLocator.first().dispatchEvent("change");
  await selectLocator.page().waitForTimeout(randomIn(120, 220));
  await selectLocator.page().keyboard.press("Escape");
  await selectLocator.page().waitForTimeout(pauseAfterMs);
}

export async function humanSelectOptionByLabel(
  page: Page,
  locator: Locator,
  cityLabel: string,
  options: HumanSelectOptions = {},
): Promise<void> {
  const timeoutMs = options.locatorTimeoutMs ?? 60_000;

  await locator.first().waitFor({ state: "attached", timeout: timeoutMs });

  const { locator: scrollAnchor, label: scrollLabel } = await resolveScrollAnchor(
    page,
    locator,
    options.scrollAnchorSelectors,
  );

  // 1) Önce insan gibi scroll — il listesi dolmasını beklemeden hedef alana in
  await humanScrollToLocator(page, scrollAnchor, `il kutusu (${scrollLabel})`, {
    timeoutMs,
  });

  await page.waitForTimeout(randomIn(400, 900));

  await locator.first().waitFor({ state: "visible", timeout: timeoutMs });

  // 2) Liste dolana kadar bekle
  const exactLabel = await waitForCityOption(locator, cityLabel, timeoutMs);
  logger.info(`İl seçeneği bulundu: ${exactLabel}`);

  // 3) Select tam ortada mı — gerekirse ince ayar scroll
  await humanScrollToLocator(page, locator, `#cities → ${exactLabel}`, {
    timeoutMs: Math.min(timeoutMs, 20_000),
    maxSteps: 18,
  });

  // 4) Select'i aç → listeden ile tıkla (dropdown kapanır)
  await humanClickLocator(page, locator, {
    ...options,
    waitTimeoutMs: timeoutMs,
    label: `#cities`,
    settleDelayMs: options.pauseBeforeSelectMs ?? randomIn(280, 720),
  });

  await page.waitForTimeout(randomIn(180, 350));

  const selectedViaList = await clickCityInOpenDropdown(page, locator, exactLabel, options);

  if (!selectedViaList) {
    await selectCityFallback(
      locator,
      exactLabel,
      options.pauseAfterSelectMs ?? randomIn(200, 480),
    );
  } else {
    await page.waitForTimeout(options.pauseAfterSelectMs ?? randomIn(200, 480));
  }

  const selected = await readSelectedLabel(locator);
  if (!cityNamesMatch(selected, exactLabel)) {
    throw new Error(
      `İl seçilemedi. Beklenen: "${exactLabel}", seçilen: "${selected || "—"}"`,
    );
  }

  logger.info(
    `İl seçildi (${selectedViaList ? "klavye/liste" : "selectOption yedek"}): ${selected}`,
  );
}

export async function humanSelectCity(
  page: Page,
  selectLocator: string,
  cityLabel: string,
  options: HumanSelectOptions = {},
): Promise<void> {
  const locator = page.locator(selectLocator).first();
  await humanSelectOptionByLabel(page, locator, cityLabel, options);
}
