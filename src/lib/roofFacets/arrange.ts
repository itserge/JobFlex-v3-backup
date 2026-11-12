// ROOF FACETS — THE ARRANGEMENT (2026-11-11). Step two of the facet engine: straight line segments in, a watertight
// set of polygons out. The engine hands over the roof outline's edges and the lines along which roof planes meet
// (./engine); this file cuts every segment where another crosses it, welds the crossings that fall on one spot,
// and walks the resulting planar graph round each face. Faces can have holes (a dormer in the middle of a facet).
//
// Nothing here knows about roofs. Coordinates are any planar unit (the engine uses window pixels); `tol` is the
// distance under which two points are one point.

import type { Pt } from "./raster";
import { pointInRing, ringArea } from "./raster";

export interface Seg {
  a: Pt;
  b: Pt;
  /** true for the roof outline's own edges — they are never removed and their corners never move */
  outline: boolean;
  /** free for the caller: which pair of planes the line belongs to, and so on */
  tag: number;
}

export interface GEdge {
  a: number;
  b: number;
  outline: boolean;
  tag: number;
}

export interface Graph {
  verts: Pt[];
  edges: GEdge[];
}

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/** Cut the segments at their crossings and weld coincident points. */
export function buildGraph(segs: ReadonlyArray<Seg>, tol: number): Graph {
  const n = segs.length;
  const splits: number[][] = segs.map(() => [0, 1]);
  const len = segs.map((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y));
  for (let i = 0; i < n; i++) {
    const A = segs[i];
    if (len[i] < 1e-9) continue;
    const rx = A.b.x - A.a.x, ry = A.b.y - A.a.y;
    for (let j = i + 1; j < n; j++) {
      const B = segs[j];
      if (len[j] < 1e-9) continue;
      const sx = B.b.x - B.a.x, sy = B.b.y - B.a.y;
      const den = cross(rx, ry, sx, sy);
      if (Math.abs(den) > 1e-7 * len[i] * len[j]) {
        const qx = B.a.x - A.a.x, qy = B.a.y - A.a.y;
        const t = cross(qx, qy, sx, sy) / den, u = cross(qx, qy, rx, ry) / den;
        const ti = tol / len[i], tj = tol / len[j];
        if (t >= -ti && t <= 1 + ti && u >= -tj && u <= 1 + tj) {
          splits[i].push(Math.min(1, Math.max(0, t)));
          splits[j].push(Math.min(1, Math.max(0, u)));
        }
      }
    }
  }
  // An endpoint lying on another segment splits it there (T-junctions, and segments running along one another).
  for (let i = 0; i < n; i++) {
    for (const p of [segs[i].a, segs[i].b]) {
      for (let j = 0; j < n; j++) {
        if (j === i || len[j] < 1e-9) continue;
        const B = segs[j];
        const sx = B.b.x - B.a.x, sy = B.b.y - B.a.y;
        const u = ((p.x - B.a.x) * sx + (p.y - B.a.y) * sy) / (len[j] * len[j]);
        if (u <= 0 || u >= 1) continue;
        const d = Math.abs(cross(p.x - B.a.x, p.y - B.a.y, sx, sy)) / len[j];
        if (d <= tol) splits[j].push(u);
      }
    }
  }
  // Points, then weld.
  const pts: Pt[] = [];
  const fixed: boolean[] = [];
  const chains: number[][] = [];
  for (let i = 0; i < n; i++) {
    const s = segs[i];
    const ts = [...new Set(splits[i])].sort((p, q) => p - q);
    const chain: number[] = [];
    for (const t of ts) {
      chain.push(pts.length);
      pts.push({ x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t });
      fixed.push(s.outline && (t === 0 || t === 1));
    }
    chains.push(chain);
  }
  const parent = pts.map((_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const grid = new Map<string, number[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  pts.forEach((p, i) => {
    const cx = Math.floor(p.x / tol), cy = Math.floor(p.y / tol);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const j of grid.get(key(cx + dx, cy + dy)) ?? []) {
        if (Math.hypot(pts[j].x - p.x, pts[j].y - p.y) <= tol) parent[find(i)] = find(j);
      }
    }
    const k = key(cx, cy);
    grid.set(k, [...(grid.get(k) ?? []), i]);
  });
  const vertOf = new Map<number, number>();
  const acc: Array<{ x: number; y: number; n: number; fixed: Pt | null }> = [];
  pts.forEach((p, i) => {
    const r = find(i);
    let v = vertOf.get(r);
    if (v === undefined) { v = acc.length; vertOf.set(r, v); acc.push({ x: 0, y: 0, n: 0, fixed: null }); }
    const a = acc[v];
    a.x += p.x; a.y += p.y; a.n++;
    if (fixed[i] && !a.fixed) a.fixed = p;
  });
  const verts = acc.map((a) => a.fixed ?? { x: a.x / a.n, y: a.y / a.n });
  const seen = new Map<string, GEdge>();
  chains.forEach((chain, i) => {
    for (let k = 0; k + 1 < chain.length; k++) {
      const a = vertOf.get(find(chain[k]))!, b = vertOf.get(find(chain[k + 1]))!;
      if (a === b) continue;
      const id = a < b ? `${a}-${b}` : `${b}-${a}`;
      const had = seen.get(id);
      if (had) { if (segs[i].outline) had.outline = true; continue; }
      seen.set(id, { a, b, outline: segs[i].outline, tag: segs[i].tag });
    }
  });
  return { verts, edges: [...seen.values()] };
}

/** Drop edges that hang loose (one end touching nothing else), again and again until none is left. Outline edges stay. */
export function pruneDangling(g: Graph): Graph {
  let edges = g.edges;
  for (;;) {
    const deg = new Map<number, number>();
    for (const e of edges) { deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1); }
    const next = edges.filter((e) => e.outline || (deg.get(e.a)! > 1 && deg.get(e.b)! > 1));
    if (next.length === edges.length) return { verts: g.verts, edges: next };
    edges = next;
  }
}

export interface Face {
  /** vertex indices round the outside */
  outer: number[];
  /** vertex indices round each hole */
  holes: number[][];
  /** area without the holes, in squared units */
  area: number;
}

export interface Faces {
  faces: Face[];
  /** per half-edge (2*e = a→b, 2*e+1 = b→a): the face on its left, or -1 for the outside */
  faceOf: Int32Array;
}

/** Walk the planar graph round each face. */
export function traceFaces(g: Graph): Faces {
  const { verts, edges } = g;
  const H = edges.length * 2;
  const tail = (h: number) => (h & 1 ? edges[h >> 1].b : edges[h >> 1].a);
  const head = (h: number) => (h & 1 ? edges[h >> 1].a : edges[h >> 1].b);
  const out: number[][] = verts.map(() => []);
  for (let h = 0; h < H; h++) out[tail(h)].push(h);
  const ang = (h: number) => Math.atan2(verts[head(h)].y - verts[tail(h)].y, verts[head(h)].x - verts[tail(h)].x);
  const pos = new Int32Array(H);
  out.forEach((list) => { list.sort((p, q) => ang(p) - ang(q)); list.forEach((h, i) => (pos[h] = i)); });
  const next = (h: number) => {
    const list = out[head(h)];
    return list[(pos[h ^ 1] - 1 + list.length) % list.length];
  };
  const cycleOf = new Int32Array(H).fill(-1);
  const cycles: Array<{ hs: number[]; area: number }> = [];
  for (let h0 = 0; h0 < H; h0++) {
    if (cycleOf[h0] !== -1) continue;
    const hs: number[] = [];
    let h = h0, guard = 0;
    while (cycleOf[h] === -1 && guard++ < H + 5) { cycleOf[h] = cycles.length; hs.push(h); h = next(h); }
    const ring = hs.map((x) => verts[tail(x)]);
    cycles.push({ hs, area: ringArea(ring) });
  }
  // Positive cycles are faces. Negative ones are the outside of a connected piece: the largest is the roof's own
  // outside, every other is an island sitting inside some face — its hole.
  const faces: Face[] = [];
  const faceOfCycle = new Int32Array(cycles.length).fill(-1);
  cycles.forEach((c, i) => {
    if (c.area > 1e-9) { faceOfCycle[i] = faces.length; faces.push({ outer: c.hs.map(tail), holes: [], area: c.area }); }
  });
  let outside = -1;
  cycles.forEach((c, i) => { if (c.area <= 1e-9 && (outside === -1 || c.area < cycles[outside].area)) outside = i; });
  cycles.forEach((c, i) => {
    if (c.area > 1e-9 || i === outside || c.hs.length < 3) return;
    // a point just to the left of one of its half-edges lies in the enclosing face
    let host = -1;
    for (const h of c.hs) {
      const a = verts[tail(h)], b = verts[head(h)];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 1e-6) continue;
      const p = { x: (a.x + b.x) / 2 - ((b.y - a.y) / L) * 0.05, y: (a.y + b.y) / 2 + ((b.x - a.x) / L) * 0.05 };
      faces.forEach((f, k) => {
        if (pointInRing(p, f.outer.map((v) => verts[v])) && (host === -1 || f.area < faces[host].area)) host = k;
      });
      if (host !== -1) break;
    }
    if (host === -1) return;
    faces[host].holes.push(c.hs.map(tail));
    faces[host].area += c.area; // c.area is negative
    faceOfCycle[i] = host;
  });
  const faceOf = new Int32Array(H);
  for (let h = 0; h < H; h++) faceOf[h] = faceOfCycle[cycleOf[h]];
  return { faces, faceOf };
}

/**
 * Weld the two ends of an edge too short to be seen — a ridge and two hips that should meet in one point and miss it
 * by a hand's width. Outline corners never move, and two of them are never welded together.
 */
export function collapseShort(g: Graph, minLen: number): Graph {
  const fixed = new Set<number>();
  for (const e of g.edges) if (e.outline) { fixed.add(e.a); fixed.add(e.b); }
  const parent = g.verts.map((_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const size = g.verts.map(() => 1);
  const anchor = g.verts.map((_, i) => (fixed.has(i) ? i : -1));
  const len = (e: GEdge) => Math.hypot(g.verts[e.a].x - g.verts[e.b].x, g.verts[e.a].y - g.verts[e.b].y);
  // A line that meets a wall within `minLen` of the wall's corner meets it AT the corner. The point where it cut the
  // wall is not a corner of the outline (the wall runs straight through it), so moving it along the wall to the
  // real corner changes nothing of the outline — and left where it was, the stub of wall between the two made the
  // straightening take the real corner for a wobble and draw the wall's end at a slant.
  {
    const walls = new Map<number, number[]>();
    for (const e of g.edges) if (e.outline) { (walls.get(e.a) ?? walls.set(e.a, []).get(e.a)!).push(e.b); (walls.get(e.b) ?? walls.set(e.b, []).get(e.b)!).push(e.a); }
    const corner = (i: number) => {
      const nb = walls.get(i) ?? [];
      if (nb.length !== 2) return true;
      const p = g.verts[i], a = g.verts[nb[0]], b = g.verts[nb[1]];
      const la = Math.hypot(a.x - p.x, a.y - p.y), lb = Math.hypot(b.x - p.x, b.y - p.y);
      // straight through within 3 degrees: a point on a wall
      return Math.abs(cross(a.x - p.x, a.y - p.y, b.x - p.x, b.y - p.y)) > 0.052 * la * lb || (a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y) > 0;
    };
    for (const e of [...g.edges].filter((x) => x.outline).sort((p, q) => len(p) - len(q))) {
      if (len(e) >= minLen) break;
      const ca = corner(e.a), cb = corner(e.b);
      if (ca === cb) continue;
      const keep = find(ca ? e.a : e.b), go = find(ca ? e.b : e.a);
      if (keep === go || size[keep] + size[go] > 3) continue;
      parent[go] = keep;
      size[keep] += size[go];
      anchor[keep] = ca ? e.a : e.b;
    }
  }
  for (const e of [...g.edges].filter((x) => !x.outline).sort((p, q) => len(p) - len(q))) {
    if (len(e) >= minLen) break;
    const ra = find(e.a), rb = find(e.b);
    // a weld of more than three points is a line being eaten, not a corner being tidied
    if (ra === rb || (anchor[ra] !== -1 && anchor[rb] !== -1) || size[ra] + size[rb] > 3) continue;
    parent[rb] = ra;
    size[ra] += size[rb];
    if (anchor[ra] === -1) anchor[ra] = anchor[rb];
  }
  const sum = new Map<number, { x: number; y: number; n: number }>();
  g.verts.forEach((p, i) => {
    const r = find(i);
    const a = sum.get(r) ?? { x: 0, y: 0, n: 0 };
    a.x += p.x; a.y += p.y; a.n++;
    sum.set(r, a);
  });
  const verts = g.verts.map((p, i) => {
    const r = find(i);
    if (anchor[r] !== -1) return g.verts[anchor[r]];
    const a = sum.get(r)!;
    return { x: a.x / a.n, y: a.y / a.n };
  });
  const seen = new Map<string, GEdge>();
  for (const e of g.edges) {
    const a = find(e.a), b = find(e.b);
    if (a === b) continue;
    const id = a < b ? `${a}-${b}` : `${b}-${a}`;
    const had = seen.get(id);
    if (had) { if (e.outline) had.outline = true; continue; }
    seen.set(id, { ...e, a, b });
  }
  return { verts, edges: [...seen.values()] };
}

/** True when segments p1–p2 and p3–p4 cross or touch anywhere but at a shared end. */
function segmentsMeet(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const o = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const on = (a: Pt, b: Pt, c: Pt) => Math.min(a.x, b.x) - 1e-9 <= c.x && c.x <= Math.max(a.x, b.x) + 1e-9 && Math.min(a.y, b.y) - 1e-9 <= c.y && c.y <= Math.max(a.y, b.y) + 1e-9;
  const d1 = o(p3, p4, p1), d2 = o(p3, p4, p2), d3 = o(p1, p2, p3), d4 = o(p1, p2, p4);
  const E = 1e-7;
  if (((d1 > E && d2 < -E) || (d1 < -E && d2 > E)) && ((d3 > E && d4 < -E) || (d3 < -E && d4 > E))) return true;
  if (Math.abs(d1) <= E && on(p3, p4, p1)) return true;
  if (Math.abs(d2) <= E && on(p3, p4, p2)) return true;
  if (Math.abs(d3) <= E && on(p1, p2, p3)) return true;
  if (Math.abs(d4) <= E && on(p1, p2, p4)) return true;
  return false;
}

/**
 * Make every line straight between its corners. A "chain" is the run of edges between two junctions (points where
 * three or more lines meet, or a line's loose end); along it the same two faces lie either side, so any bend in it
 * that strays less than the tolerance from the straight run is noise, not shape — it is taken out (Douglas–Peucker).
 * The outline's own chains get the tight tolerance (its corners are real), every other chain the loose one. A
 * straightened chain that would cross or touch another line is left as it was.
 */
export function straightenChains(g: Graph, tolInner: number, tolOutline: number): Graph {
  const { verts, edges } = g;
  const at: number[][] = verts.map(() => []);
  edges.forEach((e, i) => { at[e.a].push(i); at[e.b].push(i); });
  const used = new Uint8Array(edges.length);
  const chains: Array<{ vs: number[]; outline: boolean; tag: number }> = [];
  const walk = (v0: number, e0: number) => {
    const vs = [v0];
    let e = e0, v = v0;
    for (;;) {
      used[e] = 1;
      v = edges[e].a === v ? edges[e].b : edges[e].a;
      vs.push(v);
      if (at[v].length !== 2 || v === v0) break;
      const next = at[v][0] === e ? at[v][1] : at[v][0];
      if (used[next]) break;
      e = next;
    }
    chains.push({ vs, outline: edges[e0].outline, tag: edges[e0].tag });
  };
  verts.forEach((_, v) => { if (at[v].length !== 2) for (const e of at[v]) if (!used[e]) walk(v, e); });
  edges.forEach((e, i) => { if (!used[i]) walk(e.a, i); }); // rings with no junction on them

  const dist = (p: Pt, a: Pt, b: Pt) => {
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    if (L < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  const simplify = (vs: number[], tol: number): number[] => {
    const keep = new Uint8Array(vs.length);
    keep[0] = keep[vs.length - 1] = 1;
    const stack: Array<[number, number]> = [[0, vs.length - 1]];
    while (stack.length) {
      const [i, j] = stack.pop()!;
      let worst = -1, wd = tol;
      for (let k = i + 1; k < j; k++) {
        const d = dist(verts[vs[k]], verts[vs[i]], verts[vs[j]]);
        if (d > wd) { wd = d; worst = k; }
      }
      if (worst !== -1) { keep[worst] = 1; stack.push([i, worst], [worst, j]); }
    }
    return vs.filter((_, k) => keep[k]);
  };
  for (let c = 0; c < chains.length; c++) {
    const ch = chains[c];
    if (ch.vs.length < 3) continue;
    const tol = ch.outline ? tolOutline : tolInner;
    let next: number[];
    if (ch.vs[0] === ch.vs[ch.vs.length - 1]) {
      // a closed ring: hold its first point and the one farthest from it, straighten the two halves
      let far = 1, fd = -1;
      for (let k = 1; k < ch.vs.length - 1; k++) { const d = Math.hypot(verts[ch.vs[k]].x - verts[ch.vs[0]].x, verts[ch.vs[k]].y - verts[ch.vs[0]].y); if (d > fd) { fd = d; far = k; } }
      const a = simplify(ch.vs.slice(0, far + 1), tol), b = simplify(ch.vs.slice(far), tol);
      next = [...a, ...b.slice(1)];
      if (next.length < 4) continue; // a ring needs three corners
    } else {
      next = simplify(ch.vs, tol);
    }
    if (next.length === ch.vs.length) continue;
    // would a new straight run cross or touch another line?
    let clash = false;
    for (let k = 0; k + 1 < next.length && !clash; k++) {
      const a = next[k], b = next[k + 1];
      for (let o = 0; o < chains.length && !clash; o++) {
        if (o === c) continue;
        const ov = chains[o].vs;
        for (let m = 0; m + 1 < ov.length; m++) {
          const p = ov[m], q = ov[m + 1];
          if (p === a || p === b || q === a || q === b) {
            // sharing an end is how lines meet; lying along one another is not
            const shared = p === a || p === b ? p : q, other = shared === p ? q : p, mine = shared === a ? b : a;
            const cr = (verts[other].x - verts[shared].x) * (verts[mine].y - verts[shared].y) - (verts[other].y - verts[shared].y) * (verts[mine].x - verts[shared].x);
            const dt = (verts[other].x - verts[shared].x) * (verts[mine].x - verts[shared].x) + (verts[other].y - verts[shared].y) * (verts[mine].y - verts[shared].y);
            if (Math.abs(cr) < 1e-7 && dt > 0) { clash = true; break; }
            continue;
          }
          if (segmentsMeet(verts[a], verts[b], verts[p], verts[q])) { clash = true; break; }
        }
      }
    }
    if (!clash) ch.vs = next;
  }
  const out: GEdge[] = [];
  const seen = new Set<string>();
  for (const ch of chains) {
    for (let k = 0; k + 1 < ch.vs.length; k++) {
      const a = ch.vs[k], b = ch.vs[k + 1];
      if (a === b) continue;
      const id = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ a, b, outline: ch.outline, tag: ch.tag });
    }
  }
  return { verts, edges: out };
}
