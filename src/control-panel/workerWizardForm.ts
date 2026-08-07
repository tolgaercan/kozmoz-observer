import type { ResolvedProfile } from "../profiles/profileManager.js";
import type { WorkerApiParams } from "./workerConfigStore.js";

/** Panel worker-config → wizard autofill / profil alanları (manifest/env üzerine yazar). */
export function mergeWorkerApiIntoProfile(
  profile: ResolvedProfile,
  api: WorkerApiParams,
): ResolvedProfile {
  const applicationType = api.applicationType?.trim();
  const nationalityNumber = api.nationalityNumber?.trim();
  const appointmentStyle = api.appointmentStyle?.trim();
  const dealerOffice = api.dealerOffice?.trim();

  return {
    ...profile,
    applicationType: applicationType || profile.applicationType,
    nationalityNumber: nationalityNumber || profile.nationalityNumber,
    appointmentStyle: appointmentStyle || profile.appointmentStyle,
    appointmentOffice: dealerOffice || profile.appointmentOffice,
    form: {
      ...profile.form,
      ...(applicationType ? { applicationType } : {}),
      ...(nationalityNumber ? { nationalityNumber } : {}),
      ...(appointmentStyle ? { appointmentStyle } : {}),
      ...(dealerOffice ? { appointmentOffice: dealerOffice } : {}),
    },
  };
}
