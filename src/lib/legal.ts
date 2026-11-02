// Business details provided by the operator. Verify inbox delivery before launch.
// The operator is the company Twilio verified (2026-10-02): its approved
// business profile and the toll-free registration name Jobflex LLC, and the
// carriers compare the website with them (this was "Dmitiriy Apetenok").
export const LEGAL_OPERATOR_NAME = "Jobflex LLC";
export const LEGAL_CONTACT_EMAIL = "support@jobflex.app";
/** Where security reports go (/security) — the security contact given to partners such as Ramp. */
export const LEGAL_SECURITY_EMAIL = "dmitriy@jobflex.app";

/** "Last updated" per legal page. Bump a page's entry when its text materially changes. */
export const LEGAL_UPDATED = {
  privacy: { iso: "2026-10-09", label: "October 9, 2026" },
  terms: { iso: "2026-10-19", label: "October 19, 2026" },
  security: { iso: "2026-11-01", label: "November 1, 2026" },
  rampGuide: { iso: "2026-11-01", label: "November 1, 2026" },
  rampSupport: { iso: "2026-11-01", label: "November 1, 2026" },
} as const;
