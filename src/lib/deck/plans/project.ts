// ELEVATIONS AND THE BUILDING SECTION, FROM THE 3D (2026-10-23) — pure. The
// studio's scene (lib/deck/scene: every member as a box, the sloped ones with
// their real saw cuts) seen square from a side, or cut by a plane:
//   · an elevation paints every member far to near, each filled white and
//     outlined, so what is behind is hidden the way a drafter hides it;
//   · a section through the deck draws what the plane cuts heavy — wood cut
//     across its grain with the X — and what lies beyond it light, against
//     the earth and the concrete of the footing under it.
// Model inches; the sheet's y is −height.
import { SCENE_LAYERS, type DeckScene, type SceneLayer } from "../scene";
import { boxSolid, type V3 } from "../iso";
import { Sketch, ftInFrac, inFrac, itemsBox, type ArchScale, type Fill, type Pen, type View } from "./draft";
import type { PlanModel } from "./model";
import { beamLabel } from "./model";

type Solid = { layer: SceneLayer; role: string; pts: V3[]; faces: V3[][] };

const SKIP = new Set<SceneLayer | string>(["footing", "wire", "hardware", "light"]);
const PEN_OF: Partial<Record<SceneLayer, Pen>> = { post: "medium", beam: "medium", ledger: "medium", rim: "medium", fascia: "medium", "roof-post": "medium", header: "medium", decking: "light", joist: "light", blocking: "light", brace: "light", stair: "light", rail: "light", slab: "light", trim: "light", gutter: "light", rafter: "light", ridge: "light", roofing: "light", sheathing: "light", ceiling: "light" };

/** The scene's members as solids in inches (x along the house, y out, z up). */
export function sceneSolids(scene: DeckScene): Solid[] {
  const out: Solid[] = [];
  scene.boxes.forEach((b, i) => {
    const layer = SCENE_LAYERS[b[0]];
    if (!layer || SKIP.has(layer)) return;
    const tag = scene.tags[i];
    const role = tag != null && tag >= 0 ? scene.legend[tag]?.role ?? "" : "";
    const faces = boxSolid(b, role).map((f) => f.map((v) => [v[0] * 12, v[1] * 12, v[2] * 12] as V3));
    const pts: V3[] = [];
    for (const f of faces) for (const v of f) if (!pts.some((q) => Math.abs(q[0] - v[0]) + Math.abs(q[1] - v[1]) + Math.abs(q[2] - v[2]) < 1e-6)) pts.push(v);
    out.push({ layer, role, pts, faces });
  });
  return out;
}

/** The 2-D convex hull (monotone chain), as a flat ring. */
function hull(points: Array<[number, number]>): number[] {
  const pts = points.map((p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts.flat();
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper].flat();
}

export type ElevationSide = "front" | "left" | "right";
export const ELEVATION_NAME: Record<ElevationSide, string> = { front: "Front elevation, from the yard", left: "Left side elevation", right: "Right side elevation" };

/**
 * An elevation of the whole structure: the house behind, every member painted far to near, the footings hidden
 * below the grade, the level datums down the side and the dimensions a reviewer checks.
 */
export function elevationView(m: PlanModel, scene: DeckScene, side: ElevationSide, sc: ArchScale): View {
  const k = new Sketch(sc.k);
  const p = (v: number) => k.p(v);
  const { f, W, D } = m;
  // Screen u along the view, depth toward the viewer.
  const U = (v: V3) => (side === "front" ? v[0] : side === "left" ? v[1] : D - v[1]);
  const depth = (v: V3) => (side === "front" ? v[1] : side === "left" ? -v[0] : v[0]);
  // ROUND THE HOUSE'S CORNER (2026-11-14). Seen from the side the deck runs back along, the house's side wall stands
  // behind that part. Seen from the other side, the part beside the house's FAR wall is behind the house: the members
  // out there are painted first, the house's wall over them, and the rest of the deck in front of it.
  const ends = m.houseEnds;
  const wrapHere = !m.house ? 0 : side === "left" ? (ends.x0 !== null ? ends.wrapLeftIn : 0) : side === "right" ? (ends.x1 !== null ? ends.wrapRightIn : 0) : 0;
  const wrapFar = !m.house ? 0 : side === "left" ? (ends.x1 !== null ? ends.wrapRightIn : 0) : side === "right" ? (ends.x0 !== null ? ends.wrapLeftIn : 0) : 0;
  const pastFar = (pts: V3[]) => wrapFar > 0 && (side === "left" ? pts.every((v) => v[0] > (ends.x1 as number) - 1) : pts.every((v) => v[0] < (ends.x0 as number) + 1));
  const solids = sceneSolids(scene).map((sd) => ({ sd, d: sd.pts.reduce((a, v) => a + depth(v), 0) / sd.pts.length })).sort((a, b) => a.d - b.d);
  const us = solids.flatMap((x) => x.sd.pts.map(U));
  let u0 = Math.min(...us, side === "front" ? 0 : 0);
  let u1 = Math.max(...us, side === "front" ? W : D);

  /** The house's side wall in a side view of a deck that goes round its corner: from the house line back past the deck's end. */
  const sideWall = () => {
    const reach = Math.max(wrapHere, wrapFar) + 24;
    return side === "left" ? { from: -reach, to: 0 } : { from: D, to: D + reach };
  };
  const paintSideWall = () => {
    const { from, to } = sideWall();
    const h = f.surfaceIn + (m.s.rails.on ? m.s.rails.heightIn : 0) + 26;
    k.rect(from, -h, to - from, h, "light", "house");
    for (let z = 8; z < h - 4; z += 8) k.line(from, -z, to, -z, "fine");
    k.text(side === "left" ? from + p(0.12) : to - p(0.12), -h + p(0.2), "EXISTING HOUSE", "sm", { anchor: side === "left" ? "start" : "end", bold: true, tone: "muted" });
  };

  // ── The house behind (front view) or beside (side views).
  // The house drawn to a little over the guard, broken off there.
  const houseH = f.surfaceIn + (m.s.rails.on ? m.s.rails.heightIn : 0) + 26;
  if (m.house) {
    if (side === "front") {
      // (The house ends at its corner where the deck runs past it. 2026-11-14.)
      const hx0 = m.houseEnds.x0 ?? Math.min(u0, -24);
      const hx1 = m.houseEnds.x1 ?? Math.max(u1, W + 24);
      u0 = Math.min(u0, hx0);
      u1 = Math.max(u1, hx1);
      k.rect(hx0, -houseH, hx1 - hx0, houseH, "light", "house");
      // Siding courses, and the break line at the top.
      for (let z = 8; z < houseH - 4; z += 8) k.line(hx0, -z, hx1, -z, "fine");
      k.text(hx0 + p(0.12), -houseH + p(0.2), "EXISTING HOUSE", "sm", { bold: true, tone: "muted" });
    } else if (wrapHere > 0 || wrapFar > 0) {
      // The house's side wall: behind the part of the deck that runs back beside it — painted now — or over the part
      // beside its far wall, painted below once those members are down.
      u0 = Math.min(u0, sideWall().from);
      u1 = Math.max(u1, sideWall().to);
      if (wrapFar <= 0) paintSideWall();
    } else {
      const wx = side === "left" ? -10 : D;
      const ww = 10;
      k.rect(wx, -houseH, ww, houseH, "heavy", "poche");
      u0 = Math.min(u0, wx);
      u1 = Math.max(u1, wx + ww);
      k.text(wx + (side === "left" ? -p(0.06) : ww + p(0.06)), -houseH + p(0.25), "EXISTING HOUSE", "sm", { anchor: side === "left" ? "end" : "start", bold: true, tone: "muted" });
    }
  }

  // ── Every member, far to near. (Round the house's far corner: what stands out there first, the house over it.)
  const paint = (sd: (typeof solids)[number]["sd"]) => {
    const ring = hull(sd.pts.map((v) => [U(v), -v[2]] as [number, number]));
    if (ring.length < 6) return;
    const pen: Pen = /baluster|picket|cable/.test(sd.role) ? "fine" : PEN_OF[sd.layer] ?? "light";
    const fill: Fill = sd.layer === "slab" ? "concrete" : sd.layer === "rail" && /glass/.test(sd.role) ? "glass" : "paper";
    k.poly(ring, pen, fill);
  };
  if (wrapFar > 0 && side !== "front") {
    for (const { sd } of solids) if (pastFar(sd.pts)) paint(sd);
    paintSideWall();
    for (const { sd } of solids) if (!pastFar(sd.pts)) paint(sd);
  } else for (const { sd } of solids) paint(sd);

  // ── The ground, and the footings below it (hidden).
  const deepest = Math.max(12, ...m.posts.map((pp) => pp.post.footing.depthIn));
  const g0 = u0 - p(0.25);
  const g1 = u1 + p(0.25);
  k.rect(g0, 0, g1 - g0, p(0.08), null, "earth");
  k.line(g0, 0, g1, 0, "heavy");
  for (const pp of m.posts) {
    const ft = pp.post.footing;
    const u = side === "front" ? pp.post.x : side === "left" ? pp.post.y : D - pp.post.y;
    if (ft.type === "poured") {
      k.rect(u - ft.pierIn / 2, -ft.topIn, ft.pierIn, ft.depthIn - ft.padThickIn + ft.topIn, "hidden", "none");
      k.rect(u - ft.padIn / 2, ft.depthIn - ft.padThickIn, ft.padIn, ft.padThickIn, "hidden", "none");
    }
  }

  // ── Level datums down the right side, and the heights on the left.
  const guardTop = m.s.rails.on ? f.surfaceIn + m.s.rails.heightIn : null;
  const hx = u0 - p(0.2);
  const chainZ = [0, f.surfaceIn, ...(guardTop ? [guardTop] : [])];
  k.chain(chainZ.map((z) => [hx, -z] as [number, number]), 0.3);
  // The width (front) or the depth (sides) under it all.
  const bottom = deepest + p(0.3);
  if (side === "front") k.dim(0, bottom, W, bottom, -0.2);
  else k.dim(side === "left" ? 0 : 0, bottom, D, bottom, -0.2);

  // ── What each thing is.
  // The post nearest the viewer's left, named out to the left of the drawing.
  const post = [...m.posts].sort((a, b) => (side === "front" ? a.post.x - b.post.x : side === "left" ? b.post.y - a.post.y : a.post.y - b.post.y))[0]?.post;
  if (post) {
    const u = side === "front" ? post.x : side === "left" ? post.y : D - post.y;
    k.leader(u - 3, -(post.heightIn * 0.5 + post.footing.topIn), u0 - p(0.15), -(post.heightIn * 0.5 + post.footing.topIn) + p(0.12), [`${post.size} P.T. POST (P1)`], "dot", "sm");
  }
  if (side === "front") {
    k.leader(W * 0.12, -(f.surfaceIn - 0.5), W * 0.12 - p(0.35), -(f.surfaceIn + p(0.55)), [f.decking.label.toUpperCase().split(" — ")[0] + " DECKING"], "dot", "sm");
    if (m.s.rails.on) k.leader(W * 0.82, -(f.surfaceIn + m.s.rails.heightIn - 2), W * 0.82 + p(0.4), -(f.surfaceIn + m.s.rails.heightIn + p(0.35)), [`${m.s.rails.heightIn}" ${m.s.rails.label.toUpperCase()} GUARD`], "dot", "sm");
    const front = [...f.beams].sort((a, b) => b.y - a.y)[0];
    if (front) k.leader(front.x0 + (front.x1 - front.x0) * 0.62, -(front.bottomIn + front.spec.depthIn / 2), front.x0 + (front.x1 - front.x0) * 0.62 + p(0.5), -(front.bottomIn - p(0.35)), [`${beamLabel(front)} BEAM (${m.beamTag.get(front.id) ?? "B1"})`], "dot", "sm");
  }
  m.s.stairs.forEach((st, i) => {
    if (st.level !== "upper" || st.kind !== "flight") return;
    const fp = st.footprint;
    if (!fp.length) return;
    const us2 = fp.map((q) => (side === "front" ? q.x : side === "left" ? q.y : D - q.y));
    const guardTop = f.surfaceIn + (m.s.rails.on ? m.s.rails.heightIn : 0);
    if (side === "front" || st.design.side !== "front") {
      // Seen face on: the label above the guard, the leader down to the treads.
      const um = (Math.min(...us2) + Math.max(...us2)) / 2;
      k.leader(um + 4, -(f.surfaceIn * 0.45), um + p(0.55), -(guardTop + p(0.28)), [`STAIR ${i + 1}: ${st.risers} RISERS @ ${inFrac(st.riserIn)}`], "dot", "sm");
    } else {
      // In profile: on the stringer, six-tenths of the way down, the label out beyond the stair.
      const top = side === "left" ? Math.min(...us2) : Math.min(...us2);
      const run = Math.max(...us2) - Math.min(...us2);
      const u = top + run * 0.45;
      k.leader(u, -(f.surfaceIn * 0.55), u + p(0.6), -(guardTop + p(0.1)), [`STAIR ${i + 1}: ${st.risers} RISERS @ ${inFrac(st.riserIn)}`], "dot", "sm");
    }
  });
  // The level datums last, past every label, so no leader's words run into them.
  const dx = Math.max(u1 + p(0.45), itemsBox(k.items, k.scale).x1 + p(0.3));
  if (guardTop) k.datum(dx, -guardTop, "T.O. GUARD", `+${ftInFrac(guardTop, 8)}`);
  k.datum(dx, -f.surfaceIn, "T.O. DECK", `+${ftInFrac(f.surfaceIn, 8)}`);
  k.datum(dx, 0, "GRADE", `0'-0"`);
  k.datum(dx, deepest, "B.O. FOOTING", `-${ftInFrac(deepest, 8)}`);
  return k.view(`elev-${side}`, ELEVATION_NAME[side], sc.label);
}

/**
 * The building section: a plane through the deck at `xCut` (inches along the house — the line of a post), looking
 * along the house. What it cuts, heavy; what is beyond it, light; the footing it stands on, the earth around it.
 */
export function sectionView(m: PlanModel, scene: DeckScene, xCut: number, sc: ArchScale): View {
  const k = new Sketch(sc.k);
  const p = (v: number) => k.p(v);
  const { f, D } = m;
  const d = m.s.design;
  const solids = sceneSolids(scene);
  // ROUND THE HOUSE'S CORNER (2026-11-14): beyond the cut, the part of the deck that runs back beside the house's far
  // wall is behind the house — what lies wholly there is left out, and what crosses the house line is covered there.
  const farWrapIn = m.house && m.houseEnds.x1 !== null && m.houseEnds.wrapRightIn > 0 && xCut < m.houseEnds.x1 ? m.houseEnds.wrapRightIn : 0;
  const behindWall = (sd: Solid) => farWrapIn > 0 && sd.pts.every((v) => v[1] < -1 && v[0] > (m.houseEnds.x1 as number) - 1);
  const beyond: Array<{ sd: Solid; d: number }> = [];
  const cut: Solid[] = [];
  for (const sd of solids) {
    const xs = sd.pts.map((v) => v[0]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    if (x1 < xCut - 0.01) continue;
    // The stairs (and anything past the deck's front) are drawn in their own section.
    if (sd.layer === "stair" || /stair/.test(sd.role) || Math.min(...sd.pts.map((v) => v[1])) > D + 2 || (sd.layer === "rail" && Math.max(...sd.pts.map((v) => v[1])) > D + 4)) continue;
    if (x0 <= xCut && x1 >= xCut) cut.push(sd);
    else if (!behindWall(sd)) beyond.push({ sd, d: x0 });
  }
  beyond.sort((a, b) => b.d - a.d);
  const post = m.posts.reduce((best, pp) => (Math.abs(pp.post.x - xCut) < Math.abs(best.post.x - xCut) ? pp : best), m.posts[0]);
  const ft = post?.post.footing;
  const deepest = Math.max(12, ft?.depthIn ?? 12);
  const zTop = Math.max(f.surfaceIn + (m.s.rails.on ? m.s.rails.heightIn : 0), f.surfaceIn) + 18;
  const uMax = Math.max(D + 24, ...beyond.flatMap((x) => x.sd.pts.map((v) => v[1])), ...cut.flatMap((sd) => sd.pts.map((v) => v[1])));

  // ── The earth, cut; the house wall.
  k.rect(-30, 0, uMax + 30 + p(0.2), deepest + 10, null, "earth");
  if (m.house) {
    k.rect(-10, -(zTop + 12), 10, zTop + 12 + deepest + 10, "cut", "poche");
    k.text(-12, -(zTop + 4), "EXISTING HOUSE", "sm", { anchor: "end", bold: true, tone: "muted" });
  }

  // ── Beyond the cut, far to near: light.
  for (const { sd } of beyond) {
    const ring = hull(sd.pts.map((v) => [v[1], -v[2]] as [number, number]));
    if (ring.length >= 6) k.poly(ring, /baluster|picket|cable/.test(sd.role) ? "fine" : "light", "paper");
  }
  if (farWrapIn > 0) {
    // The house, cut open, hides what crosses behind its line: blank there, and the wall again over it.
    k.rect(-(farWrapIn + 30), -(zTop + 12), farWrapIn + 20, zTop + 12, null, "paper");
    k.rect(-10, -(zTop + 12), 10, zTop + 12 + deepest + 10, "cut", "poche");
    k.text(-12, -(zTop + 4), "EXISTING HOUSE", "sm", { anchor: "end", bold: true, tone: "muted" });
  }
  // ── The footing, cut.
  if (ft && ft.type === "poured" && post) {
    const y = post.post.y;
    k.rect(y - ft.padIn / 2, ft.depthIn - ft.padThickIn, ft.padIn, ft.padThickIn, "cut", "concrete");
    k.rect(y - ft.pierIn / 2, -ft.topIn, ft.pierIn, ft.depthIn - ft.padThickIn + ft.topIn, "cut", "concrete");
  }
  // ── What the plane cuts: heavy, wood across the grain marked with the X.
  for (const sd of cut) {
    const ring = planeSection(sd, xCut);
    if (ring.length < 6) continue;
    const ex = Math.max(...sd.pts.map((v) => v[0])) - Math.min(...sd.pts.map((v) => v[0]));
    const ey = Math.max(...sd.pts.map((v) => v[1])) - Math.min(...sd.pts.map((v) => v[1]));
    const ez = Math.max(...sd.pts.map((v) => v[2])) - Math.min(...sd.pts.map((v) => v[2]));
    const acrossGrain = ex >= ey && ex >= ez;
    const fill: Fill = sd.layer === "slab" ? "concrete" : acrossGrain && ring.length === 8 && sd.layer !== "decking" ? "woodCut" : "wood";
    k.poly(ring, sd.layer === "decking" || /baluster/.test(sd.role) ? "medium" : "cut", fill);
  }
  // The grade line over it all.
  k.line(-30, 0, uMax + p(0.2), 0, "heavy");

  // ── The names of the parts.
  const L = (x: number, z: number, tx: number, tz: number, lines: string[]) => k.leader(x, -z, tx, -tz, lines, "dot", "sm");
  const jt = f.joistTopIn;
  const jb = f.joistBottomIn;
  const front = [...f.beams].sort((a, b) => b.y - a.y)[0];
  L(Math.min(D * 0.3, 40), f.surfaceIn - 0.4, Math.min(D * 0.3, 40) + p(0.3), f.surfaceIn + p(0.55), [f.decking.label.split(" — ")[0].toUpperCase() + " DECKING", `ON ${f.joistSize} P.T. JOISTS @ ${f.spacingIn}" O.C. (J1)`]);
  if (m.attached) {
    L(0.75, (jt + jb) / 2, p(0.55), jb - p(0.55), [`${f.joistSize} P.T. LEDGER (L1), FLASHED`, `${f.ledgers[0]?.fasteners ?? ""} LAGS @ ${f.ledgers[0]?.spacingIn ?? 16}" O.C., STAGGERED`, "SEE 1/S-501"]);
  }
  if (front) {
    const bz = front.style === "flush" ? jb : jb - front.spec.depthIn;
    L(front.y + front.spec.thickIn / 2, bz + front.spec.depthIn / 2, front.y + p(0.7), bz + front.spec.depthIn / 2 + p(0.25), [`${beamLabel(front)} BEAM (${m.beamTag.get(front.id) ?? "B1"})`, "POST CAP, SEE 3/S-501"]);
  }
  if (post && ft) {
    const y = post.post.y;
    L(y + 3, ft.topIn + post.post.heightIn * 0.5, y + p(0.75), ft.topIn + post.post.heightIn * 0.55, [`${post.post.size} P.T. POST (P1)`, "ON STANDOFF POST BASE"]);
    if (ft.type === "poured") {
      L(y + ft.pierIn / 2, -(ft.depthIn - ft.padThickIn) / 2, y + p(0.75), -(ft.depthIn - ft.padThickIn) / 2 + p(0.05), [`${inFrac(ft.pierIn)} Ø CONCRETE PIER`]);
      L(y + ft.padIn / 2, -ft.depthIn + ft.padThickIn / 2, y + p(0.75), -ft.depthIn + ft.padThickIn / 2 - p(0.1), [`${inFrac(ft.padIn)} Ø × ${inFrac(ft.padThickIn)} PAD (${post.tag})`, "ON UNDISTURBED SOIL"]);
    }
  }
  if (m.s.rails.on) {
    L(D - 1, f.surfaceIn + m.s.rails.heightIn - 3, D + p(0.45), f.surfaceIn + m.s.rails.heightIn + p(0.2), [`${m.s.rails.heightIn}" ${m.s.rails.label.toUpperCase()} GUARD`, "SEE 4/S-501"]);
  }

  // ── Dimensions: the deck's height, the joist span and the overhang, the guard, the footing's depth.
  const left = m.house ? -p(0.35) : -p(0.15);
  k.dim(left, 0, left, -f.surfaceIn, 0.18, ftInFrac(f.surfaceIn, 8));
  if (m.s.rails.on) k.dim(D + p(0.15), -f.surfaceIn, D + p(0.15), -(f.surfaceIn + m.s.rails.heightIn), -0.18, inFrac(m.s.rails.heightIn));
  if (front) {
    const top = -(zTop - 6);
    // (The beams the cut passes over — 2026-11-14: a part past the house's corner, an L's other leg have beams of their own.)
    const ys = [0, ...f.beams.filter((b) => xCut >= b.x0 - 0.5 && xCut <= b.x1 + 0.5).map((b) => b.y).sort((a, b) => a - b), D];
    k.chain(ys.map((y) => [y, top] as [number, number]), 0.12);
  }
  if (ft && post) {
    const y = post.post.y - Math.max(ft.padIn / 2, 6) - p(0.25);
    k.dim(y, 0, y, ft.depthIn, -0.12, `${inFrac(ft.depthIn)} MIN.`);
  }
  const dx = Math.max(uMax + p(0.4), itemsBox(k.items, k.scale).x1 + p(0.3));
  k.datum(dx, -f.surfaceIn, "T.O. DECK", `+${ftInFrac(f.surfaceIn, 8)}`);
  k.datum(dx, 0, "GRADE", `0'-0"`);
  k.datum(dx, deepest, "FROST", `-${inFrac(d.frostIn)}`);
  return k.view("section", "Building section", sc.label);
}

/** A solid cut by the plane x = c: the polygon of its section, in (y, −z). */
function planeSection(sd: Solid, c: number): number[] {
  const pts: Array<[number, number]> = [];
  for (const face of sd.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      if ((a[0] - c) * (b[0] - c) <= 0 && Math.abs(b[0] - a[0]) > 1e-9) {
        const t = (c - a[0]) / (b[0] - a[0]);
        pts.push([a[1] + (b[1] - a[1]) * t, -(a[2] + (b[2] - a[2]) * t)]);
      } else if (Math.abs(a[0] - c) < 1e-9) pts.push([a[1], -a[2]]);
    }
  }
  return hull(pts);
}
