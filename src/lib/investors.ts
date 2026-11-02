import "server-only";
// THE INVESTOR PAGE'S DATA (owner, 2026-10-06) — what is kept, and the one
// read that builds the report for the admin page, the shared link and the
// PDF alike. Nothing new in the schema: three SyncState rows.
//
//   adSpend          the ad budget, a list of days — typed in by hand until
//                    Meta's API token arrives (then a cron writes the same
//                    rows with source "meta" and the hand entries stay);
//   investorSettings the start day, the daily budget, how far the chart looks,
//                    and the shared link's token and switch — no share of
//                    trials that pay: that is measured (2026-10-24);
//
// The accounts come from the same rows the signups list reads (since the ad
// launch, hidden accounts out, lib/statsHidden), priced the same way (lib/
// trialProjectionRead); the visitors from the live map's totals; what was
// collected from Stripe (lib/investorPayments).
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { countedOrgs, statsHiddenIds } from "@/lib/statsHidden";
import { signupState, type SignupState } from "@/lib/traffic-live";
import { TRAFFIC_SINCE, TRAFFIC_SINCE_MS, TRAFFIC_TZ } from "@/lib/traffic-visitor";
import { fetchInvestorVisitors } from "@/lib/traffic-server";
import { valueSignups } from "@/lib/trialProjectionRead";
import { investorFigures, splitApart, launchDay, daysBetween, RETRY_DAYS, PLATFORMS, PLATFORM_LABEL, spendPeriods, addDays, type InvestorFigures, type ModelSettings, type PolicySpan, type SpendDay, type SpendPlatform, type SpendPeriod, type TrialCohort, type EndedTrial } from "@/lib/investorModel";
import { cardlessKey } from "@/lib/trialState";
import { readTrialPolicyHistory, signupTrialState } from "@/lib/trialPolicyServer";
import { readSubscriptionPayments } from "@/lib/investorPayments";

export const AD_SPEND_KEY = "adSpend";
export const INVESTOR_SETTINGS_KEY = "investorSettings";
/** When Meta's figures were last read, and how it went (lib/metaAdSpend). */
export const META_SPEND_STATUS_KEY = "metaAdSpendStatus";
/** Meta's own figures by day and by campaign, the last read (lib/metaAdSpend). */
export const META_INSIGHTS_KEY = "metaInsights";

// The platform list lives in the pure model so the client page can list it.
export { PLATFORMS, PLATFORM_LABEL, type SpendPlatform } from "@/lib/investorModel";

export interface AdSpendEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  platform: SpendPlatform;
  cents: number;
  source: "manual" | "meta";
  note?: string;
  by?: string | null;
  at: string;
}

export interface InvestorSettings extends ModelSettings {
  /** The day the first campaign went live (owner, 2026-10-06: "count only what
   *  happened after that"); null = the live map's start, TRAFFIC_SINCE. */
  sinceDate: string | null;
  /** The day JobFlex launched (owner, 2026-10-24: "add the days count after JobFlex launched"); null = the start day. */
  launchDate: string | null;
  linkToken: string | null;
  linkEnabled: boolean;
  /** When the link was last made. */
  linkMadeAt: string | null;
  /** Each reader waits for an admin's yes before the figures open (owner, 2026-10-20). On unless switched off. */
  approveReaders: boolean;
}

export const DEFAULT_SETTINGS: InvestorSettings = { horizonDays: 180, trialDays: 7, dailyBudgetCents: null, budgetFrom: null, sinceDate: null, launchDate: null, linkToken: null, linkEnabled: false, linkMadeAt: null, approveReaders: true };
const MAX_ENTRIES = 3000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const parse = <T,>(text: string | null | undefined): T | null => {
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
};
async function readKey(key: string): Promise<string | null> {
  try {
    return (await db.syncState.findUnique({ where: { key }, select: { cursor: true } }))?.cursor ?? null;
  } catch {
    return null;
  }
}
async function writeKey(key: string, value: unknown): Promise<void> {
  const cursor = JSON.stringify(value);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

/* ── ad spend ─────────────────────────────────────────────────────────── */

export function cleanEntries(raw: unknown): AdSpendEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: AdSpendEntry[] = [];
  for (const e of raw) {
    const r = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
    const date = typeof r.date === "string" && DATE.test(r.date) ? r.date : null;
    const cents = typeof r.cents === "number" && Number.isFinite(r.cents) ? Math.round(r.cents) : NaN;
    if (!date || !Number.isFinite(cents) || cents < 0 || typeof r.id !== "string") continue;
    out.push({
      id: r.id.slice(0, 40),
      date,
      platform: (PLATFORMS as readonly string[]).includes(String(r.platform)) ? (r.platform as SpendPlatform) : "other",
      cents,
      source: r.source === "meta" ? "meta" : "manual",
      note: typeof r.note === "string" ? r.note.slice(0, 120) : undefined,
      by: typeof r.by === "string" ? r.by : null,
      at: typeof r.at === "string" ? r.at : new Date(0).toISOString(),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, MAX_ENTRIES);
}

export async function readAdSpend(): Promise<AdSpendEntry[]> {
  return cleanEntries(parse(await readKey(AD_SPEND_KEY)));
}

export interface AddSpendInput {
  from: string;
  to: string;
  perDayCents: number;
  platform: SpendPlatform;
  note?: string;
}

/** One entry per day from `from` to `to` (366 days at most), replacing hand entries of the same platform on those days. */
export async function addAdSpend(input: AddSpendInput, by: string | null): Promise<AdSpendEntry[]> {
  const days: string[] = [];
  for (let d = input.from; d <= input.to && days.length < 366; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) days.push(d);
  const now = new Date().toISOString();
  const fresh: AdSpendEntry[] = days.map((date) => ({ id: `${date}-${input.platform}-${randomBytes(3).toString("hex")}`, date, platform: input.platform, cents: Math.round(input.perDayCents), source: "manual", note: input.note?.trim() || undefined, by, at: now }));
  const have = await readAdSpend();
  const replaced = new Set(days);
  // A hand-typed day replaces whatever that platform had on it — Meta's own figure too, on purpose.
  const kept = have.filter((e) => !(e.platform === input.platform && replaced.has(e.date)));
  const next = cleanEntries([...kept, ...fresh]);
  await writeKey(AD_SPEND_KEY, next);
  return next;
}

/** Meta's own spend per day (lib/metaAdSpend): on those days the Meta figure
 *  replaces anything Meta had, typed or read earlier; other platforms stay. */
export async function writeMetaSpend(days: Array<{ date: string; cents: number }>): Promise<AdSpendEntry[]> {
  const now = new Date().toISOString();
  const clean = days.filter((d) => DATE.test(d.date) && Number.isFinite(d.cents) && d.cents >= 0);
  const replaced = new Set(clean.map((d) => d.date));
  const fresh: AdSpendEntry[] = clean.map((d) => ({ id: `${d.date}-meta-api`, date: d.date, platform: "meta", cents: Math.round(d.cents), source: "meta", by: null, at: now }));
  const kept = (await readAdSpend()).filter((e) => !(e.platform === "meta" && replaced.has(e.date)));
  const next = cleanEntries([...kept, ...fresh]);
  await writeKey(AD_SPEND_KEY, next);
  return next;
}

export interface MetaSpendStatus { lastPulledAt: string | null; lastError: string | null; daysPulled: number }
export interface MetaDay { date: string; spendCents: number; impressions: number; clicks: number; reach: number }
export interface MetaCampaign { id: string; name: string; spendCents: number; impressions: number; clicks: number; reach: number }
export interface MetaInsights { at: string; since: string; until: string; /** The campaign totals' first day (the investors' start day when inside the window). */ campaignsSince: string; days: MetaDay[]; campaigns: MetaCampaign[] }
const n0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
export function cleanInsights(raw: unknown): MetaInsights | null {
  const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!r || typeof r.at !== "string") return null;
  const days = Array.isArray(r.days) ? r.days.map((d) => d as Record<string, unknown>).filter((d) => typeof d.date === "string" && DATE.test(d.date)).map((d) => ({ date: d.date as string, spendCents: n0(d.spendCents), impressions: n0(d.impressions), clicks: n0(d.clicks), reach: n0(d.reach) })) : [];
  const campaigns = Array.isArray(r.campaigns) ? r.campaigns.map((c) => c as Record<string, unknown>).filter((c) => typeof c.id === "string").map((c) => ({ id: String(c.id).slice(0, 40), name: typeof c.name === "string" ? c.name.slice(0, 120) : "", spendCents: n0(c.spendCents), impressions: n0(c.impressions), clicks: n0(c.clicks), reach: n0(c.reach) })) : [];
  const since = typeof r.since === "string" ? r.since : "";
  return { at: r.at, since, until: typeof r.until === "string" ? r.until : "", campaignsSince: typeof r.campaignsSince === "string" && DATE.test(r.campaignsSince) ? r.campaignsSince : since, days, campaigns };
}
export async function readMetaInsights(): Promise<MetaInsights | null> {
  return cleanInsights(parse(await readKey(META_INSIGHTS_KEY)));
}
export async function writeMetaInsights(insights: MetaInsights): Promise<void> {
  await writeKey(META_INSIGHTS_KEY, insights);
}
export async function readMetaStatus(): Promise<MetaSpendStatus> {
  const r = (parse<Record<string, unknown>>(await readKey(META_SPEND_STATUS_KEY)) ?? {}) as Record<string, unknown>;
  return {
    lastPulledAt: typeof r.lastPulledAt === "string" ? r.lastPulledAt : null,
    lastError: typeof r.lastError === "string" ? r.lastError.slice(0, 200) : null,
    daysPulled: typeof r.daysPulled === "number" && Number.isFinite(r.daysPulled) ? Math.round(r.daysPulled) : 0,
  };
}
export async function writeMetaStatus(status: MetaSpendStatus): Promise<void> {
  await writeKey(META_SPEND_STATUS_KEY, status);
}
/** The two deployment variables that connect the ad account. */
export function metaAdsConfigured(): boolean {
  return !!(process.env.META_ADS_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
}

export async function deleteAdSpend(id: string): Promise<AdSpendEntry[]> {
  const next = (await readAdSpend()).filter((e) => e.id !== id);
  if (next.length === 0) await db.syncState.deleteMany({ where: { key: AD_SPEND_KEY } });
  else await writeKey(AD_SPEND_KEY, next);
  return next;
}

/* ── settings and the shared link ─────────────────────────────────────── */

export function cleanSettings(raw: unknown): InvestorSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
  // A stored realisticPct / spendPerDayCents (the assumptions, until 2026-10-24) is read past and dropped on the next save.
  return {
    horizonDays: Math.round(num(r.horizonDays, DEFAULT_SETTINGS.horizonDays, 30, 730)),
    trialDays: Math.round(num(r.trialDays, DEFAULT_SETTINGS.trialDays, 1, 90)),
    dailyBudgetCents: typeof r.dailyBudgetCents === "number" && Number.isFinite(r.dailyBudgetCents) && r.dailyBudgetCents > 0 ? Math.round(r.dailyBudgetCents) : null,
    budgetFrom: typeof r.budgetFrom === "string" && DATE.test(r.budgetFrom) && r.budgetFrom >= "2025-01-01" ? r.budgetFrom : null,
    sinceDate: typeof r.sinceDate === "string" && DATE.test(r.sinceDate) && r.sinceDate >= "2025-01-01" ? r.sinceDate : null,
    launchDate: typeof r.launchDate === "string" && DATE.test(r.launchDate) && r.launchDate >= "2020-01-01" ? r.launchDate : null,
    linkToken: typeof r.linkToken === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(r.linkToken) ? r.linkToken : null,
    linkEnabled: r.linkEnabled === true,
    linkMadeAt: typeof r.linkMadeAt === "string" ? r.linkMadeAt : null,
    approveReaders: r.approveReaders !== false,
  };
}

export async function readInvestorSettings(): Promise<InvestorSettings> {
  return cleanSettings(parse(await readKey(INVESTOR_SETTINGS_KEY)));
}

export async function saveInvestorSettings(patch: Partial<InvestorSettings>): Promise<InvestorSettings> {
  const next = cleanSettings({ ...(await readInvestorSettings()), ...patch });
  await writeKey(INVESTOR_SETTINGS_KEY, next);
  return next;
}

/** A new shared link (the old one stops working), switched on. */
export async function rotateInvestorLink(): Promise<InvestorSettings> {
  return saveInvestorSettings({ linkToken: randomBytes(18).toString("base64url"), linkEnabled: true, linkMadeAt: new Date().toISOString() });
}

/** True when `token` is the live shared link. */
export async function investorLinkOpen(token: string): Promise<boolean> {
  const s = await readInvestorSettings();
  return !!s.linkToken && s.linkEnabled && token === s.linkToken;
}

/* ── the report ───────────────────────────────────────────────────────── */

export interface InvestorReport {
  figures: InvestorFigures;
  settings: InvestorSettings;
  spend: { entries: AdSpendEntry[]; byPlatform: Array<{ platform: SpendPlatform; label: string; cents: number; days: number }> };
  /** The analytics answered (visitors are real), or not. */
  visitorsKnown: boolean;
  /** Paying accounts whose plan has no list price — counted as $0 in the MRR, and said so. */
  payingUnpriced: number;
  /** Accounts paying from before the start day — counted under With a card as paying (2026-10-13), named here. */
  before: { paying: number; mrrCents: number };
  /** The first day a visitor arrived from an ad (utm_source or fbclid), when the analytics answered. */
  firstAdDay: string | null;
  /** Meta's ad account: connected (the deployment has the token and account id), and the last read. */
  meta: { configured: boolean } & MetaSpendStatus;
  /** The spend by period — today, this week, this month… — off the curve's booked days (lib/investorModel). */
  periods: SpendPeriod[];
  /** Meta's own figures, when read: by day for the bars. */
  insights: MetaInsights | null;
  /** The last 30 card days, one row each: what was spent that day and who signed up with a card. */
  dailyRows: Array<{ date: string; spendCents: number; source: "booked" | "budget" | "none"; clicks: number | null; signups: number }>;
  /** The first campaign's day (the setting, else the live map's start). The card figures may start later: figures.since. */
  startDay: string;

  /** WHAT CAME IN (2026-10-24): Stripe's paid subscription invoices since the start day from the accounts counted
   *  here — all of them, and the part from the customers the period brought (signed up since the start day).
   *  read false = Stripe not read, with why; never a guess. */
  collected: { read: boolean; error: string | null; cents: number; invoices: number; wonCents: number; /** Of those payments, refunded or lost to a chargeback since — already out of `cents` and `wonCents` (2026-11-02). */ refundedCents: number };
  /** JOBS PAID WITH FINANCING (2026-10-28, lib/financing): Wisetack's payouts to JobFlex contractors — Payment rows
   *  provider WISETACK + PAID, all time, measured. The page shows the line only once there is one. */
  financed: { jobs: number; cents: number };
  /** DAYS SINCE LAUNCH (2026-10-24): the day JobFlex launched (the setting, else the start day) and which day today
   *  is — the launch day is day 1. */
  launch: { date: string; day: number; set: boolean };
  /** When this was read. */
  at: string;
}

/** The report as a reader of the shared link gets it (2026-10-25: "don't show the free trials' no-card budget
 *  anywhere"): the page's own figures only — not the booked-spend list or Meta's per-day and per-campaign figures,
 *  which carry the no-card days' money and would ride along in the page's data. */
export function forReaders(r: InvestorReport): InvestorReport {
  return { ...r, spend: { ...r.spend, entries: [] }, insights: null };
}

/** Midnight of `date` in `tz`, as a timestamp (the day's offset read from Intl). */
function dayStartMs(date: string, tz: string): number {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date(guess)).find((x) => x.type === "timeZoneName")?.value ?? "GMT";
  const m = /([+-])(\d{2}):?(\d{2})?/.exec(name);
  const offsetMin = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  return guess - offsetMin * 60_000;
}

const todayIn = (tz: string) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const n = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${n("year")}-${n("month")}-${n("day")}`;
};

export async function investorReport({ refreshMeta = false }: { refreshMeta?: boolean } = {}): Promise<InvestorReport> {
  // The admin's own read asks Meta first when the last read is over an hour old
  // (owner, 2026-10-08: "live spending"); the shared link and the PDF read what is kept.
  if (refreshMeta && metaAdsConfigured()) {
    try {
      const { metaPullIfStale } = await import("@/lib/metaAdSpend");
      await metaPullIfStale(60);
    } catch (err) {
      console.warn("[investors] Meta refresh skipped:", err instanceof Error ? err.message : err);
    }
  }
  const [entries, settings, hidden, metaStatus, insights] = await Promise.all([readAdSpend(), readInvestorSettings(), statsHiddenIds(), readMetaStatus(), readMetaInsights()]);
  const today = todayIn(TRAFFIC_TZ);
  // Every day on this page is a day on the page's clock (the ad spend's days are): a signup at 6 PM in Seattle is that day's.
  const dayIn = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TRAFFIC_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  // The start day: the first campaign's (owner, 2026-10-06), else the live map's.
  const since = settings.sinceDate ?? TRAFFIC_SINCE;
  const sinceMs = settings.sinceDate ? dayStartMs(since, TRAFFIC_TZ) : TRAFFIC_SINCE_MS;

  // The accounts since the start day, with their subscriptions — the signups list's rows.
  const orgs = await db.organization.findMany({
    where: { createdAt: { gte: new Date(sinceMs) }, ...countedOrgs(hidden) },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: { id: true, createdAt: true, utmCampaign: true, utmContent: true, utmSource: true, subscription: { select: { plan: true, status: true, trialEndsAt: true, canceledAt: true, stripePriceId: true, externalSubId: true, externalCustomerId: true, provider: true, createdAt: true } } },
  });
  // Every paying account; the ones from before the start day are named, not counted.
  const payingAll = await db.subscription.findMany({
    where: { status: "ACTIVE", organization: countedOrgs(hidden) },
    select: { organizationId: true, plan: true, status: true, trialEndsAt: true, canceledAt: true, stripePriceId: true, externalSubId: true, externalCustomerId: true, provider: true, createdAt: true, organization: { select: { createdAt: true } } },
  });

  const payRow = (p: (typeof payingAll)[number]) => ({ orgId: p.organizationId, createdAt: p.organization.createdAt, state: "paying" as SignupState, sub: { plan: p.plan, status: p.status, trialEndsAt: p.trialEndsAt, stripePriceId: p.stripePriceId, externalSubId: p.externalSubId, provider: p.provider }, customer: p.externalCustomerId, subCreatedAt: p.createdAt, trialEndsAt: p.trialEndsAt, canceledAt: p.canceledAt });
  const listed = [
    ...orgs.map((o) => ({ orgId: o.id, createdAt: o.createdAt, state: signupState(o.subscription?.status ?? ""), sub: o.subscription ? { plan: o.subscription.plan, status: o.subscription.status, trialEndsAt: o.subscription.trialEndsAt, stripePriceId: o.subscription.stripePriceId, externalSubId: o.subscription.externalSubId, provider: o.subscription.provider } : null, customer: o.subscription?.externalCustomerId ?? null, subCreatedAt: o.subscription?.createdAt ?? o.createdAt, trialEndsAt: o.subscription?.trialEndsAt ?? null, canceledAt: o.subscription?.canceledAt ?? null })),
    ...payingAll.filter((p) => p.organization.createdAt.getTime() >= sinceMs && !orgs.some((o) => o.id === p.organizationId)).map(payRow),
  ];
  const listedBefore = payingAll.filter((p) => p.organization.createdAt.getTime() < sinceMs).map(payRow);
  // WHAT CAME IN: Stripe's payments from every account of the period and the ones paying from before it, net of what
  // went back — read once (beside the prices), for the money, for who has left already and for how each trial ended.
  const customers = new Set([...listed, ...listedBefore].map((r) => r.customer).filter((c): c is string => !!c));
  const paidRead = readSubscriptionPayments(sinceMs, customers, (ms) => dayIn(new Date(ms)));
  let values = new Map<string, { monthlyCents: number | null; chance?: number }>();
  try {
    values = (await valueSignups([...listed, ...listedBefore].map((r) => ({ orgId: r.orgId, createdAt: r.createdAt, state: r.state, sub: r.sub })), Date.now())).values;
  } catch {
    values = new Map();
  }
  const paid = await paidRead;
  // WHAT WAS KEPT (owner, 2026-11-02): a payment counts for what was not refunded or lost to a chargeback. The first
  // payment kept, by customer; and the customers who paid and got every cent back.
  const firstPaid = new Map<string, string>();
  const paidOnce = new Set<string>();
  if (paid.ok) {
    for (const p of paid.payments) {
      paidOnce.add(p.customer);
      const d = firstPaid.get(p.customer);
      if (p.cents > p.refundedCents && (!d || p.date < d)) firstPaid.set(p.customer, p.date);
    }
  }
  const refundedAll = (customer: string | null) => !!customer && paidOnce.has(customer) && !firstPaid.has(customer);
  // WHO HAS LEFT ALREADY (owner, 2026-11-02: "somebody signs up on a free trial and the next day cancels"): a cancel
  // keeps the days already given, so Stripe says "trialing" (or "active") until they run out. A trial with its cancel
  // booked has ended with no payment from that day; a paying account with its cancel booked and every payment
  // refunded has paid nothing. Both count as gone at once — "Keep my plan" takes the booking back, and them with it.
  // A refund with the plan left on stays paying: Stripe bills it again.
  const leftAlready = (r: (typeof listed)[number]) => r.canceledAt !== null && (r.state === "trial" || (r.state === "paying" && refundedAll(r.customer)));
  const rows = listed.map((r) => (leftAlready(r) ? { ...r, state: "lapsed" as SignupState } : r));
  const beforeRows = listedBefore.filter((r) => !leftAlready(r));

  // HOW EACH TRIAL STARTED (2026-10-13): a card-less trial leaves its record (lib/trialState); everything else took a card.
  const nocardIds = new Set<string>();
  try {
    const ids = rows.map((r) => r.orgId);
    const recs = ids.length ? await db.syncState.findMany({ where: { key: { in: ids.map(cardlessKey) } }, select: { key: true, cursor: true } }) : [];
    for (const rec of recs) {
      const r = parse<{ subId?: unknown }>(rec.cursor);
      if (r?.subId) nocardIds.add(rec.key.slice("cardlessTrial:".length));
    }
  } catch {
    /* no records read: every trial counts as a card trial */
  }
  const cohortOf = (orgId: string): TrialCohort => (nocardIds.has(orgId) ? "nocard" : "card");

  const payRowOf = (r: (typeof rows)[number], preexisting: boolean) => {
    // Paying from the trial's end when there was one, else from the subscription — but one that came back days after
    // its trial ended (canceled, a card that failed, refunded; owner, 2026-11-02: "after a few weeks they decide to
    // come back") pays from its first payment kept, as "came back later" reads it. An account paying from before the
    // start day keeps its own: its first payment read here is a renewal.
    const ends = dayIn(r.trialEndsAt && r.trialEndsAt.getTime() < Date.now() ? r.trialEndsAt : r.subCreatedAt);
    const back = !preexisting && r.customer ? firstPaid.get(r.customer) : undefined;
    return { startedAt: back && daysBetween(ends, back) >= 2 ? back : ends, monthlyCents: values.get(r.orgId)?.monthlyCents ?? 0, signedUpAt: dayIn(r.createdAt), cohort: cohortOf(r.orgId), preexisting };
  };
  // The accounts paying from before the start day (owner, 2026-10-13: "add them to With a card, paying"): they
  // took a card, so they sit in that cohort — paying, never signups of the period (lib/investorModel).
  const paying = [...rows.filter((r) => r.state === "paying").map((r) => payRowOf(r, false)), ...beforeRows.map((r) => payRowOf(r, true))];
  const trials = rows.filter((r) => r.state === "trial").map((r) => {
    const v = values.get(r.orgId);
    return { createdAt: dayIn(r.createdAt), endsAt: r.trialEndsAt ? dayIn(r.trialEndsAt) : null, monthlyCents: v?.monthlyCents ?? null, cohort: cohortOf(r.orgId) };
  });
  // Ran out, canceled, or a payment that failed — a trial that did not stay (the measured rate's other side).
  const lapsedRows = rows.filter((r) => r.state === "lapsed");
  const lapsed = lapsedRows.length;
  const lapsedSignups = lapsedRows.map((r) => ({ date: dayIn(r.createdAt), cohort: cohortOf(r.orgId) }));
  // The switch's recorded flips (from 2026-10-13), and what a new signup gets today.
  let policy: PolicySpan[] = [];
  let current: TrialCohort = "card";
  try {
    const [flips, state] = await Promise.all([readTrialPolicyHistory(), signupTrialState({ fresh: true })]);
    // A flip to "no card" counts from its own day; a flip to "card" from the NEXT day — the no-card offer was up for
    // part of the flip day, so that day goes apart whole (lib/investorModel splitApart).
    const spanOf = (at: string, requiresCard: boolean): PolicySpan => ({ from: requiresCard ? addDays(dayIn(new Date(at)), 1) : dayIn(new Date(at)), mode: requiresCard ? "card" : "nocard" });
    policy = flips.map((f) => spanOf(f.at, f.requiresCard));
    current = state.requiresCard ? "card" : "nocard";
    // The switch's own stamp stands in for the last flip when the history began after it.
    const stamp = state.source === "admin" && state.at ? spanOf(state.at, state.requiresCard) : null;
    if (stamp && !policy.some((p) => p.from === stamp.from && p.mode === stamp.mode)) policy.push(stamp);
  } catch {
    /* the deployment's default: a card */
  }
  const cohortInput = {
    lapsed: { card: lapsedRows.filter((r) => cohortOf(r.orgId) === "card").length, nocard: lapsedRows.filter((r) => cohortOf(r.orgId) === "nocard").length },
    signups: rows.filter((r) => r.state === "trial" || r.state === "paying" || r.state === "lapsed").map((r) => ({ date: dayIn(r.createdAt), cohort: cohortOf(r.orgId) })),
    policy,
    current,
  };
  const payingUnpriced = rows.filter((r) => r.state === "paying" && values.get(r.orgId)?.monthlyCents == null).length;

  const before = { paying: beforeRows.length, mrrCents: beforeRows.reduce((a, r) => a + (values.get(r.orgId)?.monthlyCents ?? 0), 0) };

  const spend: SpendDay[] = entries.map((e) => ({ date: e.date, cents: e.cents }));
  // THE PAGE IS THE CARD DAYS' (owner, 2026-10-14; whole days since 2026-10-24; shown nowhere since 2026-10-25: "remove
  // the budget spent on the free trials with no card — don't show it anywhere, only what was with the card"): the
  // whole is figured once — its curve filled by the daily budget — then cut in two (lib/investorModel splitApart): the
  // days the no-card offer was up go out WHOLE, with every signup they brought; the card days are the page, and the
  // no-card trials that pay now join its paying. A first pass finds the card days' first day (the visitor count
  // starts from it) and which accounts are whose.
  const modelInput = { since, today, spend, paying, trials, lapsed, lapsedSignups, settings, visitors: null as number | null, cohorts: cohortInput };
  const whole = investorFigures(modelInput);
  const first = splitApart(modelInput, whole);
  const apartSet = new Set(first.days);
  const onCard = (r: (typeof rows)[number]) => cohortOf(r.orgId) === "card" && !apartSet.has(dayIn(r.createdAt));

  const [cardVisitors, startVisitors] = await Promise.all([
    fetchInvestorVisitors(first.cardSince, TRAFFIC_TZ).catch(() => null),
    first.cardSince === since ? Promise.resolve(null) : fetchInvestorVisitors(since, TRAFFIC_TZ).catch(() => null),
  ]);
  const visitors = cardVisitors ? cardVisitors.visitors : null;
  const firstAdDay = (startVisitors ?? cardVisitors)?.firstAdDay ?? null;

  // HOW EACH TRIAL ENDED (owner, 2026-10-25: "only deduct who cancelled during the trial; if they converted, keep
  // them; how many came back later"; "keep the card-failed ones as converted for 2 weeks, then deduct"). Converted =
  // a payment went through: within a day of the trial's end ("paid"), or later ("came-back" — a retry that went
  // through, a card put in later, a return), one that left since still converted; or a first charge still failing
  // inside its two-week retry window ("retrying"). Not converted = canceled before the end, or no payment two weeks
  // after the end; paid and refunded in full; a cancel booked during the trial. Stripe not read: paying today = paid,
  // the rest by status.
  const outcomeOf = (r: (typeof rows)[number]): EndedTrial => {
    const base = { date: dayIn(r.createdAt), cohort: cohortOf(r.orgId), payingNow: r.state === "paying" };
    const end = r.trialEndsAt ? dayIn(r.trialEndsAt) : null;
    const first = r.customer ? firstPaid.get(r.customer) : undefined;
    if (first) {
      const after = end ? daysBetween(end, first) : 0;
      return after >= 2 ? { ...base, outcome: "came-back", afterDays: after } : { ...base, outcome: "paid" };
    }
    if (base.payingNow) return { ...base, outcome: "paid" };
    if (refundedAll(r.customer)) return { ...base, outcome: "refunded" };
    const status = (r.sub?.status ?? "").toUpperCase();
    // A first charge still failing: converted inside the two-week retry window, never paid after it — until it pays.
    if (status === "PAST_DUE") return r.trialEndsAt && Date.now() - r.trialEndsAt.getTime() > RETRY_DAYS * 86_400_000 ? { ...base, outcome: "unpaid" } : { ...base, outcome: "retrying" };
    if (status === "TRIALING" && r.canceledAt) return { ...base, outcome: "canceled" };
    if (status === "CANCELED" && (!r.trialEndsAt || !r.canceledAt || r.canceledAt.getTime() <= r.trialEndsAt.getTime())) return { ...base, outcome: "canceled" };
    return { ...base, outcome: "unpaid" };
  };
  const outcomes = rows.filter((r) => r.state === "paying" || r.state === "lapsed").map(outcomeOf);

  // The money that came in, from the accounts the page counts: the card days' (paying, or paid before they lapsed),
  // the no-card trials that pay now, and the ones paying from before the start day.
  const wonCustomers = new Set(rows.filter((r) => onCard(r) && r.customer).map((r) => r.customer as string));
  const countedCustomers = new Set([...wonCustomers, ...rows.filter((r) => !onCard(r) && r.state === "paying" && r.customer).map((r) => r.customer as string), ...beforeRows.map((r) => r.customer).filter((c): c is string => !!c)]);
  const sum = (only: (customer: string) => boolean, of: (p: { cents: number; refundedCents: number }) => number = (p) => p.cents - p.refundedCents) => (paid.ok ? paid.payments.filter((p) => only(p.customer)).reduce((a, p) => a + of(p), 0) : 0);
  const collected = paid.ok
    ? { read: true, error: null, cents: sum((c) => countedCustomers.has(c)), invoices: paid.payments.filter((p) => countedCustomers.has(p.customer)).length, wonCents: sum((c) => wonCustomers.has(c)), refundedCents: sum((c) => countedCustomers.has(c), (p) => p.refundedCents) }
    : { read: false, error: paid.error, cents: 0, invoices: 0, wonCents: 0, refundedCents: 0 };

  const wisetackPaid = await db.payment.findMany({ where: { provider: "WISETACK", status: "PAID" }, select: { proposalId: true, amount: true } }).catch(() => []);
  const financed = { jobs: new Set(wisetackPaid.map((p) => p.proposalId ?? "")).size, cents: Math.round(wisetackPaid.reduce((a, p) => a + p.amount, 0) * 100) };

  const cut = splitApart({ ...modelInput, visitors, outcomes }, whole);
  const figures = cut.card;
  const cardSince = cut.cardSince;
  // The platform split: the card days only.
  const byPlatform = PLATFORMS.map((platform) => {
    const mine = entries.filter((e) => e.platform === platform && e.date >= cardSince && e.date <= today && !apartSet.has(e.date));
    return { platform, label: PLATFORM_LABEL[platform], cents: mine.reduce((a, e) => a + e.cents, 0), days: new Set(mine.map((e) => e.date)).size };
  }).filter((p) => p.cents > 0);
  // Spend by period and the daily rows of the last 30 days — the card days' only.
  const periods = spendPeriods(figures.curve, today);
  // Only the signups the figures count (a trial, a paying account, a lapsed trial, on a card day with a card) — the same rows as "Signed up".
  const counted = new Set(rows.filter((r) => (r.state === "trial" || r.state === "paying" || r.state === "lapsed") && onCard(r)).map((r) => r.orgId));
  const signupsByDay = new Map<string, number>();
  for (const o of orgs) { if (!counted.has(o.id)) continue; const d = dayIn(o.createdAt); signupsByDay.set(d, (signupsByDay.get(d) ?? 0) + 1); }
  const clicksByDay = new Map((insights?.days ?? []).map((d) => [d.date, d.clicks]));
  const from30 = addDays(today, -29);
  const dailyRows = whole.curve.filter((p) => !p.projected && p.date >= from30 && p.date >= cardSince && p.date <= today && !apartSet.has(p.date)).map((p) => ({
    date: p.date, spendCents: p.spendDayCents, source: p.spendSource === "projected" ? ("none" as const) : p.spendSource, clicks: clicksByDay.has(p.date) ? (clicksByDay.get(p.date) ?? 0) : null, signups: signupsByDay.get(p.date) ?? 0,
  }));
  return { figures, settings, startDay: since, spend: { entries, byPlatform }, visitorsKnown: visitors !== null, payingUnpriced, before, firstAdDay, meta: { configured: metaAdsConfigured(), ...metaStatus }, periods, insights, dailyRows, collected, financed, launch: launchDay(settings.launchDate ?? since, today, settings.launchDate !== null), at: new Date().toISOString() };
}
