import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runPreflight } from "./preflightCheck.js";
import { logger } from "../utils/logger.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const profileId = process.argv[2];

const report = await runPreflight(projectRoot, profileId);

for (const warning of report.warnings) {
  logger.warn(warning);
}

if (report.ready) {
  logger.info("Preflight OK — test için hazır.");
  process.exit(0);
}

for (const error of report.errors) {
  logger.error(error);
}
process.exit(1);
