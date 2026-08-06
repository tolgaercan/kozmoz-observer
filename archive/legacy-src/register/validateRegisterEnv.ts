import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSettings } from "../config/settings.js";
import { ProfileManager } from "../profiles/profileManager.js";
import { resolveRegisterContact, validateRegisterContact } from "./registerContactData.js";
import { resolveRegisterExpenses, validateRegisterExpenses } from "./registerExpensesData.js";
import { resolveRegisterIdentity, validateRegisterIdentity } from "./registerIdentityData.js";
import { resolveRegisterKvkk, validateRegisterKvkk } from "./registerKvkkData.js";
import { resolveRegisterOccupation, validateRegisterOccupation } from "./registerOccupationData.js";
import { resolveRegisterPersonal, validateRegisterPersonal } from "./registerPersonalData.js";
import { resolveRegisterTravel, validateRegisterTravel } from "./registerTravelData.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function validateRegisterEnvForProfile(profileId: string): string[] {
  const settings = loadSettings(PROJECT_ROOT);
  const profileManager = new ProfileManager(PROJECT_ROOT, settings.manifestPath);
  const profile = profileManager.resolveProfile(profileId, settings);

  return [
    ...validateRegisterIdentity(resolveRegisterIdentity(profile, settings), profile.id),
    ...validateRegisterPersonal(resolveRegisterPersonal(profile, settings), profile.id),
    ...validateRegisterContact(resolveRegisterContact(profile, settings), profile.id),
    ...validateRegisterOccupation(resolveRegisterOccupation(profile, settings), profile.id),
    ...validateRegisterTravel(resolveRegisterTravel(profile, settings), profile.id),
    ...validateRegisterExpenses(resolveRegisterExpenses(profile, settings), profile.id),
    ...validateRegisterKvkk(resolveRegisterKvkk(profile, settings), profile.id),
  ];
}
