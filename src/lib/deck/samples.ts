// WHAT KIND OF A DECK PROJECT (2026-10-11, owner: "make it interactive samples
// of what kind of a deck project you do") — pure.
//
// The studio's first step used to offer four words. Now each kind — a deck,
// a covered deck, a gazebo, a pergola — is shown as a real design the engine
// builds (lib/deck/iso draws it), and under the chosen kind sit samples a
// contractor can start from: a ground-level platform, a classic deck with
// stairs, two levels, a wrap-around; a shed roof off the wall, a gable, a
// hip with a ceiling; an octagon on the lawn, a square gazebo on its deck, a
// screened two-tier one; a pergola on the house, louvers over a patio,
// arched rafters on their own.
//
// A sample is a PATCH over the contractor's design: the address, the state,
// the site's snow and frost, the house's wall and the shop's own lumber and
// decking stay as they were set; the sample brings the shape, the height,
// the rails, the stairs, the levels and the roof. The same patch over the
// stock design gives the picture on the card, so what is shown is what is
// applied.

import { defaultDeckDesign, defaultRoofDesign, defaultStair, STRUCTURE_LABEL, STRUCTURES, type DeckDesign, type RoofDesign, type Structure } from "./design";
import { applyDeckPatch, type DeckPatch } from "./checks";

export interface DeckSample {
  id: string;
  structure: Structure;
  name: string;
  /** "12 × 16 ft · 36 in. high · composite rails · one stair" */
  facts: string;
  patch: DeckPatch;
}

/** What each kind is, in a line, and what the price carries for it. */
export const KIND_WORDS: Record<Structure, { blurb: string; includes: string }> = {
  deck: { blurb: "The deck alone, on the house or on its own.", includes: "frame · boards · rails · stairs" },
  "covered-deck": { blurb: "A roof over the deck — off the house wall or on its own posts.", includes: "deck · posts · roof · gutters" },
  gazebo: { blurb: "Its own roof shape, on a deck, a slab or the ground.", includes: "posts · roof · walls or screens" },
  pergola: { blurb: "Open slats on posts and headers: shade, not shelter.", includes: "posts · headers · rafters · slats" },
};

const roof = (structure: Structure, over: Partial<RoofDesign>): RoofDesign => ({ ...defaultRoofDesign(structure), ...over });

export const DECK_SAMPLES: readonly DeckSample[] = [
  // ── decks ──
  {
    id: "deck-classic",
    structure: "deck",
    name: "Backyard deck with stairs",
    facts: "16 × 12 ft · 36 in. high · composite rails · stairs down the front",
    patch: { structure: "deck", floor: "deck", placement: "attached", shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 36, rail: { type: "composite", infill: "auto" }, stairs: [defaultStair("s1", "front", 8)], lower: { on: false } },
  },
  {
    id: "deck-ground",
    structure: "deck",
    name: "Ground-level platform",
    facts: "12 × 12 ft · 14 in. high · no rails needed · a step down",
    patch: { structure: "deck", floor: "deck", placement: "attached", shape: { kind: "rect", widthFt: 12, depthFt: 12 }, heightIn: 14, rail: { type: "none" }, stairs: [], lower: { on: false } },
  },
  // A DOUBLE DECK (2026-11-13 — the owner: "a double deck, like first floor and second floor").
  {
    id: "deck-double",
    structure: "deck",
    name: "Double deck — two floors",
    facts: "16 × 12 ft · a first-floor deck 18 in. up under a second-floor deck 10 ft 6 in. up · stairs from each",
    patch: {
      structure: "deck", floor: "deck", placement: "attached", shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 126,
      rail: { type: "aluminum", infill: "auto" }, lower: { on: true, place: "under", heightIn: 18 },
      stairs: [defaultStair("s1", "front", 4), { ...defaultStair("s2", "front", 12), level: "lower" }],
    },
  },
  {
    id: "deck-two-level",
    structure: "deck",
    name: "Two levels with a landing",
    facts: "18 × 12 ft · 48 in. high · a 12 × 8 ft lower level two steps down · stairs",
    patch: {
      structure: "deck", floor: "deck", placement: "attached", shape: { kind: "rect", widthFt: 18, depthFt: 12 }, heightIn: 48,
      rail: { type: "composite", infill: "auto" }, lower: { on: true, place: "front", widthFt: 12, depthFt: 8, dropIn: 15, align: "centre" },
      stairs: [{ ...defaultStair("s1", "front", 6), level: "lower" }],
    },
  },
  {
    id: "deck-spa",
    structure: "deck",
    name: "Hot-tub deck, two levels",
    facts: "16 × 14 ft · 7 × 7 ft tub spot on doubled joists · a 10 × 8 ft level one step down",
    patch: {
      structure: "deck", floor: "deck", placement: "attached", shape: { kind: "rect", widthFt: 16, depthFt: 14 }, heightIn: 24,
      rail: { type: "composite", infill: "auto" }, lower: { on: true, place: "front", widthFt: 10, depthFt: 8, dropIn: 8, align: "right" },
      spa: { on: true, widthFt: 7, depthFt: 7, align: "left" },
      stairs: [{ ...defaultStair("s1", "front", 5), level: "lower" }],
    },
  },
  {
    id: "deck-second-story",
    structure: "deck",
    name: "Second-story walk-out",
    facts: "16 × 12 ft · 9 ft up at the second floor · long stairs with a landing · composite rails",
    patch: {
      structure: "deck", floor: "deck", placement: "attached", shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 110,
      rail: { type: "composite", infill: "auto" }, lower: { on: false },
      stairs: [defaultStair("s1", "right", 4)],
    },
  },
  {
    id: "deck-wrap",
    structure: "deck",
    name: "L-shaped wrap-around",
    facts: "20 × 14 ft with an 8 × 6 ft notch · 36 in. high · aluminum rails · stairs",
    patch: {
      structure: "deck", floor: "deck", placement: "attached", shape: { kind: "L", widthFt: 20, depthFt: 14, notch: { corner: "front-right", widthFt: 8, depthFt: 6 } }, heightIn: 36,
      rail: { type: "aluminum", infill: "auto" }, stairs: [defaultStair("s1", "front", 6)], lower: { on: false },
    },
  },
  // ── covered decks ──
  {
    id: "covered-gable",
    structure: "covered-deck",
    name: "Gable roof on its own posts",
    facts: "16 × 14 ft deck · gable roof, 6:12 · tongue-and-groove ceiling · rails and stairs",
    patch: {
      structure: "covered-deck", floor: "deck", placement: "attached", shape: { kind: "rect", widthFt: 16, depthFt: 14 }, heightIn: 36,
      rail: { type: "composite", infill: "auto" }, stairs: [defaultStair("s1", "front", 8)], lower: { on: false },
      roof: roof("covered-deck", { kind: "gable", attach: "free", pitch: 6, ceiling: "tongue-groove" }),
    },
  },
  {
    id: "covered-shed",
    structure: "covered-deck",
    name: "Shed roof off the house wall",
    facts: "16 × 12 ft deck · shed roof on a ledger, 3:12 · gutters · rails and stairs",
    patch: {
      structure: "covered-deck", floor: "deck", placement: "attached", shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 30,
      rail: { type: "composite", infill: "auto" }, stairs: [defaultStair("s1", "front", 8)], lower: { on: false },
      roof: roof("covered-deck", { kind: "shed", attach: "wall", pitch: 3, eaveHeightIn: 96 }),
    },
  },
  {
    id: "covered-hip",
    structure: "covered-deck",
    name: "Hip roof with a ceiling and a fan",
    facts: "18 × 14 ft deck · hip roof, 5:12 · beadboard ceiling · a fan and two lights",
    patch: {
      structure: "covered-deck", floor: "deck", placement: "attached", shape: { kind: "rect", widthFt: 18, depthFt: 14 }, heightIn: 36,
      rail: { type: "composite", infill: "auto" }, stairs: [defaultStair("s1", "front", 9)], lower: { on: false },
      roof: roof("covered-deck", { kind: "hip", attach: "free", pitch: 5, ceiling: "beadboard", extras: { fan: true, lights: 2 } }),
    },
  },
  {
    id: "covered-second-story",
    structure: "covered-deck",
    name: "Covered second-story deck",
    facts: "16 × 12 ft at the second floor · shed roof, 3:12 · 9 ft up · stairs with a landing",
    patch: {
      structure: "covered-deck", floor: "deck", placement: "attached", shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 110,
      rail: { type: "composite", infill: "auto" }, stairs: [defaultStair("s1", "right", 4)], lower: { on: false },
      roof: roof("covered-deck", { kind: "shed", attach: "wall", pitch: 3 }),
    },
  },
  // ── gazebos ──
  {
    id: "gazebo-octagon",
    structure: "gazebo",
    name: "Octagon on a slab",
    facts: "12 ft across · pyramid roof, 6:12 · on a new concrete slab",
    patch: {
      structure: "gazebo", floor: "slab", placement: "detached", shape: { kind: "rect", widthFt: 12, depthFt: 12 }, stairs: [], lower: { on: false },
      roof: roof("gazebo", { kind: "pyramid", attach: "free", pitch: 6, plan: { shape: "octagon", widthFt: 12, depthFt: 12, acrossFt: 12, offsetFt: 0 } }),
    },
  },
  {
    id: "gazebo-square-deck",
    structure: "gazebo",
    name: "Square gazebo on its own deck",
    facts: "12 × 12 ft deck, 24 in. high · pyramid roof with a cupola · cedar rails · steps",
    patch: {
      structure: "gazebo", floor: "deck", placement: "detached", shape: { kind: "rect", widthFt: 12, depthFt: 12 }, heightIn: 24,
      rail: { type: "cedar", infill: "auto" }, stairs: [defaultStair("s1", "front", 6)], lower: { on: false },
      roof: roof("gazebo", { kind: "pyramid", attach: "free", pitch: 7, cupola: true }),
    },
  },
  {
    id: "gazebo-screened",
    structure: "gazebo",
    name: "Screened, with a two-tier roof",
    facts: "16 × 12 ft deck · double-tier roof · screens on three sides with a door",
    patch: {
      structure: "gazebo", floor: "deck", placement: "attached", shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 30,
      rail: { type: "composite", infill: "auto" }, stairs: [defaultStair("s1", "front", 8)], lower: { on: false },
      roof: roof("gazebo", { kind: "double-tier", attach: "free", pitch: 6, walls: { fill: "screen", sides: 3 } }),
    },
  },
  // ── pergolas ──
  {
    id: "pergola-attached",
    structure: "pergola",
    name: "On the house, over the deck",
    facts: "16 × 12 ft deck · flat slats off a ledger · 8 ft headroom",
    patch: {
      structure: "pergola", floor: "deck", placement: "attached", shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 20,
      rail: { type: "none" }, stairs: [], lower: { on: false },
      roof: roof("pergola", { attach: "wall", pergolaStyle: "flat", slats: { size: "2x2", spacingIn: 12 } }),
    },
  },
  {
    id: "pergola-louvered",
    structure: "pergola",
    name: "Louvers that turn, over a patio",
    facts: "14 × 12 ft · louvered top · on a new concrete slab",
    patch: {
      structure: "pergola", floor: "slab", placement: "detached", shape: { kind: "rect", widthFt: 14, depthFt: 12 }, stairs: [], lower: { on: false },
      roof: roof("pergola", { attach: "free", pergolaStyle: "louvered", plan: { shape: "rect", widthFt: 14, depthFt: 12, acrossFt: 12, offsetFt: 0 } }),
    },
  },
  {
    id: "pergola-arched",
    structure: "pergola",
    name: "Arched rafters on the lawn",
    facts: "12 × 12 ft · arched 2x4 slats · posts on their own footings",
    patch: {
      structure: "pergola", floor: "ground", placement: "detached", shape: { kind: "rect", widthFt: 12, depthFt: 12 }, stairs: [], lower: { on: false },
      roof: roof("pergola", { attach: "free", pergolaStyle: "arched", slats: { size: "2x4", spacingIn: 16 }, plan: { shape: "square", widthFt: 12, depthFt: 12, acrossFt: 12, offsetFt: 0 } }),
    },
  },
];

/** The samples of one kind, the card's own first. */
export function samplesFor(structure: Structure): DeckSample[] {
  return DECK_SAMPLES.filter((s) => s.structure === structure);
}

/** The design on the kind's card: its first sample. */
export function kindSample(structure: Structure): DeckSample {
  const s = samplesFor(structure)[0];
  if (!s) throw new Error(`no sample for ${structure}`);
  return s;
}

export function sampleById(id: string): DeckSample | null {
  return DECK_SAMPLES.find((s) => s.id === id) ?? null;
}

/** The sample laid over a design (the stock one for a picture; the contractor's own when it is applied). */
export function sampleDesign(sample: DeckSample, base: DeckDesign = defaultDeckDesign()): DeckDesign {
  return applyDeckPatch(base, sample.patch);
}

/** "Deck", "Covered deck"… in the order the cards stand. */
export const KINDS: ReadonlyArray<{ structure: Structure; label: string }> = STRUCTURES.map((structure) => ({ structure, label: STRUCTURE_LABEL[structure] }));
