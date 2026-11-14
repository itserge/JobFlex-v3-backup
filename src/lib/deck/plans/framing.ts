// THE DECK FRAMING PLAN (2026-10-23) — pure. Not a sketch of the frame: every
// piece the engine cut (lib/deck/frame's sticks — each joist, rim, ledger,
// beam, block and brace in its real plan box, the rims turned at a clipped
// corner), the stairs' stringers and treads, the guard posts, drawn to scale;
// keyed by tag to the framing schedule (J1 joists, R1 rim, L1 ledger, B1…
// beams, P1 posts, BK blocking, LD lateral devices); sent by detail bubbles
// to the details on S-501 and by the section cut to S-301; dimensioned the
// way a crew lays it out.
import { orientedRect, flat, centroid, type V2 } from "./geom";
import { Sketch, type ArchScale, type View, type Pen, type Fill } from "./draft";
import type { PlanModel } from "./model";
import { lateralDevices } from "../permit";

export interface FramingRefs {
  /** Detail numbers on S-501, by what they show. */
  ledger?: number;
  lateral?: number;
  post?: number;
  guard?: number;
  stair?: number;
  beam?: number;
  /** The building section's number on S-301, and where it cuts (inches along the house). */
  section?: number;
  sectionX?: number;
}

const ROLE_PEN: Record<string, { pen: Pen; fill: Fill }> = {
  joist: { pen: "light", fill: "none" },
  rim: { pen: "medium", fill: "wood" },
  ledger: { pen: "heavy", fill: "wood" },
  beam: { pen: "hidden", fill: "none" },
  post: { pen: "hidden", fill: "none" },
  blocking: { pen: "fine", fill: "wood" },
  brace: { pen: "hidden", fill: "none" },
};

export function framingPlan(m: PlanModel, sc: ArchScale, refs: FramingRefs = {}, opts: { north?: number } = {}): View {
  const k = new Sketch(sc.k);
  const p = (v: number) => k.p(v);
  const { f, W, D, outline } = m;
  const stairs = m.s.stairs.filter((st) => st.level === "upper");
  const allX = [0, W, ...stairs.flatMap((st) => st.footprint.map((q) => q.x))];
  const allY = [0, D, ...stairs.flatMap((st) => st.footprint.map((q) => q.y))];
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  const yMax = Math.max(...allY);

  // ── The house.
  if (m.house) {
    const ext = p(0.35);
    // (Where the deck runs past the house's corner — 2026-11-14 — the wall stops at the corner, and the house's side
    // wall is drawn as far back as the deck goes beside it.)
    const e = m.houseEnds;
    const hx0 = e.x0 ?? xMin - ext;
    const hx1 = e.x1 ?? xMax + ext;
    k.rect(hx0, -p(0.22), e.x0 === null && e.x1 === null ? xMax - xMin + 2 * ext : hx1 - hx0, p(0.22), "heavy", "poche");
    if (e.x0 !== null && e.wrapLeftIn > 0) k.rect(hx0, -(e.wrapLeftIn + ext), p(0.22), e.wrapLeftIn + ext, "heavy", "poche");
    if (e.x1 !== null && e.wrapRightIn > 0) k.rect(hx1 - p(0.22), -(e.wrapRightIn + ext), p(0.22), e.wrapRightIn + ext, "heavy", "poche");
    k.text(e.x0 === null && e.x1 === null ? xMin + (xMax - xMin) * 0.22 : hx0 + (hx1 - hx0) * 0.5, -p(0.3), "EXISTING HOUSE", "md", { anchor: "middle", bold: true });
  }

  // ── Every stick, beams and posts first (they are under the joists), the ledger and rims last.
  const order = ["post", "beam", "brace", "joist", "blocking", "rim", "ledger"];
  const sticks = [...f.sticks].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  for (const st of sticks) {
    const style = ROLE_PEN[st.role] ?? { pen: "light" as Pen, fill: "none" as Fill };
    const flush = st.role === "beam" && f.beamStyle === "flush";
    const pts = orientedRect(st.cx, st.cy, st.sx, st.sy, st.yaw ?? 0);
    k.poly(flat(pts), flush ? "medium" : style.pen, flush ? "wood" : style.fill);
  }

  // ── The guard posts and the stairs.
  for (const rm of m.s.rails.members) {
    if (rm.role !== "rail-post") continue;
    const pts = orientedRect(rm.cx, rm.cy, rm.sx, rm.sy, rm.yaw ?? 0);
    k.poly(flat(pts), "medium", "ink");
  }
  stairs.forEach((st) => {
    for (const mb of st.members) {
      if (mb.role === "pad" || mb.role === "kicker") continue;
      const along = mb.sx * Math.cos(mb.tilt ?? 0);
      const pts = orientedRect(mb.cx, mb.cy, along, mb.sy, mb.yaw ?? 0);
      if (mb.role === "stringer" || mb.role === "stair-beam") k.poly(flat(pts), "hidden", "none");
      else if (mb.role === "tread" || mb.role === "landing-tread") k.poly(flat(pts), "fine", "none");
      else if (mb.role === "stair-post" || mb.role === "stair-rail-post") k.poly(flat(pts), "medium", "ink");
    }
  });
  // The deck's outline over all of it.
  k.poly(flat(outline), "cut", "none");

  // ── Tags: the joist span arrow and every member's key.
  const z0 = f.zones[0];
  const front = [...f.beams].sort((a, b) => b.y - a.y)[0];
  // The span arrow across the joists, in the widest bay between two joists near a third of the width.
  const xs = f.joists.filter((j) => !j.sister).map((j) => j.x).sort((a, b) => a - b);
  const xa = xs.length > 2 ? (xs[Math.floor(xs.length * 0.36)] + xs[Math.floor(xs.length * 0.36) + 1]) / 2 : W / 3;
  // Across the first bay: from the ledger (or the back) to the first beam out from it — of the part of the deck the
  // arrow stands in (2026-11-14: an L's other leg, a part past the house's corner have backs and beams of their own).
  const zx = f.zones.find((z) => xa >= z.zone.x0 && xa <= z.zone.x1) ?? z0;
  const ya = zx.zone.y0 + 3;
  const firstBeam = [...f.beams].sort((a, b) => a.y - b.y).find((b) => b.y > ya + 12 && xa >= b.x0 - 0.5 && xa <= b.x1 + 0.5);
  const yb = (firstBeam?.y ?? front?.y ?? D) - 3;
  k.line(xa, ya, xa, yb, "medium");
  for (const [yy, dir] of [[ya, 1], [yb, -1]] as Array<[number, number]>) {
    const h = p(0.07);
    k.poly([xa, yy, xa - h * 0.35, yy + dir * h, xa + h * 0.35, yy + dir * h], null, "ink");
  }
  const jMid = (ya + yb) / 2;
  const jt = m.tags.find((t) => t.tag === "J1");
  k.bubble(xa, jMid, "tag", "J1");
  if (jt) k.text(xa + p(0.18), jMid + p(0.035), `${jt.spec.split(",")[0].toUpperCase()}`, "sm", { bold: true, halo: true });

  // Ledger, rim, beams, posts, blocking.
  if (m.attached) {
    const l = f.ledgers[0];
    const lx = l.x0 + (l.x1 - l.x0) * 0.82;
    k.leader(lx, 1.5, lx + p(0.35), -p(0.55), ["L1 — LEDGER, FLASHED", refs.ledger ? `SEE ${refs.ledger}/S-501` : ""].filter(Boolean), "dot", "sm");
  }
  for (const b of f.beams) {
    const t = m.beamTag.get(b.id) ?? "B";
    const bx = b.x0 + (b.x1 - b.x0) * 0.62;
    k.bubble(bx, b.y, "tag", t);
  }
  const rimEdge = outline.reduce<{ a: V2; b: V2; len: number } | null>((best, a, i) => {
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const isBack = Math.abs(a.y) < 1 && Math.abs(b.y) < 1;
    if (isBack || (best && best.len >= len)) return best;
    return { a, b, len };
  }, null);
  if (rimEdge) {
    const c = { x: rimEdge.a.x + (rimEdge.b.x - rimEdge.a.x) * 0.25, y: rimEdge.a.y + (rimEdge.b.y - rimEdge.a.y) * 0.25 };
    k.bubble(c.x, c.y, "tag", "R1");
  }
  const post0 = m.posts[0];
  if (post0 && front) {
    const q = post0.post;
    k.leader(q.x, q.y, q.x - p(0.45), q.y + p(0.5), ["P1 — POST BELOW", refs.post ? `SEE ${refs.post}/S-501` : ""].filter(Boolean), "dot", "sm");
  }
  const blk = f.blockingRows[0];
  if (blk) {
    const bxs = f.joists.map((j) => j.x).sort((a, b) => a - b);
    const bx = bxs.length > 4 ? (bxs[bxs.length - 3] + bxs[bxs.length - 2]) / 2 : W * 0.85;
    k.bubble(bx, blk.y - p(0.16), "tag", "BK");
  }

  // ── The lateral load devices.
  if (m.attached) {
    lateralDevices(f).forEach((dv, i) => {
      k.circle(dv.x, dv.y + 10, p(0.035), "medium", "ink");
      k.leader(dv.x, dv.y + 10, dv.x + (dv.x < W / 2 ? p(0.4) : -p(0.4)), dv.y + p(0.75), [`LD-${i + 1}`, refs.lateral ? `${refs.lateral}/S-501` : ""].filter(Boolean), "dot", "sm");
    });
  }

  // ── Stairs: their name and the way down.
  stairs.forEach((st, i) => {
    if (st.footprint.length < 3) return;
    const c = centroid(st.footprint);
    const run = st.design.side === "front" ? [0, 1] : st.design.side === "left" ? [-1, 0] : [1, 0];
    const len = p(0.42);
    k.line(c.x - run[0] * len, c.y - run[1] * len, c.x + run[0] * len, c.y + run[1] * len, "medium");
    const hx = c.x + run[0] * len;
    const hy = c.y + run[1] * len;
    const h = p(0.07);
    k.poly([hx, hy, hx - run[0] * h - run[1] * h * 0.4, hy - run[1] * h + run[0] * h * 0.4, hx - run[0] * h + run[1] * h * 0.4, hy - run[1] * h - run[0] * h * 0.4], null, "ink");
    k.text(c.x + p(0.1), c.y - p(0.3), `DN ${st.risers}R`, "sm", { bold: true, halo: true });
    k.text(c.x + p(0.1), c.y - p(0.18), `STAIR ${i + 1}`, "xs", { halo: true, tone: "muted" });
    if (refs.section) k.bubble(c.x - p(0.4), c.y + p(0.1), "detail", String(refs.stair ?? refs.section), "S-301");
  });

  // ── Detail callouts and the section cut.
  if (refs.guard && m.s.rails.on) {
    const rp = m.s.rails.members.find((rm) => rm.role === "rail-post" && rm.cx > W * 0.55 && rm.cy > D * 0.4) ?? m.s.rails.members.find((rm) => rm.role === "rail-post");
    if (rp) k.leader(rp.cx, rp.cy, rp.cx + p(0.55), rp.cy + p(0.62), ["GUARD POST", `SEE ${refs.guard}/S-501`], "dot", "sm");
  }
  if (refs.section) {
    // The cut runs out from the house between two joists near the middle, the heads looking along the house (+x).
    const mid = refs.sectionX ?? (xs.length > 3 ? (xs[Math.floor(xs.length / 2)] + xs[Math.floor(xs.length / 2) + 1]) / 2 : W / 2);
    const y0 = -p(0.55);
    const y1 = yMax + p(0.4);
    k.line(mid, y0 + p(0.17), mid, y1 - p(0.17), "phantom");
    k.bubble(mid, y0, "section", String(refs.section), "S-301", 0);
    k.bubble(mid, y1, "section", String(refs.section), "S-301", 0);
  }

  // ── Dimensions: the width under the deck's front, the stairs placed from its left end.
  k.dim(0, D, W, D, -0.62);
  stairs.forEach((st) => {
    if (st.design.side !== "front" || st.footprint.length < 3) return;
    // (Placed by the edge it leaves the deck by: a stair that turns at a landing spreads wider than that.)
    const sx0 = Math.min(st.footprint[0].x, st.footprint[1].x);
    const sx1 = Math.max(st.footprint[0].x, st.footprint[1].x);
    const sy1 = Math.max(...st.footprint.map((q) => q.y));
    k.chain([[0, sy1], [sx0, sy1], [sx1, sy1]], -0.3);
  });
  // The clipped corners and the straight front between them.
  const shape = m.s.design.shape;
  if (shape.kind === "rect" && shape.front?.kind === "clipped") {
    const c = shape.front.clipFt * 12;
    k.chain(
      [
        [0, D],
        [c, D],
        [W - c, D],
        [W, D],
      ],
      -0.32,
    );
  }
  // Right side: house → beams → front, with the cantilever.
  const ys = [...new Set([0, ...f.beams.map((b) => b.y), D].map((v) => Math.round(v * 8) / 8))].sort((a, b) => a - b);
  k.chain(ys.map((y) => [xMax, y] as [number, number]), 0.32);
  k.dim(xMax, 0, xMax, D, 0.62);
  // The joist spacing, once.
  if (xs.length > 3) {
    const i = Math.min(xs.length - 2, Math.floor(xs.length * 0.36) + 1);
    k.dim(xs[i], jMid + p(0.42), xs[i + 1], jMid + p(0.42), 0.1, `${f.spacingIn}" O.C.`, true);
  }
  k.north(xMax + p(0.75), -p(0.05), opts.north ?? 0);
  return k.view("framing", "Deck framing plan", sc.label);
}
