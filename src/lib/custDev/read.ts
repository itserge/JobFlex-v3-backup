import "server-only";
// What the customer development page reads (owner, 2026-10-22) — only what the database already keeps: every
// counted account (not deleted, not internal, not taken out of the statistics — lib/statsHidden) with its plan, its
// first estimate or proposal, what it sent and what its clients accepted; what customers wrote — support tickets and
// every message under them, by email or in the app (the support inbox reads the emails into SupportMessage);
// cancellation reasons and the words under Other; trial-extension notes. Plus what the page itself keeps
// (lib/custDev/store). Every query stands alone and fails quietly: a table missing in a database costs its part only.
import { db } from "@/lib/db";
import { statsHiddenIds, countedOrgs } from "@/lib/statsHidden";
import { parseTradeTypes } from "@/lib/tradeTypes";
import { ADMIN_REASON, parseReasons } from "@/lib/cancelFeedback";
import { signupSource } from "@/lib/traffic-live";
import { VARIANT_TRADE, resolveLandingVariant } from "@/components/v3/landing-e/landing-variants";
import {
  DAY,
  callList,
  cohorts,
  earlyAdopters,
  funnel,
  hypothesisViews,
  interviewStats,
  isoWeek,
  measures,
  orgState,
  overallRow,
  payingByMonth,
  regionOf,
  segmentsBy,
  stages,
  themesOf,
  voiceSummary,
  type CallCard,
  type CancelFact,
  type CohortRow,
  type FunnelStep,
  type HypothesisView,
  type Interview,
  type InterviewStats,
  type Measures,
  type OrgFact,
  type SegmentRow,
  type StageView,
  type ThemeKey,
  type VoiceItem,
  type WeekScore,
} from "@/lib/custDev/model";
import { listInterviews, readHypothesisEdits, readSynthesis, readWeeks, recordWeek, type Synthesis } from "@/lib/custDev/store";

const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p;
  } catch {
    return fallback;
  }
};
const countBy = (rows: ReadonlyArray<{ organizationId: string; _count: { _all: number } }>) => new Map(rows.map((r) => [r.organizationId, r._count._all]));
const firstBy = (rows: ReadonlyArray<{ organizationId: string; _min: { createdAt: Date | null } }>) => new Map(rows.map((r) => [r.organizationId, r._min.createdAt?.getTime() ?? null]));

/** The estimator trades first (they are JobFlex's tools), then the first trade picked, the ad's trade, the "Other" words. */
const ESTIMATOR_TRADES = ["Roofing", "HVAC", "Fencing", "Decking"];
function tradeName(o: { tradeTypesJson: string | null; landingIndustry: string | null; otherTrade: string | null }): string {
  const picked: string[] = parseTradeTypes(o.tradeTypesJson).filter((t) => t !== "Other");
  const landing = resolveLandingVariant(o.landingIndustry);
  const fromAd = landing ? (VARIANT_TRADE as Record<string, string>)[landing] : null;
  const other = o.otherTrade?.trim();
  const name = picked.find((t) => ESTIMATOR_TRADES.includes(t)) ?? picked[0] ?? fromAd ?? (other ? other.charAt(0).toUpperCase() + other.slice(1) : null);
  return name || "Not given";
}

export interface VoiceRow extends VoiceItem {
  themes: ThemeKey[];
}

export interface CustDevView {
  now: number;
  totals: { signups: number; payingNow: number; trialing: number; left: number; everPaid: number };
  measures: Measures;
  stages: StageView[];
  current: StageView["key"];
  hypotheses: HypothesisView[];
  segments: { trade: SegmentRow[]; channel: SegmentRow[]; overall: SegmentRow; early: { key: string; lift: number } | null };
  funnel: FunnelStep[];
  cohorts: CohortRow[];
  payingByMonth: number[];
  voice: ReturnType<typeof voiceSummary>;
  voiceRows: VoiceRow[];
  interviews: Interview[];
  interviewStats: InterviewStats;
  calls: CallCard[];
  synthesis: Synthesis | null;
  weeks: WeekScore[];
  /** The accounts, for the interview form's company field. */
  accounts: Array<{ id: string; name: string; trade: string }>;
  /** A part whose table is not in this database. */
  missing: string[];
}

export async function readCustDev(opts: { now?: number; recordScore?: boolean } = {}): Promise<CustDevView> {
  const now = opts.now ?? Date.now();
  const hidden = await safe(statsHiddenIds(), []);
  const found = await db.organization.findMany({
    where: { ...countedOrgs(hidden), isInternal: false },
    orderBy: { createdAt: "asc" },
    take: 10_000,
    select: {
      id: true,
      name: true,
      createdAt: true,
      address: true,
      phone: true,
      tradeTypesJson: true,
      otherTrade: true,
      landingIndustry: true,
      utmSource: true,
      utmMedium: true,
      memberships: { orderBy: { createdAt: "asc" }, select: { role: true, user: { select: { email: true, name: true, phone: true } } } },
      subscription: { select: { status: true, plan: true, trialEndsAt: true, canceledAt: true, createdAt: true } },
    },
  });
  const ids = found.map((o) => o.id);
  const inOrgs = { organizationId: { in: ids } };
  const has = ids.length > 0;
  const missing: string[] = [];
  const opt = async <T>(name: string, p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      missing.push(name);
      return fallback;
    }
  };

  const [proposals, sent, accepted, roofs, hvacs, briefs, plans, views, cancelRows, trialRows, tickets, interviews, edits, synthesis, weeks] = await Promise.all([
    has ? safe(db.proposal.groupBy({ by: ["organizationId"], where: inOrgs, _count: { _all: true }, _min: { createdAt: true } }), []) : [],
    has ? safe(db.proposal.groupBy({ by: ["organizationId"], where: { ...inOrgs, sentAt: { not: null } }, _count: { _all: true } }), []) : [],
    has ? safe(db.proposal.groupBy({ by: ["organizationId"], where: { ...inOrgs, acceptedAt: { not: null } }, _count: { _all: true } }), []) : [],
    has ? safe(db.roofMeasurement.groupBy({ by: ["organizationId"], where: inOrgs, _count: { _all: true }, _min: { createdAt: true } }), []) : [],
    has ? safe(db.hvacEstimate.groupBy({ by: ["organizationId"], where: inOrgs, _count: { _all: true }, _min: { createdAt: true } }), []) : [],
    has ? safe(db.aiDraft.groupBy({ by: ["organizationId"], where: inOrgs, _count: { _all: true }, _min: { createdAt: true } }), []) : [],
    // Deck and fence plans drawn (the activity trail's DECK_PLAN / FENCE_PLAN).
    has ? safe(db.activityEvent.groupBy({ by: ["organizationId"], where: { ...inOrgs, kind: { in: ["DECK_PLAN", "FENCE_PLAN"] } }, _count: { _all: true }, _min: { createdAt: true } }), []) : [],
    has ? safe(db.pageView.findMany({ where: inOrgs, select: { organizationId: true, at: true }, take: 300_000 }), []) : [],
    opt("Cancellation reasons", db.cancellationFeedback.findMany({ orderBy: { createdAt: "desc" }, take: 3000, select: { id: true, organizationId: true, reasons: true, otherText: true, createdAt: true } }), []),
    opt("Trial requests", db.trialExtensionRequest.findMany({ where: { note: { not: null } }, orderBy: { createdAt: "desc" }, take: 2000, select: { id: true, organizationId: true, note: true, createdAt: true } }), []),
    opt(
      "Support",
      db.supportTicket.findMany({
        orderBy: { createdAt: "desc" },
        take: 3000,
        select: {
          id: true,
          organizationId: true,
          subject: true,
          body: true,
          category: true,
          createdAt: true,
          messages: { where: { from: "customer" }, orderBy: { createdAt: "asc" }, select: { id: true, body: true, channel: true, createdAt: true } },
        },
      }),
      [],
    ),
    safe(listInterviews(), []),
    safe(readHypothesisEdits(), []),
    safe(readSynthesis(), null),
    safe(readWeeks(), []),
  ]);

  const proposalsBy = countBy(proposals);
  const sentBy = countBy(sent);
  const acceptedBy = countBy(accepted);
  const estimatesBy = new Map<string, number>();
  for (const rows of [roofs, hvacs, briefs, plans]) for (const r of rows) estimatesBy.set(r.organizationId, (estimatesBy.get(r.organizationId) ?? 0) + r._count._all);
  const firsts = [firstBy(proposals), firstBy(roofs), firstBy(hvacs), firstBy(briefs), firstBy(plans)];
  const seen = new Map<string, { days: Set<number>; last: number }>();
  for (const v of views) {
    const t = v.at.getTime();
    const e = seen.get(v.organizationId) ?? { days: new Set<number>(), last: 0 };
    e.days.add(Math.floor(t / DAY));
    e.last = Math.max(e.last, t);
    seen.set(v.organizationId, e);
  }

  const orgs: OrgFact[] = found.map((o) => {
    const owner = o.memberships.find((m) => m.role === "OWNER")?.user ?? o.memberships[0]?.user ?? null;
    const src = signupSource({ utmSource: o.utmSource ?? "", utmMedium: o.utmMedium ?? "" });
    const first = firsts.map((m) => m.get(o.id) ?? null).filter((t): t is number => t !== null);
    return {
      id: o.id,
      name: o.name,
      createdAt: o.createdAt.getTime(),
      trade: tradeName(o),
      region: regionOf(o.address),
      channel: src.label,
      fromAd: src.fromAd,
      contact: { name: owner?.name ?? null, email: owner?.email ?? null, phone: o.phone ?? owner?.phone ?? null },
      sub: o.subscription
        ? { status: o.subscription.status, plan: o.subscription.plan, trialEndsAt: o.subscription.trialEndsAt?.getTime() ?? null, canceledAt: o.subscription.canceledAt?.getTime() ?? null, startedAt: o.subscription.createdAt.getTime() }
        : null,
      firstValueAt: first.length ? Math.min(...first) : null,
      proposals: proposalsBy.get(o.id) ?? 0,
      sent: sentBy.get(o.id) ?? 0,
      accepted: acceptedBy.get(o.id) ?? 0,
      estimates: estimatesBy.get(o.id) ?? 0,
      activeDays: seen.get(o.id)?.days.size ?? 0,
      lastSeenAt: seen.get(o.id)?.last ?? null,
    };
  });
  const byId = new Map(orgs.map((o) => [o.id, o]));

  // What customers wrote, from the counted accounts only.
  const voice: VoiceItem[] = [];
  const who = (orgId: string) => {
    const o = byId.get(orgId);
    return o ? { orgId, company: o.name, trade: o.trade, region: o.region } : null;
  };
  for (const t of tickets) {
    const w = who(t.organizationId);
    if (!w) continue;
    voice.push({ id: `t:${t.id}`, at: t.createdAt.getTime(), ...w, source: "support", subject: t.subject.trim(), text: t.body.trim(), category: t.category });
    for (const m of t.messages) voice.push({ id: `m:${m.id}`, at: m.createdAt.getTime(), ...w, source: m.channel === "email" ? "email" : "support", text: m.body, category: t.category });
  }
  const cancels: CancelFact[] = [];
  for (const c of cancelRows) {
    const w = who(c.organizationId);
    if (!w) continue;
    const reasons = parseReasons(c.reasons);
    // A platform admin's cancel (lib/adminCancel): its words are support's note, not the customer's voice.
    if (reasons.includes(ADMIN_REASON)) continue;
    cancels.push({ id: c.id, orgId: c.organizationId, at: c.createdAt.getTime(), reasons, otherText: c.otherText });
    voice.push({ id: `c:${c.id}`, at: c.createdAt.getTime(), ...w, source: "cancel", text: c.otherText ?? "", reasons });
  }
  for (const r of trialRows) {
    const w = who(r.organizationId);
    if (!w || !r.note?.trim()) continue;
    voice.push({ id: `r:${r.id}`, at: r.createdAt.getTime(), ...w, source: "trial", text: r.note });
  }
  voice.sort((a, b) => b.at - a.at);

  const m = measures(orgs, cancels, voice, interviews, now);
  const hypotheses = hypothesisViews(edits, m, interviews);
  const monthly = payingByMonth(orgs, now);
  const st = stages({ orgs, interviews, m, payingByMonth: monthly, now });
  const trade = segmentsBy(orgs, now, (o) => o.trade);
  const overall = overallRow(orgs, now);
  const early = earlyAdopters(trade, overall);
  const states = orgs.map((o) => orgState(o, now));
  const totals = {
    signups: orgs.length,
    payingNow: states.filter((s) => s.payingNow).length,
    trialing: states.filter((s) => s.trialing).length,
    left: states.filter((s) => s.left).length,
    everPaid: states.filter((s) => s.everPaid).length,
  };

  let weekList = weeks;
  if (opts.recordScore) {
    const score: WeekScore = {
      week: isoWeek(now),
      at: now,
      signups: totals.signups,
      payingNow: totals.payingNow,
      activation: m.activation.value,
      trialToPaid: m.trialToPaid.value,
      retention30: m.retention30.value,
      interviews: interviews.length,
      validated: hypotheses.filter((h) => h.shown === "validated" || h.shown === "supported").length,
      invalidated: hypotheses.filter((h) => h.shown === "invalidated" || h.shown === "refuted").length,
      voice: voice.length,
    };
    weekList = await safe(recordWeek(score), weeks);
  }

  return {
    now,
    totals,
    measures: m,
    stages: st.list,
    current: st.current,
    hypotheses,
    segments: { trade, channel: segmentsBy(orgs, now, (o) => o.channel), overall, early: early ? { key: early.row.key, lift: early.lift } : null },
    funnel: funnel(orgs, now),
    cohorts: cohorts(orgs, now),
    payingByMonth: monthly,
    voice: voiceSummary(voice, now),
    voiceRows: voice.slice(0, 400).map((v) => ({ ...v, themes: themesOf(v) })),
    interviews,
    interviewStats: interviewStats(interviews, now),
    calls: callList(orgs, cancels, voice, interviews, now),
    synthesis,
    weeks: weekList,
    accounts: [...orgs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3000).map((o) => ({ id: o.id, name: o.name, trade: o.trade })),
    missing,
  };
}
