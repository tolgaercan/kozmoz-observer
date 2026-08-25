import type { Page } from "playwright";

import type { ApiWatcherSettings, AppointmentSettings } from "../../config/settings.js";
import type { ResolvedProfile } from "../../profiles/profileManager.js";
import type { ApiQueryParams } from "../client/resolveApiQueryParams.js";
import type { ClosedDatePollResult, HourQuotaSlotResult } from "../types.js";

export type BookingCampaignPhase =
  | "skipped"
  | "trigger_filter"
  | "fill_step2"
  | "advance_step3"
  | "captcha"
  | "hour_probe"
  | "ui_select"
  | "fill_step4"
  | "advance_step5"
  | "otp_step5"
  | "fill_payment"
  | "payment_ready"
  | "payment_3ds_manual"
  | "payment_success"
  | "retreat_step2"
  | "wizard_complete"
  | "success"
  | "failed";

export interface VerifiedSlot {
  date: string;
  hourLabel: string;
  slot: HourQuotaSlotResult;
}

export interface BookingCampaignInput {
  projectRoot: string;
  profileId: string;
  profile: ResolvedProfile;
  apiSettings: ApiWatcherSettings;
  appointmentSettings: AppointmentSettings;
  queryParams: ApiQueryParams;
  pollResult: ClosedDatePollResult;
  /** Yeni açılan günler (watcher addedAllowed) */
  addedAllowed: string[];
  page?: Page;
  getBearerToken: () => string | null;
}

export interface BookingCampaignResult {
  ok: boolean;
  phase: BookingCampaignPhase;
  reason?: string;
  triggerDays?: string[];
  hourRequestsUsed?: number;
  verifiedSlot?: VerifiedSlot;
  ghostedDays?: string[];
}
