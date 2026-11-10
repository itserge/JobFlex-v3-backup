"use client";

// THE BOARD'S COLOUR (2026-11-09). Owner: "add the exact colors that exist for this brand and type of the materials,
// and when we select any of those colors it should appear on the 3D design as well — whatever gets designed and the
// client sees, he gets."
//
// Under the board picker: the colours the picked line is sold in (lib/deck/deckingColors), each a small plank in the
// board's own tones with the maker's name under it. One tap and the 3D, the proposal and the material list carry it.
// A line with no list — a wood, a generic board, the contractor's own — and any colour the list does not have take a
// colour typed in: its name, and how it looks.

import * as React from "react";
import { Check, Pencil, X } from "lucide-react";
import { DECKING_COLORS_READ, deckingColors, type BoardColor } from "@/lib/deck/deckingColors";
import { railColorOf, railColors, type RailTypeId } from "@/lib/deck/catalog";
import type { OwnColor } from "@/lib/deck/design";
import { cx } from "./deck-v1-parts";

/** A plank in the colour's tones: a streaked board shows both. */
export function swatchStyle(hex: string, hex2?: string | null): React.CSSProperties {
  if (!hex2) return { background: hex };
  return { background: `linear-gradient(90deg, ${hex} 0 26%, ${hex2} 26% 41%, ${hex} 41% 63%, color-mix(in srgb, ${hex} 55%, ${hex2}) 63% 82%, ${hex2} 82% 100%)` };
}

export function BoardColorPicker({
  productId,
  productLabel,
  ownBoard,
  color,
  own,
  onPick,
  onOwn,
}: {
  productId: string;
  productLabel: string;
  /** A board of the contractor's own: no maker's list applies to it. */
  ownBoard: boolean;
  color: string;
  own: OwnColor | null;
  onPick: (id: string) => void;
  onOwn: (own: OwnColor | null) => void;
}) {
  const list: readonly BoardColor[] = ownBoard ? [] : deckingColors(productId);
  const [typing, setTyping] = React.useState(false);
  const [name, setName] = React.useState(own?.name ?? "");
  const [hex, setHex] = React.useState(own?.hex ?? "#8a6a4c");
  // Another board, or the colour changed from outside (a draft opened, Undo): the little form follows.
  const ownKey = `${productId}|${own?.name ?? ""}|${own?.hex ?? ""}`;
  const [seen, setSeen] = React.useState(ownKey);
  if (seen !== ownKey) {
    setSeen(ownKey);
    setName(own?.name ?? "");
    setHex(own?.hex ?? "#8a6a4c");
    if (!own) setTyping(false);
  }
  const open = typing || !!own;
  const picked = own ? null : list.find((c) => c.id === color) ?? null;
  const commit = (n: string, h: string) => {
    const clean = n.replace(/\s+/g, " ").trim();
    if (clean) onOwn({ name: clean, hex: h });
  };
  const groups = [...new Set(list.map((c) => c.group ?? ""))];

  return (
    <div className="v1-colors" data-deck-colors={productId}>
      <div className="v1-colors-head">
        <span className="v1-h4">Colour</span>
        <span className={cx("v1-colors-now", !picked && !own && list.length > 0 && "is-missing")} data-deck-color-now>
          {own ? own.name : picked ? picked.name : list.length ? "Not picked yet" : "As it comes"}
        </span>
      </div>
      {list.length ? (
        groups.map((g) => (
          <div key={g || "all"} className="v1-colors-group">
            {g ? <span className="v1-meta">{g}</span> : null}
            <div className="v1-planks" role="group" aria-label={g ? `${productLabel} colours — ${g}` : `${productLabel} colours`}>
              {list
                .filter((c) => (c.group ?? "") === g)
                .map((c) => {
                  const on = !own && c.id === color;
                  return (
                    <button key={c.id} type="button" className={cx("v1-plank", on && "is-on")} aria-pressed={on} onClick={() => onPick(on ? "" : c.id)} data-deck-color={c.id}>
                      <span className="v1-plank-chip" style={swatchStyle(c.hex, c.hex2)} aria-hidden="true">
                        {on ? <Check size={16} strokeWidth={3} /> : null}
                      </span>
                      <span className="v1-plank-name">{c.name}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))
      ) : null}
      {open ? (
        <div className="v1-own-color" data-deck-own-color>
          <label className="v1-own-color-name">
            <span className="v1-meta">{list.length ? "Another colour — its name" : "Stain or colour — its name"}</span>
            <input
              className="v1-in"
              type="text"
              value={name}
              maxLength={60}
              placeholder={list.length ? "As the yard lists it" : "e.g. Semi-transparent cedar stain"}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => commit(name, hex)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              aria-label="The colour's name"
              data-deck-own-color-name
            />
          </label>
          <label className="v1-own-color-look">
            <span className="v1-meta">How it looks</span>
            <input
              type="color"
              value={hex}
              onChange={(e) => {
                setHex(e.target.value);
                if (name.trim()) commit(name, e.target.value);
              }}
              aria-label="The colour in the 3D"
              data-deck-own-color-hex
            />
          </label>
          <button
            type="button"
            className="v1-btn v1-btn-sm v1-btn-quiet"
            onClick={() => {
              setTyping(false);
              setName("");
              onOwn(null);
            }}
            aria-label="Drop this colour"
          >
            <X size={16} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button type="button" className="v1-link v1-colors-other" onClick={() => setTyping(true)} data-deck-color-other>
          <Pencil size={14} strokeWidth={2.5} aria-hidden="true" /> {list.length ? "A colour that is not here" : "Name a stain or a colour"}
        </button>
      )}
      <p className="v1-hint">
        {list.length
          ? `${productLabel}'s colours as its maker listed them in ${DECKING_COLORS_READ}. The picture, the proposal and the material list carry the one you pick — check it is still stocked before you order. A screen shows a colour close, not exact: show the client a real sample.`
          : "This board has no maker's colour list. Name a stain or a colour and it prints on the proposal and the material list; the picture takes its look. A stain's cost is not in the price unless you add it as an item of your own."}
      </p>
    </div>
  );
}

/**
 * THE RAILING'S COLOUR (2026-11-09): the colours the picked system is stocked in (lib/deck/catalog RAIL_COLORS), the
 * system's usual one marked until another is tapped. A wood rail has none — it is the wood.
 */
export function RailColorPicker({ type, color, onPick }: { type: RailTypeId; color: string; onPick: (id: string) => void }) {
  const list = railColors(type);
  if (!list.length) return null;
  const now = railColorOf(type, color);
  return (
    <div className="v1-colors" data-deck-rail-colors={type}>
      <div className="v1-colors-head">
        <span className="v1-h4">{type === "cable" || type === "glass" ? "Frame and post colour" : "Rail colour"}</span>
        <span className="v1-colors-now" data-deck-rail-color-now>{now?.name}</span>
      </div>
      <div className="v1-planks is-rail" role="group" aria-label="Railing colours">
        {list.map((c) => {
          const on = now?.id === c.id;
          return (
            <button key={c.id} type="button" className={cx("v1-plank", on && "is-on")} aria-pressed={on} title={`Like ${c.like}`} onClick={() => onPick(c.id)} data-deck-rail-color={c.id}>
              <span className="v1-plank-chip" style={{ background: c.hex }} aria-hidden="true">
                {on ? <Check size={16} strokeWidth={3} /> : null}
              </span>
              <span className="v1-plank-name">{c.name}</span>
            </button>
          );
        })}
      </div>
      <p className="v1-hint">
        {now ? `Like ${now.like}. ` : ""}
        {type === "composite" ? "Composite rails are sold in these colours, not in the deck board's: no maker makes a rail to match its boards. " : ""}
        A colour can move the kit&apos;s price (black composite runs about a third over white): check your rail rate.
      </p>
    </div>
  );
}

/**
 * THE BORDER'S COLOUR (2026-11-10): a picture-frame border in a second colour of the same line — the deck's own
 * colour first ("Same as the deck"), then every other colour the line is sold in. Bought apart, drawn apart.
 */
export function BorderColorPicker({ productId, deckColor, color, onPick }: { productId: string; deckColor: string; color: string; onPick: (id: string) => void }) {
  const list = deckingColors(productId);
  if (!list.length) return null;
  const now = list.find((c) => c.id === color && c.id !== deckColor) ?? null;
  return (
    <div className="v1-colors" data-deck-border-colors={productId}>
      <div className="v1-colors-head">
        <span className="v1-h4">Border colour</span>
        <span className="v1-colors-now" data-deck-border-color-now>{now ? now.name : "Same as the deck"}</span>
      </div>
      <div className="v1-planks" role="group" aria-label="Border colour">
        <button type="button" className={cx("v1-plank", !now && "is-on")} aria-pressed={!now} onClick={() => onPick("")} data-deck-border-color="">
          <span className="v1-plank-chip v1-plank-same" aria-hidden="true">
            {!now ? <Check size={16} strokeWidth={3} /> : null}
          </span>
          <span className="v1-plank-name">Same as the deck</span>
        </button>
        {list
          .filter((c) => c.id !== deckColor)
          .map((c) => {
            const on = now?.id === c.id;
            return (
              <button key={c.id} type="button" className={cx("v1-plank", on && "is-on")} aria-pressed={on} onClick={() => onPick(c.id)} data-deck-border-color={c.id}>
                <span className="v1-plank-chip" style={swatchStyle(c.hex, c.hex2)} aria-hidden="true">
                  {on ? <Check size={16} strokeWidth={3} /> : null}
                </span>
                <span className="v1-plank-name">{c.name}</span>
              </button>
            );
          })}
      </div>
      <p className="v1-hint">A border in another colour is ordered apart from the deck&apos;s boards — it shows as its own line on the material list — and is drawn in its colour.</p>
    </div>
  );
}
