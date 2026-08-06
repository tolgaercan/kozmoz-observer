import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { ScenarioDefinition, ScenarioPhaseId } from "./types.js";

const KNOWN_PHASES = new Set<ScenarioPhaseId>([
  "chrome-fresh",
  "chrome-connect",
  "chrome-login",
  "api-auth-bootstrap",
  "api-watcher",
]);

export function resolveScenariosDir(projectRoot: string): string {
  return resolve(projectRoot, "data/scenarios");
}

export function loadScenario(projectRoot: string, scenarioId: string): ScenarioDefinition {
  const path = join(resolveScenariosDir(projectRoot), `${scenarioId}.json`);
  if (!existsSync(path)) {
    const available = listScenarioIds(projectRoot).join(", ") || "(yok)";
    throw new Error(`Senaryo bulunamadı: "${scenarioId}". Mevcut: ${available}`);
  }

  const raw = JSON.parse(readFileSync(path, "utf-8")) as ScenarioDefinition;
  validateScenario(raw, path);
  return raw;
}

export function listScenarioIds(projectRoot: string): string[] {
  const dir = resolveScenariosDir(projectRoot);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

export function listScenarios(projectRoot: string): ScenarioDefinition[] {
  return listScenarioIds(projectRoot).map((id) => loadScenario(projectRoot, id));
}

function validateScenario(scenario: ScenarioDefinition, path: string): void {
  if (!scenario.id?.trim()) {
    throw new Error(`${path}: id zorunlu`);
  }
  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
    throw new Error(`${path}: steps en az bir adım içermeli`);
  }
  for (const step of scenario.steps) {
    if (!KNOWN_PHASES.has(step.phase)) {
      throw new Error(
        `${path}: bilinmeyen phase "${step.phase}". Bilinen: ${[...KNOWN_PHASES].join(", ")}`,
      );
    }
  }
}
