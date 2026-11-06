import "server-only";
// VISITS BY VOICE OR TEXT (2026-11-05, the AI Operator's batch 1): book, move
// or cancel an appointment with a client or a lead, through the calendar's own
// core (lib/appointments/core). Read back first — the office and the crew on
// the visit get texts, and a lead booked counts as contacted.
import { z } from "zod";
import { db } from "@/lib/db";
import type { WriteTool } from "@/lib/assistant/tools";
import { andList, dayOf, dayWords, spanWords, timeOf, wallInstant } from "@/lib/assistant/shared";
import { bookVisitAs, cancelVisitAs, moveVisitAs } from "@/lib/appointments/core";
import { crewConflicts } from "@/lib/jobs/scheduleCore";
import { isPageLocked } from "@/lib/customPageAccess";

const ID = z.string().min(1).max(64);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const TIME = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "HH:MM");
const HOUR_MS = 60 * 60_000;

const VISIT_SELECT = {
  id: true,
  title: true,
  status: true,
  startsAt: true,
  endsAt: true,
  client: { select: { name: true } },
  lead: { select: { name: true } },
  assignments: { select: { worker: { select: { displayName: true } } } },
} as const;

async function visitOf(organizationId: string, id: string) {
  return db.appointment.findFirst({ where: { id, organizationId }, select: VISIT_SELECT });
}

const whoOf = (v: { client: { name: string } | null; lead: { name: string } | null }) => v.client?.name ?? v.lead?.name ?? null;

type BookArgs = { title: string | null; clientId: string | null; leadId: string | null; date: string; start: string; end: string | null; workerIds: string[] | null; notes: string | null };
type BookPayload = { title: string; clientId: string | null; leadId: string | null; startsAt: string; endsAt: string; workerIds: string[]; notes: string | null; who: string | null };

const bookVisit: WriteTool<BookArgs, BookPayload> = {
  kind: "write",
  name: "book_visit",
  need: "visits.write",
  card: {
    "label": "Book a visit",
    "purpose": "An appointment with a client or a lead: an estimate visit, a measure, a walkthrough.",
    "when": "'Book a visit with Smith Tuesday at 10': find the client or lead first; date and times on the company's clock, end null = one hour; workerIds = who goes.",
    "objects": [
      "visit",
      "client",
      "lead",
      "worker",
      "calendar"
    ],
    "effect": "schedule",
    "group": "visits",
    "version": 1,
    "since": "2026-11-05",
    "samples": [
      {
        "say": "book an estimate visit with Smith Tuesday at 10",
        "args": {
          "title": "Estimate visit",
          "clientId": "c_1",
          "leadId": null,
          "date": "2026-11-10",
          "start": "10:00",
          "end": null,
          "workerIds": null,
          "notes": null
        }
      }
    ]
  },
  description:
    "Book a visit (an appointment) with a client or a lead: an estimate visit, a measure, a walkthrough. Find the client or lead first. Date and times on the company's clock; end null = one hour. workerIds = who goes (ids from crew or find); null = nobody assigned yet.",
  params: z.object({
    title: z.string().max(120).nullable().describe("what the visit is for: 'Estimate visit', 'Measure the deck'; null = 'Visit'"),
    clientId: ID.nullable(),
    leadId: ID.nullable(),
    date: DAY,
    start: TIME,
    end: TIME.nullable(),
    workerIds: z.array(ID).max(6).nullable(),
    notes: z.string().max(500).nullable(),
  }),
  payload: z.object({ title: z.string(), clientId: ID.nullable(), leadId: ID.nullable(), startsAt: z.string(), endsAt: z.string(), workerIds: z.array(ID).max(6), notes: z.string().nullable(), who: z.string().nullable() }),
  async plan({ actor, now }, a) {
    const org = actor.organizationId;
    const tz = actor.timezone;
    if (await isPageLocked(org, "calendar")) return { ok: false, say: "The calendar isn't in your plan yet (Settings → Billing)." };
    if (a.clientId && a.leadId) return { ok: false, say: "A visit is with a client or a lead, not both." };
    let who: string | null = null;
    if (a.clientId) {
      const c = await db.client.findFirst({ where: { id: a.clientId, organizationId: org, deletedAt: null }, select: { name: true } });
      if (!c) return { ok: false, say: "I couldn't find that client." };
      who = c.name;
    } else if (a.leadId) {
      const l = await db.lead.findFirst({ where: { id: a.leadId, organizationId: org }, select: { name: true } });
      if (!l) return { ok: false, say: "I couldn't find that lead." };
      who = l.name;
    }
    const startsAt = wallInstant(a.date, a.start, tz);
    if (!startsAt) return { ok: false, say: "I couldn't read that date or time." };
    const endsAt = a.end ? wallInstant(a.date, a.end, tz) : new Date(startsAt.getTime() + HOUR_MS);
    if (!endsAt || endsAt.getTime() <= startsAt.getTime()) return { ok: false, say: "The end time has to be after the start." };
    if (startsAt.getTime() < now.getTime() - 60_000) return { ok: false, say: `${spanWords(startsAt, endsAt, tz)} has passed. When did you mean?` };
    const wanted = [...new Set(a.workerIds ?? [])];
    const workers = wanted.length ? await db.workerProfile.findMany({ where: { organizationId: org, id: { in: wanted } }, select: { id: true, displayName: true } }) : [];
    if (workers.length !== wanted.length) return { ok: false, say: "One of those crew members isn't on your crew." };
    const conflicts = wanted.length ? await crewConflicts(org, wanted, startsAt, endsAt, null) : [];
    const heads = conflicts.slice(0, 3).map((c) => ` Heads-up: ${c.name} is on "${c.what}" ${spanWords(c.startsAt, c.endsAt, tz)}.`).join("");
    const title = a.title?.trim() || "Visit";
    return {
      ok: true,
      payload: { title, clientId: a.clientId, leadId: a.leadId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), workerIds: workers.map((w) => w.id), notes: a.notes?.trim() || null, who },
      readback: `Book "${title}"${who ? ` with ${who}` : ""} ${spanWords(startsAt, endsAt, tz)}${workers.length ? `, ${andList(workers.map((w) => w.displayName))} going` : ""}. The office gets a text.${heads}`,
    };
  },
  async execute({ actor }, p) {
    const startsAt = new Date(p.startsAt);
    const endsAt = new Date(p.endsAt);
    const r = await bookVisitAs(
      { organizationId: actor.organizationId, userId: actor.userId, role: actor.role },
      { title: p.title, clientId: p.clientId, leadId: p.leadId, startsAt, endsAt, notes: p.notes, workerIds: p.workerIds },
    );
    return { say: `Booked — "${p.title}"${p.who ? ` with ${p.who}` : ""}, ${spanWords(startsAt, endsAt, actor.timezone)}. It's on the calendar.`, result: { visitId: r.id } };
  },
};

type MoveArgs = { visitId: string; date: string; start: string | null; end: string | null };
type MovePayload = { visitId: string; startsAt: string; endsAt: string; title: string; who: string | null };

const moveVisit: WriteTool<MoveArgs, MovePayload> = {
  kind: "write",
  name: "move_visit",
  need: "visits.write",
  card: {
    "label": "Move a visit",
    "purpose": "A visit to another day or time.",
    "when": "'Move the Smith visit to Thursday 2 pm': the visit id from find (kind visit) or schedule; start null = the same time of day.",
    "objects": [
      "visit",
      "calendar"
    ],
    "effect": "schedule",
    "group": "visits",
    "version": 1,
    "since": "2026-11-05",
    "samples": [
      {
        "say": "move the Smith visit to Thursday at 2",
        "args": {
          "visitId": "v_1",
          "date": "2026-11-12",
          "start": "14:00",
          "end": null
        }
      }
    ]
  },
  description: "Move a visit (an appointment) to another day or time. The visit id comes from find (kind visit) or schedule. start null = the same time of day; end null = the same length.",
  params: z.object({ visitId: ID, date: DAY, start: TIME.nullable(), end: TIME.nullable() }),
  payload: z.object({ visitId: ID, startsAt: z.string(), endsAt: z.string(), title: z.string(), who: z.string().nullable() }),
  async plan({ actor, now }, a) {
    const tz = actor.timezone;
    const v = await visitOf(actor.organizationId, a.visitId);
    if (!v) return { ok: false, say: "I couldn't find that visit." };
    if (v.status !== "SCHEDULED") return { ok: false, say: `"${v.title}" is ${v.status.toLowerCase().replace("_", " ")}, so there's nothing to move.` };
    const startsAt = wallInstant(a.date, a.start ?? timeOf(v.startsAt, tz), tz);
    if (!startsAt) return { ok: false, say: "I couldn't read that date or time." };
    const endsAt = a.end ? wallInstant(a.date, a.end, tz) : new Date(startsAt.getTime() + (v.endsAt.getTime() - v.startsAt.getTime()));
    if (!endsAt || endsAt.getTime() <= startsAt.getTime()) return { ok: false, say: "The end time has to be after the start." };
    if (dayOf(startsAt, tz) < dayOf(now, tz)) return { ok: false, say: `${dayWords(startsAt, tz)} is in the past. Which day did you mean?` };
    const who = whoOf(v);
    const crew = v.assignments.length ? " The crew on it gets a text." : "";
    return {
      ok: true,
      payload: { visitId: v.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), title: v.title, who },
      readback: `Move "${v.title}"${who ? ` (${who})` : ""} from ${spanWords(v.startsAt, v.endsAt, tz)} to ${spanWords(startsAt, endsAt, tz)}.${crew}`,
    };
  },
  async execute({ actor }, p) {
    const startsAt = new Date(p.startsAt);
    const endsAt = new Date(p.endsAt);
    await moveVisitAs({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role }, p.visitId, startsAt, endsAt);
    return { say: `Done — "${p.title}" is now ${spanWords(startsAt, endsAt, actor.timezone)}.`, result: { visitId: p.visitId } };
  },
};

const cancelVisit: WriteTool<{ visitId: string }, { visitId: string; title: string; who: string | null }> = {
  kind: "write",
  name: "cancel_visit",
  need: "visits.write",
  card: {
    "label": "Cancel a visit",
    "purpose": "Call off a visit.",
    "when": "'Cancel the visit with Smith': the visit id from find (kind visit) or schedule.",
    "objects": [
      "visit",
      "calendar"
    ],
    "effect": "schedule",
    "group": "visits",
    "version": 1,
    "since": "2026-11-05",
    "samples": [
      {
        "say": "cancel the visit with Smith",
        "args": {
          "visitId": "v_1"
        }
      }
    ]
  },
  description: "Cancel a visit (an appointment). The visit id comes from find (kind visit) or schedule.",
  params: z.object({ visitId: ID }),
  payload: z.object({ visitId: ID, title: z.string(), who: z.string().nullable() }),
  async plan({ actor }, a) {
    const v = await visitOf(actor.organizationId, a.visitId);
    if (!v) return { ok: false, say: "I couldn't find that visit." };
    if (v.status !== "SCHEDULED") return { ok: false, say: `"${v.title}" is already ${v.status.toLowerCase().replace("_", " ")}.` };
    const who = whoOf(v);
    const crew = v.assignments.length ? " The crew on it gets a text." : "";
    return { ok: true, payload: { visitId: v.id, title: v.title, who }, readback: `Cancel "${v.title}"${who ? ` with ${who}` : ""}, ${spanWords(v.startsAt, v.endsAt, actor.timezone)}.${crew}` };
  },
  async execute({ actor }, p) {
    await cancelVisitAs({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role }, p.visitId);
    return { say: `Cancelled — "${p.title}" is off the calendar.`, result: { visitId: p.visitId } };
  },
};

export const VISIT_TOOLS = [bookVisit, moveVisit, cancelVisit];
