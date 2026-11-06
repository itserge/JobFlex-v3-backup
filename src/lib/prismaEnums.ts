// String-literal enums replacing Prisma native enums (SQLite has no enum support).
// Import these instead of from @prisma/client.

export const Role = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  SALES: "SALES",
  ESTIMATOR: "ESTIMATOR",
  INSTALLER: "INSTALLER",
  ACCOUNTANT: "ACCOUNTANT",
  USER: "USER",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

// Roles offered when adding/editing a team member from the Workers roster.
// INSTALLER is the field-worker role (restricted, self-scoped dashboard via
// isWorkerRole in orgContext); SALES/ESTIMATOR/MANAGER are office staff with
// manager-level access. OWNER/ADMIN/ACCOUNTANT/USER stay valid but are managed
// elsewhere, not offered in the worker-add dropdown.
export const WORKER_ROLES = [Role.INSTALLER, Role.SALES, Role.ESTIMATOR, Role.MANAGER] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

// Human-friendly label for a role — used in invite copy, the accept card, and
// roster pills so we never surface a raw enum or a generic "crew member".
export function roleLabel(role: string): string {
  switch (role) {
    case Role.INSTALLER:
      return "Installer";
    case Role.SALES:
      return "Sales rep";
    case Role.ESTIMATOR:
      return "Estimator";
    case Role.MANAGER:
      return "Manager";
    case Role.OWNER:
      return "Owner";
    case Role.ADMIN:
      return "Admin";
    case Role.ACCOUNTANT:
      return "Accountant";
    default:
      return role ? role.charAt(0) + role.slice(1).toLowerCase() : "Member";
  }
}

export const LeadStatus = {
  NEW: "NEW",
  ROUTED: "ROUTED",
  CLAIMED: "CLAIMED",
  CONTACTED: "CONTACTED",
  QUOTED: "QUOTED",
  WON: "WON",
  LOST: "LOST",
  ARCHIVED: "ARCHIVED",
} as const;
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

// Lead Center — platform-owned lead routing state machine (see PlatformLead model).
export const PlatformLeadStatus = {
  MATCHING: "MATCHING", // ranking built / cascade not yet offered (or errored; cron re-drives)
  OFFERED: "OFFERED", // an active LeadOffer is awaiting a contractor response
  MATCHED: "MATCHED", // accepted or manually assigned; org Lead row exists
  MANUAL_QUEUE: "MANUAL_QUEUE", // no candidates or 3 attempts exhausted; admin assigns
} as const;
export type PlatformLeadStatus = (typeof PlatformLeadStatus)[keyof typeof PlatformLeadStatus];

export const LeadOfferStatus = {
  OFFERED: "OFFERED",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED", // superseded by accept elsewhere or admin manual assign
  REJECTED_BY_CLIENT: "REJECTED_BY_CLIENT", // homeowner pressed "find me another" after a match
} as const;
export type LeadOfferStatus = (typeof LeadOfferStatus)[keyof typeof LeadOfferStatus];

export const ProposalStatus = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  VIEWED: "VIEWED",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  // The linked job finished (set automatically when the job flips to
  // COMPLETED). Distinct from PAID: completed says the work is done, paid
  // says the money landed — a proposal can be either without the other.
  COMPLETED: "COMPLETED",
  PAID: "PAID",
  EXPIRED: "EXPIRED",
  ARCHIVED: "ARCHIVED",
} as const;
export type ProposalStatus = (typeof ProposalStatus)[keyof typeof ProposalStatus];

export const MeasurementType = {
  SQFT: "SQFT",
  LINEAR_FT: "LINEAR_FT",
  CUBIC_FT: "CUBIC_FT",
  UNIT: "UNIT",
  HOUR: "HOUR",
  LUMP_SUM: "LUMP_SUM",
  SQUARE: "SQUARE",
  // The real measures a line is counted or bought in (2026-10-21, owner: "make sure it uses the right measures, not
  // only units"): a fixture is "each", drywall "sheets", shingles "bundles", concrete "cubic yards". The column is
  // text on both databases, so these are plain values — no migration.
  EACH: "EACH",
  SHEET: "SHEET",
  BUNDLE: "BUNDLE",
  ROLL: "ROLL",
  BOX: "BOX",
  BAG: "BAG",
  PIECE: "PIECE",
  GALLON: "GALLON",
  TON: "TON",
  SET: "SET",
  BUCKET: "BUCKET",
  TUBE: "TUBE",
  CU_YARD: "CU_YARD",
  SQ_YARD: "SQ_YARD",
} as const;
export type MeasurementType = (typeof MeasurementType)[keyof typeof MeasurementType];
/** Every value, for a schema (z.enum). */
export const MEASUREMENT_TYPES = Object.values(MeasurementType) as [MeasurementType, ...MeasurementType[]];

export const PaymentStatus = {
  PENDING: "PENDING",
  PAID: "PAID",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
  // A manual mark-paid that the contractor later undid. Kept for the audit
  // trail; financials exclude it.
  VOID: "VOID",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentProvider = {
  STRIPE: "STRIPE",
  SQUARE: "SQUARE",
  STAX: "STAX",
  PAYPAL: "PAYPAL",
  MANUAL: "MANUAL",
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

// Payment-stage state on Installment (see src/lib/paymentSchedule.ts).
export const InstallmentStatus = {
  UNPAID: "UNPAID",
  PENDING: "PENDING", // a hosted checkout is open for this stage
  PAID: "PAID",
  WAIVED: "WAIVED", // proposal reached PAID before this stage was collected
} as const;
export type InstallmentStatus = (typeof InstallmentStatus)[keyof typeof InstallmentStatus];

// Manual payment methods a contractor can record against a stage.
export const ManualPaymentMethod = {
  BANK_TRANSFER: "BANK_TRANSFER",
  CASH: "CASH",
  CHECK: "CHECK",
  OTHER: "OTHER",
} as const;
export type ManualPaymentMethod = (typeof ManualPaymentMethod)[keyof typeof ManualPaymentMethod];

// PaymentConnection.status — the contractor's own Stripe/Square link.
export const PaymentConnectionStatus = {
  ACTIVE: "ACTIVE",
  RESTRICTED: "RESTRICTED", // connected but cannot charge (Stripe charges_disabled / Square token trouble)
  REVOKED: "REVOKED", // the contractor removed us from their provider dashboard
} as const;
export type PaymentConnectionStatus =
  (typeof PaymentConnectionStatus)[keyof typeof PaymentConnectionStatus];

export const JobStatus = {
  SCHEDULED: "SCHEDULED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELED: "CANCELED",
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

// A day on site (stage A, 2026-09-30): OPEN while the crew is on it, CLOSED
// by them with a note or a photo, PENDING once its date has passed unclosed.
export const WorkDayStatus = {
  OPEN: "OPEN",
  CLOSED: "CLOSED",
  PENDING: "PENDING",
} as const;
export type WorkDayStatus = (typeof WorkDayStatus)[keyof typeof WorkDayStatus];

// A job expense (stage A, 2026-09-30): a worker's receipt is SUBMITTED and
// counts nowhere until APPROVED; REJECTED carries a reason; REIMBURSED marks
// the money handed back to a worker who paid themselves. Office-entered rows
// are APPROVED at once. Only APPROVED and REIMBURSED are in any total.
export const ExpenseStatus = {
  SUBMITTED: "SUBMITTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  REIMBURSED: "REIMBURSED",
} as const;
export type ExpenseStatus = (typeof ExpenseStatus)[keyof typeof ExpenseStatus];

export const ExpensePaidBy = {
  WORKER: "WORKER",
  COMPANY: "COMPANY",
} as const;
export type ExpensePaidBy = (typeof ExpensePaidBy)[keyof typeof ExpensePaidBy];

export const AssignmentStatus = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  COMPLETED: "COMPLETED",
} as const;
export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus];

export const SubscriptionStatus = {
  FREE: "FREE",
  TRIALING: "TRIALING",
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAST_DUE",
  /** Stripe stopped retrying a failed renewal and kept the subscription open
   *  ("unpaid"): the plan's features close (lib/planStatus) until it is paid. */
  UNPAID: "UNPAID",
  CANCELED: "CANCELED",
  EXPIRED: "EXPIRED",
  /** A card-less trial that reached its end with no card on file (lib/trialState):
   *  the workspace reads, nothing writes, until a card restarts the plan. */
  TRIAL_ENDED: "TRIAL_ENDED",
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const SubscriptionPlan = {
  FREE: "FREE",
  STARTER: "STARTER",
  PROFESSIONAL: "PROFESSIONAL",
  ENTERPRISE: "ENTERPRISE",
} as const;
export type SubscriptionPlan = (typeof SubscriptionPlan)[keyof typeof SubscriptionPlan];

export const ActivityKind = {
  CREATED: "CREATED",
  CO_APPROVED: "CO_APPROVED",
  CO_DECLINED: "CO_DECLINED",
  UPDATED: "UPDATED",
  EDITED: "EDITED",
  SENT: "SENT",
  VIEWED: "VIEWED",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  SCHEDULED: "SCHEDULED",
  PAID: "PAID",
  COMPLETED: "COMPLETED",
  NOTE: "NOTE",
  CALL: "CALL",
  EMAIL: "EMAIL",
  SMS: "SMS",
  // Platform payments (contractor's Stripe/Square via JobFlex).
  PAYMENT_RECEIVED: "PAYMENT_RECEIVED",
  PAYMENT_REFUNDED: "PAYMENT_REFUNDED",
  PAYMENT_MARKED: "PAYMENT_MARKED", // contractor recorded a manual payment
  PAYMENT_UNMARKED: "PAYMENT_UNMARKED",
  PAYMENT_ALERT: "PAYMENT_ALERT", // needs a human: overpayment, orphan, restricted account
  PAYMENT_CONNECTED: "PAYMENT_CONNECTED",
  PAYMENT_DISCONNECTED: "PAYMENT_DISCONNECTED",
  // Settings → "Send test notification". Only visible to its actor.
  TEST: "TEST",
  // The organization's plan moved by JobFlex support (actions/adminSubscription)
  // or a complimentary plan began / ended (lib/planGrant). meta holds the terms.
  PLAN_CHANGE: "PLAN_CHANGE",
  // JobFlex support reset the organization's usage count for one or more
  // plan limits this cycle (lib/usageReset). meta holds the keys, the reason
  // and what each meter read before.
  USAGE_RESET: "USAGE_RESET",
} as const;
export type ActivityKind = (typeof ActivityKind)[keyof typeof ActivityKind];

export const ProjectStatus = {
  ACTIVE: "ACTIVE",
  ON_HOLD: "ON_HOLD",
  COMPLETED: "COMPLETED",
  ARCHIVED: "ARCHIVED",
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

// A stage of a project (2026-11-05): PLANNED until someone starts it, ACTIVE
// while the crew is on it, DONE when it is marked so (lib/projectStages).
export const StageStatus = {
  PLANNED: "PLANNED",
  ACTIVE: "ACTIVE",
  DONE: "DONE",
} as const;
export type StageStatus = (typeof StageStatus)[keyof typeof StageStatus];

export const ApplicantStatus = {
  APPLIED: "APPLIED",
  INTERVIEWING: "INTERVIEWING",
  HIRED: "HIRED",
  REJECTED: "REJECTED",
} as const;
export type ApplicantStatus = (typeof ApplicantStatus)[keyof typeof ApplicantStatus];

export const ChangeOrderStatus = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  APPROVED: "APPROVED",
  DECLINED: "DECLINED",
} as const;
export type ChangeOrderStatus = (typeof ChangeOrderStatus)[keyof typeof ChangeOrderStatus];

export const InvoiceStatus = {
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const InfluencerPayoutStatus = {
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
} as const;
export type InfluencerPayoutStatus = (typeof InfluencerPayoutStatus)[keyof typeof InfluencerPayoutStatus];

// ─────────────────────────────────────────────
// Admin console — influencers, promo codes, commission & payouts.
// All money in this subsystem is integer cents; these enums back the
// Stripe-truth attribution + commission ledger + Connect payout flow.
// ─────────────────────────────────────────────

// Session discriminator: a NextAuth session belongs to either an app USER
// (org member) or a platform INFLUENCER (separate login, no org).
export const Principal = {
  USER: "USER",
  INFLUENCER: "INFLUENCER",
} as const;
export type Principal = (typeof Principal)[keyof typeof Principal];

export const InfluencerStatus = {
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  TERMINATED: "TERMINATED",
} as const;
export type InfluencerStatus = (typeof InfluencerStatus)[keyof typeof InfluencerStatus];

// Mirror of the Stripe Connect account's onboarding/capability state.
export const ConnectStatus = {
  NONE: "NONE",
  ONBOARDING: "ONBOARDING",
  RESTRICTED: "RESTRICTED",
  ENABLED: "ENABLED",
  DISABLED: "DISABLED",
} as const;
export type ConnectStatus = (typeof ConnectStatus)[keyof typeof ConnectStatus];

export const CommissionType = {
  PERCENT: "PERCENT",
  FLAT: "FLAT",
} as const;
export type CommissionType = (typeof CommissionType)[keyof typeof CommissionType];

// NET pays on money actually collected (invoice.amount_paid); GROSS on subtotal.
export const CommissionBasis = {
  NET: "NET",
  GROSS: "GROSS",
} as const;
export type CommissionBasis = (typeof CommissionBasis)[keyof typeof CommissionBasis];

// Our commission window (decoupled from the customer's Stripe discount duration).
export const PromoDurationType = {
  ONCE: "ONCE",
  REPEATING: "REPEATING",
  FOREVER: "FOREVER",
} as const;
export type PromoDurationType = (typeof PromoDurationType)[keyof typeof PromoDurationType];

export const AttributionStatus = {
  ACTIVE: "ACTIVE",
  ENDED: "ENDED",
  VOID: "VOID",
} as const;
export type AttributionStatus = (typeof AttributionStatus)[keyof typeof AttributionStatus];

export const LedgerEntryType = {
  ACCRUED: "ACCRUED",
  REVERSED: "REVERSED",
  PAID: "PAID",
  ADJUSTMENT: "ADJUSTMENT",
} as const;
export type LedgerEntryType = (typeof LedgerEntryType)[keyof typeof LedgerEntryType];

export const LedgerEntryState = {
  PENDING: "PENDING",
  CLEARED: "CLEARED",
  PAID: "PAID",
  VOID: "VOID",
  // A customer has disputed the payment this commission came from. Not pending
  // (the hold clock is stopped), not payable, not in any payout — until the
  // dispute closes: won → back to PENDING with a fresh hold, lost → VOID against
  // a chargeback reversal (lib/stripeSync, holdForDispute / settleDispute).
  HELD: "HELD",
  // Paid out, and then Stripe reversed the transfer: the money never reached the
  // partner. NOT pending and NOT payable — it is never paid again automatically.
  // An admin decides at /admin/payouts: Retry payout (back to CLEARED, the
  // partner may request again) or Write off (VOID, closed with a note).
  REVERSED_TRANSFER: "REVERSED_TRANSFER",
} as const;
export type LedgerEntryState = (typeof LedgerEntryState)[keyof typeof LedgerEntryState];

export const PayoutRequestStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PROCESSING: "PROCESSING",
  PAID: "PAID",
  FAILED: "FAILED",
  // Stripe reversed the transfer this request was paid with. Waiting on an admin.
  REVERSED: "REVERSED",
  // …the admin chose Retry payout: the money is back in the partner's balance.
  RELEASED: "RELEASED",
  // …the admin chose Write off: closed, with the admin's note in rejectedReason.
  WRITTEN_OFF: "WRITTEN_OFF",
} as const;
export type PayoutRequestStatus = (typeof PayoutRequestStatus)[keyof typeof PayoutRequestStatus];

export const PayoutTransferStatus = {
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  REVERSED: "REVERSED",
} as const;
export type PayoutTransferStatus = (typeof PayoutTransferStatus)[keyof typeof PayoutTransferStatus];

export const BillingInterval = {
  MONTH: "MONTH",
  YEAR: "YEAR",
} as const;
export type BillingInterval = (typeof BillingInterval)[keyof typeof BillingInterval];

export const WebhookEventStatus = {
  RECEIVED: "RECEIVED",
  PROCESSED: "PROCESSED",
  FAILED: "FAILED",
  IGNORED: "IGNORED",
} as const;
export type WebhookEventStatus = (typeof WebhookEventStatus)[keyof typeof WebhookEventStatus];
