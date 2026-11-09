import "server-only";
// REPAIRS FOR THE OPERATOR (2026-11-09, the ProSmart gaps plan, part 2): "the Lee gutters are leaking at the corner,
// send Alex back Tuesday at 9", "how many come-backs did Dan have this year", "what came back on the Pia deck". The
// same booking the repair sheet makes (lib/repairs/server bookRepair) — read back, done on a yes — and the same counts
// the Workers page shows. The office's: a sales seat or the crew doesn't send a van.

import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import { wallInstant, dayWords, clockWords } from "@/lib/assistant/shared";
import { crewConflicts } from "@/lib/jobs/scheduleCore";
import { bookRepair, crewComebackStats, repairFactsFor } from "@/lib/repairs/server";
import { causeLabel, reasonOf, reasonsFromWords, repairFamilyOf, repairTitle, whoPaysWords, type RepairCause } from "@/lib/repairs/shared";

const ID = z.string().min(1).max(64);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const TIME = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "HH:MM");
const CAUSE_OF: Record<string, RepairCause> = { our_work: "WORKMANSHIP", material: "PRODUCT", client: "CLIENT" };

type BookArgs = {
  jobId: string | null;
  proposalId: string | null;
  problem: string;
  cause: "our_work" | "material" | "client" | null;
  billable: boolean | null;
  charge: number | null;
  workerId: string | null;
  pay: number | null;
  date: string | null;
  start: string | null;
  hours: number | null;
};
type BookPayload = {
  jobId: string | null;
  proposalId: string | null;
  reasons: string[];
  note: string;
  cause: RepairCause | null;
  billable: boolean;
  charge: number | null;
  workerId: string | null;
  pay: number | null;
  day: string | null;
  time: string | null;
  hours: number;
};

const bookRepairTool: WriteTool<BookArgs, BookPayload> = {
  kind: "write",
  name: "book_repair",
  need: "schedule.write",
  card: {
    label: "Book a repair",
    purpose: "Send someone back to a job that came back — a warranty repair or a billable one — with what's wrong, who goes, the pay and when.",
    when: "'The Lee gutters leak at the corner — send Alex back Tuesday at 9', 'book a warranty repair on the Pia deck', 'the client broke the gate, charge them $200 to fix it': book_repair with the job id from find (or a sold proposal's id), the problem in the person's words, why it came back (our_work / material / client, null when not said), and the worker id from crew. No date = it waits on the calendar's To place list. Not for new work — that's a job or a visit.",
    objects: ["job", "worker", "calendar", "client"],
    effect: "schedule",
    group: "schedule",
    version: 1,
    since: "2026-11-09",
    samples: [
      { say: "the Lee gutters are leaking at the corner, send Alex back Tuesday at 9", args: { jobId: "job_1", proposalId: null, problem: "leaking at the corner", cause: null, billable: null, charge: null, workerId: "w_1", pay: null, date: "2026-11-10", start: "09:00", hours: null } },
      { say: "the client backed into the gate, book a billable repair for $200", args: { jobId: "job_2", proposalId: null, problem: "client backed into the gate, gate won't latch", cause: "client", billable: true, charge: 200, workerId: null, pay: null, date: null, start: null, hours: null } },
    ],
  },
  description:
    "Book a repair (a come-back) on a job that was done: a new crew job of kind repair at the client's house, linked to the original. problem = what's wrong in the person's words (it becomes the installer's note and picks the reason chips). cause: our_work (counts on the crew who did the job), material (a product failed), client (the client's or the weather's doing — usually billable), null = not said. billable null = warranty (free) unless the cause is client; charge = what the client pays before tax (a change order is sent to them to approve). workerId from crew; pay = their pay for it (null = their usual repair pay, else 0). date + start on the company's clock, hours (default 2); no date = it waits on the calendar's To place list.",
  params: z.object({
    jobId: ID.nullable(),
    proposalId: ID.nullable().describe("a sold proposal's id when it has no job yet"),
    problem: z.string().min(2).max(800),
    cause: z.enum(["our_work", "material", "client"]).nullable(),
    billable: z.boolean().nullable(),
    charge: z.number().min(0).max(100_000).nullable(),
    workerId: ID.nullable(),
    pay: z.number().min(0).max(20_000).nullable(),
    date: DAY.nullable(),
    start: TIME.nullable(),
    hours: z.number().min(0.5).max(12).nullable(),
  }),
  payload: z.object({
    jobId: ID.nullable(),
    proposalId: ID.nullable(),
    reasons: z.array(z.string()).max(12),
    note: z.string().max(1500),
    cause: z.enum(["WORKMANSHIP", "PRODUCT", "CLIENT"]).nullable(),
    billable: z.boolean(),
    charge: z.number().nullable(),
    workerId: ID.nullable(),
    pay: z.number().nullable(),
    day: DAY.nullable(),
    time: TIME.nullable(),
    hours: z.number(),
  }),
  async plan({ actor, now }, args) {
    const org = actor.organizationId;
    const tz = actor.timezone;
    // The job that came back (a repair's id is read as its original).
    type Orig = { id: string; title: string; kind: string; repairOfId: string | null; proposal: { trade: string | null; title: string } | null; client: { name: string } | null };
    const sel = { id: true, title: true, kind: true, repairOfId: true, proposal: { select: { trade: true, title: true } }, client: { select: { name: true } } } as const;
    let orig: Orig | null = null;
    let proposalTitle: string | null = null;
    let family = repairFamilyOf(args.problem);
    if (args.jobId) {
      orig = await db.job.findFirst({ where: { id: args.jobId, organizationId: org }, select: sel });
      if (orig?.kind === "REPAIR" && orig.repairOfId) orig = await db.job.findFirst({ where: { id: orig.repairOfId, organizationId: org }, select: sel });
      if (!orig) return { ok: false, say: "I couldn't find that job." };
    } else if (args.proposalId) {
      const p = await db.proposal.findFirst({ where: { id: args.proposalId, organizationId: org }, select: { id: true, title: true, status: true, trade: true, client: { select: { name: true } } } });
      if (!p) return { ok: false, say: "I couldn't find that proposal." };
      if (!["ACCEPTED", "COMPLETED", "PAID"].includes(p.status)) return { ok: false, say: `"${p.title}" isn't sold yet — a repair goes back to work that was done.` };
      orig = await db.job.findFirst({ where: { organizationId: org, proposalId: p.id, kind: { not: "REPAIR" } }, orderBy: { createdAt: "desc" }, select: sel });
      if (!orig) {
        proposalTitle = p.title;
        family = repairFamilyOf(p.trade, p.title, args.problem);
      }
    } else return { ok: false, say: "Which job came back? Tell me the client or the job." };
    if (orig) family = repairFamilyOf(orig.proposal?.trade, orig.title, orig.proposal?.title, args.problem);
    const clientName = orig?.client?.name ?? null;

    const reasons = reasonsFromWords(family, args.problem);
    const cause = args.cause ? CAUSE_OF[args.cause] : null;
    const billable = args.billable ?? cause === "CLIENT";
    if (billable && !(args.charge && args.charge > 0)) return { ok: false, say: "How much do you charge the client for it, before tax?" };

    let worker: { id: string; displayName: string; phone: string | null; smsOptIn: boolean } | null = null;
    if (args.workerId) {
      worker = await db.workerProfile.findFirst({ where: { id: args.workerId, organizationId: org }, select: { id: true, displayName: true, phone: true, smsOptIn: true } });
      if (!worker) return { ok: false, say: "That person isn't on your team." };
    }
    // Their usual repair pay, when none was said.
    let pay = args.pay;
    if (pay == null && worker) pay = (await db.jobAssignment.findFirst({ where: { workerId: worker.id, pay: { gt: 0 }, job: { organizationId: org, kind: "REPAIR" } }, orderBy: { assignedAt: "desc" }, select: { pay: true } }))?.pay ?? null;

    const hours = args.hours ?? 2;
    let whenWords = "no time yet — it waits on the calendar's To place list";
    let heads = "";
    if (args.date || args.start) {
      if (!args.date) return { ok: false, say: "Which day?" };
      const startsAt = wallInstant(args.date, args.start ?? "09:00", tz);
      if (!startsAt) return { ok: false, say: "I couldn't read that day or time." };
      if (startsAt.getTime() < now.getTime() - 60 * 60_000) return { ok: false, say: `${dayWords(startsAt, tz)} has passed. Which day did you mean?` };
      const endsAt = new Date(startsAt.getTime() + hours * 3_600_000);
      whenWords = `${dayWords(startsAt, tz)} at ${clockWords(startsAt, tz)} for ${hours} h`;
      if (worker) {
        const clash = await crewConflicts(org, [worker.id], startsAt, endsAt, null);
        heads = clash.slice(0, 2).map((c) => ` Heads-up: ${c.name} is on "${c.what}" ${dayWords(c.startsAt, tz)} ${clockWords(c.startsAt, tz)}–${clockWords(c.endsAt, tz)} — say yes to book it anyway.`).join("");
      }
    }
    const title = repairTitle(reasons, clientName);
    const on = orig?.title ?? proposalTitle ?? "the job";
    const reasonWords = reasons.length ? reasons.map((k) => reasonOf(k)!.label.toLowerCase()).join(", ") : "see the note";
    return {
      ok: true,
      payload: { jobId: orig?.id ?? null, proposalId: orig ? null : (args.proposalId ?? null), reasons, note: args.problem.trim(), cause, billable, charge: billable ? args.charge : null, workerId: worker?.id ?? null, pay, day: args.date ?? null, time: args.date ? (args.start ?? "09:00") : null, hours },
      readback:
        `Book a repair on "${on}": "${title}" (${reasonWords}) — ${worker ? `${worker.displayName}${pay ? `, pay $${Math.round(pay)}` : ""}` : "nobody on it yet"}, ${whenWords}. ` +
        `Why: ${causeLabel(cause).toLowerCase()}. ${whoPaysWords(billable, billable ? args.charge : null)}${billable ? " — the client gets a change order to approve" : ""}.` +
        (worker && worker.phone && worker.smsOptIn ? ` ${worker.displayName.split(" ")[0]} gets a text.` : "") +
        heads,
    };
  },
  async execute({ actor }, p) {
    const r = await bookRepair(
      { organizationId: actor.organizationId, userId: actor.userId },
      { jobId: p.jobId, proposalId: p.proposalId, reasons: p.reasons, note: p.note, cause: p.cause, billable: p.billable, charge: p.charge, sendChangeOrder: true, workerId: p.workerId, pay: p.pay, day: p.day, time: p.time, hours: p.hours, force: true, via: "assistant" },
    );
    if (!r.ok) return { say: r.say };
    const co = r.changeOrder ? ` Change order #${r.changeOrder.number} for $${r.changeOrder.total} ${r.changeOrder.sent ? "went to the client" : "is saved as a draft"}.` : "";
    return {
      say: `Booked — "${r.title}"${r.when ? ` ${r.when}` : ", waiting on the To place list"}${r.worker ? ` with ${r.worker}${r.texted ? " (texted)" : ""}` : ""}.${co}${r.chargeNote ? ` ${r.chargeNote}` : ""}`,
      result: { jobId: r.jobId, page: `/dashboard/jobs/${r.jobId}` },
    };
  },
};

type ComebackArgs = { jobId: string | null; who: string | null };

const comebacks: ReadTool<ComebackArgs> = {
  kind: "read",
  name: "comebacks",
  need: "crew.read",
  card: {
    label: "Come-backs",
    purpose: "The repairs sent back to a job, or the crew's come-backs over the last year (only 'our work' counts on the crew).",
    when: "'What came back on the Pia deck', 'how many come-backs did Dan have', 'who has the most callbacks': comebacks(jobId) for one job (id from find), comebacks(who) for one person, both null for the whole crew.",
    objects: ["job", "worker"],
    effect: "read",
    group: "crew",
    version: 1,
    since: "2026-11-09",
    samples: [
      { say: "what came back on the Pia deck?", args: { jobId: "job_1", who: null } },
      { say: "how many come-backs did Dan have this year?", args: { jobId: null, who: "Dan" } },
    ],
  },
  description: "Repairs and come-backs. jobId = one job's repairs (when, who, why, warranty or billable, what each cost). who = a person's name, null = everyone: come-backs on their work over the last 12 months (only 'our work' counts), what those cost, and the repairs they were sent on.",
  params: z.object({ jobId: ID.nullable(), who: z.string().max(80).nullable() }),
  async run({ actor }, args) {
    const org = actor.organizationId;
    const money = actor.role !== "SALES" && actor.role !== "ESTIMATOR";
    if (args.jobId) {
      const job = await db.job.findFirst({ where: { id: args.jobId, organizationId: org }, select: { id: true, title: true } });
      if (!job) return { say: "That job isn't in this company." };
      const f = await repairFactsFor(org, job.id);
      if (!f.comebacks.length) return { job: job.title, say: `Nothing has come back on "${job.title}".` };
      return {
        job: job.title,
        repairs: f.comebacks.map((c) => ({ title: c.title, when: c.when, who: c.who, why: c.cause, pays: c.billable ? "billable" : "warranty", status: c.status.toLowerCase(), ...(money ? { cost: c.cost } : {}) })),
        page: `/dashboard/jobs/${job.id}`,
      };
    }
    const stats = await crewComebackStats(org);
    const workers = await db.workerProfile.findMany({ where: { organizationId: org, inviteStatus: { not: "DECLINED" } }, select: { id: true, displayName: true } });
    let rows = workers.map((w) => ({ who: w.displayName, ...(stats.get(w.id) ?? { comebacks: 0, cost: 0, sentOn: 0 }) }));
    if (args.who) {
      const q = args.who.trim().toLowerCase();
      rows = rows.filter((r) => r.who.toLowerCase().includes(q));
      if (!rows.length) return { say: `No one called ${args.who} on the team.` };
    } else rows = rows.filter((r) => r.comebacks || r.sentOn).sort((a, b) => b.comebacks - a.comebacks || b.cost - a.cost);
    if (!rows.length) return { say: "No come-backs in the last 12 months." };
    return {
      period: "last 12 months",
      crew: rows.map((r) => ({ who: r.who, comebacksOnTheirWork: r.comebacks, ...(money ? { cost: r.cost } : {}), repairsTheyWentOn: r.sentOn })),
      page: "/dashboard/workers",
    };
  },
};

export const REPAIR_TOOLS = [bookRepairTool, comebacks] as const;
