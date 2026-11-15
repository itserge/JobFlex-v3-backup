// THE WALL'S WINDOWS AND DOORS, SET BY HAND IN THE 3D (2026-11-15) — pure.
//
// The owner: "if I'm building the wall on the map drawing and it shows up on the 3D, give me an option to double click
// on the window and move it anywhere I want it. If it's a sliding door, I can double click and change the sliding door
// for a triple sliding door, 4 doors, or a single regular door. Same thing for the windows. When I click it, it gets
// live, and I can move it right on the 3D wall where I want it, and also make the size… If the handrail ends up right
// in the middle of the window, I'll just click on the window and move it a little bit to the right or to the left.
// If I'm just showing the client on an example how their deck is going to look and I'm trying to make the back wall
// look nice, I can play around with this. Or if it's the exact wall, I can set it up the way that wall is in real,
// with the doors and windows — when I don't have a back wall picture. Make it super smart."
//
// A house without a photo draws its windows and doors by rule (lib/deck/house houseScene). The first move by hand
// turns that wall into a list — the very openings the rule drew, each with its name — and marks it a SKETCH
// (house.openingsSketch): drawn as set, but the deck is not checked against it until the contractor says these are the
// real doors and windows. A wall built from a photo is a list already, and stays real.
//
// What moves how:
//   · ALONG THE WALL, anywhere on the part of the wall it stands in; put onto another it lands beside it (their casings
//     keep their room). A door gives way only to another door: a window in a door's way is cut back in the picture.
//   · UP AND DOWN: a window, between the ground and the wall's top. A door stands on a floor — the deck's, or the lower
//     floor of a double deck (the ground where there is none): pulled up or down it goes to the nearer one. Either
//     FOLLOWS its floor afterwards: change the deck's height and the door stays on its boards (HouseOpening.floor).
//   · ITS SIZE: wider, narrower, taller, shorter — to the inch, within what its kind allows.
//   · WHAT IT IS: a door is swapped for a single door, a double door, or a sliding door of 2, 3 or 4 panels; a window
//     for a single, double or triple one. It keeps its middle and takes that kind's usual width, and the larger wins:
//     what it grows over is cut back or left out of the picture (still on the list — it comes back when this shrinks).
// Each returns the patch to the design, or null where nothing can be done.
import { DOOR_CHOICES, OPENING_LIMITS, WINDOW_CHOICES, houseScene, resolveOpenings, ruleOpenings, toInchFt, wallParts, type DrawnOpening, type HouseOpening, type HouseSceneCtx, type OpeningChoice, type OpeningFloors, type OpeningKind } from "./house";
import type { DeckDesign, DeckShape } from "./design";
import type { DeckPatch } from "./checks";
import type { DeckStructure } from "./structure";

/** A door's usual height, ft (6 ft 8 in.); the narrowest each kind goes, ft; the wall left between two openings side by side and one over the other, ft. */
export const DOOR_HEIGHT_FT = 80 / 12;
const MIN_WIDTH_FT: Record<OpeningKind, number> = { window: 1, door: 2, slider: 4, garage: 6 };
const GAP_FT = { side: 0.5, over: 0.25 } as const;
/** A new window's sill above the floor it looks onto, and its height, ft. */
const WINDOW_UP_FT = 3;
const WINDOW_HEIGHT_FT = 4;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The floors an opening can stand on: the deck's, and a double deck's lower floor. */
export function openingFloors(design: Pick<DeckDesign, "heightIn" | "lower">): OpeningFloors {
  return { deckFt: design.heightIn / 12, lowerFt: design.lower.on && design.lower.place === "under" ? design.lower.heightIn / 12 : null };
}

/** The house's windows and doors the deck is CHECKED against: the real ones, each where it stands now — none for a wall drawn by rule or arranged by hand as a picture. */
export function realOpenings(design: Pick<DeckDesign, "house" | "heightIn" | "lower">): HouseOpening[] | null {
  const h = design.house;
  return h.openings && !h.openingsSketch ? resolveOpenings(h.openings, openingFloors(design)) : null;
}

/** The longest stretch of a frame's back edge that lies on the house line, in. */
const mainBack = (frame: NonNullable<DeckStructure["frame"]>) => frame.edges.filter((e) => e.house && e.side === "back" && Math.abs(e.y0) < 0.01).sort((a, b) => b.lengthIn - a.lengthIn)[0] ?? null;

/** What a deck's house is drawn from and against (the 3D's own): null for a deck off the house, or a roof with no deck under it. */
export function houseDrawn(s: DeckStructure): { shape: DeckShape; ctx: HouseSceneCtx } | null {
  const { design, frame, roof } = s;
  if (!frame || design.placement === "detached") return null;
  const heightIn = frame.surfaceIn;
  const peakIn = Math.max(heightIn, roof?.peakIn ?? 0);
  const main = mainBack(frame);
  const low = s.lower && s.lower.place === "under" ? s.lower : null;
  const lowMain = low ? mainBack(low.frame) : null;
  return {
    shape: design.shape,
    ctx: {
      deckHeightFt: heightIn / 12,
      peakFt: peakIn / 12,
      mainEdge: main ? { x0: main.x0 / 12, x1: main.x1 / 12 } : null,
      // The lower floor of a double deck: its boards, and its own back edge along the house.
      lower: low ? { floorFt: low.frame.surfaceIn / 12, x0: (low.offsetXIn + (lowMain ? lowMain.x0 : 0)) / 12, x1: (low.offsetXIn + (lowMain ? lowMain.x1 : low.design.shape.widthFt * 12)) / 12 } : null,
    },
  };
}

/** The wall's windows and doors as they stand now: the list they are edited as, and each as it is drawn (cut back or left out where two meet). */
export function wallOpenings(s: DeckStructure): { list: HouseOpening[]; drawn: DrawnOpening[]; byRule: boolean; sketch: boolean } | null {
  const d = houseDrawn(s);
  if (!d) return null;
  const house = s.design.house;
  const list = house.openings ? resolveOpenings(house.openings, openingFloors(s.design)) : ruleOpenings(d.shape, house, d.ctx);
  return { list, drawn: houseScene(d.shape, house, d.ctx).openingsAt ?? [], byRule: !house.openings, sketch: !house.openings || house.openingsSketch === true };
}

/** Which family an opening is swapped within, and what it can become. */
export function openingChoices(kind: OpeningKind): readonly OpeningChoice[] {
  return kind === "window" ? WINDOW_CHOICES : kind === "garage" ? [] : DOOR_CHOICES;
}

/** The patch that writes the list back: a wall drawn by rule becomes a sketch; a photo's wall stays real. */
function write(s: DeckStructure, list: HouseOpening[], sketch: boolean): DeckPatch {
  void s;
  return { house: { openings: list.slice(0, OPENING_LIMITS.count), ...(sketch ? { openingsSketch: true } : {}) } };
}

/** The rectangle an opening takes on the wall, ft. */
const rect = (o: HouseOpening) => ({ x0: o.xFt - o.widthFt / 2, x1: o.xFt + o.widthFt / 2, y0: o.sillFt, y1: o.sillFt + o.heightFt });
/** Clear of every other opening: a casing's room between two side by side, a band's between one over the other. */
function clear(list: readonly HouseOpening[], o: HouseOpening, only?: (k: HouseOpening) => boolean): boolean {
  const r = rect(o);
  return list.every((k) => {
    if (k.id === o.id || (only && !only(k))) return true;
    const q = rect(k);
    return Math.min(r.x1, q.x1) - Math.max(r.x0, q.x0) <= -(GAP_FT.side - 0.05) || Math.min(r.y1, q.y1) - Math.max(r.y0, q.y0) <= -(GAP_FT.over - 0.05);
  });
}

/** Held inside the part of the wall its middle stands over (a hand's width off each end), and under the wall's top. */
function onWall(s: DeckStructure, d: { shape: DeckShape; ctx: HouseSceneCtx }, o: HouseOpening, wallTopFt: number): HouseOpening {
  const parts = wallParts(s.design.house, d.shape);
  const all = { x0: Math.min(...parts.map((p) => p.x0)), x1: Math.max(...parts.map((p) => p.x1)) };
  const mid = clamp(o.xFt, all.x0 + 0.5, all.x1 - 0.5);
  const p = parts.find((q) => mid >= q.x0 - 1e-6 && mid <= q.x1 + 1e-6) ?? parts[0];
  const room = Math.max(MIN_WIDTH_FT[o.kind], p.x1 - p.x0 - 0.5);
  const widthFt = toInchFt(clamp(o.widthFt, MIN_WIDTH_FT[o.kind], Math.min(OPENING_LIMITS.widthFt.max, room)));
  const xFt = toInchFt(clamp(mid, p.x0 + 0.25 + widthFt / 2, Math.max(p.x0 + 0.25 + widthFt / 2, p.x1 - 0.25 - widthFt / 2)));
  const heightFt = toInchFt(clamp(o.heightFt, OPENING_LIMITS.heightFt.min, Math.min(OPENING_LIMITS.heightFt.max, Math.max(1, wallTopFt - 0.6 - (o.kind === "window" ? 0.5 : o.sillFt)))));
  const sillFt = toInchFt(clamp(o.sillFt, 0, Math.max(0, wallTopFt - 0.6 - heightFt)));
  return { ...o, xFt, widthFt, heightFt, sillFt };
}

/** Its sill kept as "so far above its floor" where it stands on one (so it follows that floor). */
function anchored(o: HouseOpening, floors: OpeningFloors): HouseOpening {
  if (!o.floor) return o;
  const at = o.floor === "deck" ? floors.deckFt : (floors.lowerFt ?? 0);
  const up = o.sillFt - at;
  if (up < -0.02) {
    // Below the floor it stood on: it is on the wall by its own height now.
    const { floor: _f, upFt: _u, ...rest } = o;
    void _f;
    void _u;
    return rest;
  }
  return { ...o, upFt: toInchFt(Math.max(0, up)) };
}

/** A door goes to the nearer floor: the deck's, or the lower floor of a double deck (the ground where there is none). */
function doorFloor(o: HouseOpening, sillFt: number, floors: OpeningFloors): HouseOpening {
  const low = floors.lowerFt ?? 0;
  const floor: "deck" | "lower" = Math.abs(sillFt - floors.deckFt) <= Math.abs(sillFt - low) ? "deck" : "lower";
  return { ...o, floor, upFt: 0, sillFt: toInchFt(floor === "deck" ? floors.deckFt : low) };
}

export interface OpeningChange {
  /** Its middle along the house, ft from the deck's left end. */
  xFt?: number;
  /** Its sill (a door: where it was pulled to — it goes to the nearer floor), ft above the ground. */
  sillFt?: number;
  widthFt?: number;
  heightFt?: number;
  /** What it becomes: an OpeningChoice's key ("slider3", "door2", "window2"…). */
  choice?: string;
}

/** MOVED, SIZED OR SWAPPED by hand. */
export function editOpening(s: DeckStructure, id: string, change: OpeningChange): DeckPatch | null {
  const d = houseDrawn(s);
  const now = wallOpenings(s);
  if (!d || !now) return null;
  const o = now.list.find((q) => q.id === id);
  if (!o) return null;
  const floors = openingFloors(s.design);
  const top = houseScene(d.shape, s.design.house, d.ctx).heightFt;
  const num = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  let next: HouseOpening = { ...o };
  const pick = change.choice ? openingChoices(o.kind).find((c) => c.key === change.choice) : undefined;
  if (change.choice && !pick) return null;
  if (pick) {
    next = { ...next, kind: pick.kind, panels: pick.panels, widthFt: pick.widthFt, ...(pick.kind !== "window" && o.kind === "garage" ? { heightFt: DOOR_HEIGHT_FT } : {}) };
  }
  if (num(change.widthFt) !== undefined) next.widthFt = num(change.widthFt)!;
  if (num(change.heightFt) !== undefined) next.heightFt = num(change.heightFt)!;
  if (num(change.xFt) !== undefined) next.xFt = num(change.xFt)!;
  if (num(change.sillFt) !== undefined) {
    if (next.kind === "window") next.sillFt = Math.max(0.25, num(change.sillFt)!);
    else next = doorFloor(next, num(change.sillFt)!, floors);
  }
  // (As asked, before the wall holds it in: a size that stops at its neighbour is looked for between what it was and this.)
  const asked = { ...next };
  next = anchored(onWall(s, d, next, top), floors);
  // WHO GIVES WAY. A swap takes its kind's width as asked: the larger opening wins, and what it covers is cut back or
  // left out of the picture (still on the list: it comes back when this one shrinks). A size pulled by hand stops at
  // the next opening. A MOVE lands beside what is in its way — the nearest clear place along the wall to where it was
  // put, looked for first on the side it came from; a door gives way only to another door (a window in a door's way
  // is the one cut back), a window to everything.
  const moved = num(change.xFt) !== undefined || num(change.sillFt) !== undefined;
  const sized = num(change.widthFt) !== undefined || num(change.heightFt) !== undefined;
  if (!pick && sized && !clear(now.list, next)) {
    let lo = 0;
    let hi = 1;
    const mix = (from: number, to: number, t: number) => from + (to - from) * t;
    const at = (t: number) => anchored(onWall(s, d, { ...asked, xFt: mix(o.xFt, asked.xFt, t), sillFt: mix(o.sillFt, asked.sillFt, t), widthFt: mix(o.widthFt, asked.widthFt, t), heightFt: mix(o.heightFt, asked.heightFt, t) }, top), floors);
    for (let k = 0; k < 10; k++) {
      const t = (lo + hi) / 2;
      if (clear(now.list, at(t))) lo = t;
      else hi = t;
    }
    next = at(lo);
  } else if (!pick && moved && !sized) {
    const inWay = next.kind === "window" ? undefined : (k: HouseOpening) => k.kind !== "window";
    if (!clear(now.list, next, inWay)) {
      const from = o.xFt >= next.xFt ? 1 : -1;
      let found: HouseOpening | null = null;
      for (let i = 1; i <= 144 && !found; i++) {
        for (const side of [from, -from]) {
          const x = next.xFt + (side * i) / 12;
          const cand = anchored(onWall(s, d, { ...next, xFt: x }, top), floors);
          // (Held back by the wall's end: no place there.)
          if (Math.abs(cand.xFt - x) > 0.011) continue;
          if (clear(now.list, cand, inWay)) {
            found = cand;
            break;
          }
        }
      }
      if (!found) return null;
      next = found;
    }
  }
  if (next.xFt === o.xFt && next.sillFt === o.sillFt && next.widthFt === o.widthFt && next.heightFt === o.heightFt && next.kind === o.kind && next.panels === o.panels && next.floor === o.floor && !now.byRule) return null;
  return write(s, now.list.map((q) => (q.id === id ? next : q)), now.sketch);
}

/** TAKEN OFF the wall. */
export function removeOpening(s: DeckStructure, id: string): DeckPatch | null {
  const now = wallOpenings(s);
  if (!now || !now.list.some((q) => q.id === id)) return null;
  return write(s, now.list.filter((q) => q.id !== id), now.sketch);
}

/**
 * ONE MORE on the wall: a door stands on the deck's floor, a window with its sill 3 ft above it — at `xFt`, or the first
 * clear place from the deck's middle outward.
 */
export function addOpening(s: DeckStructure, choiceKey: string, xFt?: number): { patch: DeckPatch; id: string } | null {
  const d = houseDrawn(s);
  const now = wallOpenings(s);
  const pick = [...DOOR_CHOICES, ...WINDOW_CHOICES].find((c) => c.key === choiceKey);
  if (!d || !now || !pick || now.list.length >= OPENING_LIMITS.count) return null;
  const floors = openingFloors(s.design);
  const top = houseScene(d.shape, s.design.house, d.ctx).heightFt;
  let n = now.list.length + 1;
  while (now.list.some((q) => q.id === `h${n}`)) n++;
  const base: HouseOpening = pick.kind === "window" ? { id: `h${n}`, kind: "window", xFt: 0, widthFt: pick.widthFt, heightFt: WINDOW_HEIGHT_FT, sillFt: floors.deckFt + WINDOW_UP_FT, panels: pick.panels, floor: "deck", upFt: WINDOW_UP_FT } : { id: `h${n}`, kind: pick.kind, xFt: 0, widthFt: pick.widthFt, heightFt: DOOR_HEIGHT_FT, sillFt: floors.deckFt, panels: pick.panels, floor: "deck", upFt: 0 };
  const mid = s.design.shape.widthFt / 2;
  const tries = typeof xFt === "number" && Number.isFinite(xFt) ? [xFt] : Array.from({ length: 121 }, (_, i) => mid + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.5);
  for (const x of tries) {
    const made = anchored(onWall(s, d, { ...base, xFt: x }, top), floors);
    if (Math.abs(made.xFt - x) > 0.26 && tries.length > 1) continue;
    if (clear(now.list, made)) return { patch: write(s, [...now.list, made], now.sketch), id: made.id };
  }
  return null;
}

/** "These are the real doors and windows" (the deck is checked against them) — or a picture again. */
export function openingsReal(s: DeckStructure, real: boolean): DeckPatch | null {
  const now = wallOpenings(s);
  if (!now) return null;
  return { house: { openings: now.list, openingsSketch: real ? undefined : true } };
}
