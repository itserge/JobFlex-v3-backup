import "server-only";
// MORE TRIAL DAYS — the reads and writes behind "Request extension" (the
// Subscription page → Cancel subscription → "I didn't have enough time" →
// screen C1, lib/cancelTree, since 2026-11-09) and /admin/trial-requests. The
// rule and the words: lib/trialExtension. A request asked from the questions
// keeps their B1 answer (answersJson) for the admin's card.
//
//   · ask   — an owner whose plan is on its trial, or whose trial ended at most
//             14 days ago; one PENDING request per organization. The trial's
//             dates are kept on the request as they stood (Stripe's trial_start
//             when it answers). The platform admins are emailed
//             (platformAlertRecipients — SUPPORT_NOTIFY_EMAIL, else every
//             flagged admin, the rule every admin alert follows). No support
//             ticket: a customer's ticket wakes the support AI
//             (lib/support/acceptMessage), and the AI must not answer for a
//             decision that is the admins'.
//   · usage — what the company did between the trial's start and its end (or
//             now), counted from the tables the app already keeps. Sign-ins
//             are not recorded anywhere; active days are days with a screen
//             opened (PageView, lib/trialWatch).
//   · approve / deny — platform admins only (the actions guard). Approve moves
//             the Stripe subscription's trial_end by 7 or 14 days past its end
//             — for a plan already paying after its trial, past the period it
//             paid for (nothing charged twice) — proration none, then writes the
//             mirror from Stripe's reply; a plan with no Stripe subscription
//             gets the local date only, and the request says so (`localOnly`).
//             Either way the owner is emailed.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import { syncSubscriptionFromStripe } from "@/lib/stripeSync";
import { patchCardlessRecord, readCardlessRecord } from "@/lib/trialState";
import { getPlanDisplayName } from "@/lib/planCatalogServer";
import { trackActivation } from "@/lib/activation-events";
import { logServerError } from "@/lib/server-events";
import { platformAlertRecipients } from "@/lib/integrationsAlertRecipients";
import { sessionsOf } from "@/lib/trialWatch";
import { screenWords } from "@/lib/trialBoardRead";
import { extendedTrialEnd, extensionBase, trialExtensionEligible, type TrialExtensionOffer } from "@/lib/trialExtension";
import { subscriptionPeriodEndDate } from "@/lib/stripeCompat";
import { BLOCKERS, TRY_TOOLS, type A1Answers } from "@/lib/cancelTree";

/** B1 in words, for the admins' email when the owner wrote no note. */
function a1Words(a: A1Answers): string {
  const got = a.blockers.map((k) => (k === "other" && a.blockerOther ? a.blockerOther : (BLOCKERS.find((b) => b.key === k)?.label ?? k)));
  const wants = a.tryFirst.map((k) => TRY_TOOLS.find((t) => t.key === k)?.short ?? k);
  return [`In the way: ${got.join("; ")}.`, wants.length ? `Wants to try: ${wants.join(", ")}.` : null].filter(Boolean).join(" ");
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ENDED_STRIPE = new Set(["canceled", "incomplete_expired"]);

const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p;
  } catch {
    return fallback;
  }
};

/** The open request, or null — and null when the table is not in this database yet. */
export async function pendingTrialRequest(organizationId: string) {
  return db.trialExtensionRequest
    .findFirst({ where: { organizationId, status: "PENDING" }, orderBy: { createdAt: "desc" } })
    .catch(() => null);
}

/** What "Before you go" needs: null when the button is not offered at all. */
export async function trialExtensionOffer(
  organizationId: string,
  sub: { status: string; trialEndsAt: Date | null; provider: string } | null,
): Promise<TrialExtensionOffer | null> {
  if (!sub || sub.provider === "MANUAL" || !trialExtensionEligible(sub)) return null;
  // The table has to be there for a request to be kept; without it, no button.
  const tableUp = await db.trialExtensionRequest.count({ where: { organizationId } }).then(() => true, () => false);
  if (!tableUp) return null;
  const open = await pendingTrialRequest(organizationId);
  return { pending: open ? { days: open.requestedDays, at: open.createdAt.toISOString() } : null };
}

/** The trial's start and end as Stripe holds them, else the mirror's and the card-less record's. */
async function trialDates(organizationId: string, sub: { externalSubId: string | null; provider: string; trialEndsAt: Date | null; createdAt: Date }) {
  let start: Date | null = null;
  let end: Date | null = sub.trialEndsAt;
  if (sub.provider === "STRIPE" && sub.externalSubId && isStripeEnabled()) {
    try {
      const { stripe } = await getStripeClient();
      const live = await stripe.subscriptions.retrieve(sub.externalSubId);
      if (live.trial_start) start = new Date(live.trial_start * 1000);
      if (live.trial_end) end = new Date(live.trial_end * 1000);
    } catch {
      /* the mirror's dates stand */
    }
  }
  if (!start) {
    const rec = await readCardlessRecord(organizationId).catch(() => null);
    const t = rec?.startedAt ? Date.parse(rec.startedAt) : NaN;
    start = Number.isFinite(t) ? new Date(t) : sub.createdAt;
  }
  return { start, end };
}

async function ownerOf(organizationId: string) {
  const m = await db.membership.findFirst({
    where: { organizationId, role: "OWNER" },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { email: true, name: true } }, organization: { select: { name: true, billingEmail: true } } },
  });
  return {
    email: m?.organization.billingEmail || m?.user.email || null,
    loginEmail: m?.user.email ?? null,
    name: m?.user.name ?? null,
    orgName: m?.organization.name ?? "A company",
  };
}

async function mail(to: string | string[], doc: Parameters<typeof import("@/lib/email/renderEmail").renderEmail>[0]) {
  const [{ renderEmail }, { sendEmail }] = await Promise.all([import("@/lib/email/renderEmail"), import("@/lib/sdk/resend")]);
  const { subject, html } = renderEmail(doc);
  for (const address of Array.isArray(to) ? to : [to]) await sendEmail({ to: address, subject, html });
}

async function base() {
  const { appBaseUrl } = await import("@/lib/appUrl");
  return (await appBaseUrl()).replace(/\/$/, "");
}

function refresh() {
  try {
    revalidatePath("/admin/trial-requests");
    revalidatePath("/admin", "layout");
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/subscription");
  } catch {
    /* outside a request (a script) */
  }
}

// ── ask ─────────────────────────────────────────────────────────────────────

export type AskResult =
  | { ok: true; pending: false; id: string }
  | { ok: true; pending: true; days: number; at: string }
  | { ok: false; error: string };

export async function askForTrialExtension(input: { organizationId: string; userId: string; days: number; note: string | null; answers?: A1Answers | null }): Promise<AskResult> {
  const { organizationId, userId, days, note } = input;
  const answers = input.answers ?? null;
  const sub = await db.subscription.findUnique({ where: { organizationId } });
  if (!sub || sub.provider === "MANUAL" || !trialExtensionEligible(sub)) {
    return { ok: false, error: "A trial extension can be asked for during the trial, or within 14 days after it ends." };
  }
  const open = await pendingTrialRequest(organizationId);
  if (open) return { ok: true, pending: true, days: open.requestedDays, at: open.createdAt.toISOString() };

  const dates = await trialDates(organizationId, sub);
  let row;
  try {
    row = await db.trialExtensionRequest.create({
      data: { organizationId, userId, requestedDays: days, note, plan: sub.plan, trialStartedAt: dates.start, trialEndsAt: dates.end, answersJson: answers ? JSON.stringify(answers) : null },
    });
  } catch (err) {
    logServerError("trial-extension.ask", err, { kind: "action", organizationId });
    return { ok: false, error: "Couldn't send the request. Try again." };
  }

  const ended = sub.status !== "TRIALING";
  try {
    const [owner, planName, to, root] = await Promise.all([ownerOf(organizationId), getPlanDisplayName(sub.plan).catch(() => sub.plan), platformAlertRecipients(), base()]);
    const { buildTrialExtensionAsked } = await import("@/lib/email/build/trialExtension");
    if (to.length) {
      await mail(
        to,
        buildTrialExtensionAsked({ orgName: owner.orgName, ownerEmail: owner.loginEmail ?? owner.email ?? "—", planName, trialEndsAt: dates.end, ended, days, note: note ?? (answers ? a1Words(answers) : null), href: `${root}/admin/trial-requests?request=${row.id}` }),
      );
    } else {
      console.warn(`[trial-extension] request ${row.id} kept with nobody to email — set SUPPORT_NOTIFY_EMAIL or flag a platform admin.`);
    }
  } catch (err) {
    console.warn("[trial-extension] the admins' email failed:", err);
  }
  trackActivation("trial_extension_requested", organizationId, {
    requested_days: days,
    has_note: Boolean(note),
    trial_state: ended ? "ended" : "trialing",
    ...(answers ? { from: "cancel_flow", blockers: answers.blockers.join(","), try_first: answers.tryFirst.join(",") } : {}),
  });
  refresh();
  return { ok: true, pending: false, id: row.id };
}

// ── what the trial was used for ─────────────────────────────────────────────

export interface UsageCount {
  key: string;
  label: string;
  count: number;
}
export interface TrialUsage {
  from: string;
  to: string;
  /** The trial is still running: the period ends now, not at its end. */
  ongoing: boolean;
  activity: { activeDays: number; visits: number; screens: number; available: boolean };
  /** One row per estimator, whether or not it was used. */
  estimators: UsageCount[];
  /** Proposals created in the period, by where they came from. */
  proposalsBy: UsageCount[];
  numbers: UsageCount[];
  /** What it used, in words — every non-zero line, then the screens most opened. */
  used: string[];
  topScreens: { label: string; views: number }[];
}

/** The sidebar's words for a screen; a screen the sidebar does not list
 *  (Settings, a sub-page) by its own path rather than as "Overview · …". */
function screenName(route: string): string {
  const words = screenWords(route);
  const rest = words.startsWith("Overview · ") ? words.slice("Overview · ".length) : null;
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : words;
}

const TRADE_LABEL: Record<string, string> = {
  roof: "Roof estimator",
  roofing: "Roof estimator",
  fence: "Fence estimator",
  fencing: "Fence estimator",
  hvac: "HVAC estimator",
  deck: "Deck Studio",
};

export async function trialUsage(organizationId: string, period: { start: Date; end: Date | null }, now = Date.now()): Promise<TrialUsage> {
  const to = new Date(Math.min(period.end?.getTime() ?? now, now));
  const from = period.start.getTime() < to.getTime() ? period.start : new Date(to.getTime() - 7 * DAY_MS);
  const at = { gte: from, lte: to };
  const where = { organizationId, createdAt: at };

  const [views, briefs, roofs, hvacs, aiEstimates, proposals, sent, signed, leads, offers, sms, clients, projects, jobs, workers, members] = await Promise.all([
    db.pageView.findMany({ where: { organizationId, at }, select: { route: true, at: true }, take: 20_000 }).catch(() => null),
    safe(db.aiDraft.count({ where }), 0),
    safe(db.roofMeasurement.count({ where }), 0),
    safe(db.hvacEstimate.count({ where }), 0),
    safe(db.aiEstimate.count({ where }), 0),
    safe(db.proposal.findMany({ where, select: { trade: true, aiDraftId: true }, take: 5_000 }), [] as { trade: string | null; aiDraftId: string | null }[]),
    safe(db.proposal.count({ where: { organizationId, sentAt: at } }), 0),
    safe(db.proposal.count({ where: { organizationId, acceptedAt: at } }), 0),
    safe(db.lead.count({ where }), 0),
    safe(db.leadOffer.count({ where }), 0),
    safe(db.smsMessage.count({ where: { ...where, direction: "OUT", status: { in: ["SENT", "DELIVERED"] } } }), 0),
    safe(db.client.count({ where }), 0),
    safe(db.project.count({ where }), 0),
    safe(db.job.count({ where }), 0),
    safe(db.workerProfile.count({ where }), 0),
    safe(db.membership.count({ where: { ...where, role: { not: "OWNER" } } }), 0),
  ]);

  const fence = proposals.filter((p) => p.trade === "fence" || p.trade === "fencing").length;
  const estimators: UsageCount[] = [
    { key: "smart", label: "Smart Proposal briefs", count: briefs },
    { key: "roof", label: "Roof measurements", count: roofs },
    { key: "fence", label: "Fence estimates", count: fence },
    { key: "hvac", label: "HVAC estimates", count: hvacs },
    { key: "ai", label: "AI estimates", count: aiEstimates },
  ];

  const by = new Map<string, number>();
  for (const p of proposals) {
    const label = p.aiDraftId ? "Smart Proposal" : (p.trade && TRADE_LABEL[p.trade.toLowerCase()]) || (p.trade ? `${p.trade.charAt(0).toUpperCase()}${p.trade.slice(1)}` : "Manual / template");
    by.set(label, (by.get(label) ?? 0) + 1);
  }
  const proposalsBy = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ key: label, label, count }));

  const numbers: UsageCount[] = [
    { key: "proposals", label: "Proposals created", count: proposals.length },
    { key: "sent", label: "Sent to clients", count: sent },
    { key: "signed", label: "Signed", count: signed },
    { key: "clients", label: "Clients added", count: clients },
    { key: "leads", label: "Leads received", count: leads },
    { key: "offers", label: "JobFlex leads offered", count: offers },
    { key: "sms", label: "Texts sent", count: sms },
    { key: "projects", label: "Projects", count: projects },
    { key: "jobs", label: "Jobs", count: jobs },
    { key: "workers", label: "Workers added", count: workers },
    { key: "members", label: "Team members added", count: members },
  ];

  const days = new Set<number>();
  const counts = new Map<string, number>();
  for (const v of views ?? []) {
    days.add(Math.floor(v.at.getTime() / DAY_MS));
    const label = screenName(v.route);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const visits = views ? sessionsOf(views.map((v) => ({ route: v.route, at: v.at.toISOString() }))).length : 0;
  const topScreens = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, n]) => ({ label, views: n }));

  const used = [
    ...estimators.filter((e) => e.count > 0).map((e) => `${e.label}: ${e.count}`),
    ...numbers.filter((n) => n.count > 0).map((n) => `${n.label}: ${n.count}`),
    ...topScreens.slice(0, 5).map((s) => `Opened ${s.label} (${s.views} ${s.views === 1 ? "view" : "views"})`),
  ];

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    ongoing: !period.end || period.end.getTime() > now,
    activity: { activeDays: days.size, visits, screens: views?.length ?? 0, available: views !== null },
    estimators,
    proposalsBy,
    numbers,
    used,
    topScreens,
  };
}

// ── decide ──────────────────────────────────────────────────────────────────

export type DecideResult = { ok: true; until?: string; localOnly?: boolean } | { ok: false; error: string };

export async function approveTrialRequest(id: string, days: number, actor: { id: string }): Promise<DecideResult> {
  const req = await db.trialExtensionRequest.findUnique({ where: { id } });
  if (!req) return { ok: false, error: "That request is gone." };
  if (req.status !== "PENDING") return { ok: false, error: `This request was already ${req.status.toLowerCase()}.` };
  const organizationId = req.organizationId;
  const sub = await db.subscription.findUnique({ where: { organizationId } });
  if (!sub) return { ok: false, error: "The company has no subscription to extend." };

  let until: Date;
  let localOnly = false;
  if (sub.provider === "STRIPE" && sub.externalSubId && isStripeEnabled()) {
    try {
      const { stripe } = await getStripeClient();
      const live = await stripe.subscriptions.retrieve(sub.externalSubId);
      if (ENDED_STRIPE.has(live.status)) {
        return { ok: false, error: "The Stripe subscription has ended — there is no trial to move. Grant a plan from Users & subscriptions instead." };
      }
      // A trial runs on from its end; a plan already paying after its trial
      // gets the days after the period it paid for (lib/trialExtension
      // extensionBase) — trial_end on an active subscription restarts the
      // cycle there, so starting at now would charge the paid days twice.
      const base =
        live.status === "trialing"
          ? live.trial_end && new Date(live.trial_end * 1000)
          : live.status === "active"
            ? subscriptionPeriodEndDate(live)
            : null;
      until = extendedTrialEnd(base || null, days);
      const updated = await stripe.subscriptions.update(sub.externalSubId, {
        trial_end: Math.floor(until.getTime() / 1000),
        proration_behavior: "none",
      });
      if (updated.trial_end) until = new Date(updated.trial_end * 1000);
      await syncSubscriptionFromStripe(updated, stripe).catch((err) => console.warn("[trial-extension] mirror sync failed, writing the date only:", err));
      // The mirror holds the new end even if the sync above could not write it.
      await db.subscription.update({ where: { organizationId }, data: { trialEndsAt: until } });
    } catch (err) {
      logServerError("trial-extension.approve", err, { kind: "action", organizationId });
      return { ok: false, error: "Stripe refused the new trial end. Nothing was changed." };
    }
  } else {
    localOnly = true;
    until = extendedTrialEnd(extensionBase(sub), days);
    await db.subscription.update({
      where: { organizationId },
      data: { trialEndsAt: until, ...(sub.status === "TRIALING" ? { currentPeriodEnd: until } : {}) },
    });
  }
  // A card-less trial's record keeps its own end as the fallback (lib/trialState).
  const rec = await readCardlessRecord(organizationId).catch(() => null);
  if (rec && (!sub.externalSubId || rec.subId === sub.externalSubId)) {
    await patchCardlessRecord(organizationId, { endsAt: until.toISOString() }).catch(() => null);
  }

  const done = await db.trialExtensionRequest.updateMany({
    where: { id, status: "PENDING" },
    data: {
      status: "APPROVED",
      grantedDays: days,
      extendedUntil: until,
      localOnly,
      decisionNote: localOnly ? "Local date only — this plan has no Stripe subscription." : null,
      decidedBy: actor.id,
      decidedAt: new Date(),
    },
  });
  if (!done.count) console.warn(`[trial-extension] ${id} was decided twice; the trial end is ${until.toISOString()}`);

  try {
    const [owner, planName, root] = await Promise.all([ownerOf(organizationId), getPlanDisplayName(sub.plan).catch(() => sub.plan), base()]);
    const { buildTrialExtended } = await import("@/lib/email/build/trialExtension");
    if (owner.email) await mail(owner.email, buildTrialExtended({ name: owner.name, planName, until, days, href: `${root}/dashboard` }));
  } catch (err) {
    console.warn("[trial-extension] the approval email failed:", err);
  }
  refresh();
  return { ok: true, until: until.toISOString(), localOnly };
}

export async function denyTrialRequest(id: string, reason: string | null, actor: { id: string }): Promise<DecideResult> {
  const req = await db.trialExtensionRequest.findUnique({ where: { id } });
  if (!req) return { ok: false, error: "That request is gone." };
  if (req.status !== "PENDING") return { ok: false, error: `This request was already ${req.status.toLowerCase()}.` };
  const done = await db.trialExtensionRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "DENIED", decisionNote: reason, decidedBy: actor.id, decidedAt: new Date() },
  });
  if (!done.count) return { ok: false, error: "This request was decided a moment ago." };
  try {
    const sub = await db.subscription.findUnique({ where: { organizationId: req.organizationId }, select: { plan: true } });
    const plan = sub?.plan ?? req.plan ?? "";
    const [owner, planName, root] = await Promise.all([ownerOf(req.organizationId), getPlanDisplayName(plan).catch(() => plan), base()]);
    const { buildTrialExtensionDenied } = await import("@/lib/email/build/trialExtension");
    if (owner.email) await mail(owner.email, buildTrialExtensionDenied({ name: owner.name, planName, reason, href: `${root}/dashboard/subscription` }));
  } catch (err) {
    console.warn("[trial-extension] the denial email failed:", err);
  }
  refresh();
  return { ok: true };
}
