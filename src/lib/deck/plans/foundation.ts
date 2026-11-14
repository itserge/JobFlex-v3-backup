// THE FOUNDATION PLAN (2026-10-23) — pure. What the footing inspector walks:
// every footing where the engine put it, to scale, on the grid — the post on
// its pier, the pad below grade dashed — each tagged to the footing schedule,
// the deck it carries shaded and its area written in, the post spacings and
// the distances back to the house as dimension strings, the deck and its
// stairs above shown as phantoms. Model inches, y out from the house (down
// the sheet), x along it.
import { orientedRect, flat, clipPoly, centroid, rectPts, type V2 } from "./geom";
import { Sketch, TINTS, type ArchScale, type View } from "./draft";
import type { PlanModel } from "./model";

const POST_W: Record<string, number> = { "4x4": 3.5, "4x6": 3.5, "6x6": 5.5, "8x8": 7.5 };

export function foundationPlan(m: PlanModel, sc: ArchScale, opts: { north?: number } = {}): View {
  const k = new Sketch(sc.k);
  const p = (v: number) => k.p(v);
  const { f, W, D, outline } = m;
  const yMax = Math.max(D, ...m.stairPads.flatMap((sp) => sp.pts.map((q) => q.y)), ...m.s.stairs.flatMap((st) => st.footprint.map((q) => q.y)));
  const xMin = Math.min(0, ...m.s.stairs.flatMap((st) => st.footprint.map((q) => q.x)));
  const xMax = Math.max(W, ...m.s.stairs.flatMap((st) => st.footprint.map((q) => q.x)));

  // ── The house, its face along y = 0.
  if (m.house) {
    const ext = p(0.35);
    // (Past the house's corner the wall stops at the corner; its side wall runs back as far as the deck does. 2026-11-14.)
    const e = m.houseEnds;
    const hx0 = e.x0 ?? xMin - ext;
    const hx1 = e.x1 ?? xMax + ext;
    k.rect(hx0, -p(0.22), e.x0 === null && e.x1 === null ? xMax - xMin + 2 * ext : hx1 - hx0, p(0.22), "heavy", "poche");
    if (e.x0 !== null && e.wrapLeftIn > 0) k.rect(hx0, -(e.wrapLeftIn + ext), p(0.22), e.wrapLeftIn + ext, "heavy", "poche");
    if (e.x1 !== null && e.wrapRightIn > 0) k.rect(hx1 - p(0.22), -(e.wrapRightIn + ext), p(0.22), e.wrapRightIn + ext, "heavy", "poche");
    k.text(e.x0 === null && e.x1 === null ? (xMin + xMax) / 2 : (hx0 + hx1) / 2, -p(0.3), "EXISTING HOUSE", "md", { anchor: "middle", bold: true });
  }

  // ── The deck it all carries, shaded by the post that carries it.
  const shaded = tributaries(m);
  shaded.forEach((t, i) => {
    if (t.pts.length < 3) return;
    k.poly(flat(t.pts), null, TINTS[i % TINTS.length]);
    for (const r of t.more ?? []) k.poly(flat(r), null, TINTS[i % TINTS.length]);
  });
  // The deck above: its outline, phantom. The ledger: hidden, along the wall it hangs on (2026-11-14 — each run where
  // it is: it was one line the deck's whole width at the house line, whatever the wall did behind the deck).
  k.poly(flat(outline), "phantom", "none");
  if (m.attached) for (const l of f.ledgers) k.line(l.x0, l.y, l.x1, l.y, "hidden");

  // ── The grid.
  const gx0 = xMin - p(0.92);
  const gy1 = yMax + p(0.95);
  for (const r of m.rows) {
    k.line(gx0 + p(0.15), r.at, xMax + p(0.25), r.at, "center");
    k.bubble(gx0, r.at, "grid", r.label);
  }
  for (const c of m.cols) {
    k.line(c.at, -p(m.house ? 0.05 : 0.25), c.at, gy1 - p(0.15), "center");
    k.bubble(c.at, gy1, "grid", c.label);
  }

  // ── The beams above, hidden, each tagged.
  for (const b of f.beams) {
    k.line(b.x0, b.y, b.x1, b.y, "hidden");
  }

  // ── Every footing: the pad below grade (dashed), the pier, the post, its tag.
  for (const pp of m.posts) {
    const q = pp.post;
    const ft = q.footing;
    const pw = POST_W[q.size] ?? 5.5;
    if (ft.type === "poured") {
      k.circle(q.x, q.y, ft.padIn / 2, "hidden", "none");
      k.circle(q.x, q.y, ft.pierIn / 2, "medium", "concrete");
    } else {
      k.rect(q.x - ft.padIn / 2, q.y - ft.padIn / 2, ft.padIn, ft.padIn, "medium", "concrete");
    }
    k.rect(q.x - pw / 2, q.y - pw / 2, pw, pw, "medium", "ink");
    // The tag up and to the right, clear of the pad.
    const r = Math.max(ft.padIn / 2, ft.pierIn / 2) + p(0.06);
    k.bubble(q.x + r * 0.75 + p(0.09), q.y - r * 0.75 - p(0.09), "foot", pp.tag);
  }

  // ── The stairs: their footprint above (phantom), their footings, the pad.
  m.s.stairs.forEach((st, i) => {
    if (st.level !== "upper" || st.footprint.length < 3) return;
    k.poly(flat(st.footprint), "phantom", "none");
    const c = centroid(st.footprint);
    k.text(c.x, c.y - p(0.05), `STAIR ${i + 1} ABOVE`, "sm", { anchor: "middle", tone: "muted" });
  });
  for (const sp of m.stairPads) {
    k.poly(flat(sp.pts), "medium", "concrete");
    const c = centroid(sp.pts);
    k.bubble(c.x, c.y, "foot", sp.tag);
  }
  for (const sf of m.stairFootings) {
    const ft = sf.footing;
    k.circle(sf.x, sf.y, ft.padIn / 2, "hidden", "none");
    k.circle(sf.x, sf.y, ft.pierIn / 2, "medium", "concrete");
    const sw = POST_W[m.footings.find((t) => t.tag === sf.tag)?.post ?? "4x4"] ?? 3.5;
    k.rect(sf.x - sw / 2, sf.y - sw / 2, sw, sw, "medium", "ink");
    k.bubble(sf.x + ft.padIn / 2 + p(0.12), sf.y, "foot", sf.tag);
  }

  // ── The tributary areas, lettered.
  shaded.forEach((t) => {
    if (t.pts.length < 3) return;
    const c = centroid(t.pts);
    // Toward the house from the post, clear of its tag.
    const post = m.posts.find((pp) => pp.grid === t.grid)?.post;
    const y = post ? Math.min(c.y, post.y - p(0.42)) : c.y;
    k.text(c.x, y, `${t.sqFt.toFixed(1)} SF`, "sm", { anchor: "middle", bold: true, tone: "blue", halo: true });
    k.text(c.x, y + p(0.11), t.grid, "xs", { anchor: "middle", tone: "muted", mono: true });
  });

  // ── Dimensions: the post spacing along the front, the overall, and back to the house.
  const front = [...f.beams].sort((a, b) => b.y - a.y)[0];
  if (front) {
    const xs = [front.x0, ...front.postXs, front.x1];
    const yDim = yMax;
    k.chain(xs.map((x) => [x, yDim] as [number, number]), -0.32);
    k.dim(0, yDim, W, yDim, -0.62);
  }
  // Left side: house → each row → the front.
  const ys = [...new Set([0, ...m.rows.map((r) => r.at), D].map((v) => Math.round(v * 8) / 8))].sort((a, b) => a - b);
  const xDim = xMin;
  // (A dimension's offset is to the left of its direction: going down the sheet that is +x — so negative here.)
  k.chain(ys.map((y) => [xDim, y] as [number, number]), -0.32);
  if (ys.length > 2) k.dim(xDim, 0, xDim, D, -0.62);

  // ── The notes a footing inspector reads off the plan.
  const pp0 = m.posts[0];
  if (pp0) {
    const q = pp0.post;
    const ft = q.footing;
    const tx = q.x + p(0.9);
    const ty = q.y + Math.max(p(0.75), (D - q.y) * 0.55);
    k.leader(
      q.x + (POST_W[q.size] ?? 5.5) / 2,
      q.y + (POST_W[q.size] ?? 5.5) / 2,
      tx,
      ty,
      ft.type === "poured"
        ? [`${q.size} POST ON POST BASE, TYP.`, `${ft.pierIn}" PIER ON ${ft.padIn}" × ${ft.padThickIn}" PAD,`, `BOTTOM ${ft.depthIn}" BELOW GRADE`]
        : [`${q.size} POST ON PRECAST PIER BLOCK, TYP.`, `ON COMPACTED GRAVEL`],
      "dot",
      "sm",
    );
  }
  k.north(xMax + p(0.6), -p(0.05), opts.north ?? 0);
  return k.view("foundation", "Foundation plan", sc.label);
}

/**
 * The deck each post carries, as polygons for the plan: across, halfway to the next post (or the beam's end); out,
 * halfway back to the support behind (the ledger, a beam) and forward to the next one or the deck's edge — clipped to
 * the deck's real outline, so a clipped corner shades what it really is. The engine's own area is printed with it.
 */
export function tributaries(m: PlanModel): Array<{ grid: string; pts: V2[]; sqFt: number; more?: V2[][] }> {
  const { f, outline } = m;
  const supports = [...new Set([...(m.attached || m.house ? [0] : []), ...f.beams.map((b) => b.y)])].sort((a, b) => a - b);
  const D = m.D;
  const out: Array<{ grid: string; pts: V2[]; sqFt: number; more?: V2[][] }> = [];
  // A rectangle (its front straight, clipped or bowed) is one convex outline: a post's strip is clipped to it. An L, a
  // deck along a stepped wall or round the house's corner is not (2026-11-14 — clipped to such an outline as if it
  // were, the strips of whole parts of the deck came out empty): there each strip is laid part by part — across,
  // halfway to the next post; out, halfway to that part's own next support, to its own edges.
  const byPart = m.s.design.shape.kind !== "rect";
  for (const pp of m.posts) {
    const q = pp.post;
    if (q.roof) continue;
    const beam = f.beams.find((b) => b.id === q.beamId);
    if (!beam) continue;
    const xs = [...beam.postXs].sort((a, b) => a - b);
    const i = xs.findIndex((x) => Math.abs(x - q.x) < 1);
    const left = i <= 0 ? beam.x0 : (xs[i - 1] + xs[i]) / 2;
    const right = i < 0 || i >= xs.length - 1 ? beam.x1 : (xs[i] + xs[i + 1]) / 2;
    if (byPart) {
      const rects: V2[][] = [];
      for (const zf of f.zones) {
        const z = zf.zone;
        if (!beam.zoneIds.includes(z.id)) continue;
        const xa = Math.max(left, z.x0);
        const xb = Math.min(right, z.x1);
        if (xb - xa < 0.5) continue;
        const sup = zf.back === "ledger" ? [z.y0, ...zf.beamYs] : [...zf.beamYs];
        const k2 = sup.findIndex((y) => Math.abs(y - beam.lineY) < 1);
        if (k2 < 0) continue;
        const ya = k2 === 0 ? z.y0 : (sup[k2 - 1] + sup[k2]) / 2;
        const yb = k2 === sup.length - 1 ? z.y1 : (sup[k2] + sup[k2 + 1]) / 2;
        if (yb - ya < 0.5) continue;
        rects.push(rectPts(xa, ya, xb, yb));
      }
      if (!rects.length) continue;
      const area = (r: V2[]) => Math.abs((r[2].x - r[0].x) * (r[2].y - r[0].y));
      rects.sort((a, b) => area(b) - area(a));
      out.push({ grid: pp.grid, pts: rects[0], sqFt: q.tributarySqFt, ...(rects.length > 1 ? { more: rects.slice(1) } : {}) });
      continue;
    }
    const si = supports.findIndex((y) => Math.abs(y - beam.y) < 1);
    const behind = si > 0 ? supports[si - 1] : null;
    const ahead = si >= 0 && si < supports.length - 1 ? supports[si + 1] : null;
    const y0 = behind == null ? beam.y : (behind + beam.y) / 2;
    const y1 = ahead == null ? D + 1 : (beam.y + ahead) / 2;
    const zones = f.zones.map((z) => z.zone);
    // Clip to the deck: its outline, and the rectangles of the zones the beam runs under (an L's other leg is not its load).
    let poly = clipPoly(rectPts(left, y0, right, y1), outline);
    const zr = zones.filter((z) => beam.zoneIds.includes(z.id));
    if (zr.length === 1) poly = clipPoly(poly, rectPts(zr[0].x0, zr[0].y0, zr[0].x1, zr[0].y1));
    out.push({ grid: pp.grid, pts: poly, sqFt: q.tributarySqFt });
  }
  // The corners cut at an angle (2026-11-14): what each angled beam carries — from the cut back halfway to the support
  // behind it — half to the post at each of its ends (the front one is the front beam's own end post).
  for (const cb of f.cornerBeams) {
    const k = cb.clip;
    const X = (t: number) => k.x + k.dir * t;
    const edge = (t: number) => k.y - k.c + t;
    const mid = (t: number) => (edge(t) - cb.overIn + cb.behindY) / 2;
    const half = (t0: number, t1: number): V2[] => [{ x: X(t0), y: edge(t0) }, { x: X(t1), y: edge(t1) }, { x: X(t1), y: mid(t1) }, { x: X(t0), y: mid(t0) }];
    const own = m.posts.find((pp) => pp.post.beamId === cb.id && Math.abs(pp.post.x - cb.x1) < 1 && Math.abs(pp.post.y - cb.y1) < 1);
    if (own) out.push({ grid: own.grid, pts: half(0, k.c / 2), sqFt: own.post.tributarySqFt });
    const front = m.posts.find((pp) => Math.abs(pp.post.x - cb.x0) < 1 && Math.abs(pp.post.y - cb.y0) < 1);
    const entry = front ? out.find((t) => t.grid === front.grid) : undefined;
    if (entry) entry.more = [...(entry.more ?? []), half(k.c / 2, k.c)];
    else if (front) out.push({ grid: front.grid, pts: half(k.c / 2, k.c), sqFt: front.post.tributarySqFt });
  }
  return out;
}

/** A stair's member as a plan outline (used by the framing plan for stringers and treads). */
export function memberOutline(mb: { cx: number; cy: number; sx: number; sy: number; yaw: number }): V2[] {
  return orientedRect(mb.cx, mb.cy, mb.sx, mb.sy, mb.yaw);
}
