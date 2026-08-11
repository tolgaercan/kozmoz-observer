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
  const otpPhone = api.otpPhone?.trim();
  const portalEmail = api.portalEmail?.trim();
  const passportNumber = api.passportNumber?.trim();

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
      ...(otpPhone ? { phone: otpPhone } : {}),
      ...(portalEmail ? { registerEmail: portalEmail } : {}),
      ...(passportNumber ? { passportNumber } : {}),
    },
    credentials: {
      ...profile.credentials,
      ...(portalEmail ? { email: portalEmail } : {}),
    },
  };
}
