import "server-only";
// SELECTIONS FOR THE AI OPERATOR (2026-11-07, part 3 of the plan "Projects: Remodel and New construction") — "What's
// left to choose on the Bennett kitchen?", "the Bennetts picked the shaker cabinets from Pacific Cabinet Supply,
// $8,400", "add a tile selection to the Smith bath, due the 20th". One read and two writes, each a thin call into
// what the project's Selections card runs (lib/projectSelections): the Operator never works out a due day itself.

import { z } from "zod";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import { projectNamed, stageNamed } from "@/lib/assistant/projects";
import { stagesOf } from "@/lib/projectStages/server";
import { addSelection, chooseSelection, selectionsOf, type SelectionRow } from "@/lib/projectSelections/server";
import { allowanceWords, dayWordsLong, dollars, dueWords, leadDaysFor } from "@/lib/projectSelections/shared";

const ID = z.string().min(1).max(64);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The selection the person named: "the cabinets", "tile", "paint" — the best word overlap, an open one before a chosen one. */
export function selectionNamed(rows: readonly SelectionRow[], words: string): SelectionRow | null {
  const q = words.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  const terms = q.split(/\s+/).filter((w) => w.length > 2 && !["the", "and", "for", "selection", "chose", "chosen", "picked", "pick"].includes(w)).map((w) => w.replace(/s$/, ""));
  let best: { row: SelectionRow; score: number } | null = null;
  for (const row of rows) {
    const name = row.name.toLowerCase();
    let score = name === q.trim() ? 100 : 0;
    for (const t of terms) if (name.includes(t)) score += t.length;
    if (score > 0) score += row.state === "chosen" ? 0 : 1;
    if (score > 0 && (!best || score > best.score)) best = { row, score };
  }
  return best?.row ?? null;
}

const stateWords = (r: SelectionRow, today: string) => (r.state === "chosen" ? `chosen${r.chosenAt ? ` ${dayWordsLong(r.chosenAt.slice(0, 10))}` : ""}` : r.stageDone ? "its stage is done" : dueWords(r, today));

// ── read ─────────────────────────────────────────────────────────────────────

const selectionsTool: ReadTool<{ projectId: string; only: "open" | "late" | "chosen" | "all" | null }> = {
  kind: "read",
  name: "selections",
  need: "projects.read",
  card: {
    label: "Selections",
    purpose: "What the client still has to choose on a project — cabinets, tile, paint — by when, what is late, and what was chosen at what price against the allowance.",
    when: "'What's left to choose on the Bennett kitchen?', 'any selections late on Smith's?', 'what did they pick for the tile': selections with the project id (find it first) and only = open, late, chosen or all.",
    objects: ["project"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-07",
    samples: [{ say: "what's left to choose on the Bennett kitchen?", args: { projectId: "proj_1", only: "open" } }],
  },
  description:
    "A project's selections — what the client has to choose (cabinets, counters, tile, fixtures, flooring, paint), the day each is due (from the stage that needs it), which are late, and for the chosen ones what was picked, from whom, the price and how it sits against the allowance. Give the project id; only = open | late | chosen | all (null = all). Use for: what's left to choose, any selections late, what did they pick.",
  params: z.object({ projectId: ID, only: z.enum(["open", "late", "chosen", "all"]).nullable() }),
  async run({ actor }, args) {
    const p = await projectNamed(actor.organizationId, { projectId: args.projectId, query: null });
    if (!("one" in p) || !p.one) return { error: "I couldn't find that project." };
    const read = await selectionsOf(actor.organizationId, p.one.id);
    const only = args.only ?? "all";
    const rows = read.selections.filter((r) => (only === "open" ? r.state !== "chosen" && !r.stageDone : only === "late" ? r.state === "late" && !r.stageDone : only === "chosen" ? r.state === "chosen" : true));
    return {
      project: p.one.name,
      today: read.today,
      open: read.open,
      late: read.late,
      chosen: read.chosen,
      selections: rows.map((r) => ({
        name: r.name,
        stage: r.stageName,
        due: r.due,
        state: r.state,
        words: stateWords(r, read.today),
        allowance: r.allowance != null ? dollars(r.allowance) : null,
        chosen: r.chosen,
        vendor: r.vendor,
        price: r.price != null ? dollars(r.price) : null,
        againstAllowance: r.state === "chosen" ? allowanceWords(r.price, r.allowance) : null,
      })),
      note: rows.length ? undefined : read.selections.length ? `Nothing ${only === "all" ? "" : only} on ${p.one.name}.` : `${p.one.name} has no selections yet — a template adds the usual ones with its stages, or add_selection.`,
    };
  },
};

// ── the choice is in ─────────────────────────────────────────────────────────

type ChooseArgs = { projectId: string; selection: string; chosen: string | null; vendor: string | null; price: number | null };
type ChoosePayload = { selectionId: string; chosen: string | null; vendor: string | null; price: number | null; words: string };

const chooseSelectionTool: WriteTool<ChooseArgs, ChoosePayload> = {
  kind: "write",
  name: "choose_selection",
  need: "projects.write",
  card: {
    label: "Selection chosen",
    purpose: "Record a client's choice on a selection: what they picked, from whom, at what price — read against the allowance.",
    when: "'The Bennetts picked the shaker cabinets from Pacific Cabinet Supply, $8,400', 'tile chosen — Daltile Restore, $2,100', 'they went with the quartz': choose_selection with the project id (find it first), the selection's words and whatever was said of what, who and the price (null for the rest).",
    objects: ["project", "money"],
    effect: "record",
    group: "projects",
    version: 1,
    since: "2026-11-07",
    samples: [{ say: "the Bennetts picked the shaker cabinets from Pacific Cabinet Supply for $8,400", args: { projectId: "proj_1", selection: "cabinets", chosen: "Shaker cabinets", vendor: "Pacific Cabinet Supply", price: 8400 } }],
  },
  description:
    "Record that a selection on a project was chosen: the project id (find it first), the selection as said ('cabinets', 'the tile', 'paint'), what was picked, from whom and the price — each null when not said. The card shows it against the allowance and the project stops flagging it. Read back for a yes. Use for: they picked the shaker cabinets, tile chosen, they went with the quartz.",
  params: z.object({ projectId: ID, selection: z.string().min(2).max(120), chosen: z.string().max(500).nullable(), vendor: z.string().max(120).nullable(), price: z.number().min(0).max(10_000_000).nullable() }),
  payload: z.object({ selectionId: ID, chosen: z.string().nullable(), vendor: z.string().nullable(), price: z.number().nullable(), words: z.string() }),
  async plan({ actor }, args) {
    const p = await projectNamed(actor.organizationId, { projectId: args.projectId, query: null });
    if (!("one" in p) || !p.one) return { ok: false, say: "I couldn't find that project." };
    const read = await selectionsOf(actor.organizationId, p.one.id);
    if (!read.selections.length) return { ok: false, say: `${p.one.name} has no selections yet — add one first (add_selection).` };
    const row = selectionNamed(read.selections, args.selection);
    if (!row) return { ok: false, say: `Which selection? ${p.one.name} has: ${read.selections.map((r) => `${r.name} (${r.state === "chosen" ? "chosen" : "open"})`).join(", ")}.` };
    if (!args.chosen && !args.vendor && args.price == null) return { ok: false, say: `What did they pick for ${row.name.toLowerCase()} — the item, the supplier or the price?` };
    const against = allowanceWords(args.price, row.allowance);
    const words = `Mark "${row.name}" on ${p.one.name} chosen${args.chosen ? `: ${args.chosen}` : ""}${args.vendor ? ` from ${args.vendor}` : ""}${args.price != null ? `, ${dollars(args.price)}` : ""}`;
    return {
      ok: true,
      payload: { selectionId: row.id, chosen: args.chosen, vendor: args.vendor, price: args.price, words },
      readback: `${words}?${against ? ` That is ${against} (${dollars(row.allowance ?? 0)}).` : row.allowance == null && args.price != null ? " No allowance is set on it to compare." : ""}${row.state === "chosen" ? " It was marked chosen before — this replaces that." : ""}`,
    };
  },
  async execute({ actor }, payload) {
    const r = await chooseSelection(actor.organizationId, payload.selectionId, { chosen: payload.chosen, vendor: payload.vendor, price: payload.price }, actor.userId);
    const read = await selectionsOf(actor.organizationId, r.projectId);
    return { say: `Done — ${r.words}. ${read.open ? `${read.open} still to choose${read.late ? `, ${read.late} late` : ""}.` : "Every selection is in."}`, result: r };
  },
};

// ── add one ──────────────────────────────────────────────────────────────────

type AddArgs = { projectId: string; name: string; stage: string | null; dueBy: string | null; allowance: number | null };
type AddPayload = { projectId: string; name: string; stageId: string | null; leadDays: number; dueBy: string | null; allowance: number | null; words: string };

const addSelectionTool: WriteTool<AddArgs, AddPayload> = {
  kind: "write",
  name: "add_selection",
  need: "projects.write",
  card: {
    label: "Add a selection",
    purpose: "Put a choice the client has to make on a project: what, the stage that needs it (its due day follows from that), or a day, and an allowance.",
    when: "'Add a tile selection to the Smith bath', 'the Bennetts need to pick the lighting by the 20th, $1,500 allowance': add_selection with the project id (find it first), the name, the stage's words or null, a day (YYYY-MM-DD) or null, the allowance or null.",
    objects: ["project"],
    effect: "record",
    group: "projects",
    version: 1,
    since: "2026-11-07",
    samples: [{ say: "add a tile selection to the Smith bath, due the 20th, allowance $2,000", args: { projectId: "proj_1", name: "Tile", stage: null, dueBy: "2026-11-20", allowance: 2000 } }],
  },
  description:
    "Add a selection to a project — a choice the client has to make (Cabinets, Tile, Paint colors…): the project id (find it first), the name, the stage that needs it as said (or null; the due day then reads from that stage's first day less the usual lead time), or a due day (YYYY-MM-DD) of its own, and an allowance in dollars or null. Read back for a yes. Use for: add a tile selection, they need to pick the lighting by the 20th.",
  params: z.object({ projectId: ID, name: z.string().min(2).max(120), stage: z.string().max(80).nullable(), dueBy: DAY.nullable(), allowance: z.number().min(0).max(10_000_000).nullable() }),
  payload: z.object({ projectId: ID, name: z.string(), stageId: ID.nullable(), leadDays: z.number(), dueBy: DAY.nullable(), allowance: z.number().nullable(), words: z.string() }),
  async plan({ actor }, args) {
    const p = await projectNamed(actor.organizationId, { projectId: args.projectId, query: null });
    if (!("one" in p) || !p.one) return { ok: false, say: "I couldn't find that project." };
    let stageId: string | null = null;
    let stageName: string | null = null;
    if (args.stage) {
      const { stages } = await stagesOf(p.one.id);
      const st = stageNamed(stages, args.stage);
      if (!st) return { ok: false, say: `Which stage? ${p.one.name} has: ${stages.map((s) => s.name).join(", ")}.` };
      stageId = st.id;
      stageName = st.name;
    }
    const leadDays = leadDaysFor(args.name);
    const words = `Add a "${args.name}" selection to ${p.one.name}${stageName ? `, for ${stageName}` : ""}${args.dueBy ? `, due ${dayWordsLong(args.dueBy)}` : stageName ? ` (due ${leadDays} days before it starts)` : ""}${args.allowance != null ? `, allowance ${dollars(args.allowance)}` : ""}`;
    return { ok: true, payload: { projectId: p.one.id, name: args.name, stageId, leadDays, dueBy: args.dueBy, allowance: args.allowance, words }, readback: `${words}?${!stageName && !args.dueBy ? " No stage or day was given, so it will have no due day until one is set." : ""}` };
  },
  async execute({ actor }, payload) {
    const r = await addSelection(actor.organizationId, payload.projectId, { name: payload.name, stageId: payload.stageId, leadDays: payload.leadDays, dueBy: payload.dueBy, allowance: payload.allowance }, actor.userId);
    return { say: `Done — ${payload.words.replace(/^Add /, "added ")}. It is on the project's Selections card; the list flags it if its day passes unchosen.`, result: r };
  },
};

export const SELECTION_TOOLS = [selectionsTool, chooseSelectionTool, addSelectionTool] as const;
