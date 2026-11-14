// THE WHOLE STRUCTURE, ASSEMBLED (Deck Studio M3, 2026-10-10) — pure.
//
// One design → everything that stands on the site, built in the order the
// parts depend on one another:
//   1. the roof (its posts need footings in the deck),
//   2. the main deck's frame over the real ground (the site's slope lengthens
//      the downhill posts), with the roof's posts through it,
//   3. the lower level in front, a deck of its own a step down,
//   4. the stairs — from either level, onto the ground, a pad or the lower
//      deck,
//   5. the rails along every open edge that is left.
// pricing.ts prices it, takeoff.ts counts it, checks.ts reads it, scene.ts
// draws it. Nothing here is stored: a design builds the same structure every
// time.

import { buildDeckFrame, type BuildOptions, type DeckFrame, PIER_BLOCK } from "./frame";
import { buildRoofFrame, roofPostsForDeck, type RoofFrame, type StairOpening } from "./roof";
import { deckSurface, type DeckSurface } from "./surface";
import { buildStair, stairTopEdge, type StairBuild, type StairLevel } from "./stairs";
import { POST_ACTUAL_IN } from "./codeTables";
import { buildRails, type RailBuild, type RailLevel } from "./rails";
import { buildSkirt, type SkirtBuild, type SkirtLevelInput } from "./skirt";
import { buildElectrical, type ElectricalBuild } from "./electrical";
import { defaultFramingSpecies, framingSpecies } from "./catalog";
import { groundAt as slopeGroundAt, slopeGradePct } from "./site";
import { defaultStair, frontEdgeAt, hasDeck, hasLowerLevel, hasRoof, isDoubleDeck, normalizeDeckDesign, shapeOutline, shapeZones, type DeckDesign, type DeckEdge, type StairDesign } from "./design";
import { deckCodeFor, type DeckStateCode } from "./stateCodes";

/** The lower level: its own frame and boards, placed in front of the main deck. */
export interface LowerBuild {
  design: DeckDesign;
  frame: DeckFrame;
  surface: DeckSurface;
  /** Where its (0, 0) sits in the main deck's coordinates, inches. */
  offsetXIn: number;
  offsetYIn: number;
  /** The step down from the main deck, inches. */
  dropIn: number;
  /** In front of the main deck, a step or a stair down — or under it: the lower floor of a double deck, hung on the main deck's posts (2026-11-13). */
  place: "front" | "under";
}

export interface DeckStructure {
  design: DeckDesign;
  frame: DeckFrame | null;
  surface: DeckSurface | null;
  roof: RoofFrame | null;
  lower: LowerBuild | null;
  stairs: StairBuild[];
  rails: RailBuild;
  /** Skirting under the deck (lib/deck/skirt): null when none is asked for, or the deck is too near the ground. */
  skirt: SkirtBuild | null;
  electrical: ElectricalBuild;
  /** The ground under any point of the plan, inches against the house line's ground. */
  groundAt: (x: number, y: number) => number;
  gradePct: number;
  /** Between the levels: a plain step the lower deck itself makes, or a stair that is wanted. */
  stepDown: { lengthIn: number; dropIn: number; stairWanted: boolean } | null;
  /** The residential code the deck is checked against: the job's state's own edition and amendments (lib/deck/stateCodes). */
  code: DeckStateCode;
}

export type StructureOptions = BuildOptions;

/** What a lower-level part's key starts with in the design's lists of parts taken out by hand. */
export const LOWER_KEY = "L:";

/** The stair the engine builds between the levels when the design has none to the lower one (see buildDeckStructure). */
export const BETWEEN_LEVELS_STAIR_ID = "between-levels";

/** The stair a contractor would put between the levels: from the main deck's front, centred on the lower level, up to 6 ft wide, onto it. */
export function betweenLevelsStair(design: DeckDesign, lowerOffsetXIn: number, id = BETWEEN_LEVELS_STAIR_ID): StairDesign {
  const atFt = Math.round(((lowerOffsetXIn + (design.lower.widthFt * 12) / 2) / 12) * 10) / 10;
  return { ...defaultStair(id, "front", atFt), widthFt: Math.min(6, design.lower.widthFt), landing: "patio" };
}

/** Which straight edge of the frame an outline segment lies on, if any. */
function edgeFor(edges: readonly DeckEdge[], A: { x: number; y: number }, B: { x: number; y: number }): DeckEdge | null {
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  for (const e of edges) {
    const horizontal = Math.abs(e.y0 - e.y1) < 0.01;
    if (horizontal && Math.abs(my - e.y0) < 0.6 && mx >= Math.min(e.x0, e.x1) - 0.6 && mx <= Math.max(e.x0, e.x1) + 0.6 && Math.abs(A.y - B.y) < 0.6) return e;
    if (!horizontal && Math.abs(mx - e.x0) < 0.6 && my >= Math.min(e.y0, e.y1) - 0.6 && my <= Math.max(e.y0, e.y1) + 0.6 && Math.abs(A.x - B.x) < 0.6) return e;
  }
  return null;
}

/** A rail's view of a level: its outline's sides with the house's (and the step's) marked. */
function railLevelOf(id: "upper" | "lower", frame: DeckFrame, offsetX: number, offsetY: number, groundAt: (x: number, y: number) => number, stepDown: RailLevel["stepDown"], backIsStep: boolean): RailLevel {
  const ring = shapeOutline(frame.design.shape).map((p) => ({ x: p.x + offsetX, y: p.y + offsetY }));
  const edges = frame.edges.map((e) => ({ ...e, x0: e.x0 + offsetX, x1: e.x1 + offsetX, y0: e.y0 + offsetY, y1: e.y1 + offsetY }));
  const sides: RailLevel["sides"] = [];
  for (let i = 0; i < ring.length; i++) {
    const A = ring[i];
    const B = ring[(i + 1) % ring.length];
    if (Math.hypot(B.x - A.x, B.y - A.y) < 0.5) continue;
    const e = edgeFor(edges, A, B);
    const onBack = Math.abs(A.y - offsetY) < 0.5 && Math.abs(B.y - offsetY) < 0.5;
    // ONE STRAIGHT LINE, PART WALL AND PART OPEN (2026-11-14): a deck run straight past the house's corner has one back
    // line — the house behind most of it, nothing behind the rest. Read whole (by its middle) it was all "house", and
    // the open stretch past the corner got no rail. Where the frame's own edges along the line differ, it is cut there.
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    const ux = (B.x - A.x) / L;
    const uy = (B.y - A.y) / L;
    const lying = edges
      .filter((g) => Math.abs((g.x0 - A.x) * uy - (g.y0 - A.y) * ux) < 0.6 && Math.abs((g.x1 - A.x) * uy - (g.y1 - A.y) * ux) < 0.6)
      .map((g) => {
        const t0 = (g.x0 - A.x) * ux + (g.y0 - A.y) * uy;
        const t1 = (g.x1 - A.x) * ux + (g.y1 - A.y) * uy;
        return { t0: Math.max(0, Math.min(t0, t1)), t1: Math.min(L, Math.max(t0, t1)), house: g.house, side: g.side };
      })
      .filter((g) => g.t1 - g.t0 > 0.6)
      .sort((p, q) => p.t0 - q.t0);
    // (Only where those edges lie end to end along the whole line — never on an outline that doubles back on itself.)
    const endToEnd = lying.length > 1 && Math.abs(lying[0].t0) < 0.6 && Math.abs(lying[lying.length - 1].t1 - L) < 0.6 && lying.every((g, k) => k === 0 || Math.abs(g.t0 - lying[k - 1].t1) < 0.6);
    if (!backIsStep && endToEnd && lying.some((g) => g.house !== lying[0].house)) {
      let from = 0;
      for (let k = 0; k < lying.length; k++) {
        if (k + 1 < lying.length && lying[k + 1].house === lying[k].house) continue;
        const to = k + 1 < lying.length ? lying[k].t1 : L;
        sides.push({ x0: A.x + ux * from, y0: A.y + uy * from, x1: A.x + ux * to, y1: A.y + uy * to, house: lying[k].house, side: lying[k].side });
        from = to;
      }
      continue;
    }
    const side: RailLevel["sides"][number]["side"] = e ? e.side : onBack ? "back" : "front";
    const house = e ? e.house : onBack && backIsStep;
    sides.push({ x0: A.x, y0: A.y, x1: B.x, y1: B.y, house: house || (onBack && backIsStep), side });
  }
  const W = Math.max(...ring.map((p) => p.x));
  const D = Math.max(...ring.map((p) => p.y));
  const lowestGroundIn = Math.min(groundAt(offsetX, D), groundAt(W, D), groundAt((offsetX + W) / 2, D), groundAt(offsetX, offsetY), groundAt(W, offsetY));
  return { id, surfaceIn: frame.surfaceIn, joistBottomIn: frame.joistBottomIn, sides, lowestGroundIn, stepDown };
}

/**
 * Where stairs leave the main deck, along its sides (plan in.): the roof's posts keep clear of them (2026-10-12). The
 * contractor's flights from the main deck, and the steps the engine builds down to a lower level when none go there.
 * Box steps run the whole side, outside the posts, and are left out.
 */
export function stairOpenings(design: DeckDesign, W: number, riserMaxIn: number): StairOpening[] {
  const out: StairOpening[] = [];
  const add = (st: StairDesign) => {
    if (st.level !== "upper" || st.wrap) return;
    const half = (st.widthFt * 12) / 2;
    const at = st.atFt * 12;
    out.push({ side: st.side, fromIn: at - half, toIn: at + half });
  };
  for (const st of design.stairs) add(st);
  if (hasLowerLevel(design) && design.lower.place === "front" && design.lower.dropIn > riserMaxIn) {
    const lw = Math.round(design.lower.widthFt * 12);
    const offsetXIn = design.lower.align === "left" ? 0 : design.lower.align === "right" ? W - lw : Math.round((W - lw) / 2);
    const toLower = design.stairs.some((st) => st.level === "upper" && st.side === "front" && !st.wrap && st.atFt * 12 > offsetXIn && st.atFt * 12 < offsetXIn + lw);
    if (!toLower) add(betweenLevelsStair(design, offsetXIn));
  }
  return out;
}

/** The design, built. Never throws: what cannot be done is flagged on the parts. */
export function buildStructure(raw: DeckDesign, opts: StructureOptions = {}): DeckStructure {
  const design = normalizeDeckDesign(raw);
  const code = deckCodeFor(design.site.state);
  const species0 = framingSpecies(design.framing.species);
  const species = design.custom.species ? { ...species0, label: design.custom.species.name, short: design.custom.species.name } : species0;
  const withDeck = hasDeck(design);
  const zones = shapeZones(design.shape);
  const W = Math.max(...zones.map((z) => z.x1));
  const D = Math.max(...zones.map((z) => z.y1));
  // The ground: the site's fall across the main deck's rectangle, read anywhere in the plan.
  const groundAt = (x: number, y: number) => slopeGroundAt(design.site.slope, x, y, W, D);
  const gradePct = slopeGradePct(design.site.slope, W, D);
  const footingTopIn = design.footing.type === "pier-block" ? PIER_BLOCK.topIn : design.footing.aboveGradeIn;

  const deckUnder = withDeck ? { zones, footingTopIn } : null;
  // A roof is framed in sawn wood even over an OC deck: Owens Corning sells its lumber for deck and dock framing only,
  // so the roof takes the region's treated lumber (2026-11-12).
  const roofSpecies = species.group === "OC" ? framingSpecies(defaultFramingSpecies(design.site.state)) : species;
  const roofGroup = roofSpecies.group === "OC" ? "DF" : roofSpecies.group;
  const roof = hasRoof(design) ? buildRoofFrame(design, roofSpecies, roofGroup, deckUnder, { ...opts, groundAt, stairOpenings: withDeck ? stairOpenings(design, W, code.riserMaxIn) : [] }) : null;
  // A DOUBLE DECK (2026-11-13 — the owner: "a double deck, like first floor and second floor"): the main deck's posts
  // and footings hold both decks, so they are sized for two.
  const doubled = isDoubleDeck(design);
  const deckOpts = { ...opts, groundAt, extraPosts: roof ? roofPostsForDeck(roof) : undefined, extraPostsGroup: roofGroup, ...(doubled ? { carries: 2 } : {}) };
  let frame = withDeck ? buildDeckFrame(design, deckOpts) : null;

  // The lower level: a detached deck of its own, a step down, touching the main deck's front.
  let lower: LowerBuild | null = null;
  if (frame && doubled) {
    // …or the lower floor of a double deck: the same outline at its own height, hanging on the house as the main deck
    // does, its joists on the main deck's own beam lines and its beams let into the main deck's posts where they pass —
    // no posts or footings of its own. Its joists and beams are read from the tables for the spans those lines make.
    const lowerDesign = normalizeDeckDesign({
      ...design,
      heightIn: design.lower.heightIn,
      structure: "deck",
      floor: "deck",
      lower: { ...design.lower, on: false },
      stairs: [],
      photo: null,
      spa: { ...design.spa, on: false },
      framing: { ...design.framing, bracesOff: [], pins: [], beamLines: [], backOverhangFt: "auto", postSpacingFt: "auto" },
    });
    const lowerOpts = { ...opts, groundAt };
    let lowerFrame = buildDeckFrame(lowerDesign, { ...lowerOpts, follow: frame });
    // Too near the ground for a beam under its joists: both decks take flush beams — the posts are the same posts.
    const front = design.shape.kind === "rect" ? design.shape.front : undefined;
    if (lowerFrame.flags.droppedDoesNotFit && frame.beamStyle === "dropped" && design.framing.beamStyle === "auto" && (!front || front.kind === "straight")) {
      frame = buildDeckFrame({ ...design, framing: { ...design.framing, beamStyle: "flush" } }, deckOpts);
      lowerFrame = buildDeckFrame(lowerDesign, { ...lowerOpts, follow: frame });
    }
    lower = { design: lowerDesign, frame: lowerFrame, surface: deckSurface(lowerFrame), offsetXIn: 0, offsetYIn: 0, dropIn: design.heightIn - design.lower.heightIn, place: "under" };
  } else if (frame && hasLowerLevel(design)) {
    const lw = Math.round(design.lower.widthFt * 12);
    const offsetXIn = design.lower.align === "left" ? 0 : design.lower.align === "right" ? W - lw : Math.round((W - lw) / 2);
    const offsetYIn = D;
    // (Its own rectangle, whatever the main deck does at the house: a deck run past the house's corner handed its
    // lower level the same reach past that corner — read back as a wing of its own, built back UNDER the main deck and
    // counted in the price. 2026-11-14: the lower level is told of no corner.)
    const pastCorner = design.house.leftFt < 0 || design.house.rightFt < 0;
    const lowerDesign = normalizeDeckDesign({
      ...design,
      ...(pastCorner ? { house: { ...design.house, leftFt: Math.max(0, design.house.leftFt), rightFt: Math.max(0, design.house.rightFt), wrapLeftFt: undefined, wrapRightFt: undefined } } : {}),
      shape: { kind: "rect", widthFt: design.lower.widthFt, depthFt: design.lower.depthFt },
      placement: "detached",
      heightIn: design.heightIn - design.lower.dropIn,
      structure: "deck",
      floor: "deck",
      lower: { ...design.lower, on: false },
      stairs: [],
      photo: null,
      // Its own beams are read from its own size; the posts and footings follow the main deck's choices.
      // Braces taken out by hand on the lower level are named "L:…" in the one list (lib/deck/parts).
      framing: { ...design.framing, joist: "auto", beam: "auto", beamStyle: "auto", overhangFt: "auto", bracesOff: design.framing.bracesOff.filter((k) => k.startsWith(LOWER_KEY)).map((k) => k.slice(LOWER_KEY.length)), pins: [], beamLines: [], backOverhangFt: "auto" },
    });
    const lowerFrame = buildDeckFrame(lowerDesign, { ...opts, groundAt: (x, y) => groundAt(x + offsetXIn, y + offsetYIn) });
    lower = { design: lowerDesign, frame: lowerFrame, surface: deckSurface(lowerFrame), offsetXIn, offsetYIn, dropIn: design.lower.dropIn, place: "front" };
  }
  const surface = frame ? deckSurface(frame) : null;

  // The stairs.
  const stairs: StairBuild[] = [];
  /** Where each flight leaves its deck (the skirt under that deck is left open there). */
  const stairTops: Array<{ level: "upper" | "lower"; x0: number; y0: number; x1: number; y1: number }> = [];
  if (frame && surface) {
    // (Steps that wrap the deck follow its own outline wherever it is not a plain rectangle — 2026-11-14.)
    const plain = design.shape.kind === "rect" && (!design.shape.front || design.shape.front.kind === "straight");
    const upper: StairLevel = { id: "upper", surfaceIn: frame.surfaceIn, joistBottomIn: frame.joistBottomIn, x0: 0, y0: 0, widthIn: W, depthIn: D, frontAt: (x) => frontEdgeAt(design.shape, x), sides: railLevelOf("upper", frame, 0, 0, groundAt, null, false).sides, plain };
    const lowerLevel: StairLevel | null = lower ? { id: "lower", surfaceIn: lower.frame.surfaceIn, joistBottomIn: lower.frame.joistBottomIn, x0: lower.offsetXIn, y0: lower.offsetYIn, widthIn: Math.round(design.lower.widthFt * 12), depthIn: Math.round(design.lower.depthFt * 12), frontAt: lower.place === "under" ? (x) => frontEdgeAt(design.shape, x) : () => Math.round(design.lower.depthFt * 12) } : null;
    const build = (st: StairDesign, level: StairLevel) =>
      buildStair({ design, stair: st, level, lowerLevel: level.id === "upper" ? lowerLevel : null, product: frame.decking, rail: design.rail, groundAt, riserMaxIn: code.riserMaxIn, postSize: design.framing.post === "8x8" ? "6x6" : design.framing.post === "4x6" ? "4x4" : design.framing.post });
    const put = (st: StairDesign, level: StairLevel) => {
      const built = build(st, level);
      stairs.push(built);
      if (built.kind === "flight") stairTops.push({ level: level.id, ...stairTopEdge(st, level) });
      return built;
    };
    for (const st of design.stairs) put(st, st.level === "lower" && lowerLevel ? lowerLevel : upper);
    // THE STEPS BETWEEN THE LEVELS (owner, 2026-10-11: "the double deck, one deck lower than the other — the missing
    // steps"). A lower level more than one riser down cannot be reached without a stair; when the design has none from
    // the main deck to it, the engine builds one — centred on the lower level, the warning's own fix — so the 3D, the
    // framing plan, the takeoff, the price and the permit set all carry it. A stair the contractor puts there replaces it.
    if (lower && lower.place === "front" && lowerLevel && lower.dropIn > code.riserMaxIn && !stairs.some((b) => b.level === "upper" && b.lands === "lower-deck")) {
      const between = build(betweenLevelsStair(design, lower.offsetXIn), upper);
      if (between.lands === "lower-deck") stairs.push(between);
      // (Its top stands where the lower level meets the deck: no skirt there either way.)
    }
  }

  // The step between the levels.
  let stepDown: DeckStructure["stepDown"] = null;
  if (lower && lower.place === "front") {
    const lengthIn = Math.round(design.lower.widthFt * 12);
    const stairBetween = stairs.some((s) => s.level === "upper" && s.lands === "lower-deck");
    stepDown = { lengthIn, dropIn: lower.dropIn, stairWanted: lower.dropIn > code.riserMaxIn && !stairBetween };
  }

  // The rails.
  const levels: RailLevel[] = [];
  if (frame) levels.push(railLevelOf("upper", frame, 0, 0, groundAt, lower && lower.place === "front" ? { x0: lower.offsetXIn, x1: lower.offsetXIn + Math.round(design.lower.widthFt * 12), dropIn: lower.dropIn } : null, false));
  // (A lower level in front meets the main deck along its back; a double deck's lower floor has the house there, or its own open edge.)
  if (lower) levels.push(railLevelOf("lower", lower.frame, lower.offsetXIn, lower.offsetYIn, groundAt, null, lower.place === "front"));
  // The roof's posts that stand on the deck (2026-11-13): where one stands on a top-mounted rail's line, the rail runs to it and sets no post of its own.
  const rails = buildRails({ design, rail: design.rail, levels, stairs, roofPosts: roof && design.floor === "deck" ? roof.posts.map((p) => ({ x: p.x, y: p.y, halfIn: (POST_ACTUAL_IN[p.size]?.[0] ?? 5.5) / 2 })) : [] });

  // SKIRTING (2026-11-14; lib/deck/skirt): under the open edges of the deck nearest the ground — the lower floor of a
  // double deck when there is one — and round a lower level in front. (Its top: under the deepest thing at the edge, the
  // joists or a flush beam.) Left open where a stair leaves, where wide steps run, where the lower level meets the deck.
  let skirt: SkirtBuild | null = null;
  if (frame && design.extras.skirt) {
    const under = (f: DeckFrame) => Math.min(f.joistBottomIn, ...f.beams.filter((b) => b.style === "flush").map((b) => b.bottomIn));
    const postsOf = (f: DeckFrame, ox: number, oy: number) => f.posts.map((p) => ({ x: p.x + ox, y: p.y + oy, halfIn: Math.max(...(POST_ACTUAL_IN[p.size] ?? [5.5, 5.5])) / 2, pierHalfIn: p.footing.pierIn / 2, pierTopIn: p.footing.topIn + p.footing.groundIn }));
    const wrapped = stairs.flatMap((st) => st.wrapped ?? []);
    const doubledUnder = lower && lower.place === "under" ? lower : null;
    const inFront = lower && lower.place === "front" ? lower : null;
    // (Every post of both levels: one of the main deck's can stand where the lower level's skirt starts, and the other way.)
    const posts = [...postsOf(frame, 0, 0), ...(inFront ? postsOf(inFront.frame, inFront.offsetXIn, inFront.offsetYIn) : [])];
    const skirtLevels: SkirtLevelInput[] = [
      {
        id: "upper",
        sides: levels[0].sides,
        wrapped,
        // (A double deck: the stairs of both floors leave by this outline.)
        openings: [...stairTops.filter((t) => t.level === "upper" || doubledUnder), ...(inFront ? [{ x0: inFront.offsetXIn, y0: inFront.offsetYIn, x1: inFront.offsetXIn + Math.round(design.lower.widthFt * 12), y1: inFront.offsetYIn }] : [])],
        posts,
        topIn: under(doubledUnder ? doubledUnder.frame : frame),
      },
    ];
    if (inFront && levels[1]) skirtLevels.push({ id: "lower", sides: levels[1].sides, wrapped, openings: stairTops.filter((t) => t.level === "lower"), posts, topIn: under(inFront.frame) });
    skirt = buildSkirt({ kind: design.extras.skirt, levels: skirtLevels, groundAt });
  }

  // The electrical: fixtures where the contractor put them or where they usually go, and the wiring to them.
  const ringW = roof && !frame ? roof.widthIn : W;
  const ringD = roof && !frame ? roof.depthIn : D;
  const electrical = buildElectrical({ design, frame, roof, stairs, rails, widthIn: ringW, depthIn: ringD, onHouse: frame ? design.placement !== "detached" : roof?.attach === "wall", floorIn: frame ? frame.surfaceIn : roof ? roof.floorIn : 0 });

  return { design, frame, surface, roof, lower, stairs, rails, skirt, electrical, groundAt, gradePct, stepDown, code };
}

/** The structure's deck levels, main first, each with where it sits. */
export function structureLevels(s: DeckStructure): Array<{ id: "upper" | "lower"; frame: DeckFrame; surface: DeckSurface; offsetXIn: number; offsetYIn: number }> {
  const out: Array<{ id: "upper" | "lower"; frame: DeckFrame; surface: DeckSurface; offsetXIn: number; offsetYIn: number }> = [];
  if (s.frame && s.surface) out.push({ id: "upper", frame: s.frame, surface: s.surface, offsetXIn: 0, offsetYIn: 0 });
  if (s.lower) out.push({ id: "lower", frame: s.lower.frame, surface: s.lower.surface, offsetXIn: s.lower.offsetXIn, offsetYIn: s.lower.offsetYIn });
  return out;
}
