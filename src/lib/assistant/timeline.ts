import "server-only";
// THE TIMELINE AND THE FINISH LINE FOR THE AI OPERATOR (the timeline build, 2026-11-06) — "Move the install to
// Friday", "the framing slipped two days, push everything", "schedule the final inspection for Tuesday, have
// ready the permit card", "rough-in passed", "add to the punch list: …", "what's left to finish Smith's", "the
// client signed off", "warranty for a year", "archive the project". Thin calls into lib/projectTimeline and
// lib/projectFinish; every change is read back for a yes like every other (lib/assistant/tools).

import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import { projectNamed, stageNamed } from "@/lib/assistant/projects";
import { localDayKey } from "@/lib/jobProgressShared";
import { stagesOf } from "@/lib/projectStages/server";
import { addInspection, addPunchItems, archiveProjectRow, askReview, finishOf, finishProject, recordInspection, setWarranty, signOff } from "@/lib/projectFinish/server";
import { finishSteps, warrantyDefault } from "@/lib/projectFinish/shared";
import { planShift, shiftRest } from "@/lib/projectTimeline/server";
import { addWorkDays, dayLabelLong, isoDay, workDaysLate, workDaysWords } from "@/lib/projectTimeline/shared";

const ID = z.string().min(1).max(64);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dayOf = (s: string | null) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

async function projectById(organizationId: string, projectId: string) {
  return db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, number: true, clientId: true } });
}

// ── move a stage ─────────────────────────────────────────────────────────────

type MoveArgs = { projectId: string; stage: string; startsAt: string; endsAt: string | null; shiftRest: boolean };
type MovePayload = { stageId: string; startsAt: string; endsAt: string; shiftDays: number; words: string };

const moveStage: WriteTool<MoveArgs, MovePayload> = {
  kind: "write",
  name: "move_stage",
  need: "projects.write",
  card: {
    label: "Move a stage",
    purpose: "Put a project's stage on other days — and, when asked, move everything after it along.",
    when: "'Move the install to Friday', 'tile starts the 18th', 'push framing a week and everything after it': move_stage with the project id, the stage as said and the first day as a date (work out 'Friday' from today). shiftRest true when they say the rest moves too.",
    objects: ["project"],
    effect: "schedule",
    group: "projects",
    version: 1,
    since: "2026-11-06",
    samples: [{ say: "move the install on the Smith kitchen to Friday", args: { projectId: "proj_1", stage: "install", startsAt: "2026-11-13", endsAt: null, shiftRest: false } }],
  },
  description:
    "Move a stage of a project to new days. Give the project id (find, kind project, or project_status), the stage as said, the first day (YYYY-MM-DD) and the last day or null to keep the stage's length. shiftRest true moves every stage after it, the crew's calendar days and the pending inspections by the same number of work days. Use for: move the install to Friday, tile starts the 18th, push framing a week and everything after.",
  params: z.object({ projectId: ID, stage: z.string().min(2).max(80), startsAt: DAY, endsAt: DAY.nullable(), shiftRest: z.boolean() }),
  payload: z.object({ stageId: ID, startsAt: DAY, endsAt: DAY, shiftDays: z.number().int().min(0).max(60), words: z.string() }),
  async plan({ actor }, args) {
    const p = await projectById(actor.organizationId, args.projectId);
    if (!p) return { ok: false, say: "I couldn't find that project." };
    const read = await stagesOf(p.id);
    const st = stageNamed(read.stages, args.stage);
    if (!st) return { ok: false, say: read.stages.length ? `Which stage? ${p.name} has: ${read.stages.map((s) => s.name).join(", ")}.` : `${p.name} has no stages yet.` };
    const oldStart = isoDay(st.startsAt);
    const oldEnd = isoDay(st.endsAt);
    const length = oldStart && oldEnd ? workDaysLate(oldStart, oldEnd) : 0;
    const startsAt = addWorkDays(args.startsAt, 0);
    const endsAt = args.endsAt ? addWorkDays(args.endsAt, 0) : addWorkDays(startsAt, length);
    if (endsAt < startsAt) return { ok: false, say: "The stage would end before it starts." };
    const shiftDays = args.shiftRest && oldEnd && endsAt > oldEnd ? workDaysLate(oldEnd, endsAt) : 0;
    const was = oldStart || oldEnd ? ` (was ${[oldStart, oldEnd].filter(Boolean).map((d) => dayLabelLong(d)).join(" – ")})` : " (it had no days)";
    const words = `Move "${st.name}" on ${p.name} to ${dayLabelLong(startsAt)}${endsAt !== startsAt ? ` – ${dayLabelLong(endsAt)}` : ""}${was}`;
    let tail = "";
    if (args.shiftRest && !shiftDays) tail = oldEnd ? " Nothing after it moves — it is not ending later." : " Nothing after it moves — it had no last day to move from.";
    if (shiftDays) {
      const plan = await planShift(actor.organizationId, p.id, st.id, shiftDays);
      tail = "error" in plan ? ` ${plan.error}` : ` ${plan.words.slice(1).join(" ")}`;
    }
    return { ok: true, payload: { stageId: st.id, startsAt, endsAt, shiftDays, words }, readback: `${words}?${tail}` };
  },
  async execute({ actor }, payload) {
    let moved = "";
    if (payload.shiftDays > 0) {
      const r = await shiftRest(actor.organizationId, (await db.projectStage.findUniqueOrThrow({ where: { id: payload.stageId }, select: { projectId: true } })).projectId, payload.stageId, payload.shiftDays, actor.userId);
      moved = ` ${r.stages} stage${r.stages === 1 ? "" : "s"}, ${r.visits} crew day${r.visits === 1 ? "" : "s"} and ${r.inspections} inspection${r.inspections === 1 ? "" : "s"} after it moved ${workDaysWords(payload.shiftDays)}.`;
    }
    await db.projectStage.update({ where: { id: payload.stageId }, data: { startsAt: dayOf(payload.startsAt), endsAt: dayOf(payload.endsAt) } });
    return { say: `Done — ${payload.words.replace(/^Move /, "moved ").replace(/ \(was .*\)$/, "")}.${moved}` };
  },
};

// ── shift the rest ───────────────────────────────────────────────────────────

type ShiftArgs = { projectId: string; stage: string; days: number };
type ShiftPayload = { stageId: string; days: number; words: string[] };

const shiftTheRest: WriteTool<ShiftArgs, ShiftPayload> = {
  kind: "write",
  name: "shift_rest",
  need: "projects.write",
  card: {
    label: "Shift the rest",
    purpose: "A stage slipped: everything after it moves by that many work days.",
    when: "'Framing slipped two days, push everything', 'we lost a week on the tile — shift the rest': shift_rest with the project id, the stage that slipped and the work days (a week = 5).",
    objects: ["project"],
    effect: "schedule",
    group: "projects",
    version: 1,
    since: "2026-11-06",
    samples: [{ say: "framing on the Smith deck slipped two days, push everything after it", args: { projectId: "proj_1", stage: "framing", days: 2 } }],
  },
  description:
    "A stage slipped: it ends later and every stage after it, the crew's calendar days past it and the pending inspections move by that many WORK days (Mon–Fri; a week is 5). Deliveries already ordered keep their dates. Give the project id, the stage and the days. Use for: framing slipped two days push everything, we lost a week shift the rest.",
  params: z.object({ projectId: ID, stage: z.string().min(2).max(80), days: z.number().int().min(1).max(60) }),
  payload: z.object({ stageId: ID, days: z.number().int().min(1).max(60), words: z.array(z.string()) }),
  async plan({ actor }, args) {
    const p = await projectById(actor.organizationId, args.projectId);
    if (!p) return { ok: false, say: "I couldn't find that project." };
    const read = await stagesOf(p.id);
    const st = stageNamed(read.stages, args.stage);
    if (!st) return { ok: false, say: read.stages.length ? `Which stage? ${p.name} has: ${read.stages.map((s) => s.name).join(", ")}.` : `${p.name} has no stages yet.` };
    const plan = await planShift(actor.organizationId, p.id, st.id, args.days);
    if ("error" in plan) return { ok: false, say: plan.error };
    return { ok: true, payload: { stageId: st.id, days: args.days, words: plan.words }, readback: `Shift the rest of ${p.name} by ${workDaysWords(args.days)}? ${plan.words.join(" ")}` };
  },
  async execute({ actor }, payload) {
    const st = await db.projectStage.findFirst({ where: { id: payload.stageId, project: { organizationId: actor.organizationId } }, select: { projectId: true, name: true } });
    if (!st) return { say: "That stage is gone." };
    const r = await shiftRest(actor.organizationId, st.projectId, payload.stageId, payload.days, actor.userId);
    return { say: `Done — ${r.words[0]} ${r.stages} stage${r.stages === 1 ? "" : "s"}, ${r.visits} crew day${r.visits === 1 ? "" : "s"} and ${r.inspections} inspection${r.inspections === 1 ? "" : "s"} moved ${workDaysWords(payload.days)}.`, result: r };
  },
};

// ── inspections ──────────────────────────────────────────────────────────────

type InspArgs = { projectId: string; name: string; date: string | null; haveReady: string | null; stage: string | null; isFinal: boolean; gate: boolean | null };
type InspPayload = { projectId: string; name: string; date: string | null; haveReady: string | null; stageId: string | null; isFinal: boolean; gate: boolean; words: string };

const addInspectionTool: WriteTool<InspArgs, InspPayload> = {
  kind: "write",
  name: "add_inspection",
  need: "projects.write",
  card: {
    label: "Book an inspection",
    purpose: "Put an inspection on a project: its day, what to have ready, whether it is the final one.",
    when: "'Rough-in inspection Tuesday', 'schedule the final inspection for the 20th', 'make the final inspection checklist': add_inspection with the project id, the name, the day as a date or null, and haveReady — when they ask for a checklist, WRITE it yourself for the trade (one line per item: permit card on site, access to the panel, smoke detectors in…). isFinal true for the final. gate null = it holds its stage (the stage cannot be marked done until it passes) when a stage is named; false only when they say the stage need not wait for it.",
    objects: ["project"],
    effect: "schedule",
    group: "projects",
    version: 2,
    since: "2026-11-06",
    samples: [{ say: "schedule the final inspection on the Smith kitchen for the 20th and make the checklist", args: { projectId: "proj_1", name: "Final inspection", date: "2026-11-20", haveReady: "Permit card on site\nAccess to the electrical panel\nSmoke and CO detectors in and working\nGFCI outlets at the counters\nAnti-tip bracket on the range", stage: null, isFinal: true, gate: null } }],
  },
  description:
    "Add an inspection to a project: the name (Rough-in, Framing, Final inspection), the day (YYYY-MM-DD or null), what to have ready for the inspector (write the list yourself when asked for a checklist — one item per line, for the trade), the stage it belongs to (or null), isFinal for the final inspection, and gate (null = on when a stage is named: the stage cannot be marked done until this passes; false when the stage need not wait). Use for: rough-in Tuesday, schedule the final inspection, create the final inspection checklist.",
  params: z.object({ projectId: ID, name: z.string().min(2).max(120), date: DAY.nullable(), haveReady: z.string().max(1000).nullable(), stage: z.string().max(80).nullable(), isFinal: z.boolean(), gate: z.boolean().nullable() }),
  payload: z.object({ projectId: ID, name: z.string(), date: DAY.nullable(), haveReady: z.string().nullable(), stageId: ID.nullable(), isFinal: z.boolean(), gate: z.boolean(), words: z.string() }),
  async plan({ actor }, args) {
    const p = await projectById(actor.organizationId, args.projectId);
    if (!p) return { ok: false, say: "I couldn't find that project." };
    let stageId: string | null = null;
    let stageName: string | null = null;
    if (args.stage) {
      const read = await stagesOf(p.id);
      const st = stageNamed(read.stages, args.stage);
      if (st) {
        stageId = st.id;
        stageName = st.name;
      }
    }
    const items = (args.haveReady ?? "").split(/\n|;/).map((x) => x.trim()).filter(Boolean);
    const gate = stageId ? args.gate !== false : false;
    const words = `Book "${args.name}" on ${p.name}${args.date ? ` for ${dayLabelLong(args.date)}` : ", no day yet"}${stageName ? `, on ${stageName}` : ""}${args.isFinal ? " — the final inspection" : ""}`;
    const ready = items.length ? ` Have ready: ${items.join("; ")}.` : "";
    const holds = gate && stageName ? ` ${stageName} cannot be marked done until it passes.` : "";
    return { ok: true, payload: { projectId: p.id, name: args.name, date: args.date, haveReady: items.length ? items.join("\n") : null, stageId, isFinal: args.isFinal, gate, words }, readback: `${words}?${ready}${holds}` };
  },
  async execute({ actor }, payload) {
    const r = await addInspection(actor.organizationId, payload.projectId, { name: payload.name, date: payload.date, readyNote: payload.haveReady, stageId: payload.stageId, isFinal: payload.isFinal, gate: payload.gate }, actor.userId);
    return { say: `Done — ${payload.words.replace(/^Book /, "booked ")}. It is on the timeline${payload.date ? " and the crew sees what to have ready on the job the day before" : ""}.`, result: r };
  },
};

type ResultArgs = { projectId: string; inspection: string; result: "PASSED" | "FAILED"; note: string | null };
type ResultPayload = { inspectionId: string; result: "PASSED" | "FAILED"; note: string | null; words: string };

const inspectionResult: WriteTool<ResultArgs, ResultPayload> = {
  kind: "write",
  name: "inspection_result",
  need: "projects.write",
  card: {
    label: "Inspection result",
    purpose: "Record that an inspection passed or failed, with what the inspector said.",
    when: "'Rough-in passed', 'we failed the framing inspection — they want blocking at the stairs', 'final inspection passed': inspection_result with the project id, the inspection as said, PASSED or FAILED and the note.",
    objects: ["project"],
    effect: "record",
    group: "projects",
    version: 1,
    since: "2026-11-06",
    samples: [{ say: "the rough-in on the Smith kitchen passed", args: { projectId: "proj_1", inspection: "rough-in", result: "PASSED", note: null } }],
  },
  description: "Record an inspection's result on a project: PASSED or FAILED, with the inspector's note when there is one. Give the project id and the inspection as said. Use for: rough-in passed, we failed framing — they want blocking at the stairs, final inspection passed.",
  params: z.object({ projectId: ID, inspection: z.string().min(2).max(120), result: z.enum(["PASSED", "FAILED"]), note: z.string().max(1000).nullable() }),
  payload: z.object({ inspectionId: ID, result: z.enum(["PASSED", "FAILED"]), note: z.string().nullable(), words: z.string() }),
  async plan({ actor }, args) {
    const p = await projectById(actor.organizationId, args.projectId);
    if (!p) return { ok: false, say: "I couldn't find that project." };
    const rows = await db.projectInspection.findMany({ where: { projectId: p.id }, orderBy: [{ result: "desc" }, { date: "asc" }], select: { id: true, name: true, result: true, date: true, isFinal: true } });
    if (!rows.length) return { ok: false, say: `${p.name} has no inspections booked — add_inspection first.` };
    const q = args.inspection.toLowerCase();
    const terms = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !["the", "inspection", "passed", "failed"].includes(w));
    const score = (name: string) => terms.reduce((n, t) => n + (name.toLowerCase().includes(t) ? t.length : 0), 0) + (q.includes("final") && name.toLowerCase().includes("final") ? 10 : 0);
    const pending = rows.filter((r) => r.result === "PENDING");
    const pick = [...rows].sort((a, b) => score(b.name) - score(a.name) || Number(b.result === "PENDING") - Number(a.result === "PENDING"))[0];
    const row = score(pick.name) > 0 ? pick : pending.length === 1 ? pending[0] : null;
    if (!row) return { ok: false, say: `Which inspection? ${p.name} has: ${rows.map((r) => `${r.name} (${r.result.toLowerCase()})`).join(", ")}.` };
    const words = `${row.name} on ${p.name} ${args.result === "PASSED" ? "passed" : "failed"}${args.note ? ` — "${args.note}"` : ""}`;
    return { ok: true, payload: { inspectionId: row.id, result: args.result, note: args.note, words }, readback: `Record that ${words}?${row.isFinal && args.result === "PASSED" ? " That is the final inspection — the finish line moves to the client's sign-off." : ""}` };
  },
  async execute({ actor }, payload) {
    const r = await recordInspection(actor.organizationId, payload.inspectionId, payload.result, payload.note, actor.userId);
    const gate = r.gate && r.stageName ? (payload.result === "PASSED" ? ` ${r.stageName} can be marked done now.` : ` ${r.stageName} stays open until the re-inspection passes.`) : "";
    return { say: `Done — ${payload.words}.${gate}${payload.result === "FAILED" ? " Book the re-inspection when the fix is in (add_inspection or Re-inspect on the project)." : ""}`, result: r };
  },
};

// ── the punch list ───────────────────────────────────────────────────────────

type PunchArgs = { projectId: string; items: string[] };
type PunchPayload = { projectId: string; items: string[]; projectName: string };

const addPunch: WriteTool<PunchArgs, PunchPayload> = {
  kind: "write",
  name: "add_punch_items",
  need: "projects.write",
  card: {
    label: "Punch list",
    purpose: "Add items to a project's punch list — the small things left at the end.",
    when: "'Add to the punch list: touch up the paint by the pantry, caulk the tub spout', 'punch item on Smith's: adjust the closet door': add_punch_items with the project id and one item per entry.",
    objects: ["project"],
    effect: "record",
    group: "projects",
    version: 1,
    since: "2026-11-06",
    samples: [{ say: "add to the Smith kitchen punch list: touch up the paint by the pantry and caulk the sink", args: { projectId: "proj_1", items: ["Touch up the paint by the pantry", "Caulk the sink"] } }],
  },
  description: "Add items to a project's punch list, one per entry. The crew ticks them from the job's board with an after photo; the office from the project. Use for: add to the punch list, punch item on Smith's.",
  params: z.object({ projectId: ID, items: z.array(z.string().min(2).max(500)).min(1).max(40) }),
  payload: z.object({ projectId: ID, items: z.array(z.string()), projectName: z.string() }),
  async plan({ actor }, args) {
    const p = await projectById(actor.organizationId, args.projectId);
    if (!p) return { ok: false, say: "I couldn't find that project." };
    return { ok: true, payload: { projectId: p.id, items: args.items, projectName: p.name }, readback: `Add ${args.items.length} item${args.items.length === 1 ? "" : "s"} to the punch list on ${p.name}: ${args.items.join("; ")}?` };
  },
  async execute({ actor }, payload) {
    const r = await addPunchItems(actor.organizationId, payload.projectId, payload.items, null, actor.userId);
    const open = await db.punchItem.count({ where: { projectId: payload.projectId, doneAt: null } });
    return { say: `Done — ${r.added} on the punch list for ${payload.projectName}, ${open} open in all.`, result: r };
  },
};

// ── the finish line ──────────────────────────────────────────────────────────

const finishLine: ReadTool<{ projectId: string | null; query: string | null }> = {
  kind: "read",
  name: "finish_line",
  need: "projects.read",
  card: {
    label: "Finish line",
    purpose: "What is left to close a project out: punch list, final inspection, sign-off, final payment, review, warranty, archive.",
    when: "'What's left to finish Smith's', 'is the kitchen closed out', 'did they sign off', 'what's on the punch list': finish_line with the project id or words from its name.",
    objects: ["project", "money"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-06",
    samples: [{ say: "what's left to finish the Smith kitchen?", args: { projectId: null, query: "Smith kitchen" } }],
  },
  description: "The seven steps to the end of a project, each done or not, with what is left: the punch list (its open items), the final inspection, the client's sign-off, the final payment (what is owed), the review, the warranty, finished and archived. Give the project id or words from its name. Use for: what's left to finish, is it closed out, did they sign off, what's on the punch list.",
  params: z.object({ projectId: ID.nullable(), query: z.string().max(80).nullable() }),
  async run({ actor }, args) {
    const r = await projectNamed(actor.organizationId, args);
    if ("several" in r) return { several: r.several, ask: "Which one?" };
    if (!("one" in r) || !r.one) return { error: "No project matched. Try the client's name or the project's number." };
    const f = await finishOf(actor.organizationId, r.one.id);
    const steps = finishSteps(f);
    return {
      id: r.one.id,
      name: r.one.name,
      status: f.status,
      next: steps.find((s) => s.state === "next")?.label ?? null,
      steps: steps.map((s) => ({ step: s.label, state: s.state, detail: s.detail })),
      punchOpen: f.punchItems.filter((p) => !p.done).map((p) => p.note),
      finalInspection: f.finalInspection,
      owed: f.payment.owed,
      reviewLink: f.reviewHref,
    };
  },
};

type StepArgs = { projectId: string; step: "sign_off" | "warranty" | "ask_review" | "finish" | "archive"; name: string | null; until: string | null };
type StepPayload = StepArgs & { projectName: string; words: string };

const finishStep: WriteTool<StepArgs, StepPayload> = {
  kind: "write",
  name: "finish_step",
  need: "projects.write",
  card: {
    label: "Finish-line step",
    purpose: "Record a finish-line step: the client signed off, the warranty date, ask for the review, finished, archived.",
    when: "'Smith signed off', 'warranty on the kitchen for a year', 'ask Smith for a review', 'the deck is finished', 'archive the Smith project': finish_step with the project id and the step — sign_off (name = who), warranty (until = a date, or null for twelve months from today), ask_review, finish, archive.",
    objects: ["project", "client"],
    effect: "record",
    group: "projects",
    version: 1,
    since: "2026-11-06",
    samples: [{ say: "the Smiths signed off on the kitchen", args: { projectId: "proj_1", step: "sign_off", name: "The Smiths", until: null } }],
  },
  description:
    "A finish-line step on a project: sign_off (the client signed off; name = who), warranty (until = the last day, YYYY-MM-DD, or null for twelve months from today), ask_review (the review request goes to the client), finish (the project is COMPLETED — its jobs must be closed), archive (off the list). Give the project id. Use for: they signed off, warranty for a year, ask for a review, the project is finished, archive it.",
  params: z.object({ projectId: ID, step: z.enum(["sign_off", "warranty", "ask_review", "finish", "archive"]), name: z.string().max(120).nullable(), until: DAY.nullable() }),
  payload: z.object({ projectId: ID, step: z.enum(["sign_off", "warranty", "ask_review", "finish", "archive"]), name: z.string().nullable(), until: DAY.nullable(), projectName: z.string(), words: z.string() }),
  async plan({ actor }, args) {
    const p = await projectById(actor.organizationId, args.projectId);
    if (!p) return { ok: false, say: "I couldn't find that project." };
    const f = await finishOf(actor.organizationId, p.id);
    const today = localDayKey(new Date(), actor.timezone);
    let until = args.until;
    let words = "";
    switch (args.step) {
      case "sign_off":
        if (f.signedOffAt) return { ok: false, say: `${p.name} is already signed off${f.signedOffBy ? ` by ${f.signedOffBy}` : ""}.` };
        words = `Record that ${args.name ?? f.clientName ?? "the client"} signed off on ${p.name}`;
        break;
      case "warranty":
        until = until ?? warrantyDefault(today);
        words = `Set the warranty on ${p.name} to run until ${dayLabelLong(until)}`;
        break;
      case "ask_review":
        if (f.review?.askedAt) return { ok: false, say: `The review ask on ${p.name} already went out on ${dayLabelLong(f.review.askedAt.slice(0, 10))}.` };
        words = f.clientEmail ? `Email ${f.clientName ?? "the client"} the review request for ${p.name}` : `Make the review link for ${p.name} (no client email on file — you send it by hand)`;
        break;
      case "finish":
        if (f.status === "COMPLETED" || f.status === "ARCHIVED") return { ok: false, say: `${p.name} is already ${f.status === "ARCHIVED" ? "archived" : "finished"}.` };
        if (f.jobsOpen) return { ok: false, say: `${f.jobsOpen} job${f.jobsOpen === 1 ? " is" : "s are"} still open on ${p.name} — close ${f.jobsOpen === 1 ? "it" : "them"} first.` };
        words = `Mark ${p.name} finished`;
        break;
      case "archive":
        if (f.status === "ARCHIVED") return { ok: false, say: `${p.name} is archived already.` };
        words = `Archive ${p.name} — off the Projects list`;
        break;
    }
    const left = finishSteps(f).filter((s) => s.state !== "done" && s.key !== { sign_off: "signoff", warranty: "warranty", ask_review: "review", finish: "finish", archive: "finish" }[args.step]);
    return { ok: true, payload: { ...args, until, projectName: p.name, words }, readback: `${words}?${left.length ? ` Still open after that: ${left.map((s) => s.label.toLowerCase()).join(", ")}.` : ""}` };
  },
  async execute({ actor }, payload) {
    const org = actor.organizationId;
    switch (payload.step) {
      case "sign_off":
        await signOff(org, payload.projectId, payload.name, actor.userId);
        return { say: `Done — ${payload.projectName} is signed off${payload.name ? ` by ${payload.name}` : ""}.` };
      case "warranty":
        await setWarranty(org, payload.projectId, payload.until, actor.userId);
        return { say: `Done — the warranty on ${payload.projectName} runs until ${dayLabelLong(payload.until)}.` };
      case "ask_review": {
        const r = await askReview(org, payload.projectId, actor.userId);
        return { say: r.emailed ? `Done — the review request went to the client by email.` : `Done — the link is ready: /review/${r.publicToken}. No client email on file, so send it by hand.`, result: r };
      }
      case "finish":
        await finishProject(org, payload.projectId, actor.userId);
        return { say: `Done — ${payload.projectName} is finished. Archive it when you are done with it.` };
      case "archive":
        await archiveProjectRow(org, payload.projectId, actor.userId);
        return { say: `Done — ${payload.projectName} is archived.` };
    }
  },
};

export const TIMELINE_TOOLS = [moveStage, shiftTheRest, addInspectionTool, inspectionResult, addPunch, finishLine, finishStep];
