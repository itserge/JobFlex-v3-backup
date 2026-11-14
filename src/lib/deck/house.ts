// THE HOUSE THE DECK STANDS AGAINST (2026-10-11; owner: "let's not use the
// picture at all — use the 3D model and draw the house; make it look like a
// house, not a shed; one or two storeys; a tool to adjust the 3D home — jogs,
// move the walls left and right; start from the shape of the back wall where
// the deck will be attached, then set the deck in; make it smart"). Pure.
//
// The house is the deck's: its back wall runs along the house line, past the
// deck's two ends by `leftFt` and `rightFt`; it steps where the contractor
// says (a jog: to the RIGHT of `atFt` the wall comes `depthFt` toward the
// yard, or steps back), measured in the deck's feet from its left end, so
// the deck's own knobs never move them. The part of the wall under the deck's
// main back edge is the house line; a bump-out at the deck's end notches the
// deck around it on its own, and (2026-10-19) any other step under the deck —
// the wall set back, a bump-out in the middle, several — makes the deck follow
// the wall (shape kind "wall"); only a step the deck cannot follow is said in
// a note instead of being drawn wrong.
//
// BUILT FROM A PHOTO (2026-10-23; owner: "upload the picture of my back wall … get from that picture approximate shape
// already, and even windows and where the doors is … the color of the house … a window's height, two-story,
// one-story, the roof shape … it's not supposed to be very accurate, but if you can make it accurate would be nice"):
// a house may carry its real windows and doors (`openings`, in the deck's feet like the steps), its own colours as
// #rrggbb beside the presets, what the wall is clad in, bump-outs as tall as the house, and the photo it was built
// from (lib/deck/houseFromPhoto) — kept to look back at, never pasted on the wall. Only the house itself: what stands
// in front of it (a porch roof, an old deck, a patio) is not taken off the photo (owner, 2026-10-23: "read just a shape
// of that back wall and don't show existing deck or porch roofs, just shape and windows"). Without them the house is
// drawn by rule, as before.
import { BACK_LIMITS, DECK_LIMITS, normalizeBack, partsShape, type BackPart, type DeckShape } from "./design";
import { normalizeHouseRead, type HouseRead } from "./houseRead";

/** The house's roof (2026-10-23, the shapes a photo shows): a hip, a gable with its ridge along the back wall (the triangles
 *  at the sides), a gable with its end — the triangle — facing the yard, a shed sloping down toward the yard, a flat roof. */
export type HouseRoof = "hip" | "gable" | "gable-end" | "shed" | "flat";
export const HOUSE_ROOFS: readonly HouseRoof[] = ["hip", "gable", "gable-end", "shed", "flat"];
export const HOUSE_ROOF_LABEL: Record<HouseRoof, string> = { hip: "Hip", gable: "Gable", "gable-end": "Gable to the yard", shed: "Shed", flat: "Flat" };
/** The roof in a sentence. */
export const HOUSE_ROOF_WORDS: Record<HouseRoof, string> = { hip: "hip roof", gable: "gable roof", "gable-end": "gable roof, its end to the yard", shed: "shed roof", flat: "flat roof" };
/** Inches of rise per foot: what each roof is drawn at unless its pitch is set (a photo's, or the contractor's). */
export const HOUSE_PITCH_DEFAULT: Record<HouseRoof, number> = { hip: 6, gable: 6, "gable-end": 6, shed: 3, flat: 0.25 };
export const HOUSE_PITCH_LIMITS = { min: 1, max: 14 } as const;
export const roofPitch = (house: HouseDesign) => (house.roof === "flat" ? HOUSE_PITCH_DEFAULT.flat : (house.pitch ?? HOUSE_PITCH_DEFAULT[house.roof]));
export type JogDir = "toward" | "away";
export interface HouseJog {
  id: string;
  /** Along the house, in the deck's feet from its left end (negative past the left end, past `widthFt` beyond the right). */
  atFt: number;
  /** What the wall to the RIGHT of the step does: comes toward the yard, or steps back. */
  dir: JogDir;
  depthFt: number;
}
/**
 * A PART OF THE WALL WITH ITS OWN HEIGHT AND ROOF (2026-11-13, owner, of a photo of a two-storey house whose right
 * half is one storey under a low roof of its own: "when you convert the picture to 3D, use the same roof … make it
 * smart to understand the jogs"). Until now every part stood under the house's one roof, a bump-out one storey or
 * full height for the whole house at once.
 *   storeys  how many storeys of wall THIS part's own face has. Absent = the old rule: as tall as the house, a
 *            bump-out by `bumpOuts`.
 *   roof     the part's own roof when it stands lower than the house's (or comes out under a roof of its own):
 *            a lean-to against the taller wall ("shed"), a hip, a gable, a flat roof. Absent = the house's kind.
 *   wing     the part is ALL the house there is at that spot — a one-storey wing beside the two-storey block, no
 *            taller wall behind or above it. Absent = a one-storey part in front of the taller house (its upper
 *            windows stay on the wall above it).
 */
export type PartRoof = "hip" | "gable" | "shed" | "flat";
export const PART_ROOFS: readonly PartRoof[] = ["shed", "hip", "gable", "flat"];
export const PART_ROOF_LABEL: Record<PartRoof, string> = { shed: "Lean-to", hip: "Hip", gable: "Gable", flat: "Flat" };
export interface HousePart {
  storeys?: 1 | 2;
  roof?: PartRoof;
  wing?: true;
}
/** A part's own entry, when the list still matches the wall's parts (a step added or taken away since makes it stale: it is then ignored). */
export function housePartAt(house: Pick<HouseDesign, "parts" | "jogs">, i: number): HousePart | null {
  return house.parts && house.parts.length === house.jogs.length + 1 ? (house.parts[i] ?? null) : null;
}

export interface HouseDesign {
  storeys: 1 | 2;
  /** Ground to eave at the photo's scale. Absent on houses drawn by rule. */
  eaveHeightFt?: number;
  roof: HouseRoof;
  /**
   * How far the back wall runs past the deck's left and right ends, ft. NEGATIVE (2026-11-14) where the deck runs past
   * the house instead: −6 = the house's corner stands 6 ft inside the deck's end, and the deck goes on past it.
   */
  leftFt: number;
  rightFt: number;
  /**
   * AROUND THE CORNER (2026-11-14 — the owner: "go back past the house, on the sides"): where the deck runs past a
   * corner of the house, how far it goes BACK from the house line along the house's side wall, ft. Absent = it stops
   * at the house line.
   */
  wrapLeftFt?: number;
  wrapRightFt?: number;
  jogs: HouseJog[];
  /** The look (2026-10-11, "the client would say: this is my house"): the siding's colour and the roof's — a preset, or (2026-10-23) the house's own colour off a photo. */
  siding: SidingId | HouseHex;
  roofColour: RoofColourId | HouseHex;
  /** What the wall is clad in (2026-10-23). Absent = lap siding. */
  material?: HouseMaterial;
  /** The roof's pitch, inches of rise per foot (2026-10-23). Absent = the roof's own default (HOUSE_PITCH_DEFAULT). */
  pitch?: number;
  /** A two-storey house's bump-outs: one storey tall (the rule) or as tall as the house (as a photo shows them). Absent = one storey. */
  bumpOuts?: "low" | "full";
  /** Each part of the wall, left to right (one more than the steps), where it has a height or a roof of its own; null = by the rule. */
  parts?: Array<HousePart | null> | null;
  /** The windows and doors where they really are (2026-10-23, built from a photo). Absent or null = drawn by rule: a door on the deck's main back edge, windows every 5 ft. */
  openings?: HouseOpening[] | null;
  /** The photo the house was built from. */
  photo?: HousePhoto | null;
}

/** A colour of the house's own, "#rrggbb". */
export type HouseHex = `#${string}`;
export const isHouseHex = (v: unknown): v is HouseHex => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

export type HouseMaterial = "lap" | "brick" | "stucco" | "board-batten" | "stone";
export const HOUSE_MATERIALS: readonly HouseMaterial[] = ["lap", "brick", "stucco", "board-batten", "stone"];
export const HOUSE_MATERIAL_LABEL: Record<HouseMaterial, string> = { lap: "Lap siding", brick: "Brick", stucco: "Stucco", "board-batten": "Board and batten", stone: "Stone" };

export type OpeningKind = "window" | "door" | "slider" | "garage";
export const OPENING_LABEL: Record<OpeningKind, string> = { window: "Window", door: "Door", slider: "Sliding door", garage: "Garage door" };
/** A window or a door in the back wall: its middle along the house (the deck's feet from its left end), its size, and its bottom above the ground (a door's threshold), ft. */
export interface HouseOpening {
  id: string;
  kind: OpeningKind;
  xFt: number;
  widthFt: number;
  heightFt: number;
  sillFt: number;
}
export const OPENING_LIMITS = { count: 40, widthFt: { min: 1, max: 20 }, heightFt: { min: 1, max: 12 }, sillFt: { min: 0, max: 30 } } as const;
/** A sill or a threshold is kept to the inch (2026-10-23): the deck's surface is checked against a door's threshold in
 *  inches (lib/deck/openingChecks) — a quarter foot was 3 in. Older designs' quarter feet read back the same. */
export const toInchFt = (ft: number) => Math.round(ft * 12) / 12;


/** The photo a house was built from: the stored picture, the read in its own fractions (so the house can be built again without a second look), the wall's width it gave, what set the scale, and where the deck's left end stood along that wall. */
export interface HousePhoto {
  url: string;
  w: number;
  h: number;
  read: HouseRead | null;
  wallFt: number;
  by: "line" | "door" | "eave" | "width" | "none";
  deckAtFt: number;
  at: string;
}

export type SidingId = "white" | "cream" | "grey" | "blue" | "sage";
export type RoofColourId = "charcoal" | "brown" | "slate" | "forest" | "terracotta";
export const SIDINGS: ReadonlyArray<{ id: SidingId; label: string; hex: string }> = [
  { id: "white", label: "White", hex: "#f2f0ea" },
  { id: "cream", label: "Cream", hex: "#e9e5db" },
  { id: "grey", label: "Grey", hex: "#b7babb" },
  { id: "blue", label: "Blue-grey", hex: "#8ea3b1" },
  { id: "sage", label: "Sage", hex: "#a7b39b" },
];
export const ROOF_COLOURS: ReadonlyArray<{ id: RoofColourId; label: string; hex: string }> = [
  { id: "charcoal", label: "Charcoal", hex: "#55524c" },
  { id: "brown", label: "Brown", hex: "#5b4a3b" },
  { id: "slate", label: "Slate", hex: "#6b7280" },
  { id: "forest", label: "Forest", hex: "#4a5e4f" },
  { id: "terracotta", label: "Terracotta", hex: "#9a5a44" },
];
export const sidingHex = (id: SidingId | HouseHex) => (isHouseHex(id) ? id.toLowerCase() : (SIDINGS.find((c) => c.id === id)?.hex ?? SIDINGS[1].hex));
export const roofHex = (id: RoofColourId | HouseHex) => (isHouseHex(id) ? id.toLowerCase() : (ROOF_COLOURS.find((c) => c.id === id)?.hex ?? ROOF_COLOURS[0].hex));

/** A step shallower than half a foot is no step: it is dropped, which is how a wall dragged level loses its step. */
export const HOUSE_LIMITS = {
  extendFt: { min: 0, max: 60 },
  depthFt: { min: 0.5, max: 12 },
  jogs: 6,
  /** The deck past a corner of the house (2026-11-14): 2 ft at least (less is no part of a deck to frame — the design's BACK_LIMITS.partFt), 30 at most; the wall keeps 4 ft of the deck. */
  pastFt: { min: 2, max: 30, keepFt: 4 },
  /** …and back along the house's side wall (the design's BACK_LIMITS.wrapFt; plain numbers here — this module and the design's load each other). */
  wrapFt: { min: 0, max: 24 },
} as const;
/** Floor to floor. */
export const STOREY_FT = 9.5;
/** How deep the house is drawn behind its back wall. */
export const HOUSE_BODY_FT = 24;
/** The notch a bump-out makes: never narrower than this, never deeper than the deck less this. */
const NOTCH_MIN_FT = 2;
const NOTCH_KEEP_FT = 3;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const half = (n: number) => Math.round(n * 2) / 2;
const r2 = (n: number) => Math.round(n * 100) / 100;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function defaultHouse(): HouseDesign {
  return { storeys: 1, roof: "hip", leftFt: 4, rightFt: 4, jogs: [], siding: "cream", roofColour: "charcoal" };
}

/** The design read back: numbers held to their limits, the steps sorted and kept inside the wall, a back notch of the shape given its step. */
export function normalizeHouse(raw: unknown, shape: DeckShape): HouseDesign {
  const d = defaultHouse();
  const r = obj(raw);
  const storeys: 1 | 2 = r.storeys === 2 ? 2 : 1;
  const roof: HouseRoof = HOUSE_ROOFS.includes(r.roof as HouseRoof) ? (r.roof as HouseRoof) : "hip";
  const W = shape.widthFt;
  // PAST THE HOUSE'S CORNER (2026-11-14): a negative reach is the deck running on past the corner — 2 ft at least (a
  // corner dragged a hair inside the deck's end stays AT its end), 30 at most, and the two ends together leave the
  // wall 4 ft of the deck.
  const P = HOUSE_LIMITS.pastFt;
  const reach = (v: unknown, fallback: number, room: number) => {
    const n = half(clamp(num(v, fallback), -Math.max(0, Math.min(P.max, room)), HOUSE_LIMITS.extendFt.max));
    return n < 0 && n > -P.min ? 0 : n;
  };
  const leftFt = reach(r.leftFt, d.leftFt, Math.floor((W - P.keepFt) * 2) / 2);
  const rightFt = reach(r.rightFt, d.rightFt, Math.floor((W - P.keepFt - Math.max(0, -leftFt)) * 2) / 2);
  const seen = new Set<string>();
  const jogs: HouseJog[] = (Array.isArray(r.jogs) ? r.jogs : [])
    .map((j, i) => {
      const o = obj(j);
      const id = typeof o.id === "string" && o.id && !seen.has(o.id) ? o.id : `j${i + 1}`;
      seen.add(id);
      return { id, atFt: half(num(o.atFt, 0)), dir: (o.dir === "away" ? "away" : "toward") as JogDir, depthFt: half(clamp(num(o.depthFt, 2), 0, HOUSE_LIMITS.depthFt.max)) };
    })
    .filter((j) => j.depthFt >= HOUSE_LIMITS.depthFt.min && j.atFt > -leftFt + 0.5 && j.atFt < W + rightFt - 0.5)
    .sort((a, b) => a.atFt - b.atFt)
    .slice(0, HOUSE_LIMITS.jogs);
  // Two steps on one spot: the second is dropped.
  const spaced = jogs.filter((j, i) => i === 0 || j.atFt - jogs[i - 1].atFt >= 1);
  const siding = SIDINGS.some((c) => c.id === r.siding) ? (r.siding as SidingId) : isHouseHex(r.siding) ? (r.siding.toLowerCase() as HouseHex) : d.siding;
  const roofColour = ROOF_COLOURS.some((c) => c.id === r.roofColour) ? (r.roofColour as RoofColourId) : isHouseHex(r.roofColour) ? (r.roofColour.toLowerCase() as HouseHex) : d.roofColour;
  // The steps are kept exactly as given: the read-back never adds one for a back notch (the studio does that once, when
  // a design opens) and never drops one (a step just removed must stay removed, so the deck can go back to a rectangle).
  const out: HouseDesign = { storeys, roof, leftFt, rightFt, jogs: spaced, siding, roofColour };
  // What a photo brought (2026-10-23) — only when it is there, so a house without it reads back exactly as before.
  if (HOUSE_MATERIALS.includes(r.material as HouseMaterial) && r.material !== "lap") out.material = r.material as HouseMaterial;
  if (typeof r.pitch === "number" && Number.isFinite(r.pitch)) out.pitch = half(clamp(r.pitch, HOUSE_PITCH_LIMITS.min, HOUSE_PITCH_LIMITS.max));
  if (r.bumpOuts === "full") out.bumpOuts = "full";
  // The parts' own heights and roofs: kept only while they still line up with the steps as read back.
  if (Array.isArray(r.parts) && Array.isArray(r.jogs) && spaced.length === r.jogs.length && r.parts.length === spaced.length + 1) {
    const parts = r.parts.map((raw): HousePart | null => {
      const o = obj(raw);
      const part: HousePart = {};
      if (o.storeys === 1 || o.storeys === 2) part.storeys = o.storeys;
      if (PART_ROOFS.includes(o.roof as PartRoof)) part.roof = o.roof as PartRoof;
      if (o.wing === true) part.wing = true;
      return part.storeys || part.roof || part.wing ? part : null;
    });
    if (parts.some(Boolean)) out.parts = parts;
  }
  if (typeof r.eaveHeightFt === "number" && Number.isFinite(r.eaveHeightFt) && r.eaveHeightFt >= 4 && r.eaveHeightFt <= 60) out.eaveHeightFt = toInchFt(r.eaveHeightFt);
  if (Array.isArray(r.openings)) out.openings = normalizeOpenings(r.openings, -leftFt, W + rightFt);
  // How far back along the house's side — only where the deck is past that corner, and no deeper than a deck goes.
  const wrap = (v: unknown) => half(clamp(num(v, 0), HOUSE_LIMITS.wrapFt.min, Math.max(0, Math.min(HOUSE_LIMITS.wrapFt.max, Math.floor((DECK_LIMITS.depthFt.max - shape.depthFt) * 2) / 2))));
  if (leftFt < 0 && wrap(r.wrapLeftFt) > 0) out.wrapLeftFt = wrap(r.wrapLeftFt);
  if (rightFt < 0 && wrap(r.wrapRightFt) > 0) out.wrapRightFt = wrap(r.wrapRightFt);
  const photo = normalizeHousePhoto(r.photo);
  if (photo) out.photo = photo;
  return out;
}

/** The windows and doors read back: sizes held to their limits, each inside the wall's reach, left to right. */
export function normalizeOpenings(raw: unknown[], fromFt: number, toFt: number): HouseOpening[] {
  const seen = new Set<string>();
  return raw
    .map((o, i) => {
      const v = obj(o);
      const kind: OpeningKind = v.kind === "door" || v.kind === "slider" || v.kind === "garage" ? v.kind : "window";
      const id = typeof v.id === "string" && v.id && !seen.has(v.id) ? v.id : `o${i + 1}`;
      seen.add(id);
      const L = OPENING_LIMITS;
      return { id, kind, xFt: toInchFt(num(v.xFt, NaN)), widthFt: toInchFt(clamp(num(v.widthFt, 3), L.widthFt.min, L.widthFt.max)), heightFt: toInchFt(clamp(num(v.heightFt, 4), L.heightFt.min, L.heightFt.max)), sillFt: toInchFt(clamp(num(v.sillFt, 3), L.sillFt.min, L.sillFt.max)) };
    })
    .filter((o) => Number.isFinite(o.xFt) && o.xFt - o.widthFt / 2 >= fromFt - 0.5 && o.xFt + o.widthFt / 2 <= toFt + 0.5)
    .sort((a, b) => a.xFt - b.xFt || a.sillFt - b.sillFt)
    .slice(0, OPENING_LIMITS.count);
}


function normalizeHousePhoto(raw: unknown): HousePhoto | null {
  const v = obj(raw);
  if (typeof v.url !== "string" || !v.url || v.url.length > 400_000) return null;
  const w = num(v.w, 0);
  const h = num(v.h, 0);
  if (!(w > 0 && h > 0)) return null;
  const by = v.by === "line" || v.by === "door" || v.by === "eave" || v.by === "width" ? v.by : "none";
  return { url: v.url, w: Math.round(w), h: Math.round(h), read: normalizeHouseRead(v.read), wallFt: r2(clamp(num(v.wallFt, 0), 0, 400)), by, deckAtFt: r2(clamp(num(v.deckAtFt, 0), -400, 400)), at: typeof v.at === "string" ? v.at.slice(0, 40) : "" };
}

/** The windows and the doors moved along the house by `d` ft in the deck's feet (the deck slid with the house still). */
export function shiftHouseThings(house: HouseDesign, d: number): Pick<HouseDesign, "openings" | "photo"> {
  const out: Pick<HouseDesign, "openings" | "photo"> = {};
  if (house.openings) out.openings = house.openings.map((o) => ({ ...o, xFt: toInchFt(o.xFt + d) }));
  else if (house.openings === null) out.openings = null;
  if (house.photo) out.photo = { ...house.photo, deckAtFt: r2(house.photo.deckAtFt - d) };
  return out;
}

/** One part of the back wall between two steps, in the deck's feet; `depthFt` is how far it stands toward the yard against the house line (the part under the deck's main back edge). */
export interface WallPart {
  x0: number;
  x1: number;
  depthFt: number;
}

/** The deck's main back edge along the house, in the deck's feet: a back notch takes its corner off it. */
export function mainSpan(shape: DeckShape): { x0: number; x1: number } {
  const W = shape.widthFt;
  if (shape.kind === "L" && shape.notch.corner === "back-right") return { x0: 0, x1: W - shape.notch.widthFt };
  if (shape.kind === "L" && shape.notch.corner === "back-left") return { x0: shape.notch.widthFt, x1: W };
  return { x0: 0, x1: W };
}
/** The middle of that edge. */
export function referenceX(shape: DeckShape): number {
  const m = mainSpan(shape);
  return (m.x0 + m.x1) / 2;
}
/** Which part of the wall the deck's main back edge mostly runs along — the house line. */
export function referencePartIndex(parts: ReadonlyArray<{ x0: number; x1: number }>, shape: DeckShape): number {
  const m = mainSpan(shape);
  let best = 0;
  let most = -Infinity;
  parts.forEach((p, i) => {
    const overlap = Math.min(p.x1, m.x1) - Math.max(p.x0, m.x0);
    if (overlap > most) {
      most = overlap;
      best = i;
    }
  });
  return best;
}
function referencePart<T extends { x0: number; x1: number }>(parts: T[], shape: DeckShape): T {
  return parts[referencePartIndex(parts, shape)];
}

/** The back wall as parts, left to right, each at its depth against the house line. */
export function wallParts(house: HouseDesign, shape: DeckShape): WallPart[] {
  const W = shape.widthFt;
  const xs = [-house.leftFt, ...house.jogs.map((j) => j.atFt), W + house.rightFt];
  const depths = [0];
  for (const j of house.jogs) depths.push(depths[depths.length - 1] + (j.dir === "toward" ? j.depthFt : -j.depthFt));
  const parts: WallPart[] = [];
  for (let i = 0; i + 1 < xs.length; i++) parts.push({ x0: xs[i], x1: xs[i + 1], depthFt: depths[i] });
  const base = referencePart(parts, shape).depthFt;
  return parts.map((p) => ({ x0: r2(p.x0), x1: r2(p.x1), depthFt: r2(p.depthFt - base) }));
}

/** The parts the deck's back edge runs along, clipped to its span. */
function partsUnderDeck(parts: WallPart[], W: number): WallPart[] {
  return parts.map((p) => ({ x0: Math.max(p.x0, 0), x1: Math.min(p.x1, W), depthFt: p.depthFt })).filter((p) => p.x1 - p.x0 > 0.5);
}

const ftWords = (n: number) => `${Math.round(n * 2) / 2} ft`;

/**
 * The deck's shape made to fit the wall: a bump-out that takes one END of the deck's back edge becomes a back notch of
 * that size (an L); no step under the deck takes a back notch away. Anything else (owner, 2026-10-19: "deck should
 * follow house wall when moving wall in set out set") — the wall set back under the deck, a bump-out in the middle,
 * two or more — and the deck's back FOLLOWS the wall: it reaches into a set-back, its ledger on that wall, and steps
 * around a bump-out. What it cannot follow is said in a note: a curved or clipped front or a front corner cut (the
 * deck follows the wall with a straight front), a set-back deeper than the deck may reach, a bump-out that leaves
 * less than a 3-ft leg in front of it.
 */
export function deckShapeForHouse(shape: DeckShape, house: HouseDesign): { shape: DeckShape; note: string | null } {
  const W = shape.widthFt;
  const D = shape.depthFt;
  const under = partsUnderDeck(wallParts(house, shape), W);
  // Past a corner of the house (2026-11-14): the deck follows what wall there is, and stands on its own beyond it.
  const past = deckPast(house);
  if (past.leftFt > 0 || past.rightFt > 0) return followWall(shape, under, past);
  const out = under.filter((p) => p.depthFt > 0.5);
  const back = under.filter((p) => p.depthFt < -0.5);
  const hasBackNotch = shape.kind === "L" && shape.notch.corner.startsWith("back");
  // A FRONT SET PART BY PART (2026-11-14) stays the deck's whatever the wall does behind it: the deck keeps its parts
  // along a straight wall, and follows a stepped one part by part (no corner notch in its place).
  const parted = shape.kind === "wall" && shape.front ? shape.front : null;
  // A wall brought level takes away the notch, or the steps the deck followed.
  const rect = (): DeckShape => (parted ? partsOn(W, D, [{ x0Ft: 0, x1Ft: W, yFt: 0 }], parted) : hasBackNotch || shape.kind === "wall" ? { kind: "rect", widthFt: W, depthFt: D } : shape);
  if (!out.length && !back.length) return { shape: rect(), note: null };
  if (!back.length && out.length === 1 && !parted) {
    const t = out[0];
    if (t.x0 <= 0.01 && t.x1 >= W - 0.01) return { shape: rect(), note: null };
    const atRight = t.x1 >= W - 0.01 && t.x0 > 0.01;
    const atLeft = t.x0 <= 0.01 && t.x1 < W - 0.01;
    if (atRight || atLeft) return endNotch(shape, t, atRight, rect);
  }
  return followWall(shape, under);
}

/** The deck's back made to follow every part of the wall under it — or the shape kept, with what stops it in a note. */
function followWall(shape: DeckShape, under: WallPart[], past: DeckPast | null = null): { shape: DeckShape; note: string | null } {
  const W = shape.widthFt;
  const D = shape.depthFt;
  const front = shape.kind === "rect" ? shape.front : undefined;
  const frontCut = shape.kind === "L" && shape.notch.corner.startsWith("front");
  const shapedFront = (front && front.kind !== "straight") || frontCut;
  // (Past a corner there is no wall to hang on: the deck takes the straight front that lets it stand there, and says so.)
  if (shapedFront && !past) {
    return { shape, note: `The wall steps under the deck — the deck follows the wall's steps with a straight front. Make the front straight${frontCut ? " (no corner cut at the front)" : ""}, or move the step past the deck's end.` };
  }
  // Past its limits the deck is HELD there (normalizeBack clamps) and the note says so, as the L holds its notch.
  const reach = Math.min(BACK_LIMITS.reachFt, DECK_LIMITS.depthFt.max - D);
  const deep = under.find((p) => -p.depthFt > reach + 0.01);
  const keep = D - DECK_LIMITS.legFt.min;
  const far = under.find((p) => p.depthFt > keep + 0.01);
  const note = deep
    ? `The wall steps back ${ftWords(-deep.depthFt)} under the deck between ${ftWords(deep.x0)} and ${ftWords(deep.x1)} — farther than a deck reaches in, so it stops ${ftWords(reach)} back, short of that wall. Bring that part of the wall out, or end the deck before it.`
    : far
      ? `The wall comes out ${ftWords(far.depthFt)} between ${ftWords(far.x0)} and ${ftWords(far.x1)} — a ${ftWords(D)} deck keeps at least ${ftWords(DECK_LIMITS.legFt.min)} in front of a bump-out, so its back there is held at ${ftWords(keep)}. Make the deck deeper, or bring that part of the wall back.`
      : null;
  // A sliver of a set-back (under 2 ft wide) is bridged — the deck stops at the wall either side of it; a sliver
  // that comes out (a chimney, a pilaster) is still stepped around. Taking the larger line never puts deck in the wall.
  const parts = under.map((p, i) => {
    if (p.x1 - p.x0 >= BACK_LIMITS.partFt) return p;
    const near = [under[i - 1], under[i + 1]].filter((q): q is WallPart => !!q).map((q) => q.depthFt);
    return { ...p, depthFt: Math.max(p.depthFt, ...near) };
  });
  const walled = parts.map((p) => ({ x0Ft: p.x0, x1Ft: p.x1, yFt: p.depthFt }));
  const parted = shape.kind === "wall" && shape.front ? shape.front : null;
  if (!past) {
    const back = normalizeBack(walled, W, D);
    if (!back) return { shape: parted ? partsOn(W, D, [{ x0Ft: 0, x1Ft: W, yFt: 0 }], parted) : { kind: "rect", widthFt: W, depthFt: D }, note };
    return { shape: partsOn(W, D, back, parted), note };
  }
  // The parts past the house's corners: no wall behind them, back along the house's side as far as was asked.
  const back = normalizeBack(
    [
      ...(past.leftFt > 0 ? [{ x0Ft: 0, x1Ft: past.leftFt, yFt: -past.wrapLeftFt, open: true }] : []),
      ...walled,
      ...(past.rightFt > 0 ? [{ x0Ft: W - past.rightFt, x1Ft: W, yFt: -past.wrapRightFt, open: true }] : []),
    ],
    W,
    D,
  );
  if (!back) return { shape: parted ? partsOn(W, D, [{ x0Ft: 0, x1Ft: W, yFt: 0 }], parted) : { kind: "rect", widthFt: W, depthFt: D }, note };
  if (parted) return { shape: partsOn(W, D, back, parted), note };
  const pastNote = shapedFront ? `The deck runs past the house's corner — there it stands on its own beam and posts, with a straight front${frontCut ? " (no corner cut at the front)" : ""}.` : null;
  return { shape: { kind: "wall", widthFt: W, depthFt: D, back }, note: note ?? pastNote };
}

/** A deck in parts on this back: its front's own parts held against it (a front that comes out straight is left off; a straight back with it, and the deck is a rectangle). */
function partsOn(W: number, D: number, back: BackPart[], front: ReadonlyArray<{ x0Ft: number; x1Ft: number; yFt: number }> | null): DeckShape {
  return partsShape(W, D, back, front);
}

/** How far the deck runs past each corner of the house, and back along its side there, ft (0 = the wall reaches the deck's end). */
export interface DeckPast {
  leftFt: number;
  rightFt: number;
  wrapLeftFt: number;
  wrapRightFt: number;
}
export function deckPast(house: HouseDesign): DeckPast {
  const leftFt = Math.max(0, -house.leftFt);
  const rightFt = Math.max(0, -house.rightFt);
  return { leftFt, rightFt, wrapLeftFt: leftFt > 0 ? (house.wrapLeftFt ?? 0) : 0, wrapRightFt: rightFt > 0 ? (house.wrapRightFt ?? 0) : 0 };
}

/**
 * THE DECK'S ENDS AND THE HOUSE'S CORNERS AGREE (2026-11-14), whatever changed last: a deck whose end is past a corner
 * of the house has no wall behind it there — never a ledger in the air — and a deck the wall has grown back behind
 * hangs on it again. A design with the wall behind the whole deck (every design before this) is returned untouched.
 */
export function fitDeckEnds(shape: DeckShape, house: HouseDesign): DeckShape {
  const past = deckPast(house);
  const open = shape.kind === "wall" ? shape.back : [];
  const openLeft = open[0]?.open ? open[0].x1Ft : 0;
  const last = open[open.length - 1];
  const openRight = last?.open ? shape.widthFt - last.x0Ft : 0;
  const wrapOf = (b: { yFt: number } | undefined) => (b ? -b.yFt : 0);
  const same = (a: number, b: number) => Math.abs(a - b) < 1 / 24;
  if (same(past.leftFt, openLeft) && same(past.rightFt, openRight) && (!openLeft || same(past.wrapLeftFt, wrapOf(open[0]))) && (!openRight || same(past.wrapRightFt, wrapOf(last)))) return shape;
  return deckShapeForHouse(shape, house).shape;
}

/**
 * The deck run past a corner of the house (2026-11-14), the house staying where it stands: its end on that side goes
 * `pastFt` beyond the corner and `wrapFt` back along the house's side wall; 0 brings an end that was past back TO the
 * corner. The deck is widened or narrowed by the difference — at the left end everything measured from that end
 * shifts with it.
 */
export function setDeckPast(house: HouseDesign, shape: DeckShape, side: "left" | "right", pastFt: number, wrapFt: number, limits: { minWidthFt: number; maxWidthFt: number }): { house: HouseDesign; shape: DeckShape } {
  const P = HOUSE_LIMITS.pastFt;
  const want0 = half(clamp(pastFt, 0, P.max));
  const want = want0 > 0 && want0 < P.min ? P.min : want0;
  const now = side === "left" ? house.leftFt : house.rightFt;
  // ("Not past" said of an end that is not past: nothing to do — a deck that stops short of the corner stays where it is.)
  if (want === 0 && now >= 0) return { house, shape };
  // The deck's end moves out by the wall it passes plus what it runs past the corner — within the widths a deck comes in.
  const grow = clamp(now + want, limits.minWidthFt - shape.widthFt, limits.maxWidthFt - shape.widthFt);
  const widthFt = half(shape.widthFt + grow);
  const reach = half(now - (widthFt - shape.widthFt));
  const wrap = reach < 0 ? half(clamp(wrapFt, 0, HOUSE_LIMITS.wrapFt.max)) : 0;
  // (No wrap is said as `undefined`, not left out: a patch is laid OVER the house, and a key left out would keep the old one.)
  if (side === "right") return { house: { ...house, rightFt: reach, wrapRightFt: wrap > 0 ? wrap : undefined }, shape: { ...shape, widthFt } };
  const d = widthFt - shape.widthFt; // the left end moves LEFT by this much
  return { house: { ...house, leftFt: reach, wrapLeftFt: wrap > 0 ? wrap : undefined, jogs: house.jogs.map((j) => ({ ...j, atFt: half(j.atFt + d) })), ...shiftHouseThings(house, d) }, shape: { ...shape, widthFt } };
}

/** A bump-out at one end of the deck: the L's back notch, as before 2026-10-19. */
function endNotch(shape: DeckShape, t: WallPart, atRight: boolean, rect: () => DeckShape): { shape: DeckShape; note: string | null } {
  const W = shape.widthFt;
  const D = shape.depthFt;
  const width = half(atRight ? W - t.x0 : t.x1);
  if (width < NOTCH_MIN_FT || width > W - NOTCH_KEEP_FT) return { shape: rect(), note: `The bump-out leaves ${ftWords(width)} at the deck's ${atRight ? "right" : "left"} end — too little to notch; the deck ends at the step instead.` };
  const depth = half(clamp(t.depthFt, NOTCH_MIN_FT, D - NOTCH_KEEP_FT));
  const note = t.depthFt > D - NOTCH_KEEP_FT ? `The bump-out comes out ${ftWords(t.depthFt)}, more than a ${ftWords(D)} deck can wrap — the notch is held at ${ftWords(depth)}.` : null;
  return { shape: { kind: "L", widthFt: W, depthFt: D, notch: { corner: atRight ? "back-right" : "back-left", widthFt: width, depthFt: depth } }, note };
}

/**
 * The house made to show the deck's shape: a back notch picked in the Shape
 * step gets its step in the wall (the one that would make that notch), and a
 * deck set back to a rectangle loses the step that notched it.
 */
export function houseForShape(house: HouseDesign, shape: DeckShape, opts: { drop?: boolean } = {}): HouseDesign {
  // (A deck in parts follows the wall as it is: its shape asks nothing of the house.)
  if (shape.kind === "wall") return house;
  const W = shape.widthFt;
  const want = shape.kind === "L" && shape.notch.corner.startsWith("back") ? shape.notch : null;
  const underBefore = partsUnderDeck(wallParts(house, shape), W).filter((p) => p.depthFt > 0.5);
  if (!want) {
    // A rectangle (or a front notch) picked in the Shape step: drop the one step that notched the deck's end, keep every other.
    if (opts.drop === false || underBefore.length !== 1) return house;
    const t = underBefore[0];
    const atRight = t.x1 >= W - 0.01 && t.x0 > 0.01;
    const atLeft = t.x0 <= 0.01 && t.x1 < W - 0.01;
    if (!atRight && !atLeft) return house;
    const edge = atRight ? t.x0 : t.x1;
    const dir: JogDir = atRight ? "toward" : "away";
    return { ...house, jogs: house.jogs.filter((j) => !(Math.abs(j.atFt - edge) < 0.6 && j.dir === dir)) };
  }
  const right = want.corner === "back-right";
  const edge = half(right ? W - want.widthFt : want.widthFt);
  const dir: JogDir = right ? "toward" : "away";
  const depth = half(clamp(want.depthFt, HOUSE_LIMITS.depthFt.min, HOUSE_LIMITS.depthFt.max));
  const have = house.jogs.find((j) => Math.abs(j.atFt - edge) < 0.6 && j.dir === dir);
  if (have) {
    if (Math.abs(have.depthFt - depth) < 0.01) return house;
    return { ...house, jogs: house.jogs.map((j) => (j === have ? { ...j, depthFt: depth } : j)) };
  }
  // The step that makes this notch owns the wall under the deck: the other steps inside the deck's span go, the ones
  // past its ends stay.
  const kept = house.jogs.filter((j) => j.atFt < -0.6 || j.atFt > W + 0.6);
  const jogs = [...kept, { id: nextJogId(kept), atFt: edge, dir, depthFt: depth }].sort((a, b) => a.atFt - b.atFt).slice(0, HOUSE_LIMITS.jogs);
  return { ...house, jogs };
}

export function nextJogId(jogs: HouseJog[]): string {
  let n = jogs.length + 1;
  while (jogs.some((j) => j.id === `j${n}`)) n++;
  return `j${n}`;
}

/** What the House step says about the wall and the deck together. */
export function houseNotes(shape: DeckShape, house: HouseDesign): string[] {
  const notes: string[] = [];
  const fit = deckShapeForHouse(shape, house);
  if (fit.note) notes.push(fit.note);
  return notes;
}

/* ------------------------------------------------------------------ */
/*  What the 3D draws                                                   */
/* ------------------------------------------------------------------ */

export interface HouseScene {
  /** Blocks [x0, y0, x1, y1, heightFt], ft, in the deck's frame (y out from the house line). */
  blocks: number[][];
  heightFt: number;
  /** The door onto the deck: [centre x, width, height, the face's y], ft. */
  door: number[] | null;
  storeys: 1 | 2;
  roof: HouseRoof;
  /** Windows on the back faces: [centre x, the face's y, width, height, sill], ft. */
  windows: number[][];
  /** The siding's and the roof's colours, hex. */
  siding: string;
  roofColour: string;
  /** The doors where they really are (a house built from a photo): [centre x, the face's y, width, height, threshold above the ground, 0 a door | 1 a sliding door], ft. Absent: `door` is the one. */
  doors?: number[][];
  /** What the wall is clad in. */
  material?: HouseMaterial;
  /** The roofs (2026-10-23): ONE over the house's body, one over each bump-out standing out in front of it — [kind (ROOF_PIECE), x0, y0, x1, y1, the eave's height, pitch in inches per foot], ft. Absent (an older scene): a roof per block. */
  roofs?: number[][];
}

/** A roof's piece in the scene: 0 hip, 1 gable (ridge along the wall), 2 gable to the yard, 3 shed (down toward the
 *  yard), 4 flat — over the body; 5 hip, 6 gable, 7 shed, 8 flat — a bump-out's, its back against the body. */
export const ROOF_PIECE = { hip: 0, gable: 1, "gable-end": 2, shed: 3, flat: 4, bumpHip: 5, bumpGable: 6, bumpShed: 7, bumpFlat: 8 } as const;
const BUMP_PIECE: Record<HouseRoof, number> = { hip: ROOF_PIECE.bumpHip, gable: ROOF_PIECE.bumpGable, "gable-end": ROOF_PIECE.bumpGable, shed: ROOF_PIECE.bumpShed, flat: ROOF_PIECE.bumpFlat };

/**
 * The house as blocks and openings: one block per part of the back wall,
 * the body behind it; a two-storey house keeps its bump-outs one storey
 * tall (unless they were seen as tall as the house); the door on the part
 * under the deck's main back edge, windows along every face per storey,
 * clear of the door — or, for a house built from a photo, the windows and
 * doors where they are, each on the part of the wall it stands in.
 */
export function houseScene(shape: DeckShape, house: HouseDesign, ctx: { deckHeightFt: number; peakFt: number; mainEdge: { x0: number; x1: number } | null }): HouseScene {
  const parts = impliedParts(wallParts(house, shape), shape, house);
  const storeyTop = (n: number) => n * STOREY_FT + 0.5;
  const mainH = r2(house.eaveHeightFt ?? Math.max(storeyTop(house.storeys), ctx.deckHeightFt + 9, ctx.peakFt + 2.5));
  const lowH = r2(Math.max(storeyTop(1), ctx.deckHeightFt + 9));
  // THE BODY AND ITS BUMP-OUTS (2026-10-23): the house's body stands behind its main wall — the face most of the wall is
  // on — the whole length of the house under ONE roof; a part that comes out stands in front of the body as a block of
  // its own under its own roof (one storey on a two-storey house unless it was seen as tall as the house); a part set
  // back is the body's own wall, set back under the roof's eave.
  const faceWidth = new Map<number, number>();
  for (const p of parts) faceWidth.set(p.depthFt, (faceWidth.get(p.depthFt) ?? 0) + (p.x1 - p.x0));
  let mainFace = 0;
  let widest = -1;
  for (const [d, w] of faceWidth) if (w > widest + 1e-9 || (Math.abs(w - widest) < 1e-9 && Math.abs(d) < Math.abs(mainFace))) [mainFace, widest] = [d, w];
  const pitch = roofPitch(house);
  const blocks: number[][] = [];
  const roofs: number[][] = [];
  /** Each part's wall height (its block's, or its bump-out's). */
  const partH: number[] = [];
  /** Over a one-storey part standing in front of the taller house: the wall above it (its face, its top), where its upper windows are. */
  const above: Array<{ face: number; top: number; from: number } | null> = [];
  // EACH PART BY WHAT IT IS (2026-11-13): as tall as the house under the main roof; one storey in front of the taller
  // house under a roof of its own (a lean-to unless seen otherwise); or a one-storey WING beside the taller block —
  // all the house there is at that spot, under its own roof, the main roof ending where the wing begins.
  const kinds = parts.map((p, i) => {
    const own = housePartAt(house, i);
    const out = p.depthFt > mainFace + 0.5;
    const low = house.storeys === 2 && (own?.storeys ? own.storeys === 1 : out && house.bumpOuts !== "full");
    // a low part that does not come out has no taller wall to stand in front of: it is a wing whether marked or not
    const wing = low && (own?.wing === true || !out);
    return { own, out, low, wing };
  });
  // the main roof: one over every run of parts that are not wings
  for (let i = 0; i < parts.length; ) {
    if (kinds[i].wing) { i++; continue; }
    let j = i;
    while (j + 1 < parts.length && !kinds[j + 1].wing) j++;
    roofs.push([ROOF_PIECE[house.roof], parts[i].x0, r2(mainFace - HOUSE_BODY_FT), parts[j].x1, mainFace, mainH, pitch]);
    i = j + 1;
  }
  parts.forEach((p, i) => {
    const { own, out, low, wing } = kinds[i];
    const ownPitch = (kind: PartRoof | undefined) => (kind === "flat" ? HOUSE_PITCH_DEFAULT.flat : kind === "shed" ? Math.min(pitch, 4) : pitch);
    if (wing) {
      // the wing: one block from the back of the house to its own face, under its own roof
      blocks.push([p.x0, r2(mainFace - HOUSE_BODY_FT), p.x1, p.depthFt, lowH]);
      const kind: HouseRoof = own?.roof ?? (house.roof === "gable-end" ? "gable" : house.roof);
      roofs.push([ROOF_PIECE[kind], p.x0, r2(mainFace - HOUSE_BODY_FT), p.x1, p.depthFt, lowH, ownPitch(own?.roof)]);
      partH.push(lowH);
      above.push(null);
      return;
    }
    blocks.push([p.x0, r2(mainFace - HOUSE_BODY_FT), p.x1, out ? mainFace : p.depthFt, mainH]);
    if (out) {
      const h = low ? lowH : mainH;
      blocks.push([p.x0, mainFace, p.x1, p.depthFt, h]);
      roofs.push([own?.roof ? BUMP_PIECE[own.roof] : BUMP_PIECE[house.roof], p.x0, mainFace, p.x1, p.depthFt, h, own?.roof ? ownPitch(own.roof) : pitch]);
      partH.push(h);
      // the upper storey's windows over a low part are on the house's wall behind it, above where the low roof
      // meets that wall (a lean-to climbs all the way to it; a hip or a gable to its ridge)
      const kind = own?.roof ?? (house.roof === "gable-end" ? "gable" : house.roof);
      const run = kind === "shed" ? p.depthFt - mainFace : kind === "flat" ? 0 : kind === "gable" ? (p.x1 - p.x0) / 2 : Math.min(p.depthFt - mainFace, (p.x1 - p.x0) / 2);
      const meets = h + (run * (own?.roof ? ownPitch(own.roof) : pitch)) / 12 + 0.5;
      above.push(low && own?.storeys === 1 ? { face: mainFace, top: mainH, from: r2(meets) } : null);
    } else {
      partH.push(mainH);
      above.push(null);
    }
  });
  const look = { storeys: house.storeys, roof: house.roof, siding: sidingHex(house.siding), roofColour: roofHex(house.roofColour), roofs, ...(house.material && house.material !== "lap" ? { material: house.material } : {}) };
  if (house.openings) {
    const placed = placeOpenings(house.openings, parts, partH, house.eaveHeightFt !== undefined, above);
    const ref = ctx.mainEdge ? (ctx.mainEdge.x0 + ctx.mainEdge.x1) / 2 : referenceX(shape);
    const main = placed.doors.slice().sort((a, b) => Math.abs(a[0] - ref) - Math.abs(b[0] - ref))[0];
    return { blocks, heightFt: mainH, door: main ? [main[0], main[2], main[3], main[1]] : null, windows: placed.windows, doors: placed.doors, ...look };
  }
  // The door: on the house line, centred on the deck's main back edge.
  const underRef = referencePart(parts, shape);
  const edge = ctx.mainEdge ?? { x0: Math.max(0, underRef.x0), x1: Math.min(shape.widthFt, underRef.x1) };
  const span = edge.x1 - edge.x0;
  const doorW = span >= 10 ? 6 : 3;
  const door = span >= doorW + 2 ? [r2((edge.x0 + edge.x1) / 2), doorW, 6.67, underRef.depthFt] : null;
  // Windows: 3 ft wide, 4 ft tall, every 5 ft along the free runs of each face (the door and its trim left clear),
  // the sills above the deck's floor on the first storey.
  const windows: number[][] = [];
  const WIN_W = 3;
  const PITCH = 5;
  const EDGE = 1;
  parts.forEach((p, i) => {
    const h = partH[i];
    const storeys = h >= storeyTop(2) - 0.01 ? 2 : 1;
    for (let st = 1; st <= storeys; st++) {
      const sill = st === 1 ? Math.max(3, ctx.deckHeightFt + 1.2) : STOREY_FT + 3;
      const top = st === 1 && storeys === 2 ? STOREY_FT - 0.8 : h - 1;
      const wh = Math.min(4, top - sill);
      if (wh < 2) continue;
      const runs: Array<{ x0: number; x1: number }> = [];
      if (door && st === 1 && p === underRef) {
        const d0 = door[0] - door[1] / 2 - 1.5;
        const d1 = door[0] + door[1] / 2 + 1.5;
        runs.push({ x0: p.x0, x1: Math.min(p.x1, d0) }, { x0: Math.max(p.x0, d1), x1: p.x1 });
      } else runs.push({ x0: p.x0, x1: p.x1 });
      for (const run of runs) {
        for (let x = run.x0 + EDGE + WIN_W / 2; x + WIN_W / 2 <= run.x1 - EDGE + 1e-9; x += PITCH) windows.push([r2(x), p.depthFt, WIN_W, r2(wh), r2(sill)]);
      }
    }
  });
  return { blocks, heightFt: mainH, door, windows: windows.slice(0, 60), ...look };
}

/** The wall part an opening stands in: the one its middle is over. */
const partAt = (parts: WallPart[], x: number) => parts.findIndex((p) => x >= p.x0 - 1e-6 && x <= p.x1 + 1e-6);

/* ── Windows and doors that run into each other ─────────────────────── */

/** A window or a door as a rectangle on its wall, ft: x along the house, y up from the ground; `face` = the wall face it stands on. */
export interface OpeningRect {
  kind: OpeningKind;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  face?: number;
}
/** The least wall between two openings, ft. Side by side: a casing each (6 in.), which a window's sill horn stays inside. One over the
 *  other: the two casings meeting as one band (3 in.) — a transom over a door. */
export const OPENING_GAP_FT = { side: 0.5, over: 0.25 } as const;
/** A gap this much short of the rule still stands (the design keeps its openings to the inch). */
const GAP_SLACK_FT = 0.045;
/** The least left of an opening that is cut back: this much of its side, and this share of what it was. */
const OPENING_MIN_FT = 0.75;
const OPENING_MIN_SHARE = 0.4;
/** The narrowest a door is cut to before it is left out. */
const DOOR_MIN_FT: Record<Exclude<OpeningKind, "window">, number> = { door: 2, slider: 4, garage: 6 };

/**
 * No two openings on one spot of the wall (owner, 2026-11-13: "the glass and doors on the 3D are messy" — a photo's
 * read had put a window inside the sliding door and another under its edge, and the 3D drew every one of them).
 * Doors stand first, the largest first; then the windows, the largest first. An opening that lies mostly inside one
 * already standing is that one's own glass, or the same opening read twice: left out. One that only runs into it is
 * cut back to leave the casings their room, on the side that costs it least — and left out when too little of it
 * would be left. A door is never cut in height: its threshold and its head stay where they are.
 * One entry per rectangle given, in the order given: the rectangle as it stands, or null.
 */
export function settleOpeningRects<T extends OpeningRect>(rects: readonly T[]): Array<T | null> {
  const area = (r: OpeningRect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
  const rank = (r: OpeningRect) => (r.kind === "window" ? 1 : 0);
  const order = rects.map((_, i) => i).sort((a, b) => rank(rects[a]) - rank(rects[b]) || area(rects[b]) - area(rects[a]) || a - b);
  const out: Array<T | null> = rects.map(() => null);
  const standing: T[] = [];
  for (const i of order) {
    const full = area(rects[i]);
    if (!(full > 0)) continue;
    const door = rects[i].kind !== "window";
    const minW = rects[i].kind === "window" ? OPENING_MIN_FT : DOOR_MIN_FT[rects[i].kind as Exclude<OpeningKind, "window">];
    const fits = (c: OpeningRect) => c.x1 - c.x0 >= minW - 1e-9 && c.y1 - c.y0 >= OPENING_MIN_FT - 1e-9 && area(c) >= OPENING_MIN_SHARE * full - 1e-9;
    let r: T | null = { ...rects[i] };
    for (const k of standing) {
      if (!r) break;
      if (Math.abs((k.face ?? 0) - (r.face ?? 0)) > 0.05) continue;
      const ox = Math.min(r.x1, k.x1) - Math.max(r.x0, k.x0);
      const oy = Math.min(r.y1, k.y1) - Math.max(r.y0, k.y0);
      // Far enough apart, side by side or one over the other.
      if (ox <= -(OPENING_GAP_FT.side - GAP_SLACK_FT) || oy <= -(OPENING_GAP_FT.over - GAP_SLACK_FT)) continue;
      const shared = Math.max(0, ox) * Math.max(0, oy);
      if (shared >= 0.5 * Math.min(area(r), area(k))) {
        r = null;
        break;
      }
      const cuts: T[] = [
        { ...r, x0: Math.max(r.x0, k.x1 + OPENING_GAP_FT.side) },
        { ...r, x1: Math.min(r.x1, k.x0 - OPENING_GAP_FT.side) },
        ...(door ? [] : [{ ...r, y0: Math.max(r.y0, k.y1 + OPENING_GAP_FT.over) }, { ...r, y1: Math.min(r.y1, k.y0 - OPENING_GAP_FT.over) }]),
      ].filter(fits);
      r = cuts.sort((a, b) => area(b) - area(a))[0] ?? null;
    }
    if (r) {
      standing.push(r);
      out[i] = r;
    }
  }
  return out;
}

/** The design's windows and doors with none on another's spot (see settleOpeningRects): what the code checks read, and what a photo's read is kept as. */
export function settleOpenings(openings: readonly HouseOpening[]): HouseOpening[] {
  const rects = openings.map((o) => ({ kind: o.kind, x0: o.xFt - o.widthFt / 2, x1: o.xFt + o.widthFt / 2, y0: o.sillFt, y1: o.sillFt + o.heightFt }));
  const out: HouseOpening[] = [];
  settleOpeningRects(rects).forEach((r, i) => {
    if (!r) return;
    const o = openings[i];
    const same = Math.abs(r.x0 - rects[i].x0) < 1e-9 && Math.abs(r.x1 - rects[i].x1) < 1e-9 && Math.abs(r.y0 - rects[i].y0) < 1e-9 && Math.abs(r.y1 - rects[i].y1) < 1e-9;
    out.push(same ? o : { ...o, xFt: toInchFt((r.x0 + r.x1) / 2), widthFt: toInchFt(r.x1 - r.x0), heightFt: toInchFt(r.y1 - r.y0), sillFt: toInchFt(r.y0) });
  });
  return out;
}

/**
 * A drawn house's windows [x, face, w, h, sill] and doors [x, face, w, h, sill, kind] with none on another's spot — a
 * scene saved before 2026-11-13 can still hold a window inside a door.
 */
export function settleSceneOpenings(windows: number[][] | undefined, doors: number[][] | undefined): { windows?: number[][]; doors?: number[][] } {
  const KIND: OpeningKind[] = ["door", "slider", "garage"];
  const rows = [...(doors ?? []).map((d) => ({ row: d, door: true })), ...(windows ?? []).map((w) => ({ row: w, door: false }))];
  const rects = rows.map(({ row, door }) => ({ kind: door ? (KIND[row[5]] ?? "door") : ("window" as OpeningKind), x0: row[0] - row[2] / 2, x1: row[0] + row[2] / 2, y0: row[4], y1: row[4] + row[3], face: row[1] }));
  const settled = settleOpeningRects(rects);
  if (settled.every((r, i) => r === rects[i] || (!!r && r.x0 === rects[i].x0 && r.x1 === rects[i].x1 && r.y0 === rects[i].y0 && r.y1 === rects[i].y1))) return { windows, doors };
  const out = { windows: [] as number[][], doors: [] as number[][] };
  settled.forEach((r, i) => {
    if (!r) return;
    const row = [r2((r.x0 + r.x1) / 2), rows[i].row[1], r2(r.x1 - r.x0), r2(r.y1 - r.y0), r2(r.y0)];
    if (rows[i].door) out.doors.push([...row, rows[i].row[5]]);
    else out.windows.push(row);
  });
  return { windows: windows ? out.windows : undefined, doors: doors ? out.doors : undefined };
}

/**
 * Real windows and doors on the wall: each on the part its middle stands in, narrowed to stay a hand's width inside
 * that part, dropped when it would stand above that part's wall (an upper-storey window over a one-storey bump-out)
 * or when nothing of it is left — and none of them on another's spot (settleOpeningRects).
 */
function placeOpenings(openings: HouseOpening[], parts: WallPart[], partH: number[], fromPhoto = false, above: ReadonlyArray<{ face: number; top: number; from: number } | null> = []): { windows: number[][]; doors: number[][] } {
  const placed: OpeningRect[] = [];
  for (const o of openings) {
    const i = partAt(parts, o.xFt);
    if (i < 0) continue;
    const p = parts[i];
    const x0 = Math.max(o.xFt - o.widthFt / 2, p.x0 + 0.25);
    const x1 = Math.min(o.xFt + o.widthFt / 2, p.x1 - 0.25);
    if (x1 - x0 < 0.75) continue;
    const top = partH[i] - (fromPhoto ? 0 : 0.6);
    // A window that starts above the part's top stands over a lower part's roof — no window of this wall. One that
    // starts inside the part but runs into the frieze (a transom just under the eave, read off a photo) is brought
    // down to fit under it rather than left out (2026-10-25).
    if (o.sillFt >= top) {
      // …unless the house's own wall stands above that roof (a one-storey part in front of a two-storey house): a
      // window up there is the upper storey's, on the wall behind, clear of the low roof's top edge (2026-11-13).
      const up = above[i];
      if (!up || o.kind !== "window") continue;
      const y0 = Math.max(o.sillFt, up.from), y1 = Math.min(o.sillFt + o.heightFt, up.top - (fromPhoto ? 0 : 0.6));
      if (y1 - y0 >= 0.75) placed.push({ kind: o.kind, x0, x1, y0, y1, face: up.face });
      continue;
    }
    const sill = !fromPhoto && o.sillFt + o.heightFt > top ? Math.max(0, top - o.heightFt) : o.sillFt;
    const h = Math.min(o.heightFt, top - sill);
    if (h < 0.75) continue;
    placed.push({ kind: o.kind, x0, x1, y0: sill, y1: sill + h, face: p.depthFt });
  }
  const windows: number[][] = [];
  const doors: number[][] = [];
  for (const r of settleOpeningRects(placed)) {
    if (!r) continue;
    const row = [r2((r.x0 + r.x1) / 2), r.face ?? 0, r2(r.x1 - r.x0), r2(r.y1 - r.y0), r2(r.y0)];
    if (r.kind === "window") windows.push(row);
    // The door's kind for the 3D: 0 a door, 1 a sliding door, 2 a garage door (2026-10-26).
    else doors.push([...row, r.kind === "slider" ? 1 : r.kind === "garage" ? 2 : 0]);
  }
  return { windows: windows.slice(0, 60), doors: doors.slice(0, 8) };
}

/* ── A field of the House step, shown in the 3D ─────────────────────── */

/** Which wall field the contractor is in or over (owner, 2026-10-12: "when I click a box to type in, show in the 3D which one it is — make it smart"). */
export type WallFocus = { kind: "left" } | { kind: "right" } | { kind: "step"; id: string } | { kind: "part"; id: string };

/** A length as the House step says it: "11 ft", or 7'-6". */
const feetWords = (n: number) => {
  const i = Math.round(Math.abs(n) * 12);
  return i % 12 ? `${Math.floor(i / 12)}'-${i % 12}"` : `${i / 12} ft`;
};

/**
 * What that field stands for, lit up in the 3D: boxes [x0, y0, z0, x1, y1, z1] in the scene's feet (x along the house
 * from the deck's left end, y out from the house line, z up) laid on the wall's own faces, and a tag over them. The wall
 * past either end of the deck; a step — the return wall where the wall steps (a marker where the two faces line up); a
 * step's "the wall to its right" and "by" — that stretch of wall and its step. `heightOf` reads a part's wall height off
 * the 3D's own house blocks.
 */
export function wallHighlight(shape: DeckShape, house: HouseDesign, focus: WallFocus, heightOf: (x0: number, x1: number) => number): { boxes: number[][]; tag: { x: number; y: number; z: number; text: string } } | null {
  const W = shape.widthFt;
  const parts = wallParts(house, shape);
  if (!parts.length) return null;
  const T = 0.22;
  const face = (p: WallPart, x0: number, x1: number) => [x0, p.depthFt - 0.05, 0, x1, p.depthFt + 0.45, heightOf(p.x0, p.x1)];
  if (focus.kind === "left" || focus.kind === "right") {
    const isLeft = focus.kind === "left";
    const a = isLeft ? -house.leftFt : W;
    const b = isLeft ? 0 : W + house.rightFt;
    const boxes: number[][] = [];
    for (const p of parts) {
      const x0 = Math.max(p.x0, a);
      const x1 = Math.min(p.x1, b);
      if (x1 - x0 > 0.05) boxes.push(face(p, x0, x1));
    }
    const at = isLeft ? 0 : W;
    const edge = parts.find((p) => p.x0 <= at + 1e-6 && p.x1 >= at - 1e-6) ?? parts[0];
    if (!boxes.length) boxes.push([at - T, edge.depthFt - 0.05, 0, at + T, edge.depthFt + 0.45, heightOf(edge.x0, edge.x1)]);
    const top = Math.max(...boxes.map((bx) => bx[5]));
    const mid = (Math.min(...boxes.map((bx) => bx[0])) + Math.max(...boxes.map((bx) => bx[3]))) / 2;
    const extra = isLeft ? house.leftFt : house.rightFt;
    const end = isLeft ? "left" : "right";
    const text = extra > 0 ? `${feetWords(extra)} of wall past the deck's ${end} end` : extra < 0 ? `The deck runs ${feetWords(-extra)} past the house's ${end} corner` : `The wall ends at the deck's ${end} end`;
    return { boxes, tag: { x: mid, y: Math.max(...boxes.map((bx) => bx[4])) + 0.3, z: top + 1.2, text } };
  }
  const n = house.jogs.findIndex((j) => j.id === focus.id);
  if (n < 0) return null;
  const j = house.jogs[n];
  const right = parts.find((p) => Math.abs(p.x0 - j.atFt) < 0.01);
  const left = parts.find((p) => Math.abs(p.x1 - j.atFt) < 0.01);
  if (!right || !left) return null;
  const hStep = Math.max(heightOf(left.x0, left.x1), heightOf(right.x0, right.x1));
  const y0 = Math.min(left.depthFt, right.depthFt);
  const y1 = Math.max(left.depthFt, right.depthFt);
  const step = [j.atFt - T, y0 - 0.05, 0, j.atFt + T, Math.max(y1, y0 + 0.4) + 0.45, hStep];
  const where = j.atFt < 0 ? `${feetWords(-j.atFt)} past the deck's left end` : j.atFt > W ? `${feetWords(j.atFt - W)} past the deck's right end` : `${feetWords(j.atFt)} from the deck's left end`;
  if (focus.kind === "step") return { boxes: [step], tag: { x: j.atFt, y: y1 + 0.8, z: hStep + 1.2, text: `Step ${n + 1} · ${where}` } };
  const moves = j.dir === "toward" ? `comes out ${feetWords(j.depthFt)}` : `steps back ${feetWords(j.depthFt)}`;
  const hRight = heightOf(right.x0, right.x1);
  return { boxes: [face(right, right.x0, right.x1), step], tag: { x: (right.x0 + right.x1) / 2, y: right.depthFt + 0.8, z: hRight + 1.2, text: `Step ${n + 1} · the wall to its right ${moves}` } };
}

/** A back notch on a wall with no steps at all (an older design, or the Shape step ahead of the house) is drawn as the bump-out it wraps. */
function impliedParts(parts: WallPart[], shape: DeckShape, house: HouseDesign): WallPart[] {
  if (house.jogs.length || shape.kind !== "L" || !shape.notch.corner.startsWith("back") || parts.length !== 1) return parts;
  const W = shape.widthFt;
  const nw = shape.notch.widthFt;
  const nd = shape.notch.depthFt;
  const p = parts[0];
  if (shape.notch.corner === "back-right") return [{ x0: p.x0, x1: r2(W - nw), depthFt: 0 }, { x0: r2(W - nw), x1: p.x1, depthFt: nd }];
  return [{ x0: p.x0, x1: r2(nw), depthFt: nd }, { x0: r2(nw), x1: p.x1, depthFt: 0 }];
}

/** The 3D's knobs for the house: each step along the wall, and the house's two corners. Positions in the deck's feet. */
export function houseHandles(shape: DeckShape, house: HouseDesign, zFt: number): Array<{ kind: "jog" | "house-left" | "house-right"; id: string; x: number; y: number; z: number; axis: "x"; value: number; perUnit: 1; label: string }> {
  const parts = wallParts(house, shape);
  const W = shape.widthFt;
  const depthAt = (x: number) => parts.find((p) => x >= p.x0 && x <= p.x1)?.depthFt ?? 0;
  const out: ReturnType<typeof houseHandles> = [];
  for (const j of house.jogs) {
    const left = depthAt(j.atFt - 0.01);
    const right = depthAt(j.atFt + 0.01);
    out.push({ kind: "jog", id: j.id, x: j.atFt, y: Math.max(left, right), z: zFt, axis: "x", value: j.atFt, perUnit: 1, label: `Step in the wall — the wall to its right ${j.dir === "toward" ? "comes out" : "steps back"} ${j.depthFt} ft` });
  }
  out.push({ kind: "house-left", id: "house-left", x: -house.leftFt, y: depthAt(-house.leftFt + 0.01), z: zFt, axis: "x", value: -house.leftFt, perUnit: 1, label: "The house's left corner" });
  out.push({ kind: "house-right", id: "house-right", x: W + house.rightFt, y: depthAt(W + house.rightFt - 0.01), z: zFt, axis: "x", value: W + house.rightFt, perUnit: 1, label: "The house's right corner" });
  return out;
}

/** The words under the step's title. */
export function houseWords(house: HouseDesign): string {
  const steps = house.jogs.length === 0 ? "a straight back wall" : `${house.jogs.length} ${house.jogs.length === 1 ? "step" : "steps"} in the back wall`;
  return `${house.storeys === 2 ? "Two storeys" : "One storey"} · ${HOUSE_ROOF_WORDS[house.roof]}${house.pitch ? ` ${house.pitch}/12` : ""} · ${steps}${house.photo ? " · from the photo" : ""}`;
}

/* ------------------------------------------------------------------ */
/*  One-click walls, and what the wall does to the deck, in words       */
/* ------------------------------------------------------------------ */

export type QuickWall = "straight" | "bump-right" | "bump-left" | "nook";
export const QUICK_WALLS: readonly QuickWall[] = ["straight", "bump-right", "bump-left", "nook"];
export const QUICK_WALL_LABEL: Record<QuickWall, string> = { straight: "Straight wall", "bump-right": "Bump-out at the right end", "bump-left": "Bump-out at the left end", nook: "The deck in a nook" };

/** The wall shaped in one click: the steps a bump-out at either end of the deck, or a nook around it, take. */
export function quickWall(kind: QuickWall, shape: DeckShape, house: HouseDesign): HouseDesign {
  const W = shape.widthFt;
  const d = 3;
  const w = half(Math.min(6, Math.max(NOTCH_MIN_FT, W / 4)));
  if (kind === "straight") return { ...house, jogs: [] };
  if (kind === "bump-right") return { ...house, jogs: [{ id: "j1", atFt: half(W - w), dir: "toward", depthFt: d }] };
  if (kind === "bump-left") return { ...house, jogs: [{ id: "j1", atFt: w, dir: "away", depthFt: d }] };
  return { ...house, leftFt: Math.max(house.leftFt, 4), rightFt: Math.max(house.rightFt, 4), jogs: [{ id: "j1", atFt: 0, dir: "away", depthFt: d }, { id: "j2", atFt: W, dir: "toward", depthFt: d }] };
}

/** Which one-click wall the house is, if any. */
export function quickWallOf(shape: DeckShape, house: HouseDesign): QuickWall | null {
  if (!house.jogs.length) return "straight";
  const fit = deckShapeForHouse(shape, house);
  if (fit.shape.kind === "L" && fit.shape.notch.corner === "back-right" && house.jogs.length === 1) return "bump-right";
  if (fit.shape.kind === "L" && fit.shape.notch.corner === "back-left" && house.jogs.length === 1) return "bump-left";
  const W = shape.widthFt;
  if (house.jogs.length === 2 && house.jogs[0].dir === "away" && Math.abs(house.jogs[0].atFt) < 0.6 && house.jogs[1].dir === "toward" && Math.abs(house.jogs[1].atFt - W) < 0.6) return "nook";
  return null;
}

/** One line on what the wall does to the deck. */
export function wallWords(shape: DeckShape, house: HouseDesign): string {
  const fit = deckShapeForHouse(shape, house);
  if (fit.note) return fit.note;
  if (quickWallOf(shape, house) === "nook") return "The deck sits in a nook: the house wraps both its ends, its back edge on the wall.";
  const past = deckPast(house);
  if (fit.shape.kind === "wall" && (past.leftFt > 0 || past.rightFt > 0)) return `${pastWords(past)} There it stands on its own beam and posts — no ledger.`;
  if (fit.shape.kind === "wall" && !fit.shape.back.some((b) => Math.abs(b.yFt) > 0.01)) return house.jogs.length ? "The wall's steps are past the deck's ends — the deck's back edge runs straight along the house." : "A straight wall behind the deck.";
  if (fit.shape.kind === "wall") return `The deck follows the wall, ${wallDeckWords(fit.shape)}.`;
  if (fit.shape.kind === "L" && fit.shape.notch.corner.startsWith("back")) return `The deck wraps the bump-out at its ${fit.shape.notch.corner === "back-right" ? "right" : "left"} end: a ${ftWords(fit.shape.notch.widthFt)} × ${ftWords(fit.shape.notch.depthFt)} notch, framed around it.`;
  return house.jogs.length ? "The wall's steps are past the deck's ends — the deck's back edge runs straight along the house." : "A straight wall behind the deck.";
}

/** "The deck runs 6 ft past the house's right corner and 10 ft back along its side." */
export function pastWords(past: DeckPast): string {
  const one = (end: "left" | "right", p: number, w: number) => `${ftWords(p)} past the house's ${end} corner${w > 0 ? ` and ${ftWords(w)} back along its side` : ""}`;
  const ends = [past.leftFt > 0 ? one("left", past.leftFt, past.wrapLeftFt) : null, past.rightFt > 0 ? one("right", past.rightFt, past.wrapRightFt) : null].filter((v): v is string => !!v);
  return ends.length ? `The deck runs ${ends.join(", and ")}.` : "";
}

/** A step, in words: where it is and what the wall does there. */
export function stepWords(j: HouseJog, shape: DeckShape): string {
  const W = shape.widthFt;
  const where = j.atFt < 0 ? `${ftWords(-j.atFt)} left of the deck` : j.atFt > W ? `${ftWords(j.atFt - W)} right of the deck` : j.atFt === 0 ? "at the deck's left end" : j.atFt === W ? "at the deck's right end" : `${ftWords(j.atFt)} from the deck's left end`;
  return `${where}, the wall to the right ${j.dir === "toward" ? "comes out" : "steps back"} ${ftWords(j.depthFt)}`;
}

/* ------------------------------------------------------------------ */
/*  Shaping the wall by hand (2026-10-11: "shape the house in any       */
/*  direction, inside, outside, wider, narrower — easy")                */
/* ------------------------------------------------------------------ */

/** The steps as signed depths: + comes out toward the yard, − steps back. */
const signed = (j: HouseJog) => (j.dir === "toward" ? j.depthFt : -j.depthFt);
const fromSigned = (j: HouseJog, d: number): HouseJog => ({ ...j, dir: d >= 0 ? "toward" : "away", depthFt: half(Math.min(HOUSE_LIMITS.depthFt.max, Math.abs(d))) });

/**
 * One part of the wall pushed out (+) or pulled in (−) by `deltaFt`: the step at each of its ends changes by that much,
 * and a step driven to nothing is dropped on the read-back. The part the deck stands on is the house line and stays —
 * null says so.
 */
export function moveWallPart(house: HouseDesign, shape: DeckShape, part: number, deltaFt: number): HouseDesign | null {
  const parts = wallParts(house, shape);
  if (part < 0 || part >= parts.length || part === referencePartIndex(parts, shape)) return null;
  const d = half(deltaFt);
  if (d === 0) return house;
  const jogs = house.jogs.map((j, i) => {
    if (i === part - 1) return fromSigned(j, signed(j) + d);
    if (i === part) return fromSigned(j, signed(j) - d);
    return j;
  });
  return { ...house, jogs };
}

/**
 * A step put in where the wall was tapped: past the deck's right end the wall beyond comes out 2 ft; at the deck's
 * left end the wall to the left comes out 2 ft (the step there steps back); anywhere else the wall to the right comes
 * out 2 ft. Nothing on top of a step already there, nothing past four.
 */
export function addStepAt(house: HouseDesign, shape: DeckShape, xFt: number): HouseDesign {
  const W = shape.widthFt;
  const x = half(clamp(xFt, -house.leftFt + 1, W + house.rightFt - 1));
  if (house.jogs.length >= HOUSE_LIMITS.jogs || house.jogs.some((j) => Math.abs(j.atFt - x) < 1)) return house;
  const dir: JogDir = x <= 0.01 ? "away" : "toward";
  const jogs = [...house.jogs, { id: nextJogId(house.jogs), atFt: x, dir, depthFt: 2 }].sort((a, b) => a.atFt - b.atFt);
  return { ...house, jogs };
}

/** How wide a section pulled from the wall starts, ft; how near the house's own end it runs on to it; how near the deck's end its edge snaps there. */
const SECTION_FT = 8;
const SECTION_TO_END_FT = 4;
const SECTION_SNAP_FT = 2.5;

/** A section pulled from the wall: its steps, and which of its edges they are (a section run on to the house's end has one). */
export interface WallSection {
  ids: string[];
  edge: "both" | "left" | "right";
}

/**
 * A section of the wall pulled out (+, toward the yard) or pushed in (−) right where it was grabbed (owner, 2026-10-12:
 * "just drag the back wall in or out at any place to make the shape of the house you want — make it smart"). On the
 * part under `xFt`: a section SECTION_FT wide centred there, its edges snapped to the deck's ends when near them and kept
 * a foot clear of the part's own steps; grabbed within SECTION_TO_END_FT of the house's own end, it runs on to that end
 * (one step). Behind the deck it is kept narrow enough that the deck still stands mostly on the house line (it never
 * jumps onto the section, or onto a nook made before, mid-drag). When it cannot be pulled: why — no steps left, no room
 * between the steps there, or the house line would no longer be the house line.
 */
export function pullSectionAt(house: HouseDesign, shape: DeckShape, xFt: number, depthFt: number): { house: HouseDesign; section: WallSection } | { why: "steps" | "room" | "line" } {
  const W = shape.widthFt;
  const parts = wallParts(house, shape);
  const i = parts.findIndex((p) => xFt >= p.x0 - 1e-6 && xFt <= p.x1 + 1e-6);
  if (i < 0) return { why: "room" };
  const p = parts[i];
  const first = i === 0;
  const last = i === parts.length - 1;
  const lo = p.x0 + (first ? 0 : 1);
  const hi = p.x1 - (last ? 0 : 1);
  if (hi - lo < 2) return { why: "room" };
  const x = clamp(xFt, lo, hi);
  const toLeft = first && x - p.x0 <= SECTION_TO_END_FT;
  const toRight = last && p.x1 - x <= SECTION_TO_END_FT;
  if (toLeft && toRight) return { why: "room" };
  if (house.jogs.length + (toLeft || toRight ? 1 : 2) > HOUSE_LIMITS.jogs) return { why: "steps" };
  const build = (width: number): { a: number; b: number } | null => {
    let a = half(x - width / 2);
    let b = half(x + width / 2);
    for (const e of [0, W]) {
      if (Math.abs(a - e) <= SECTION_SNAP_FT && e < x) a = e;
      if (Math.abs(b - e) <= SECTION_SNAP_FT && e > x) b = e;
    }
    a = toLeft ? p.x0 : Math.max(a, lo);
    b = toRight ? p.x1 : Math.min(b, hi);
    return b - a >= 1.5 ? { a, b } : null;
  };
  const d = clamp(Math.abs(depthFt), HOUSE_LIMITS.depthFt.min, HOUSE_LIMITS.depthFt.max) * (depthFt < 0 ? -1 : 1);
  const refBefore = referencePartIndex(parts, shape);
  const oldRef = parts[refBefore];
  for (let width = SECTION_FT; width >= 1.5; width -= 0.5) {
    const span = build(width);
    if (!span) return { why: "room" };
    const { a, b } = span;
    const jogs = [...house.jogs];
    const ids: string[] = [];
    const add = (atFt: number, signed: number) => {
      const id = nextJogId(jogs);
      jogs.push({ id, atFt, dir: signed >= 0 ? "toward" : "away", depthFt: half(Math.abs(signed)) });
      ids.push(id);
    };
    if (!toLeft) add(a, d);
    if (!toRight) add(b, -d);
    const next = { ...house, jogs: jogs.sort((m, n) => m.atFt - n.atFt) };
    // The house line stays the house line: the deck keeps standing on what is left of the part it stood on. A section
    // that would leave itself — or another part, a nook made before — carrying more of the deck's back edge is made
    // narrower (round the grab) until it does not; the deck never jumps onto another part mid-drag.
    const after = wallParts(next, shape);
    const ref = after[referencePartIndex(after, shape)];
    const keepsLine = i === refBefore ? ref.x0 >= p.x0 - 1e-6 && ref.x1 <= p.x1 + 1e-6 && (ref.x1 <= a + 1e-6 || ref.x0 >= b - 1e-6) : Math.abs(ref.x0 - oldRef.x0) < 1e-6 && Math.abs(ref.x1 - oldRef.x1) < 1e-6;
    if (!keepsLine) continue;
    return { house: next, section: { ids, edge: toLeft ? "right" : toRight ? "left" : "both" } };
  }
  return { why: "line" };
}

/** A pulled section set to `depthFt` out (+) or in (−) of the wall it came from; at nothing its steps go and the wall is straight again. */
export function setSectionDepth(house: HouseDesign, section: WallSection, depthFt: number): HouseDesign {
  const d = clamp(Math.abs(depthFt), 0, HOUSE_LIMITS.depthFt.max) * (depthFt < 0 ? -1 : 1);
  if (Math.abs(d) < HOUSE_LIMITS.depthFt.min) return { ...house, jogs: house.jogs.filter((j) => !section.ids.includes(j.id)) };
  const mine = house.jogs.filter((j) => section.ids.includes(j.id)).sort((m, n) => m.atFt - n.atFt);
  // The step at the section's left edge raises the wall to its right by d; the one at its right edge brings it back.
  const signedOf = (j: HouseJog) => (section.edge === "both" ? (j === mine[0] ? d : -d) : section.edge === "left" ? d : -d);
  return { ...house, jogs: house.jogs.map((j) => (section.ids.includes(j.id) ? fromSigned(j, signedOf(j)) : j)) };
}

/** A step moved along the wall: kept a foot clear of its neighbours and the wall's ends, snapped to the deck's ends when near them. */
export function moveJogTo(house: HouseDesign, shape: DeckShape, id: string, xFt: number): HouseDesign {
  const W = shape.widthFt;
  const i = house.jogs.findIndex((j) => j.id === id);
  if (i < 0) return house;
  let x = half(xFt);
  if (Math.abs(x) < 0.75) x = 0;
  else if (Math.abs(x - W) < 0.75) x = W;
  const lo = i > 0 ? house.jogs[i - 1].atFt + 1 : -house.leftFt + 1;
  const hi = i + 1 < house.jogs.length ? house.jogs[i + 1].atFt - 1 : W + house.rightFt - 1;
  x = clamp(x, lo, hi);
  if (x === house.jogs[i].atFt) return house;
  return { ...house, jogs: house.jogs.map((j, k) => (k === i ? { ...j, atFt: x } : j)) };
}

/* ------------------------------------------------------------------ */
/*  The deck moved and sized on the same drawing (2026-10-11: "I can    */
/*  move the deck size at the same time … move it anywhere I want")    */
/* ------------------------------------------------------------------ */

/**
 * The deck slid along the wall by `deltaFt` (+ to the right): the house stays where it is, so the wall's reach past
 * the deck's ends and every step move the other way in the deck's own feet. Held where either end would run out.
 */
export function slideDeck(house: HouseDesign, deltaFt: number): HouseDesign {
  // The deck right by d with the house still: more wall past its left end by d, less past its right — both held between
  // 0 and the most a wall reaches; the steps, fixed in the world, move the other way in the deck's feet.
  // (An end already past its corner may go farther past, or come back; one on the wall stays on it.)
  const floor = (v: number) => (v < 0 ? -HOUSE_LIMITS.pastFt.max : 0);
  const lo = Math.max(floor(house.leftFt) - house.leftFt, house.rightFt - HOUSE_LIMITS.extendFt.max);
  const hi = Math.min(HOUSE_LIMITS.extendFt.max - house.leftFt, house.rightFt - floor(house.rightFt));
  const d = half(clamp(deltaFt, lo, hi));
  if (d === 0) return house;
  return { ...house, leftFt: half(house.leftFt + d), rightFt: half(house.rightFt - d), jogs: house.jogs.map((j) => ({ ...j, atFt: half(j.atFt - d) })), ...shiftHouseThings(house, -d) };
}

/**
 * The deck's LEFT end moved to a new width while its right end stays put: the house stays too, so the wall's left
 * reach and every step shift by the change. Returns the shape and the house together.
 */
export function resizeDeckLeft(house: HouseDesign, shape: DeckShape, newWidthFt: number, minWidthFt: number, maxWidthFt: number): { house: HouseDesign; shape: DeckShape } {
  const W = shape.widthFt;
  const w2 = half(clamp(newWidthFt, minWidthFt, maxWidthFt));
  const d = W - w2; // the left end moves right by this much
  if (d === 0) return { house, shape };
  const leftFt = clamp(half(house.leftFt + d), house.leftFt < 0 ? -HOUSE_LIMITS.pastFt.max : HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max);
  const moved = { ...house, leftFt, jogs: house.jogs.map((j) => ({ ...j, atFt: half(j.atFt - d) })), ...shiftHouseThings(house, -d) };
  return { house: moved, shape: { ...shape, widthFt: w2 } };
}


/* ------------------------------------------------------------------ */
/*  Shifting a part sideways, levelling it, and the one-tap fixes       */
/*  (2026-10-11 afternoon; owner: "make it smart to shift the walls     */
/*  back, front, right, left — easier")                                 */
/* ------------------------------------------------------------------ */

/**
 * A part of the wall moved sideways as one piece by `deltaFt` (+ to the right), keeping its width: a middle part's two
 * steps move together; the first or last part moves its one step and the house's end with it. Held a foot clear of the
 * neighbouring steps, the house's ends inside their reach (0–60 ft past the deck). A straight wall has nothing to shift.
 */
export function shiftWallPart(house: HouseDesign, shape: DeckShape, part: number, deltaFt: number): HouseDesign {
  const W = shape.widthFt;
  const n = house.jogs.length;
  if (part < 0 || part > n || n === 0) return house;
  const d0 = half(deltaFt);
  if (d0 === 0) return house;
  const L = HOUSE_LIMITS.extendFt;
  const leftI = part - 1; // the step at the part's left end, if any
  const rightI = part; // the step at its right end, if any
  let lo = -Infinity;
  let hi = Infinity;
  if (leftI >= 0) {
    const j = house.jogs[leftI];
    lo = Math.max(lo, (leftI > 0 ? house.jogs[leftI - 1].atFt + 1 : -house.leftFt + 1) - j.atFt);
  } else {
    // The first part: the house's left end moves with it, between 0 and the most a wall reaches past the deck.
    lo = Math.max(lo, -(L.max - house.leftFt));
    hi = Math.min(hi, Math.max(0, house.leftFt - L.min));
  }
  if (rightI < n) {
    const j = house.jogs[rightI];
    hi = Math.min(hi, (rightI + 1 < n ? house.jogs[rightI + 1].atFt - 1 : W + house.rightFt - 1) - j.atFt);
  } else {
    // The last part: the house's right end moves with it.
    lo = Math.max(lo, -Math.max(0, house.rightFt - L.min));
    hi = Math.min(hi, L.max - house.rightFt);
  }
  const d = half(clamp(d0, lo, hi));
  if (d === 0 || !Number.isFinite(d)) return house;
  return {
    ...house,
    leftFt: leftI < 0 ? half(house.leftFt - d) : house.leftFt,
    rightFt: rightI >= n ? half(house.rightFt + d) : house.rightFt,
    jogs: house.jogs.map((j, i) => (i === leftI || i === rightI ? { ...j, atFt: half(j.atFt + d) } : j)),
  };
}

/** The part set level with the house line: its steps shrink by its depth (one driven to nothing is dropped on the read-back). Null for the house line itself. */
export function levelWallPart(house: HouseDesign, shape: DeckShape, part: number): HouseDesign | null {
  const parts = wallParts(house, shape);
  const p = parts[part];
  if (!p || part === referencePartIndex(parts, shape)) return null;
  if (Math.abs(p.depthFt) < 0.01) return house;
  return moveWallPart(house, shape, part, -p.depthFt);
}

/** Every part of the wall under the deck brought level with the house line — the deck back to a plain rectangle. */
export function levelUnderDeck(house: HouseDesign, shape: DeckShape): HouseDesign {
  const W = shape.widthFt;
  let h = house;
  for (let guard = 0; guard < 12; guard++) {
    const parts = wallParts(h, shape);
    const ref = referencePartIndex(parts, shape);
    const i = parts.findIndex((p, k) => k !== ref && Math.min(p.x1, W) - Math.max(p.x0, 0) > 0.5 && Math.abs(p.depthFt) > 0.01);
    if (i < 0) return h;
    const n = levelWallPart(h, shape, i);
    if (!n || n === h) return h;
    h = n;
  }
  return h;
}

/** The deck ended at `widthFt` with the house left where it is: the wall past its right end grows by what the deck gave up. */
function endDeckAt(house: HouseDesign, shape: DeckShape, widthFt: number): { house: HouseDesign; shape: DeckShape } {
  const w = half(widthFt);
  return { house: { ...house, rightFt: half(clamp(house.rightFt + (shape.widthFt - w), HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max)) }, shape: { ...shape, widthFt: w } };
}

/** One tap that answers the wall's note: what it does, and the house and the deck after it. */
export interface WallFix {
  id: string;
  label: string;
  house: HouseDesign;
  shape: DeckShape;
}

/**
 * The fixes for a wall the deck cannot frame around, each one tried and kept only when the note goes away: a recess
 * under the deck brought out level, the deck slid or ended clear of it; a second bump-out levelled; a bump-out inside
 * the deck levelled, or the deck slid so it sits at an end, or the step moved to that end.
 */
export function wallFixes(shape: DeckShape, house: HouseDesign, limits: { minWidthFt: number; maxWidthFt: number }): WallFix[] {
  const fit = deckShapeForHouse(shape, house);
  if (!fit.note) return [];
  const W = shape.widthFt;
  const parts = wallParts(house, shape);
  const under = parts.map((p, i) => ({ i, x0: Math.max(p.x0, 0), x1: Math.min(p.x1, W), depthFt: p.depthFt })).filter((p) => p.x1 - p.x0 > 0.5);
  const out = under.filter((p) => p.depthFt > 0.5);
  const back = under.filter((p) => p.depthFt < -0.5);
  const fixes: WallFix[] = [];
  const offer = (id: string, label: string, change: { house?: HouseDesign | null; shape?: DeckShape }) => {
    if (change.house === null) return;
    const h = change.house ?? house;
    const s = change.shape ?? shape;
    if (h === house && s === shape) return;
    if (deckShapeForHouse(s, h).note) return;
    if (fixes.some((f) => f.id === id)) return;
    fixes.push({ id, label, house: h, shape: s });
  };
  if (back.length) {
    const b = back[0];
    offer("level", `Bring that part of the wall out level with the house (${ftWords(-b.depthFt)})`, { house: levelWallPart(house, shape, b.i) });
    if (b.x0 <= 0.01) offer("slide-right", `Slide the deck ${ftWords(b.x1)} to the right, clear of the recess`, { house: slideDeck(house, b.x1) });
    if (b.x1 >= W - 0.01) offer("slide-left", `Slide the deck ${ftWords(W - b.x0)} to the left, clear of the recess`, { house: slideDeck(house, -(W - b.x0)) });
    if (b.x0 >= limits.minWidthFt) offer("end-at", `End the deck where the wall steps back — ${ftWords(b.x0)} wide`, endDeckAt(house, shape, b.x0));
    if (W - b.x1 >= limits.minWidthFt) offer("start-after", `Start the deck past the recess — ${ftWords(W - b.x1)} wide`, resizeDeckLeft(house, shape, W - b.x1, limits.minWidthFt, limits.maxWidthFt));
  } else if (out.length > 1) {
    const atEnd = out.find((p) => p.x0 <= 0.01 || p.x1 >= W - 0.01);
    const keep = atEnd ?? out.reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a));
    let h: HouseDesign | null = house;
    for (const p of out) if (p !== keep && h) h = levelWallPart(h, shape, p.i);
    offer("level-others", `Level the other bump-out${out.length > 2 ? "s" : ""} with the house — keep the one at ${keep.x0 <= 0.01 ? "the left end" : keep.x1 >= W - 0.01 ? "the right end" : ftWords(keep.x0)}`, { house: h });
    let all: HouseDesign | null = house;
    for (const p of out) if (all) all = levelWallPart(all, shape, p.i);
    offer("level-all", `Level every bump-out under the deck with the house`, { house: all });
    const first = out[0];
    const last = out[out.length - 1];
    if (last.x1 >= W - 0.01 && first.x0 >= limits.minWidthFt) offer("end-at", `End the deck at the first bump-out — ${ftWords(first.x0)} wide`, endDeckAt(house, shape, first.x0));
    if (first.x0 <= 0.01 && W - last.x1 >= limits.minWidthFt) offer("start-after", `Start the deck past the last bump-out — ${ftWords(W - last.x1)} wide`, resizeDeckLeft(house, shape, W - last.x1, limits.minWidthFt, limits.maxWidthFt));
  } else if (out.length === 1) {
    const t = out[0];
    const toRight = t.x0;
    const toLeft = W - t.x1;
    if (toRight > 0.01 && toLeft > 0.01) {
      // Slid the shorter way first; the house stays put, so a slide the wall's reach cannot give is not offered (the note would stay).
      const ways: Array<["slide-right" | "slide-left", number, string]> = [["slide-right", toRight, `Slide the deck ${ftWords(toRight)} to the right, so the bump-out is at its left end`], ["slide-left", -toLeft, `Slide the deck ${ftWords(toLeft)} to the left, so the bump-out is at its right end`]];
      if (toRight > toLeft) ways.reverse();
      for (const [id, by, label] of ways) offer(id, label, { house: slideDeck(house, by) });
      // The bump-out moved whole (its width kept) to the deck's nearer end, where the deck notches around it; the far end if the near one has no room.
      const shifts: Array<[number, string]> = [[-toRight, "left"], [toLeft, "right"]];
      if (toRight > toLeft) shifts.reverse();
      for (const [by, end] of shifts) offer("shift-to-end", `Shift the bump-out to the deck's ${end} end — the deck notches around it`, { house: shiftWallPart(house, shape, t.i, by) });
    }
    offer("level", `Level the bump-out with the house`, { house: levelWallPart(house, shape, t.i) });
    if (toRight >= limits.minWidthFt) offer("end-at", `End the deck at the bump-out — ${ftWords(toRight)} wide`, endDeckAt(house, shape, toRight));
    if (toLeft >= limits.minWidthFt) offer("start-after", `Start the deck past the bump-out — ${ftWords(toLeft)} wide`, resizeDeckLeft(house, shape, toLeft, limits.minWidthFt, limits.maxWidthFt));
  }
  return fixes;
}

/** A deck that follows the wall, its back in words: "3 parts — 29.5 ft on the house line, 11 ft reaching 5.5 ft back, 7.5 ft on the house line". */
export function wallDeckWords(shape: Extract<DeckShape, { kind: "wall" }>): string {
  const part = (b: { x0Ft: number; x1Ft: number; yFt: number }) => {
    const w = ftWords(b.x1Ft - b.x0Ft);
    if (Math.abs(b.yFt) < 0.01) return `${w} on the house line`;
    return b.yFt < 0 ? `${w} reaching ${ftWords(-b.yFt)} back` : `${w} stepping ${ftWords(b.yFt)} out around the wall`;
  };
  return `${shape.back.length} parts — ${shape.back.map(part).join(", ")}`;
}

/** One part of the wall in words: "8 ft wide · comes out 4 ft" / "the house line" / "steps back 2 ft". */
export function wallPartWords(p: WallPart): string {
  const width = ftWords(p.x1 - p.x0);
  if (Math.abs(p.depthFt) < 0.01) return `${width} wide · the house line`;
  return `${width} wide · ${p.depthFt > 0 ? "comes out" : "steps back"} ${ftWords(Math.abs(p.depthFt))}`;
}
