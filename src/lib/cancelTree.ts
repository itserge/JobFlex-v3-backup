// THE CANCEL QUESTIONS (owner, 2026-11-09). "Cancel subscription" on the
// Subscription page (components/billing/CancelFlow) opens a short tree of
// questions before "Before you go" and "Cancel <plan>?":
//
//   A  "Before you cancel — what's the main reason?"  (one, required)
//      A1 no time      → B1 what got in the way (≥1) + what to try first
//                       → C1 7 / 14 more trial days (only on the trial, or
//                            ≤14 days after it — lib/trialExtension)
//      A2 tools        → B2 which tools (≥1) → C2 what was wrong with each
//                       → D2 what instead + would you try again
//      A3 something else → B3 the reasons (≥1), a follow-up under each
//   E  Before you go → Cancel <plan>? with a one-line summary of the answers.
//
// Pure — the window and the server read the same lists and the same rule
// (checkCancelAnswers). Stored whole on CancellationFeedback.answersJson (and
// B1 on TrialExtensionRequest.answersJson); `reasons` keeps the flat keys the
// older readers know (lib/cancelFeedback). PostHog gets keys only, never words.

export const CANCEL_PATHS = [
  { key: "A1", label: "I didn't have enough time to really try it", short: "Didn't have time" },
  { key: "A2", label: "The tools or features didn't work for me", short: "Tools didn't work" },
  { key: "A3", label: "Something else", short: "Something else" },
] as const;
export type CancelPath = (typeof CANCEL_PATHS)[number]["key"];

export function isCancelPath(v: unknown): v is CancelPath {
  return v === "A1" || v === "A2" || v === "A3";
}
export function pathShort(p: string | null | undefined): string {
  return CANCEL_PATHS.find((x) => x.key === p)?.short ?? "Before the questions";
}

/** The tools, once: `short` for "try first" (B1), `long` for "didn't work" (B2). */
export const CANCEL_TOOLS = [
  { key: "roof", short: "Roof estimator", long: "Roof estimator" },
  { key: "fence", short: "Fence estimator", long: "Fence estimator" },
  { key: "hvac", short: "HVAC estimator", long: "HVAC estimator" },
  { key: "deck", short: "Deck Studio", long: "Deck Studio" },
  { key: "smart_proposal", short: "Smart Proposal", long: "Smart Proposal" },
  { key: "proposals", short: "Proposals & e-sign", long: "Proposals & e-sign" },
  { key: "leads", short: "Leads", long: "Leads / Lead Center" },
  { key: "crm", short: "CRM & follow-ups", long: "CRM & follow-ups" },
  { key: "texting", short: "Texting", long: "Texting & phone" },
  { key: "crew", short: "Crew & schedule", long: "Crew, jobs & schedule" },
  { key: "financials", short: "Financials", long: "Financials" },
] as const;
export type CancelTool = (typeof CANCEL_TOOLS)[number]["key"];
/** B1 offers every tool but Financials. */
export const TRY_TOOLS = CANCEL_TOOLS.filter((t) => t.key !== "financials");
export const toolLabel = (k: string) => CANCEL_TOOLS.find((t) => t.key === k)?.long ?? k;
const toolShort = (k: string) => CANCEL_TOOLS.find((t) => t.key === k)?.short ?? k;

export const BLOCKERS = [
  { key: "busy_season", label: "Busy season, no time to set up" },
  { key: "no_start", label: "I didn't know where to start" },
  { key: "setup_long", label: "Setup took longer than expected" },
  { key: "waiting_team", label: "Waiting on my team / partner" },
  { key: "other", label: "Other" },
] as const;
export type Blocker = (typeof BLOCKERS)[number]["key"];

export const PROBLEMS = [
  { key: "inaccurate", label: "Numbers were inaccurate" },
  { key: "missing", label: "Missing something I need" },
  { key: "hard", label: "Hard to use / confusing" },
  { key: "slow", label: "Too slow or buggy" },
  { key: "trade_fit", label: "Doesn't fit how my trade works" },
  { key: "not_tried", label: "Didn't try it enough to say" },
] as const;
export type Problem = (typeof PROBLEMS)[number]["key"];

export const INSTEAD = [
  { key: "sheets", label: "Spreadsheets / paper" },
  { key: "other_app", label: "Another app" },
  { key: "nothing", label: "Nothing yet" },
  { key: "deciding", label: "Still deciding" },
] as const;
export type Instead = (typeof INSTEAD)[number]["key"];

export const AGAIN = [
  { key: "yes", label: "Yes — email me when it's fixed" },
  { key: "maybe", label: "Maybe" },
  { key: "no", label: "No" },
] as const;
export type Again = (typeof AGAIN)[number]["key"];

/** B3 — the reasons that are neither time nor tools. */
export const OTHER_REASONS = [
  { key: "too_expensive", label: "Too expensive" },
  { key: "not_enough_jobs", label: "Not enough jobs right now" },
  { key: "switched_tool", label: "Switched to another tool" },
  { key: "just_testing", label: "Just testing, not ready to buy" },
  { key: "business_closed", label: "Business closed / changed" },
  { key: "other", label: "Other" },
] as const;
export type OtherReason = (typeof OTHER_REASONS)[number]["key"];

export const FAIR_PRICES = [
  { key: "25", label: "$25" },
  { key: "45", label: "$45" },
  { key: "75", label: "$75" },
  { key: "95_plus", label: "$95+" },
  { key: "per_estimate", label: "Only pay per estimate" },
] as const;
export type FairPrice = (typeof FAIR_PRICES)[number]["key"];

export const PICKUPS = [
  { key: "1m", label: "1 month" },
  { key: "2_3m", label: "2–3 months" },
  { key: "next_season", label: "Next season" },
  { key: "not_sure", label: "Not sure" },
] as const;
export type Pickup = (typeof PICKUPS)[number]["key"];

export const TEXT_MIN = 3;
/** Every short text box. */
export const TEXT_MAX = 200;
/** "What would have made it work?" and the Other boxes. */
export const LONG_MAX = 300;

export interface ToolAnswer {
  problems: Problem[];
  missing?: string;
  fix?: string;
}
export interface A1Answers {
  blockers: Blocker[];
  blockerOther?: string;
  tryFirst: CancelTool[];
}
export interface A2Answers {
  tools: CancelTool[];
  toolOther?: string;
  perTool: Partial<Record<CancelTool, ToolAnswer>>;
  instead?: Instead;
  insteadApp?: string;
  again?: Again;
  emailOk?: boolean;
}
export interface A3Answers {
  reasons: OtherReason[];
  otherText?: string;
  fairPrice?: FairPrice;
  switchedWhich?: string;
  switchedBetter?: string;
  pickup?: Pickup;
  testingHoped?: string;
}
export type CancelAnswers =
  | { v: 1; path: "A1"; a1: A1Answers }
  | { v: 1; path: "A2"; a2: A2Answers }
  | { v: 1; path: "A3"; a3: A3Answers };

/* ── the rule ─────────────────────────────────────────────────────────── */

type Keyed = readonly { key: string }[];
const keysOf = <T extends string>(list: Keyed, raw: unknown): T[] => {
  const picked = new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  return list.map((x) => x.key).filter((k) => picked.has(k)) as T[];
};
const oneOf = <T extends string>(list: Keyed, raw: unknown): T | undefined =>
  typeof raw === "string" && list.some((x) => x.key === raw) ? (raw as T) : undefined;
/** Trimmed words, or undefined when empty; too long is an error. */
function words(raw: unknown, max: number, what: string): { ok: true; v: string | undefined } | { ok: false; error: string } {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (t.length > max) return { ok: false, error: `Keep ${what} under ${max} characters.` };
  return { ok: true, v: t || undefined };
}
const obj = (raw: unknown): Record<string, unknown> => (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});

export type StepCheck = { ok: true } | { ok: false; error: string };
export type AnswersCheck<T> = { ok: true; value: T } | { ok: false; error: string };

export function checkA1(raw: unknown): AnswersCheck<A1Answers> {
  const r = obj(raw);
  const blockers = keysOf<Blocker>(BLOCKERS, r.blockers);
  if (!blockers.length) return { ok: false, error: "Pick at least one thing that got in the way." };
  const value: A1Answers = { blockers, tryFirst: keysOf<CancelTool>(TRY_TOOLS, r.tryFirst) };
  if (blockers.includes("other")) {
    const w = words(r.blockerOther, LONG_MAX, "Other");
    if (!w.ok) return w;
    if (!w.v || w.v.length < TEXT_MIN) return { ok: false, error: `Tell us a little more under Other (at least ${TEXT_MIN} characters).` };
    value.blockerOther = w.v;
  }
  return { ok: true, value };
}

/** B2 alone: at least one tool, Other with its words. */
export function checkA2Tools(raw: unknown): StepCheck {
  const r = obj(raw);
  const tools = keysOf<CancelTool>(CANCEL_TOOLS, r.tools);
  const other = typeof r.toolOther === "string" ? r.toolOther.trim() : "";
  const otherOn = r.toolOtherOn === true || other.length > 0;
  if (!tools.length && !otherOn) return { ok: false, error: "Pick at least one tool." };
  if (otherOn && other.length < TEXT_MIN) return { ok: false, error: `Name the tool under Other (at least ${TEXT_MIN} characters).` };
  if (other.length > LONG_MAX) return { ok: false, error: `Keep Other under ${LONG_MAX} characters.` };
  return { ok: true };
}

export function checkA2(raw: unknown): AnswersCheck<A2Answers> {
  const r = obj(raw);
  const first = checkA2Tools(r);
  if (!first.ok) return first;
  const tools = keysOf<CancelTool>(CANCEL_TOOLS, r.tools);
  const value: A2Answers = { tools, perTool: {} };
  const other = words(r.toolOther, LONG_MAX, "Other");
  if (!other.ok) return other;
  if (other.v) value.toolOther = other.v;
  const per = obj(r.perTool);
  for (const t of tools) {
    const a = obj(per[t]);
    const problems = keysOf<Problem>(PROBLEMS, a.problems);
    const missing = words(a.missing, TEXT_MAX, "what's missing");
    if (!missing.ok) return missing;
    const fix = words(a.fix, LONG_MAX, "what would have made it work");
    if (!fix.ok) return fix;
    const ans: ToolAnswer = { problems };
    if (missing.v && problems.includes("missing")) ans.missing = missing.v;
    if (fix.v) ans.fix = fix.v;
    if (problems.length || ans.fix) value.perTool[t] = ans;
  }
  const instead = oneOf<Instead>(INSTEAD, r.instead);
  if (instead) value.instead = instead;
  if (instead === "other_app") {
    const app = words(r.insteadApp, TEXT_MAX, "the app's name");
    if (!app.ok) return app;
    if (app.v) value.insteadApp = app.v;
  }
  const again = oneOf<Again>(AGAIN, r.again);
  if (again) value.again = again;
  if (again === "yes") value.emailOk = r.emailOk !== false;
  return { ok: true, value };
}

export function checkA3(raw: unknown): AnswersCheck<A3Answers> {
  const r = obj(raw);
  const reasons = keysOf<OtherReason>(OTHER_REASONS, r.reasons);
  if (!reasons.length) return { ok: false, error: "Pick at least one reason." };
  const value: A3Answers = { reasons };
  if (reasons.includes("other")) {
    const w = words(r.otherText, LONG_MAX, "Other");
    if (!w.ok) return w;
    if (!w.v || w.v.length < TEXT_MIN) return { ok: false, error: `Tell us a little more under Other (at least ${TEXT_MIN} characters).` };
    value.otherText = w.v;
  }
  if (reasons.includes("too_expensive")) {
    const p = oneOf<FairPrice>(FAIR_PRICES, r.fairPrice);
    if (p) value.fairPrice = p;
  }
  if (reasons.includes("switched_tool")) {
    const a = words(r.switchedWhich, TEXT_MAX, "the tool's name");
    if (!a.ok) return a;
    const b = words(r.switchedBetter, LONG_MAX, "what it does better");
    if (!b.ok) return b;
    if (a.v) value.switchedWhich = a.v;
    if (b.v) value.switchedBetter = b.v;
  }
  if (reasons.includes("not_enough_jobs")) {
    const p = oneOf<Pickup>(PICKUPS, r.pickup);
    if (p) value.pickup = p;
  }
  if (reasons.includes("just_testing")) {
    const t = words(r.testingHoped, LONG_MAX, "what you hoped to see");
    if (!t.ok) return t;
    if (t.v) value.testingHoped = t.v;
  }
  return { ok: true, value };
}

/** The whole answer, as the window sends it: the path and that path's part. */
export function checkCancelAnswers(raw: unknown): AnswersCheck<CancelAnswers> {
  const r = obj(raw);
  if (!isCancelPath(r.path)) return { ok: false, error: "Pick the main reason." };
  if (r.path === "A1") {
    const c = checkA1(r.a1);
    return c.ok ? { ok: true, value: { v: 1, path: "A1", a1: c.value } } : c;
  }
  if (r.path === "A2") {
    const c = checkA2(r.a2);
    return c.ok ? { ok: true, value: { v: 1, path: "A2", a2: c.value } } : c;
  }
  const c = checkA3(r.a3);
  return c.ok ? { ok: true, value: { v: 1, path: "A3", a3: c.value } } : c;
}

/** CancellationFeedback.answersJson → the answer; null for an older row or an unreadable one. */
export function parseCancelAnswers(json: string | null | undefined): CancelAnswers | null {
  if (!json) return null;
  try {
    const c = checkCancelAnswers(JSON.parse(json));
    return c.ok ? c.value : null;
  } catch {
    return null;
  }
}
/** TrialExtensionRequest.answersJson (B1) → the answer, or null. */
export function parseA1(json: string | null | undefined): A1Answers | null {
  if (!json) return null;
  try {
    const c = checkA1(JSON.parse(json));
    return c.ok ? c.value : null;
  } catch {
    return null;
  }
}

/* ── what is kept beside it ───────────────────────────────────────────── */

/** CancellationFeedback.reasons — the flat keys (lib/cancelFeedback labels them). */
export function flatReasons(a: CancelAnswers): string[] {
  if (a.path === "A1") return ["no_time"];
  if (a.path === "A2") return ["tools"];
  return a.a3.reasons;
}
/** CancellationFeedback.otherText — the main Other box's words, if any. */
export function mainOtherText(a: CancelAnswers): string | null {
  if (a.path === "A1") return a.a1.blockerOther ?? null;
  if (a.path === "A2") return a.a2.toolOther ?? null;
  return a.a3.otherText ?? null;
}
/** "Yes — email me when it's fixed" with the box left on. */
export function wantsFollowUp(a: CancelAnswers): boolean {
  return a.path === "A2" && a.a2.again === "yes" && a.a2.emailOk !== false;
}
/** Every tool the answer names: A2's "didn't work", or A1's "try first". */
export function toolsNamed(a: CancelAnswers | null): CancelTool[] {
  if (!a) return [];
  if (a.path === "A2") return a.a2.tools;
  if (a.path === "A1") return a.a1.tryFirst;
  return [];
}

const labelOf = (list: readonly { key: string; label: string }[], k: string | undefined) => list.find((x) => x.key === k)?.label ?? k ?? "";
const few = (xs: string[], n = 2) => (xs.length > n ? `${xs.slice(0, n).join(", ")} +${xs.length - n}` : xs.join(", "));
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The confirmation's one line: "didn't have time · wants Roof estimator". */
export function answersSummary(a: CancelAnswers): string {
  if (a.path === "A1") {
    const parts = ["didn't have time"];
    if (a.a1.tryFirst.length) parts.push(`wants ${few(a.a1.tryFirst.map(toolShort))}`);
    return parts.join(" · ");
  }
  if (a.path === "A2") {
    const named = [...a.a2.tools.map(toolShort), ...(a.a2.toolOther ? ["other"] : [])];
    return ["tools didn't work", few(named)].filter(Boolean).join(" · ");
  }
  return few(a.a3.reasons.map((k) => lower(labelOf(OTHER_REASONS, k))), 3);
}

/** /admin/users' two lines under "Last cancellation". */
export function answersBrief(a: CancelAnswers): [string, string] {
  if (a.path === "A1") {
    return [
      `Didn't have time · ${a.a1.blockers.map((k) => lower(labelOf(BLOCKERS, k))).join(", ")}`,
      a.a1.tryFirst.length ? `Wanted to try: ${a.a1.tryFirst.map(toolShort).join(", ")}` : "Named nothing to try first",
    ];
  }
  if (a.path === "A2") {
    const again = a.a2.again ? `again: ${lower(labelOf(AGAIN, a.a2.again))}` : "again: not answered";
    const instead = a.a2.instead ? `uses ${lower(labelOf(INSTEAD, a.a2.instead))}${a.a2.insteadApp ? ` (${a.a2.insteadApp})` : ""}` : null;
    return [`Tools didn't work · ${[...a.a2.tools.map(toolShort), ...(a.a2.toolOther ? [`other: ${a.a2.toolOther}`] : [])].join(", ")}`, [instead, again].filter(Boolean).join(" · ")];
  }
  const extra = [
    a.a3.fairPrice ? `fair: ${labelOf(FAIR_PRICES, a.a3.fairPrice)}` : null,
    a.a3.switchedWhich ? `switched to ${a.a3.switchedWhich}` : null,
    a.a3.pickup ? `work back in ${lower(labelOf(PICKUPS, a.a3.pickup))}` : null,
    a.a3.otherText ? `“${a.a3.otherText}”` : null,
  ].filter(Boolean);
  return [`Something else · ${a.a3.reasons.map((k) => lower(labelOf(OTHER_REASONS, k))).join(", ")}`, extra.join(" · ") || "No details given"];
}

/** The admin card: every question that was answered, in the order asked. */
export function answersLines(a: CancelAnswers): { q: string; a: string; sub?: boolean }[] {
  const out: { q: string; a: string; sub?: boolean }[] = [{ q: "Main reason", a: labelOf(CANCEL_PATHS, a.path) }];
  if (a.path === "A1") {
    out.push({ q: "What got in the way", a: a.a1.blockers.map((k) => (k === "other" && a.a1.blockerOther ? `Other: “${a.a1.blockerOther}”` : labelOf(BLOCKERS, k))).join(" · ") });
    out.push({ q: "Would try first", a: a.a1.tryFirst.length ? a.a1.tryFirst.map(toolShort).join(" · ") : "—" });
    return out;
  }
  if (a.path === "A2") {
    out.push({ q: "Tools that didn't work", a: [...a.a2.tools.map(toolLabel), ...(a.a2.toolOther ? [`Other: “${a.a2.toolOther}”`] : [])].join(" · ") });
    for (const t of a.a2.tools) {
      const x = a.a2.perTool[t];
      const probs = x?.problems.map((p) => (p === "missing" && x.missing ? `Missing: “${x.missing}”` : labelOf(PROBLEMS, p))) ?? [];
      out.push({ q: toolLabel(t), a: probs.length ? probs.join(" · ") : "No problem ticked", sub: true });
      if (x?.fix) out.push({ q: "Would have made it work", a: `“${x.fix}”`, sub: true });
    }
    out.push({ q: "Using instead", a: a.a2.instead ? `${labelOf(INSTEAD, a.a2.instead)}${a.a2.insteadApp ? `: ${a.a2.insteadApp}` : ""}` : "—" });
    out.push({ q: "Try again if fixed", a: a.a2.again ? `${labelOf(AGAIN, a.a2.again)}${a.a2.again === "yes" ? (a.a2.emailOk === false ? " (no email)" : " (email OK)") : ""}` : "—" });
    return out;
  }
  out.push({ q: "Reasons", a: a.a3.reasons.map((k) => labelOf(OTHER_REASONS, k)).join(" · ") });
  if (a.a3.otherText) out.push({ q: "Other", a: `“${a.a3.otherText}”`, sub: true });
  if (a.a3.reasons.includes("too_expensive")) out.push({ q: "Fair price", a: a.a3.fairPrice ? labelOf(FAIR_PRICES, a.a3.fairPrice) : "—", sub: true });
  if (a.a3.reasons.includes("switched_tool")) {
    out.push({ q: "Switched to", a: a.a3.switchedWhich ?? "—", sub: true });
    if (a.a3.switchedBetter) out.push({ q: "Does better", a: `“${a.a3.switchedBetter}”`, sub: true });
  }
  if (a.a3.reasons.includes("not_enough_jobs")) out.push({ q: "Work picks up", a: a.a3.pickup ? labelOf(PICKUPS, a.a3.pickup) : "—", sub: true });
  if (a.a3.reasons.includes("just_testing")) out.push({ q: "Hoped to see", a: a.a3.testingHoped ? `“${a.a3.testingHoped}”` : "—", sub: true });
  return out;
}

/** subscription_cancel_reason's own properties: keys, never words. */
export function answersEventProps(a: CancelAnswers): Record<string, string | number | boolean> {
  if (a.path === "A1") return { path: "A1", blockers: a.a1.blockers.join(","), try_first: a.a1.tryFirst.join(","), reason_count: a.a1.blockers.length, has_other: !!a.a1.blockerOther };
  if (a.path === "A2") {
    const problems = new Set<string>();
    for (const t of a.a2.tools) for (const p of a.a2.perTool[t]?.problems ?? []) problems.add(p);
    return {
      path: "A2",
      tools: a.a2.tools.join(","),
      tool_problems: a.a2.tools.flatMap((t) => (a.a2.perTool[t]?.problems ?? []).map((p) => `${t}:${p}`)).join(","),
      problems: [...problems].join(","),
      instead: a.a2.instead ?? "",
      again: a.a2.again ?? "",
      wants_follow_up: wantsFollowUp(a),
      reason_count: a.a2.tools.length,
      has_other: !!a.a2.toolOther,
    };
  }
  return {
    path: "A3",
    reasons: a.a3.reasons.join(","),
    fair_price: a.a3.fairPrice ?? "",
    pickup: a.a3.pickup ?? "",
    reason_count: a.a3.reasons.length,
    has_other: !!a.a3.otherText,
  };
}

/** The window's screens, by the names cancel_flow_step reports. */
export const FLOW_STEPS = ["A", "B1", "C1", "B2", "C2", "D2", "B3", "E_before", "E_confirm"] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];
export function isFlowStep(v: unknown): v is FlowStep {
  return typeof v === "string" && (FLOW_STEPS as readonly string[]).includes(v);
}
