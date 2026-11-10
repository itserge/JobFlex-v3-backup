// Pure settings model: types, defaults, and parse helpers for the org-level
// settings pages (payment / leads / gmail / meta). Each settings group is stored
// as one JSON-as-String column on Organization. This module has NO "use server"
// and NO db import, so it is safe to import from both server pages (to hydrate
// initial values) and the settings server actions (to validate before writing).

function safeParse(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ── Payment ──────────────────────────────────────────────────────────────────
// `stripe` / `square` are "offer this at checkout" toggles; a client only sees a
// provider when the toggle is on AND a healthy PaymentConnection row exists
// (src/lib/payments/payOptions.ts). `bankTransfer` + `bankTransferInstructions`
// are the manual path: the instructions are shown per stage on an accepted
// proposal and the contractor marks the stage paid by hand. `paypal`, `ach`,
// `autoRemind`, `lateFees`, `netTerms`, `lateFeePct` are legacy keys kept so
// old blobs still parse; nothing reads them any more.
export interface PaymentSettings {
  stripe: boolean;
  square: boolean;
  stax: boolean;
  paypal: boolean;
  ach: boolean;
  bankTransfer: boolean;
  bankTransferInstructions: string;
  autoRemind: boolean;
  /**
   * Payment reminders (2026-09-13). "auto": the daily cron nudges the client
   * for the next unpaid stage on a day 1 / 3 / 7 ladder, by email and text;
   * "manual": only the Remind / Request payment buttons send; "off": neither
   * sends. A proposal can override with Proposal.remindersOn.
   */
  reminderMode: "auto" | "manual" | "off";
  lateFees: boolean;
  receiptsOnPayment: boolean;
  /** "Your order is placed" goes to the client by itself when the first payment lands (2026-11-09; off = the office
   *  sends it from the Payments panel). */
  orderNoticeAuto: boolean;
  currency: string;
  depositPct: number;
  netTerms: string;
  lateFeePct: string;
}
export const PAYMENT_DEFAULTS: PaymentSettings = {
  stripe: true,
  square: true,
  stax: true,
  paypal: false,
  ach: true,
  bankTransfer: false,
  bankTransferInstructions: "",
  autoRemind: true,
  reminderMode: "manual",
  lateFees: true,
  receiptsOnPayment: true,
  orderNoticeAuto: false,
  currency: "USD",
  depositPct: 30,
  netTerms: "Net 14",
  lateFeePct: "1.5%",
};
export function parsePaymentSettings(json: string | null | undefined): PaymentSettings {
  return { ...PAYMENT_DEFAULTS, ...safeParse(json) };
}

// ── Proposals ────────────────────────────────────────────────────────────────
// Mirrors Organization.proposalSettingsJson. Only `terms` is read today (the
// public portal's Terms & conditions disclosure); the rest of the blob is
// declared so a future reader does not have to re-derive its shape.
// NO `requireSig` (2026-09-18). It was declared here, defaulted to true and
// read by nothing: the public accept route records no signature, no typed name
// and no signed-at, so the setting promised a gate that did not exist. Removed
// from the shape with the toggle that set it. The COLUMN keeps whatever an org
// already wrote — `safeParse` spreads unknown keys straight through, so an old
// `requireSig: true` survives in the blob and is simply not read, and nothing
// needs a migration.
export interface ProposalSettings {
  validityDays: number;
  terms: string;
  autoFollowUp: boolean;
}
export const PROPOSAL_DEFAULTS: ProposalSettings = {
  validityDays: 14,
  terms: "",
  autoFollowUp: true,
};
export function parseProposalSettings(json: string | null | undefined): ProposalSettings {
  return { ...PROPOSAL_DEFAULTS, ...safeParse(json) };
}

// ── Leads ────────────────────────────────────────────────────────────────────
export type LeadStrategy = "round-robin" | "first-come" | "territory" | "manual";
export interface LeadsSettings {
  strategy: LeadStrategy;
  aiCategorize: boolean;
  instantSms: boolean;
  businessHours: boolean;
  autoDeclineDupes: boolean;
  zips: string;
  travelRadius: number;
  outsidePolicy: string;
  maxPerDay: number;
  maxPerRep: number;
  smartPrompt: string;
}
export const LEADS_DEFAULTS: LeadsSettings = {
  strategy: "round-robin",
  aiCategorize: true,
  // "Text new leads to the company phone" — JobFlex's own lead alerts, sent only
  // after the company turns them on (Settings → Texting; 2026-10-02, the opt-in
  // the JobFlex number is registered on). Off until then.
  instantSms: false,
  businessHours: true,
  autoDeclineDupes: false,
  zips: "78701, 78702, 78703, 78704",
  travelRadius: 25,
  outsidePolicy: "flag",
  maxPerDay: 20,
  maxPerRep: 15,
  smartPrompt: "contractor-first",
};
export function parseLeadsSettings(json: string | null | undefined): LeadsSettings {
  return { ...LEADS_DEFAULTS, ...safeParse(json) };
}

// ── Gmail ────────────────────────────────────────────────────────────────────
export interface GmailSettings {
  connected: boolean;
  // The Gmail address the org connected (set by the OAuth callback). Display only.
  connectedEmail: string;
  sendFromUser: boolean;
  trackOpens: boolean;
  autoSync: boolean;
  displayName: string;
  replyTo: string;
  signature: string;
  /** Set when Google refused the grant (invalid_grant, 401/403) and the
   *  tokens were dropped: Settings shows "disconnected" with Reconnect.
   *  ISO date, or "". Cleared by a fresh connect or an explicit disconnect. */
  revokedAt: string;
  revokedReason: string;
}
export const GMAIL_DEFAULTS: GmailSettings = {
  connected: false,
  connectedEmail: "",
  sendFromUser: true,
  trackOpens: true,
  autoSync: false,
  displayName: "",
  replyTo: "",
  signature: "brand",
  revokedAt: "",
  revokedReason: "",
};
export function parseGmailSettings(json: string | null | undefined): GmailSettings {
  return { ...GMAIL_DEFAULTS, ...safeParse(json) };
}

// ── Meta ─────────────────────────────────────────────────────────────────────
export interface MetaSettings {
  connected: boolean;
  autoCreate: boolean;
  autoText: boolean;
  defaultPage: string;
  formCategory: string;
}
export const META_DEFAULTS: MetaSettings = {
  connected: false,
  autoCreate: false,
  autoText: false,
  defaultPage: "",
  formCategory: "auto",
};
export function parseMetaSettings(json: string | null | undefined): MetaSettings {
  return { ...META_DEFAULTS, ...safeParse(json) };
}
