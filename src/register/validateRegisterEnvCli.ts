import { logger } from "../utils/logger.js";
import { validateRegisterEnvForProfile } from "./validateRegisterEnv.js";

const profileId = process.argv[2] ?? process.env.DEFAULT_PROFILE_ID ?? "profile-1";

const errors = validateRegisterEnvForProfile(profileId);
if (errors.length === 0) {
  logger.info(`[register:validate] Profil ${profileId} — tüm zorunlu kayıt alanları dolu.`);
  process.exit(0);
}

logger.error(`[register:validate] Profil ${profileId} — ${errors.length} eksik/hatalı alan:`);
for (const err of errors) {
  logger.error(`  - ${err}`);
}
process.exit(1);
