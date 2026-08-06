import type { AppSettings } from "../config/settings.js";
import type { ProfileDefinition, ResolvedProfile } from "../profiles/profileManager.js";
import {
  parseExpensesCoveredByEnv,
  parseLivingCostsEnv,
  parseSponsorInfoEnv,
  type ExpensesCoveredByValue,
  type SponsorInfoValue,
} from "./registerFormCatalogs.js";

const ENV_PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

export interface RegisterExpensesData {
  coveredBy: ExpensesCoveredByValue;
  livingCosts: string[];
  sponsorInfo: SponsorInfoValue;
}

function resolveEnvPlaceholder(value: string): string {
  const match = ENV_PLACEHOLDER.exec(value.trim());
  if (!match) {
    return value;
  }
  return process.env[match[1]!] ?? "";
}

function pickString(...candidates: (string | undefined)[]): string {
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }
    const resolved = resolveEnvPlaceholder(trimmed).trim();
    if (resolved) {
      return resolved;
    }
  }
  return "";
}

function profileEnvKey(profileId: string, fieldBase: string): string {
  return `${fieldBase}_${profileId.replace(/-/g, "_").toUpperCase()}`;
}

function readManifestExpenses(profile: ProfileDefinition): Record<string, string | undefined> {
  const form = profile.form as Record<string, string | undefined> | undefined;
  return form ?? {};
}

export function resolveRegisterExpenses(
  profile: ResolvedProfile,
  _settings: AppSettings,
): RegisterExpensesData {
  const manifest = readManifestExpenses(profile);
  const id = profile.id;

  const coveredRaw = pickString(
    process.env[profileEnvKey(id, "EXPENSES_COVERED_BY")],
    manifest.expensesCoveredBy,
    process.env.EXPENSES_COVERED_BY,
    "self",
  );

  const livingCostsRaw = pickString(
    process.env[profileEnvKey(id, "APPLICANTS_LIVING_COSTS")],
    manifest.applicantsLivingCosts,
    process.env.APPLICANTS_LIVING_COSTS,
    "Kredi Kartı",
  );

  const sponsorRaw = pickString(
    process.env[profileEnvKey(id, "SPONSOR_INFO_TYPE")],
    manifest.sponsorInfoType,
    process.env.SPONSOR_INFO_TYPE,
    "3132",
  );

  return {
    coveredBy: parseExpensesCoveredByEnv(coveredRaw),
    livingCosts: parseLivingCostsEnv(livingCostsRaw),
    sponsorInfo: parseSponsorInfoEnv(sponsorRaw),
  };
}

export function validateRegisterExpenses(data: RegisterExpensesData, profileId: string): string[] {
  const errors: string[] = [];
  if (data.coveredBy === "gecimMasraflariHayir" && data.livingCosts.length === 0) {
    errors.push(`Profil "${profileId}": APPLICANTS_LIVING_COSTS en az bir seçenek (self yolu)`);
  }
  return errors;
}

export function maskRegisterExpenses(data: RegisterExpensesData): RegisterExpensesData {
  return data;
}
