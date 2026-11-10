// THE COMPANY PULSE (Smart CRM part 7, 2026-11-10) — pure, shared by the Office sheet's scorecard, the Monday
// report mail, the morning briefing's line, the Operator's company_pulse tool and qa/tests/logic/pulse.check.ts.
//
// Four questions an owner asks about the sales side, each answered for one period against the one before it:
//   · SPEED TO LEAD — how long a new lead waits for its first reply (Lead.contactedAt, set by a booked visit, a
//     call or text logged, the AI desk's call, a SmartBook reply, or the lead moved on by hand), who is still
//     waiting, and each person's own time;
//   · WIN RATE PER SALESPERSON — of the proposals decided in the period, how many each owner won;
//   · BEST LEAD SOURCES — the Pipeline page's own source report over the same days;
//   · "WORTH A LOOK" — a few sentences made by the rules below from those numbers. No model writes them and no
//     outside statistic is quoted: every figure is the company's own.
//
// A period runs on the company's clock: a week is Monday 00:00 to Monday 00:00 in its time zone.

import { addDays, ago, fmtDay, fmtWeekday, money, moneyShort, startOfDayTz, type Tone } from "@/lib/crm/brief";

const DAY = 86_400_000;
const MIN = 60_000;

export const PULSE_PERIODS = ["week", "last-week", "30d", "90d"] as const;
export type PulsePeriod = (typeof PULSE_PERIODS)[number];
export const PERIOD_LABEL: Record<PulsePeriod, string> = { week: "This week", "last-week": "Last week", "30d": "30 days", "90d": "90 days" };

export const isPulsePeriod = (v: unknown): v is PulsePeriod => typeof v === "string" && (PULSE_PERIODS as readonly string[]).includes(v);

export interface PulseWindow {
  period: PulsePeriod;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  /** "This week so far" */
  label: string;
  /** "the same days last week" — what the comparison is against, said after "than". */
  prevLabel: string;
  /** "Nov 3 – Nov 9" */
  range: string;
  /** The period's length in days (a week so far may be 2.4). */
  days: number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday 00:00 of the company's week. Stepped back from noon, so a clock change inside the week never lands on
 *  the wrong day. */
export function startOfWeekTz(now: Date, tz: string): Date {
  const today = startOfDayTz(now, tz);
  const back = Math.max(0, WEEKDAYS.indexOf(fmtWeekday(now, tz)));
  return startOfDayTz(new Date(today.getTime() + DAY / 2 - back * DAY), tz);
}

const weekBefore = (monday: Date, tz: string) => startOfDayTz(new Date(monday.getTime() - 7 * DAY + DAY / 2), tz);

/** On a Monday "this week" is a few hours old, so the sheet opens on last week. */
export function defaultPeriod(now: Date, tz: string): PulsePeriod {
  return fmtWeekday(now, tz) === "Mon" ? "last-week" : "week";
}

export function pulseWindow(period: PulsePeriod, now: Date, tz: string): PulseWindow {
  const range = (from: Date, to: Date) => {
    const a = fmtDay(from, tz);
    const b = fmtDay(new Date(to.getTime() - 1), tz);
    return a === b ? a : `${a} – ${b}`;
  };
  if (period === "week" || period === "last-week") {
    const monday = startOfWeekTz(now, tz);
    const prevMonday = weekBefore(monday, tz);
    if (period === "week") {
      // Against the same stretch of last week: Monday to Wednesday noon is compared with Monday to Wednesday noon.
      const prevTo = new Date(Math.min(monday.getTime(), prevMonday.getTime() + (now.getTime() - monday.getTime())));
      return { period, from: monday, to: now, prevFrom: prevMonday, prevTo, label: "This week so far", prevLabel: "the same days last week", range: range(monday, new Date(now.getTime() + 1)), days: Math.max(1 / 24, (now.getTime() - monday.getTime()) / DAY) };
    }
    return { period, from: prevMonday, to: monday, prevFrom: weekBefore(prevMonday, tz), prevTo: prevMonday, label: "Last week", prevLabel: "the week before", range: range(prevMonday, monday), days: 7 };
  }
  const n = period === "30d" ? 30 : 90;
  const from = addDays(now, -n);
  return { period, from, to: now, prevFrom: addDays(now, -2 * n), prevTo: from, label: `Last ${n} days`, prevLabel: `the ${n} days before`, range: range(from, new Date(now.getTime() + 1)), days: n };
}

// ─────────────────────────────────────────────────────────────────────────────
// WHAT GOES IN
// ─────────────────────────────────────────────────────────────────────────────

export interface PulseLead {
  id: string;
  name: string;
  createdAt: Date;
  claimedAt: Date | null;
  contactedAt: Date | null;
  status: string;
  source: string | null;
  /** Whoever took it: claimedById, else assignedToId. */
  ownerId: string | null;
}

export interface PulseProposal {
  id: string;
  ownerId: string | null;
  status: string;
  total: number;
  sentAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  canceledAt: Date | null;
  validUntil: Date | null;
  createdAt: Date;
}

export interface PulsePayment {
  amount: number;
  paidAt: Date;
}

export interface PulseMember {
  id: string;
  name: string;
  role: string | null;
}

/** A row of the Pipeline page's source report (lib/pipeline/server readSourceReport). */
export interface PulseSource {
  key: string;
  label: string;
  leads: number;
  won: number;
  wonValue: number;
  collected: number;
  medianReplyMin: number | null;
  monthlySpend: number | null;
  costPerJob: number | null;
}

export interface PulseInput {
  window: PulseWindow;
  now: Date;
  /** Leads that came in from `window.prevFrom` on. */
  leads: PulseLead[];
  /** Proposals sent or decided from `window.prevFrom` on (never drafts or archived ones). */
  proposals: PulseProposal[];
  /** Money received from `window.prevFrom` on. */
  payments: PulsePayment[];
  members: PulseMember[];
  /** The source report over the period itself. */
  sources: PulseSource[];
}

// ─────────────────────────────────────────────────────────────────────────────
// WHAT COMES OUT
// ─────────────────────────────────────────────────────────────────────────────

export interface PulseStat {
  key: "leads" | "reply" | "sent" | "won" | "rate" | "collected";
  label: string;
  value: string;
  sub: string;
  tone: Tone | null;
  delta: { words: string; tone: Tone } | null;
}

export type SpeedBucketKey = "5m" | "1h" | "day" | "later" | "waiting" | "untimed";

export interface SpeedPerson {
  userId: string | null;
  name: string;
  role: string | null;
  leads: number;
  replied: number;
  medianMin: number | null;
  waiting: number;
}

export interface WinRow {
  userId: string | null;
  name: string;
  role: string | null;
  sent: number;
  won: number;
  lost: number;
  /** Won ÷ decided, 0–100; null when nothing was decided. */
  rate: number | null;
  wonValue: number;
}

export interface PulseNote {
  key: string;
  tone: Tone;
  text: string;
  href: string | null;
}

export interface Pulse {
  period: PulsePeriod;
  label: string;
  prevLabel: string;
  range: string;
  /** Nothing came in, went out, was decided or was paid in the period. */
  quiet: boolean;
  /** Money received in the period, to the cent (the tile shows it short). */
  collected: number;
  stats: PulseStat[];
  speed: {
    leads: number;
    replied: number;
    medianMin: number | null;
    prevMedianMin: number | null;
    buckets: { key: SpeedBucketKey; label: string; count: number; tone: Tone | null }[];
    waiting: { id: string; name: string; since: string; owner: string | null; href: string }[];
    waitingMore: number;
    people: SpeedPerson[];
  };
  wins: { rows: WinRow[]; total: WinRow };
  sources: PulseSource[];
  sourcesMore: number;
  notes: PulseNote[];
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ARITHMETIC
// ─────────────────────────────────────────────────────────────────────────────

const INTAKE = ["NEW", "ROUTED", "CLAIMED"];
const SOLD = ["ACCEPTED", "COMPLETED", "PAID"];
const LOST = ["DECLINED", "EXPIRED"];

const within = (d: Date | null | undefined, from: Date, to: Date): d is Date => !!d && d >= from && d < to;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** "under a minute" · "12 min" · "3 h" · "2 days" */
export function waitWords(min: number): string {
  if (min < 1) return "under a minute";
  if (min < 90) return `${Math.round(min)} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} days`;
}

/**
 * When the clock starts on a lead. A lead the company got itself: the moment it came in. A Lead Center lead: the
 * moment the shop accepted it — before that its phone and email are locked (lib/leadCenter/contacts), so nobody
 * could have called. Null = an offer not taken yet, which is nobody's wait.
 */
export function clockStart(l: Pick<PulseLead, "source" | "status" | "createdAt" | "claimedAt">): Date | null {
  if (l.source !== "LEAD_CENTER") return l.createdAt;
  if (l.claimedAt) return l.claimedAt;
  return l.status === "ROUTED" ? null : l.createdAt;
}

type Timed = { lead: PulseLead; start: Date; min: number | null; state: "replied" | "waiting" | "untimed" };

function timed(leads: PulseLead[], from: Date, to: Date): Timed[] {
  const out: Timed[] = [];
  for (const lead of leads) {
    if (!within(lead.createdAt, from, to)) continue;
    const start = clockStart(lead);
    if (!start) continue;
    if (lead.contactedAt) out.push({ lead, start, min: Math.max(0, (lead.contactedAt.getTime() - start.getTime()) / MIN), state: "replied" });
    else if (INTAKE.includes(lead.status)) out.push({ lead, start, min: null, state: "waiting" });
    // Moved on (quoted, won, lost, archived) with no first reply on record: counted as a lead, left out of the time.
    else out.push({ lead, start, min: null, state: "untimed" });
  }
  return out;
}

const medianOf = (rows: Timed[]) => median(rows.flatMap((r) => (r.min === null ? [] : [r.min])));

/** When a proposal was lost: the day a sold job was cancelled, else the day it was declined, else the day it ran out. */
export const lostAt = (p: PulseProposal): Date => p.canceledAt ?? p.declinedAt ?? p.validUntil ?? p.createdAt;

function deals(proposals: PulseProposal[], from: Date, to: Date) {
  const sent = proposals.filter((p) => within(p.sentAt, from, to));
  const won = proposals.filter((p) => SOLD.includes(p.status) && within(p.acceptedAt, from, to));
  const lost = proposals.filter((p) => LOST.includes(p.status) && within(lostAt(p), from, to));
  return { sent, won, lost };
}

const rateOf = (won: number, lost: number): number | null => (won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null);
const sum = (rows: { total: number }[]) => rows.reduce((a, r) => a + r.total, 0);

function countDelta(now: number, before: number, prevLabel: string, goodWhenUp = true): PulseStat["delta"] {
  if (now === before) return before === 0 ? null : { words: `same as ${prevLabel}`, tone: "info" };
  const up = now > before;
  return { words: `${up ? "▲" : "▼"} from ${before} ${prevLabel}`, tone: up === goodWhenUp ? "ok" : "warn" };
}

function moneyDelta(now: number, before: number, prevLabel: string): PulseStat["delta"] {
  if (Math.abs(now - before) < 0.5) return before < 0.5 ? null : { words: `same as ${prevLabel}`, tone: "info" };
  return { words: `${now > before ? "▲" : "▼"} from ${moneyShort(before)} ${prevLabel}`, tone: now > before ? "ok" : "warn" };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PULSE
// ─────────────────────────────────────────────────────────────────────────────

/** How far below the company's win rate (in points) a salesperson is before it is said, and on how many decided. */
const BEHIND_POINTS = 20;
const BEHIND_MIN_DECIDED = 3;
/** A median first reply slower than this is said. */
const SLOW_REPLY_MIN = 60;

export function buildPulse(input: PulseInput): Pulse {
  const { window: w, now } = input;
  const who = new Map(input.members.map((m) => [m.id, m]));
  const person = (id: string | null, none: string) => {
    const m = id ? who.get(id) : null;
    return { userId: m ? m.id : null, name: m ? m.name : id ? "Former teammate" : none, role: m?.role ?? null };
  };
  const short = w.prevLabel;

  // ── speed to lead ──
  const cur = timed(input.leads, w.from, w.to);
  const prev = timed(input.leads, w.prevFrom, w.prevTo);
  const leadsNow = input.leads.filter((l) => within(l.createdAt, w.from, w.to)).length;
  const leadsPrev = input.leads.filter((l) => within(l.createdAt, w.prevFrom, w.prevTo)).length;
  const replied = cur.filter((r) => r.state === "replied");
  const waiting = cur.filter((r) => r.state === "waiting").sort((a, b) => a.start.getTime() - b.start.getTime());
  const untimed = cur.filter((r) => r.state === "untimed").length;
  const medianMin = medianOf(cur);
  const prevMedianMin = medianOf(prev);
  const inBucket = (lo: number, hi: number) => replied.filter((r) => (r.min as number) > lo && (r.min as number) <= hi).length;
  const buckets: Pulse["speed"]["buckets"] = [
    { key: "5m", label: "Within 5 min", count: inBucket(-1, 5), tone: "ok" },
    { key: "1h", label: "Within the hour", count: inBucket(5, 60), tone: "ok" },
    { key: "day", label: "Same day", count: inBucket(60, 1440), tone: "warn" },
    { key: "later", label: "Later", count: inBucket(1440, Infinity), tone: "danger" },
    { key: "waiting", label: "Still waiting", count: waiting.length, tone: "danger" },
    { key: "untimed", label: "No time on record", count: untimed, tone: null },
  ];
  const ownerIds = [...new Set(cur.map((r) => r.lead.ownerId))];
  const people: SpeedPerson[] = ownerIds
    .map((id) => {
      const mine = cur.filter((r) => r.lead.ownerId === id);
      return { ...person(id, "Not assigned"), leads: mine.length, replied: mine.filter((r) => r.state === "replied").length, medianMin: medianOf(mine), waiting: mine.filter((r) => r.state === "waiting").length };
    })
    // A person first, the unassigned pile last; among people, the most leads first.
    .sort((a, b) => Number(a.userId === null) - Number(b.userId === null) || b.leads - a.leads || a.name.localeCompare(b.name));

  // ── win rate ──
  const d = deals(input.proposals, w.from, w.to);
  const dPrev = deals(input.proposals, w.prevFrom, w.prevTo);
  const sellerIds = [...new Set([...d.sent, ...d.won, ...d.lost].map((p) => p.ownerId))];
  const winRow = (id: string | null, all: boolean): WinRow => {
    const mine = (p: PulseProposal) => all || p.ownerId === id;
    const won = d.won.filter(mine);
    const lost = d.lost.filter(mine).length;
    return { ...(all ? { userId: null, name: "Company", role: null } : person(id, "No salesperson")), sent: d.sent.filter(mine).length, won: won.length, lost, rate: rateOf(won.length, lost), wonValue: sum(won) };
  };
  const total = winRow(null, true);
  const rows = sellerIds.map((id) => winRow(id, false)).sort((a, b) => Number(a.userId === null) - Number(b.userId === null) || b.wonValue - a.wonValue || b.won - a.won || b.sent - a.sent || a.name.localeCompare(b.name));
  const prevRate = rateOf(dPrev.won.length, dPrev.lost.length);

  // ── money in ──
  const collected = input.payments.filter((p) => within(p.paidAt, w.from, w.to)).reduce((a, p) => a + p.amount, 0);
  const collectedPrev = input.payments.filter((p) => within(p.paidAt, w.prevFrom, w.prevTo)).reduce((a, p) => a + p.amount, 0);

  // ── the six numbers ──
  const replyDelta = (): PulseStat["delta"] => {
    if (medianMin === null || prevMedianMin === null) return null;
    if (waitWords(medianMin) === waitWords(prevMedianMin)) return { words: `same as ${short}`, tone: "info" };
    return { words: `${medianMin < prevMedianMin ? "▼" : "▲"} from ${waitWords(prevMedianMin)} ${short}`, tone: medianMin < prevMedianMin ? "ok" : "warn" };
  };
  const rateDelta = (): PulseStat["delta"] => {
    if (total.rate === null || prevRate === null) return null;
    if (total.rate === prevRate) return { words: `same as ${short}`, tone: "info" };
    return { words: `${total.rate > prevRate ? "▲" : "▼"} from ${prevRate}% ${short}`, tone: total.rate > prevRate ? "ok" : "warn" };
  };
  const stats: PulseStat[] = [
    { key: "leads", label: "New leads", value: String(leadsNow), sub: waiting.length ? `${waiting.length} still waiting for a reply` : leadsNow ? "every one answered or moved on" : "none came in", tone: waiting.length ? "danger" : null, delta: countDelta(leadsNow, leadsPrev, short) },
    {
      key: "reply",
      label: "First reply",
      value: medianMin === null ? "—" : waitWords(medianMin),
      sub: medianMin === null ? "no reply on record yet" : replied.length === 1 ? "the one lead that heard back" : `half of ${replied.length} leads heard back faster`,
      tone: medianMin === null ? null : medianMin <= SLOW_REPLY_MIN ? "ok" : medianMin <= 1440 ? "warn" : "danger",
      delta: replyDelta(),
    },
    { key: "sent", label: "Proposals sent", value: String(d.sent.length), sub: d.sent.length ? `${moneyShort(sum(d.sent))} quoted` : "none went out", tone: null, delta: countDelta(d.sent.length, dPrev.sent.length, short) },
    { key: "won", label: "Jobs won", value: String(total.won), sub: total.won ? `${moneyShort(total.wonValue)} sold` : "none signed", tone: total.won ? "ok" : null, delta: countDelta(total.won, dPrev.won.length, short) },
    { key: "rate", label: "Win rate", value: total.rate === null ? "—" : `${total.rate}%`, sub: total.rate === null ? "nothing decided yet" : `${total.won} won of ${total.won + total.lost} decided`, tone: null, delta: rateDelta() },
    { key: "collected", label: "Collected", value: moneyShort(collected), sub: "payments received", tone: null, delta: moneyDelta(collected, collectedPrev, short) },
  ];

  // ── the sources: the ones that brought anything, best first (the report's own order) ──
  const live = input.sources.filter((s) => s.leads > 0 || s.won > 0);
  const sources = live.slice(0, 5);

  // ── worth a look ──
  const notes: PulseNote[] = [];
  if (waiting.length) {
    const oldest = waiting[0];
    notes.push({ key: "waiting", tone: "danger", text: `${plural(waiting.length, "lead")} from ${/^Last \d/.test(w.label) ? "the " : ""}${w.label.toLowerCase()} ${waiting.length === 1 ? "has" : "have"} no reply yet — ${oldest.lead.name} came in ${ago(oldest.start, now)}.`, href: "/dashboard/leads" });
  }
  if (medianMin !== null && medianMin > SLOW_REPLY_MIN && replied.length >= 3) {
    notes.push({ key: "slow", tone: "warn", text: `Half of the leads waited longer than ${waitWords(medianMin)} for a first reply.`, href: "/dashboard/leads" });
  } else if (medianMin !== null && prevMedianMin !== null && replied.length >= 3 && medianMin <= prevMedianMin * 0.7 && waitWords(medianMin) !== waitWords(prevMedianMin)) {
    notes.push({ key: "faster", tone: "ok", text: `First replies got faster: ${waitWords(medianMin)} now, ${waitWords(prevMedianMin)} ${short}.`, href: null });
  }
  const slowest = people.filter((p) => p.userId && p.replied >= 3 && p.medianMin !== null && medianMin !== null && p.medianMin > Math.max(SLOW_REPLY_MIN, medianMin * 2)).sort((a, b) => (b.medianMin as number) - (a.medianMin as number))[0];
  if (slowest) notes.push({ key: "slow-person", tone: "warn", text: `${slowest.name}'s leads wait ${waitWords(slowest.medianMin as number)} for a first reply; the company's middle is ${waitWords(medianMin as number)}.`, href: "/dashboard/leads" });
  if (total.rate !== null) {
    const behind = rows.filter((r) => r.userId && r.rate !== null && r.won + r.lost >= BEHIND_MIN_DECIDED && (total.rate as number) - r.rate >= BEHIND_POINTS).sort((a, b) => (a.rate as number) - (b.rate as number))[0];
    if (behind) notes.push({ key: "behind", tone: "warn", text: `${behind.name} won ${behind.won} of ${behind.won + behind.lost} decided (${behind.rate}%); the company won ${total.rate}%.`, href: "/dashboard/proposals" });
  }
  const best = live.find((s) => s.won > 0);
  if (best && live.length > 1) notes.push({ key: "best-source", tone: "ok", text: `${best.label} brought the most paid work: ${plural(best.won, "job")} won${best.wonValue > 0 ? ` (${money(best.wonValue)})` : ""} from ${plural(best.leads, "lead")}.`, href: "/dashboard/pipeline?view=sources" });
  const dry = live.filter((s) => s.monthlySpend !== null && s.monthlySpend > 0 && s.won === 0 && s.leads >= 5).sort((a, b) => (b.monthlySpend as number) - (a.monthlySpend as number))[0];
  if (dry) notes.push({ key: "dry-source", tone: "warn", text: `${dry.label}: ${plural(dry.leads, "lead")} and nothing won yet, at ${money(dry.monthlySpend as number)} a month.`, href: "/dashboard/pipeline?view=sources" });

  return {
    period: w.period,
    label: w.label,
    prevLabel: w.prevLabel,
    range: w.range,
    quiet: leadsNow === 0 && d.sent.length === 0 && d.won.length === 0 && d.lost.length === 0 && collected < 0.005,
    collected,
    stats,
    speed: {
      leads: leadsNow,
      replied: replied.length,
      medianMin,
      prevMedianMin,
      buckets,
      waiting: waiting.slice(0, 6).map((r) => ({ id: r.lead.id, name: r.lead.name, since: ago(r.start, now), owner: r.lead.ownerId ? (who.get(r.lead.ownerId)?.name ?? null) : null, href: `/dashboard/leads/${encodeURIComponent(r.lead.id)}` })),
      waitingMore: Math.max(0, waiting.length - 6),
      people,
    },
    wins: { rows, total },
    sources,
    sourcesMore: Math.max(0, live.length - sources.length),
    notes: notes.slice(0, 4),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// IN WORDS — the briefing's line, the Operator's answer, the Monday mail
// ─────────────────────────────────────────────────────────────────────────────

/** One sentence: "Last week: 12 new leads (first reply 14 min, 2 still waiting), 5 proposals sent, 3 won ($41,200), win rate 60%, $18,400 collected." */
export function pulseLine(p: Pulse): string {
  if (p.quiet) return `${p.label}: no new leads, proposals or payments.`;
  const s = p.speed;
  const waiting = s.buckets.find((b) => b.key === "waiting")?.count ?? 0;
  const lead = `${plural(s.leads, "new lead")}${s.leads ? ` (${[s.medianMin !== null ? `first reply ${waitWords(s.medianMin)}` : null, waiting ? `${waiting} still waiting` : null].filter(Boolean).join(", ") || "no reply time on record"})` : ""}`;
  const t = p.wins.total;
  return `${p.label}: ${lead}, ${plural(t.sent, "proposal")} sent, ${t.won} won${t.won ? ` (${money(t.wonValue)})` : ""}${t.rate !== null ? `, win rate ${t.rate}%` : ""}, ${money(p.collected)} collected.`;
}

/** The morning briefing's short line on a day that is not Monday: "This week so far: 7 new leads, first reply 12 min, 1 still waiting." Null when no lead came in. */
export function pulseShortLine(p: Pulse): string | null {
  if (!p.speed.leads) return null;
  const waiting = p.speed.buckets.find((b) => b.key === "waiting")?.count ?? 0;
  return `${p.label}: ${plural(p.speed.leads, "new lead")}${p.speed.medianMin !== null ? `, first reply ${waitWords(p.speed.medianMin)}` : ""}${waiting ? `, ${waiting} still waiting` : ""}.`;
}

/** The salespeople, one clause each: "Mike 3 of 5 won ($41,200)". */
export function winWords(r: WinRow): string {
  const decided = r.won + r.lost;
  return `${r.name}: ${decided ? `${r.won} of ${decided} won (${r.rate}%)` : "nothing decided"}${r.wonValue > 0 ? `, ${money(r.wonValue)} sold` : ""}${r.sent ? `, ${r.sent} sent` : ""}`;
}

export function speedWords(p: SpeedPerson): string {
  return `${p.name}: ${plural(p.leads, "lead")}${p.medianMin !== null ? `, first reply ${waitWords(p.medianMin)}` : ""}${p.waiting ? `, ${p.waiting} still waiting` : ""}`;
}

export function sourceWords(s: PulseSource): string {
  return `${s.label}: ${plural(s.leads, "lead")}, ${s.won} won${s.wonValue > 0 ? ` (${money(s.wonValue)})` : ""}${s.collected > 0 ? `, ${money(s.collected)} collected` : ""}${s.costPerJob !== null ? `, ${money(s.costPerJob)} per won job` : ""}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE MONDAY REPORT — when it goes
// ─────────────────────────────────────────────────────────────────────────────

/** Monday morning on the company's clock: from 7 until noon (the hourly job's first run in that stretch sends it;
 *  a job that was down all morning skips the week rather than mail at night). */
export function weeklyReportDue(now: Date, tz: string): boolean {
  if (fmtWeekday(now, tz) !== "Mon") return false;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour >= 7 && hour < 12;
}
