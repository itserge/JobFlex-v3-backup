// THE CONTRACTOR'S OWN EDITS TO THE PLAN SET (2026-11-09). Owner, after a
// contractor in Tennessee found the permit set "too complicated, too much
// information": an Edit button at the very top; in it every card on every
// sheet can be deleted, or its text changed — words taken out, others added —
// cards added, whole sheets taken out or added. The set as drawn stays the
// default; the edits are kept on top of it, by the property, like the site
// plan (lib/deck/planEditsStore).
//
// A card is a block of a sheet — a table, a notes list, a drawing with its
// title — named "<sheet kind>/<key>" (the kind, not the sheet's number: the
// numbers follow the design). An edited card keeps its own words as a small
// piece of HTML, cleaned here to a short list of tags (no attributes but the
// class tokens and a cell's span), and the fingerprint of the design's own
// words when it was edited: when the design changes those words later — a
// bigger beam, another stair — the card says so instead of printing the old
// figures quietly. Drawings are never stored: their lines come from the design.
//
// Pure: no React, no database.

import type { PlanSheet } from "./sheets";

export type PlanSetName = "permit" | "crew";

export interface CardEdit {
  /** The card's words as edited: cleaned HTML, its classes as tokens ("p:h"). */
  html: string;
  /** The fingerprint of the design's own words for this card when it was edited (fingerprint()). */
  was: string;
  /**
   * It came from the contractor's template (templateFrom): typed on another deck, so it shows on this one only where
   * the design's own words are the same as the ones it was typed over (`was`) — a table of another deck's sizes never
   * prints here.
   */
  tpl?: boolean;
}
export interface AddedCard {
  id: string;
  /** The card it follows ("<kind>/<key>" or another added card's id), or "sheet:<sheet id>" for the top of a sheet. */
  after: string;
  html: string;
}
export interface AddedSheet {
  id: string;
  name: string;
}
export interface SetEdits {
  /** Cards ("<kind>/<key>") and sheets ("sheet:<sheet id>") taken out. */
  hidden: string[];
  cards: Record<string, CardEdit>;
  added: AddedCard[];
  /** Sheets the contractor added (blank to start, cards on them). */
  sheets: AddedSheet[];
  /** Sheet names typed over the set's own, by sheet id. */
  names: Record<string, string>;
  /** The last check against the county's requirements (lib/deck/plans/countyMatch): what it found, what is left to do. */
  check?: KeptCheck | null;
  /** The Simple set (the permit set only): SIMPLE_OUT taken out without writing them into `hidden`. */
  simple?: boolean;
  /** What the contractor brought back out of the Simple set's list. */
  shown?: string[];
  /** The contractor's template this set started from (lib/deck/planTemplatesStore), for the panel's words. */
  tpl?: { id: string; name: string } | null;
}
export interface KeptCheck {
  place: string;
  department: string;
  /** ISO time of the check. */
  at: string;
  onSet: number;
  added: number;
  /** Where the requirements came from. */
  from: "upload" | "paste" | "online" | "kept" | "ask";
  sources: Array<{ title: string; url: string }>;
  todo: Array<{ need: string; why: string; design: boolean }>;
}
export interface PlanEdits {
  v: 1;
  permit: SetEdits;
  crew: SetEdits;
}

export const MAX_CARD_HTML = 40_000;
export const MAX_EDITS_JSON = 400_000;
const MAX_ADDED = 80;
const MAX_SHEETS = 12;
const MAX_NAME = 80;

export const emptySetEdits = (): SetEdits => ({ hidden: [], cards: {}, added: [], sheets: [], names: {}, check: null, simple: false, shown: [], tpl: null });

/* ── The Simple set (2026-11-09, part 3) ───────────────────────────────── */
/**
 * What the Simple permit set leaves out (owner's contractor: "too complicated, too much information"): the general
 * notes sheet (its notes move to the cover — plan-set CoverSheet), the compliance's continuation, the elevations, the
 * schedules and materials; on the sheets that stay, the framing picture and the code check on the cover, the bearing
 * check and the layout table under the foundation plan, the decking pattern detail. About six sheets (seven with a
 * roof): the cover, the site plan, the foundation and framing plans, the section, the details. The ids are the plan
 * set's own (components/v3/deck-plans/plan-set Card keys).
 */
export const SIMPLE_OUT: readonly string[] = ["sheet:notes", "sheet:notes2", "sheet:elevations", "sheet:schedules", "cover/framing-picture", "cover/check", "foundation/bearing", "foundation/layout", "details/detail-pattern"];
/** Out because the set is Simple (and not brought back). */
export const presetOut = (e: SetEdits, id: string): boolean => !!e.simple && SIMPLE_OUT.includes(id) && !(e.shown ?? []).includes(id);
/** A card ("<sheet>/<key>") or a sheet ("sheet:<id>") that does not print. */
export const isOut = (e: SetEdits, id: string): boolean => e.hidden.includes(id) || presetOut(e, id);
/** Take a card or sheet out (one the Simple set brought back goes back out the same way). */
export function takeOut(e: SetEdits, id: string): SetEdits {
  if (isOut(e, id)) return e;
  if ((e.shown ?? []).includes(id) && e.simple && SIMPLE_OUT.includes(id)) return { ...e, shown: (e.shown ?? []).filter((x) => x !== id) };
  return { ...e, hidden: [...e.hidden, id] };
}
/** Bring a card or sheet back, whichever way it was out. */
export function bringBack(e: SetEdits, id: string): SetEdits {
  if (!isOut(e, id)) return e;
  const next = e.hidden.includes(id) ? { ...e, hidden: e.hidden.filter((x) => x !== id) } : e;
  return presetOut(next, id) ? { ...next, shown: [...(next.shown ?? []), id] } : next;
}
export const emptyPlanEdits = (): PlanEdits => ({ v: 1, permit: emptySetEdits(), crew: emptySetEdits() });

/** The id an edit names a sheet by: its kind, or "extra:<id>" for one the contractor added. */
export const sheetEditId = (sheet: Pick<PlanSheet, "kind" | "extraId">): string => (sheet.kind === "extra" ? `extra:${sheet.extraId ?? ""}` : sheet.kind);

/** True when a set carries no edit at all. */
export function isBlank(e: SetEdits): boolean {
  return !e.hidden.length && !Object.keys(e.cards).length && !e.added.length && !e.sheets.length && !Object.keys(e.names).length;
}
/** How many things the contractor changed in a set, for the panel's words. */
export function editCount(e: SetEdits): number {
  return e.hidden.length + Object.keys(e.cards).length + e.added.length + e.sheets.length + Object.keys(e.names).length;
}

/* ── Cleaning a card's HTML ─────────────────────────────────────────────── */
const KEEP = new Set(["div", "span", "p", "br", "b", "strong", "i", "em", "u", "small", "sup", "sub", "ol", "ul", "li", "table", "thead", "tbody", "tfoot", "tr", "th", "td"]);
const VOID = new Set(["br"]);
/** Dropped with everything inside them. */
const DROP = new Set(["script", "style", "svg", "math", "template", "iframe", "object", "embed", "noscript", "textarea", "select", "title", "head", "canvas", "video", "audio", "picture"]);

const esc = (t: string) => t.replace(/&(?!(?:[a-zA-Z]{2,10}|#\d{1,6}|#x[0-9a-fA-F]{1,6});)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cleanAttrs(raw: string): string {
  const out: string[] = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    const value = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (name === "class") {
      const tokens = value.split(/\s+/).filter((t) => /^[A-Za-z0-9_:+./-]{1,120}$/.test(t)).slice(0, 8);
      if (tokens.length) out.push(`class="${tokens.join(" ")}"`);
    } else if (name === "colspan" || name === "rowspan") {
      const n = Number(value);
      if (Number.isInteger(n) && n >= 1 && n <= 20) out.push(`${name}="${n}"`);
    }
  }
  return out.length ? ` ${out.join(" ")}` : "";
}

/**
 * A card's HTML cut down to what a sheet's text needs: the tags above, a class list of plain tokens, a cell's span —
 * no style, no link, no script, no picture, no event, nothing else. Tags are closed in order; text is escaped.
 */
export function cleanCardHtml(html: string): string {
  const src = String(html ?? "").slice(0, MAX_CARD_HTML * 2).replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g, "").replace(/<![^>]*>?/g, "").replace(/<\?[^>]*>?/g, "");
  const out: string[] = [];
  const open: string[] = [];
  let dropping: string | null = null;
  let depth = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*?)?)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const text = (t: string) => {
    if (!dropping && t) out.push(esc(t.replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"))));
  };
  while ((m = re.exec(src))) {
    text(src.slice(last, m.index));
    last = re.lastIndex;
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (dropping) {
      if (tag === dropping) depth += closing ? -1 : m[4] ? 0 : 1;
      if (depth <= 0) dropping = null;
      continue;
    }
    if (DROP.has(tag)) {
      if (!closing && !m[4]) {
        dropping = tag;
        depth = 1;
      }
      continue;
    }
    if (!KEEP.has(tag)) continue;
    if (closing) {
      const at = open.lastIndexOf(tag);
      if (at < 0) continue;
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    if (VOID.has(tag)) {
      out.push(`<${tag}>`);
      continue;
    }
    if (open.length >= 40) continue;
    out.push(`<${tag}${cleanAttrs(m[3] ?? "")}>`);
    if (!m[4]) open.push(tag);
    else out.push(`</${tag}>`);
  }
  text(src.slice(last));
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join("").slice(0, MAX_CARD_HTML);
}

/**
 * Every class in a card's HTML through `map` (a class name to a token or back); a class the map does not know is
 * dropped. The sheets' CSS-module names are hashed per build, so a card is kept with tokens ("p:h") and drawn with
 * the build's own names.
 */
export function mapCardClasses(html: string, map: (cls: string) => string | null): string {
  return html.replace(/ class="([^"]*)"/g, (_all, list: string) => {
    const tokens = list.split(/\s+/).filter(Boolean).map(map).filter((t): t is string => !!t);
    return tokens.length ? ` class="${tokens.join(" ")}"` : "";
  });
}

/** A card's words, spaces folded — what the fingerprint and the "did anything change" test read. */
export const cardWords = (text: string): string => String(text ?? "").replace(/[\s ​]+/g, " ").trim();

/** A short fingerprint of a card's words (FNV-1a, 32 bits), to tell later whether the design's own words changed. */
export function fingerprint(text: string): string {
  const t = cardWords(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/* ── Reading edits back (from the database, from the browser) ──────────── */
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const idOk = (v: unknown, max = 120): v is string => typeof v === "string" && v.length > 0 && v.length <= max && /^[A-Za-z0-9:/_.-]+$/.test(v);

function normalizeSet(raw: unknown): SetEdits {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hidden = Array.isArray(r.hidden) ? [...new Set(r.hidden.filter((x) => idOk(x)))].slice(0, 400) : [];
  const cards: Record<string, CardEdit> = {};
  if (r.cards && typeof r.cards === "object") {
    for (const [id, v] of Object.entries(r.cards as Record<string, unknown>).slice(0, 400)) {
      if (!idOk(id) || !v || typeof v !== "object") continue;
      const e = v as Record<string, unknown>;
      const html = cleanCardHtml(str(e.html, MAX_CARD_HTML * 2));
      const was = /^[0-9a-f]{8}$/.test(String(e.was ?? "")) ? String(e.was) : "";
      cards[id] = e.tpl === true ? { html, was, tpl: true } : { html, was };
    }
  }
  const sheets: AddedSheet[] = [];
  if (Array.isArray(r.sheets)) {
    for (const v of r.sheets.slice(0, MAX_SHEETS)) {
      const e = (v ?? {}) as Record<string, unknown>;
      if (!idOk(e.id, 40) || sheets.some((x) => x.id === e.id)) continue;
      sheets.push({ id: e.id, name: str(e.name, MAX_NAME).trim() || "Additional notes" });
    }
  }
  const added: AddedCard[] = [];
  if (Array.isArray(r.added)) {
    for (const v of r.added.slice(0, MAX_ADDED)) {
      const e = (v ?? {}) as Record<string, unknown>;
      if (!idOk(e.id, 60) || !idOk(e.after, 160) || added.some((x) => x.id === e.id)) continue;
      added.push({ id: e.id, after: e.after, html: cleanCardHtml(str(e.html, MAX_CARD_HTML * 2)) });
    }
  }
  const names: Record<string, string> = {};
  if (r.names && typeof r.names === "object") {
    for (const [id, v] of Object.entries(r.names as Record<string, unknown>).slice(0, 40)) {
      const name = str(v, MAX_NAME).replace(/\s+/g, " ").trim();
      if (idOk(id) && name) names[id] = name;
    }
  }
  const shown = Array.isArray(r.shown) ? [...new Set(r.shown.filter((x) => idOk(x)))].slice(0, 100) : [];
  const t = (r.tpl && typeof r.tpl === "object" ? r.tpl : null) as Record<string, unknown> | null;
  const tpl = t && idOk(t.id, 40) ? { id: t.id, name: templateName(t.name) || "My template" } : null;
  return { hidden, cards, added, sheets, names, check: normalizeKeptCheck(r.check), simple: r.simple === true, shown, tpl };
}

const FROMS = ["upload", "paste", "online", "kept", "ask"] as const;
/** A kept check read back: its words cut to size, its links only http(s). */
export function normalizeKeptCheck(raw: unknown): KeptCheck | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const cut = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const n = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1000 ? (v as number) : 0);
  const todo = Array.isArray(r.todo)
    ? r.todo
        .slice(0, 30)
        .map((t) => {
          const x = (t ?? {}) as Record<string, unknown>;
          return { need: cut(x.need, 160), why: cut(x.why, 240), design: x.design === true };
        })
        .filter((t) => t.need)
    : [];
  const sources = Array.isArray(r.sources)
    ? r.sources
        .slice(0, 8)
        .map((t) => {
          const x = (t ?? {}) as Record<string, unknown>;
          return { title: cut(x.title, 120), url: cut(x.url, 400) };
        })
        .filter((t) => /^https?:\/\/[^\s"<>]+$/i.test(t.url))
    : [];
  const place = cut(r.place, 120);
  if (!place && !todo.length) return null;
  const from = (FROMS as readonly string[]).includes(String(r.from)) ? (r.from as KeptCheck["from"]) : "upload";
  return { place, department: cut(r.department, 120), at: /^\d{4}-\d{2}-\d{2}/.test(String(r.at ?? "")) ? String(r.at).slice(0, 24) : "", onSet: n(r.onSet), added: n(r.added), from, sources, todo };
}

/** Edits read from anywhere, cut to their shape and limits; anything else is dropped. */
export function normalizePlanEdits(raw: unknown): PlanEdits {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { v: 1, permit: normalizeSet(r.permit), crew: normalizeSet(r.crew) };
}

/* ── The sheets, with the contractor's changes ─────────────────────────── */
export interface EditedSheet extends PlanSheet {
  /** "sheet:<id>" — what the edits name it by. */
  editId: string;
  /** Taken out by the contractor (kept in the list so the panel can bring it back; never drawn). */
  out: boolean;
  /** The set's own name, when the contractor typed another. */
  ownName: string | null;
}

/**
 * The set's sheets with the contractor's changes: renamed, taken out (kept, marked `out`), and the added sheets —
 * after the general (G) sheets on the permit set, at the end of the crew's. A sheet keeps its number: the notes and
 * the drawings point at sheets by number ("detail 1/S-501"), so taking one out never moves the others; the added
 * sheets take the next numbers of their run.
 */
export function editedSheets(sheets: PlanSheet[], e: SetEdits, set: PlanSetName): EditedSheet[] {
  const own: EditedSheet[] = sheets.map((sh) => {
    const id = sheetEditId(sh);
    const name = e.names[id];
    return { ...sh, name: name ?? sh.name, editId: `sheet:${id}`, out: isOut(e, `sheet:${id}`), ownName: name ? sh.name : null };
  });
  if (!e.sheets.length) return own;
  const paper = sheets[0]?.paper ?? (set === "crew" ? "A" : "B");
  if (set === "crew") {
    const used = own.map((sh) => Number(sh.no.replace(/^C-/, ""))).filter((n) => Number.isFinite(n));
    let next = (used.length ? Math.max(...used) : -1) + 1;
    return [...own, ...e.sheets.map((x) => extraSheet(x, `C-${next++}`, paper, e))];
  }
  const gNos = own.filter((sh) => /^G-\d+$/.test(sh.no)).map((sh) => Number(sh.no.slice(2)));
  let next = (gNos.length ? Math.max(...gNos) : 0) + 1;
  const lastG = own.reduce((at, sh, i) => (/^G-/.test(sh.no) ? i : at), -1);
  const extras = e.sheets.map((x) => extraSheet(x, `G-${String(next++).padStart(3, "0")}`, paper, e));
  return [...own.slice(0, lastG + 1), ...extras, ...own.slice(lastG + 1)];
}
function extraSheet(x: AddedSheet, no: string, paper: PlanSheet["paper"], e: SetEdits): EditedSheet {
  const id = `extra:${x.id}`;
  return { no, name: x.name, kind: "extra", extraId: x.id, paper, editId: `sheet:${id}`, out: isOut(e, `sheet:${id}`), ownName: null };
}

/** The added cards that follow `after`, in the order they were added. */
export const addedAfter = (e: SetEdits, after: string): AddedCard[] => e.added.filter((a) => a.after === after);

/** A set with one card or sheet taken out of the edits entirely (an added card or sheet deleted, with what hung on it). */
export function dropAdded(e: SetEdits, id: string): SetEdits {
  // A card that followed the deleted one moves up to what that one followed, so deleting a card never loses the next.
  const target = e.added.find((a) => a.id === id)?.after;
  const added = e.added.filter((a) => a.id !== id).map((a) => (a.after === id && target ? { ...a, after: target } : a));
  const cards = { ...e.cards };
  delete cards[id];
  return { ...e, added, cards, hidden: e.hidden.filter((h) => h !== id) };
}
/** A set with an added sheet taken out, and every card on it. */
export function dropSheet(e: SetEdits, sheetId: string): SetEdits {
  const top = `sheet:extra:${sheetId}`;
  const gone = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of e.added) {
      if (gone.has(a.id) || (a.after !== top && !gone.has(a.after))) continue;
      gone.add(a.id);
      grew = true;
    }
  }
  const names = { ...e.names };
  delete names[`extra:${sheetId}`];
  return { ...e, sheets: e.sheets.filter((x) => x.id !== sheetId), added: e.added.filter((a) => !gone.has(a.id)), hidden: e.hidden.filter((h) => h !== top), names };
}

/** The new card's HTML: a heading and one line, in the sheets' own classes (as tokens). */
export const NEW_CARD_HTML = '<div class="p:h">New note</div><ol class="p:notes"><li>Type the note here.</li></ol>';
/** A short random id for an added card or sheet. */
export const newEditId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ── The contractor's own template (2026-11-10) ───────────────────────── */
// Owner: "when constructor he did his preset with deleting what he don't need it, that he can make save as a template
// and he run his decks with exact template of the permit set and the construction set, the way he wants it after
// deleting and adjusting the original permit set." A template is both sets' edits as they stand — what was taken
// out, renamed, added, typed over, Simple or Full — without the county check (that belongs to an address). On the
// next deck everything applies as it is, but a card typed over: it carries another deck's words, so it shows only
// where this deck's own card reads the same as the one it was typed over (CardEdit.tpl).
export interface PlanTemplateInfo {
  id: string;
  name: string;
  /** ISO time it was saved. */
  at: string;
}
export interface PlanTemplateIndex {
  v: 1;
  /** The template every new deck starts with, when there is one. */
  defaultId: string | null;
  list: PlanTemplateInfo[];
}
export const MAX_TEMPLATES = 8;
export const MAX_TEMPLATE_NAME = 60;
export const templateName = (v: unknown): string => String(typeof v === "string" ? v : "").replace(/\s+/g, " ").trim().slice(0, MAX_TEMPLATE_NAME);

const templateSet = (e: SetEdits): SetEdits => ({
  ...e,
  cards: Object.fromEntries(Object.entries(e.cards).map(([id, c]) => [id, { html: c.html, was: c.was, tpl: true as const }])),
  check: null,
  tpl: null,
});
/** A deck's edits as a template: both sets, every typed-over card marked as the template's, no county check. */
export function templateFrom(edits: PlanEdits): PlanEdits {
  const n = normalizePlanEdits(edits);
  return { v: 1, permit: templateSet(n.permit), crew: templateSet(n.crew) };
}
/** A template on a deck: its edits under the template's name, the deck's own county checks kept. */
export function editsFromTemplate(body: PlanEdits, t: { id: string; name: string }, keep?: PlanEdits | null): PlanEdits {
  const n = templateFrom(body);
  const mark = { id: t.id, name: templateName(t.name) || "My template" };
  return { v: 1, permit: { ...n.permit, tpl: mark, check: keep?.permit.check ?? null }, crew: { ...n.crew, tpl: mark, check: keep?.crew.check ?? null } };
}
/** True when a deck's edits change nothing on either set (a template saved from it would be the studio's own set). */
export const nothingToSave = (edits: PlanEdits): boolean => (["permit", "crew"] as const).every((k) => isBlank(edits[k]) && !edits[k].simple);

export function normalizeTemplateIndex(raw: unknown): PlanTemplateIndex {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list: PlanTemplateInfo[] = [];
  if (Array.isArray(r.list)) {
    for (const v of r.list.slice(0, MAX_TEMPLATES)) {
      const e = (v ?? {}) as Record<string, unknown>;
      const name = templateName(e.name);
      if (!idOk(e.id, 40) || !name || list.some((x) => x.id === e.id)) continue;
      list.push({ id: e.id, name, at: /^\d{4}-\d{2}-\d{2}/.test(String(e.at ?? "")) ? String(e.at).slice(0, 24) : "" });
    }
  }
  const defaultId = typeof r.defaultId === "string" && list.some((x) => x.id === r.defaultId) ? r.defaultId : null;
  return { v: 1, defaultId, list };
}
