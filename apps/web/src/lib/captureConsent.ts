/**
 * Public, human-readable provenance for browser Data Lab contributions.
 *
 * This value is intentionally not a credential, signature, or identity assertion. It records the
 * exact notice accepted in the UI so a later data-review process can distinguish consented browser
 * submissions from synthetic material and from other future collection channels.
 */
export const DEVELOPMENT_DATA_LAB_CONSENT_VERSION = 'DEVELOPMENT-DATA-LAB-CONSENT-V1';
export const DEVELOPMENT_DATA_LAB_ADMISSION_STATUS = 'consented-development-unreviewed';

export interface DevelopmentDataLabConsent {
  consentVersion: typeof DEVELOPMENT_DATA_LAB_CONSENT_VERSION;
  consentAcceptedAt: string;
  admissionStatus: typeof DEVELOPMENT_DATA_LAB_ADMISSION_STATUS;
}
