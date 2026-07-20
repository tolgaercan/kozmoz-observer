/**
 * Senaryo = adım listesi (recipe).
 * User = profil + .env verisi (manifest).
 *
 * Klasörler:
 *   data/scenarios/*.json     → senaryo tarifleri
 *   src/scenarios/phases/     → her phase ne yapar
 *   src/scenarios/runScenario.ts → CLI girişi
 */

export type ScenarioPhaseId =
  | "chrome-fresh"
  | "chrome-connect"
  | "chrome-login"
  | "portal-url-login"
  | "portal-invite-gate"
  | "randevu-navigate"
  | "register-wizard"
  | "observe"
  | "api-auth-bootstrap"
  | "api-watcher";

/** Senaryo adımına özel parametreler */
export type ScenarioStepParams = Record<string, unknown>;

export type ScenarioStatus = "active" | "experimental" | "planned";

export interface ScenarioStep {
  phase: ScenarioPhaseId;
  label?: string;
  params?: ScenarioStepParams;
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  description?: string;
  /** active = günlük kullanım, experimental = henüz tam çalışmaz */
  status?: ScenarioStatus;
  note?: string;
  /** observe-attach benzeri: CDP kill yok, Google goto yok, gereksiz navigasyon atlanir */
  banSafe?: boolean;
  steps: ScenarioStep[];
}

export interface ScenarioRunOptions {
  scenarioId: string;
  /** Manifest profil id — örn. profile-1 */
  profileId: string;
  pauseAtEnd?: boolean;
  /** Bu phase'den sonra dur (observe vb. çalışmaz) */
  stopAfterPhase?: ScenarioPhaseId;
  /** true ise finally'de CDP kapatılmaz — CLI Enter sonrası kapatır */
  keepBrowserOpen?: boolean;
  /** portal-url-login: sadece URL aç, bootstrap/OTP bekleme */
  openUrlOnly?: boolean;
  /** Mevcut CDP Chrome sekmesine bağlan — chrome-connect atlanır, navigasyon yok */
  attach?: boolean;
  /** Senaryo JSON'daki banSafe'i override eder */
  banSafe?: boolean;
}

export interface ScenarioStepResult {
  phase: ScenarioPhaseId;
  ok: boolean;
  detail?: string;
}

export interface ScenarioRunResult {
  scenarioId: string;
  profileId: string;
  steps: ScenarioStepResult[];
  ready: boolean;
}
