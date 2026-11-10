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

import { GUARD_REQUIRED_ABOVE_IN } from "./codeTables";
import { RAIL_METAL_BLACK, RAIL_STAINLESS, railColorOf, railType, type RailColor, type RailTypeId } from "./catalog";
import type { DeckDesign, RailDesign, RailInfill } from "./design";
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
  hardware: { postTies: number; postCaps: number; railBrackets: number };
  /** The system's colour (2026-11-09): the one picked or its usual one; null for a wood rail (it is the wood). */
  color: RailColor | null;
  /** The balusters as built: the rail's own square ones, or thin metal ones (round black in wood, composite and vinyl; an aluminum system's own pickets). */
  baluster: "square" | "metal";
  /** Wire mesh panels, one a bay. */
  meshPanels: number;
  /** The infill's own colour where it is not the rail's: stainless cable, black metal balusters or mesh in a rail of another colour (null: the rail's). */
  infillColor: string | null;
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
}

export function buildRails(input: RailInput): RailBuild {
  const { rail, stairs, levels } = input;
  const type = railType(rail.type);
  const required = railRequired(levels);
  const members: RailMember[] = [];
  const panelsOut: RailPanel[] = [];
  const segments: RailSegment[] = [];
  const infill = infillFor(rail.type, rail.infill);
  const system: RailBuild["system"] = rail.type === "treated" || rail.type === "cedar" ? "wood" : rail.type === "custom" ? "custom" : "kit";
  const H = rail.heightIn;
  const spacing = rail.postSpacingFt * 12;
  const hardware = { postTies: 0, postCaps: 0, railBrackets: 0 };
  const color = railColorOf(rail.type, rail.color);
  // Thin metal balusters: asked for in a wood, composite or vinyl rail; what an aluminum system has anyway.
  const metalBalusters = rail.type === "aluminum" || (rail.baluster === "round" && (system === "wood" || rail.type === "composite" || rail.type === "vinyl" || rail.type === "custom"));
  const balusterKind: RailBuild["baluster"] = metalBalusters ? "metal" : "square";
  const infillColor = infill === "cable" ? RAIL_STAINLESS : infill === "mesh" || (infill === "balusters" && metalBalusters && rail.type !== "aluminum") ? RAIL_METAL_BLACK : null;
  let meshPanels = 0;
  let posts = 0;
  let lf = 0;
  let balusters = 0;
  let cableLf = 0;
  let panels = 0;
  const empty: RailBuild = { on: false, required, type: rail.type, label: type.label, heightIn: H, infill, system, segments: [], lf: 0, stairLf: 0, totalLf: 0, posts: 0, stairPosts: 0, topRailLf: 0, bottomRailLf: 0, capLf: 0, balusters: 0, cableLf: 0, panels: 0, litCaps: 0, riserLights: 0, members: [], panelsOut: [], hardware, color: null, baluster: "square", meshPanels: 0, infillColor: null };
  if (rail.type === "none") return empty;

  /** Posts the other level set: two levels meeting at a corner would set two posts in one place (2026-10-11). */
  const otherLevelPosts: Array<[number, number]> = [];
  for (const level of levels) {
    if (level.id === "lower" && !rail.lowerLevel && level.surfaceIn - level.lowestGroundIn <= GUARD_REQUIRED_ABOVE_IN) continue;
    const postTop = level.surfaceIn + H;
    const postBottom = level.joistBottomIn + POST_EMBED_IN;
    const postLen = postTop - postBottom;
    const stairsHere = stairs.filter((s) => s.level === level.id && s.kind === "flight");
    const wraps = stairs.filter((s) => s.level === level.id && s.kind === "box");
    /** Posts already set on this level: a corner post serves both sides that meet there. */
    const postsSet: Array<[number, number]> = [];
    const fromOtherLevels = otherLevelPosts.slice();
    for (const side of level.sides) {
      if (side.house) continue;
      // Box steps wrap this side: no rail there (the deck is low by definition).
      if (wraps.some((w) => w.design.wrapSides === 4 || (w.design.wrapSides === 3 && side.side !== "back") || (w.design.wrapSides === 1 && side.side === "front"))) continue;
      const L = Math.hypot(side.x1 - side.x0, side.y1 - side.y0);
      if (L < 12) continue;
      const ux = (side.x1 - side.x0) / L;
      const uy = (side.y1 - side.y0) / L;
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
        const seg: RailSegment = { level: level.id, x0: side.x0 + ux * a, y0: side.y0 + uy * a, x1: side.x0 + ux * b, y1: side.y0 + uy * b, lengthIn: Math.round(len), posts: n };
        segments.push(seg);
        lf += len / 12;
        // Posts: set in half a post from the ends, just inside the rim; a corner post already there is shared.
        const inset = 1.75 + 0.5;
        const nx = -uy;
        const ny = ux;
        for (let k = 0; k < n; k++) {
          let t = a + inset + ((len - 2 * inset) * k) / (n - 1);
          let cx = side.x0 + ux * t - nx * 2.25;
          let cy = side.y0 + uy * t - ny * 2.25;
          // The other level already set a post right here: this one stands 4 in. along its own run (drawn in one place,
          // the two posts flickered).
          if (fromOtherLevels.some(([px, py]) => Math.hypot(px - cx, py - cy) < 4)) {
            t += k === n - 1 ? -4 : 4;
            cx = side.x0 + ux * t - nx * 2.25;
            cy = side.y0 + uy * t - ny * 2.25;
          }
          if (postsSet.some(([px, py]) => Math.hypot(px - cx, py - cy) < 8)) continue;
          postsSet.push([cx, cy]);
          otherLevelPosts.push([cx, cy]);
          posts += 1;
          // Drawn a quarter inch proud of the top rail where no cap covers them (flush, the post's top and the rail's lay
          // in one plane and flickered, 2026-10-11); the length bought is the post's.
          const proud = rail.cap && system === "wood" ? 0 : 0.25;
          members.push({ role: "rail-post", nominal: system === "wood" ? RAIL_POST_NOMINAL : "post", lengthIn: postLen, cx, cy, cz: postBottom + (postLen + proud) / 2, sx: 3.5, sy: 3.5, sz: postLen + proud, yaw: 0, tilt: 0, of: `${level.id}-${side.side}` });
          hardware.postTies += 1;
          hardware.postCaps += 1;
        }
        const mx = (seg.x0 + seg.x1) / 2 - nx * 2.25;
        const my = (seg.y0 + seg.y1) / 2 - ny * 2.25;
        // Top rail under the cap, bottom rail 3 1/2 in. up (a 4-in. gap at the floor).
        members.push({ role: "rail-top", nominal: RAIL_TOP_NOMINAL, lengthIn: len, cx: mx, cy: my, cz: postTop - (rail.cap && system === "wood" ? 1.5 : 0) - 1.75, sx: len, sy: 1.5, sz: 3.5, yaw, tilt: 0, of: level.id });
        members.push({ role: "rail-bottom", nominal: RAIL_TOP_NOMINAL, lengthIn: len, cx: mx, cy: my, cz: level.surfaceIn + 3.5 + 1.75, sx: len, sy: 1.5, sz: 3.5, yaw, tilt: 0, of: level.id });
        if (rail.cap && system === "wood") members.push({ role: "rail-cap", nominal: RAIL_CAP_NOMINAL, lengthIn: len + 3.5, cx: mx, cy: my, cz: postTop + 0.75, sx: len + 3.5, sy: 5.5, sz: 1.5, yaw, tilt: 0, of: level.id });
        hardware.railBrackets += 4 * (n - 1);
        const capIn = rail.cap && system === "wood" ? 1.5 : 0;
        const infillH = H - 3.5 - 3.5 - capIn - 3.5;
        const zMid = level.surfaceIn + 3.5 + 3.5 + infillH / 2;
        if (infill === "balusters") {
          const count = Math.max(0, Math.floor(len / (metalBalusters ? METAL_BALUSTER_SPACING_IN : BALUSTER_SPACING_IN)) - (n - 1));
          balusters += count;
          const step = len / (count + 1);
          const w = metalBalusters ? METAL_BALUSTER_IN : 1.5;
          for (let k = 1; k <= count; k++) {
            const t = a + step * k;
            members.push({ role: "baluster", nominal: metalBalusters ? METAL_BALUSTER_NOMINAL : BALUSTER_NOMINAL, lengthIn: infillH, cx: side.x0 + ux * t - nx * 2.25, cy: side.y0 + uy * t - ny * 2.25, cz: zMid, sx: w, sy: w, sz: infillH, yaw: 0, tilt: 0, of: level.id });
          }
        } else if (infill === "mesh") {
          // One welded panel a bay, its wires drawn: uprights and levels 4 in. apart, the panel's edges in the rails' grooves.
          const bays = n - 1;
          meshPanels += bays;
          const z0 = level.surfaceIn + 3.5 + 3.5;
          for (let k = 0; k < bays; k++) {
            const t0 = a + inset + ((len - 2 * inset) * k) / bays + 1.75;
            const t1 = a + inset + ((len - 2 * inset) * (k + 1)) / bays - 1.75;
            const bay = t1 - t0;
            if (bay < 8) continue;
            const ups = Math.max(1, Math.round(bay / MESH_GRID_IN) - 1);
            for (let i = 1; i <= ups; i++) {
              const t = t0 + (bay * i) / (ups + 1);
              members.push({ role: "mesh", nominal: "welded wire", lengthIn: infillH, cx: side.x0 + ux * t - nx * 2.25, cy: side.y0 + uy * t - ny * 2.25, cz: z0 + infillH / 2, sx: MESH_WIRE_IN, sy: MESH_WIRE_IN, sz: infillH, yaw: 0, tilt: 0, of: level.id });
            }
            const rows = Math.max(1, Math.round(infillH / MESH_GRID_IN) - 1);
            const tm = (t0 + t1) / 2;
            for (let i = 1; i <= rows; i++) members.push({ role: "mesh", nominal: "welded wire", lengthIn: bay, cx: side.x0 + ux * tm - nx * 2.25, cy: side.y0 + uy * tm - ny * 2.25, cz: z0 + (infillH * i) / (rows + 1), sx: bay, sy: MESH_WIRE_IN, sz: MESH_WIRE_IN, yaw, tilt: 0, of: level.id });
          }
        } else if (infill === "horizontal") {
          const rows = Math.floor(infillH / 5.5);
          balusters += 0;
          for (let k = 1; k <= rows; k++) members.push({ role: "rail-top", nominal: RAIL_TOP_NOMINAL, lengthIn: len, cx: mx, cy: my, cz: level.surfaceIn + 3.5 + 3.5 + (infillH * k) / (rows + 1), sx: len, sy: 1.5, sz: 3.5, yaw, tilt: 0, of: level.id });
        } else if (infill === "cable") {
          const runs = Math.max(8, Math.floor(infillH / CABLE_SPACING_IN));
          cableLf += (runs * len) / 12;
          for (let k = 1; k <= runs; k++) members.push({ role: "cable", nominal: "cable", lengthIn: len, cx: mx, cy: my, cz: level.surfaceIn + 3.5 + 3.5 + (infillH * k) / (runs + 1), sx: len, sy: 0.3, sz: 0.3, yaw, tilt: 0, of: level.id });
        } else {
          // One panel a bay.
          const bays = n - 1;
          panels += bays;
          const z0 = level.surfaceIn + 3.5 + 3.5;
          const z1 = z0 + infillH;
          for (let k = 0; k < bays; k++) {
            const t0 = a + inset + ((len - 2 * inset) * k) / bays + 2.5;
            const t1 = a + inset + ((len - 2 * inset) * (k + 1)) / bays - 2.5;
            const A = { x: side.x0 + ux * t0 - nx * 2.25, y: side.y0 + uy * t0 - ny * 2.25 };
            const B = { x: side.x0 + ux * t1 - nx * 2.25, y: side.y0 + uy * t1 - ny * 2.25 };
            panelsOut.push({ kind: infill === "glass" ? "glass" : "solid", ring: [A.x, A.y, z0, B.x, B.y, z0, B.x, B.y, z1, A.x, A.y, z1], of: level.id });
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
      if (turn > 0.5 && A.m.role === "rail-cap") {
        A.endExt = 2.25 + B.m.sy / 2;
        B.startExt = 2.25 - A.m.sy / 2;
      } else if (turn < -0.5) A.endExt = -(2.25 + B.m.sy / 2);
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
    hardware: { ...hardware, postTies: hardware.postTies + stairPosts, postCaps: hardware.postCaps + stairPosts },
    color,
    baluster: balusterKind,
    meshPanels,
    infillColor,
  };
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
  return `${Math.round(r.totalLf)} ft of ${railNamed(r).toLowerCase()} railing, ${r.heightIn} in., ${infillWords(r)} — ${plural(r.posts + r.stairPosts, "post")}`;
}
