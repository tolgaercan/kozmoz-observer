import type { Page } from "playwright";

import type { ApiWatcherSettings, AppointmentSettings } from "../../config/settings.js";
import type { ResolvedProfile } from "../../profiles/profileManager.js";
import { logger } from "../../utils/logger.js";
import { runBookingCampaign } from "../booking/bookingCampaign.js";
import type { ClosedDatePollResult } from "../types.js";
import type { ApiQueryParams } from "../client/resolveApiQueryParams.js";

export interface BookingExecutorInput {
  projectRoot: string;
  profileId: string;
  profile: ResolvedProfile;
  apiSettings: ApiWatcherSettings;
  appointmentSettings: AppointmentSettings;
  queryParams: ApiQueryParams;
  pollResult: ClosedDatePollResult;
  addedAllowed: string[];
  page?: Page;
  getBearerToken: () => string | null;
}

/** @deprecated runBookingExecutor kullanın */
export async function runBookingExecutorStub(details: {
  profileId: string;
  settings: ApiWatcherSettings;
  pollResult: ClosedDatePollResult;
}): Promise<void> {
  logger.info(
    `[api-executor] Eski stub — booking campaign için runBookingExecutor gerekli (profil: ${details.profileId}).`,
  );
}

export async function runBookingExecutor(input: BookingExecutorInput): Promise<void> {
  const result = await runBookingCampaign({
    projectRoot: input.projectRoot,
    profileId: input.profileId,
    profile: input.profile,
    apiSettings: input.apiSettings,
    appointmentSettings: input.appointmentSettings,
    queryParams: input.queryParams,
    pollResult: input.pollResult,
    addedAllowed: input.addedAllowed,
    page: input.page,
    getBearerToken: input.getBearerToken,
  });

  if (result.phase === "skipped" || result.phase === "trigger_filter") {
    logger.debug(`[api-executor] ${result.reason ?? result.phase}`);
    return;
  }

  if (result.ok) {
    logger.info(
      `[api-executor] Booking campaign — ${result.phase}: ${result.verifiedSlot?.date} ${result.verifiedSlot?.hourLabel}`,
    );
    return;
  }

  logger.warn(
    `[api-executor] Booking campaign — ${result.phase}: ${result.reason ?? "basarisiz"}` +
      (result.ghostedDays?.length ? ` (ghost: ${result.ghostedDays.join(", ")})` : ""),
  );
}
