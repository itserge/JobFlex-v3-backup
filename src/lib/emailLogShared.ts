// The mail log's words (lib/emailLog) — pure, browser-safe: the kinds a
// letter is filed under, the statuses, and the admin log's periods.

export const EMAIL_KINDS = ["otp", "dunning", "proposal", "follow-up", "welcome", "support", "inbox", "inbox-forward", "other"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
export const isEmailKind = (v: unknown): v is EmailKind => typeof v === "string" && (EMAIL_KINDS as readonly string[]).includes(v);

export const EMAIL_STATUSES = ["sent", "failed", "skipped"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
export const isEmailStatus = (v: unknown): v is EmailStatus => typeof v === "string" && (EMAIL_STATUSES as readonly string[]).includes(v);
export type EmailTransport = "smtp" | "resend" | "skipped";

/** /admin/mail/log's periods: the UTC day (the one the limit counts), 7 and 30 days. */
export const MAIL_PERIODS = ["today", "7d", "30d"] as const;
export type MailLogPeriod = (typeof MAIL_PERIODS)[number];
