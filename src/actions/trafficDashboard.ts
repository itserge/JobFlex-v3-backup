"use server";

import { adSpendToday } from "@/lib/adSpendToday";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { fetchSignupDropoff, getLiveTraffic as liveTraffic, getMapHistory as mapHistory, getStageVisitors, getTrafficExperiments, getTrafficReport, posthogApiConfig } from "@/lib/traffic-server";
import { DROPOFF_DAYS, type DropoffReport } from "@/lib/signup-dropoff";
import { readAnalyst, type AnalystResult } from "@/lib/traffic-analyst-read";
import { parseTrafficFilters } from "@/lib/traffic-query";
import { TRAFFIC_SINCE_MS } from "@/lib/traffic-visitor";
import { valueSignups } from "@/lib/trialProjectionRead";
import { countedOrgs, setStatsHidden, statsHiddenIds } from "@/lib/statsHidden";
import { qaOrgIds } from "@/lib/qaTestMode";
import { lapseReasons } from "@/lib/lapseReason";
import type { SignupAttribution, StaleNote } from "@/lib/traffic-contract";
import { adNameKey, adTagsOf, isMapSpan, signupLedgerSummary, signupPlanLabel, signupSource, signupState, type FreshSignup, type LiveReport, type LiveVisitor, type MapHistory, type MapSpan, type SignupLedger, type SignupRecord } from "@/lib/traffic-live";

/** The organizations made in the last day (or the map's longer span), with
 *  the owner who made them — the rows a live signup is tied back to
 *  (lib/traffic-live). */
async function freshSignups(hours = 24, take = 60): Promise<FreshSignup[]> {
  try {
    const rows = await db.organization.findMany({
      where: { createdAt: { gte: new Date(Date.now() - hours * 60 * 60 * 1000) }, ...countedOrgs(await statsHiddenIds()) },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true, name: true, createdAt: true, utmSource: true, utmMedium: true, utmCampaign: true, landingIndustry: true,
        memberships: { orderBy: { createdAt: "asc" }, take: 1, select: { user: { select: { email: true, name: true } } } },
        // What they actually signed up FOR. The browser event says what the
        // page offered; this row is Stripe's truth, mirrored by the webhooks,
        // and it is the only place that knows a trial from a payment.
        subscription: { select: { plan: true, status: true, trialEndsAt: true } },
      },
    });
    return rows.map((r) => ({
      orgId: r.id, orgName: r.name, createdAt: r.createdAt.toISOString(),
      ownerEmail: r.memberships[0]?.user.email ?? "", ownerName: r.memberships[0]?.user.name ?? "",
      plan: r.subscription?.plan ?? "", subStatus: r.subscription?.status ?? "",
      trialEndsAt: r.subscription?.trialEndsAt?.toISOString() ?? null,
      utmSource: r.utmSource ?? "", utmMedium: r.utmMedium ?? "", utmCampaign: r.utmCampaign ?? "", landingIndustry: r.landingIndustry ?? "",
    }));
  } catch {
    return []; // the live panel still shows the visitors
  }
}

/** Who is on the site now, where from, how far they got — and the signups
 *  among them named (2026-09-28). `includeDevelopment` shows localhost too. */
export async function getLiveTraffic(input: Record<string, unknown> = {}): Promise<LiveReport> {
  await requirePlatformAdmin();
  // 25 hours: the day the clocks go back is that long, and "today" must hold all of it.
  const signups = await freshSignups(25);
  const report = await liveTraffic(signups, {
    includeDevelopment: input.includeDevelopment === true,
    // "Today" is the page's one day (TRAFFIC_TZ, lib/traffic-visitor) for
    // the visitors and the signups alike — not the caller's zone, and not
    // the last 24 hours the signup rows above reach back.
    // The Refresh button: PostHog asked again, unless it was in the last 30 s
    // (lib/posthog-cache). The 15-second poll never forces — it gets the minute's answer.
    force: input.force === true,
    // Counted from TRAFFIC_SINCE unless the admin asks for the full history.
    fullHistory: input.fullHistory === true,
  });
  // Spent on ads today (2026-10-15): independent of PostHog, so it rides along even on a stale or failed read.
  const [named, adSpend] = await Promise.all([withNames(report), adSpendToday().catch(() => null)]);
  return { ...named, adSpend };
}

/** The names the live view shows next to bare ids (owner, 2026-10-01): the
 *  owner's own names for ad and campaign ids, and the company and person
 *  behind a member's visit. A failed read costs the names, never the panel.
 *  The report from lib/traffic-server is a shared cache — copied, not mutated. */
async function withNames(report: LiveReport): Promise<LiveReport> {
  if (report.status !== "ok") return report;
  // The day's converts are named the same way: their ads, and their company once they are in the app.
  const { adNames, named } = await namesFor(adTagsOf(report), [...report.visitors, ...report.converted]);
  return { ...report, adNames, visitors: report.visitors.map(named), converted: report.converted.map(named) };
}

/** The owner's names for these ad tags, and a function that puts the member's
 *  company and person on a visitor (shared by the live window and the map's spans). */
async function namesFor(tags: string[], everyone: LiveVisitor[]): Promise<{ adNames: Record<string, string>; named: (v: LiveVisitor) => LiveVisitor }> {
  const orgIds = [...new Set(everyone.map((v) => v.orgId).filter(Boolean))];
  const userIds = [...new Set(everyone.map((v) => v.userId).filter(Boolean))];
  const [names, orgs, users] = await Promise.all([
    tags.length ? db.syncState.findMany({ where: { key: { in: tags.map(adNameKey) } }, select: { key: true, cursor: true } }).catch(() => []) : [],
    orgIds.length ? db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }).catch(() => []) : [],
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }).catch(() => []) : [],
  ]);
  const adNames: Record<string, string> = {};
  for (const t of tags) { const row = names.find((n) => n.key === adNameKey(t)); if (row?.cursor) adNames[t] = row.cursor; }
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const userName = new Map(users.map((u) => [u.id, u.name || u.email]));
  const named = (v: LiveVisitor): LiveVisitor => (v.orgId && orgName.has(v.orgId)
    ? { ...v, member: { orgName: orgName.get(v.orgId) ?? "", userName: userName.get(v.userId) ?? "" } }
    : v);
  return { adNames, named };
}

/** The map over a longer span than the live window (2026-10-03): 1 hour to a
 *  month, one row per person (lib/traffic-server getMapHistory), named like
 *  the live view and tied to the organizations made in the span. */
export async function getMapHistory(input: Record<string, unknown> = {}): Promise<MapHistory> {
  await requirePlatformAdmin();
  const minutes: MapSpan = isMapSpan(input.minutes) && Number(input.minutes) >= 60 ? (Number(input.minutes) as MapSpan) : 60;
  const signups = await freshSignups(Math.ceil(minutes / 60), 400);
  const h = await mapHistory(minutes, signups, { includeDevelopment: input.includeDevelopment === true, fullHistory: input.fullHistory === true });
  if (h.status !== "ok") return { ...h, adNames: {} };
  const tags = [...new Set(h.visitors.flatMap((v) => [v.campaign, v.content]).filter((t) => t && t.length <= 120))];
  const { adNames, named } = await namesFor(tags, h.visitors);
  return { ...h, adNames, visitors: h.visitors.map(named) };
}

/** Name an ad or campaign id the way the owner knows it ("Roofing · 40 s v1").
 *  Kept in SyncState under `adname:<id>`; an empty name forgets it. */
export async function nameAdTag(input: { tag?: unknown; name?: unknown }): Promise<{ ok: boolean; error?: string }> {
  await requirePlatformAdmin();
  const tag = typeof input.tag === "string" ? input.tag.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ").slice(0, 60) : "";
  if (!tag || tag.length > 120) return { ok: false, error: "No ad id to name." };
  try {
    if (!name) await db.syncState.deleteMany({ where: { key: adNameKey(tag) } });
    else await db.syncState.upsert({ where: { key: adNameKey(tag) }, create: { key: adNameKey(tag), cursor: name }, update: { cursor: name } });
    return { ok: true };
  } catch {
    return { ok: false, error: "The name could not be saved. Try again." };
  }
}

/** Signups by what the landing recorded on the organization — the trade hero
 *  and the utm_* — straight from the database, so campaign results do not
 *  depend on PostHog (CRO stage 1, 2026-09-09). Same date range as the
 *  report; days are taken in UTC, which is close enough for a daily table. */
/** The UTC instant of local midnight on `date` (+ `plusDays`) in `timezone`. */
function zonedMidnight(date: string, timezone: string, plusDays = 0): Date {
  const guess = new Date(Date.parse(`${date}T00:00:00Z`) + plusDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(guess);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return new Date(guess.getTime() - (local - guess.getTime()));
}

export async function getSignupAttribution(input: Record<string, unknown> = {}): Promise<SignupAttribution> {
  await requirePlatformAdmin();
  const f = parseTrafficFilters(input);
  // Day boundaries in the report's timezone, like the PostHog queries (pass A,
  // 2026-09-11): UTC midnights put a signup made at 9 pm Pacific on the next
  // day, outside a range that ends "today".
  const from = zonedMidnight(f.from, f.timezone);
  const to = zonedMidnight(f.to, f.timezone, 1);
  const rows = await db.organization.findMany({
    where: { createdAt: { gte: from, lt: to }, ...countedOrgs(await statsHiddenIds()) },
    select: { landingIndustry: true, signupVariant: true, utmSource: true, utmMedium: true, utmCampaign: true, utmContent: true },
  });
  const keys = ["landingIndustry", "signupVariant", "utmSource", "utmMedium", "utmCampaign", "utmContent"] as const;
  const dimensions = {} as SignupAttribution["dimensions"];
  for (const key of keys) {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const name = r[key] || (key === "landingIndustry" ? "default" : key === "signupVariant" ? "d" : "(none)");
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    dimensions[key] = [...counts.entries()].map(([name, signups]) => ({ name, signups })).sort((a, b) => b.signups - a.signups);
  }
  return { from: f.from, to: f.to, total: rows.length, dimensions };
}

/** THE SIGNUP LEDGER: every account made in the span, who made it, what the
 *  landing recorded about where they came from, and what the subscription is
 *  now (2026-10-01). Reads rows the database already keeps — no new table,
 *  no new column — so the record goes back as far as the accounts do.
 *
 *  The subscription is read in its own pass. Folding it into the main select
 *  would mean one failure there costs the whole ledger; separately, the worst
 *  it can cost is the plan label. */
const LEDGER_LIMIT = 400;
export async function getSignupLedger(input: Record<string, unknown> = {}): Promise<SignupLedger> {
  await requirePlatformAdmin();
  const days = [1, 7, 30, 90, 365].includes(Number(input.days)) ? Number(input.days) : 30;
  // Counted from TRAFFIC_SINCE (the ad launch) unless the full history is asked for.
  const since = new Date(Math.max(Date.now() - days * 24 * 60 * 60 * 1000, input.fullHistory === true ? 0 : TRAFFIC_SINCE_MS));
  const rows = await db.organization.findMany({
    where: { createdAt: { gte: since }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: LEDGER_LIMIT + 1,
    select: {
      id: true, name: true, createdAt: true,
      utmSource: true, utmMedium: true, utmCampaign: true, utmContent: true, landingIndustry: true,
      memberships: { orderBy: { createdAt: "asc" }, take: 1, select: { user: { select: { email: true, name: true } } } },
    },
  });
  const truncated = rows.length > LEDGER_LIMIT;
  const page = truncated ? rows.slice(0, LEDGER_LIMIT) : rows;

  // The subscriptions, separately — see the note above.
  let subs = new Map<string, { plan: string; status: string; trialEndsAt: Date | null; stripePriceId: string | null; externalSubId: string | null; provider: string; canceledAt: Date | null }>();
  try {
    const found = await db.subscription.findMany({
      where: { organizationId: { in: page.map((r) => r.id) } },
      select: { organizationId: true, plan: true, status: true, trialEndsAt: true, stripePriceId: true, externalSubId: true, provider: true, canceledAt: true },
    });
    subs = new Map(found.map((x) => [x.organizationId, { plan: x.plan, status: x.status, trialEndsAt: x.trialEndsAt, stripePriceId: x.stripePriceId, externalSubId: x.externalSubId, provider: x.provider, canceledAt: x.canceledAt }]));
  } catch {
    // The ledger still lists who signed up and where from; only the plan
    // column goes quiet.
  }

  const records: SignupRecord[] = page.map((r) => {
    const sub = subs.get(r.id);
    const src = signupSource({ utmSource: r.utmSource ?? "", utmMedium: r.utmMedium ?? "" });
    const shape = { plan: sub?.plan ?? "", subStatus: sub?.status ?? "", trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null };
    return {
      orgId: r.id, orgName: r.name,
      ownerName: r.memberships[0]?.user.name ?? "", ownerEmail: r.memberships[0]?.user.email ?? "",
      createdAt: r.createdAt.toISOString(),
      source: src.label, fromAd: src.fromAd, platform: src.platform,
      campaign: r.utmCampaign ?? "", content: r.utmContent ?? "", industry: r.landingIndustry ?? "",
      planLabel: signupPlanLabel(shape),
      state: signupState(shape.subStatus),
    };
  });
  // Accounts an admin took out of the statistics (lib/statsHidden): listed
  // apart under the list, in no count and no figure.
  // The QA Lab's own accounts (lib/qaTestMode) are left out without a line here.
  const hiddenIds = new Set(await statsHiddenIds());
  const qaIds = new Set(await qaOrgIds());
  const hidden = records.filter((r) => hiddenIds.has(r.orgId) && !qaIds.has(r.orgId));
  const counted = records.filter((r) => !hiddenIds.has(r.orgId));
  const pageCounted = page.filter((r) => !hiddenIds.has(r.id));

  // Why each lapsed account lapsed (lib/lapseReason) — its own try.
  try {
    const lapsed = records.filter((r) => r.state === "lapsed");
    const reasons = await lapseReasons(lapsed.map((r) => {
      const sub = subs.get(r.orgId);
      return { orgId: r.orgId, status: sub?.status ?? "", canceledAt: sub?.canceledAt ?? null, externalSubId: sub?.externalSubId ?? null };
    }));
    for (const r of lapsed) {
      const why = reasons.get(r.orgId);
      if (why) r.lapse = { at: why.at, reason: why.reason };
    }
  } catch {
    /* the reason is a courtesy */
  }

  // What the trials are likely to bring per month, and what each account is
  // worth (2026-10-05, lib/trialProjection). Its own try: a failure here
  // costs the money figures, never the list.
  let projection: SignupLedger["projection"] = null;
  try {
    const byId = new Map(counted.map((r) => [r.orgId, r]));
    const valued = await valueSignups(pageCounted.map((r) => ({ orgId: r.id, createdAt: r.createdAt, state: byId.get(r.id)!.state, sub: subs.get(r.id) ?? null })));
    for (const rec of counted) {
      const v = valued.values.get(rec.orgId);
      if (v) rec.value = v;
    }
    projection = valued.projection;
  } catch {
    projection = null;
  }
  return { days, records: counted, summary: signupLedgerSummary(counted), truncated, projection, hidden };
}

/** Take an account out of every admin statistic, or put it back (lib/statsHidden). */
export async function setSignupHidden(input: Record<string, unknown> = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requirePlatformAdmin();
  const orgId = typeof input.orgId === "string" ? input.orgId.trim() : "";
  if (!orgId || orgId.length > 64) return { ok: false, error: "No account given." };
  const exists = await db.organization.findUnique({ where: { id: orgId }, select: { id: true } }).catch(() => null);
  if (!exists) return { ok: false, error: "That account was not found." };
  try {
    await setStatsHidden(orgId, input.hidden !== false, admin.email ?? null);
    return { ok: true };
  } catch {
    return { ok: false, error: "The change could not be saved. Try again." };
  }
}

export async function getTrafficDashboard(input: Record<string, unknown> = {}) {
  await requirePlatformAdmin();
  return getTrafficReport(parseTrafficFilters(input), { force: input.force === true });
}

/** The A/B bench's figures, when its tab opens (2026-10-01). */
export async function getTrafficExperimentsAction(input: Record<string, unknown> = {}) {
  await requirePlatformAdmin();
  return getTrafficExperiments(parseTrafficFilters(input));
}

/** THE ANALYST (2026-10-02): what people do on the landing and where the
 *  sign-up loses them, over the last week, as findings — with the owner's
 *  names for the ads. `force` is the Refresh button: past the half-hour cache, 30 s apart at most (lib/posthog-cache). */
export async function getTrafficAnalyst(input: Record<string, unknown> = {}): Promise<AnalystResult> {
  await requirePlatformAdmin();
  // The reading itself — PostHog, the ad names, the analysis — is shared with
  // the exports (lib/traffic-analyst-read); fetchedAt is PostHog's answer time.
  return (await readAnalyst(input)).result;
}
export type { AnalystResult };

/** WHERE SIGN-UPS STOP (2026-10-14): the week's or the month's sign-up visits read as drop-off by screen and box,
 *  the problems with whose side they are on, and one verdict (lib/signup-dropoff). PostHog down → an error the
 *  panel shows beside its last reading. */
export type SignupDropoffResult =
  | { status: "ok"; report: DropoffReport; readAt: string; stale?: StaleNote }
  | { status: "off" | "error"; message: string };
export async function getSignupDropoff(input: { days?: unknown; force?: unknown } = {}): Promise<SignupDropoffResult> {
  await requirePlatformAdmin();
  const days = DROPOFF_DAYS.find((d) => d === Number(input.days)) ?? 7;
  try {
    if (!posthogApiConfig()) return { status: "off", message: "PostHog's reading key is not set." };
    const read = await fetchSignupDropoff(days, input.force === true);
    return { status: "ok", report: read.report, readAt: read.readAt, ...(read.stale ? { stale: read.stale } : {}) };
  } catch (err) {
    return { status: "error", message: err instanceof Error && err.name === "TimeoutError" ? "PostHog took too long." : err instanceof Error ? err.message : "PostHog did not answer." };
  }
}

/** Who reached a funnel stage: device, place, source and how far they got. */
export async function getTrafficStageVisitors(input: Record<string, unknown> = {}, stageId: unknown) {
  await requirePlatformAdmin();
  if (typeof stageId !== "string" || !/^[a-z]+$/.test(stageId)) throw new Error("Choose a funnel stage.");
  return getStageVisitors(parseTrafficFilters(input), stageId);
}
