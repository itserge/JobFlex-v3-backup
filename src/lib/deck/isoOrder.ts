// THE PAINT ORDER OF THE SMALL PICTURE (2026-11-10) — pure.
//
// Owner, with the permit set's cover open: "the picture of the deck on the 3D picture is look not good. The beam
// sticks out… check and fix it. Make sure it's good appearance."
//
// The picture (lib/deck/iso) has no depth buffer: it paints faces one over the other, far to near. It used to sort
// them by one number each — how near the face's MIDDLE is. That is right for small parts and wrong for long ones: a
// 16 ft deck board's middle is 8 ft along, the near end of the beam under it is nearer than that, so the end of the
// beam was painted AFTER the board and lay on top of the deck. The ledger did the same at the house, the rim and the
// roof's trim at the gable.
//
// Here the order comes from the faces themselves. For two flat faces whose outlines overlap on the page:
//   · a face that lies wholly BEHIND the other's plane (on the side away from the eye) can never cover it;
//   · a face that lies wholly IN FRONT of the other's plane (on the eye's side) can never be covered by it.
// Either fact says which one is painted first, and no pair of faces that do not cut through each other gives two
// answers. The faces are then laid out so every such pair is in order (a topological sort); where the geometry says
// nothing — two members drawn through each other — or three faces overlap in a ring, the old far-to-near order
// decides, so nothing is ever worse than before.

export type OrderPoint = [number, number, number];

export interface OrderFace {
  /** The face's ring in the scene, ft. */
  pts: OrderPoint[];
  /** The same ring on the page. */
  scr: Array<[number, number]>;
  /** How near the face is to the eye by the old rule (its middle; a lone plane's nearest point). */
  depth: number;
  /** The build step, for ties. */
  rank: number;
}

export interface OrderView {
  /** The unit direction from the scene toward the viewer. */
  dir: OrderPoint;
  /** The eye, when the picture has perspective. */
  eye: OrderPoint | null;
}

/** Beyond this many faces the pairs are too many to compare in one frame: the old order stands. */
export const ORDER_MAX_FACES = 16000;
/** How far off a plane still counts as on it, ft (the scene is rounded to a thousandth of a foot). */
const ON_PLANE = 0.02;
/** How far two outlines must overlap on the page to count, page units (feet at the picture's middle). */
const OVERLAP = 0.02;

/** The paint order: indices into `faces`, the first painted first. */
export function paintOrder(faces: readonly OrderFace[], view: OrderView): number[] {
  const n = faces.length;
  const byDepth = faces.map((_, i) => i).sort((a, b) => faces[a].depth - faces[b].depth || faces[a].rank - faces[b].rank || a - b);
  if (n < 2 || n > ORDER_MAX_FACES) return byDepth;

  // Everything below runs for every frame of a turning picture, so the faces are laid out flat first: the corners in
  // the scene (x, y, z) and on the page (x, y), and for every edge of an outline its normal on the page with the
  // outline's own reach along it — half of each "do they overlap" test, worked out once.
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + faces[i].pts.length;
  const total = start[n];
  const P = new Float64Array(total * 3);
  const S = new Float64Array(total * 2);
  const E = new Float64Array(total * 4); // ex, ey, lo, hi — (0, 0) for an edge with no length
  // Each face's plane (nx, ny, nz, d) turned so the eye is on its positive side, and its box on the page.
  const plane = new Float64Array(n * 4);
  const flat = new Uint8Array(n); // 1 = has a plane the eye is clearly off
  const box = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = faces[i].pts;
    const sc = faces[i].scr;
    const s0 = start[i], m = p.length;
    for (let k = 0; k < m; k++) {
      P[(s0 + k) * 3] = p[k][0]; P[(s0 + k) * 3 + 1] = p[k][1]; P[(s0 + k) * 3 + 2] = p[k][2];
      S[(s0 + k) * 2] = sc[k][0]; S[(s0 + k) * 2 + 1] = sc[k][1];
    }
    for (let k = 0; k < m; k++) {
      const u = sc[k], v = sc[(k + 1) % m];
      let ex = v[1] - u[1], ey = u[0] - v[0];
      const el = Math.hypot(ex, ey);
      if (el < 1e-6) continue;
      ex /= el; ey /= el;
      let lo = Infinity, hi = -Infinity;
      for (let q = 0; q < m; q++) { const w = sc[q][0] * ex + sc[q][1] * ey; if (w < lo) lo = w; if (w > hi) hi = w; }
      const e = (s0 + k) * 4;
      E[e] = ex; E[e + 1] = ey; E[e + 2] = lo; E[e + 3] = hi;
    }
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < p.length; k++) {
      const a = p[k], b = p[(k + 1) % p.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0]; cy += a[1]; cz += a[2];
    }
    const l = Math.hypot(nx, ny, nz);
    if (l > 1e-9 && p.length >= 3) {
      nx /= l; ny /= l; nz /= l;
      const d = (nx * cx + ny * cy + nz * cz) / p.length;
      // Which side the eye is on: its own distance off the plane with perspective, the view's direction without.
      const side = view.eye ? nx * view.eye[0] + ny * view.eye[1] + nz * view.eye[2] - d : nx * view.dir[0] + ny * view.dir[1] + nz * view.dir[2];
      if (Math.abs(side) > (view.eye ? 0.05 : 0.01)) {
        const s = side > 0 ? 1 : -1;
        plane[i * 4] = nx * s; plane[i * 4 + 1] = ny * s; plane[i * 4 + 2] = nz * s; plane[i * 4 + 3] = d * s;
        flat[i] = 1;
      }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of faces[i].scr) {
      if (q[0] < x0) x0 = q[0];
      if (q[0] > x1) x1 = q[0];
      if (q[1] < y0) y0 = q[1];
      if (q[1] > y1) y1 = q[1];
    }
    box[i * 4] = x0; box[i * 4 + 1] = y0; box[i * 4 + 2] = x1; box[i * 4 + 3] = y1;
  }

  /** Where face `j` lies about face `i`'s plane: 1 = wholly behind it, 2 = wholly in front, 3 = on it, 0 = cut by it. */
  const about = (i: number, j: number): number => {
    const a = plane[i * 4], b = plane[i * 4 + 1], c = plane[i * 4 + 2], d = plane[i * 4 + 3];
    let lo = Infinity, hi = -Infinity;
    for (let q = start[j] * 3, end = start[j + 1] * 3; q < end; q += 3) {
      const t = a * P[q] + b * P[q + 1] + c * P[q + 2] - d;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    return (hi <= ON_PLANE ? 1 : 0) | (lo >= -ON_PLANE ? 2 : 0);
  };

  /** Is `j`'s outline clear of `i`'s along one of `i`'s edges? */
  const apart = (i: number, j: number): boolean => {
    const j0 = start[j] * 2, j1 = start[j + 1] * 2;
    for (let e = start[i] * 4, end = start[i + 1] * 4; e < end; e += 4) {
      const ex = E[e], ey = E[e + 1];
      if (ex === 0 && ey === 0) continue;
      let lo = Infinity, hi = -Infinity;
      for (let q = j0; q < j1; q += 2) { const w = S[q] * ex + S[q + 1] * ey; if (w < lo) lo = w; if (w > hi) hi = w; }
      if (E[e + 3] - lo < OVERLAP || hi - E[e + 2] < OVERLAP) return true;
    }
    return false;
  };
  /** Do the two outlines overlap on the page? (Separating axes; a ring that is not convex counts as its hull.) */
  const overlap = (i: number, j: number): boolean => !apart(i, j) && !apart(j, i);

  // "Painted before": after[i] lists the faces that must come after face i.
  const after: number[][] = Array.from({ length: n }, () => []);
  const waits = new Int32Array(n);
  const pair = (i: number, j: number) => {
    if (!flat[i] && !flat[j]) return;
    const ji = flat[i] ? about(i, j) : 0; // j about i's plane
    const ij = flat[j] ? about(j, i) : 0; // i about j's plane
    if (ji === 3 || ij === 3) return; // in one plane: side by side, or one drawn on the other — the old order
    // j cannot cover i: j is behind i's plane, or i is in front of j's. And the other way round.
    const jUnder = (ji & 1) !== 0 || (ij & 2) !== 0;
    const iUnder = (ij & 1) !== 0 || (ji & 2) !== 0;
    if (jUnder === iUnder) return; // neither can cover the other, or they cut through each other
    if (!overlap(i, j)) return;
    const first = jUnder ? j : i, then = jUnder ? i : j;
    after[first].push(then);
    waits[then]++;
  };
  // Pairs whose boxes overlap on the page: a sweep along x.
  const byLeft = faces.map((_, i) => i).sort((a, b) => box[a * 4] - box[b * 4]);
  for (let u = 0; u < n; u++) {
    const i = byLeft[u];
    const right = box[i * 4 + 2] - OVERLAP, top = box[i * 4 + 1] + OVERLAP, bottom = box[i * 4 + 3] - OVERLAP;
    for (let w = u + 1; w < n; w++) {
      const j = byLeft[w];
      if (box[j * 4] >= right) break;
      if (box[j * 4 + 1] >= bottom || box[j * 4 + 3] <= top) continue;
      pair(i, j);
    }
  }

  // Lay them out: always the farthest face nothing still waits on (a heap on the old order's place).
  const place = new Int32Array(n);
  byDepth.forEach((f, k) => { place[f] = k; });
  const heap: number[] = [];
  const push = (f: number) => {
    let k = heap.length;
    heap.push(f);
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (place[heap[up]] <= place[f]) break;
      heap[k] = heap[up];
      k = up;
    }
    heap[k] = f;
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop() as number;
    const m = heap.length;
    if (m) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= m) break;
        if (c + 1 < m && place[heap[c + 1]] < place[heap[c]]) c++;
        if (place[heap[c]] >= place[last]) break;
        heap[k] = heap[c];
        k = c;
      }
      heap[k] = last;
    }
    return top;
  };
  const done = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!waits[i]) push(i);
  const out: number[] = [];
  let scan = 0;
  while (out.length < n) {
    if (!heap.length) {
      // A ring of faces each over the next: the farthest of them goes, as before.
      while (done[byDepth[scan]]) scan++;
      push(byDepth[scan]);
    }
    const f = pop();
    if (done[f]) continue;
    done[f] = 1;
    out.push(f);
    for (const t of after[f]) if (!done[t] && --waits[t] === 0) push(t);
  }
  return out;
}
