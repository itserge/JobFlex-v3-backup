// THE PROJECT OVERVIEW (owner, 2026-11-09: "is the remodeler or new home builder has overview of their project? … to
// see what is going on and help them to what to do or what needed ahead to follow the timeline or budget"; then:
// "make it super smart and easy, very understandable for a contractor, with interactivity"). One card at the top of
// every project: how it stands in one line, what to do now with a button on each row, what the next 14 days need,
// who waits on whom, the money, what happened last, and a road of the work with the project's place on it.
//
// Fixed rules over what the project page already reads — the same project always reads the same — and the order is
// the contractor's: what stops the crew first, then money at risk, then what the client or a sub is waiting on. No
// model here. Pure: the page, the phone, the morning briefing, the Operator and the checks share it.

import type { BuyingRead } from "@/lib/projectBuying/server";
import type { ProjectFieldRead } from "@/lib/crewField/server";
import type { TimelineRead } from "@/lib/projectTimeline/server";
import type { SelectionsRead } from "@/lib/projectSelections/server";
import type { SubsRead } from "@/lib/projectSubs/server";
import type { InvoicesRead } from "@/lib/subInvoices/server";
import type { MoneyPlanRead } from "@/lib/projectMoneyPlan/server";
import type { DrawsRead } from "@/lib/projectDraws/server";
import type { ShareRead } from "@/lib/projectClient/server";
import type { PhasesRead } from "@/lib/projectPhases/server";

// ── days ─────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`) / DAY);
/** Whole days from a to b (ISO days or datetimes): positive when b is later. */
export const daysFrom = (a: string, b: string) => dayNum(b) - dayNum(a);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 12". */
export const shortDay = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
/** "today", "tomorrow", "Thursday", "Nov 20" — the next six days by weekday. */
export function dayWord(iso: string, today: string): string {
  const n = daysFrom(today, iso);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n > 1 && n < 7) return new Date(`${iso.slice(0, 10)}T12:00:00.000Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return shortDay(iso);
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "$8,400". */
export const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// ── the shapes ───────────────────────────────────────────────────────────────

/** The card a row's button opens on the project page (its `data-project-*` section). */
export type OvCard = "stages" | "timeline" | "buying" | "subs" | "selections" | "money" | "payments" | "field" | "finish" | "client" | "phases" | "budget";

export type OvAct =
  | { t: "go"; card: OvCard; label: string; stageId?: string }
  | { t: "open"; href: string; label: string }
  | { t: "mail"; to: string; subject: string; label: string }
  | { t: "text"; to: string; label: string }
  | { t: "stage-done"; stageId: string; label: string }
  | { t: "inspection"; inspectionId: string; result: "PASSED" | "FAILED"; label: string }
  | { t: "remind-picks"; note: string; label: string };

export type OvTone = "red" | "amber";
export type OvItem = { key: string; tone: OvTone; text: string; why: string | null; act: OvAct | null; alt: OvAct | null; rank: number };

export type OvAhead = { key: string; day: string; title: string; stageId: string | null; ready: string[]; missing: string[] };

export type OvPerson = {
  key: string;
  role: "Client" | "Sub" | "Crew" | "Lender" | "Supplier";
  name: string;
  line: string;
  /** Who waits: "you" — they wait on the office; "them" — the office waits on them. */
  waits: "you" | "them" | null;
  phone: string | null;
  email: string | null;
};

export type OvStep = { key: string; name: string; state: "done" | "now" | "late" | "todo"; stageId: string | null; days: string | null };

export type OvMoney = {
  budget: number;
  spent: number;
  committed: number;
  headingFor: number;
  over: number;
  contract: number | null;
  margin: number | null;
  collected: number;
  owed: number;
  ideas: number;
};

export type OvEvent = { at: string; text: string };

export type Overview = {
  tone: "red" | "amber" | "green";
  /** "At risk", "Needs you", "On track", "On hold", "Finished". */
  word: string;
  /** "4 days behind · $3,200 over budget". */
  line: string;
  /** "Rough-in · 62% done · 3 to do now". */
  sub: string;
  behind: number;
  doNow: OvItem[];
  ahead: OvAhead[];
  people: OvPerson[];
  money: OvMoney | null;
  road: OvStep[];
  history: OvEvent[];
};

type Stage = { id: string; name: string; status: string; startsAt: string | null; endsAt: string | null; doneAt: string | null; gates?: Array<{ id: string; name: string; result: string; date: string | null }>; phaseId?: string | null };
type Job = { title: string; status: string; startsAt: string | null; endsAt: string | null; crew: Array<{ name: string; status: string }> };
type PayRow = { title: string; billed: number; paid: number; remaining: number; stages: Array<{ id: string; label: string; amount: number; status: string; paidAt: string | null; invoiceSentAt: string | null; remindedAt: string | null }> };

export type OverviewInput = {
  /** Today, the company's day (ISO). */
  today: string;
  project: { id: string; kind: string; status: string; endsAt: string | null; clientName: string | null; clientPhone: string | null; clientEmail: string | null; budget: number };
  stages: Stage[];
  done: number | null;
  phases: PhasesRead | null;
  field: ProjectFieldRead | null;
  timeline: TimelineRead | null;
  buying: BuyingRead | null;
  selections: SelectionsRead | null;
  subs: SubsRead | null;
  invoices: InvoicesRead | null;
  money: MoneyPlanRead | null;
  payments: PayRow[];
  draws: DrawsRead | null;
  share: ShareRead | null;
  /** The finish line's own flags (lib/projectFinish finishFlags), when the work is over. */
  finish: Array<{ kind: string; text: string }>;
  jobs: Job[];
  /** The money roll-up the list reads (collected and owed by the client). */
  collected: number;
  owed: number;
  /** The project's subcontractors page, for the rows a sub's work opens. */
  subsHref: string;
};

const LEAD_DAYS = 3;
/** A sub still owes an answer (lib/projectSubs WAITING_ON_SUB). */
const WAITING: readonly string[] = ["ASKED", "VIEWED", "REVISION"];
const AHEAD_DAYS = 14;
/** A stage this many days late reads red. */
export const RED_LATE_DAYS = 3;

// ── the rules ────────────────────────────────────────────────────────────────

/** Every item the Overview's Do now could show, ranked; the caller shows them in order. */
export function doNowOf(r: OverviewInput): OvItem[] {
  const t = r.today;
  const out: OvItem[] = [];
  const push = (x: OvItem) => out.push(x);
  const active = r.project.status !== "COMPLETED" && r.project.status !== "ARCHIVED";

  // 0 · the crew is stuck
  for (const p of r.field?.problems ?? []) {
    if (p.status !== "OPEN") continue;
    push({ key: `problem:${p.id}`, tone: p.blocking ? "red" : "amber", text: p.blocking ? `Crew stuck on ${p.jobTitle}: ${p.note}` : `Problem on ${p.jobTitle}: ${p.note}`, why: p.by ? `Flagged by ${p.by} ${p.at ? dayWord(p.at, t) : p.when}` : `Flagged ${p.at ? dayWord(p.at, t) : p.when}`, act: { t: "go", card: "field", label: "Open it" }, alt: null, rank: p.blocking ? 0 : 9 });
  }
  if (!active) return finishItems(r, out);

  // 1 · inspections: failed, passed by with no result, today or the next work day
  const insp = r.timeline?.inspections ?? [];
  for (const i of insp) {
    if (i.result === "FAILED") {
      const again = insp.some((x) => x.id !== i.id && x.name === i.name && x.result !== "FAILED" && (x.date ?? "") >= (i.date ?? ""));
      if (!again) push({ key: `insp-failed:${i.id}`, tone: "red", text: `${i.name} failed: book the re-inspection`, why: i.resultNote, act: { t: "go", card: "timeline", label: "Book it" }, alt: null, rank: 1 });
    } else if (i.result === "PENDING" && i.date) {
      const n = daysFrom(t, i.date);
      if (n < 0) push({ key: `insp-result:${i.id}`, tone: "amber", text: `${i.name} was ${dayWord(i.date, t)}: how did it go?`, why: null, act: { t: "inspection", inspectionId: i.id, result: "PASSED", label: "Passed" }, alt: { t: "inspection", inspectionId: i.id, result: "FAILED", label: "Failed" }, rank: 8 });
      else if (n <= 1 || (n <= 3 && new Date(`${t}T12:00:00Z`).getUTCDay() === 5)) push({ key: `insp-soon:${i.id}`, tone: "amber", text: `${i.name} ${dayWord(i.date, t)}`, why: i.readyNote ? "The checklist is ready" : "No checklist yet", act: { t: "go", card: "timeline", label: "Checklist" }, alt: null, rank: 9 });
    }
  }

  // 2 · late stages
  for (const s of r.stages) {
    if (s.status === "DONE" || !s.endsAt) continue;
    const late = daysFrom(s.endsAt, t);
    if (late <= 0) continue;
    const holding = (s.gates ?? []).filter((g) => g.result !== "PASSED");
    push({
      key: `late:${s.id}`,
      tone: late >= RED_LATE_DAYS ? "red" : "amber",
      text: `${s.name} ${plural(late, "day")} late`,
      why: holding.length ? `Waits on ${holding.map((g) => g.name).join(", ")}` : `Was due ${shortDay(s.endsAt)}`,
      act: { t: "go", card: "timeline", label: "Move dates", stageId: s.id },
      alt: holding.length ? null : { t: "stage-done", stageId: s.id, label: "It's done" },
      rank: late >= RED_LATE_DAYS ? 2 : 11,
    });
  }
  // A stage that should have started: its day passed, nothing before it is open, and it is still planned.
  const firstOpen = r.stages.find((s) => s.status !== "DONE");
  if (firstOpen && firstOpen.status === "PLANNED" && firstOpen.startsAt && daysFrom(firstOpen.startsAt, t) > 0 && !(firstOpen.endsAt && daysFrom(firstOpen.endsAt, t) > 0)) {
    push({ key: `start:${firstOpen.id}`, tone: "amber", text: `${firstOpen.name} was to start ${dayWord(firstOpen.startsAt, t)}`, why: "Still marked planned", act: { t: "go", card: "stages", label: "Start it", stageId: firstOpen.id }, alt: null, rank: 10 });
  }

  // 3 · materials and deliveries
  const byStage = new Map<string, { stage: string; start: string; lines: number }>();
  for (const m of r.buying?.materials ?? []) {
    const toBuy = m.quantity - m.orderedQty;
    if (toBuy <= 0 || !m.stageStart || m.stageDone) continue;
    const key = m.stageName ?? "the work";
    const was = byStage.get(key);
    byStage.set(key, { stage: key, start: m.stageStart.slice(0, 10), lines: (was?.lines ?? 0) + 1 });
  }
  for (const x of byStage.values()) {
    const toStart = daysFrom(t, x.start);
    if (toStart > LEAD_DAYS) continue;
    const started = toStart <= 0;
    push({
      key: `order:${x.stage}`,
      tone: started ? "red" : "amber",
      text: started ? `${x.stage} started without its materials` : toStart === LEAD_DAYS ? `Order ${x.stage.toLowerCase()} materials today` : `${x.stage} materials not ordered`,
      why: `${plural(x.lines, "line")} to buy · the stage starts ${dayWord(x.start, t)}`,
      act: { t: "go", card: "buying", label: "Order now" },
      alt: null,
      rank: started ? 3 : 10,
    });
  }
  for (const o of r.buying?.orders ?? []) {
    if (["DELIVERED", "PARTIAL", "CANCELED"].includes(o.status) || !o.expectedAt) continue;
    const late = daysFrom(o.expectedAt, t);
    if (late <= 0) continue;
    const from = o.supplier?.name ?? o.buyerName ?? "the supplier";
    const mail = o.supplier?.email ?? o.buyerEmail;
    push({
      key: `delivery:${o.id}`,
      tone: "amber",
      text: `Delivery ${plural(late, "day")} late`,
      why: `Order ${o.number} from ${from}${o.stageName ? ` for ${o.stageName}` : ""}`,
      act: o.buyerPhone ? { t: "text", to: o.buyerPhone, label: "Text them" } : mail ? { t: "mail", to: mail, subject: `Order ${o.number}: where is it?`, label: "Email them" } : { t: "go", card: "buying", label: "Open it" },
      alt: null,
      rank: 4,
    });
  }

  // 4 · the client's picks
  const picks = (r.selections?.selections ?? []).filter((s) => !s.chosenAt && !s.stageDone && s.due);
  const latePicks = picks.filter((s) => daysFrom(s.due!, t) > 0);
  const soonPicks = picks.filter((s) => daysFrom(t, s.due!) >= 0 && daysFrom(t, s.due!) <= 3);
  const remind = (rows: typeof picks): OvAct | null => {
    if (!r.share?.clientEmail && !r.share?.clientPhone) return { t: "go", card: "selections", label: "Open picks" };
    const list = rows.map((s) => `${s.name} by ${shortDay(s.due!)}`).join(", ");
    return { t: "remind-picks", note: `A reminder about your choices: ${list}. You can pick them on your project page.`, label: "Remind the client" };
  };
  if (latePicks.length) {
    const urgent = latePicks.some((s) => s.stageStart && daysFrom(t, s.stageStart) <= LEAD_DAYS);
    const first = latePicks[0];
    push({ key: "picks-late", tone: urgent ? "red" : "amber", text: latePicks.length === 1 ? `${first.name} not picked, ${plural(daysFrom(first.due!, t), "day")} past due` : `${latePicks.length} client picks past due`, why: first.stageName && first.stageStart ? `${first.stageName} starts ${dayWord(first.stageStart, t)}` : null, act: remind(latePicks), alt: remind(latePicks)?.t === "remind-picks" ? { t: "go", card: "selections", label: "Open picks" } : null, rank: urgent ? 5 : 12 });
  }
  if (soonPicks.length) {
    const first = soonPicks[0];
    push({ key: "picks-soon", tone: "amber", text: soonPicks.length === 1 ? `Client picks ${first.name.toLowerCase()} by ${dayWord(first.due!, t)}` : `${soonPicks.length} client picks due by ${dayWord(soonPicks[soonPicks.length - 1].due!, t)}`, why: first.stageName ? `For ${first.stageName}` : null, act: remind(soonPicks), alt: null, rank: 16 });
  }

  // 5 · money at risk
  const tot = r.money?.totals;
  if (tot && tot.budget > 0 && tot.over > 0) {
    const ideas = r.money?.advice.length ?? 0;
    push({ key: "over-budget", tone: "red", text: `Heading ${dollars(tot.over)} over budget`, why: `${dollars(tot.headingFor)} against ${dollars(tot.budget)}`, act: { t: "go", card: "money", label: ideas ? `${plural(ideas, "way")} to save` : "See the money" }, alt: null, rank: 6 });
  }
  const margin = r.money?.margin;
  if (margin && margin.amount < 0) push({ key: "losing", tone: "red", text: `Losing ${dollars(-margin.amount)} at this pace`, why: "The work is heading past the contract", act: { t: "go", card: "money", label: "See why" }, alt: null, rank: 7 });
  if (r.project.budget <= 0 && (r.money?.contract ?? 0) > 0) push({ key: "no-budget", tone: "amber", text: "No cost budget set", why: "Overruns can't be caught without one", act: { t: "go", card: "budget", label: "Set it" }, alt: null, rank: 21 });

  // 6 · subs: invoices, quotes, contracts
  for (const inv of r.invoices?.invoices ?? []) {
    if (inv.status === "RECEIVED") push({ key: `sub-inv:${inv.id}`, tone: "amber", text: `${inv.contractorName} invoice${inv.amount != null ? ` ${dollars(inv.amount)}` : ""} to review`, why: inv.flags[0]?.text ?? inv.stageName, act: { t: "open", href: `${r.subsHref}?tab=invoices`, label: "Review" }, alt: null, rank: 13 });
    else if (inv.status === "APPROVED" && inv.left != null && inv.left > 0) {
      const due = inv.dueAt ? daysFrom(inv.dueAt, t) : 0;
      if (due >= 0) push({ key: `sub-pay:${inv.id}`, tone: due > 0 ? "red" : "amber", text: `Pay ${inv.contractorName} ${dollars(inv.left)}`, why: inv.dueAt ? (due > 0 ? `Due ${shortDay(inv.dueAt)}, ${plural(due, "day")} ago` : "Due today") : "Approved, not paid", act: { t: "open", href: `${r.subsHref}?tab=invoices`, label: "Record it" }, alt: null, rank: due > 0 ? 7 : 14 });
    }
  }
  const quotes = r.subs?.quotes ?? [];
  const overdueQ = quotes.filter((q) => WAITING.includes(q.status) && q.dueBy && q.dueBy < t);
  if (overdueQ.length) push({ key: "quotes-overdue", tone: "amber", text: overdueQ.length === 1 ? `Quote overdue from ${overdueQ[0].contractorName}` : `${overdueQ.length} quotes overdue`, why: overdueQ[0].stageName ? `For ${overdueQ[0].stageName}` : null, act: { t: "open", href: `${r.subsHref}?tab=requests`, label: "Remind" }, alt: null, rank: 15 });
  const inQ = quotes.filter((q) => q.status === "QUOTED");
  if (inQ.length) push({ key: "quotes-in", tone: "amber", text: inQ.length === 1 ? `Quote in from ${inQ[0].contractorName}${inQ[0].amount != null ? `: ${dollars(inQ[0].amount)}` : ""}` : `${inQ.length} quotes in to decide`, why: inQ[0].stageName ? `For ${inQ[0].stageName}` : null, act: { t: "open", href: `${r.subsHref}?tab=compare`, label: "Compare" }, alt: null, rank: 15 });
  for (const q of quotes) {
    if (q.status !== "AWARDED") continue;
    if (!q.contract || q.contract.status === "CANCELLED") {
      const st0 = r.stages.find((s) => s.id === q.stageId);
      const soon0 = st0?.startsAt ? daysFrom(t, st0.startsAt) : null;
      if (soon0 != null && soon0 <= AHEAD_DAYS && st0?.status !== "DONE") push({ key: `contract-send:${q.id}`, tone: soon0 <= LEAD_DAYS ? "red" : "amber", text: `Send ${q.contractorName} the contract`, why: `Awarded${q.amount != null ? ` at ${dollars(q.amount)}` : ""} · ${st0!.name} starts ${dayWord(st0!.startsAt!, t)}`, act: { t: "open", href: `${r.subsHref}?tab=contracts`, label: "Draft it" }, alt: null, rank: soon0 <= LEAD_DAYS ? 5 : 12 });
      continue;
    }
    if (q.contract.status === "EXECUTED") continue;
    const st = r.stages.find((s) => s.id === q.stageId);
    const soon = st?.startsAt ? daysFrom(t, st.startsAt) : null;
    if (soon == null || soon > AHEAD_DAYS) continue;
    push({ key: `contract:${q.id}`, tone: soon <= LEAD_DAYS ? "red" : "amber", text: `${q.contractorName} contract not signed`, why: `${st!.name} starts ${dayWord(st!.startsAt!, t)}`, act: { t: "open", href: `${r.subsHref}?tab=contracts`, label: "Open it" }, alt: q.contractorPhone ? { t: "text", to: q.contractorPhone, label: "Text them" } : null, rank: soon <= LEAD_DAYS ? 5 : 12 });
  }

  // 7 · the client's money and the lender's
  for (const p of r.payments) {
    for (const s of p.stages) {
      if (s.status !== "UNPAID" || !s.invoiceSentAt) continue;
      const n = daysFrom(s.invoiceSentAt, t);
      if (n < 7) continue;
      push({ key: `owed:${s.id}`, tone: n >= 21 ? "red" : "amber", text: `${r.project.clientName ?? "The client"} owes ${dollars(s.amount)}`, why: `${s.label}, invoiced ${plural(n, "day")} ago${s.remindedAt ? `, reminded ${dayWord(s.remindedAt, t)}` : ""}`, act: { t: "go", card: "payments", label: "Remind" }, alt: null, rank: 17 });
    }
  }
  const next = r.draws?.lender ? r.draws.next : null;
  if (next && next.ready && next.state === "PLANNED") push({ key: `draw:${next.id}`, tone: "amber", text: `Draw ${next.number} ready to ask: ${dollars(next.amount)}`, why: next.phase ? `${next.phase.name} is closed` : null, act: { t: "go", card: "payments", label: "Request it" }, alt: null, rank: 18 });

  // 8 · the stages themselves
  if (!r.stages.length) push({ key: "no-stages", tone: "amber", text: "No stages yet", why: "A template lays the work out in a minute", act: { t: "go", card: "stages", label: "Add stages" }, alt: null, rank: 20 });

  return finishItems(r, out);
}

function finishItems(r: OverviewInput, out: OvItem[]): OvItem[] {
  for (const f of r.finish) out.push({ key: `finish:${f.kind}`, tone: "amber", text: f.text, why: null, act: { t: "go", card: "finish", label: "Next step" }, alt: null, rank: 19 });
  return out.sort((a, b) => (a.tone === b.tone ? a.rank - b.rank : a.tone === "red" ? -1 : 1));
}

/** The next 14 days: each stage that starts in them with what it needs, and the inspections, deliveries and picks
 *  that fall in them. Soonest first. */
export function aheadOf(r: OverviewInput): OvAhead[] {
  const t = r.today;
  const inWindow = (d: string | null | undefined) => !!d && daysFrom(t, d) > 0 && daysFrom(t, d) <= AHEAD_DAYS;
  const out: OvAhead[] = [];
  const covered = new Set<string>();
  const crewDays = new Set((r.timeline?.crewDays ?? []).map((c) => c.day));
  for (const s of r.stages) {
    if (s.status !== "PLANNED" || !inWindow(s.startsAt)) continue;
    const ready: string[] = [];
    const missing: string[] = [];
    const mats = (r.buying?.materials ?? []).filter((m) => m.stageId === s.id);
    const toBuy = mats.filter((m) => m.quantity - m.orderedQty > 0);
    if (toBuy.length) missing.push(`${plural(toBuy.length, "material")} not ordered`);
    else if (mats.length) ready.push("Materials ordered");
    for (const o of r.buying?.orders ?? []) {
      if (o.stageName !== s.name || !o.expectedAt || ["DELIVERED", "PARTIAL", "CANCELED"].includes(o.status)) continue;
      if (daysFrom(s.startsAt!, o.expectedAt) > 0) missing.push(`Order ${o.number} lands ${shortDay(o.expectedAt)}, after the start`);
    }
    const sels = (r.selections?.selections ?? []).filter((x) => x.stageId === s.id);
    for (const x of sels.filter((x) => !x.chosenAt)) missing.push(`Client pick: ${x.name}${x.due ? `, due ${shortDay(x.due)}` : ""}`);
    if (sels.length && sels.every((x) => x.chosenAt)) ready.push("Client picks made");
    const qs = (r.subs?.quotes ?? []).filter((q) => q.stageId === s.id);
    const signed = qs.find((q) => q.contract?.status === "EXECUTED");
    const awarded = qs.find((q) => q.status === "AWARDED");
    if (signed) ready.push(`${signed.contractorName} signed`);
    else if (awarded) missing.push(awarded.contract && awarded.contract.status !== "CANCELLED" ? `${awarded.contractorName} contract not signed` : `${awarded.contractorName}: no contract yet`);
    else if (qs.length || (r.subs?.requests ?? []).some((q) => q.stageId === s.id)) missing.push(qs.some((q) => q.status === "QUOTED") ? "Quotes in, no sub chosen" : "No sub chosen yet");
    for (const i of (r.timeline?.inspections ?? []).filter((i) => i.stageId === s.id && i.result === "PENDING")) {
      if (i.date) ready.push(`${i.name} booked ${shortDay(i.date)}`);
      else missing.push(`${i.name} not booked`);
      covered.add(i.id);
    }
    if (crewDays.size) {
      const span = Math.max(0, s.endsAt ? daysFrom(s.startsAt!, s.endsAt) : 0);
      const on = Array.from({ length: span + 1 }, (_, k) => new Date((dayNum(s.startsAt!) + k) * DAY).toISOString().slice(0, 10)).some((d) => crewDays.has(d));
      if (on) ready.push("Crew on the calendar");
      else missing.push("No crew on the calendar");
    }
    out.push({ key: `stage:${s.id}`, day: s.startsAt!.slice(0, 10), title: `${s.name} starts`, stageId: s.id, ready, missing });
  }
  for (const i of r.timeline?.inspections ?? []) {
    if (covered.has(i.id) || i.result !== "PENDING" || !inWindow(i.date)) continue;
    out.push({ key: `insp:${i.id}`, day: i.date!.slice(0, 10), title: i.name, stageId: i.stageId, ready: i.readyNote ? ["Checklist made"] : [], missing: i.readyNote ? [] : ["No checklist yet"] });
  }
  for (const o of r.buying?.orders ?? []) {
    if (!inWindow(o.expectedAt) || ["DELIVERED", "PARTIAL", "CANCELED"].includes(o.status)) continue;
    out.push({ key: `order:${o.id}`, day: o.expectedAt!.slice(0, 10), title: `Order ${o.number} arrives`, stageId: null, ready: [o.supplier?.name ?? o.buyerName ?? "On its way"], missing: [] });
  }
  const next = r.draws?.lender ? r.draws.next : null;
  if (next && next.state === "PLANNED" && !next.ready && next.phase && next.phase.waitsOn.length) {
    out.push({ key: `draw:${next.id}`, day: t, title: `Draw ${next.number}: ${dollars(next.amount)}`, stageId: null, ready: [], missing: next.phase.waitsOn.map((w) => `Waits on ${w}`) });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day)).slice(0, 6);
}

/** Who waits on whom: the client, each sub, the crew, the lender, a late supplier. */
export function peopleOf(r: OverviewInput): OvPerson[] {
  const t = r.today;
  const out: OvPerson[] = [];
  const clientName = r.share?.clientName ?? r.project.clientName;
  if (clientName) {
    const picks = (r.selections?.selections ?? []).filter((s) => !s.chosenAt && !s.stageDone);
    const owed = r.payments.flatMap((p) => p.stages).filter((s) => s.status === "UNPAID" && s.invoiceSentAt).reduce((n, s) => n + s.amount, 0);
    const line = picks.length ? `you wait: ${plural(picks.length, "pick")}` : owed > 0 ? `owes ${dollars(owed)}` : r.share?.updateSentAt ? `last update ${dayWord(r.share.updateSentAt, t)}` : "nothing waiting";
    out.push({ key: "client", role: "Client", name: clientName, line, waits: picks.length || owed > 0 ? "them" : null, phone: r.share?.clientPhone ?? r.project.clientPhone, email: r.share?.clientEmail ?? r.project.clientEmail });
  }
  const subs = new Map<string, OvPerson & { rank: number }>();
  for (const q of r.subs?.quotes ?? []) {
    const inv = (r.invoices?.invoices ?? []).find((i) => i.quoteId === q.id && i.status === "RECEIVED");
    const [line, waits, rank]: [string, OvPerson["waits"], number] = inv
      ? [`waits on you: ${inv.amount != null ? dollars(inv.amount) : "an"} invoice`, "you", 0]
      : q.status === "QUOTED"
        ? [`waits on you: ${q.amount != null ? `${dollars(q.amount)} quote` : "a quote"}`, "you", 1]
        : q.status === "AWARDED" && !q.contract
          ? ["waits on you: send the contract", "you", 2]
          : q.status === "AWARDED" && q.contract && q.contract.status !== "EXECUTED"
          ? ["contract not signed", "them", 2]
          : WAITING.includes(q.status)
            ? [q.dueBy && q.dueBy < t ? "quote overdue" : `asked ${dayWord(q.askedAt, t)}`, "them", 3]
            : q.contract?.status === "EXECUTED"
              ? [`signed ${dollars(q.contract.amount)}`, null, 4]
              : ["", null, 9];
    if (!line) continue;
    const was = subs.get(q.contractorId);
    if (was && was.rank <= rank) continue;
    subs.set(q.contractorId, { key: `sub:${q.contractorId}`, role: "Sub", name: q.contractorName, line, waits, phone: q.contractorPhone, email: q.contractorEmail, rank });
  }
  out.push(...[...subs.values()].sort((a, b) => a.rank - b.rank).slice(0, 5).map((p): OvPerson => ({ key: p.key, role: p.role, name: p.name, line: p.line, waits: p.waits, phone: p.phone, email: p.email })));
  const crewToday = new Set((r.timeline?.crewDays ?? []).filter((c) => c.day === t).map((c) => c.jobTitle));
  const crew = new Map<string, OvPerson>();
  for (const j of r.jobs) {
    if (j.status === "CANCELED") continue;
    for (const c of j.crew) {
      if (c.status === "DECLINED" || crew.has(c.name)) continue;
      const on = crewToday.has(j.title);
      const nextDay = (r.timeline?.crewDays ?? []).filter((d) => d.jobTitle === j.title && d.day > t).map((d) => d.day).sort()[0];
      crew.set(c.name, { key: `crew:${c.name}`, role: "Crew", name: c.name, line: on ? "on site today" : nextDay ? `next on site ${dayWord(nextDay, t)}` : c.status === "ACCEPTED" ? "on the project" : "asked, no answer yet", waits: c.status === "ACCEPTED" || on ? null : "them", phone: null, email: null });
    }
  }
  out.push(...[...crew.values()].slice(0, 4));
  if (r.draws?.lender) {
    const next = r.draws.next;
    const line = next && next.ready && next.state === "PLANNED" ? `draw ${next.number} ready to ask` : next && next.state === "REQUESTED" ? `draw ${next.number} asked${next.requestedAt ? ` ${dayWord(next.requestedAt, t)}` : ""}, not funded` : `${dollars(r.draws.funded)} of ${dollars(r.draws.total)} funded`;
    out.push({ key: "lender", role: "Lender", name: "Lender", line, waits: next?.state === "REQUESTED" ? "them" : next?.ready ? "you" : null, phone: null, email: null });
  }
  for (const o of r.buying?.orders ?? []) {
    if (["DELIVERED", "PARTIAL", "CANCELED"].includes(o.status) || !o.expectedAt || daysFrom(o.expectedAt, t) <= 0) continue;
    const name = o.supplier?.name ?? o.buyerName;
    if (!name || out.some((p) => p.name === name)) continue;
    out.push({ key: `supplier:${o.id}`, role: "Supplier", name, line: `order ${o.number} ${plural(daysFrom(o.expectedAt, t), "day")} late`, waits: "them", phone: o.buyerPhone, email: o.supplier?.email ?? o.buyerEmail });
  }
  return out;
}

/** The road of the work with the project's place on it: a new build's phases, else its stages. */
export function roadOf(r: OverviewInput): OvStep[] {
  const t = r.today;
  const phases = r.phases?.phases ?? [];
  if (phases.length) {
    return phases.map((p) => {
      const st = r.stages.filter((s) => s.phaseId === p.id);
      const ends = st.map((s) => s.endsAt).filter((d): d is string => !!d).sort();
      const late = p.status !== "DONE" && ends.length > 0 && daysFrom(ends[ends.length - 1], t) > 0;
      return { key: p.key, name: p.name, state: p.status === "DONE" ? "done" : late ? "late" : p.status === "ACTIVE" ? "now" : "todo", stageId: st[0]?.id ?? null, days: null };
    });
  }
  const firstOpen = r.stages.findIndex((s) => s.status !== "DONE");
  return r.stages.map((s, i) => {
    const late = s.status !== "DONE" && !!s.endsAt && daysFrom(s.endsAt, t) > 0;
    const state: OvStep["state"] = s.status === "DONE" ? "done" : late ? "late" : s.status === "ACTIVE" || i === firstOpen ? "now" : "todo";
    return { key: s.id, name: s.name, state, stageId: s.id, days: s.startsAt ? (s.endsAt && s.endsAt !== s.startsAt ? `${shortDay(s.startsAt)} to ${shortDay(s.endsAt)}` : shortDay(s.startsAt)) : null };
  });
}

/** What happened last, newest first. */
export function historyOf(r: OverviewInput): OvEvent[] {
  const ev: OvEvent[] = [];
  const add = (at: string | null | undefined, text: string) => {
    if (at) ev.push({ at, text });
  };
  for (const s of r.stages) add(s.doneAt, `${s.name} done`);
  for (const i of r.timeline?.inspections ?? []) if (i.result !== "PENDING") add(i.resultAt, `${i.name} ${i.result === "PASSED" ? "passed" : "failed"}`);
  for (const o of r.buying?.orders ?? []) {
    add(o.deliveredAt, `Order ${o.number} delivered`);
    add(o.orderedAt, `Order ${o.number} placed${o.supplier ? ` with ${o.supplier.name}` : ""}`);
  }
  for (const q of r.subs?.quotes ?? []) {
    add(q.quotedAt, `${q.contractorName} quoted${q.amount != null ? ` ${dollars(q.amount)}` : ""}`);
    add(q.awardedAt, `${q.contractorName} awarded${q.stageName ? ` ${q.stageName}` : ""}`);
  }
  for (const i of r.invoices?.invoices ?? []) add(i.receivedAt, `${i.contractorName} sent an invoice${i.amount != null ? ` for ${dollars(i.amount)}` : ""}`);
  for (const p of r.invoices?.payments ?? []) if (p.status !== "VOID") add(p.paidAt, `Paid ${p.contractorName} ${dollars(p.amount)}`);
  for (const s of r.selections?.selections ?? []) add(s.chosenAt, `${s.name} picked${s.byClient ? " by the client" : ""}${s.chosen ? `: ${s.chosen}` : ""}`);
  add(r.share?.updateSentAt, "Update sent to the client");
  for (const p of r.payments) for (const s of p.stages) if (s.status === "PAID") add(s.paidAt, `Client paid ${dollars(s.amount)} (${s.label})`);
  for (const d of r.draws?.draws ?? []) add(d.fundedAt, `Draw ${d.number} funded`);
  for (const p of r.field?.problems ?? []) add(p.at, `${p.blocking ? "Crew stuck" : "Problem"} on ${p.jobTitle}: ${p.note}`);
  return ev.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
}

/** The whole Overview. */
export function overviewOf(r: OverviewInput): Overview {
  const t = r.today;
  const doNow = doNowOf(r);
  const late = r.stages.filter((s) => s.status !== "DONE" && s.endsAt).map((s) => daysFrom(s.endsAt!, t)).filter((n) => n > 0);
  // Behind: the latest late stage's days — or, with none late, the days the planned end has passed.
  const endPassed = r.project.endsAt && r.stages.some((s) => s.status !== "DONE") ? Math.max(0, daysFrom(r.project.endsAt, t)) : 0;
  const behind = Math.max(0, ...late, endPassed);
  const tot = r.money?.totals ?? null;
  const spentAny = tot ? tot.spent + tot.committed > 0 : false;
  const moneyWords = tot && tot.budget > 0 ? (tot.over > 0 ? `${dollars(tot.over)} over budget` : !spentAny ? "nothing spent yet" : tot.over < 0 ? `${dollars(-tot.over)} under budget` : "on budget") : null;
  const scheduleWords = !r.stages.length ? "no stages yet" : r.stages.every((s) => s.status === "DONE") ? "all stages done" : behind > 0 ? `${plural(behind, "day")} behind` : "on schedule";
  const now = r.stages.find((s) => s.status === "ACTIVE") ?? r.stages.find((s) => s.status !== "DONE") ?? null;
  const red = doNow.some((x) => x.tone === "red");
  let tone: Overview["tone"] = red ? "red" : doNow.length ? "amber" : "green";
  let word = red ? "At risk" : doNow.length ? "Needs you" : "On track";
  if (r.project.status === "ON_HOLD") [tone, word] = ["amber", "On hold"];
  if (r.project.status === "COMPLETED" || r.project.status === "ARCHIVED") [tone, word] = [doNow.length ? "amber" : "green", "Finished"];
  const subParts = [now ? now.name : null, r.done != null ? `${r.done}% done` : null, doNow.length ? `${plural(doNow.length, "thing")} to do now` : "nothing to do now"].filter(Boolean);
  const tot2 = tot ?? null;
  return {
    tone,
    word,
    line: [scheduleWords, moneyWords].filter(Boolean).join(" · "),
    sub: subParts.join(" · "),
    behind,
    doNow,
    ahead: aheadOf(r),
    people: peopleOf(r),
    money: tot2
      ? { budget: tot2.budget, spent: tot2.spent, committed: tot2.committed, headingFor: tot2.headingFor, over: tot2.over, contract: r.money?.contract ?? null, margin: r.money?.margin?.amount ?? null, collected: r.collected, owed: r.owed, ideas: r.money?.advice.length ?? 0 }
      : r.project.budget > 0
        ? { budget: r.project.budget, spent: 0, committed: 0, headingFor: 0, over: 0, contract: null, margin: null, collected: r.collected, owed: r.owed, ideas: 0 }
        : null,
    road: roadOf(r),
    history: historyOf(r),
  };
}

// ── "Not now" ────────────────────────────────────────────────────────────────
// A row hidden for three days, for the one person who hid it — back sooner when it turns red.

export const SNOOZE_DAYS = 3;
export type Snoozes = Record<string, { until: string; tone: OvTone }>;

export function parseSnoozes(raw: string | null | undefined, today: string): Snoozes {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, { until?: unknown; tone?: unknown }>;
    const out: Snoozes = {};
    for (const [k, x] of Object.entries(v ?? {})) {
      if (typeof x?.until === "string" && x.until >= today && (x.tone === "red" || x.tone === "amber")) out[k.slice(0, 120)] = { until: x.until.slice(0, 10), tone: x.tone };
    }
    return out;
  } catch {
    return {};
  }
}

/** The rows to show: a snoozed row stays hidden until its day — unless it was amber and is red now. */
export function visibleItems(items: readonly OvItem[], snoozes: Snoozes): { shown: OvItem[]; hidden: number } {
  const shown = items.filter((x) => {
    const s = snoozes[x.key];
    return !s || (s.tone === "amber" && x.tone === "red");
  });
  return { shown, hidden: items.length - shown.length };
}

export const snoozeUntil = (today: string) => new Date((dayNum(today) + SNOOZE_DAYS) * DAY).toISOString().slice(0, 10);
