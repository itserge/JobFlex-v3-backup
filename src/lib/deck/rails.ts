// THE RAILING, BUILT (Deck Studio M3, 2026-10-10) — pure.
//
// Owner: "handrails — cedar, other woods, vinyl, metal, custom." The rail in
// the design (design.ts RailDesign) names a system, a height, an infill and a
// post spacing; this lays it along every open edge of every level — never
// along the house, never across a stair's opening, not along the step down
// to a lower level — and counts what the crew builds:
//
//   · WOOD systems (treated, cedar) piece by piece: 4x4 posts bolted through
//     the rim with tension ties, 2x4 top and bottom rails, 2x2 balusters at
//     5 in. on centre (a 4-in. gap, R312.1.3), a flat 2x6 drink cap.
//   · KIT systems (composite, vinyl, aluminum, cable, glass) by the foot on
//     the shop's rate for that system, with their posts counted and their
//     infill drawn — pickets, ten cable runs, a glass or solid panel a bay.
//
// A guard is REQUIRED where the walking surface is more than 30 in. up
// (R312.1.1), 36 in. high at least; the studio's checks say where one is
// missing. Where it is not required the contractor may still choose one.
// Posts no more than 6 ft apart carry the code's 200-lb load with a 4x4
// (8 ft is a kit maker's own figure).
//
// HOW THE POSTS MEET THE DECK (2026-11-13; design.ts RailMount). Every post was hung on the outside of the rim, whatever
// the system, while the stairs' posts stood on the edge and the notes described a base plate: a deck builder saw "some
// sections side-mounted, others top-mounted". The mount is now the builder's, for the deck and for any one side of it:
//   · TOP — the post stands on the boards, its centre TOP_MOUNT_IN inside the edge, from the surface up; two runs that
//     turn a corner share the post where their lines cross. Blocking goes under every post.
//   · SIDE — the post hangs on the rim's outside face, from just above the joists' underside up (as all were drawn).
// The rails, the infill, the hardware counted and the words on the drawings follow each section's mount.

import { GUARD_REQUIRED_ABOVE_IN } from "./codeTables";
import { RAIL_METAL_BLACK, RAIL_STAINLESS, deckingProduct, railColorOf, railType, type RailColor, type RailTypeId } from "./catalog";
import { RAIL_SECTION_KEYS, RAIL_SECTION_LABEL, railMountFor, railMountOf, railPostKind, type DeckDesign, type RailDesign, type RailInfill, type RailMount, type RailPostKind } from "./design";
import type { StairBuild } from "./stairs";
import { BALUSTER_SPACING_IN } from "./stairs";

/** Ten cable runs at 3 in. fill a 36-in. rail; fourteen fill a 42. */
export const CABLE_SPACING_IN = 3;
export const RAIL_TOP_NOMINAL = "2x4";
export const RAIL_POST_NOMINAL = "4x4";
export const RAIL_CAP_NOMINAL = "2x6";
export const BALUSTER_NOMINAL = "2x2";
/** A rail post reaches from its top down past the joists, bolted through the rim. */
export const POST_EMBED_IN = 2;
/** A side-mounted post's centre outside the deck's edge, and a top-mounted one's inside it (its base plate, 5 in. square, a quarter inch in from the boards' edge). */
export const SIDE_MOUNT_IN = 2.25;
export const TOP_MOUNT_IN = 2.75;
/** A top-mounted post's base plate, and the blocking under it: two pieces of joist stock between the joists, each side of the post. */
export const BASE_PLATE_IN = 5;
/** The plate's thickness: a top-mounted post is drawn standing on it (its own foot is not in the boards' plane). */
export const BASE_PLATE_THICK_IN = 0.6;
export const TOP_MOUNT_BLOCKS = 2;
/** A metal baluster — round black aluminum in a wood or composite rail, an aluminum system's own picket: ¾ in., about 4½ in. on centre (15 to a 6-ft section). */
export const METAL_BALUSTER_IN = 0.75;
export const METAL_BALUSTER_SPACING_IN = 4.5;
export const METAL_BALUSTER_NOMINAL = "¾-in. aluminum baluster";
/** Welded wire mesh ("hog wire"): 6-gauge wire, 4 x 4 in. openings, one panel a bay in a groove of the rails. */
export const MESH_GRID_IN = 4;
export const MESH_WIRE_IN = 0.2;

export type RailRole = "rail-post" | "rail-top" | "rail-bottom" | "rail-cap" | "baluster" | "cable" | "rail-panel" | "mesh";

export interface RailMember {
  role: RailRole;
  /** A post: how it meets the deck. */
  mount?: RailMount;
  nominal: string;
  lengthIn: number;
  cx: number;
  cy: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  tilt: number;
  of: string;
}

/** A flat panel of glass or solid infill: [x, y, z, …] ring, inches. */
export interface RailPanel {
  kind: "glass" | "solid";
  ring: number[];
  of: string;
}

export interface RailSegment {
  level: "upper" | "lower";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  lengthIn: number;
  posts: number;
  /** The section it belongs to (a level and a side) and how its posts meet the deck. */
  key: string;
  mount: RailMount;
}

/** What a rail needs to know about a level: its surface, its joists and its outline with the house's sides marked. */
export interface RailLevel {
  id: "upper" | "lower";
  surfaceIn: number;
  joistBottomIn: number;
  /** The level's outline in plan, inches, as rings of sides; `house` sides take no rail. */
  sides: Array<{ x0: number; y0: number; x1: number; y1: number; house: boolean; side: "front" | "back" | "left" | "right" }>;
  /** The ground under its front edge's lowest point, inches (for the guard rule). */
  lowestGroundIn: number;
  /** A stretch of the front edge that steps down onto the lower level — no rail there when the step is low. */
  stepDown: { x0: number; x1: number; dropIn: number } | null;
}

export interface RailBuild {
  on: boolean;
  /** A guard is required somewhere on the deck. */
  required: boolean;
  type: RailTypeId;
  label: string;
  heightIn: number;
  infill: RailInfill;
  system: "wood" | "kit" | "custom";
  segments: RailSegment[];
  /** Feet along the levels, on the stairs, and in all. */
  lf: number;
  stairLf: number;
  totalLf: number;
  posts: number;
  stairPosts: number;
  /** Pieces for the material list. */
  topRailLf: number;
  bottomRailLf: number;
  capLf: number;
  balusters: number;
  cableLf: number;
  panels: number;
  litCaps: number;
  riserLights: number;
  members: RailMember[];
  panelsOut: RailPanel[];
  /** Tension ties (posts bolted to the rim), decorative caps, rail brackets; and by the mount (2026-11-13): pieces of blocking under top-mounted posts, rated post bases under top-mounted wood posts, fascia brackets for side-mounted metal posts. */
  hardware: { postTies: number; postCaps: number; railBrackets: number; blocks: number; postBases: number; fasciaBrackets: number };
  /** What the posts are, the mount of the deck as a whole, each section's own, and the posts by mount. */
  postKind: RailPostKind;
  mount: RailMount;
  mounts: Record<string, RailMount>;
  topPosts: number;
  sidePosts: number;
  /** Places where a covered deck's roof post is the rail's post: the rail runs to it, on rail brackets. */
  onRoofPosts: number;
  /** The system's colour (2026-11-09): the one picked or its usual one; null for a wood rail (it is the wood). */
  color: RailColor | null;
  /** The balusters as built: the rail's own square ones, or thin metal ones (round black in wood, composite and vinyl; an aluminum system's own pickets). */
  baluster: "square" | "metal";
  /** Wire mesh panels, one a bay. */
  meshPanels: number;
  /** The infill's own colour where it is not the rail's: stainless cable, black metal balusters or mesh in a rail of another colour (null: the rail's). */
  infillColor: string | null;
  /** Feet of kit rail capped with a deck board — a drink rail (2026-11-10); 0 for none. A wood rail's 2x6 cap is `capLf`. */
  drinkLf: number;
}

const plural = (n: number, w: string) => `${n} ${n === 1 ? w : `${w}s`}`;

/** The infill a system comes with when the design says "auto". */
export function infillFor(type: RailTypeId, asked: RailInfill | "auto"): RailInfill {
  if (asked !== "auto") return asked;
  if (type === "cable") return "cable";
  if (type === "glass") return "glass";
  return "balusters";
}

/** True when the design asks for a rail or the height requires one. */
export function railRequired(levels: readonly RailLevel[]): boolean {
  return levels.some((l) => l.surfaceIn - l.lowestGroundIn > GUARD_REQUIRED_ABOVE_IN);
}

export interface RailInput {
  design: DeckDesign;
  rail: RailDesign;
  levels: RailLevel[];
  stairs: StairBuild[];
  /** A covered deck's roof posts, in plan, with half their width: a top-mounted rail that comes to one runs into it — the roof's post is the rail's post there. */
  roofPosts?: ReadonlyArray<{ x: number; y: number; halfIn: number }>;
}

export function buildRails(input: RailInput): RailBuild {
  const { rail, stairs, levels } = input;
  const roofPosts = input.roofPosts ?? [];
  const type = railType(rail.type);
  const required = railRequired(levels);
  const members: RailMember[] = [];
  const panelsOut: RailPanel[] = [];
  const segments: RailSegment[] = [];
  const infill = infillFor(rail.type, rail.infill);
  const system: RailBuild["system"] = rail.type === "treated" || rail.type === "cedar" ? "wood" : rail.type === "custom" ? "custom" : "kit";
  const H = rail.heightIn;
  const spacing = rail.postSpacingFt * 12;
  const hardware = { postTies: 0, postCaps: 0, railBrackets: 0, blocks: 0, postBases: 0, fasciaBrackets: 0 };
  const postKind = railPostKind(rail.type);
  const mountAll = railMountFor(rail.type, rail.mount);
  const mounts: Record<string, RailMount> = {};
  let topPosts = 0;
  let sidePosts = 0;
  /** Places where a roof post stands in for a rail post. */
  let onRoofPosts = 0;
  const color = railColorOf(rail.type, rail.color);
  // Thin metal balusters: asked for in a wood, composite or vinyl rail; what an aluminum system has anyway.
  const metalBalusters = rail.type === "aluminum" || (rail.baluster === "round" && (system === "wood" || rail.type === "composite" || rail.type === "vinyl" || rail.type === "custom"));
  const balusterKind: RailBuild["baluster"] = metalBalusters ? "metal" : "square";
  const infillColor = infill === "cable" ? RAIL_STAINLESS : infill === "mesh" || (infill === "balusters" && metalBalusters && rail.type !== "aluminum") ? RAIL_METAL_BLACK : null;
  // A DRINK RAIL ON A KIT SYSTEM (2026-11-10): a deck board laid flat over the top rail and the post tops, in the
  // deck's own board. Level runs only (the stairs keep their graspable rail), and never over glass.
  const drink = rail.drink && system !== "wood" && rail.type !== "glass";
  const capBoard = deckingProduct(input.design.decking.product);
  let meshPanels = 0;
  let posts = 0;
  let lf = 0;
  let balusters = 0;
  let cableLf = 0;
  let panels = 0;
  const empty: RailBuild = { on: false, required, type: rail.type, label: type.label, heightIn: H, infill, system, segments: [], lf: 0, stairLf: 0, totalLf: 0, posts: 0, stairPosts: 0, topRailLf: 0, bottomRailLf: 0, capLf: 0, balusters: 0, cableLf: 0, panels: 0, litCaps: 0, riserLights: 0, members: [], panelsOut: [], hardware, color: null, baluster: "square", meshPanels: 0, infillColor: null, drinkLf: 0, postKind, mount: mountAll, mounts, topPosts: 0, sidePosts: 0, onRoofPosts: 0 };
  if (rail.type === "none") return empty;

  /** Posts the other level set: two levels meeting at a corner would set two posts in one place (2026-10-11). */
  const otherLevelPosts: Array<[number, number]> = [];
  for (const level of levels) {
    if (level.id === "lower" && !rail.lowerLevel && level.surfaceIn - level.lowestGroundIn <= GUARD_REQUIRED_ABOVE_IN) continue;
    const postTop = level.surfaceIn + H;
    const stairsHere = stairs.filter((s) => s.level === level.id && s.kind === "flight");
    const wraps = stairs.filter((s) => s.level === level.id && s.kind === "box");
    /** Posts already set on this level: a corner post serves both sides that meet there (posts mounted the same way). */
    const postsSet: Array<[number, number, RailMount]> = [];
    const fromOtherLevels = otherLevelPosts.slice();
    type Side = RailLevel["sides"][number];
    const lengthOf = (sd: Side) => Math.hypot(sd.x1 - sd.x0, sd.y1 - sd.y0);
    // Box steps wrap a side: no rail there (the deck is low by definition).
    const railed = (sd: Side) => !sd.house && lengthOf(sd) >= 12 && !wraps.some((w) => w.design.wrapSides === 4 || (w.design.wrapSides === 3 && sd.side !== "back") || (w.design.wrapSides === 1 && sd.side === "front"));
    const keyOf = (sd: Side) => `${level.id}-${sd.side}`;
    /**
     * Where a TOP-MOUNTED run's line meets its neighbour's at a corner, inches along this side from the corner (2026-11-13):
     * both lines stand TOP_MOUNT_IN inside their edges, so they cross that far in from a square outside corner and that
     * far past an inside one — one post there serves both runs. Null where the neighbour takes no top-mounted rail.
     */
    const cornerShift = (a: Side, b: Side): number | null => {
      if (!railed(a) || !railed(b) || railMountOf(rail, keyOf(a)) !== "top" || railMountOf(rail, keyOf(b)) !== "top") return null;
      if (Math.hypot(a.x1 - b.x0, a.y1 - b.y0) > 0.6) return null;
      const la = lengthOf(a);
      const lb = lengthOf(b);
      const turn = Math.atan2(((a.x1 - a.x0) * (b.y1 - b.y0) - (a.y1 - a.y0) * (b.x1 - b.x0)) / (la * lb), ((a.x1 - a.x0) * (b.x1 - b.x0) + (a.y1 - a.y0) * (b.y1 - b.y0)) / (la * lb));
      if (Math.abs(turn) > 2.6) return null;
      return TOP_MOUNT_IN * Math.tan(turn / 2);
    };
    for (let si = 0; si < level.sides.length; si++) {
      const side = level.sides[si];
      if (!railed(side)) continue;
      const L = lengthOf(side);
      const ux = (side.x1 - side.x0) / L;
      const uy = (side.y1 - side.y0) / L;
      const key = keyOf(side);
      const mount = railMountOf(rail, key);
      mounts[key] = mount;
      const top = mount === "top";
      // The line the posts, rails and infill stand on, from the deck's edge along the normal into the deck: a top-mounted
      // rail inside the edge, on the boards; a side-mounted one outside it, on the rim's face.
      const o = top ? TOP_MOUNT_IN : -SIDE_MOUNT_IN;
      const postBottom = top ? level.surfaceIn : level.joistBottomIn + POST_EMBED_IN;
      const postLen = postTop - postBottom;
      const startShift = top ? cornerShift(level.sides[(si - 1 + level.sides.length) % level.sides.length], side) : null;
      const endShift = top ? cornerShift(side, level.sides[(si + 1) % level.sides.length]) : null;
      // Openings along this side: the stairs that leave it, and the step down to the lower level.
      const openings: Array<[number, number]> = [];
      for (const st of stairsHere) {
        if (st.design.side !== side.side || st.footprint.length < 2) continue;
        // The stair's top edge projected onto this side.
        const [p0, p1] = [st.footprint[0], st.footprint[1]];
        const t0 = (p0.x - side.x0) * ux + (p0.y - side.y0) * uy;
        const t1 = (p1.x - side.x0) * ux + (p1.y - side.y0) * uy;
        const lo = Math.min(t0, t1);
        const hi = Math.max(t0, t1);
        if (hi > 0 && lo < L) openings.push([Math.max(0, lo), Math.min(L, hi)]);
      }
      if (level.stepDown && side.side === "front" && level.stepDown.dropIn <= GUARD_REQUIRED_ABOVE_IN) {
        const t0 = (level.stepDown.x0 - side.x0) * ux;
        const t1 = (level.stepDown.x1 - side.x0) * ux;
        openings.push([Math.max(0, Math.min(t0, t1)), Math.min(L, Math.max(t0, t1))]);
      }
      openings.sort((a, b) => a[0] - b[0]);
      // The runs left between the openings.
      const runs: Array<[number, number]> = [];
      let at = 0;
      for (const [a, b] of openings) {
        if (a - at >= 12) runs.push([at, a]);
        at = Math.max(at, b);
      }
      if (L - at >= 12) runs.push([at, L]);
      for (const [a, b] of runs) {
        const len = b - a;
        const n = Math.max(2, Math.ceil(len / spacing - 1e-9) + 1);
        const yaw = Math.atan2(uy, ux);
        const seg: RailSegment = { level: level.id, x0: side.x0 + ux * a, y0: side.y0 + uy * a, x1: side.x0 + ux * b, y1: side.y0 + uy * b, lengthIn: Math.round(len), posts: n, key, mount };
        segments.push(seg);
        lf += len / 12;
        // Posts: set in half a post from the run's ends; a corner post already there is shared. A top-mounted run that
        // turns a corner with another ends ON the corner's post (where the two lines cross), and its rails run to it.
        const inset = 1.75 + 0.5;
        const nx = -uy;
        const ny = ux;
        const sharedStart = startShift !== null && a < 0.5;
        const sharedEnd = endShift !== null && b > L - 0.5;
        // The first and last posts' places along the side, and the rails' ends: at the run's end — or, where the run
        // turns a corner onto a shared post, at that post's face (the two runs' rails do not lie through each other).
        const ts = sharedStart ? a + (startShift as number) : a + inset;
        const te = sharedEnd ? b - (endShift as number) : b - inset;
        const rs = sharedStart ? ts + 1.75 : a;
        const re = sharedEnd ? te - 1.75 : b;
        const g = re - rs;
        for (let k = 0; k < n; k++) {
          let t = ts + ((te - ts) * k) / (n - 1);
          let cx = side.x0 + ux * t + nx * o;
          let cy = side.y0 + uy * t + ny * o;
          // The other level already set a post right here: this one stands 4 in. along its own run (drawn in one place,
          // the two posts flickered).
          if (fromOtherLevels.some(([px, py]) => Math.hypot(px - cx, py - cy) < 4)) {
            t += k === n - 1 ? -4 : 4;
            cx = side.x0 + ux * t + nx * o;
            cy = side.y0 + uy * t + ny * o;
          }
          if (postsSet.some(([px, py, pm]) => pm === mount && Math.hypot(px - cx, py - cy) < 8)) continue;
          // A roof post stands right here, on the boards (a covered deck's corner, a post along the eave): the rail runs
          // to it and it is the rail's post — no second post is set inside it.
          if (top && roofPosts.some((rp) => Math.abs(rp.x - cx) < rp.halfIn + 1.75 + 0.5 && Math.abs(rp.y - cy) < rp.halfIn + 1.75 + 0.5)) {
            postsSet.push([cx, cy, mount]);
            onRoofPosts += 1;
            continue;
          }
          postsSet.push([cx, cy, mount]);
          otherLevelPosts.push([cx, cy]);
          posts += 1;
          // Drawn a quarter inch proud of the top rail where no cap covers them (flush, the post's top and the rail's lay
          // in one plane and flickered, 2026-10-11); the length bought is the post's.
          const proud = (rail.cap && system === "wood") || drink ? 0 : 0.25;
          // A top-mounted post is drawn from the top of its base plate (its foot would lie in the plate's own plane); the length bought is the post's.
          const foot = top ? postBottom + BASE_PLATE_THICK_IN : postBottom;
          members.push({ role: "rail-post", nominal: system === "wood" ? RAIL_POST_NOMINAL : "post", lengthIn: postLen, cx, cy, cz: foot + (postTop + proud - foot) / 2, sx: 3.5, sy: 3.5, sz: postTop + proud - foot, yaw: 0, tilt: 0, of: key, mount });
          // What holds it (2026-11-13): on the boards, blocking under it (and a rated base under a wood post); on the rim,
          // a wood post's tension ties or a metal post's fascia bracket.
          if (top) {
            topPosts += 1;
            hardware.blocks += TOP_MOUNT_BLOCKS;
            if (postKind === "wood") hardware.postBases += 1;
          } else {
            sidePosts += 1;
            if (postKind === "metal") hardware.fasciaBrackets += 1;
            else hardware.postTies += 1;
          }
          hardware.postCaps += 1;
        }
        const len0 = len;
        const mx = side.x0 + ux * ((rs + re) / 2) + nx * o;
        const my = side.y0 + uy * ((rs + re) / 2) + ny * o;
        // Top rail under the cap, bottom rail 3 1/2 in. up (a 4-in. gap at the floor).
        members.push({ role: "rail-top", nominal: RAIL_TOP_NOMINAL, lengthIn: len0, cx: mx, cy: my, cz: postTop - (rail.cap && system === "wood" ? 1.5 : 0) - 1.75, sx: g, sy: 1.5, sz: 3.5, yaw, tilt: 0, of: key });
        members.push({ role: "rail-bottom", nominal: RAIL_TOP_NOMINAL, lengthIn: len0, cx: mx, cy: my, cz: level.surfaceIn + 3.5 + 1.75, sx: g, sy: 1.5, sz: 3.5, yaw, tilt: 0, of: key });
        if (rail.cap && system === "wood") members.push({ role: "rail-cap", nominal: RAIL_CAP_NOMINAL, lengthIn: len0 + 3.5, cx: mx, cy: my, cz: postTop + 0.75, sx: g + 3.5, sy: 5.5, sz: 1.5, yaw, tilt: 0, of: key });
        if (drink) members.push({ role: "rail-cap", nominal: "deck board", lengthIn: len0 + 3.5, cx: mx, cy: my, cz: postTop + capBoard.thickIn / 2, sx: g + 3.5, sy: capBoard.widthIn, sz: capBoard.thickIn, yaw, tilt: 0, of: key });
        hardware.railBrackets += 4 * (n - 1);
        const capIn = rail.cap && system === "wood" ? 1.5 : 0;
        const infillH = H - 3.5 - 3.5 - capIn - 3.5;
        const zMid = level.surfaceIn + 3.5 + 3.5 + infillH / 2;
        if (infill === "balusters") {
          const count = Math.max(0, Math.floor(len / (metalBalusters ? METAL_BALUSTER_SPACING_IN : BALUSTER_SPACING_IN)) - (n - 1));
          balusters += count;
          const step = g / (count + 1);
          const w = metalBalusters ? METAL_BALUSTER_IN : 1.5;
          for (let k = 1; k <= count; k++) {
            const t = rs + step * k;
            members.push({ role: "baluster", nominal: metalBalusters ? METAL_BALUSTER_NOMINAL : BALUSTER_NOMINAL, lengthIn: infillH, cx: side.x0 + ux * t + nx * o, cy: side.y0 + uy * t + ny * o, cz: zMid, sx: w, sy: w, sz: infillH, yaw: 0, tilt: 0, of: key });
          }
        } else if (infill === "mesh") {
          // One welded panel a bay, its wires drawn: uprights and levels 4 in. apart, the panel's edges in the rails' grooves.
          const bays = n - 1;
          meshPanels += bays;
          const z0 = level.surfaceIn + 3.5 + 3.5;
          for (let k = 0; k < bays; k++) {
            const t0 = ts + ((te - ts) * k) / bays + 1.75;
            const t1 = ts + ((te - ts) * (k + 1)) / bays - 1.75;
            const bay = t1 - t0;
            if (bay < 8) continue;
            const ups = Math.max(1, Math.round(bay / MESH_GRID_IN) - 1);
            for (let i = 1; i <= ups; i++) {
              const t = t0 + (bay * i) / (ups + 1);
              members.push({ role: "mesh", nominal: "welded wire", lengthIn: infillH, cx: side.x0 + ux * t + nx * o, cy: side.y0 + uy * t + ny * o, cz: z0 + infillH / 2, sx: MESH_WIRE_IN, sy: MESH_WIRE_IN, sz: infillH, yaw: 0, tilt: 0, of: key });
            }
            const rows = Math.max(1, Math.round(infillH / MESH_GRID_IN) - 1);
            const tm = (t0 + t1) / 2;
            for (let i = 1; i <= rows; i++) members.push({ role: "mesh", nominal: "welded wire", lengthIn: bay, cx: side.x0 + ux * tm + nx * o, cy: side.y0 + uy * tm + ny * o, cz: z0 + (infillH * i) / (rows + 1), sx: bay, sy: MESH_WIRE_IN, sz: MESH_WIRE_IN, yaw, tilt: 0, of: key });
          }
        } else if (infill === "horizontal") {
          const rows = Math.floor(infillH / 5.5);
          balusters += 0;
          for (let k = 1; k <= rows; k++) members.push({ role: "rail-top", nominal: RAIL_TOP_NOMINAL, lengthIn: len, cx: mx, cy: my, cz: level.surfaceIn + 3.5 + 3.5 + (infillH * k) / (rows + 1), sx: g, sy: 1.5, sz: 3.5, yaw, tilt: 0, of: key });
        } else if (infill === "cable") {
          const runs = Math.max(8, Math.floor(infillH / CABLE_SPACING_IN));
          cableLf += (runs * len) / 12;
          for (let k = 1; k <= runs; k++) members.push({ role: "cable", nominal: "cable", lengthIn: len, cx: mx, cy: my, cz: level.surfaceIn + 3.5 + 3.5 + (infillH * k) / (runs + 1), sx: g, sy: 0.3, sz: 0.3, yaw, tilt: 0, of: key });
        } else {
          // One panel a bay.
          const bays = n - 1;
          panels += bays;
          const z0 = level.surfaceIn + 3.5 + 3.5;
          const z1 = z0 + infillH;
          for (let k = 0; k < bays; k++) {
            const t0 = ts + ((te - ts) * k) / bays + 2.5;
            const t1 = ts + ((te - ts) * (k + 1)) / bays - 2.5;
            const A = { x: side.x0 + ux * t0 + nx * o, y: side.y0 + uy * t0 + ny * o };
            const B = { x: side.x0 + ux * t1 + nx * o, y: side.y0 + uy * t1 + ny * o };
            panelsOut.push({ kind: infill === "glass" ? "glass" : "solid", ring: [A.x, A.y, z0, B.x, B.y, z0, B.x, B.y, z1, A.x, A.y, z1], of: key });
          }
        }
      }
    }
  }

  // Rails and caps meeting at a corner (2026-10-11). A cap ran 1¾ in. past its run's end, so two lapped over a corner post
  // with their tops in one plane (flickering) and left the post's outer corner bare: the cap coming in now runs on to
  // the other's outer edge and the one going out starts against its inner edge. At an inside corner the rails' lines
  // cross: the one coming in stops against the other. Drawn only — what is bought is the same.
  const runners = members.filter((m) => m.role === "rail-cap" || m.role === "rail-top" || m.role === "rail-bottom");
  const ends = runners.map((m) => {
    const u = { x: Math.cos(m.yaw), y: Math.sin(m.yaw) };
    const past = m.role === "rail-cap" ? 1.75 : 0;
    const half = m.sx / 2 - past;
    return { m, u, past, S: { x: m.cx - u.x * half, y: m.cy - u.y * half }, E: { x: m.cx + u.x * half, y: m.cy + u.y * half }, startExt: past, endExt: past };
  });
  for (const A of ends) {
    for (const B of ends) {
      if (A === B || A.m.role !== B.m.role || Math.abs(A.m.cz - B.m.cz) > 0.5) continue;
      if (Math.hypot(A.E.x - B.S.x, A.E.y - B.S.y) > 4) continue;
      const turn = A.u.x * B.u.y - A.u.y * B.u.x;
      // How far the other's line is past this one's end, along each (2026-11-13: read off the two lines, so it holds for
      // a rail hung outside the rim — 2¼ in. — and for a top-mounted one, whose two runs end on one post).
      const alongA = (B.S.x - A.E.x) * A.u.x + (B.S.y - A.E.y) * A.u.y;
      const alongB = (B.S.x - A.E.x) * B.u.x + (B.S.y - A.E.y) * B.u.y;
      if (turn > 0.5 && A.m.role === "rail-cap") {
        A.endExt = alongA + B.m.sy / 2;
        B.startExt = alongB - A.m.sy / 2;
      } else if (turn < -0.5) A.endExt = alongA - B.m.sy / 2;
    }
  }
  for (const c of ends) {
    if (c.startExt === c.past && c.endExt === c.past) continue;
    const a = { x: c.S.x - c.u.x * c.startExt, y: c.S.y - c.u.y * c.startExt };
    const b = { x: c.E.x + c.u.x * c.endExt, y: c.E.y + c.u.y * c.endExt };
    c.m.cx = (a.x + b.x) / 2;
    c.m.cy = (a.y + b.y) / 2;
    c.m.sx = Math.hypot(b.x - a.x, b.y - a.y);
  }

  // The stairs' rails, counted by the stairs; summed here so the price has one figure.
  const stairLf = stairs.reduce((a, s) => a + (s.rail.sides * s.rail.lengthIn) / 12, 0);
  const stairPosts = stairs.reduce((a, s) => a + s.rail.posts, 0);
  const stairBalusters = stairs.reduce((a, s) => a + s.rail.balusters, 0);
  const totalLf = Math.round((lf + stairLf) * 10) / 10;
  const litCaps = rail.lighting === "none" ? 0 : posts + stairPosts;
  const riserLights = rail.lighting === "post-caps-risers" ? stairs.reduce((a, s) => a + s.hardware.riserLights, 0) : 0;
  const on = segments.length > 0 || stairLf > 0;
  return {
    on,
    required,
    type: rail.type,
    label: type.label,
    heightIn: H,
    infill,
    system,
    segments,
    lf: Math.round(lf * 10) / 10,
    stairLf: Math.round(stairLf * 10) / 10,
    totalLf,
    posts,
    stairPosts,
    topRailLf: Math.round(lf + stairLf),
    bottomRailLf: Math.round(lf + stairLf),
    capLf: rail.cap && system === "wood" ? Math.round(lf) : 0,
    balusters: balusters + stairBalusters,
    cableLf: Math.round(cableLf),
    panels,
    litCaps,
    riserLights,
    members,
    panelsOut,
    // The stairs' posts stand on their stringers: tied like the rim's where the posts are wood, bare or sleeved.
    hardware: { ...hardware, postTies: hardware.postTies + (postKind === "metal" ? 0 : stairPosts), postCaps: hardware.postCaps + stairPosts },
    postKind,
    mount: mountAll,
    mounts,
    topPosts,
    sidePosts,
    onRoofPosts,
    color,
    baluster: balusterKind,
    meshPanels,
    infillColor,
    drinkLf: drink ? Math.round(lf) : 0,
  };
}

/** A rail post and how it is held, as the 3D's note on it says. */
export function railPostWords(r: Pick<RailBuild, "label" | "heightIn" | "postKind">, mount: RailMount): string {
  if (mount === "top") {
    if (r.postKind === "wood") return `4x4 rail post standing on the boards in a rated guard-post base, its screws into solid blocking between the joists; ${r.heightIn} in. above the boards. Top-mounted: not the code's bolted-to-the-rim detail — the base maker's tested load is the proof.`;
    if (r.postKind === "sleeve") return `${r.label} post sleeve over the maker's surface-mount post kit, top-mounted: its base plate on the deck boards, four structural screws into solid blocking between the joists.`;
    return `${r.label} post, top-mounted: its base plate on the deck boards, four structural screws through the boards into solid blocking between the joists.`;
  }
  if (r.postKind === "wood") return `4x4 rail post, side-mounted: on the outside of the rim, bolted through it with two ½-in. carriage bolts and a pair of tension ties into the joist; ${r.heightIn} in. above the boards.`;
  if (r.postKind === "sleeve") return `${r.label} post sleeve over a treated 4x4, side-mounted: the 4x4 on the outside of the rim, bolted through it with two ½-in. carriage bolts and a pair of tension ties into the joist.`;
  return `${r.label} post, side-mounted: on the maker's fascia bracket on the outside of the rim, through-bolted, with blocking behind the rim.`;
}

/** The same, as the callout that explains the connection. */
export function railMountCallout(r: Pick<RailBuild, "label" | "postKind">, mount: RailMount): string {
  if (mount === "top") return r.postKind === "wood" ? "Each 4x4 post stands on the boards in a rated guard-post base, screwed into solid blocking between the joists, so a 200-lb push on the rail goes into the frame. The base maker's tested load stands in for the code's bolted detail." : `Each ${r.label.toLowerCase()} post is top-mounted: its base plate sits on the deck boards, with four structural screws through them into solid blocking between the joists, so a 200-lb push on the rail goes into the frame — never into the boards alone.`;
  return r.postKind === "metal" ? `Each ${r.label.toLowerCase()} post is side-mounted on the maker's fascia bracket, through-bolted to the rim with blocking behind it, so a 200-lb push on the rail goes into the frame.` : `Each ${r.postKind === "sleeve" ? "post's 4x4 core" : "4x4 post"} is side-mounted: bolted through the rim with two ½-in. carriage bolts and a pair of tension ties into the joist and blocking, so a 200-lb push on the rail goes into the frame.`;
}

/** How the posts are held, as a clause: "bolted through the rim with tension ties", "top-mounted on their base plates over blocking" — or both, counted, where the sides differ. */
export function railHeldWords(r: Pick<RailBuild, "postKind" | "topPosts" | "sidePosts" | "mount">): string {
  const top = r.postKind === "wood" ? "top-mounted in rated post bases over blocking" : "top-mounted on their base plates over blocking";
  const side = r.postKind === "metal" ? "side-mounted on fascia brackets through-bolted to the rim" : "bolted through the rim with tension ties";
  if (r.topPosts && r.sidePosts) return `${r.topPosts} ${top}, ${r.sidePosts} ${side}`;
  return r.topPosts || (!r.sidePosts && r.mount === "top") ? top : side;
}

/** The sections mounted one way, as words, in the order a builder says them: the front, the left side, the right side, the back. */
export function railSidesMounted(r: Pick<RailBuild, "mounts">, mount: RailMount): string[] {
  return RAIL_SECTION_KEYS.filter((k) => r.mounts[k] === mount).map((k) => RAIL_SECTION_LABEL[k].toLowerCase());
}

/** How the rail is mounted, in a line: "top-mounted", "side-mounted", or which sides differ. */
export function railMountLine(r: Pick<RailBuild, "mount" | "mounts">): string {
  const all = Object.values(r.mounts);
  if (!all.length || all.every((m) => m === all[0])) return `${all[0] ?? r.mount}-mounted`;
  const of = (m: RailMount) => railSidesMounted(r, m);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);
  return `top-mounted on the ${list(of("top"))}, side-mounted on the ${list(of("side"))}`;
}

/** The rail as the order names it: "White composite", "Textured black aluminum", "Cable, bronze frame", "Cedar". */
export function railNamed(r: Pick<RailBuild, "label" | "type" | "color">): string {
  if (!r.color || r.type === "custom") return r.label;
  if (r.type === "cable" || r.type === "glass") return `${r.label}, ${r.color.name.toLowerCase()} frame`;
  return `${r.color.name} ${r.label.toLowerCase()}`;
}
/** The infill in words: "round black metal balusters", "wire mesh panels", "cable". */
export function infillWords(r: Pick<RailBuild, "infill" | "baluster" | "type">): string {
  if (r.infill === "balusters") return r.type === "aluminum" ? "pickets" : r.baluster === "metal" ? "round black metal balusters" : "balusters";
  return r.infill === "mesh" ? "wire mesh panels" : r.infill === "glass" ? "glass panels" : r.infill === "panel" ? "panels" : r.infill === "horizontal" ? "horizontal rails" : "cable";
}

/** "42 ft of cedar railing, 36 in., balusters — 9 posts". */
export function railWords(r: RailBuild): string {
  if (!r.on) return "No railing";
  return `${Math.round(r.totalLf)} ft of ${railNamed(r).toLowerCase()} railing, ${r.heightIn} in., ${infillWords(r)}${r.drinkLf ? ", a deck-board drink rail on top" : ""} — ${plural(r.posts + r.stairPosts, "post")}${r.posts ? `, ${railMountLine(r)}` : ""}`;
}
