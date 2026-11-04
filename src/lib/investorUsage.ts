import "server-only";
// HOW MUCH JOBFLEX IS USED (owner, 2026-11-04: "add to the investors' statistics the users' activity — per day, 7
// days, 30 days, three months and a year — to prove that users are using the platform … in a positive way, but don't
// show too much"; then "I need a chart — how people use JobFlex"; then "don't say how many were sent … even if they
// open the estimate count it as an estimate … if logged in, still say working with the CRM or other business flow …
// count even our admin estimates, tests"). Read from what /admin/activity reads — the trail of what members do, the
// roof and HVAC estimates in their own tables, and the screens opened (lib/trialWatch's page views: every screen in a
// company's first weeks, then each screen once a quarter hour — actions/pageView; kept 120 days, so most of the year
// is the trail's) — and only counted: people at work, their companies, estimates, the parts of the business they
// worked in. No names, no money.
//   An estimate is one made (a roof, an HVAC sizing, any other estimator's save, a re-price), or an hour someone
//   opened or worked on estimates without saving a new one (an estimator or a proposal on screen, a proposal written,
//   changed or sent) — once per person per hour, so a busy hour is not a dozen.
// Everyone is counted, JobFlex's own team and test companies included (owner's call); only deleted companies are
// left out. Each range is cut into bars on the page's clock: 24 hours by the hour, 7 and 30 days by the day, 3 months
// by the week, a year by the month. Kept a few minutes per instance: the figures page, the shared link and the PDF
// each ask.
import { db } from "@/lib/db";
import { TRAFFIC_TZ } from "@/lib/traffic-visitor";

export type UsageRangeKey = "day" | "week" | "month" | "quarter" | "year";
/** The rest of the business, in the order the sentence names them. */
export type UsageArea = "crm" | "jobs" | "calendar" | "messaging" | "payments";
export interface UsageCounts {
  /** Members who opened a screen, did something on the trail, or made an estimate. */
  people: number;
  /** The companies those members work in. */
  companies: number;
  /** Estimates made, and the hours estimates were opened or worked on without a new one saved. */
  estimates: number;
  /** The parts of the business beyond estimates they worked in, in UsageArea order. */
  areas: UsageArea[];
}
export interface UsageBar extends UsageCounts {
  /** Under the bar: "3 PM", "Nov 3", "Oct 27", "Nov". */
  label: string;
  /** In the tooltip: "Nov 3, 3 PM", "Tue, Nov 3", "Week of Oct 27", "November 2026". */
  title: string;
}
export interface UsageRange extends UsageCounts {
  key: UsageRangeKey;
  /** The button: "24 hours", "7 days" … */
  label: string;
  /** In the sentence: "in the last 24 hours" … */
  words: string;
  /** What one bar is. */
  unit: "hour" | "day" | "week" | "month";
  bars: UsageBar[];
}
export interface InvestorUsage {
  ranges: UsageRange[];
  /** A table read hit its cap: the oldest bars are at least these. */
  capped: boolean;
  at: string;
}

const H = 3_600_000;
const DAY = 24 * H;
const CAP = 60_000;
const CACHE_MS = 5 * 60_000;
const TZ = TRAFFIC_TZ;

let kept: { at: number; value: Promise<InvestorUsage> } | null = null;

/** Every range with its bars, from the database; a reading a few minutes old is reused. */
export function readInvestorUsage(now = Date.now()): Promise<InvestorUsage> {
  if (kept && now - kept.at < CACHE_MS) return kept.value;
  const value = readNow(now);
  kept = { at: now, value };
  // A failed read is not kept.
  value.catch(() => {
    if (kept?.value === value) kept = null;
  });
  return value;
}

const AREAS: UsageArea[] = ["crm", "jobs", "calendar", "messaging", "payments"];
/** A trail ESTIMATE that stands for a roof or HVAC table row — counted there, not twice. The Smart Proposal's own
 *  estimateId is an AI estimate with no row read here, so it counts on the trail. */
function tabled(meta: string | null): boolean {
  if (!meta) return false;
  try {
    const m = JSON.parse(meta) as { measurementId?: unknown; estimateId?: unknown; trade?: unknown };
    return typeof m.measurementId === "string" || (typeof m.estimateId === "string" && String(m.trade).toLowerCase() === "hvac");
  } catch {
    return false;
  }
}
/** A screen (lib/trialWatch routePattern) where an estimate is open: an estimator, or one proposal. */
const ESTIMATE_SCREEN =
  /^\/(?:dashboard\/(?:proposals\/.+|advanced-ai|blueprint-estimator|manual-[a-z]+|design-studio|lawn-estimator|roof-estimator|fence-estimator|video-estimator|hvac-estimator|deck-(?:estimator|lab|v\d))|mobile-(?:advanced-ai|blueprint-estimator|fence-estimator|lawn-estimator|manual-builder|roof-estimator|smart-estimate|video-estimator)-v\d|mobile-proposals-v\d\/.+)(?:\/|$)/;
/** An estimator's stock and service screens are not an estimate. */
const NOT_ESTIMATE = /\/(?:inventory|service-desk)(?:\/|$)/;
const AREA_SCREENS: Array<[UsageArea, RegExp]> = [
  ["crm", /^\/(?:dashboard\/(?:clients|client-detail|leads|crm|projects)|mobile-(?:clients|crm|leads|projects|project-detail)-v\d)(?:\/|$)/],
  ["jobs", /^\/(?:dashboard\/(?:jobs|workers|hire|visits|service-plans)|mobile-(?:jobs|job-detail|workers|hire)-v\d)(?:\/|$)/],
  ["calendar", /^\/(?:dashboard\/(?:calendar|booking)|mobile-calendar-v\d)(?:\/|$)/],
  ["messaging", /^\/(?:dashboard\/(?:messages|texting|phone|reviews)|mobile-(?:messages|texting|phone|ai-desk|reviews)-v\d)(?:\/|$)/],
  ["payments", /^\/(?:dashboard\/financials|mobile-financials-v\d)(?:\/|$)/],
];
/** The trail's kinds (lib/activityLog and the bell's) by the part of the business they are. */
const AREA_OF_KIND: Record<string, UsageArea> = {
  CLIENT: "crm",
  PROJECT: "crm",
  FOLLOW_UP: "crm",
  JOB: "jobs",
  PHOTO: "jobs",
  EXPENSE: "jobs",
  MATERIALS: "jobs",
  STOCK: "jobs",
  TEAM: "jobs",
  PAY: "jobs",
  SERVICE_REMINDER: "jobs",
  SERVICE_REMINDER_DONE: "jobs",
  SERVICE_LINK: "jobs",
  APPOINTMENT: "calendar",
  SCHEDULED: "calendar",
  TEXT: "messaging",
  EMAIL: "messaging",
  CALL: "messaging",
};
/** A proposal written, changed or sent (the kinds /admin/activity counts as proposal work). */
const PROPOSAL_WORK = new Set(["CREATED", "EDITED", "SENT"]);

// ── the page's clock ──
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric" });
/** A YYYY-MM-DD day, `k` days on (calendar arithmetic, so a 23- or 25-hour day is still one day). */
const addDays = (key: string, k: number) => new Date(Date.parse(`${key}T12:00:00Z`) + k * DAY).toISOString().slice(0, 10);
const asDate = (key: string) => new Date(`${key}T12:00:00Z`);
const md = (key: string) => asDate(key).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

async function readNow(now: number): Promise<InvestorUsage> {
  const deleted = await db.organization.findMany({ where: { deletedAt: { not: null } }, select: { id: true } });
  const leftOut = deleted.map((o) => o.id);
  // The year's twelve months reach back at most 372 days; rows before the first bar are read and not placed.
  const since = new Date(now - 372 * DAY);
  const counted = leftOut.length ? { organizationId: { notIn: leftOut } } : {};

  const [views, acts, roofs, hvacs] = await Promise.all([
    db.pageView.findMany({ where: { at: { gte: since }, userId: { not: null }, ...counted }, orderBy: { at: "desc" }, take: CAP, select: { userId: true, organizationId: true, route: true, at: true } }).catch(() => []),
    db.activityEvent.findMany({ where: { createdAt: { gte: since }, actorId: { not: null }, kind: { not: "TEST" }, ...counted }, orderBy: { createdAt: "desc" }, take: CAP, select: { actorId: true, organizationId: true, createdAt: true, kind: true, meta: true, proposalId: true } }),
    db.roofMeasurement.findMany({ where: { createdAt: { gte: since }, ...counted }, orderBy: { createdAt: "desc" }, take: CAP, select: { createdById: true, organizationId: true, createdAt: true } }),
    db.hvacEstimate.findMany({ where: { createdAt: { gte: since }, ...counted }, orderBy: { createdAt: "desc" }, take: CAP, select: { createdById: true, organizationId: true, createdAt: true } }),
  ]);

  // ── the bars, on the page's clock ──
  const today = dayFmt.format(new Date(now));
  const nowHour = Math.floor(now / H);
  const days = (n: number) => Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
  const d7 = days(7);
  const d30 = days(30);
  const d91 = days(91);
  const thisMonth = today.slice(0, 7);
  const months = Array.from({ length: 12 }, (_, i) => {
    const [y, m] = thisMonth.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1 - (11 - i), 1));
    return t.toISOString().slice(0, 7);
  });
  const pos = (list: string[]) => new Map(list.map((k, i) => [k, i]));
  const at7 = pos(d7);
  const at30 = pos(d30);
  const at91 = pos(d91);
  const atMonth = pos(months);
  // A row's day on the page's clock, worked out once per hour it falls in (thousands of rows share an hour).
  const dayOfHour = new Map<number, string>();
  const dayOf = (t: number) => {
    const h = Math.floor(t / H);
    let d = dayOfHour.get(h);
    if (d === undefined) {
      d = dayFmt.format(new Date(h * H + 1));
      dayOfHour.set(h, d);
    }
    return d;
  };
  type Acc = { people: Set<string>; companies: Set<string>; made: number; worked: Set<string>; areas: Set<UsageArea> };
  const acc = (): Acc => ({ people: new Set(), companies: new Set(), made: 0, worked: new Set(), areas: new Set() });
  const defs: Array<{ key: UsageRangeKey; label: string; words: string; unit: UsageRange["unit"]; size: number; place: (t: number, day: string) => number }> = [
    { key: "day", label: "24 hours", words: "in the last 24 hours", unit: "hour", size: 24, place: (t) => Math.floor(t / H) - (nowHour - 23) },
    { key: "week", label: "7 days", words: "in the last 7 days", unit: "day", size: 7, place: (_, d) => at7.get(d) ?? -1 },
    { key: "month", label: "30 days", words: "in the last 30 days", unit: "day", size: 30, place: (_, d) => at30.get(d) ?? -1 },
    { key: "quarter", label: "3 months", words: "in the last 3 months", unit: "week", size: 13, place: (_, d) => { const i = at91.get(d); return i === undefined ? -1 : Math.floor(i / 7); } },
    { key: "year", label: "1 year", words: "in the last year", unit: "month", size: 12, place: (_, d) => atMonth.get(d.slice(0, 7)) ?? -1 },
  ];
  const tally = defs.map((r) => ({ bars: Array.from({ length: r.size }, acc), total: acc() }));
  const add = (t: number, fn: (a: Acc) => void) => {
    const d = dayOf(t);
    defs.forEach((r, k) => {
      const i = r.place(t, d);
      if (i < 0 || i >= r.size || t > now) return;
      fn(tally[k].bars[i]);
      fn(tally[k].total);
    });
  };
  const atWork = (user: string | null, org: string, area?: UsageArea) => (a: Acc) => {
    if (user) a.people.add(user);
    a.companies.add(org);
    if (area) a.areas.add(area);
  };
  const made = (a: Acc) => {
    a.made++;
  };
  // The hours each person saved an estimate in: an estimate opened in the same hour is that one, not another.
  const madeHours = new Set<string>();
  const hourKey = (user: string, t: number) => `${user}:${Math.floor(t / H)}`;
  for (const r of [...roofs, ...hvacs]) if (r.createdById) madeHours.add(hourKey(r.createdById, r.createdAt.getTime()));
  for (const e of acts) if (e.actorId && e.kind === "ESTIMATE" && !tabled(e.meta)) madeHours.add(hourKey(e.actorId, e.createdAt.getTime()));
  const worked = (user: string, t: number) => {
    const k = hourKey(user, t);
    if (madeHours.has(k)) return undefined;
    return (a: Acc) => {
      a.worked.add(k);
    };
  };

  for (const v of views) {
    if (!v.userId) continue;
    const t = v.at.getTime();
    const estimate = ESTIMATE_SCREEN.test(v.route) && !NOT_ESTIMATE.test(v.route);
    add(t, atWork(v.userId, v.organizationId, estimate ? undefined : AREA_SCREENS.find(([, re]) => re.test(v.route))?.[0]));
    const w = estimate ? worked(v.userId, t) : undefined;
    if (w) add(t, w);
  }
  for (const e of acts) {
    if (!e.actorId) continue;
    const t = e.createdAt.getTime();
    add(t, atWork(e.actorId, e.organizationId, AREA_OF_KIND[e.kind]));
    if (e.kind === "ESTIMATE" && !tabled(e.meta)) add(t, made);
    else if (e.kind === "ESTIMATE" || (e.proposalId && PROPOSAL_WORK.has(e.kind))) {
      // A roof or HVAC trail row is its table's estimate, counted there: here only the work on it (a re-save).
      const w = worked(e.actorId, t);
      if (w) add(t, w);
    }
  }
  for (const r of [...roofs, ...hvacs]) {
    add(r.createdAt.getTime(), atWork(r.createdById, r.organizationId));
    add(r.createdAt.getTime(), made);
  }

  const counts = (a: Acc): UsageCounts => ({ people: a.people.size, companies: a.companies.size, estimates: a.made + a.worked.size, areas: AREAS.filter((x) => a.areas.has(x)) });
  const barWords = (key: UsageRangeKey, i: number): { label: string; title: string } => {
    if (key === "day") {
      const t = (nowHour - 23 + i) * H + 1;
      const hour = hourFmt.format(new Date(t));
      return { label: hour, title: `${md(dayOf(t))}, ${hour}` };
    }
    if (key === "week" || key === "month") {
      const d = (key === "week" ? d7 : d30)[i];
      return { label: md(d), title: asDate(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) };
    }
    if (key === "quarter") {
      const d = d91[i * 7];
      return { label: md(d), title: `Week of ${md(d)}` };
    }
    const m = asDate(`${months[i]}-15`);
    return { label: m.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), title: m.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
  };
  const ranges: UsageRange[] = defs.map((r, k) => ({
    key: r.key,
    label: r.label,
    words: r.words,
    unit: r.unit,
    ...counts(tally[k].total),
    bars: tally[k].bars.map((b, i) => ({ ...barWords(r.key, i), ...counts(b) })),
  }));
  const capped = [views, acts, roofs, hvacs].some((rows) => rows.length >= CAP);
  return { ranges, capped, at: new Date(now).toISOString() };
}
