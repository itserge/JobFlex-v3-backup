"use client";
// THE PLAN SET'S EDIT (2026-11-09) — the contractor's own changes on top of the
// set as drawn (lib/deck/plans/edits). Owner: "a button on very top called
// edit, and when you press that edit button, it makes all those construction
// permits and drawings editable … you can delete that card, or you can edit
// that card and remove some information and maybe add something else."
//
// Every block of a sheet is a <Card>: a table, a notes list, a drawing. In the
// Edit a click picks a card; a second click (or Edit text) types into it in
// place — on a phone, where the sheet is drawn small, in a full-screen editor.
// A drawing can be taken out but not typed into: its lines come from the
// design. An edited card keeps the design's own card drawn out of sight to
// tell when the design's words change under the edit (a bigger beam): it says
// so on screen instead of printing the old figure.
//
// With no <PlanEditProvider> above it a Card draws exactly what it holds.
import * as React from "react";
import { createPortal } from "react-dom";
import { addedAfter, cleanCardHtml, dropAdded, emptyPlanEdits, emptySetEdits, fingerprint, mapCardClasses, NEW_CARD_HTML, newEditId, type AddedCard, type EditedSheet, type PlanEdits, type PlanSetName, type SetEdits } from "@/lib/deck/plans/edits";
import ps from "./plan-set.module.css";
import pe from "./plan-edit.module.css";

export interface CardMeta {
  label: string;
  sheetNo: string;
  sheetName: string;
  drawing: boolean;
  /** Why most building departments want this card (a heads-up before deleting it). */
  need?: string;
  added: boolean;
  /** No card can be added after this one (it holds a place in its sheet's layout). */
  noAdd: boolean;
}
interface Reg {
  el: HTMLElement | null;
  orig: HTMLElement | null;
  meta: CardMeta;
}
interface Typing {
  id: string;
  /** The card's HTML when the typing started (the build's own class names). */
  start: string;
  /** The design's own card, stored the way an edit is — typing it back drops the edit. */
  origStored: string;
  origWords: string;
  point: { x: number; y: number } | null;
  /** On a small screen: the full-screen editor instead of the sheet. */
  full: boolean;
  width: number;
  pick?: boolean;
}
export type EditTool = "add-line" | "del-line" | "add-row" | "del-row";

export interface PlanEditApi {
  set: PlanSetName;
  all: PlanEdits;
  edits: SetEdits;
  canEdit: boolean;
  editing: boolean;
  selected: string | null;
  typing: Typing | null;
  caret: { li: boolean; tr: boolean };
  stale: Record<string, { label: string; sheetNo: string }>;
  overflow: Record<string, string>;
  sheets: EditedSheet[];
  canUndo: boolean;
  status: string;
  setEditing(on: boolean): void;
  select(id: string | null, scroll?: boolean): void;
  change(fn: (e: SetEdits) => SetEdits): void;
  undo(): void;
  metaOf(id: string): CardMeta | null;
  startTyping(id: string, point?: { x: number; y: number } | null): void;
  finishTyping(keep: boolean): void;
  tool(t: EditTool): void;
  deleteCard(id: string): void;
  restoreCard(id: string): void;
  originalCard(id: string): void;
  keepMine(id: string): void;
  addCardAfter(after: string): void;
  addSheet(): void;
  resetSet(): void;
  // For the cards and the sheets:
  register(id: string, reg: Reg | null): void;
  report(id: string, stale: { label: string; sheetNo: string } | null): void;
  reportOverflow(no: string, name: string | null): void;
  reportSheets(list: EditedSheet[]): void;
  toLive(html: string): string;
  /** The element being typed into (the card, or the phone's editor). */
  typingRef: React.RefObject<HTMLElement | null>;
  setTypingEl(el: HTMLElement | null): void;
}

const EditCtx = React.createContext<PlanEditApi | null>(null);
/** The sheet a card is on: its edit id ("foundation", "extra:<id>"), number and name. */
export const SheetCtx = React.createContext<{ id: string; no: string; name: string } | null>(null);
export const usePlanEdit = () => React.useContext(EditCtx);

/** Small screens edit in the full-screen editor: the sheet is drawn too small to type into. */
const FULL_EDITOR_BELOW_ZOOM = 0.55;
/** How large the full-screen editor draws the card (plan-edit.module.css .fullCard). */
const FULL_CARD_ZOOM = 1.7;
const UNDO_DEPTH = 60;

/* ── The provider: the edits, the selection, the typing, the save ─────── */
export function PlanEditProvider({ set, initial, canEdit, zoom, modules, onSave, children }: { set: PlanSetName; initial: PlanEdits | null; canEdit: boolean; zoom: number; modules: Record<string, Record<string, string>>; onSave?: (edits: PlanEdits) => Promise<string>; children: React.ReactNode }) {
  const [all, setAll] = React.useState<PlanEdits>(() => initial ?? emptyPlanEdits());
  const [editing, setEditingState] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [typing, setTyping] = React.useState<Typing | null>(null);
  const [caret, setCaret] = React.useState({ li: false, tr: false });
  const [stale, setStale] = React.useState<Record<string, { label: string; sheetNo: string }>>({});
  const [overflow, setOverflow] = React.useState<Record<string, string>>({});
  const [sheets, setSheets] = React.useState<EditedSheet[]>([]);
  const [status, setStatus] = React.useState("");
  const [depth, setDepth] = React.useState(0);
  const history = React.useRef<PlanEdits[]>([]);
  const regs = React.useRef(new Map<string, Reg>());
  const typingRef = React.useRef<HTMLElement | null>(null);
  const dirty = React.useRef(false);
  const pendingType = React.useRef<string | null>(null);
  const now = React.useRef({ all, set, typing, selected, editing });
  // The handlers read the latest state through this (they run after the render that set it).
  React.useLayoutEffect(() => {
    now.current = { all, set, typing, selected, editing };
  });

  // The build's class names ⇄ the tokens an edit keeps ("p:h").
  const maps = React.useMemo(() => {
    const toTok = new Map<string, string>();
    const toCls = new Map<string, string>();
    for (const [prefix, mod] of Object.entries(modules)) {
      for (const [key, cls] of Object.entries(mod)) {
        if (typeof cls !== "string" || /\s/.test(cls)) continue;
        toTok.set(cls, `${prefix}:${key}`);
        toCls.set(`${prefix}:${key}`, cls);
      }
    }
    return { toTok, toCls };
  }, [modules]);
  const toStored = React.useCallback((html: string) => mapCardClasses(cleanCardHtml(html), (c) => maps.toTok.get(c) ?? null), [maps]);
  const toLive = React.useCallback((html: string) => mapCardClasses(html, (t) => maps.toCls.get(t) ?? null), [maps]);

  const commit = React.useCallback((next: PlanEdits) => {
    history.current.push(now.current.all);
    if (history.current.length > UNDO_DEPTH) history.current.shift();
    setDepth(history.current.length);
    dirty.current = true;
    // A second change in the same handler builds on this one, not on the render before it.
    now.current = { ...now.current, all: next };
    setAll(next);
  }, []);
  const change = React.useCallback(
    (fn: (e: SetEdits) => SetEdits) => {
      const cur = now.current.all;
      const which = now.current.set;
      const nextSet = fn(cur[which]);
      if (nextSet === cur[which]) return;
      commit({ ...cur, [which]: nextSet });
    },
    [commit],
  );
  const undo = React.useCallback(() => {
    const prev = history.current.pop();
    setDepth(history.current.length);
    if (!prev) return;
    dirty.current = true;
    setTyping(null);
    setAll(prev);
  }, []);

  // Kept a moment after the last change, by the property (actions/deckPlanEdits).
  React.useEffect(() => {
    if (!dirty.current || !onSave) return;
    setStatus("Saving the edits…");
    const t = window.setTimeout(() => {
      dirty.current = false;
      onSave(all)
        .then(setStatus)
        .catch(() => setStatus("The edits could not be saved."));
    }, 900);
    return () => window.clearTimeout(t);
  }, [all, onSave]);

  const metaOf = React.useCallback((id: string) => regs.current.get(id)?.meta ?? null, []);
  const register = React.useCallback((id: string, reg: Reg | null) => {
    if (reg) regs.current.set(id, reg);
    else regs.current.delete(id);
  }, []);
  const report = React.useCallback((id: string, v: { label: string; sheetNo: string } | null) => {
    setStale((cur) => {
      const had = cur[id];
      if (!v && !had) return cur;
      if (v && had && had.label === v.label && had.sheetNo === v.sheetNo) return cur;
      const next = { ...cur };
      if (v) next[id] = v;
      else delete next[id];
      return next;
    });
  }, []);
  const reportOverflow = React.useCallback((no: string, name: string | null) => {
    setOverflow((cur) => {
      if ((cur[no] ?? null) === name) return cur;
      const next = { ...cur };
      if (name) next[no] = name;
      else delete next[no];
      return next;
    });
  }, []);
  const reportSheets = React.useCallback((list: EditedSheet[]) => {
    setSheets((cur) => (cur.length === list.length && cur.every((s, i) => s.no === list[i].no && s.name === list[i].name && s.out === list[i].out && s.editId === list[i].editId) ? cur : list));
  }, []);

  const select = React.useCallback((id: string | null, scroll = false) => {
    setSelected(id);
    if (id && scroll) {
      window.setTimeout(() => regs.current.get(id)?.el?.closest("[data-plan-sheet]") && regs.current.get(id)?.el?.scrollIntoView({ block: "center", behavior: "smooth" }), 30);
    }
  }, []);

  const startTyping = React.useCallback(
    (id: string, point: { x: number; y: number } | null = null, pick = false) => {
      const reg = regs.current.get(id);
      if (!reg?.el || reg.meta.drawing) return;
      const e = now.current.all[now.current.set];
      const edited = !!e.cards[id];
      const start = reg.el.innerHTML;
      const origEl = edited ? reg.orig : reg.el;
      setSelected(id);
      setTyping({
        id,
        start,
        origStored: reg.meta.added ? "" : toStored(origEl?.innerHTML ?? ""),
        origWords: reg.meta.added ? "" : (origEl?.textContent ?? ""),
        point,
        full: zoom < FULL_EDITOR_BELOW_ZOOM,
        width: Math.max(200, Math.min(1400, reg.el.offsetWidth || 400)),
        pick,
      });
    },
    [toStored, zoom],
  );
  const finishTyping = React.useCallback(
    (keep: boolean) => {
      const t = now.current.typing;
      if (!t) return;
      const el = typingRef.current;
      const reg = regs.current.get(t.id);
      if (keep && el) {
        const stored = toStored(el.innerHTML);
        const cur = now.current.all[now.current.set];
        if (reg?.meta.added || cur.added.some((a) => a.id === t.id)) {
          change((x) => ({ ...x, added: x.added.map((a) => (a.id === t.id ? { ...a, html: stored } : a)) }));
        } else if (stored === t.origStored) {
          if (cur.cards[t.id]) change((x) => dropCard(x, t.id));
        } else if (stored !== toStored(t.start)) {
          const was = cur.cards[t.id]?.was ?? fingerprint(t.origWords);
          change((x) => ({ ...x, cards: { ...x.cards, [t.id]: { html: stored, was } } }));
        }
      }
      typingRef.current = null;
      setTyping(null);
    },
    [change, toStored],
  );

  const setEditing = React.useCallback(
    (on: boolean) => {
      if (!on) finishTyping(true);
      setEditingState(on && canEdit);
      setSelected(null);
    },
    [canEdit, finishTyping],
  );
  // Another set (permit ⇄ crew) drops what was picked.
  const [seenSet, setSeenSet] = React.useState(set);
  if (seenSet !== set) {
    setSeenSet(set);
    setSelected(null);
    setTyping(null);
  }

  // Where the caret is, for the row and line buttons (the last place inside the card: a tap on a button can take the
  // selection away on a phone before the button hears it).
  const lastCaret = React.useRef<Element | null>(null);
  React.useEffect(() => {
    if (!typing) return;
    lastCaret.current = null;
    const onSel = () => {
      const el = typingRef.current;
      const node = document.getSelection()?.anchorNode ?? null;
      const at = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
      if (!el || !at || !el.contains(at)) return;
      lastCaret.current = at;
      const li = !!at.closest("li");
      const tr = !!at.closest("tr");
      setCaret((c) => (c.li === li && c.tr === tr ? c : { li, tr }));
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [typing]);

  const tool = React.useCallback((t: EditTool) => {
    const el = typingRef.current;
    const node = document.getSelection()?.anchorNode ?? null;
    let at = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
    if (!at || !el?.contains(at)) at = lastCaret.current;
    if (!el || !at || !el.contains(at)) return;
    if (t === "add-line" || t === "del-line") {
      const li = at.closest("li");
      if (!li || !el.contains(li)) return;
      if (t === "del-line") {
        const next = (li.nextElementSibling ?? li.previousElementSibling) as HTMLElement | null;
        li.remove();
        if (next) caretInto(next);
      } else {
        const n = document.createElement("li");
        n.innerHTML = "<br>";
        li.after(n);
        caretInto(n);
      }
    } else {
      const tr = at.closest("tr");
      if (!tr || !el.contains(tr)) return;
      if (t === "del-row") {
        const next = (tr.nextElementSibling ?? tr.previousElementSibling) as HTMLElement | null;
        tr.remove();
        if (next) caretInto(next.querySelector("td,th") ?? next);
      } else {
        const n = tr.cloneNode(true) as HTMLTableRowElement;
        n.querySelectorAll("td,th").forEach((c) => (c.innerHTML = "<br>"));
        tr.after(n);
        caretInto(n.querySelector("td,th") ?? n);
      }
    }
    el.focus();
  }, []);

  const deleteCard = React.useCallback(
    (id: string) => {
      const e = now.current.all[now.current.set];
      if (e.added.some((a) => a.id === id)) change((x) => dropAdded(x, id));
      else change((x) => (x.hidden.includes(id) ? x : { ...x, hidden: [...x.hidden, id] }));
    },
    [change],
  );
  const restoreCard = React.useCallback((id: string) => change((x) => (x.hidden.includes(id) ? { ...x, hidden: x.hidden.filter((h) => h !== id) } : x)), [change]);
  const originalCard = React.useCallback((id: string) => change((x) => (x.cards[id] ? dropCard(x, id) : x)), [change]);
  const keepMine = React.useCallback(
    (id: string) => {
      const orig = regs.current.get(id)?.orig;
      if (!orig) return;
      const was = fingerprint(orig.textContent ?? "");
      change((x) => (x.cards[id] ? { ...x, cards: { ...x.cards, [id]: { ...x.cards[id], was } } } : x));
    },
    [change],
  );
  const addCardAfter = React.useCallback(
    (after: string) => {
      const id = newEditId("add");
      change((x) => ({ ...x, added: [...x.added, { id, after, html: NEW_CARD_HTML }] }));
      pendingType.current = id;
    },
    [change],
  );
  const addSheet = React.useCallback(() => {
    const sid = newEditId("sh");
    const id = newEditId("add");
    change((x) => ({ ...x, sheets: [...x.sheets, { id: sid, name: "Additional notes" }], added: [...x.added, { id, after: `sheet:extra:${sid}`, html: NEW_CARD_HTML }] }));
    pendingType.current = id;
  }, [change]);
  const resetSet = React.useCallback(() => {
    setTyping(null);
    setSelected(null);
    change(() => emptySetEdits());
  }, [change]);

  // A card just added: picked and typed into, its heading selected so typing replaces it.
  React.useLayoutEffect(() => {
    const id = pendingType.current;
    if (!id) return;
    const reg = regs.current.get(id);
    if (!reg?.el) return;
    pendingType.current = null;
    reg.el.scrollIntoView({ block: "center" });
    startTyping(id, null, true);
  }, [all, startTyping]);
  const setTypingEl = React.useCallback((el: HTMLElement | null) => {
    typingRef.current = el;
  }, []);

  const api = React.useMemo<PlanEditApi>(
    () => ({
      set,
      all,
      edits: all[set],
      canEdit,
      editing,
      selected,
      typing,
      caret,
      stale,
      overflow,
      sheets,
      canUndo: depth > 0,
      status,
      setEditing,
      select,
      change,
      undo,
      metaOf,
      startTyping,
      finishTyping,
      tool,
      deleteCard,
      restoreCard,
      originalCard,
      keepMine,
      addCardAfter,
      addSheet,
      resetSet,
      register,
      report,
      reportOverflow,
      reportSheets,
      toLive,
      typingRef,
      setTypingEl,
    }),
    [set, all, canEdit, editing, selected, typing, caret, stale, overflow, sheets, depth, status, setEditing, select, change, undo, metaOf, startTyping, finishTyping, tool, deleteCard, restoreCard, originalCard, keepMine, addCardAfter, addSheet, resetSet, register, report, reportOverflow, reportSheets, toLive, setTypingEl],
  );
  return (
    <EditCtx.Provider value={api}>
      {children}
      {typing?.full ? <FullEditor api={api} typing={typing} /> : null}
    </EditCtx.Provider>
  );
}

function dropCard(e: SetEdits, id: string): SetEdits {
  const cards = { ...e.cards };
  delete cards[id];
  return { ...e, cards };
}
function caretInto(el: Element) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(true);
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}
function caretAtPoint(el: HTMLElement, p: { x: number; y: number } | null, pickFirst?: boolean) {
  el.focus({ preventScroll: true });
  const sel = document.getSelection();
  if (!sel) return;
  if (pickFirst && el.firstElementChild) {
    const r = document.createRange();
    r.selectNodeContents(el.firstElementChild);
    sel.removeAllRanges();
    sel.addRange(r);
    return;
  }
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
  let r: Range | null = null;
  if (p) {
    if (doc.caretRangeFromPoint) r = doc.caretRangeFromPoint(p.x, p.y);
    else if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(p.x, p.y);
      if (pos) {
        r = document.createRange();
        r.setStart(pos.offsetNode, pos.offset);
      }
    }
  }
  if (!r || !el.contains(r.startContainer)) {
    r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(r);
}
/** Paste as plain words: nothing from another page's styles comes in. */
function pastePlain(ev: React.ClipboardEvent) {
  ev.preventDefault();
  const text = ev.clipboardData.getData("text/plain");
  if (!text) return;
  if (!document.execCommand("insertText", false, text)) {
    const sel = document.getSelection();
    if (!sel?.rangeCount) return;
    const r = sel.getRangeAt(0);
    r.deleteContents();
    r.insertNode(document.createTextNode(text));
    r.collapse(false);
  }
}

/* ── The set's surface: clicks pick cards while editing ─────────────────── */
export function useEditSurface(): { onClickCapture?: (ev: React.MouseEvent) => void; className?: string } {
  const api = usePlanEdit();
  if (!api) return {};
  if (!api.editing) return { className: pe.surface };
  const onClickCapture = (ev: React.MouseEvent) => {
    const target = ev.target as HTMLElement;
    const typingEl = api.typing && !api.typing.full ? api.typingRef.current : null;
    if (typingEl && typingEl.contains(target)) return;
    if (target.closest("button, [data-edit-pass]")) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (api.typing) api.finishTyping(true);
    const cardEl = target.closest("[data-card-id]") as HTMLElement | null;
    if (!cardEl) return api.select(null);
    const id = cardEl.dataset.cardId ?? "";
    const meta = api.metaOf(id);
    if (api.selected === id && meta && !meta.drawing && !api.edits.hidden.includes(id)) api.startTyping(id, { x: ev.clientX, y: ev.clientY });
    else api.select(id);
  };
  return { onClickCapture, className: `${pe.surface} ${pe.editing}` };
}

/* ── A card ─────────────────────────────────────────────────────────────── */
type DataAttrs = { [k: `data-${string}`]: string | number | undefined };
export function Card({ k, label, need, drawing, contents, noAdd, className, style, as = "div", children, ...data }: { k: string; label: string; need?: string; drawing?: boolean; contents?: boolean; noAdd?: boolean; className?: string; style?: React.CSSProperties; as?: "div" | "span"; children?: React.ReactNode } & DataAttrs) {
  const api = usePlanEdit();
  const sheet = React.useContext(SheetCtx);
  const Tag = as;
  if (!api || !sheet) return contents ? <>{children}</> : <Tag className={className} style={style} {...data}>{children}</Tag>;
  const id = `${sheet.id}/${k}`;
  return (
    <>
      <CardView api={api} id={id} meta={{ label, sheetNo: sheet.no, sheetName: sheet.name, drawing: !!drawing, need, added: false, noAdd: !!noAdd || !!drawing }} contents={contents} className={className} style={style} as={as} data={data} stored={api.edits.cards[id]?.html ?? null} was={api.edits.cards[id]?.was ?? null}>
        {children}
      </CardView>
      {as === "div" ? <AddedChain api={api} after={id} /> : null}
    </>
  );
}

/** The cards the contractor added after `after` — each with its own followers after it. */
export function AddedChain({ api, after }: { api: PlanEditApi; after: string }) {
  const sheet = React.useContext(SheetCtx);
  const list = addedAfter(api.edits, after);
  if (!list.length || !sheet) return null;
  return (
    <>
      {list.map((a) => (
        <React.Fragment key={a.id}>
          <AddedCardView api={api} a={a} sheet={sheet} />
          <AddedChain api={api} after={a.id} />
        </React.Fragment>
      ))}
    </>
  );
}
function AddedCardView({ api, a, sheet }: { api: PlanEditApi; a: AddedCard; sheet: { no: string; name: string } }) {
  const label = React.useMemo(() => headingOf(a.html) || "Added card", [a.html]);
  return <CardView api={api} id={a.id} meta={{ label, sheetNo: sheet.no, sheetName: sheet.name, drawing: false, added: true, noAdd: false }} className={pe.addedCard} as="div" data={{ "data-card-added": "" }} stored={a.html} was={null} />;
}
const headingOf = (html: string) =>
  (html.match(/^<div[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim()
    .slice(0, 60);

function CardView({ api, id, meta, contents, className, style, as = "div", data, stored, was, children }: { api: PlanEditApi; id: string; meta: CardMeta; contents?: boolean; className?: string; style?: React.CSSProperties; as?: "div" | "span"; data: DataAttrs; stored: string | null; was: string | null; children?: React.ReactNode }) {
  const elRef = React.useRef<HTMLElement | null>(null);
  const origRef = React.useRef<HTMLElement | null>(null);
  const hidden = api.edits.hidden.includes(id);
  const typing = api.typing?.id === id && !api.typing.full ? api.typing : null;
  const isStale = !!api.stale[id];
  const Tag = as;

  const { register, report } = api;
  React.useLayoutEffect(() => {
    register(id, { el: elRef.current, orig: origRef.current, meta });
  });
  // Only when the card goes (register and report are the provider's own, stable; `api` changes with every edit).
  React.useEffect(() => () => register(id, null), [register, id]);
  // An edited card: do the design's own words still match the ones it was edited from?
  React.useLayoutEffect(() => {
    if (stored == null || !was || !origRef.current) return report(id, null);
    report(id, fingerprint(origRef.current.textContent ?? "") !== was ? { label: meta.label, sheetNo: meta.sheetNo } : null);
  });
  React.useEffect(() => () => report(id, null), [report, id]);
  // Typing starts where the click was (or picks a new card's heading).
  React.useLayoutEffect(() => {
    if (!typing || !elRef.current) return;
    api.setTypingEl(elRef.current);
    caretAtPoint(elRef.current, typing.point, typing.pick);
    // Once: the next renders keep the caret where the contractor puts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing?.id, typing?.pick]);

  if (hidden && !api.editing) return null;
  const attrs = {
    "data-card-id": id,
    "data-card-sel": api.editing && api.selected === id ? "" : undefined,
    "data-card-out": hidden ? "" : undefined,
    "data-card-typing": typing ? "" : undefined,
    "data-card-stale": isStale ? "" : undefined,
    "data-card-drawing": meta.drawing ? "" : undefined,
    ...data,
  };
  const setEl = (el: HTMLElement | null) => {
    elRef.current = el;
  };
  if (contents && stored == null && !typing) {
    return (
      <div ref={setEl as React.Ref<HTMLDivElement>} className={pe.contents} {...attrs}>
        {children}
      </div>
    );
  }
  if (typing) {
    return (
      <Tag
        key="typing"
        ref={setEl as React.Ref<never>}
        className={className}
        style={style}
        {...attrs}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onPaste={pastePlain}
        onKeyDown={(ev: React.KeyboardEvent) => {
          if (ev.key === "Escape" || (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey))) {
            ev.preventDefault();
            api.finishTyping(true);
          }
        }}
        dangerouslySetInnerHTML={{ __html: typing.start }}
      />
    );
  }
  if (stored != null) {
    return (
      <>
        <Tag key="stored" ref={setEl as React.Ref<never>} className={className} style={style} {...attrs} dangerouslySetInnerHTML={{ __html: api.toLive(stored) }} />
        {children != null ? (
          <Tag ref={((el: HTMLElement | null) => void (origRef.current = el)) as React.Ref<never>} className={`${className ?? ""} ${pe.orig}`} aria-hidden data-card-orig="">
            {children}
          </Tag>
        ) : null}
      </>
    );
  }
  return (
    <Tag key="own" ref={setEl as React.Ref<never>} className={className} style={style} {...attrs}>
      {children}
    </Tag>
  );
}

/* ── A sheet the contractor added ──────────────────────────────────────── */
export function ExtraSheetBody({ sheetId }: { sheetId: string }) {
  const api = usePlanEdit();
  if (!api) return null;
  const top = `sheet:extra:${sheetId}`;
  const empty = !addedAfter(api.edits, top).length;
  return (
    <>
      <AddedChain api={api} after={top} />
      {empty && api.editing ? (
        <button type="button" className={pe.emptySheet} onClick={() => api.addCardAfter(top)} data-extra-add>
          This sheet is empty — add a card
        </button>
      ) : null}
    </>
  );
}

/**
 * A sheet's own watch: does anything on it run past its edge (a card made longer, cards added)? The sheet's columns
 * clip what does not fit, so the bottom would print cut off; the panel says which sheet.
 */
export function useSheetOverflow(ref: React.RefObject<HTMLElement | null>, no: string, name: string) {
  const api = usePlanEdit();
  const reportOverflow = api?.reportOverflow;
  React.useLayoutEffect(() => {
    if (!reportOverflow) return;
    const field = ref.current;
    const frame = field?.parentElement;
    if (!field || !frame) return;
    let over = field.scrollHeight > Math.min(field.clientHeight, frame.clientHeight) + 3;
    if (!over) {
      for (const child of Array.from(field.children) as HTMLElement[]) {
        if (child.clientHeight > 0 && getComputedStyle(child).overflowY === "hidden" && child.scrollHeight > child.clientHeight + 3) {
          over = true;
          break;
        }
      }
    }
    reportOverflow(no, over ? name : null);
  });
  React.useEffect(() => () => reportOverflow?.(no, null), [reportOverflow, no]);
}

/* ── On a phone: the card typed into full screen ───────────────────────── */
function FullEditor({ api, typing }: { api: PlanEditApi; typing: Typing }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const meta = api.metaOf(typing.id);
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    api.setTypingEl(ref.current);
    caretAtPoint(ref.current, null, typing.pick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing.id]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={pe.full} role="dialog" aria-modal="true" aria-label={`Edit ${meta?.label ?? "the card"}`} data-plan-full-editor>
      <div className={pe.fullHead}>
        <button type="button" className={pe.fullBtn} onClick={() => api.finishTyping(false)}>Cancel</button>
        <div className={pe.fullTitle}>
          <span>{meta ? `${meta.sheetNo} · ${meta.sheetName}` : ""}</span>
          <b>{meta?.label ?? "Card"}</b>
        </div>
        <button type="button" className={`${pe.fullBtn} ${pe.fullDone}`} onClick={() => api.finishTyping(true)} data-plan-full-done>Done</button>
      </div>
      <div className={pe.fullTools}>
        <ToolButtons api={api} />
      </div>
      <div className={pe.fullBody}>
        <div className={ps.set} style={{ display: "block" }}>
          <div
            ref={ref}
            className={pe.fullCard}
            // The card's own width on the sheet, or the phone's (the editor draws it 1.7× for the thumb).
            style={{ width: Math.min(typing.width, Math.max(160, (window.innerWidth - 32) / FULL_CARD_ZOOM)) }}
            contentEditable
            suppressContentEditableWarning
            spellCheck
            onPaste={pastePlain}
            onKeyDown={(ev) => {
              if (ev.key === "Escape") {
                ev.preventDefault();
                api.finishTyping(true);
              }
            }}
            dangerouslySetInnerHTML={{ __html: typing.start }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Add or take out the line or row the caret is in. */
export function ToolButtons({ api, className }: { api: PlanEditApi; className?: string }) {
  // The buttons never take the focus: the caret stays in the card.
  const keep = (ev: React.SyntheticEvent) => ev.preventDefault();
  const b = (t: EditTool, on: boolean, words: string) => (
    <button type="button" className={className ?? pe.fullBtn} disabled={!on} onMouseDown={keep} onPointerDown={keep} onClick={() => api.tool(t)} data-plan-tool={t}>
      {words}
    </button>
  );
  return (
    <>
      {b("add-line", api.caret.li, "+ Line")}
      {b("del-line", api.caret.li, "− Line")}
      {b("add-row", api.caret.tr, "+ Row")}
      {b("del-row", api.caret.tr, "− Row")}
    </>
  );
}

