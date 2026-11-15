// BOARDS OF THEIR OWN FOR THE STEPS AND THE BUILT-INS (2026-11-14) — pure.
//
// Owner: "when I click on the 3D, for example, steps around, I can replace a different material or colour. And the same
// with the bench — colour and material. So I click and I can change the colours or material on the steps and the
// accessories."
//
// A stair's treads (a flight, its landings, box steps round the deck) and a built-in's boards (a bench's seat and back,
// a planter's sides, a privacy screen's boards, their caps and aprons) were always the deck's own boards. Each may now
// have a board of its own: any line of the catalog in any colour of that line — composite steps on a cedar deck, a
// bench in a contrasting colour. Absent, it is the deck's own, whatever the deck's boards become.
//
// The frame of a stair and of a built-in (stringers, legs, cleats, posts) stays treated lumber as before; only what
// shows — the boards — changes. The material list buys those boards as their own line, at their own price; the 3D
// draws them in their own colour; the click card picks them.

import { DECKING, DECKING_FAMILY_LABEL, DECKING_FAMILY_ORDER, deckingProduct, type DeckingFamily, type DeckingProduct } from "./catalog";
import { deckingColor, deckingColors, deckingLook, deckingNamed } from "./deckingColors";

/** A board of its own: a line of the catalog (its id) and a colour of that line (its id; "" = the line's usual tone). */
export interface PartFinish {
  product: string;
  color: string;
}

/** What may carry boards of its own: a stair (its id) or a built-in (its id). */
export type FinishTarget = { kind: "stair"; id: string } | { kind: "built-in"; id: string };

/** A board of its own read back: a line the catalog has, a colour that line has — else none (the deck's own). */
export function normalizeFinish(raw: unknown): PartFinish | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const product = typeof o.product === "string" ? DECKING.find((d) => d.id === o.product)?.id : undefined;
  if (!product) return null;
  const color = typeof o.color === "string" && deckingColors(product).some((c) => c.id === o.color) ? o.color : "";
  return { product, color };
}

/**
 * The board a stair or a built-in is laid in: its own, resolved the way the deck's is (named with its colour, looking
 * like it, lib/deck/frame) — or, without one, the deck's own board as the frame resolved it.
 */
export function finishProduct(deck: DeckingProduct, f: PartFinish | null | undefined): DeckingProduct {
  if (!f) return deck;
  const p = deckingProduct(f.product);
  const look = deckingLook(p, { color: f.color, ownColor: null });
  return { ...p, label: deckingNamed(p.label, look.name), color: look.hex, ...(look.name ? { colorName: look.name } : {}), ...(look.hex2 ? { color2: look.hex2 } : {}) };
}

/** The same board: the same line in the same colour (none = the deck's own). */
export function sameFinish(a: PartFinish | null | undefined, b: PartFinish | null | undefined): boolean {
  return (!a && !b) || (!!a && !!b && a.product === b.product && a.color === b.color);
}

/** A key that tells boards of their own apart in a material line's id: "trex-select.saddle", "cedar-54". */
export const finishKey = (f: PartFinish) => (f.color ? `${f.product}.${f.color}` : f.product);

/** "Trex Transcend Lineage in Jasper" — or "the deck's own boards". */
export function finishWords(f: PartFinish | null | undefined): string {
  if (!f) return "the deck's own boards";
  const p = deckingProduct(f.product);
  return deckingNamed(p.label, deckingColor(p.id, f.color)?.name ?? null);
}

/** Every line, grouped as the studio groups them (treated, softwood, hardwood… composite, PVC…), for the card's list. */
export function finishLines(): Array<{ family: DeckingFamily; label: string; products: Array<{ id: string; label: string }> }> {
  return DECKING_FAMILY_ORDER.map((family) => ({ family, label: DECKING_FAMILY_LABEL[family], products: DECKING.filter((d) => d.family === family).map((d) => ({ id: d.id, label: d.label })) })).filter((g) => g.products.length > 0);
}

/** The colours a line comes in — each with its look — for the card's swatches. None for a line sold in one tone. */
export function finishColors(productId: string): Array<{ id: string; name: string; hex: string; hex2?: string }> {
  return deckingColors(productId).map((c) => ({ id: c.id, name: c.name, hex: c.hex, ...(c.hex2 ? { hex2: c.hex2 } : {}) }));
}

/** The family's word for a line's riser and apron boards: composite and PVC lines have their own fascia, the rest are wood. */
export const finishFasciaKey = (p: Pick<DeckingProduct, "family">) => (p.family === "composite" || p.family === "pvc" ? "fascia.composite" : "fascia.wood");
