// THE PERMIT SET'S DRAWINGS, AS DATA (2026-10-10) — pure, no React.
//
// Owner: "a professional construction plan for the decks that can be
// submitted for the permits, with the sizes and everything and the names of
// the materials — a construction drawing, two or three pages depending on
// the deck: the roof separately, the floor separately, per code, and if
// possible lateral."
//
// The building office wants the same things every time: a framing plan for
// each level of structure, an elevation, a section through the deck that
// shows the ledger, the joist, the beam, the post and the footing against
// the grade and the frost line, the details that fasten it together, the
// schedules with the table each number came from, and the material list.
// Everything here is read off the engine's own structure (lib/deck): the
// section is the real joist depth, the real beam, the real footing depth.
// The sheet (components/v3/deck-permit) only draws what comes back, so the
// QA script can prove a drawing without a browser.
//
// Drawings are lists of primitives in INCHES. The section and the details
// use an upright frame — X across, Z up from the grade — and the renderer
// flips Z. A `dim` is a dimension string with ticks and its label.

import { ftIn, LEDGER_FASTENER_LABEL, RULE } from "./codeTables";
import { RULE_RAFTER } from "./roofTables";
import type { DeckDesign } from "./design";
import type { DeckFrame, Post } from "./frame";
import type { DeckStructure } from "./structure";
import type { DeckPackage } from "./pricing";
import { BOM_STEP_LABEL, type BomStep } from "./takeoff";

export type DrawClass = "ink" | "wood" | "concrete" | "steel" | "hatch" | "dash" | "thin" | "dim" | "grade" | "glass";

export type DrawItem =
  | { t: "rect"; x: number; z: number; w: number; h: number; cls: DrawClass }
  | { t: "line"; x1: number; z1: number; x2: number; z2: number; cls: DrawClass }
  | { t: "poly"; pts: number[]; cls: DrawClass; closed?: boolean }
  | { t: "circle"; x: number; z: number; r: number; cls: DrawClass }
  | { t: "text"; x: number; z: number; s: string; size?: number; anchor?: "start" | "middle" | "end"; rot?: number; cls?: "note" | "label" | "dim" }
  | { t: "dim"; x1: number; z1: number; x2: number; z2: number; label: string; off?: number };

export interface Drawing {
  /** The drawing's extent in inches: left, bottom, width, height (Z up). */
  box: { x: number; z: number; w: number; h: number };
  items: DrawItem[];
}

export interface DetailDrawing {
  title: string;
  drawing: Drawing;
  /** The notes a reviewer reads with it, each with the rule it rests on. */
  notes: string[];
}

export type PermitPageKind = "floor" | "roof" | "elevation" | "section" | "details" | "schedules" | "materials" | "notes";

export interface PermitPage {
  no: string;
  name: string;
  kind: PermitPageKind;
}

const POST_W: Record<string, number> = { "4x4": 3.5, "4x6": 3.5, "6x6": 5.5, "8x8": 7.5 };
const JOIST_DEPTH: Record<string, number> = { "2x6": 5.5, "2x8": 7.25, "2x10": 9.25, "2x12": 11.25 };
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The sheets a structure needs, in order: a plan for each level of structure, the elevation, the section, the details, the schedules, the notes. */
export function permitPages(s: DeckStructure): PermitPage[] {
  const pages: PermitPage[] = [];
  let a = 0;
  const A = (name: string, kind: PermitPageKind) => pages.push({ no: `A${++a}`, name, kind });
  if (s.frame) A("Floor framing plan", "floor");
  if (s.roof) A(s.roof.kind === "pergola" ? "Pergola framing plan" : "Roof framing plan", "roof");
  A("Front elevation", "elevation");
  if (s.frame) A("Section through the deck", "section");
  A("Details and lateral connections", "details");
  pages.push({ no: "S1", name: "Schedules", kind: "schedules" });
  pages.push({ no: "S2", name: "Materials", kind: "materials" });
  pages.push({ no: "S3", name: "Notes and code checks", kind: "notes" });
  return pages;
}

/** The post the section cuts through: the first beam's first post (the deck's front line), else the first post. */
export function sectionPost(frame: DeckFrame): Post | null {
  const front = frame.beams.find((b) => b.role === "front") ?? frame.beams[0];
  return (front && frame.posts.find((p) => p.beamId === front.id)) ?? frame.posts[0] ?? null;
}

/**
 * The section through the deck, looking along the house: the house wall and
 * the ledger at the left, one joist from the ledger to the rim, the decking
 * on it, every beam cut across, the post and its footing against the grade
 * and the frost line, the guard at the front, the stairs down when there
 * are any — with the dimensions a plan checker reads first.
 */
export function sectionDrawing(s: DeckStructure): Drawing | null {
  const f = s.frame;
  if (!f) return null;
  const d = f.design;
  const items: DrawItem[] = [];
  const D = Math.max(...f.zones.map((z) => z.zone.y1));
  const joistDepth = JOIST_DEPTH[f.joistSize] ?? 7.25;
  const attached = d.placement === "attached" && f.ledgers.length > 0;
  const post = sectionPost(f);
  const frost = d.frostIn;
  const deepest = Math.max(frost, ...f.posts.map((p) => p.footing.depthIn), 12);
  const rails = s.rails;
  const guardTop = rails.on ? f.surfaceIn + rails.heightIn : f.surfaceIn;
  const top = Math.max(guardTop, f.surfaceIn) + 30;
  const left = attached ? -14 : -6;
  const right = D + 52;
  const dimX = left - 5;
  const boxL = dimX - 9;

  // The grade, the frost line, the house.
  items.push({ t: "line", x1: left, z1: 0, x2: right, z2: 0, cls: "grade" });
  items.push({ t: "text", x: right - 2, z: -3.5, s: "grade", anchor: "end", cls: "label" });
  items.push({ t: "line", x1: left, z1: -frost, x2: right, z2: -frost, cls: "dash" });
  items.push({ t: "text", x: right - 2, z: -frost - 3.5, s: `frost line ${frost} in.`, anchor: "end", cls: "label" });
  if (attached) {
    items.push({ t: "rect", x: -12, z: -6, w: 12, h: top + 6, cls: "hatch" });
    items.push({ t: "text", x: -6, z: top - 10, s: "HOUSE", anchor: "middle", rot: -90, cls: "label" });
    // The ledger on the house, flashed; the joist hangs on it.
    items.push({ t: "rect", x: 0, z: f.joistBottomIn, w: 1.5, h: joistDepth, cls: "wood" });
    items.push({ t: "line", x1: -1, z1: f.joistTopIn + 2.5, x2: 2.5, z2: f.joistTopIn + 2.5, cls: "steel" });
    items.push({ t: "line", x1: 2.5, z1: f.joistTopIn + 2.5, x2: 2.5, z2: f.joistTopIn, cls: "steel" });
    items.push({ t: "text", x: 4, z: f.joistTopIn + 3.6, s: "flashing", cls: "note" });
    const run = f.ledgers[0];
    items.push({ t: "text", x: 2.5, z: f.joistBottomIn - 4, s: `${f.joistSize} ledger · ${LEDGER_FASTENER_LABEL[d.ledger.fastener]}, 2 rows @ ${run.spacingIn} in.`, cls: "note" });
  }
  // The joist, the rim, the decking.
  items.push({ t: "rect", x: attached ? 1.5 : 0, z: f.joistBottomIn, w: D - (attached ? 1.5 : 0), h: joistDepth, cls: "wood" });
  items.push({ t: "rect", x: D, z: f.joistBottomIn, w: 1.5, h: joistDepth, cls: "wood" });
  items.push({ t: "rect", x: 0, z: f.joistTopIn, w: D + 1.5, h: f.surfaceIn - f.joistTopIn, cls: "wood" });
  items.push({ t: "text", x: D / 2, z: f.surfaceIn + 9, s: `${f.decking.label} decking on ${f.joistSize} joists @ ${f.spacingIn} in. o.c.`, anchor: "middle", cls: "note" });
  // The beams, cut across.
  for (const b of f.beams) {
    const depth = b.spec.depthIn;
    const thick = b.spec.thickIn;
    const z = b.style === "flush" ? f.joistBottomIn : f.joistBottomIn - depth;
    items.push({ t: "rect", x: b.y - thick / 2, z, w: thick, h: depth, cls: "wood" });
    items.push({ t: "text", x: b.y + thick / 2 + 1.5, z: z + depth / 2 - 1.5, s: `${b.spec.size} beam${b.style === "flush" ? ", flush" : ""}`, cls: "note" });
  }
  // The post and its footing.
  if (post) {
    const w = POST_W[post.size] ?? 5.5;
    const beam = f.beams.find((b) => b.id === post.beamId) ?? f.beams[0];
    const postTop = beam ? (beam.style === "flush" ? f.joistBottomIn : f.joistBottomIn - beam.spec.depthIn) : f.joistBottomIn;
    const ft = post.footing;
    items.push({ t: "rect", x: post.y - w / 2, z: ft.topIn, w, h: Math.max(1, postTop - ft.topIn), cls: "wood" });
    items.push({ t: "text", x: post.y + w / 2 + 1.5, z: ft.topIn + (postTop - ft.topIn) / 2, s: `${post.size} post on a post base`, cls: "note" });
    if (ft.type === "poured") {
      items.push({ t: "rect", x: post.y - ft.pierIn / 2, z: -ft.depthIn + ft.padThickIn, w: ft.pierIn, h: ft.depthIn - ft.padThickIn + ft.topIn, cls: "concrete" });
      items.push({ t: "rect", x: post.y - ft.padIn / 2, z: -ft.depthIn, w: ft.padIn, h: ft.padThickIn, cls: "concrete" });
      items.push({ t: "text", x: post.y + ft.padIn / 2 + 1.5, z: -ft.depthIn + 1, s: `${ft.padIn}×${ft.padThickIn} in. pad, ${ft.pierIn} in. pier`, cls: "note" });
      items.push({ t: "dim", x1: post.y - ft.padIn / 2 - 6, z1: 0, x2: post.y - ft.padIn / 2 - 6, z2: -ft.depthIn, label: `${ft.depthIn} in. below grade` });
    } else {
      items.push({ t: "rect", x: post.y - ft.padIn / 2, z: ft.topIn - ft.padThickIn, w: ft.padIn, h: ft.padThickIn, cls: "concrete" });
      items.push({ t: "text", x: post.y + ft.padIn / 2 + 1.5, z: ft.topIn - ft.padThickIn + 1, s: `${ft.padIn} in. precast pier block on compacted gravel`, cls: "note" });
    }
  }
  // The guard at the front edge.
  if (rails.on) {
    items.push({ t: "rect", x: D - 2, z: f.joistBottomIn, w: 3.5, h: guardTop - f.joistBottomIn, cls: "wood" });
    items.push({ t: "rect", x: D - 4, z: guardTop - 1.5, w: 7.5, h: 1.5, cls: "wood" });
    items.push({ t: "dim", x1: D + 12, z1: f.surfaceIn, x2: D + 12, z2: guardTop, label: `${rails.heightIn} in. guard` });
  }
  // The stairs down the front, if any.
  const stair = s.stairs.find((st) => st.design.side === "front" && st.kind === "flight");
  if (stair && stair.risers > 0) {
    const riser = f.surfaceIn / stair.risers;
    const tread = stair.runIn;
    const pts: number[] = [D + 1.5, f.surfaceIn];
    for (let i = 0; i < stair.risers; i++) {
      const x = D + 1.5 + i * tread;
      const zTop = f.surfaceIn - i * riser;
      pts.push(x, zTop - riser, x + tread, zTop - riser);
    }
    items.push({ t: "poly", pts, cls: "ink" });
    items.push({ t: "text", x: D + 4, z: f.surfaceIn / 2, s: `${stair.risers} risers @ ${r1(riser)} in. · ${stair.stringers.count} 2x12 stringers`, cls: "note" });
  }
  // The dimensions a checker reads first.
  items.push({ t: "dim", x1: dimX, z1: 0, x2: dimX, z2: f.surfaceIn, label: `${ftIn(f.surfaceIn)} deck height` });
  if (f.beams[0]) items.push({ t: "dim", x1: 0, z1: f.joistBottomIn - (f.beams[0].style === "flush" ? 0 : f.beams[0].spec.depthIn) - 8, x2: f.beams[0].y, z2: f.joistBottomIn - (f.beams[0].style === "flush" ? 0 : f.beams[0].spec.depthIn) - 8, label: `${ftIn(f.beams[0].y)} joist span` });
  items.push({ t: "dim", x1: 0, z1: top - 6, x2: D, z2: top - 6, label: `${ftIn(D)} deep` });

  const stairRight = stair && stair.risers > 0 ? D + 1.5 + stair.risers * (stair.runIn) + 6 : 0;
  return { box: { x: boxL, z: -deepest - 10, w: Math.max(right, stairRight) - boxL + 4, h: top + deepest + 14 }, items };
}

/** The details a reviewer expects fastened the way the tables say — drawn from this deck's own numbers. `which`
 *  (2026-10-20): the floor sheet's details, the roof sheet's, or both. */
export function detailDrawings(s: DeckStructure, which: "floor" | "roof" | "all" = "all"): DetailDrawing[] {
  const out: DetailDrawing[] = [];
  const f = which === "roof" ? null : s.frame;
  const d: DeckDesign = s.design;
  if (f) {
    const joistDepth = JOIST_DEPTH[f.joistSize] ?? 7.25;
    if (d.placement === "attached" && f.ledgers[0]) {
      const run = f.ledgers[0];
      const items: DrawItem[] = [];
      // The house rim, the sheathing, the ledger, two rows of fasteners staggered, the flashing, the hanger.
      items.push({ t: "rect", x: -10, z: -4, w: 10, h: joistDepth + 12, cls: "hatch" });
      items.push({ t: "text", x: -5, z: joistDepth + 10.5, s: "house rim", anchor: "middle", cls: "label" });
      items.push({ t: "rect", x: 0, z: 0, w: 1.5, h: joistDepth, cls: "wood" });
      items.push({ t: "rect", x: 1.5, z: 0, w: 14, h: joistDepth, cls: "wood" });
      items.push({ t: "text", x: 8.5, z: joistDepth / 2 - 1, s: `${f.joistSize} joist`, anchor: "middle", cls: "note" });
      items.push({ t: "rect", x: 1.5, z: 0, w: 1.75, h: joistDepth * 0.8, cls: "steel" });
      items.push({ t: "text", x: 3.8, z: -3.5, s: "joist hanger", cls: "note" });
      for (let i = 0; i < 3; i++) {
        items.push({ t: "circle", x: -2, z: joistDepth * 0.72 - (i % 2) * joistDepth * 0.44, r: 0.7, cls: "steel" });
      }
      items.push({ t: "line", x1: -1.5, z1: joistDepth + 2, x2: 2.5, z2: joistDepth + 2, cls: "steel" });
      items.push({ t: "line", x1: 2.5, z1: joistDepth + 2, x2: 2.5, z2: joistDepth, cls: "steel" });
      items.push({ t: "text", x: 3.5, z: joistDepth + 6.5, s: "metal flashing over the ledger,", cls: "note" });
      items.push({ t: "text", x: 3.5, z: joistDepth + 3.2, s: "under the siding", cls: "note" });
      items.push({ t: "dim", x1: -7, z1: 0, x2: -7, z2: joistDepth, label: `${f.joistSize} ledger` });
      out.push({
        title: "Ledger attachment",
        drawing: { box: { x: -14, z: -8, w: 62, h: joistDepth + 24 }, items },
        notes: [
          `${LEDGER_FASTENER_LABEL[d.ledger.fastener]} in two staggered rows, ${run.spacingIn} in. on centre — ${run.fasteners} on this ledger (${run.rule}).`,
          `${d.ledger.lateral === "four" ? "Four 750-lb" : "Two 1,500-lb"} lateral load connectors tie the deck's joists to the house framing. ${RULE.lateral}.`,
          `The ledger is flashed; no ledger on a cantilevered floor, brick veneer or a hollow wall. ${RULE.ledgerWall}.`,
        ],
      });
      const lateral = lateralDetail(f);
      if (lateral) out.push(lateral);
    }
    const post = sectionPost(f);
    if (post) {
      const beam = f.beams.find((b) => b.id === post.beamId) ?? f.beams[0];
      const w = POST_W[post.size] ?? 5.5;
      const ft = post.footing;
      const items: DrawItem[] = [];
      const beamDepth = beam?.spec.depthIn ?? 9.25;
      const beamThick = beam?.spec.thickIn ?? 3;
      const postH = 30;
      items.push({ t: "line", x1: -16, z1: 0, x2: 50, z2: 0, cls: "grade" });
      items.push({ t: "rect", x: -w / 2, z: ft.topIn, w, h: postH, cls: "wood" });
      items.push({ t: "rect", x: -w / 2 - 1.5, z: ft.topIn + postH, w: w + 3, h: 1, cls: "steel" });
      items.push({ t: "rect", x: -beamThick / 2, z: ft.topIn + postH + 1, w: beamThick, h: beamDepth, cls: "wood" });
      items.push({ t: "text", x: beamThick / 2 + 2, z: ft.topIn + postH + beamDepth / 2, s: `${beam?.spec.size ?? "beam"} in a post cap`, cls: "note" });
      items.push({ t: "rect", x: -w / 2 - 1, z: ft.topIn, w: w + 2, h: 1.5, cls: "steel" });
      items.push({ t: "text", x: w / 2 + 2, z: ft.topIn + 1, s: "post base, 1 in. up", cls: "note" });
      if (ft.type === "poured") {
        items.push({ t: "rect", x: -ft.pierIn / 2, z: -ft.depthIn + ft.padThickIn, w: ft.pierIn, h: ft.depthIn - ft.padThickIn + ft.topIn, cls: "concrete" });
        items.push({ t: "rect", x: -ft.padIn / 2, z: -ft.depthIn, w: ft.padIn, h: ft.padThickIn, cls: "concrete" });
        items.push({ t: "dim", x1: -ft.padIn / 2 - 5, z1: 0, x2: -ft.padIn / 2 - 5, z2: -ft.depthIn, label: `${ft.depthIn} in.` });
        items.push({ t: "dim", x1: -ft.padIn / 2, z1: -ft.depthIn - 5, x2: ft.padIn / 2, z2: -ft.depthIn - 5, label: `${ft.padIn} in. pad` });
      } else {
        items.push({ t: "rect", x: -ft.padIn / 2, z: ft.topIn - ft.padThickIn, w: ft.padIn, h: ft.padThickIn, cls: "concrete" });
        items.push({ t: "text", x: ft.padIn / 2 + 2, z: ft.topIn - ft.padThickIn + 1, s: `${ft.padIn} in. pier block`, cls: "note" });
      }
      items.push({ t: "line", x1: -16, z1: -d.frostIn, x2: 50, z2: -d.frostIn, cls: "dash" });
      items.push({ t: "text", x: 49, z: -d.frostIn + 1.5, s: `frost ${d.frostIn} in.`, anchor: "end", cls: "label" });
      out.push({
        title: "Post, beam and footing",
        drawing: { box: { x: -22, z: -Math.max(ft.depthIn, d.frostIn) - 12, w: 74, h: Math.max(ft.depthIn, d.frostIn) + postH + beamDepth + 20 }, items },
        notes: [
          `${post.size} posts in metal post bases and caps; the tallest post ${ftIn(Math.max(...f.posts.map((p) => p.heightIn)))}. ${RULE.post}.`,
          ft.type === "poured" ? `Footings ${ft.padIn} in. square (or round) and ${ft.padThickIn} in. thick on undisturbed soil, ${ft.depthIn} in. below grade — below the ${d.frostIn} in. frost line. ${RULE.footing}; ${RULE.frost}.` : `Precast pier blocks on compacted gravel; ${RULE.pierBlock}.`,
          `Soil taken at ${d.soilPsf.toLocaleString("en-US")} psf; each post carries at most ${Math.round(Math.max(...f.posts.map((p) => p.tributarySqFt)))} sq ft of deck.`,
        ],
      });
    }
    if (s.rails.on) {
      const items: DrawItem[] = [];
      const H = s.rails.heightIn;
      items.push({ t: "rect", x: 0, z: 0, w: 14, h: joistDepth, cls: "wood" });
      items.push({ t: "text", x: -1.5, z: joistDepth / 2 - 1, s: "rim joist", anchor: "end", cls: "note" });
      items.push({ t: "rect", x: 0, z: joistDepth, w: 14, h: 1, cls: "wood" });
      items.push({ t: "rect", x: 14, z: -2, w: 3.5, h: joistDepth + 2 + 1 + H, cls: "wood" });
      items.push({ t: "rect", x: 12, z: joistDepth + 1 + H - 1.5, w: 7.5, h: 1.5, cls: "wood" });
      items.push({ t: "circle", x: 15.75, z: joistDepth * 0.7, r: 0.7, cls: "steel" });
      items.push({ t: "circle", x: 15.75, z: joistDepth * 0.25, r: 0.7, cls: "steel" });
      items.push({ t: "rect", x: 10, z: 0, w: 1.5, h: joistDepth, cls: "wood" });
      items.push({ t: "text", x: 9, z: -3.5, s: "blocking", anchor: "end", cls: "note" });
      items.push({ t: "dim", x1: 24, z1: joistDepth + 1, x2: 24, z2: joistDepth + 1 + H, label: `${H} in. guard` });
      out.push({
        title: "Guard post",
        drawing: { box: { x: -20, z: -8, w: 52, h: joistDepth + H + 16 }, items },
        notes: [
          `Guard ${H} in. high, posts through-bolted to the rim with two ½-in. bolts and blocked, pickets with no 4-in. opening. ${RULE.guard}.`,
          s.rails.system === "wood" ? `Wood 4x4 posts ${d.rail.postSpacingFt} ft on centre.` : `${s.rails.label} system installed to its listing; posts ${d.rail.postSpacingFt} ft on centre.`,
        ],
      });
    }
    if (d.placement !== "attached") {
      const items: DrawItem[] = [];
      items.push({ t: "rect", x: 0, z: 0, w: 5.5, h: 40, cls: "wood" });
      items.push({ t: "rect", x: -14, z: 40, w: 36, h: 9.25, cls: "wood" });
      items.push({ t: "poly", pts: [5.5, 16, 29.5, 40, 27.5, 41.5, 4, 18], cls: "wood", closed: true });
      items.push({ t: "text", x: 20, z: 24, s: "2x4 knee brace, 45°, ½-in. lag each end", cls: "note" });
      items.push({ t: "text", x: 2.75, z: 20, s: "post", anchor: "middle", rot: -90, cls: "label" });
      items.push({ t: "text", x: 4, z: 44, s: "beam", anchor: "middle", cls: "label" });
      out.push({
        title: "Lateral bracing, free-standing",
        drawing: { box: { x: -18, z: -6, w: 56, h: 60 }, items },
        notes: [
          `A deck that stands free braces itself: knee braces at the end posts of every beam, both ways, where the posts are over 2 ft — ${f.hardware.braces || "none"} on this deck. ${RULE.bracing}; ${RULE.selfSupporting}.`,
          "This bracing is the deck's lateral system: it takes the sideways load a ledger would otherwise hand to the house.",
        ],
      });
    }
  }
  const roof = which === "floor" ? null : s.roof;
  if (roof && roof.kind !== "pergola") {
    const items: DrawItem[] = [];
    const H = roof.headers[0];
    const hd = H?.spec.depthIn ?? 9.25;
    const slope = roof.slope;
    items.push({ t: "rect", x: 0, z: 0, w: 5.5, h: 36, cls: "wood" });
    items.push({ t: "rect", x: -1, z: 36, w: 7.5, h: 1, cls: "steel" });
    items.push({ t: "rect", x: -12, z: 37, w: 30, h: hd, cls: "wood" });
    items.push({ t: "text", x: 3, z: 37 + hd / 2 - 1, s: `${H?.spec.size ?? "header"} header in a post cap`, anchor: "middle", cls: "note" });
    const rz = 37 + hd;
    items.push({ t: "poly", pts: [-16, rz - 16 * slope + 0.5, 24, rz + 24 * slope + 0.5, 24, rz + 24 * slope + 0.5 + 7.25, -16, rz - 16 * slope + 0.5 + 7.25], cls: "wood", closed: true });
    const hiTop = rz + 24 * slope + 0.5 + 7.25;
    items.push({ t: "text", x: -20, z: hiTop + 8, s: roof.trusses ? `truss @ 24 in. o.c., ${roof.trusses.chord} chords` : `${roof.rafters.size} rafter @ ${roof.rafters.spacingIn} in. o.c.`, cls: "note" });
    items.push({ t: "text", x: -20, z: hiTop + 4, s: roof.trusses ? "bears on the header, a hurricane tie each end" : "seat cut on the header, a hurricane tie", cls: "note" });
    items.push({ t: "text", x: 2.75, z: 18, s: `${roof.roof.post} post`, anchor: "middle", rot: -90, cls: "label" });
    out.push({
      title: roof.trusses ? "Truss to header to post" : "Rafter to header to post",
      drawing: { box: { x: -22, z: -6, w: 56, h: hiTop + 18 }, items },
      notes: [
        roof.trusses
          ? `${roof.trusses.count} manufactured trusses @ 24 in. o.c. span ${ftIn(roof.trusses.spanIn)} bearing to bearing at ${roof.roof.pitch}:12, designed and stamped by the truss maker for ${roof.roofLoad} psf ${roof.roofLoad === 20 ? "roof live load" : "ground snow"} and ${roof.deadPsf} psf dead; the truss design drawings are submitted with the permit. IRC R802.10.1; permanent bracing per those drawings and BCSI-B3, IRC R802.10.3.`
          : `${roof.rafters.size} rafters @ ${roof.rafters.spacingIn} in. o.c. span ${ftIn(roof.rafters.spanIn)} (the table allows ${ftIn(roof.rafters.maxSpanIn)}) at ${roof.roof.pitch}:12. ${RULE_RAFTER[roof.roofLoad]}.`,
        `Each ${roof.trusses ? "truss bears on the header with a hurricane tie at each end" : "rafter seat-cut over the header with a hurricane tie"}; headers ${[...new Set(roof.headers.filter((h) => !h.cross).map((h) => h.spec.size))].join(" / ")} in post caps. ${RULE.beam}.`,
        // 2026-10-12: the cross beams under the ridge and the ring's straps.
        ...(roof.crossBeams ? [`${roof.crossBeams === 1 ? "A cross beam" : `${roof.crossBeams} cross beams`} (${[...new Set(roof.headers.filter((h) => h.cross).map((h) => h.spec.size))].join(" / ")}) hung on the headers in beam hangers over a post at each end, each carrying a king post under the ridge beam.`] : []),
        ...(roof.ringTensionLb > 0 ? [`A tension strap across every header joint, rated for at least ${roof.ringTensionLb.toLocaleString("en-US")} lb: the hips push the corners out.`] : []),
        roof.attach === "wall"
          ? `Roof on the house with structural screws, flashed where it meets the siding: ${roof.wallFlashing.some((w) => w.kind === "apron") ? "apron (L) flashing along the top" : ""}${roof.wallFlashing.some((w) => w.kind === "apron") && roof.wallFlashing.some((w) => w.kind === "step") ? ", " : ""}${roof.wallFlashing.some((w) => w.kind === "step") ? "step flashing up each slope, one piece per course" : ""}, 4 in. up the wall under the house wrap and counter-flashed by the siding${roof.wallFlashing.some((w) => w.kind === "kickout") ? "; kickout flashing where each eave meets the wall, IRC R903.2.1" : ""}. ${RULE.ledgerBoard}; IRC R903.2.`
          : roof.houseGap
            ? `Free-standing beside the house, nothing fastened to it: the back posts ${ftIn(roof.houseGap.postsIn)} off the wall, the back eave ${inchesOr(roof.houseGap.eaveIn)}${roof.houseGap.gutter ? `, its gutter in the gap ${roof.houseGap.clearIn} in. clear of the siding` : ""}. Knee braces at the posts hold the roof square. ${RULE.bracing}.`
            : `Free-standing: knee braces at the posts hold the roof square. ${RULE.bracing}.`,
      ],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  THE SUBMITTAL SET (2026-10-20)                                      */
/* ------------------------------------------------------------------ */
//
// Owner: "the building plans in separate pages with roof, and floor and
// lateral — two or three pages, understandable and submittable, for the
// county to accept; and a site plan." Three 11 × 17 sheets at most:
//   A1  the site plan and the project's data (the code, the design criteria,
//       the scope, the notes) with the front elevation;
//   S1  the floor: its framing plan, the section, the details — the ledger,
//       the LATERAL load connection, the post and footing, the guard — and
//       the framing, footing and connector schedules;
//   S2  the roof (only when there is one): its framing plan, the uplift path
//       from rafter to footing, the bracing, its schedule.
// The material list stays its own page (the yard's, not the reviewer's).

export type PermitSheetKind = "site" | "floor" | "roof";
export interface PermitSheet {
  no: string;
  name: string;
  kind: PermitSheetKind;
}

/** The set a structure needs: two sheets for a deck, three with a roof over it. */
export function permitSheets(s: DeckStructure): PermitSheet[] {
  const out: PermitSheet[] = [{ no: "A1", name: "Site plan and project data", kind: "site" }];
  if (s.frame) out.push({ no: "S1", name: "Floor framing, section and lateral", kind: "floor" });
  if (s.roof) out.push({ no: s.frame ? "S2" : "S1", name: s.roof.kind === "pergola" ? "Pergola framing and bracing" : "Roof framing, uplift and bracing", kind: "roof" });
  return out;
}

export interface LateralDevice {
  /** Along the house, inches from the deck's left end (the yard's view), and out from the house. */
  x: number;
  y: number;
  /** The device's least capacity, lb (ASD). */
  lb: 750 | 1500;
}

/**
 * Where the lateral load connection goes (IRC R507.9.2): two 1,500-lb
 * hold-down tension devices within 24 in. of each end of the deck, or four
 * 750-lb ones — two at each end. Each on a deck joist: the first joist in
 * from the end that lies inside the 24 in. (the outside joist itself when
 * none does).
 */
export function lateralDevices(f: DeckFrame): LateralDevice[] {
  if (f.design.placement !== "attached" || !f.ledgers.length) return [];
  const x0 = Math.min(...f.ledgers.map((l) => l.x0));
  const x1 = Math.max(...f.ledgers.map((l) => l.x1));
  const y = Math.min(...f.ledgers.map((l) => l.y));
  const xs = [...new Set(f.joists.filter((j) => !j.sister).map((j) => Math.round(j.x * 10) / 10))].filter((x) => x >= x0 - 0.5 && x <= x1 + 0.5).sort((a, b) => a - b);
  const four = f.design.ledger.lateral === "four";
  const lb: 750 | 1500 = four ? 750 : 1500;
  const per = four ? 2 : 1;
  const pick = (cands: number[], fallback: number[]) => (cands.length >= per ? cands.slice(0, per) : fallback.slice(0, per));
  // The first joist in from each end takes the device (its rod reaches the house's framing inside the band); the
  // outside joist only when a second device at that end needs it.
  const inward = (d: (x: number) => number) => xs.filter((x) => d(x) > 0.5 && d(x) <= 24).sort((a, b) => (d(a) < 6 ? 1 : 0) - (d(b) < 6 ? 1 : 0) || d(a) - d(b));
  const fromLeft = inward((x) => x - x0);
  const fromRight = inward((x) => x1 - x);
  const left = pick(fromLeft, [Math.min(x0 + 12, (x0 + x1) / 2), Math.min(x0 + 20, (x0 + x1) / 2)]);
  const right = pick(fromRight, [Math.max(x1 - 12, (x0 + x1) / 2), Math.max(x1 - 20, (x0 + x1) / 2)]);
  return [...left, ...right].map((x) => ({ x, y, lb }));
}

/** The lateral load connection, drawn: a section through the house joist, the band, the ledger and the deck joist, the
 *  two hold-downs and the rod between them. Where the devices go is marked on the framing plan (LD-1, LD-2 …). */
export function lateralDetail(f: DeckFrame): DetailDrawing | null {
  const devices = lateralDevices(f);
  if (!devices.length) return null;
  const d = f.design;
  const jd = JOIST_DEPTH[f.joistSize] ?? 7.25;
  const top = 9.25;
  const zRod = top - jd / 2;
  const items: DrawItem[] = [];
  // The house's floor joist and subfloor, its band, the ledger, the deck joist.
  items.push({ t: "rect", x: -27, z: 0, w: 23.5, h: 9.25, cls: "wood" });
  items.push({ t: "rect", x: -27, z: 9.25, w: 25.5, h: 0.75, cls: "wood" });
  items.push({ t: "rect", x: -3.5, z: -0.5, w: 2, h: 10.5, cls: "hatch" });
  items.push({ t: "rect", x: -1.5, z: top - jd, w: 1.5, h: jd, cls: "wood" });
  items.push({ t: "rect", x: 0, z: top - jd, w: 27, h: jd, cls: "wood" });
  // The hold-downs and the rod.
  items.push({ t: "rect", x: 2.5, z: zRod - 2.6, w: 2.2, h: 5.2, cls: "steel" });
  items.push({ t: "rect", x: -24.5, z: zRod - 2.6, w: 2.2, h: 5.2, cls: "steel" });
  items.push({ t: "line", x1: -23.4, z1: zRod, x2: 3.6, z2: zRod, cls: "steel" });
  // The words, clear of the members, each with its leader.
  items.push({ t: "line", x1: 3.6, z1: zRod + 2.6, x2: 6, z2: 15.5, cls: "thin" });
  items.push({ t: "text", x: 6.5, z: 16, s: `hold-down, ≥ ${devices[0].lb.toLocaleString("en-US")} lb`, cls: "note" });
  items.push({ t: "line", x1: -12, z1: zRod, x2: -12, z2: 15.5, cls: "thin" });
  items.push({ t: "text", x: -12.5, z: 16, s: "½-in. threaded rod", anchor: "end", cls: "note" });
  items.push({ t: "line", x1: -23.4, z1: zRod - 2.6, x2: -23.4, z2: -4.2, cls: "thin" });
  items.push({ t: "text", x: -27, z: -6.6, s: "hold-down on the house joist", cls: "note" });
  items.push({ t: "line", x1: -2.75, z1: -0.5, x2: 12, z2: -4.2, cls: "thin" });
  items.push({ t: "text", x: 12.5, z: -6.6, s: "band · ledger", cls: "note" });
  items.push({ t: "text", x: -11.5, z: 1.8, s: "house floor joist", anchor: "middle", size: 0.8, cls: "note" });
  items.push({ t: "text", x: 16, z: top - jd + 1.4, s: `${f.joistSize} deck joist`, anchor: "middle", size: 0.8, cls: "note" });
  const L = Math.max(...f.ledgers.map((l) => l.x1)) - Math.min(...f.ledgers.map((l) => l.x0));
  const at = devices.map((dv, i) => `LD-${i + 1} at ${ftIn(dv.x)}`).join(", ");
  return {
    title: "Lateral load connection",
    drawing: { box: { x: -30, z: -9, w: 62, h: 28 }, items },
    notes: [
      `${devices.length === 2 ? "Two" : "Four"} ${devices[0].lb.toLocaleString("en-US")}-lb hold-down tension devices (allowable stress), ${devices.length === 2 ? "one" : "two"} within 24 in. of each end of the ${ftIn(L)} ledger — marked on the framing plan: ${at} from the deck's left end. ${RULE.lateral}, Figure R507.9.2(${devices.length === 2 ? 1 : 2}).`,
      "Each device is fastened to a deck joist and, through the ledger and the band, to a house floor joist — or to blocking between the house's first two joists where they run parallel to the ledger — with ½-in. threaded rod, washers and nuts, or the device maker's listed fasteners.",
      `The ledger carries the vertical load (${LEDGER_FASTENER_LABEL[d.ledger.fastener]}); these devices take the deck's pull away from the house. Both are required.`,
    ],
  };
}

/** A short distance in inches ("11 in."), a longer one in feet and inches ("1'-11""). */
const inchesOr = (inches: number) => (inches < 12 ? `${Math.round(inches)} in.` : ftIn(inches));

/** How the roof meets the house: a section through the wall flashing (on the house), or through the gap and the back
 *  gutter (free-standing beside it). Null when it is neither. */
function wallDetail(roof: NonNullable<DeckStructure["roof"]>): DetailDrawing | null {
  const items: DrawItem[] = [];
  if (roof.attach === "wall" && roof.wallFlashing.length) {
    const step = roof.wallFlashing.some((w) => w.kind === "step");
    const apron = roof.wallFlashing.some((w) => w.kind === "apron");
    const kick = roof.wallFlashing.filter((w) => w.kind === "kickout").length;
    // A section square to the wall: the wall on the left, the roof against it — level across a slope (step flashing)
    // or falling away from it (apron).
    const fall = step ? 0 : Math.min(0.6, roof.slope);
    items.push({ t: "rect", x: -8, z: -10, w: 6.5, h: 30, cls: "hatch" });
    items.push({ t: "text", x: -4.75, z: 21.5, s: "house wall", anchor: "middle", cls: "label" });
    items.push({ t: "rect", x: -1.5, z: 2.5, w: 1.5, h: 17.5, cls: "wood" });
    items.push({ t: "text", x: 0.5, z: 17, s: "siding, held 2 in. off the roof", cls: "note" });
    items.push({ t: "line", x1: -1.6, z1: -8, x2: -1.6, z2: 20, cls: "steel" });
    items.push({ t: "poly", pts: [0, -0.9, 30, -0.9 - 30 * fall, 30, -2.4 - 30 * fall, 0, -2.4], cls: "wood", closed: true });
    items.push({ t: "poly", pts: [0, -0.9, 30, -0.9 - 30 * fall, 30, -0.2 - 30 * fall, 0, -0.2], cls: "concrete", closed: true });
    items.push({ t: "text", x: 31, z: -1.5 - 30 * fall, s: "roofing on the sheathing", cls: "note" });
    // The L: 4 in. up the wall behind the house wrap, 4 in. out over the roofing.
    items.push({ t: "line", x1: 0.15, z1: 4, x2: 0.15, z2: 0, cls: "steel" });
    items.push({ t: "line", x1: 0.15, z1: 0, x2: 4.2, z2: -4 * fall, cls: "steel" });
    items.push({ t: "text", x: 5.5, z: 6.5, s: step ? "step flashing 4 × 4 in., one per course" : "apron (L) flashing 4 × 4 in.", cls: "note" });
    items.push({ t: "dim", x1: 2, z1: 0, x2: 2, z2: 4, label: "4 in. up" });
    return {
      title: "Roof at the house wall",
      drawing: { box: { x: -12, z: -26, w: 72, h: 52 }, items },
      notes: [
        `${apron ? "Apron (L) flashing along the roof's top edge" : ""}${apron && step ? "; " : ""}${step ? "step flashing up each sloped edge, one piece woven in with every course" : ""}: 4 in. up the wall behind the house wrap, 4 in. over the roofing. The siding is cut back to stand 2 in. off the roof and counter-flashes it. IRC R903.2.`,
        ...(kick ? [`Kickout flashing where each eave meets the wall (${kick}): it turns the water off the step flashing into the gutter, not down the siding. IRC R903.2.1.`] : []),
        "Water at the wall runs off to the sides and down to the gutters; none runs behind the siding.",
      ],
    };
  }
  const g = roof.houseGap;
  if (!g) return null;
  // A section square to the wall through the back eave: the wall, the gap, the gutter, the fascia, the roof rising to the posts.
  const gw = g.gutter ? Math.max(0, g.eaveIn - g.clearIn - 2.5) : 0;
  const eave = g.eaveIn;
  const sl = Math.min(0.6, roof.slope);
  items.push({ t: "rect", x: -8, z: -30, w: 8, h: 50, cls: "hatch" });
  items.push({ t: "text", x: -4, z: 22, s: "house wall", anchor: "middle", cls: "label" });
  items.push({ t: "poly", pts: [eave - 1.2, 0, eave + 40, 40 * sl, eave + 40, 40 * sl + 1.4, eave - 1.2, 1.4], cls: "concrete", closed: true });
  items.push({ t: "poly", pts: [eave, -5.5, eave + 40, 40 * sl - 5.5, eave + 40, 40 * sl, eave, 0], cls: "wood", closed: true });
  items.push({ t: "rect", x: eave - 2.25, z: -7.5, w: 2.25, h: 7.5, cls: "wood" });
  items.push({ t: "text", x: eave + 14, z: 40 * sl + 6, s: "roof, rising to the header and posts", cls: "note" });
  if (g.gutter) {
    const x0 = g.clearIn;
    items.push({ t: "poly", pts: [x0, -1, x0, -6, x0 + gw * 0.6, -6, x0 + gw, -3.5, x0 + gw, -1], cls: "steel", closed: false });
    items.push({ t: "text", x: eave + 2, z: -10.5, s: "← back gutter, to the downspouts", cls: "note" });
    items.push({ t: "dim", x1: 0, z1: -14, x2: x0, z2: -14, label: `${g.clearIn} in. clear` });
  } else {
    items.push({ t: "text", x: eave / 2, z: -10, s: "no gutter: the drip falls here", anchor: "middle", cls: "note" });
  }
  items.push({ t: "dim", x1: 0, z1: -20, x2: g.postsIn, z2: -20, label: `${ftIn(g.postsIn)} to the post line` });
  return {
    title: "Roof beside the house wall",
    drawing: { box: { x: -12, z: -26, w: Math.max(72, g.postsIn + 16), h: 52 }, items },
    notes: [
      `Free-standing: nothing is fastened to the house. The back posts stand ${ftIn(g.postsIn)} off the wall, so the back eave stops ${inchesOr(g.eaveIn)} from it${g.gutter ? ` and its gutter hangs in the gap, ${g.clearIn} in. clear of the siding` : ""}.`,
      g.gutter ? "The back slope drains to that gutter and its downspouts — never down the siding or into the foundation." : "Without a gutter the back slope drips into the gap beside the foundation: add a gutter, or hang the roof on the house and flash it. IRC R801.3.",
    ],
  };
}

/** The roof's own details beyond the rafter seat: the uplift path down to the footing, and the bracing a free-standing roof stands on. */
export function roofDetails(s: DeckStructure, windMph: number | null): DetailDrawing[] {
  const roof = s.roof;
  if (!roof) return [];
  const out: DetailDrawing[] = [...detailDrawings(s, "roof")];
  // The uplift path: tie → header → post cap → post → post base → footing.
  const items: DrawItem[] = [];
  items.push({ t: "line", x1: -18, z1: 0, x2: 30, z2: 0, cls: "grade" });
  items.push({ t: "rect", x: -6, z: -14, w: 12, h: 14, cls: "concrete" });
  items.push({ t: "rect", x: -3.6, z: 1, w: 7.2, h: 1.2, cls: "steel" });
  items.push({ t: "rect", x: -2.75, z: 2.2, w: 5.5, h: 40, cls: "wood" });
  items.push({ t: "rect", x: -3.6, z: 42.2, w: 7.2, h: 1.2, cls: "steel" });
  items.push({ t: "rect", x: -12, z: 43.4, w: 24, h: 9.25, cls: "wood" });
  items.push({ t: "poly", pts: [-18, 50, 26, 58, 26, 63.5, -18, 55.5], cls: "wood", closed: true });
  items.push({ t: "rect", x: 2, z: 51, w: 1.6, h: 6, cls: "steel" });
  items.push({ t: "text", x: 6, z: 61, s: "1 · hurricane tie at every rafter", cls: "note" });
  items.push({ t: "text", x: 13, z: 47, s: "2 · post cap / strap to the header", cls: "note" });
  items.push({ t: "text", x: 5, z: 22, s: "3 · post", cls: "note" });
  items.push({ t: "text", x: 5, z: 3, s: "4 · uplift-rated post base", cls: "note" });
  items.push({ t: "text", x: 8, z: -8, s: "5 · footing, anchor cast in", cls: "note" });
  out.push({
    title: "Uplift path",
    drawing: { box: { x: -22, z: -18, w: 74, h: 86 }, items },
    notes: [
      `The roof's uplift runs tie → header → post cap → post → post base → footing; every link is a listed connector, none is toe-nailed.${windMph ? ` Sized for the ${windMph} mph design wind speed from the connector maker's tables.` : ""} IRC R802.11.`,
      "Post bases are the uplift-rated kind, anchored into the footing's concrete (a wet-set or an epoxy anchor), not a standoff that only sits on it.",
      ...(windMph && windMph >= 130 ? [`At ${windMph} mph the IRC's own provisions stop for the roof (R301.2.1.1): its wind design follows the WFCM, ICC 600 or ASCE 7 — an engineer's letter may be asked for.`] : []),
    ],
  });
  // AT THE HOUSE WALL (owner, 2026-11-07): how the roof meets the house — flashed when it hangs on it, a gap with the
  // back gutter in it when it stands free beside it.
  const wall = wallDetail(roof);
  if (wall) out.push(wall);
  if (roof.attach !== "wall") {
    const b: DrawItem[] = [];
    b.push({ t: "rect", x: 0, z: 0, w: 5.5, h: 44, cls: "wood" });
    b.push({ t: "rect", x: 40, z: 0, w: 5.5, h: 44, cls: "wood" });
    b.push({ t: "rect", x: -6, z: 44, w: 57.5, h: 9.25, cls: "wood" });
    // A knee brace runs from its own post up to the header beside it — 45°, about 14 in. each way, never across the span.
    b.push({ t: "poly", pts: [5.5, 30, 19.5, 44, 17.5, 45.2, 4.3, 32], cls: "wood", closed: true });
    b.push({ t: "poly", pts: [40, 30, 26, 44, 28, 45.2, 41.2, 32], cls: "wood", closed: true });
    b.push({ t: "line", x1: -10, z1: 0, x2: 56, z2: 0, cls: "grade" });
    b.push({ t: "text", x: 22.75, z: 16, s: "knee braces, 45°, both ways", anchor: "middle", cls: "note" });
    b.push({ t: "text", x: 22.75, z: 56.5, s: "header", anchor: "middle", cls: "label" });
    out.push({
      title: roof.kind === "pergola" ? "Pergola bracing" : "Roof bracing",
      drawing: { box: { x: -14, z: -6, w: 74, h: 66 }, items: b },
      notes: [
        `A roof that stands on its own posts braces itself both ways: 4x4 knee braces at 45° from each post to the header, ½-in. lag or through-bolt each end (${roof.posts.length} posts). ${RULE.bracing}.`,
        "The braces are the roof's lateral system; with no house wall to lean on, none of them may be left out.",
      ],
    });
  }
  return out;
}

/**
 * The general notes a plan reviewer reads on sheet A1: how it is built, with
 * the rule each line rests on — construction notes, not the estimate's
 * assumptions (those stay on the proposal). The county's own deck rules, when
 * it is on file, follow as "Local".
 */
export function permitNotes(s: DeckStructure, local: string[] = [], edition: string | null = null): string[] {
  const out: string[] = [];
  const d = s.design;
  const f = s.frame;
  const code = s.code;
  // The county's own edition when it is on file (lib/deck/countyCodes), else the state's.
  out.push(`All work to the ${edition ?? code.name} and the local amendments; the building department's review and inspections govern.`);
  if (f) {
    out.push(`Framing lumber: ${f.species.label}, No. 2 or better. Preservative-treated per AWPA U1 — ground-contact for posts and anything within 6 in. of the soil, above-ground elsewhere (${RULE.treatment}).`);
    out.push(`Fasteners and connectors hot-dip galvanized or stainless steel${d.extras.stainless ? " — stainless throughout here (within 300 ft of salt water)" : ""}; connectors installed with the maker's listed fasteners (${RULE.fasteners}).`);
    const poured = f.posts.filter((p) => p.footing.type === "poured");
    if (poured.length) out.push(`Footings on undisturbed soil, the bottom at least ${Math.min(...poured.map((p) => p.footing.depthIn))} in. below grade${d.placement === "attached" || d.footing.frostAlways ? ` (frost line ${d.frostIn} in.)` : ""}, sized for ${d.soilPsf.toLocaleString("en-US")} psf presumptive bearing; the inspector sees the holes before the concrete (${RULE.footing}; ${RULE.footingDepth}).`);
    else out.push(`Precast pier blocks on compacted gravel — a free-standing deck only (${RULE.pierBlock}).`);
    if (d.placement === "attached" && f.ledgers.length) {
      out.push(`Ledger: ${LEDGER_FASTENER_LABEL[d.ledger.fastener]} into the house band, two staggered rows at ${f.ledgers[0].spacingIn} in.; flashed over the top; never to brick veneer, a cantilevered floor or a hollow wall (${RULE.ledger}; ${RULE.ledgerWall}).`);
      const devices = lateralDevices(f);
      if (devices.length) out.push(`Lateral load connection: ${devices.length} hold-down tension devices of at least ${devices[0].lb.toLocaleString("en-US")} lb, within 24 in. of each end of the deck — LD-1 and LD-2 on the framing plan, detail 2/S-501 (${RULE.lateral}).`);
    } else out.push(`Free-standing: the deck stands on its own posts and beams, braced both ways at the posts — detail 7/S-501 (${RULE.selfSupporting}; ${RULE.bracing}).`);
    out.push(`Joists ${f.joistSize} at ${f.spacingIn} in. on center; a hanger at every joist end on a ledger or a flush beam, a tie at every joist on a dropped beam (${RULE.hangers}; ${RULE.restraint}).`);
    out.push(`Posts ${d.framing.post} in metal post bases and caps; beams bear fully on the posts, never toe-nailed (${RULE.post}; ${RULE.beam}).`);
    out.push(`Decking: ${f.decking.label}, fastened to its maker's instructions; joist spacing ${f.spacingIn} in. (the boards allow ${f.deckingMaxSpacingIn} in.) (${RULE.decking}).`);
  }
  if (s.rails.on) out.push(`Guards ${s.rails.heightIn} in. high where the walking surface is more than 30 in. above grade; no opening passes a 4-in. sphere; guard posts through-bolted to the rim and blocked; the top rail resists 200 lb (${RULE.guard}; IRC Table R301.5).`);
  if (s.stairs.length) out.push(`Stairs: risers no more than ${code.riserMaxIn} in., treads at least ${code.treadMinIn} in., uniform within ⅜ in.; a graspable handrail 34–38 in. high on any stair of four or more risers; a light at the stairs (${RULE.stairs}; IRC R303.8).`);
  if (s.electrical.on) out.push("Receptacles GFCI-protected and weather-resistant, in-use covers; wiring by a licensed electrician, under its own permit where the jurisdiction requires one (NEC 210.8, 406.9).");
  if (s.roof && s.roof.kind !== "pergola") out.push(`Roof framing per the roof framing plan, ${f ? "S-103" : "S-101"}: ${s.roof.trusses ? "manufactured trusses to the truss maker's stamped drawings" : `${s.roof.rafters.size} rafters at ${s.roof.rafters.spacingIn} in.`}, a hurricane tie at every rafter or truss, uplift-rated post bases (IRC R802.11).`);
  if (s.roof && s.roof.kind === "pergola") out.push(`Pergola per its framing plan, ${f ? "S-103" : "S-101"}: open slats, no roof covering; posts braced both ways (${RULE.bracing}).`);
  out.push("Call 811 at least two business days before digging, so the utility lines are marked.");
  for (const l of local) out.push(`Local: ${l}`);
  return out;
}

export interface MaterialGroup {
  step: BomStep;
  label: string;
  lines: Array<{ label: string; qty: number; unit: string; note: string | null; byClient: boolean }>;
}

/** The material list by step, as the yard counts it. */
export function materialSchedule(pkg: DeckPackage): MaterialGroup[] {
  const groups = new Map<BomStep, MaterialGroup>();
  for (const l of pkg.bom) {
    const g = groups.get(l.step) ?? { step: l.step, label: BOM_STEP_LABEL[l.step] ?? l.step, lines: [] };
    g.lines.push({ label: l.label, qty: l.qty, unit: l.unit, note: l.note ?? null, byClient: !!l.byClient });
    groups.set(l.step, g);
  }
  return [...groups.values()];
}
