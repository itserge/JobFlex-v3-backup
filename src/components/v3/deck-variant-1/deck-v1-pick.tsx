"use client";

// THE PART CARD (2026-11-09). Owner: "on the 3D … make it click to delete, or replace it for something else, and you
// restructure the whole thing without that beam. Make it smart."
//
// A part touched in the 3D opens this card under the picture: what the part is, what it DOES in the structure, and the
// choices a framer has for it (lib/deck/parts). Every choice is tried before it is offered — the tables re-run on the
// design with the choice laid over it — so each button already says what re-frames, what it does to the price and
// what the checks would then object to. One tap applies it; Undo is beside the result.

import * as React from "react";
import { Lock, Plus, Repeat2, Trash2, TriangleAlert, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import { ftIn } from "@/lib/deck/codeTables";
import { applyDeckPatch } from "@/lib/deck/checks";
import type { DeckDesign } from "@/lib/deck/design";
import { partBoxes, partCard, tryChoice, type PartCard, type PartChoice, type PartOutcome, type PartRef, type TakenOut } from "@/lib/deck/parts";
import type { DeckPackage, DeckPriceOptions } from "@/lib/deck/pricing";
import type { DeckScene, SceneLegend } from "@/lib/deck/scene";
import type { SceneHighlight } from "@/components/estimator/deck/DeckModel3D";
import { cx, money } from "./deck-v1-parts";

export interface PickedPart {
  legend: SceneLegend | null;
  point: [number, number, number];
  ref: PartRef | null;
}

/** What a tap did, for the line that stays under the 3D with its Undo. */
export interface PartDone {
  before: DeckDesign;
  text: string;
}

const deltaWords = (delta: number) => (Math.abs(delta) < 0.5 ? "same price" : delta < 0 ? `saves ${money(Math.abs(delta))}` : `adds ${money(delta)}`);
const TONE_ICON = { remove: Trash2, swap: Repeat2, add: Plus, size: Repeat2 } as const;
/** The choice held after the tables settled: a size they refuse is put back by the settle, and the button says so. */
const held = (o: PartOutcome, c: PartChoice) => JSON.stringify(applyDeckPatch(o.design, c.patch)) === JSON.stringify(o.design);

/** The picked part's boxes, lit — every part of the kind while a "remove them all" choice is under the pointer. */
export function usePartLight(pkg: DeckPackage, scene: DeckScene, ref: PartRef | null, whole: boolean): SceneHighlight | null {
  return React.useMemo(() => {
    if (!ref) return null;
    const boxIdx = partBoxes(pkg.structure, scene, ref, whole);
    return boxIdx.length ? { boxes: [], boxIdx } : null;
  }, [pkg, scene, ref, whole]);
}

export function PartCardView({
  design,
  pkg,
  picked,
  opts,
  locked,
  zoomed,
  onZoom,
  onClose,
  onApply,
  onWhole,
}: {
  design: DeckDesign;
  pkg: DeckPackage;
  picked: PickedPart;
  opts: DeckPriceOptions;
  /** A saved deck opened view-only: the card names the part and offers nothing. */
  locked: boolean;
  zoomed: boolean;
  onZoom: (zoomIn: boolean) => void;
  onClose: () => void;
  onApply: (next: DeckDesign, done: PartDone) => void;
  /** A choice that takes out every part of the kind is under the pointer (or not any more). */
  onWhole: (on: boolean) => void;
}) {
  const ref = picked.ref;
  const card = React.useMemo<PartCard | null>(() => (ref && !locked ? partCard(pkg.structure, ref, opts) : null), [pkg, ref, opts, locked]);
  const main = React.useMemo(() => (card ? card.choices.filter((c) => c.tone !== "size") : []), [card]);
  const rows = React.useMemo(() => {
    const out = new Map<string, PartChoice[]>();
    for (const c of card?.choices ?? []) if (c.tone === "size") out.set(c.row ?? "", [...(out.get(c.row ?? "") ?? []), c]);
    return [...out];
  }, [card]);
  // The main choices are tried at once (a handful, a few milliseconds each); the rows of sizes a moment later, so the
  // card is on screen before a dozen sizes have been run through the tables.
  const outcomes = React.useMemo(() => new Map(main.map((c) => [c.id, tryChoice(design, c, opts, pkg)] as const)), [main, design, opts, pkg]);
  const [sizes, setSizes] = React.useState<{ of: PartCard; map: Map<string, PartOutcome> } | null>(null);
  React.useEffect(() => {
    if (!card || !rows.length) return;
    // One size a turn of the event loop, so a dozen runs through the tables never hold a tap or a scroll.
    let stop = false;
    void (async () => {
      const map = new Map<string, PartOutcome>();
      for (const [, list] of rows) {
        for (const c of list) {
          if (c.current) continue;
          await new Promise<void>((done) => window.setTimeout(done, 0));
          if (stop) return;
          map.set(c.id, tryChoice(design, c, opts, pkg));
        }
      }
      if (!stop) setSizes({ of: card, map });
    })();
    return () => {
      stop = true;
    };
  }, [card, rows, design, opts, pkg]);
  const sizeOutcome = (c: PartChoice) => (sizes && sizes.of === card ? sizes.map.get(c.id) ?? null : null);

  const apply = (c: PartChoice, o: PartOutcome) => {
    const what = o.changes.length ? o.changes.join(" · ") : c.label;
    onWhole(false);
    onApply(o.design, { before: design, text: `${c.label}: ${what} — ${deltaWords(o.delta)}.` });
  };

  const lg = picked.legend;
  return (
    <div className={cx("v1-pick", card && "is-part")} data-deck-picked data-deck-part={ref?.kind ?? ""}>
      <div className="v1-pick-head">
        <b>{card?.title ?? lg?.role ?? "Part"}</b>
        {lg ? (
          <span className="v1-meta">
            {lg.nominal}
            {lg.lengthFt ? ` · ${ftIn(lg.lengthFt * 12)}` : ""}
            {lg.count > 1 ? ` · ${lg.count} of them` : ""}
          </span>
        ) : null}
        <span className="v1-pick-acts">
          <button type="button" className="v1-btn v1-btn-sm v1-btn-quiet" onClick={() => onZoom(!zoomed)} data-deck-zoom={zoomed ? "out" : "in"}>
            {zoomed ? <ZoomOut size={16} strokeWidth={2.5} aria-hidden="true" /> : <ZoomIn size={16} strokeWidth={2.5} aria-hidden="true" />}
            <span className="v1-hide-s">{zoomed ? "Zoom out" : "Zoom in"}</span>
          </button>
          <button type="button" className="v1-btn v1-btn-sm v1-btn-quiet" onClick={onClose} aria-label="Close" data-deck-pick-close>
            <X size={16} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </span>
      </div>
      <p className="v1-pick-body">{card?.does ?? lg?.note}</p>
      {card && lg && card.does !== lg.note ? <p className="v1-pick-how">{lg.note}</p> : null}

      {card?.stays ? (
        <p className="v1-pick-stays" data-deck-part-stays>
          <Lock size={14} strokeWidth={2.5} aria-hidden="true" />
          <span>{card.stays}</span>
        </p>
      ) : null}

      {main.length ? (
        <ul className="v1-pick-choices" aria-label="What you can do with it">
          {main.map((c) => {
            const o = outcomes.get(c.id);
            if (!o) return null;
            const Icon = TONE_ICON[c.tone];
            const stuck = held(o, c);
            const dead = o.nothing || !stuck || o.misses;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={cx("v1-choice", `is-${c.tone}`, o.issues.length > 0 && "has-issues")}
                  disabled={dead}
                  onClick={() => apply(c, o)}
                  onPointerEnter={() => c.whole && onWhole(true)}
                  onPointerLeave={() => c.whole && onWhole(false)}
                  onFocus={() => c.whole && onWhole(true)}
                  onBlur={() => c.whole && onWhole(false)}
                  data-deck-choice={c.id}
                >
                  <span className="v1-choice-top">
                    <Icon size={16} strokeWidth={2.5} aria-hidden="true" />
                    <span className="v1-choice-name">{c.label}</span>
                    <span className={cx("v1-choice-delta", "v1-num", o.delta < -0.5 && "is-less", o.delta > 0.5 && "is-more")}>{dead ? "no change" : deltaWords(o.delta)}</span>
                  </span>
                  {c.note ? <span className="v1-choice-note">{c.note}</span> : null}
                  {!dead && o.changes.length ? <span className="v1-choice-changes">What changes: {o.changes.join(" · ")}</span> : null}
                  {dead ? <span className="v1-choice-note">{o.nothing ? "The structure comes out the same." : "The tables do not allow it here: the part would still be needed."}</span> : null}
                  {!dead && o.issues.length
                    ? o.issues.slice(0, 2).map((t) => (
                        <span key={t} className="v1-choice-issue">
                          <TriangleAlert size={14} strokeWidth={2.5} aria-hidden="true" />
                          <span>{t}</span>
                        </span>
                      ))
                    : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {rows.map(([row, list]) => (
        <div key={row} className="v1-pick-sizes" role="group" aria-label={row}>
          <span className="v1-h4">{row}</span>
          <div className="v1-chips">
            {list.map((c) => {
              const o = c.current ? null : sizeOutcome(c);
              const refused = !!o && !held(o, c);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={cx("v1-chip", "v1-size", c.current && "is-on", refused && "is-refused", !!o && !refused && o.issues.length > 0 && "has-issues")}
                  aria-pressed={!!c.current}
                  disabled={c.current || refused || !o}
                  title={refused ? "The tables do not carry this size here" : o && o.issues.length ? o.issues[0] : undefined}
                  onClick={() => o && apply(c, o)}
                  data-deck-size={c.id}
                >
                  <span>{c.label}</span>
                  {o && !refused ? <span className={cx("v1-size-delta", "v1-num", o.delta < -0.5 && "is-less", o.delta > 0.5 && "is-more")}>{Math.abs(o.delta) < 0.5 ? "±$0" : `${o.delta < 0 ? "−" : "+"}${money(Math.abs(o.delta))}`}</span> : null}
                  {refused ? <span className="v1-size-delta">too small</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {locked && ref ? <p className="v1-pick-how">A saved deck opens view-only here: its parts can be looked at, not changed.</p> : null}
    </div>
  );
}

/** Under the 3D after a tap: what it did, and the way back. */
export function PartDoneLine({ done, onUndo, onClose }: { done: PartDone; onUndo: () => void; onClose: () => void }) {
  return (
    <p className="v1-part-done" role="status" data-deck-part-done>
      <span>{done.text}</span>
      <button type="button" className="v1-btn v1-btn-sm" onClick={onUndo} data-deck-part-undo>
        <Undo2 size={16} strokeWidth={2.5} aria-hidden="true" /> Undo
      </button>
      <button type="button" className="v1-btn v1-btn-sm v1-btn-quiet" onClick={onClose} aria-label="Dismiss">
        <X size={16} strokeWidth={2.5} aria-hidden="true" />
      </button>
    </p>
  );
}

/** What was taken out by hand, each with its way back. */
export function TakenOutLine({ list, onPutBack }: { list: TakenOut[]; onPutBack: (t: TakenOut) => void }) {
  if (!list.length) return null;
  return (
    <p className="v1-part-out" data-deck-taken-out>
      <span className="v1-meta">Taken out by you:</span>
      {list.map((t) => (
        <button key={t.id} type="button" className="v1-chip" onClick={() => onPutBack(t)} data-deck-put-back={t.id}>
          <span>{t.what}</span>
          <span className="v1-part-back">
            <Undo2 size={14} strokeWidth={2.5} aria-hidden="true" /> Put back
          </span>
        </button>
      ))}
    </p>
  );
}
