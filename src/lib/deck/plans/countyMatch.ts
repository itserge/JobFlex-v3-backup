// THE COUNTY'S REQUIREMENTS, MATCHED TO THE SET (2026-11-09, the plan set's Edit, part 2). Owner: "when the permits
// already are ready … he should have an option to upload his file or just a text of what their specific county or
// city wants to see … and it will remodify that current permit set and drawings … into their requirements."
//
// The model (lib/deck/countyRequirements) reads the department's checklist against a summary of the set and answers,
// for each thing the department asks for: it is ON THE SET (and where), JobFlex can ADD it (a design figure, a
// general note, a card on a sheet, a sheet, the sheet size; a sheet or card taken out only when the department says
// it does not want it), or it is the contractor's to do (a change to the design — never made here — a document to
// get or sign, a fact about the site). Everything the model says is checked here against the set before it is shown:
// a card or sheet it names must exist, a figure must be a figure, a structural change is always the contractor's.
// Nothing is applied until the contractor ticks it and presses Apply; applied, each change is an ordinary edit.
//
// Pure: no model, no database, no React.

import { z } from "zod";
import { cleanCardHtml, isOut, newEditId, type AddedCard, type KeptCheck, type SetEdits } from "./edits";

/* ── What the model is told about the set ──────────────────────────────── */
export interface SetCard {
  /** "<sheet id>/<key>", as the edits name it. */
  id: string;
  /** The sheet's edit id ("foundation", "extra:<id>"). */
  sheet: string;
  sheetNo: string;
  label: string;
  drawing: boolean;
  /** A card can follow it (a text card in a column, not a drawing or a title). */
  addable: boolean;
  /** Most departments want it (lib: the card's own heads-up). */
  need: boolean;
  /** Its words, folded and cut. */
  text: string;
}
export interface SetSheet {
  id: string;
  no: string;
  name: string;
  out: boolean;
  need: boolean;
}
export interface SetSummary {
  set: "permit" | "crew";
  sheets: SetSheet[];
  cards: SetCard[];
  /** The design figures the set prints, in words ("Wind 115 mph (ASCE 7) · Frost 12 in. · …"). */
  figures: string;
  paper: string;
  place: string;
}

export const FIGURE_FIELDS = ["department", "edition", "windMph", "sdc", "frostIn", "groundSnowPsf", "termite", "weathering"] as const;
export type FigureField = (typeof FIGURE_FIELDS)[number];
const FIGURE_WORDS: Record<FigureField, string> = {
  department: "the building department's name",
  edition: "the code edition",
  windMph: "the wind speed",
  sdc: "the seismic design category",
  frostIn: "the frost line",
  groundSnowPsf: "the ground snow load",
  termite: "the termite risk",
  weathering: "the weathering",
};

/* ── What the model answers ────────────────────────────────────────────── */
export const ModelCheck = z.object({
  department: z.string(),
  level: z.enum(["city", "county", "state", "unknown"]),
  place: z.string(),
  about: z.string(),
  items: z.array(
    z.object({
      need: z.string(),
      quote: z.string(),
      status: z.enum(["on_set", "add", "you"]),
      where: z.string(),
      why: z.string(),
      action: z.object({
        kind: z.enum(["none", "note", "card", "sheet", "remove_card", "remove_sheet", "rename_sheet", "replace_card", "figure", "paper", "design"]),
        sheet: z.string(),
        after: z.string(),
        card: z.string(),
        title: z.string(),
        lines: z.array(z.string()),
        field: z.string(),
        value: z.string(),
      }),
    }),
  ),
});
export type ModelCheck = z.infer<typeof ModelCheck>;

/* ── What the contractor reviews ───────────────────────────────────────── */
export type CheckAction =
  | { kind: "note"; text: string }
  | { kind: "card"; sheet: string; after: string | null; title: string; lines: string[] }
  | { kind: "sheet"; title: string; lines: string[] }
  | { kind: "remove_card"; card: string }
  | { kind: "remove_sheet"; sheet: string }
  | { kind: "rename_sheet"; sheet: string; title: string }
  /** The contractor asked for a card's words to change: its heading and lines, in place of the studio's. */
  | { kind: "replace_card"; card: string; title: string; lines: string[] }
  | { kind: "figure"; field: FigureField; value: string | number }
  | { kind: "paper"; paper: "B" | "C" | "D" };

export interface CheckItem {
  id: string;
  need: string;
  quote: string;
  status: "on_set" | "add" | "you";
  /** The card or sheet that shows it (on the set), or that the change lands on. */
  where: string | null;
  whereLabel: string | null;
  why: string;
  action: CheckAction | null;
  /** A change to the design: the contractor makes it in the studio. */
  design: boolean;
  /** Ticked to start with (a card or sheet most departments want, taken out, starts unticked). */
  on: boolean;
  /** The change, in words, for the review. */
  change: string;
}
export interface CountyCheck {
  department: string;
  level: "city" | "county" | "state" | "unknown";
  place: string;
  about: string;
  items: CheckItem[];
}

const cut = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const PAPER_WORDS: Record<"B" | "C" | "D", string> = { B: "11 × 17", C: "18 × 24", D: "24 × 36" };

/** A figure's value as the jurisdiction panel takes it, or null when it is not one. */
export function figureValue(field: FigureField, raw: string): string | number | null {
  const v = cut(raw, 80);
  if (!v) return null;
  const num = (lo: number, hi: number) => {
    const m = /(\d+(?:\.\d+)?)/.exec(v.replace(/,/g, ""));
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
  };
  switch (field) {
    case "windMph":
      return num(70, 250);
    case "frostIn":
      return num(0, 120);
    case "groundSnowPsf":
      return num(0, 400);
    case "sdc": {
      const m = /\b(A|B|C|D0|D1|D2|D|E|F)\b/i.exec(v.toUpperCase());
      return m ? m[1].toUpperCase() : null;
    }
    default:
      return v;
  }
}
const figureWords = (field: FigureField, value: string | number) =>
  field === "windMph" ? `${value} mph` : field === "frostIn" ? `${value} in.` : field === "groundSnowPsf" ? `${value} psf` : String(value);

/**
 * The model's answer checked against the set: what it names must be there, a figure must read as one, a card's words
 * are cut to a card's size; what cannot be placed becomes the contractor's to do, and a change to the design is
 * always theirs.
 */
export function checkRead(read: ModelCheck, set: SetSummary, opts: { asked?: boolean } = {}): CountyCheck {
  const cards = new Map(set.cards.map((c) => [c.id, c]));
  const sheets = new Map(set.sheets.map((s) => [s.id, s]));
  const sheetOf = (raw: string) => {
    const t = cut(raw, 60).replace(/^sheet:/, "");
    return sheets.get(t) ?? set.sheets.find((s) => s.no.toLowerCase() === t.toLowerCase()) ?? null;
  };
  const items: CheckItem[] = [];
  const notes = new Set<string>();
  for (const [i, it] of read.items.slice(0, 60).entries()) {
    const need = cut(it.need, 160) || cut(it.quote, 160);
    if (!need) continue;
    const base = { id: `i${i}`, need, quote: cut(it.quote, 240), why: cut(it.why, 240) };
    const a = it.action;
    const lines = (a.lines ?? []).map((l) => cut(l, 300)).filter(Boolean).slice(0, 12);
    const title = cut(a.title, 80);
    const you = (why: string, design = false): CheckItem => ({ ...base, status: "you", where: null, whereLabel: null, why: base.why || why, action: null, design, on: false, change: "" });
    if (it.status === "on_set") {
      const c = cards.get(cut(it.where, 160));
      const s = c ? null : sheetOf(it.where);
      items.push({ ...base, status: "on_set", where: c?.id ?? (s ? `sheet:${s.id}` : null), whereLabel: c ? `${c.sheetNo} · ${c.label}` : s ? `${s.no} · ${s.name}` : null, action: null, design: false, on: false, change: "" });
      continue;
    }
    if (it.status === "you" || a.kind === "design" || a.kind === "none") {
      items.push(you("", a.kind === "design"));
      continue;
    }
    switch (a.kind) {
      case "figure": {
        const field = (FIGURE_FIELDS as readonly string[]).includes(a.field) ? (a.field as FigureField) : null;
        const value = field ? figureValue(field, a.value) : null;
        if (!field || value == null) {
          items.push(you("Type it into The jurisdiction above the sheets — JobFlex couldn't read the figure."));
          break;
        }
        items.push({ ...base, status: "add", where: null, whereLabel: "The jurisdiction · the sheets' design criteria", action: { kind: "figure", field, value }, design: false, on: true, change: `Sets ${FIGURE_WORDS[field]} to ${figureWords(field, value)} (the cover's design criteria and the checks follow).` });
        break;
      }
      case "paper": {
        const p = /36|\bD\b/i.test(a.value) ? "D" : /18|\bC\b/i.test(a.value) ? "C" : /11|17|\bB\b/i.test(a.value) ? "B" : null;
        if (!p) {
          items.push(you("Pick the sheet size under The sheets above the set."));
          break;
        }
        items.push({ ...base, status: "add", where: null, whereLabel: "The sheets · sheet size", action: { kind: "paper", paper: p }, design: false, on: true, change: `Prints the set on ${PAPER_WORDS[p]} sheets.` });
        break;
      }
      case "note": {
        const text = cut(lines[0] || title || need, 300);
        if (notes.has(text.toLowerCase())) continue;
        notes.add(text.toLowerCase());
        items.push({ ...base, status: "add", where: null, whereLabel: "G-002 · General notes (the department's own)", action: { kind: "note", text }, design: false, on: true, change: `Adds a general note: “${text}”` });
        break;
      }
      case "card": {
        const after = cards.get(cut(a.after, 160));
        const sheet = sheetOf(a.sheet) ?? (after ? sheets.get(after.sheet) ?? null : null);
        if (!sheet || sheet.out || !(lines.length || title)) {
          items.push(you("Add it by hand — JobFlex couldn't tell where it goes."));
          break;
        }
        const anchor = after && after.sheet === sheet.id && after.addable ? after.id : null;
        items.push({ ...base, status: "add", where: `sheet:${sheet.id}`, whereLabel: `${sheet.no} · ${sheet.name}`, action: { kind: "card", sheet: sheet.id, after: anchor, title: title || need.slice(0, 80), lines }, design: false, on: true, change: `Adds a card “${title || need.slice(0, 80)}” on ${sheet.no} ${sheet.name}.` });
        break;
      }
      case "sheet": {
        if (!(lines.length || title)) {
          items.push(you("Add it by hand — JobFlex couldn't read what goes on it."));
          break;
        }
        items.push({ ...base, status: "add", where: null, whereLabel: "A new sheet", action: { kind: "sheet", title: title || need.slice(0, 80), lines }, design: false, on: true, change: `Adds a sheet “${title || need.slice(0, 80)}”.` });
        break;
      }
      case "remove_card": {
        const c = cards.get(cut(a.card, 160)) ?? cards.get(cut(it.where, 160));
        if (!c) {
          items.push(you("Take it out by hand in the Edit — JobFlex couldn't find it."));
          break;
        }
        items.push({ ...base, status: "add", where: c.id, whereLabel: `${c.sheetNo} · ${c.label}`, action: { kind: "remove_card", card: c.id }, design: false, on: !!opts.asked || !c.need, change: `Takes out “${c.label}” on ${c.sheetNo}.${c.need ? " Most departments ask for it — make sure yours doesn't." : ""}` });
        break;
      }
      case "remove_sheet": {
        const s = sheetOf(a.sheet) ?? sheetOf(it.where);
        if (!s || s.out) {
          items.push(you("Untick the sheet in the Edit — JobFlex couldn't find it."));
          break;
        }
        items.push({ ...base, status: "add", where: `sheet:${s.id}`, whereLabel: `${s.no} · ${s.name}`, action: { kind: "remove_sheet", sheet: s.id }, design: false, on: !!opts.asked || !s.need, change: `Takes ${s.no} ${s.name} out of the set.${s.need ? " Most departments ask for it — make sure yours doesn't." : ""}` });
        break;
      }
      case "replace_card": {
        const c = cards.get(cut(a.card, 160)) ?? cards.get(cut(it.where, 160));
        if (!c || c.drawing || !lines.length) {
          items.push(you("Change its words by hand in the Edit — JobFlex couldn't place them."));
          break;
        }
        const head = title || c.label;
        items.push({ ...base, status: "add", where: c.id, whereLabel: `${c.sheetNo} · ${c.label}`, action: { kind: "replace_card", card: c.id, title: head, lines }, design: false, on: true, change: `Rewrites “${c.label}” on ${c.sheetNo}: ${lines.slice(0, 2).join(" · ").slice(0, 140)}${lines.length > 2 ? " …" : ""}` });
        break;
      }
      case "rename_sheet": {
        const s = sheetOf(a.sheet);
        if (!s || !title) {
          items.push(you("Rename the sheet in the Edit."));
          break;
        }
        items.push({ ...base, status: "add", where: `sheet:${s.id}`, whereLabel: `${s.no} · ${s.name}`, action: { kind: "rename_sheet", sheet: s.id, title }, design: false, on: true, change: `Renames ${s.no} to “${title}”.` });
        break;
      }
      default:
        items.push(you(""));
    }
  }
  return { department: cut(read.department, 120), level: read.level, place: cut(read.place, 120), about: cut(read.about, 300), items };
}

/* ── Applying the ticked changes ───────────────────────────────────────── */
const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A card of words, in the sheets' own classes (as tokens): a heading and its lines. */
export function wordsCardHtml(title: string, lines: string[]): string {
  const body = lines.length ? `<ol class="p:notes">${lines.map((l) => `<li>${escHtml(l)}</li>`).join("")}</ol>` : "";
  return cleanCardHtml(`<div class="p:h">${escHtml(title)}</div>${body}`);
}

export interface ApplyResult {
  edits: SetEdits;
  /** The general notes to add to the department's own (the jurisdiction panel's, on G-002). */
  notes: string[];
  figures: Partial<Record<FigureField, string | number>>;
  paper: "B" | "C" | "D" | null;
  /** How many changes landed. */
  count: number;
}

/**
 * The ticked changes as edits: cards after the card named or the last card in a column on their sheet (in a row, in
 * the order ticked), on a sheet "County requirements" when their sheet has no column; sheets added; cards and sheets
 * taken out; names. Notes, figures and the sheet size go back to the caller for the jurisdiction panel.
 */
export function applyChecked(items: CheckItem[], e: SetEdits, set: Pick<SetSummary, "cards" | "sheets">, place: string, wasOf: (cardId: string) => string = () => ""): ApplyResult {
  const out: SetEdits = { ...e, hidden: [...e.hidden], added: [...e.added], sheets: [...e.sheets], names: { ...e.names }, cards: { ...e.cards } };
  const notes: string[] = [];
  const figures: ApplyResult["figures"] = {};
  let paper: ApplyResult["paper"] = null;
  let count = 0;
  // The last card each new one follows, by its anchor — so several cards for one sheet stay in order.
  const tail = new Map<string, string>();
  const lastOn = (sheet: string) => [...set.cards].reverse().find((c) => c.sheet === sheet && c.addable)?.id ?? null;
  let spare: string | null = null;
  const spareSheet = () => {
    if (spare) return spare;
    const id = newEditId("sh");
    out.sheets.push({ id, name: `${place ? `${place} — ` : ""}requirements`.slice(0, 80).replace(/^r/, "R") });
    spare = `sheet:extra:${id}`;
    return spare;
  };
  const addAfter = (anchor: string, html: string) => {
    const id = newEditId("add");
    out.added.push({ id, after: tail.get(anchor) ?? anchor, html } satisfies AddedCard);
    tail.set(anchor, id);
  };
  for (const it of items) {
    const a = it.action;
    if (it.status !== "add" || !a) continue;
    count++;
    switch (a.kind) {
      case "note":
        notes.push(a.text);
        break;
      case "figure":
        figures[a.field] = a.value;
        break;
      case "paper":
        paper = a.paper;
        break;
      case "card": {
        const anchor = a.after ?? lastOn(a.sheet) ?? spareSheet();
        addAfter(anchor, wordsCardHtml(a.title, a.lines));
        break;
      }
      case "sheet": {
        const id = newEditId("sh");
        out.sheets.push({ id, name: a.title });
        addAfter(`sheet:extra:${id}`, wordsCardHtml(a.title, a.lines));
        break;
      }
      case "remove_card":
        if (!isOut(out, a.card)) out.hidden.push(a.card);
        break;
      case "remove_sheet":
        if (!isOut(out, `sheet:${a.sheet}`)) out.hidden.push(`sheet:${a.sheet}`);
        break;
      case "rename_sheet":
        out.names[a.sheet] = a.title;
        break;
      case "replace_card":
        // An edit like one typed in the Edit: the design's own words fingerprinted, so a later change to them shows.
        out.cards[a.card] = { html: wordsCardHtml(a.title, a.lines), was: out.cards[a.card]?.was || wasOf(a.card) };
        break;
    }
  }
  return { edits: out, notes, figures, paper, count };
}

/* ── The check kept with the set: what it found, and the contractor's to-do ── */
export function keptCheck(c: CountyCheck, appliedIds: Set<string>, at: string, from: KeptCheck["from"], sources: KeptCheck["sources"]): KeptCheck {
  return {
    place: c.place,
    department: c.department,
    at,
    from,
    sources: sources.slice(0, 8),
    onSet: c.items.filter((i) => i.status === "on_set").length,
    added: c.items.filter((i) => i.status === "add" && appliedIds.has(i.id)).length,
    todo: c.items
      .filter((i) => i.status === "you" || (i.status === "add" && !appliedIds.has(i.id)))
      .slice(0, 30)
      .map((i) => ({ need: i.need, why: i.status === "you" ? i.why : "Not applied — add it by hand if the department needs it.", design: i.design })),
  };
}

/* ── The set, told to the model ───────────────────────────────────────── */
export function setWords(s: SetSummary): string {
  const sheets = s.sheets.map((x) => `${x.no} · id ${x.id} · ${x.name}${x.out ? " (taken out)" : ""}`).join("\n");
  const cards = s.cards.map((c) => `${c.id} · ${c.sheetNo} · ${c.label}${c.drawing ? " (a drawing)" : ""}: ${c.text}`).join("\n");
  return [
    `THE ${s.set === "crew" ? "CONSTRUCTION" : "PERMIT"} SET JOBFLEX DREW${s.place ? ` (for ${s.place})` : ""}, ${s.paper} sheets.`,
    `THE DESIGN FIGURES IT PRINTS: ${s.figures || "—"}`,
    `ITS SHEETS (number · id · name):\n${sheets}`,
    `ITS CARDS (id · sheet · what it is: its words, cut):\n${cards}`,
  ].join("\n\n").slice(0, 60_000);
}

/** The words a kept checklist is read again from, for the next deck in the same county. */
export function requirementsWords(c: CountyCheck): string {
  return [`${c.department || c.place}${c.place && c.department ? ` (${c.place})` : ""} — what it asks to see with a deck permit:`, ...c.items.map((i, k) => `${k + 1}. ${i.need}${i.quote ? ` — “${i.quote}”` : ""}`)].join("\n").slice(0, 30_000);
}

/** Where a county's requirements are kept for a company: the state, the county, the city when the city issues its own. */
export function placeKey(state: string, county: string, city?: string | null): string | null {
  const slug = (t: string | null | undefined) => (t ?? "").toLowerCase().replace(/\bcounty\b/g, "").replace(/[^a-z0-9]+/g, "");
  const st = slug(state).slice(0, 2);
  const co = slug(county).slice(0, 40);
  if (st.length !== 2 || co.length < 2) return null;
  const ci = slug(city).slice(0, 40);
  return ci ? `${st}:${co}:${ci}` : `${st}:${co}`;
}
