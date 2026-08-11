export {
  DEFAULT_OTP_DIALOG_SELECTORS,
  DEFAULT_OTP_INPUT_SELECTORS,
  IDENTITY_PHONE_VERIFICATION_VARIANT,
  PORTAL_OTP_SCREEN_VARIANTS,
  getPortalOtpScreenVariants,
  registerOtpScreenVariant,
  type OtpChannel,
  type OtpInputMode,
  type OtpScreenVariant,
} from "./otpScreenCatalog.js";

export {
  handleIdentityPhoneVerificationPopupIfPresent,
  isIdentityPhoneVerificationPopupVisible,
  resolveIdentityPhonePopupScope,
  type IdentityPhoneVerificationOptions,
  type IdentityPhoneVerificationResult,
} from "./identityPhoneVerificationPopup.js";

export {
  IDENTITY_PHONE_VERIFICATION_SELECTORS,
  IDENTITY_PHONE_VERIFICATION_TITLE,
  mapApplicationTypeToPopupValue,
  personFieldSelectors,
  type PopupApplicationTypeValue,
} from "./identityPhoneVerificationSelectors.js";

export {
  detectPortalOtpScreen,
  handlePortalPhoneOtpIfPresent,
  probePortalOtpScreen,
  type DetectedOtpScreen,
  type PortalOtpAutomationOptions,
  type PortalOtpAutomationResult,
} from "./portalOtpAutomation.js";
