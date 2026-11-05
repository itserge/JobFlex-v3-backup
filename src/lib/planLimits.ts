// Pure, client-safe definitions for per-plan numeric limits.
//
// NO server imports here (no Prisma, no "use server"). Both the admin Plans UI
// (client) and the server-side Limits Engine (src/lib/entitlements.ts) import
// these so the limit keys, scopes, and (de)serialization stay in one place.
//
// Storage: PricingPlan.limitsJson holds a JSON object keyed by LimitKey. A key
// that is absent, null, or negative means "unlimited".

import type { TrialCapKey } from "@/lib/trialCaps";

export const UNLIMITED = -1;

/**
 * Stable error message thrown by enforcePlanLimit and detected on the client to
 * raise the "limit reached" dialog. Kept here (client-safe) so both sides agree.
 */
export const PLAN_LIMIT_MESSAGE = "Plan limit reached";

export function isPlanLimitError(err: unknown): boolean {
  return err instanceof Error && err.message === PLAN_LIMIT_MESSAGE;
}

/**
 * Limit failure shape for actions that return result unions ({ ok: false })
 * instead of throwing (estimators / AI flows). Thrown Error messages are
 * redacted by Next.js in production, but a returned payload survives — so
 * union-returning actions signal a limit via `code` and the client detects it
 * with isPlanLimitFailure.
 */
export interface PlanLimitFailure {
  ok: false;
  error: string;
  code: "PLAN_LIMIT_REACHED";
  resource?: LimitKey;
  /** Set when the ceiling reached is the card-less trial's own, not the
   *  plan's (lib/trialCaps): the dialog asks for a card instead of a plan. */
  trialCap?: TrialCapKey;
  /** The card-less trial is over with no card: nothing paid runs. */
  trialEnded?: boolean;
  /** The month's texts are used (entitlements SMS_ALLOWANCE): the dialog names texts, not a LimitKey. */
  smsAllowance?: true;
}

export function isPlanLimitFailure(v: unknown): v is PlanLimitFailure {
  return (
    !!v &&
    typeof v === "object" &&
    (v as { ok?: unknown }).ok === false &&
    (v as { code?: unknown }).code === "PLAN_LIMIT_REACHED"
  );
}

/**
 * THE SMS ALLOWANCE IS A SOFT STOP (owner, 2026-10-26 — audit §3): past the
 * plan's texts for the month nothing more goes out and nothing is billed;
 * the plan dialog says so (lib/sms/send).
 */
export const SMS_ALLOWANCE_MESSAGE = "SMS allowance used — upgrade or wait for the next cycle";
export function smsAllowanceFailure(): PlanLimitFailure {
  return { ok: false, error: SMS_ALLOWANCE_MESSAGE, code: "PLAN_LIMIT_REACHED", smsAllowance: true };
}

/**
 * A returned `{ ok: false }` failure as a client-side Error, so a caller's
 * existing catch block handles it unchanged: a plan limit becomes the error
 * reportPlanLimit recognises (with its resource), anything else carries the
 * server's own words — which a thrown server-action error would not.
 */
export function failureAsError(res: { error: string; code?: string; resource?: string; trialCap?: string; trialEnded?: boolean }): Error {
  if (res.code === "PLAN_LIMIT_REACHED") {
    return Object.assign(new Error(PLAN_LIMIT_MESSAGE), { code: res.code, resource: res.resource, trialCap: res.trialCap, trialEnded: res.trialEnded });
  }
  return new Error(res.error);
}

/** How a limit's usage window is computed. */
export type LimitScope =
  | "monthly" // counted within the current billing cycle
  | "absolute"; // counted across the org's whole lifetime

export type LimitKey =
  | "proposalsCreated"
  | "proposalsAccepted"
  | "proposalsCompleted"
  | "calendarCards"
  | "calendarEvents"
  | "projects"
  | "jobs"
  | "workers"
  | "clients"
  | "estimatorUses"
  | "hvacEstimates"
  | "roofMeasurements"
  | "manualJReports"
  | "conversationsStarted"
  | "messagesSent"
  | "leads"
  | "aiPhoneCalls"
  | "deskMinutes"
  | "reviewRequests"
  | "teamSeats"
  | "managers"
  | "assistantCommands";

export interface LimitDef {
  key: LimitKey;
  label: string;
  scope: LimitScope;
  hint: string;
}

// The order here is the order shown in the admin "Plan Limits" section.
// `scope` is the single source of truth the engine uses to decide whether a
// usage count is windowed to the billing cycle (monthly) or counted in full
// (absolute). Flip a `scope` here and the engine follows automatically.
export const LIMIT_DEFS: readonly LimitDef[] = [
  { key: "proposalsCreated", label: "Proposals created", scope: "monthly", hint: "New proposals per billing cycle" },
  { key: "proposalsAccepted", label: "Proposals accepted", scope: "monthly", hint: "Accepted per billing cycle" },
  { key: "proposalsCompleted", label: "Proposals completed", scope: "monthly", hint: "Completed/paid per billing cycle" },
  { key: "calendarCards", label: "Calendar cards", scope: "monthly", hint: "Appointments scheduled per cycle" },
  { key: "calendarEvents", label: "Calendar events", scope: "monthly", hint: "Job events scheduled per cycle" },
  { key: "projects", label: "Total projects", scope: "monthly", hint: "New projects per billing cycle" },
  { key: "jobs", label: "Total jobs", scope: "monthly", hint: "New jobs per billing cycle" },
  { key: "workers", label: "Total workers", scope: "absolute", hint: "Worker seats in the org (lifetime)" },
  { key: "clients", label: "Clients", scope: "absolute", hint: "Client records in the org (lifetime)" },
  { key: "estimatorUses", label: "Estimator uses", scope: "monthly", hint: "AI estimator runs per cycle" },
  // The HVAC estimator's own meter (owner, 2026-09-25): new HVAC estimates
  // saved per cycle. It never created AiEstimate rows, so "estimatorUses"
  // only ever gated it — it never counted it. Absent from a plan = unlimited.
  { key: "hvacEstimates", label: "HVAC estimates", scope: "monthly", hint: "New HVAC estimates saved per cycle" },
  // The paid lookups (owner, 2026-10-26 — audit §1): an EagleView roof
  // measurement and a Cool Calc Manual J report each cost JobFlex money, so
  // each plan carries a monthly number. Absent from a plan = the tier's
  // default (PAID_CALL_DEFAULTS), not unlimited; "Unlimited" stores -1.
  { key: "roofMeasurements", label: "Roof measurements", scope: "monthly", hint: "Paid EagleView roof measurements per cycle" },
  { key: "manualJReports", label: "Manual J reports", scope: "monthly", hint: "Paid Cool Calc Manual J reports per cycle" },
  { key: "conversationsStarted", label: "Conversations started", scope: "monthly", hint: "New message threads per cycle" },
  { key: "messagesSent", label: "Messages sent", scope: "monthly", hint: "Messages sent per cycle" },
  { key: "leads", label: "Leads captured", scope: "monthly", hint: "New leads per cycle (all sources)" },
  { key: "aiPhoneCalls", label: "AI phone calls", scope: "monthly", hint: "AI receptionist calls per cycle" },
  // The AI desk's minutes (2026-10-13): per CALENDAR month, not the cycle — the desk
  // keeps its own month row (lib/aiDesk/usage). Past these, minute packs (lib/aiDesk/minutes).
  { key: "deskMinutes", label: "AI desk minutes", scope: "monthly", hint: "Minutes the AI desk is on the line per calendar month; packs add more" },
  { key: "reviewRequests", label: "Review requests", scope: "monthly", hint: "Review asks per cycle (incl. auto)" },
  { key: "teamSeats", label: "Office team seats", scope: "absolute", hint: "Non-worker members + pending invites" },
  // Manager seats specifically (owner's call, 2026-08-31): some plans sell NO
  // managers, others one or more. Counted as MANAGER-role members plus pending
  // MANAGER invites; absent from a plan's limitsJson = unlimited, so nothing
  // changes for a plan until /admin/plans sets a number.
  { key: "managers", label: "Manager seats", scope: "absolute", hint: "MANAGER members + pending manager invites" },
  // The JobFlex Assistant (owner, 2026-11-04: "in every plan, with a monthly
  // limit"). A request the model reads counts; YES / NO / a reply digit does
  // not. Each one is an OpenAI call JobFlex pays for, so — like the paid
  // lookups — a plan without a number meters at its tier's default.
  { key: "assistantCommands", label: "Assistant commands", scope: "monthly", hint: "Requests to the JobFlex Assistant per cycle (YES / NO answers don't count)" },
] as const;

export const LIMIT_KEYS = LIMIT_DEFS.map((d) => d.key) as LimitKey[];

export type PlanLimits = Partial<Record<LimitKey, number>>;

/**
 * Safety-net caps applied ONLY when a lapsed subscription must fall back to
 * FREE limits but no "free" PricingPlan row exists in the catalog. Without
 * this, parsePlanLimits(null) = {} = unlimited, and a canceled org would keep
 * unlimited usage — the exact hole the lapsed rule closes. A real "free" plan
 * row in /admin/plans always wins over these values.
 */
export const DEFAULT_FREE_LIMITS: PlanLimits = {
  proposalsCreated: 3,
  calendarCards: 10,
  calendarEvents: 10,
  projects: 2,
  jobs: 3,
  workers: 1,
  clients: 10,
  estimatorUses: 3,
  hvacEstimates: 3,
  roofMeasurements: 3,
  manualJReports: 1,
  conversationsStarted: 5,
  messagesSent: 50,
  leads: 10,
  aiPhoneCalls: 5,
  deskMinutes: 0,
  reviewRequests: 3,
  teamSeats: 1,
  assistantCommands: 20,
};

/**
 * THE PAID LOOKUPS' DEFAULTS (owner, 2026-10-26). These two keys never fall
 * open: a plan row without them — every row written before 2026-10-26 —
 * meters at its tier's numbers below, and a plan made unlimited in
 * /admin/plans says so with -1. A slug not listed here (an admin-made plan)
 * keeps the old rule: absent = unlimited, the daily ceilings (lib/paidCaps)
 * still hold. The Assistant's commands (2026-11-04) follow the same rule:
 * each is a model call JobFlex pays for. Its numbers are a first proposal for
 * the owner to confirm on /admin/plans.
 */
export const PAID_CALL_KEYS = ["roofMeasurements", "manualJReports", "assistantCommands"] as const satisfies readonly LimitKey[];
export const PAID_CALL_DEFAULTS: Record<string, Pick<PlanLimits, (typeof PAID_CALL_KEYS)[number]>> = {
  free: { roofMeasurements: 3, manualJReports: 1, assistantCommands: 20 },
  starter: { roofMeasurements: 15, manualJReports: 10, assistantCommands: 300 },
  professional: { roofMeasurements: 40, manualJReports: 25, assistantCommands: 1000 },
  enterprise: { roofMeasurements: 100, manualJReports: 60, assistantCommands: 3000 },
};
const isPaidCallKey = (key: LimitKey): boolean => (PAID_CALL_KEYS as readonly LimitKey[]).includes(key);

/** A plan's limits with the paid lookups' tier defaults filled in where the row has none. */
export function withPaidCallDefaults(limits: PlanLimits, slug: string | null | undefined): PlanLimits {
  const defaults = PAID_CALL_DEFAULTS[(slug ?? "").toLowerCase()];
  if (!defaults) return limits;
  const out: PlanLimits = { ...limits };
  for (const key of PAID_CALL_KEYS) if (typeof out[key] !== "number") out[key] = defaults[key];
  return out;
}

/** A limit is "unlimited" when missing, null, or negative (e.g. the -1 sentinel). */
export function isUnlimited(v: number | null | undefined): boolean {
  return v === null || v === undefined || !Number.isFinite(v) || v < 0;
}

/** Parse PricingPlan.limitsJson into a typed, validated PlanLimits object. */
export function parsePlanLimits(json: string | null | undefined): PlanLimits {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object") return {};
  const rec = raw as Record<string, unknown>;
  const out: PlanLimits = {};
  for (const def of LIMIT_DEFS) {
    const v = rec[def.key];
    if (typeof v === "number" && Number.isFinite(v)) out[def.key] = Math.trunc(v);
  }
  return out;
}

/**
 * Serialize a PlanLimits-like object for storage. Only known keys with a
 * finite, non-negative cap are persisted; unlimited values are simply omitted
 * (absent key === unlimited on read), keeping the JSON small and intentional.
 * The paid lookups are the exception: their absence means the tier default,
 * so their "unlimited" is stored as -1.
 */
export function serializePlanLimits(limits: Record<string, number | null | undefined>): string {
  const out: Record<string, number> = {};
  for (const def of LIMIT_DEFS) {
    const v = limits[def.key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v >= 0) out[def.key] = Math.trunc(v);
    else if (isPaidCallKey(def.key)) out[def.key] = UNLIMITED;
  }
  return JSON.stringify(out);
}
