// THE STUDIO'S CHANGES, AS PURE FUNCTIONS (2026-10-21) — pure.
//
// Every change the studio makes to a design goes through the same three doors, so a size typed in a box, a knob dragged
// in 3D and a command said out loud (lib/deck/voice) end on the same deck: a patch laid over the design with the house
// and the deck kept in agreement (lib/deck/house) and the member sizes settled to the tables when the change resizes
// what they carry (lib/deck/settle); a roof patch, settled when it moves a span or a load; and a switch of what is built,
// which keeps the roof as set between a deck and a covered deck and starts any other kind from its own defaults.
// Moved here from the studio (components/v3/deck-variant-1/deck-v1-studio.tsx), which now calls them.

import { applyDeckPatch, type DeckPatch } from "./checks";
import { defaultRoofDesign, type DeckDesign, type RoofDesign, type RoofKind, type Structure } from "./design";
import { HOUSE_LIMITS, deckShapeForHouse, houseForShape } from "./house";
import { resizes, roofResizes } from "./settle";

/** The roof shapes each structure offers. A covered deck: shed, gable, hip; a gazebo: its own; a pergola: slats. */
export const KINDS_FOR: Record<Structure, RoofKind[]> = {
  deck: [],
  "covered-deck": ["shed", "gable", "hip"],
  gazebo: ["gable", "hip", "pyramid", "double-tier", "gambrel", "dutch-gable"],
  pergola: ["pergola"],
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A patch laid over the design: the house and the deck agree after it, and a resize settles the frame. */
export function patchDesign(d: DeckDesign, p0: DeckPatch, settle: (next: DeckDesign) => DeckDesign = (x) => x): DeckDesign {
  // A PLAIN SHAPE PICKED WHILE THE DECK RAN PAST THE HOUSE'S CORNER (2026-11-14) — a rectangle, an L, a bowed or a
  // clipped front: those hang on the wall, so the wall is behind the whole deck again (the house's corners go back out
  // to the deck's ends). Without this the pick would be undone at once: a deck past a corner keeps the shape that lets
  // it stand there.
  const pastNow = d.house.leftFt < 0 || d.house.rightFt < 0;
  const p: DeckPatch = p0.shape && p0.shape.kind !== "wall" && !p0.house && pastNow ? { ...p0, house: { leftFt: Math.max(0, d.house.leftFt), rightFt: Math.max(0, d.house.rightFt) } } : p0;
  let next = applyDeckPatch(d, p);
  // THE HOUSE AND THE DECK AGREE (lib/deck/house).
  if (p.house) {
    const fit = deckShapeForHouse(next.shape, next.house);
    if (!same(fit.shape, next.shape)) next = applyDeckPatch(next, { shape: fit.shape });
  } else if (p.shape) {
    const resized = p.shape.widthFt !== d.shape.widthFt || p.shape.depthFt !== d.shape.depthFt;
    // A house built from its photo is the real wall (2026-10-23): a wider or narrower deck does not stretch it — the
    // wall past the deck's right end gives up or takes what the deck took.
    const grew = next.shape.widthFt - d.shape.widthFt;
    // (A deck already past that corner goes farther past it, or comes back: the wall stays the photo's.)
    if (resized && grew && d.house.photo) next = applyDeckPatch(next, { house: { rightFt: Math.min(HOUSE_LIMITS.extendFt.max, Math.max(d.house.rightFt < 0 ? -HOUSE_LIMITS.pastFt.max : HOUSE_LIMITS.extendFt.min, d.house.rightFt - grew)) } });
    if (resized) {
      const fit = deckShapeForHouse(next.shape, next.house);
      if (!same(fit.shape, next.shape)) next = applyDeckPatch(next, { shape: fit.shape });
    } else {
      const h2 = houseForShape(next.house, next.shape);
      if (h2 !== next.house) next = applyDeckPatch(next, { house: h2 });
    }
  }
  return resizes(p) ? settle(next) : next;
}

/** A roof patch; a change to its spans or loads settles the frame. */
export function patchRoof(d: DeckDesign, p: Partial<RoofDesign>, settle: (next: DeckDesign) => DeckDesign = (x) => x): DeckDesign {
  const next = applyDeckPatch(d, { roof: { ...d.roof, ...p } });
  return roofResizes(p) ? settle(next) : next;
}

/** Switching what is built: a different kind of roof starts from its own defaults; deck ↔ covered deck keeps the roof as set. */
export function switchStructure(d: DeckDesign, next: Structure): DeckDesign {
  const family = (st: Structure) => (st === "deck" || st === "covered-deck" ? "cover" : st);
  const roof = family(next) === family(d.structure) && d.structure !== "deck" ? d.roof : next === "covered-deck" && d.structure === "deck" && KINDS_FOR["covered-deck"].includes(d.roof.kind) ? d.roof : defaultRoofDesign(next);
  return applyDeckPatch(d, { structure: next, roof, floor: next === "deck" || next === "covered-deck" ? "deck" : d.floor });
}
