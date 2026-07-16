import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface TelegramSettings {
  enabled: boolean;
  botToken: string;
  chatId: string;
  notifyOnResolved: boolean;
  notifyCooldownMs: number;
  /** Antivirüs/kurumsal proxy TLS kesintisinde true yapın */
  tlsInsecure: boolean;
}

export interface InterventionSettings {
  challengeMaxWaitMs: number;
  loginMaxWaitMs: number;
  pollIntervalMs: number;
  continuousWatchIntervalMs: number;
}

export interface NavigationSettings {
  enabled: boolean;
  /** Her adım: pipe (|) ile ayrılmış fallback locator listesi */
  steps: string[];
  waitAfterLoadMs: number;
  waitBetweenStepsMs: number;
  locatorTimeoutMs: number;
  minStepDelayMs: number;
  maxStepDelayMs: number;
  overshootProbability: number;
}

export interface AppointmentSettings {
  citySelectEnabled: boolean;
  /** Varsayılan il — profil manifest'teki appointmentCity önceliklidir */
  defaultCity: string;
  citySelectLocator: string;
  cityScrollLocator: string;
  selectedCityHeaderLocator: string;
  citySelectTimeoutMs: number;
  waitAfterNavMs: number;
  waitAfterCitySelectMs: number;
  blankClickEnabled: boolean;
  locationButtonEnabled: boolean;
  locationButtonContainer: string;
  locationButtonSelector: string;
  wizardNextEnabled: boolean;
  wizardNextLocator: string;
  waitBeforeWizardNextMs: number;
  applicationTypeEnabled: boolean;
  /** Varsayılan başvuru tipi — profil manifest applicationType önceliklidir */
  defaultApplicationType: string;
  applicationTypeLocator: string;
  applicationTypeTimeoutMs: number;
  waitAfterWizardNextMs: number;
  nationalityNumberEnabled: boolean;
  /** Varsayılan TC — profil manifest nationalityNumber önceliklidir */
  defaultNationalityNumber: string;
  nationalityNumberLocator: string;
  nationalityNumberTimeoutMs: number;
  waitAfterApplicationTypeMs: number;
  nationalityNumberBlankClickEnabled: boolean;
  waitAfterNationalityNumberMs: number;
  appointmentStyleEnabled: boolean;
  /** Varsayılan başvuru şekli — profil manifest appointmentStyle önceliklidir */
  defaultAppointmentStyle: string;
  appointmentStyleLocator: string;
  appointmentStyleTimeoutMs: number;
  waitAfterNationalityForStyleMs: number;
  typeMinCharDelayMs: number;
  typeMaxCharDelayMs: number;
  typeGroupPauseEveryChars: number;
  typeGroupPauseMinMs: number;
  typeGroupPauseMaxMs: number;
  wizardNavLocator: string;
  wizardAutoRecoverEnabled: boolean;
  wizardRecoverCheckIntervalMs: number;
  waitAfterWizardStepMs: number;
  slotWatchEnabled: boolean;
  slotWatchIntervalMs: number;
  slotCalendarLocator: string;
  slotAvailableCellSelector: string;
  slotNotifyOnChange: boolean;
  slotNotifyOnEmpty: boolean;
  slotNotifyCooldownMs: number;
  /** Mevcut aydan kaç ay ileri taranacak (1 = mevcut + sonraki ay) */
  slotMonthsAhead: number;
  slotMonthNavWaitMs: number;
  slotCalendarNextLocator: string;
  slotCalendarPrevLocator: string;
  slotVerifyByClick: boolean;
  slotVerifyMode: "always" | "single-only" | "never";
  slotDayClickWaitMs: number;
  slotTimeButtonSelector: string;
  slotEmptyTimeMessage: string;
  slotEmptyTimeMessageLocator: string;
  recaptchaWaitMs: number;
  recaptchaPollIntervalMs: number;
  recaptchaProactiveRefreshEnabled: boolean;
  recaptchaProactiveRefreshIntervalMs: number;
  recaptchaProactiveRefreshMode: "month-nav" | "wizard-nav" | "off";
  recaptchaProactiveWaitMs: number;
  /** Çözülmüş token bu kadar taze ise proaktif ay oku yenilemesi yapılmaz */
  recaptchaProactiveMinTokenAgeMs: number;
  captchaRecoveryEnabled: boolean;
  captchaRecoveryTryPreviousNext: boolean;
  captchaRecoveryTryRefresh: boolean;
  captchaRecoveryStepWaitMs: number;
  wizardPreviousLocator: string;
  minStepDelayMs: number;
  maxStepDelayMs: number;
  overshootProbability: number;
}

export interface PostCityFlowResult {
  city: string;
  applicationType?: string;
  nationalityNumber?: string;
  appointmentStyle?: string;
  wizardStep?: number;
}

export type BrowserConnectMethod = "launch" | "cdp";

export type ObserverPhase = "full" | "chrome-profile";

export interface AppSettings {
  visaPortalHomeUrl: string;
  defaultProfileId: string;
  /** Varsayılan test senaryosu / akış ID */
  defaultFlowId: string;
  projectRoot: string;
  manifestPath: string;
  browserMode: "fixed" | "isolated";
  /** launch = Playwright Chrome başlatır | cdp = açık Chrome'a bağlanır (CF için önerilir) */
  browserConnectMethod: BrowserConnectMethod;
  cdpEndpoint: string;
  /** CDP + fixed modda bile manifest browser.userDataDir kullan */
  cdpUseManifestProfile: boolean;
  /** Observer başında chrome://profile-picker */
  chromeProfileGateEnabled: boolean;
  chromeStartupUrl: string;
  /** true: CDP baglantida portal cerezlerini yukleme */
  chromeFreshStart: boolean;
  /** true: her chrome:debug'de user-data sifirlanir (temiz Chrome profili) */
  chromeFreshProfile: boolean;
  /** full = tum akis | chrome-profile = Chrome ac + Google giris + google.com */
  observerPhase: ObserverPhase;
  cdpPort: number;
  fixedBrowser: FixedBrowserSettings | null;
  useChromeChannel: boolean;
  preGotoDelayMs: number;
  telegram: TelegramSettings;
  intervention: InterventionSettings;
  navigation: NavigationSettings;
  appointment: AppointmentSettings;
}

export interface FixedBrowserSettings {
  /** Playwright userDataDir — doğrudan Default/Profile 1 klasörü */
  profilePath: string;
  profileDirectory: string;
}

function loadEnvFile(projectRoot: string): void {
  const envPath = resolve(projectRoot, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseFloatEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseRecaptchaProactiveMode(
  raw: string | undefined,
): "month-nav" | "wizard-nav" | "off" {
  const value = raw?.trim().toLowerCase();
  if (value === "wizard-nav" || value === "wizard") {
    return "wizard-nav";
  }
  if (value === "off" || value === "false" || value === "none") {
    return "off";
  }
  return "month-nav";
}

function parseSlotVerifyMode(raw: string | undefined): "always" | "single-only" | "never" {
  const value = raw?.trim().toLowerCase();
  if (value === "always") {
    return "always";
  }
  if (value === "never" || value === "false" || value === "off") {
    return "never";
  }
  return "single-only";
}

function resolveDefaultChromeUserDataDir(): string {
  if (process.env.LOCALAPPDATA) {
    return resolve(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data");
  }
  return resolve(process.env.USERPROFILE ?? "", "AppData", "Local", "Google", "Chrome", "User Data");
}

function resolveChromeFreshProfile(env: NodeJS.ProcessEnv): boolean {
  const explicit = env.CHROME_FRESH_PROFILE?.trim();
  if (explicit === "true") {
    return true;
  }
  if (explicit === "false") {
    return false;
  }
  return (env.BROWSER_MODE ?? "isolated") === "isolated";
}

function resolveChromeProfileGateEnabled(env: NodeJS.ProcessEnv): boolean {
  const explicit = env.CHROME_PROFILE_GATE_ENABLED?.trim();
  if (explicit === "true") {
    return true;
  }
  if (explicit === "false") {
    return false;
  }
  return (env.BROWSER_MODE ?? "isolated") !== "isolated";
}

function loadFixedBrowserSettings(): FixedBrowserSettings | null {
  const browserMode = (process.env.BROWSER_MODE ?? "fixed") as "fixed" | "isolated";
  if (browserMode !== "fixed") {
    return null;
  }

  const userDataRoot =
    process.env.FIXED_BROWSER_USER_DATA_DIR?.trim() || resolveDefaultChromeUserDataDir();
  const profileDirectory = process.env.CHROME_PROFILE_DIRECTORY?.trim() || "Default";
  const profilePath = join(userDataRoot, profileDirectory);

  return { profilePath, profileDirectory };
}

const DEFAULT_NAV_STEP_1 =
  "li.nav-link a[href='/appointmentProcedures']:visible|a[href='/appointmentProcedures']:visible|li.nav-link span.nav-item-title:has-text('Randevu İşlemleri')";
const DEFAULT_NAV_STEP_2 =
  "a.tab-link:visible:has-text('Randevu Al')|a[href='/appointmentForm']:visible|a:visible:has-text('Randevu Al')";

function loadNavigationSteps(): string[] {
  const navSteps = process.env.NAV_STEPS?.trim();
  if (navSteps) {
    return navSteps
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  const step1 = process.env.NAV_TARGET_LOCATOR?.trim() || DEFAULT_NAV_STEP_1;
  const step2Raw = process.env.NAV_STEP_2_LOCATOR?.trim();

  if (step2Raw === "false" || step2Raw === "off") {
    return [step1];
  }

  return [step1, step2Raw || DEFAULT_NAV_STEP_2];
}

export function loadSettings(projectRoot: string): AppSettings {
  loadEnvFile(projectRoot);

  return {
    visaPortalHomeUrl: process.env.VISA_PORTAL_HOME_URL ?? "https://example-visa-portal.com/",
    defaultProfileId: process.env.DEFAULT_PROFILE_ID ?? "profile-1",
    defaultFlowId: process.env.DEFAULT_FLOW_ID ?? "kosmos-observe-v1",
    projectRoot,
    manifestPath: resolve(projectRoot, "data/profiles/manifest.json"),
    browserMode: (process.env.BROWSER_MODE ?? "isolated") as "fixed" | "isolated",
    browserConnectMethod: (process.env.BROWSER_CONNECT ?? "cdp") as BrowserConnectMethod,
    cdpEndpoint: process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9222",
    cdpUseManifestProfile: process.env.CDP_USE_MANIFEST_PROFILE !== "false",
    chromeProfileGateEnabled: resolveChromeProfileGateEnabled(process.env),
    chromeStartupUrl: process.env.CHROME_STARTUP_URL?.trim() || "about:blank",
    chromeFreshStart: process.env.CHROME_FRESH_START === "true",
    chromeFreshProfile: resolveChromeFreshProfile(process.env),
    observerPhase: (process.env.OBSERVER_PHASE?.trim() || "full") as ObserverPhase,
    cdpPort: parseIntEnv("CDP_PORT", 9222),
    fixedBrowser: loadFixedBrowserSettings(),
    useChromeChannel: process.env.BROWSER_CHANNEL !== "chromium",
    preGotoDelayMs: parseIntEnv("PRE_GOTO_DELAY_MS", 2500),
    telegram: {
      enabled: process.env.TELEGRAM_ENABLED !== "false",
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
      chatId: process.env.TELEGRAM_CHAT_ID ?? "",
      notifyOnResolved: process.env.TELEGRAM_NOTIFY_ON_RESOLVED !== "false",
      notifyCooldownMs: parseIntEnv("TELEGRAM_NOTIFY_COOLDOWN_MS", 300_000),
      tlsInsecure: process.env.TELEGRAM_TLS_INSECURE === "true",
    },
    intervention: {
      challengeMaxWaitMs: parseIntEnv("CAPTCHA_MAX_WAIT_MS", 180_000),
      loginMaxWaitMs: parseIntEnv("INTERVENTION_LOGIN_WAIT_MS", 1_800_000),
      pollIntervalMs: parseIntEnv("CAPTCHA_POLL_INTERVAL_MS", 4000),
      continuousWatchIntervalMs: parseIntEnv("CAPTCHA_WATCH_INTERVAL_MS", 8000),
    },
    navigation: {
      enabled: process.env.AUTO_NAV_ENABLED !== "false",
      steps: loadNavigationSteps(),
      waitAfterLoadMs: parseIntEnv("NAV_WAIT_AFTER_LOAD_MS", 600),
      waitBetweenStepsMs: parseIntEnv("NAV_WAIT_BETWEEN_STEPS_MS", 900),
      locatorTimeoutMs: parseIntEnv("NAV_LOCATOR_TIMEOUT_MS", 60_000),
      minStepDelayMs: parseIntEnv("HUMAN_MOUSE_MIN_STEP_MS", 4),
      maxStepDelayMs: parseIntEnv("HUMAN_MOUSE_MAX_STEP_MS", 14),
      overshootProbability: parseFloatEnv("HUMAN_MOUSE_OVERSHOOT_PROB", 0.18),
    },
    appointment: {
      citySelectEnabled: process.env.AUTO_CITY_SELECT_ENABLED !== "false",
      defaultCity: process.env.APPOINTMENT_CITY?.trim() ?? "Ankara",
      citySelectLocator:
        process.env.CITY_SELECT_LOCATOR?.trim() ?? "#cities|select[name='cities']|div.select-city select",
      cityScrollLocator:
        process.env.CITY_SCROLL_LOCATOR?.trim() ?? "div.select-city|#cities",
      selectedCityHeaderLocator:
        process.env.APPOINTMENT_HEADER_LOCATOR?.trim() ??
        "div.sp-blue-header|text=Seçilen İl",
      citySelectTimeoutMs: parseIntEnv("CITY_SELECT_TIMEOUT_MS", 60_000),
      waitAfterNavMs: parseIntEnv("CITY_WAIT_AFTER_NAV_MS", 1200),
      waitAfterCitySelectMs: parseIntEnv("CITY_WAIT_AFTER_SELECT_MS", 700),
      blankClickEnabled: process.env.APPOINTMENT_BLANK_CLICK_ENABLED !== "false",
      locationButtonEnabled: process.env.LOCATION_BUTTON_ENABLED !== "false",
      locationButtonContainer:
        process.env.LOCATION_BUTTON_CONTAINER?.trim() ?? "#buttonContainer",
      locationButtonSelector:
        process.env.LOCATION_BUTTON_SELECTOR?.trim() ?? ".sp-selectable-button",
      wizardNextEnabled: process.env.WIZARD_NEXT_ENABLED !== "false",
      wizardNextLocator:
        process.env.WIZARD_NEXT_LOCATOR?.trim() ??
        "button.wizard-btn:has-text('Sonraki')|.wizard-footer-right button:has-text('Sonraki')|role=button[name='Sonraki']",
      waitBeforeWizardNextMs: parseIntEnv("WIZARD_NEXT_WAIT_MS", 600),
      applicationTypeEnabled: process.env.APPLICATION_TYPE_ENABLED !== "false",
      defaultApplicationType: process.env.APPLICATION_TYPE?.trim() ?? "Bireysel",
      applicationTypeLocator:
        process.env.APPLICATION_TYPE_LOCATOR?.trim() ??
        "select[name='applicationTypeId']|select.form-select:has(option:text('Bireysel'))",
      applicationTypeTimeoutMs: parseIntEnv("APPLICATION_TYPE_TIMEOUT_MS", 30_000),
      waitAfterWizardNextMs: parseIntEnv("APPLICATION_TYPE_WAIT_AFTER_NEXT_MS", 800),
      nationalityNumberEnabled: process.env.NATIONALITY_NUMBER_ENABLED !== "false",
      defaultNationalityNumber: process.env.NATIONALITY_NUMBER?.trim() ?? "",
      nationalityNumberLocator:
        process.env.NATIONALITY_NUMBER_LOCATOR?.trim() ??
        "input[name='nationalityNumber']|input.form-control[name='nationalityNumber']",
      nationalityNumberTimeoutMs: parseIntEnv("NATIONALITY_NUMBER_TIMEOUT_MS", 30_000),
      waitAfterApplicationTypeMs: parseIntEnv("NATIONALITY_NUMBER_WAIT_AFTER_TYPE_MS", 800),
      nationalityNumberBlankClickEnabled:
        process.env.NATIONALITY_NUMBER_BLANK_CLICK_ENABLED !== "false",
      waitAfterNationalityNumberMs: parseIntEnv("NATIONALITY_NUMBER_WAIT_AFTER_INPUT_MS", 400),
      appointmentStyleEnabled: process.env.APPOINTMENT_STYLE_ENABLED !== "false",
      defaultAppointmentStyle: process.env.APPOINTMENT_STYLE?.trim() ?? "Standart",
      appointmentStyleLocator:
        process.env.APPOINTMENT_STYLE_LOCATOR?.trim() ??
        "select[name='appointmentTypeId']|select.form-select:has(option:text('Standart'))",
      appointmentStyleTimeoutMs: parseIntEnv("APPOINTMENT_STYLE_TIMEOUT_MS", 30_000),
      waitAfterNationalityForStyleMs: parseIntEnv("APPOINTMENT_STYLE_WAIT_AFTER_TC_MS", 600),
      typeMinCharDelayMs: parseIntEnv("HUMAN_TYPE_MIN_CHAR_MS", 95),
      typeMaxCharDelayMs: parseIntEnv("HUMAN_TYPE_MAX_CHAR_MS", 200),
      typeGroupPauseEveryChars: parseIntEnv("HUMAN_TYPE_GROUP_EVERY_CHARS", 3),
      typeGroupPauseMinMs: parseIntEnv("HUMAN_TYPE_GROUP_PAUSE_MIN_MS", 220),
      typeGroupPauseMaxMs: parseIntEnv("HUMAN_TYPE_GROUP_PAUSE_MAX_MS", 520),
      wizardNavLocator:
        process.env.WIZARD_NAV_LOCATOR?.trim() ?? "ul.wizard-nav-pills|ul.wizard-nav",
      wizardAutoRecoverEnabled: process.env.WIZARD_AUTO_RECOVER_ENABLED !== "false",
      wizardRecoverCheckIntervalMs: parseIntEnv("WIZARD_RECOVER_CHECK_INTERVAL_MS", 12_000),
      waitAfterWizardStepMs: parseIntEnv("WIZARD_WAIT_AFTER_STEP_MS", 900),
      slotWatchEnabled: process.env.SLOT_WATCH_ENABLED !== "false",
      slotWatchIntervalMs: parseIntEnv("SLOT_WATCH_INTERVAL_MS", 60_000),
      slotCalendarLocator:
        process.env.SLOT_CALENDAR_LOCATOR?.trim() ?? ".dp__calendar|div.dp__main",
      slotAvailableCellSelector:
        process.env.SLOT_AVAILABLE_CELL_SELECTOR?.trim() ?? ".dp__cell_inner.dp__pointer",
      slotNotifyOnChange: process.env.SLOT_NOTIFY_ON_CHANGE === "true",
      slotNotifyOnEmpty: process.env.SLOT_NOTIFY_ON_EMPTY === "true",
      slotNotifyCooldownMs: parseIntEnv("SLOT_NOTIFY_COOLDOWN_MS", 120_000),
      slotMonthsAhead: parseIntEnv("SLOT_MONTHS_AHEAD", 1),
      slotMonthNavWaitMs: parseIntEnv("SLOT_MONTH_NAV_WAIT_MS", 800),
      slotCalendarNextLocator:
        process.env.SLOT_CALENDAR_NEXT_LOCATOR?.trim() ??
        "button[data-dp-element='action-next']|button[aria-label='Next month']",
      slotCalendarPrevLocator:
        process.env.SLOT_CALENDAR_PREV_LOCATOR?.trim() ??
        "button[data-dp-element='action-prev']|button[aria-label='Previous month']",
      slotVerifyByClick: process.env.SLOT_VERIFY_BY_CLICK !== "false",
      slotVerifyMode: parseSlotVerifyMode(process.env.SLOT_VERIFY_MODE),
      slotDayClickWaitMs: parseIntEnv("SLOT_DAY_CLICK_WAIT_MS", 900),
      slotTimeButtonSelector:
        process.env.SLOT_TIME_BUTTON_SELECTOR?.trim() ??
        ".appointment-hours-container button.btn|.appointment-hours-container button",
      slotEmptyTimeMessage:
        process.env.SLOT_EMPTY_TIME_MESSAGE?.trim() ?? "Bu gün için randevu bulunmamaktadır",
      slotEmptyTimeMessageLocator:
        process.env.SLOT_EMPTY_TIME_MESSAGE_LOCATOR?.trim() ??
        "text=Bu gün için randevu bulunmamaktadır",
      recaptchaWaitMs: parseIntEnv("RECAPTCHA_WAIT_MS", 90_000),
      recaptchaPollIntervalMs: parseIntEnv("RECAPTCHA_POLL_INTERVAL_MS", 2500),
      recaptchaProactiveRefreshEnabled: process.env.RECAPTCHA_PROACTIVE_REFRESH_ENABLED !== "false",
      recaptchaProactiveRefreshIntervalMs: parseIntEnv("RECAPTCHA_PROACTIVE_REFRESH_INTERVAL_MS", 45_000),
      recaptchaProactiveRefreshMode: parseRecaptchaProactiveMode(
        process.env.RECAPTCHA_PROACTIVE_REFRESH_MODE,
      ),
      recaptchaProactiveWaitMs: parseIntEnv("RECAPTCHA_PROACTIVE_WAIT_MS", 30_000),
      recaptchaProactiveMinTokenAgeMs: parseIntEnv("RECAPTCHA_PROACTIVE_MIN_TOKEN_AGE_MS", 50_000),
      captchaRecoveryEnabled: process.env.CAPTCHA_RECOVERY_ENABLED !== "false",
      captchaRecoveryTryPreviousNext: process.env.CAPTCHA_RECOVERY_TRY_PREV_NEXT !== "false",
      captchaRecoveryTryRefresh: process.env.CAPTCHA_RECOVERY_TRY_REFRESH !== "false",
      captchaRecoveryStepWaitMs: parseIntEnv("CAPTCHA_RECOVERY_STEP_WAIT_MS", 1500),
      wizardPreviousLocator:
        process.env.WIZARD_PREVIOUS_LOCATOR?.trim() ??
        "button.wizard-btn:has-text('Önceki')|.wizard-footer-left button:has-text('Önceki')|role=button[name='Önceki']",
      minStepDelayMs: parseIntEnv("HUMAN_MOUSE_MIN_STEP_MS", 4),
      maxStepDelayMs: parseIntEnv("HUMAN_MOUSE_MAX_STEP_MS", 14),
      overshootProbability: parseFloatEnv("HUMAN_MOUSE_OVERSHOOT_PROB", 0.18),
    },
  };
}
