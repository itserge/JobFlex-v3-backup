/**
 * BY HAND (2026-11-13 — the owner: "make it so I can move beams and posts by hand. Just drag it in any place — or add,
 * or remove. Not a foot at a click: maybe I only need 6 inches. Move it with the hand, or type any inches I want.").
 *
 * One place for every move, add and take-off of a post or a beam, so the 3D's drag, the framing plan's drag and a
 * part's card all do the same thing, to the inch:
 *   - a post under a deck beam slides along its beam (design.framing.pins);
 *   - the front beam slides along the joists (design.framing.overhangFt), a free-standing deck's back beam too
 *     (.backOverhangFt), and a middle beam stands wherever it is put (.beamLines);
 *   - a roof post between two corners slides along its side (design.roof.pins); one that frames an opening takes the
 *     opening with it (.openings).
 *
 * A GRIP is one thing that can be taken hold of: its name through a drag, the line it slides on, where it is and how
 * far it can go. The name is the design's own id where the builder already placed the thing; for a post or a beam the
 * layout placed, it is the id it WILL have the moment it is moved — so a drag that starts on the layout's post goes
 * on, step after step, as a drag of the builder's post.
 *
 * Moving one post the layout set takes its beam's posts over as they stand (the others stay put); the same for a
 * middle beam and for a side of the roof. Nothing here overrides the structure: frame.ts and roof.ts stand what the
 * builder placed and add a post or a beam only where a table asks for one.
 */
import { POST_ACTUAL_IN, THICK_2X_IN } from "./codeTables";
import { applyDeckPatch, type DeckPatch } from "./checks";
import { DECK_BEAM_LIMITS, DECK_LIMITS, DECK_POST_LIMITS, ROOF_POST_LIMITS, ROOF_SIDES, type DeckBeamLine, type DeckDesign, type DeckPostPin, type RoofOpening, type RoofPin, type RoofSide } from "./design";
import { buildDeckFrame, type Beam, type DeckFrame } from "./frame";
import { buildStructure, type DeckStructure } from "./structure";

export type GripKind = "post" | "beam" | "roof-post";

export interface DeckGrip {
  kind: GripKind;
  /** Its name through a drag (see the head of this file). */
  id: string;
  /** The part it is: the frame's post or beam id, the roof's post id. */
  part: string;
  /** The line it slides on: along its beam or its side ("x"), or along the joists ("y"). */
  axis: "x" | "y";
  /** Where it is on that line and how far it can go, inches (a deck post: from the deck's left end; a beam: from the house line; a roof post: from its side's start). */
  at: number;
  min: number;
  max: number;
  /** Its centre on the plan, inches. */
  x: number;
  y: number;
  /** The builder already placed it. */
  byHand: boolean;
  /** "Post under the front beam", "Middle beam", "Roof post". */
  label: string;
  /** How a builder says where it is: `sign × (at − origin)` inches `from` ("from the deck's left end", "in from the deck's front edge"). */
  origin: number;
  sign: 1 | -1;
  from: string;
  /** A deck post: the beam it stands under. */
  beamId?: string;
  /** A roof post: the side it stands on. */
  side?: RoofSide;
  /** An end of its beam, or a part that can only stand where it is: said on its card. */
  fixed?: string;
}

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** A whole number as a short piece of an id (a minus sign reads "n"). */
const b36 = (n: number) => Math.round(n).toString(36).replace("-", "n");
/** An id not yet in use: the base, or the base with a letter after it. */
function fresh(base: string, used: Set<string>): string {
  const b = base.slice(0, 11);
  let id = b;
  for (let k = 0; used.has(id) && k < 26; k++) id = `${b}${String.fromCharCode(97 + k)}`;
  used.add(id);
  return id;
}

/** A roof post's width, and half of an opening along its side — its middle to the centre of either post — as roof.ts frames it (never wider than the side between its corner posts). */
const roofPostIn = (d: DeckDesign) => POST_ACTUAL_IN[d.roof.post]?.[0] ?? 5.5;
const openingHalfIn = (o: RoofOpening, sideIn: number, pw: number) => Math.min(o.widthFt * 12, sideIn - pw) / 2 + pw / 2;

/** `v`, or — where it falls inside a stretch that is taken — the nearest whole inch just outside it that is free and inside [lo, hi]; null when there is none. */
function freeAt(v: number, taken: Array<[number, number]>, lo: number, hi: number): number | null {
  const inside = (c: number) => taken.some(([a, b]) => c > a && c < b);
  const hit = taken.find(([a, b]) => v > a && v < b);
  if (!hit) return v;
  const near = [Math.floor(hit[0]), Math.ceil(hit[1])].filter((c) => c >= lo && c <= hi && !inside(c)).sort((p, q) => Math.abs(p - v) - Math.abs(q - v));
  return near.length ? near[0] : null;
}

const beamName = (b: Pick<Beam, "role">) => (b.role === "front" ? "front beam" : b.role === "middle" ? "middle beam" : "beam by the house");

/** The side of the roof a post stands on and its place along it, as design.roof's posts and openings are measured: feet from the side's left end (front, back) or its house end (left, right). Between the side's corners only. */
export function roofSideOf(roof: NonNullable<DeckStructure["roof"]>, post: { x: number; y: number }): { side: RoofSide; atFt: number; lengthFt: number } | null {
  for (const side of ROOF_SIDES) {
    const e = roof.sides[side];
    if (!e) continue;
    const dx = post.x - e.x;
    const dy = post.y - e.y;
    const t = dx * e.ux + dy * e.uy;
    if (Math.abs(dx * e.uy - dy * e.ux) < 0.6 && t > 1 && t < e.lengthIn - 1) return { side, atFt: t / 12, lengthFt: e.lengthIn / 12 };
  }
  return null;
}

/** The sides of the roof that meet at a corner post. */
export function roofCornerSides(roof: NonNullable<DeckStructure["roof"]>, post: { x: number; y: number }): RoofSide[] {
  return ROOF_SIDES.filter((side) => {
    const e = roof.sides[side];
    return !!e && (Math.hypot(post.x - e.x, post.y - e.y) < 1.5 || Math.hypot(post.x - (e.x + e.ux * e.lengthIn), post.y - (e.y + e.uy * e.lengthIn)) < 1.5);
  });
}

/** The id each middle beam goes by as a line of the builder's: its own where it is one already, else the one it will take. */
function lineIds(d: DeckDesign, f: DeckFrame): Map<string, string> {
  const used = new Set(d.framing.beamLines.map((l) => l.id));
  const out = new Map<string, string>();
  for (const b of f.beams) {
    if (b.role !== "middle") continue;
    out.set(b.id, b.by ? b.by.id : fresh(`m${b36(b.lineY)}${b.zoneIds.join("")}`, used));
  }
  return out;
}

/** Everything on the deck that can be taken hold of and moved: the posts under its beams, the beams, the roof's posts between the corners. The lower level keeps its own. */
export function deckGrips(s: DeckStructure): DeckGrip[] {
  const out: DeckGrip[] = [];
  const d = s.design;
  const f = s.frame;
  if (f) {
    const usedPins = new Set(d.framing.pins.map((p) => p.id));
    const lines = lineIds(d, f);
    const detached = d.placement === "detached";
    for (const beam of f.beams) {
      const zs = f.zones.filter((z) => beam.zoneIds.includes(z.zone.id));
      // The posts, along the beam.
      for (const post of f.posts.filter((p) => p.beamId === beam.id && !p.roof).sort((a, b) => a.x - b.x)) {
        out.push({
          kind: "post",
          id: post.by ? post.by.id : fresh(`p${b36(post.x)}-${b36(beam.lineY)}`, usedPins),
          part: post.id,
          axis: "x",
          at: Math.round(post.x),
          min: Math.ceil(beam.x0 + 1),
          max: Math.floor(beam.x1 - 1),
          x: post.x,
          y: post.y,
          byHand: !!post.by,
          label: `Post under the ${beamName(beam)}`,
          origin: 0,
          sign: 1,
          from: "from the deck's left end",
          beamId: beam.id,
        });
      }
      // The beam, along the joists.
      if (!zs.length) continue;
      const x = (beam.x0 + beam.x1) / 2;
      const gap = DECK_BEAM_LIMITS.gapIn;
      /** The support before this beam and the one after it, in every part of the deck it runs under. */
      const before = Math.max(...zs.map((z) => {
        const k = z.beamYs.findIndex((y) => Math.abs(y - beam.lineY) < 0.01);
        return k > 0 ? z.beamYs[k - 1] : z.back === "ledger" ? z.zone.y0 + THICK_2X_IN : z.zone.y0 - gap;
      }));
      const after = Math.min(...zs.map((z) => {
        const k = z.beamYs.findIndex((y) => Math.abs(y - beam.lineY) < 0.01);
        return k >= 0 && k < z.beamYs.length - 1 ? z.beamYs[k + 1] : z.zone.y1 + gap;
      }));
      const far = DECK_LIMITS.overhangFt.max * 12;
      // One overhang for the whole deck: the front beam comes in only as far as the shallowest part of the deck lets
      // it — a foot short of that part's ledger, or of its own back beam (which, left to follow it, comes out as far).
      const backSet = typeof d.framing.backOverhangFt === "number" ? d.framing.backOverhangFt * 12 : null;
      const frontRoom = Math.floor(Math.min(...f.zones.map((z) => (z.back === "ledger" ? z.zone.y1 - z.zone.y0 - THICK_2X_IN - gap : backSet === null ? (z.zone.y1 - z.zone.y0 - gap) / 2 : z.zone.y1 - z.zone.y0 - gap - z.backCantIn - 1.5))));
      const backRoom = Math.floor(Math.min(...f.zones.filter((z) => z.back === "beam").map((z) => z.zone.y1 - z.zone.y0 - gap - z.frontCantIn - 1.5)));
      if (beam.role === "front") {
        const edge = Math.min(...zs.map((z) => z.zone.y1));
        const flush = beam.style !== "dropped";
        out.push({ kind: "beam", id: `front:${zs[0].zone.id}`, part: beam.id, axis: "y", at: beam.lineY, min: Math.min(edge, Math.max(edge - far, Math.ceil(before + gap), edge - Math.max(0, frontRoom))), max: edge, x, y: beam.y, byHand: d.framing.overhangFt !== "auto", label: "Front beam", origin: edge, sign: -1, from: "in from the deck's front edge", ...(flush ? { fixed: "A flush beam is the deck's own edge: drop the beams under the joists to move it in." } : {}) });
      } else if (beam.role === "back") {
        const edge = Math.max(...zs.map((z) => z.zone.y0));
        const flush = beam.style !== "dropped";
        out.push({ kind: "beam", id: `back:${zs[0].zone.id}`, part: beam.id, axis: "y", at: beam.lineY, min: edge, max: Math.max(edge, Math.min(edge + far, Math.floor(after - gap), edge + Math.max(0, backRoom))), x, y: beam.y, byHand: d.framing.backOverhangFt !== "auto", label: "Beam by the house", origin: edge, sign: 1, from: detached ? "in from the deck's back edge" : "out from the house", ...(flush ? { fixed: "A flush beam is the deck's own edge: drop the beams under the joists to move it in." } : {}) });
      } else {
        const back = Math.min(...zs.map((z) => z.zone.y0));
        out.push({ kind: "beam", id: lines.get(beam.id) ?? beam.id, part: beam.id, axis: "y", at: beam.lineY, min: Math.ceil(before + gap), max: Math.floor(after - gap), x, y: beam.y, byHand: !!beam.by, label: "Middle beam", origin: back, sign: 1, from: detached ? "from the deck's back edge" : "from the house" });
      }
    }
  }
  // One line of the builder's that stands as two beams (under two parts of the deck that do not touch) moves as one:
  // only as far as both can go.
  for (const g of out) {
    if (g.kind !== "beam" || g.id.includes(":")) continue;
    const same = out.filter((q) => q.kind === "beam" && q.id === g.id);
    if (same.length < 2) continue;
    const lo = Math.max(...same.map((q) => q.min));
    const hi = Math.min(...same.map((q) => q.max));
    for (const q of same) {
      q.min = Math.min(lo, q.at);
      q.max = Math.max(hi, q.at);
    }
  }
  const roof = s.roof;
  if (roof) {
    const used = new Set(d.roof.pins.map((p) => p.id));
    const crossEnds = roof.headers.filter((h) => h.cross).flatMap((h) => [{ x: h.x0, y: h.y0 }, { x: h.x1, y: h.y1 }]);
    for (const post of roof.posts) {
      if (post.corner) continue;
      const on = roofSideOf(roof, post);
      if (!on) continue;
      const across = on.side === "front" || on.side === "back";
      const len = on.lengthFt * 12;
      const pw = roofPostIn(d);
      const opening = post.by?.kind === "opening" ? d.roof.openings.find((o) => o.id === post.by?.id) : undefined;
      if (post.by?.kind === "opening" && !opening) continue;
      // As roof.ts stands them: a post no nearer a corner post than a post's width and an inch; an opening whole on
      // its side, its middle where the side lets it be.
      const half = opening ? openingHalfIn(opening, len, pw) : 0;
      out.push({
        kind: "roof-post",
        id: opening ? `open:${opening.id}` : post.by ? post.by.id : fresh(`r${b36(post.x)}-${b36(post.y)}`, used),
        part: post.id,
        axis: across ? "x" : "y",
        at: opening ? Math.round(clampN(opening.atFt * 12, half, len - half)) : Math.round(on.atFt * 12),
        min: opening ? Math.ceil(half) : Math.ceil(pw + 1),
        max: opening ? Math.floor(len - half) : Math.floor(len - pw - 1),
        x: post.x,
        y: post.y,
        byHand: !!post.by,
        label: opening ? "Opening between two roof posts" : "Roof post",
        origin: 0,
        sign: 1,
        from: opening ? (across ? "to its middle, from the side's left end" : "to its middle, from the house end of the side") : across ? "from the side's left end" : "from the house end of the side",
        side: on.side,
        // A post under the end of a cross beam is where that beam comes down: the structure's, not the layout's.
        ...(!post.by && crossEnds.some((q) => Math.hypot(q.x - post.x, q.y - post.y) < 1.5) ? { fixed: "It stands under the end of a cross beam: it stays where that beam comes down." } : {}),
      });
    }
  }
  return out;
}

/** The grip of a part of the picture (a post or a beam of the main deck, a post of the roof), if it has one. */
export function gripOfPart(s: DeckStructure, ref: { kind: string; id: string; level?: string }, grips: DeckGrip[] = deckGrips(s)): DeckGrip | null {
  if (ref.level === "lower") return null;
  const kind: GripKind | null = ref.kind === "deck-post" ? "post" : ref.kind === "deck-beam" ? "beam" : ref.kind === "roof-post" ? "roof-post" : null;
  return kind ? grips.find((g) => g.kind === kind && g.part === ref.id) ?? null : null;
}

/** The part of the picture a grip is, as the cards name parts. */
export function partOfGrip(g: Pick<DeckGrip, "kind" | "part">): { kind: "deck-post" | "deck-beam" | "roof-post"; id: string } {
  return { kind: g.kind === "post" ? "deck-post" : g.kind === "beam" ? "deck-beam" : "roof-post", id: g.part };
}

/** What a builder reads for a grip's place: inches from where it is measured. */
export const gripShownIn = (g: Pick<DeckGrip, "at" | "origin" | "sign">, at = g.at) => Math.round(g.sign * (at - g.origin));
/** …and the place on its line for a figure typed that way. */
export const gripAtFor = (g: Pick<DeckGrip, "origin" | "sign">, shownIn: number) => g.origin + g.sign * shownIn;

/* ------------------------------------------------------------------ */
/*  Taking over what the layout placed                                 */
/* ------------------------------------------------------------------ */

/**
 * Middle beams the layout placed, as lines of the builder's where they stand now: every one under the parts of the
 * deck named — while no beam there is the builder's yet, so moving one leaves the others where they were — and the
 * beam `must` always. Where the builder already has a beam, the ones the joists' spans added stay the layout's: they
 * come and go as the spans ask. The posts already set by hand under a beam that is a line are tied to it, to go with it.
 */
function takeLines(s: DeckStructure, zoneIds: readonly string[], must?: string): { beamLines: DeckBeamLine[]; pins: DeckPostPin[]; idOf: Map<string, string> } | null {
  const d = s.design;
  const f = s.frame;
  if (!f) return null;
  const idOf = lineIds(d, f);
  const plain = !f.zones.some((z) => zoneIds.includes(z.zone.id) && z.byHand.length > 0);
  const take = f.beams.filter((b) => b.role === "middle" && !b.by && (b.id === must || (plain && b.zoneIds.some((z) => zoneIds.includes(z)))));
  const beamLines = [...d.framing.beamLines, ...take.map((b) => ({ id: idOf.get(b.id)!, atFt: Math.round(b.lineY) / 12, zones: [...b.zoneIds].sort() }))];
  if (beamLines.length > DECK_BEAM_LIMITS.lines) return null;
  const lined = new Set([...take, ...f.beams.filter((b) => b.by)].map((b) => b.id));
  const pins = d.framing.pins.map((p) => {
    if (p.line) return p;
    const post = f.posts.find((q) => q.by?.id === p.id);
    return post && lined.has(post.beamId) ? { ...p, beam: "middle" as const, line: idOf.get(post.beamId)! } : p;
  });
  return { beamLines: beamLines.sort((a, b) => a.atFt - b.atFt), pins, idOf };
}

/**
 * The posts of one beam as posts of the builder's. A beam with posts set by hand already keeps them and gains the one
 * named (a post the spans added, now the builder's); a beam the layout laid out gets every post of it, where it stands.
 * A middle beam the layout placed becomes a line of the builder's too, so its posts go with it.
 */
function takePosts(s: DeckStructure, beamId: string, grips: DeckGrip[], also?: string): { pins: DeckPostPin[]; beamLines?: DeckBeamLine[] } | null {
  const d = s.design;
  const f = s.frame;
  const beam = f?.beams.find((b) => b.id === beamId);
  if (!f || !beam) return null;
  const mine = grips.filter((g) => g.kind === "post" && g.beamId === beamId);
  const taken = mine.some((g) => g.byHand);
  let pins = d.framing.pins;
  let beamLines: DeckBeamLine[] | undefined;
  let line = beam.by?.id;
  if (beam.role === "middle" && !beam.by && !taken) {
    const t = takeLines(s, beam.zoneIds, beam.id);
    if (!t) return null;
    pins = t.pins;
    beamLines = t.beamLines;
    line = t.idOf.get(beam.id);
  }
  const role: DeckPostPin["beam"] = line ? "middle" : beam.role;
  const add = mine.filter((g) => !g.byHand && (!taken || g.id === also));
  pins = [...pins, ...add.map((g) => ({ id: g.id, beam: role, atFt: g.at / 12, ...(line ? { line } : {}) }))];
  if (pins.length > DECK_POST_LIMITS.pins) return null;
  return { pins, ...(beamLines ? { beamLines } : {}) };
}

/* ------------------------------------------------------------------ */
/*  Move                                                               */
/* ------------------------------------------------------------------ */

/** A post's width and an inch: the nearest two posts of one beam may stand. */
const postClearIn = (d: DeckDesign) => Math.ceil((POST_ACTUAL_IN[d.framing.post]?.[0] ?? 5.5) + 1);

function movePost(s: DeckStructure, id: string, at: number, grips: DeckGrip[]): DeckPatch | null {
  const d = s.design;
  const grip = grips.find((g) => g.kind === "post" && g.id === id);
  if (!grip || !grip.beamId) {
    // A post of the builder's that is not standing just now (two set within a post's width are one post): it can still be moved off.
    if (!d.framing.pins.some((p) => p.id === id)) return null;
    return { framing: { pins: d.framing.pins.map((p) => (p.id === id ? { ...p, atFt: clampN(Math.round(at), 0, DECK_POST_LIMITS.atFt.max * 12) / 12 } : p)) } };
  }
  const taken = takePosts(s, grip.beamId, grips, id);
  if (!taken) return null;
  // Beside the builder's other posts under this beam, never onto one: it stops a post's width short, and goes on past it.
  const clear = postClearIn(d);
  const others = grips.filter((g) => g.kind === "post" && g.beamId === grip.beamId && g.id !== id && taken.pins.some((p) => p.id === g.id)).map((g) => g.at);
  let x = clampN(Math.round(at), grip.min, grip.max);
  const hit = others.find((o) => Math.abs(x - o) < clear);
  if (hit !== undefined) {
    x = x < hit ? hit - clear : hit + clear;
    if (x < grip.min || x > grip.max || others.some((o) => Math.abs(x - o) < clear)) return null;
  }
  if (grip.byHand && x === grip.at) return null;
  const patch: DeckPatch = { framing: { pins: taken.pins.map((p) => (p.id === id ? { ...p, atFt: x / 12 } : p)), ...(taken.beamLines ? { beamLines: taken.beamLines } : {}) } };
  // It must be a post that stands: where another post of the builder's already holds the place (one not standing just now, two having been set as one), it does not go.
  return buildDeckFrame(applyDeckPatch(d, patch)).posts.some((p) => p.by?.id === id) ? patch : null;
}

/** The joists stay inside their table: every span and every overhang. */
const joistsInside = (d: DeckDesign) => buildDeckFrame(d).zones.every((z) => z.ok);

/**
 * The overhang nearest the one asked for that the joist table allows (a joist may run past a beam a quarter of the
 * span behind it): asked for, if it is inside; else as far toward it from where the beam stands as the table goes.
 */
function overhangInside(d: DeckDesign, key: "overhangFt" | "backOverhangFt", wantIn: number, nowIn: number): number {
  const ok = (c: number) => joistsInside(applyDeckPatch(d, { framing: { [key]: c / 12 } }));
  if (ok(wantIn) || !ok(nowIn)) return wantIn;
  let good = nowIn;
  let bad = wantIn;
  while (Math.abs(bad - good) > 1) {
    const mid = Math.round((good + bad) / 2);
    if (ok(mid)) good = mid;
    else bad = mid;
  }
  return good;
}

function moveBeam(s: DeckStructure, id: string, at: number, grips: DeckGrip[]): DeckPatch | null {
  const d = s.design;
  const grip = grips.find((g) => g.kind === "beam" && g.id === id);
  if (!grip || grip.fixed) return null;
  const y = clampN(Math.round(at), grip.min, grip.max);
  if (id.startsWith("front:") || id.startsWith("back:")) {
    const key = id.startsWith("front:") ? "overhangFt" : "backOverhangFt";
    const now = Math.round(grip.sign * (grip.at - grip.origin));
    const c = overhangInside(d, key, clampN(Math.round(grip.sign * (y - grip.origin)), 0, DECK_LIMITS.overhangFt.max * 12), now);
    if (c === now) return null;
    return { framing: { [key]: c / 12 } };
  }
  const beam = s.frame?.beams.find((b) => b.id === grip.part);
  const t = beam ? takeLines(s, beam.zoneIds, beam.id) : null;
  if (!t) return null;
  if (grip.byHand && y === Math.round(grip.at)) return null;
  const patch: DeckPatch = { framing: { beamLines: t.beamLines.map((l) => (l.id === id ? { ...l, atFt: y / 12 } : l)), pins: t.pins } };
  // It must be a beam that stands.
  return buildDeckFrame(applyDeckPatch(d, patch)).beams.some((b) => b.by?.id === id) ? patch : null;
}

/** A side of the roof's posts between its corners as posts of the builder's, where they stand; the ones already set by hand, or framing an opening, are theirs already. */
function takeRoofSide(s: DeckStructure, side: RoofSide, grips: DeckGrip[]): RoofPin[] | null {
  const add = grips.filter((g) => g.kind === "roof-post" && g.side === side && !g.byHand && !g.fixed);
  const pins = [...s.design.roof.pins, ...add.map((g) => ({ id: g.id, side, atFt: g.at / 12 }))];
  return pins.length > ROOF_POST_LIMITS.pins ? null : pins;
}

function moveRoofPost(s: DeckStructure, id: string, at: number, grips: DeckGrip[]): DeckPatch | null {
  const d = s.design;
  const grip = grips.find((g) => g.kind === "roof-post" && g.id === id);
  const isOpening = id.startsWith("open:");
  const oid = id.slice(5);
  if (!grip || !grip.side) {
    // A post of the builder's that is not standing just now: it can still be moved to where it can stand.
    if (isOpening || !d.roof.pins.some((p) => p.id === id)) return null;
    return { roof: { pins: d.roof.pins.map((p) => (p.id === id ? { ...p, atFt: clampN(Math.round(at), 0, ROOF_POST_LIMITS.atFt.max * 12) / 12 } : p)) } };
  }
  if (grip.fixed) return null;
  const side = grip.side;
  const pw = roofPostIn(d);
  const clear = pw + 1;
  const sideIn = grip.max + (isOpening ? grip.min : clear);
  // What else stands on this side: the other openings (each with its two posts) and the other posts.
  const here = grips.filter((g) => g.kind === "roof-post" && g.side === side && g.id !== id);
  const opens = d.roof.openings.filter((o) => o.side === side && o.id !== oid && here.some((g) => g.id === `open:${o.id}`)).map((o) => ({ c: here.find((g) => g.id === `open:${o.id}`)!.at, half: openingHalfIn(o, sideIn, pw) }));
  const others = here.filter((g) => !g.id.startsWith("open:"));
  if (isOpening) {
    const me = d.roof.openings.find((o) => o.id === oid);
    if (!me) return null;
    // Never over another opening, nor over a post the builder set (the layout's own posts make way).
    const half = openingHalfIn(me, sideIn, pw);
    const taken: Array<[number, number]> = [...opens.map((o): [number, number] => [o.c - o.half - half + 0.5, o.c + o.half + half - 0.5]), ...others.filter((g) => g.byHand).map((g): [number, number] => [g.at - half - clear, g.at + half + clear])];
    const v = freeAt(clampN(Math.round(at), grip.min, grip.max), taken, grip.min, grip.max);
    if (v === null || v === grip.at) return null;
    const patch: DeckPatch = { roof: { openings: d.roof.openings.map((o) => (o.id === oid ? { ...o, atFt: v / 12 } : o)) } };
    // It must still have a post of its own to be held by (an opening that fills its side stands on the corner posts alone).
    return buildStructure(applyDeckPatch(d, patch)).roof?.posts.some((p) => p.by?.kind === "opening" && p.by.id === oid) ? patch : null;
  }
  const pins = takeRoofSide(s, side, grips);
  if (!pins) return null;
  // Beside the side's other posts and its openings, never on one or in one.
  const taken: Array<[number, number]> = [...opens.map((o): [number, number] => [o.c - o.half - clear, o.c + o.half + clear]), ...others.map((g): [number, number] => [g.at - clear, g.at + clear])];
  const v = freeAt(clampN(Math.round(at), grip.min, grip.max), taken, grip.min, grip.max);
  if (v === null || (grip.byHand && v === grip.at)) return null;
  const patch: DeckPatch = { roof: { pins: pins.map((p) => (p.id === id ? { ...p, atFt: v / 12 } : p)) } };
  // It must be a post that stands: where the roof would not stand it (a place it keeps for something else), it does not go.
  return buildStructure(applyDeckPatch(d, patch)).roof?.posts.some((p) => p.by?.kind === "pin" && p.by.id === id) ? patch : null;
}

/**
 * Move a grip to `at` on its line (inches; see DeckGrip.at). The place is kept inside what the part allows — a post
 * between its beam's ends and clear of the builder's other posts, a beam a foot clear of the supports beside it and
 * its overhang inside the joist table. null: nothing to move, or nowhere to go.
 */
export function moveGrip(s: DeckStructure, kind: GripKind, id: string, at: number, grips: DeckGrip[] = deckGrips(s)): DeckPatch | null {
  if (!Number.isFinite(at)) return null;
  return kind === "post" ? movePost(s, id, at, grips) : kind === "beam" ? moveBeam(s, id, at, grips) : moveRoofPost(s, id, at, grips);
}

/* ------------------------------------------------------------------ */
/*  Add and take off                                                   */
/* ------------------------------------------------------------------ */

/** The middle of the longest stretch between two of `at` (sorted), and how long that stretch is. */
function widest(at: number[]): { mid: number; w: number } | null {
  let best: { mid: number; w: number } | null = null;
  for (let k = 1; k < at.length; k++) {
    const w = at[k] - at[k - 1];
    if (!best || w > best.w + 0.01) best = { mid: Math.round((at[k] + at[k - 1]) / 2), w };
  }
  return best;
}

/** One more post under a beam: in the middle of its longest span. The beam's other posts stay where they stand. */
export function addPostUnder(s: DeckStructure, beamId: string, grips: DeckGrip[] = deckGrips(s)): { patch: DeckPatch; at: number; spanIn: number } | null {
  const beam = s.frame?.beams.find((b) => b.id === beamId);
  if (!beam) return null;
  const taken = takePosts(s, beamId, grips);
  const gap = widest([...beam.postXs].sort((a, b) => a - b));
  if (!taken || !gap || gap.w < 2 * postClearIn(s.design) || taken.pins.length >= DECK_POST_LIMITS.pins) return null;
  const used = new Set(taken.pins.map((p) => p.id));
  const line = beam.by?.id ?? taken.pins.find((p) => grips.some((g) => g.beamId === beamId && g.id === p.id) && p.line)?.line;
  const pin: DeckPostPin = { id: fresh(`p${b36(gap.mid)}-${b36(beam.lineY)}`, used), beam: line ? "middle" : beam.role, atFt: gap.mid / 12, ...(line ? { line } : {}) };
  return { patch: { framing: { pins: [...taken.pins, pin], ...(taken.beamLines ? { beamLines: taken.beamLines } : {}) } }, at: gap.mid, spanIn: gap.w };
}

/** Take a post off its beam. One the builder set goes; one the layout set goes with the beam's other posts kept where they stand. The beam then gets a post back only where a span or an end needs one. */
export function removePost(s: DeckStructure, id: string, grips: DeckGrip[] = deckGrips(s)): DeckPatch | null {
  const d = s.design;
  const grip = grips.find((g) => g.kind === "post" && g.id === id);
  if (!grip || !grip.beamId) return d.framing.pins.some((p) => p.id === id) ? { framing: { pins: d.framing.pins.filter((p) => p.id !== id) } } : null;
  if (grip.byHand) return { framing: { pins: d.framing.pins.filter((p) => p.id !== id) } };
  const taken = takePosts(s, grip.beamId, grips);
  if (!taken) return null;
  return { framing: { pins: taken.pins.filter((p) => p.id !== id), ...(taken.beamLines ? { beamLines: taken.beamLines } : {}) } };
}

/** One more beam under the joists: in the middle of the longest joist span, in the part of the deck the named beam runs under (the deepest, with none named). The beams there now stay where they stand. */
export function addBeam(s: DeckStructure, nearBeamId?: string): { patch: DeckPatch; at: number; spanIn: number } | null {
  const f = s.frame;
  if (!f) return null;
  const near = nearBeamId ? f.beams.find((b) => b.id === nearBeamId) : undefined;
  const zs = near ? f.zones.filter((z) => near.zoneIds.includes(z.zone.id)) : f.zones;
  const z = zs.reduce<(typeof zs)[number] | null>((m, q) => (!m || q.zone.y1 - q.zone.y0 > m.zone.y1 - m.zone.y0 ? q : m), null);
  const t = z ? takeLines(s, [z.zone.id]) : null;
  if (!z || !t) return null;
  const gap = widest(z.back === "ledger" ? [z.zone.y0 + THICK_2X_IN, ...z.beamYs] : [...z.beamYs]);
  if (!gap || gap.w < 2 * DECK_BEAM_LIMITS.gapIn || z.beamYs.length - (z.back === "beam" ? 2 : 1) >= 4 || t.beamLines.length >= DECK_BEAM_LIMITS.lines) return null;
  const used = new Set(t.beamLines.map((l) => l.id));
  const line: DeckBeamLine = { id: fresh(`m${b36(gap.mid)}${z.zone.id}`, used), atFt: gap.mid / 12, zones: [z.zone.id] };
  return { patch: { framing: { beamLines: [...t.beamLines, line].sort((a, b) => a.atFt - b.atFt), pins: t.pins } }, at: gap.mid, spanIn: gap.w };
}

/** Take a middle beam of the builder's off, and the posts set by hand under it. The joists then get a beam back only where their span needs one. */
export function removeBeamLine(s: DeckStructure, id: string): DeckPatch | null {
  const d = s.design;
  if (!d.framing.beamLines.some((l) => l.id === id)) return null;
  return { framing: { beamLines: d.framing.beamLines.filter((l) => l.id !== id), pins: d.framing.pins.filter((p) => p.line !== id) } };
}

/** One more post on a side of the roof: in the middle of the longest stretch between two posts of that side. The side's other posts stay where they stand. */
export function addRoofPost(s: DeckStructure, side: RoofSide, grips: DeckGrip[] = deckGrips(s)): { patch: DeckPatch; at: number; spanIn: number } | null {
  const roof = s.roof;
  const edge = roof?.sides[side];
  if (!roof || !edge) return null;
  const pins = takeRoofSide(s, side, grips);
  if (!pins || pins.length >= ROOF_POST_LIMITS.pins) return null;
  // Every post that stands on the side now, its corners too; an opening's two posts are where the opening puts them.
  const here = roof.posts.map((p) => roofSideOf(roof, p)).filter((q): q is NonNullable<typeof q> => !!q && q.side === side).map((q) => Math.round(q.atFt * 12));
  const gap = widest([0, ...here, Math.round(edge.lengthIn)].sort((a, b) => a - b));
  if (!gap || gap.w < 24) return null;
  const opens = s.design.roof.openings.filter((o) => o.side === side);
  if (opens.some((o) => Math.abs(gap.mid - o.atFt * 12) < (o.widthFt * 12) / 2)) return null;
  const used = new Set(pins.map((p) => p.id));
  return { patch: { roof: { pins: [...pins, { id: fresh(`r${b36(gap.mid)}${side[0]}`, used), side, atFt: gap.mid / 12 }] } }, at: gap.mid, spanIn: gap.w };
}
