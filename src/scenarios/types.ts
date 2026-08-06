/**
 * Senaryo = adım listesi (recipe).
 * Aktif: api-watcher-attach (chrome-login → api-auth-bootstrap → api-watcher)
 * Eski UI/register senaryoları: archive/legacy-src/scenarios/
 */

export type ScenarioPhaseId =
  | "chrome-fresh"
  | "chrome-connect"
  | "chrome-login"
  | "api-auth-bootstrap"
  | "api-watcher";

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
  status?: ScenarioStatus;
  note?: string;
  banSafe?: boolean;
  steps: ScenarioStep[];
}

export interface ScenarioRunOptions {
  scenarioId: string;
  profileId: string;
  pauseAtEnd?: boolean;
  stopAfterPhase?: ScenarioPhaseId;
  keepBrowserOpen?: boolean;
  attach?: boolean;
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
