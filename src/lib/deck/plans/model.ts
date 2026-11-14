// THE PLAN SET'S ONE TRUTH (2026-10-23) — pure. Everything the sheets name is
// named here once, from the engine's own structure (lib/deck/structure), so the
// foundation plan, the framing plan, the schedules and the crew's layout sheet
// can never disagree: the grid (letters for the lines parallel to the house —
// the ledger, then each beam — numbers for the post columns), the footing
// tags (F1, F2 … by size; SF for a stair's; SP for its pad), the member tags
// (J joists, R rim, L ledger, B beams, P posts …), the bearing check of every
// footing, and the layout coordinates a crew strings the footings from.
import type { DeckStructure } from "../structure";
import type { Beam, DeckFrame, Footing, Post } from "../frame";
import { shapeOutline } from "../design";
import { deckPast } from "../house";
import { speciesWords } from "../catalog";
import { ftIn, joistMaxSpanIn, LEDGER_FASTENER_LABEL, RULE, rulesFor } from "../codeTables";
import { clusterValues, gridLetter, type V2 } from "./geom";

export interface GridLine {
  /** Model inches: x of a column, y of a row. */
  at: number;
  label: string;
}
export interface GridRow extends GridLine {
  what: "house" | "ledger" | "beam";
  beamId?: string;
}

export interface FootingType {
  tag: string;
  kind: "post" | "stair-post" | "stair-pad";
  type: Footing["type"] | "pad";
  padIn: number;
  thickIn: number;
  pierIn: number;
  depthIn: number;
  /** Where it goes, grid names. */
  at: string[];
  post: string | null;
  /** The table's figure at the heaviest of these posts, and the rule. */
  requiredIn: number | null;
  basis: string;
}

export interface PlanPost {
  post: Post;
  grid: string;
  col: number;
  row: number;
  tag: string;
}

export interface BearingRow {
  grid: string;
  tag: string;
  tribSqFt: number;
  liveLb: number;
  deadLb: number;
  totalLb: number;
  soilPsf: number;
  reqAreaSqFt: number;
  /** The round pad that area makes. */
  reqDiaIn: number;
  padIn: number;
  padAreaSqFt: number;
  /** Required ÷ provided: at or under 1.00 bears. */
  ratio: number;
  ok: boolean;
}

export interface LayoutPoint {
  name: string;
  x: number;
  y: number;
  what: string;
}
export interface Diagonal {
  from: string;
  to: string;
  lengthIn: number;
}

export interface MemberTag {
  tag: string;
  member: string;
  spec: string;
  where: string;
  /** The design figure against the table's, when there is one. */
  check?: { actual: string; allowed: string; ratio: number; rule: string; byTable?: boolean };
}

export interface PlanModel {
  s: DeckStructure;
  f: DeckFrame;
  W: number;
  D: number;
  outline: V2[];
  attached: boolean;
  /** The house's face along y = 0 (attached, or beside it). */
  house: boolean;
  /**
   * Where the house ENDS inside the deck's width (2026-11-14, a deck that runs past the house's corner): the corner's
   * x, inches — null where the wall runs on past the deck's end — and how far the deck goes back beside the house there.
   */
  houseEnds: { x0: number | null; x1: number | null; wrapLeftIn: number; wrapRightIn: number };
  cols: GridLine[];
  rows: GridRow[];
  posts: PlanPost[];
  footings: FootingType[];
  bearing: BearingRow[];
  layout: { origin: string; points: LayoutPoint[]; diagonals: Diagonal[] };
  tags: MemberTag[];
  beamTag: Map<string, string>;
  /** Stair footings and pads with their tags, plan positions in model inches. */
  stairFootings: Array<{ tag: string; x: number; y: number; footing: Footing; stair: number }>;
  stairPads: Array<{ tag: string; pts: V2[]; stair: number; lengthIn: number; widthIn: number; thickIn: number }>;
}

const DEAD_PSF = 10;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function planModel(s: DeckStructure): PlanModel | null {
  const f = s.frame;
  if (!f) return null;
  const d = s.design;
  const W = Math.max(...f.zones.map((z) => z.zone.x1));
  const D = Math.max(...f.zones.map((z) => z.zone.y1));
  const outline = shapeOutline(d.shape);
  const attached = d.placement === "attached" && f.ledgers.length > 0;
  const house = d.placement !== "detached";
  const past = deckPast(d.house);
  const houseEnds = { x0: house && past.leftFt > 0 ? past.leftFt * 12 : null, x1: house && past.rightFt > 0 ? W - past.rightFt * 12 : null, wrapLeftIn: past.wrapLeftFt * 12, wrapRightIn: past.wrapRightFt * 12 };

  // ── The grid: rows parallel to the house (the ledger first), columns at the posts.
  const rows: GridRow[] = [];
  if (house) rows.push({ at: 0, label: "", what: attached ? "ledger" : "house" });
  const beams = [...f.beams].sort((a, b) => a.y - b.y);
  for (const b of beams) {
    if (rows.some((r) => Math.abs(r.at - b.y) < 2)) continue;
    rows.push({ at: b.y, label: "", what: "beam", beamId: b.id });
  }
  rows.forEach((r, i) => (r.label = gridLetter(i)));
  const mainPosts = f.posts.filter((p) => !p.roof);
  const colXs = clusterValues(mainPosts.map((p) => p.x), 3);
  const cols: GridLine[] = colXs.map((x, i) => ({ at: x, label: String(i + 1) }));
  const colOf = (x: number) => cols.reduce((best, c, i) => (Math.abs(c.at - x) < Math.abs(cols[best].at - x) ? i : best), 0);
  const rowOf = (y: number) => rows.reduce((best, r, i) => (Math.abs(r.at - y) < Math.abs(rows[best].at - y) ? i : best), 0);

  // ── Footing types: one tag per size, the heaviest-loaded post sets the table figure shown.
  const footings: FootingType[] = [];
  const typeKey = (ft: Footing, post: string) => `${ft.type}|${ft.padIn}|${ft.padThickIn}|${ft.pierIn}|${ft.depthIn}|${post}`;
  const byKey = new Map<string, FootingType>();
  const posts: PlanPost[] = [];
  const ordered = [...f.posts].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const p of ordered) {
    const col = colOf(p.x);
    const row = rowOf(p.y);
    // A roof's post can stand at the same grid point as a deck post: it is named with an R.
    const grid = `${rows[row]?.label ?? "?"}-${cols[col]?.label ?? "?"}${p.roof ? "R" : ""}`;
    const key = typeKey(p.footing, p.size);
    let t = byKey.get(key);
    if (!t) {
      t = {
        tag: "",
        kind: "post",
        type: p.footing.type,
        padIn: p.footing.padIn,
        thickIn: p.footing.padThickIn,
        pierIn: p.footing.pierIn,
        depthIn: p.footing.depthIn,
        at: [],
        post: p.size,
        requiredIn: null,
        basis: p.footing.type === "poured" ? RULE.footing : "Precast pier block, IRC R507.3 exception",
      };
      byKey.set(key, t);
      footings.push(t);
    }
    t.at.push(grid);
    const req = p.footing.required?.roundIn ?? null;
    if (req != null && (t.requiredIn == null || req > t.requiredIn)) t.requiredIn = req;
    posts.push({ post: p, grid, col, row, tag: "" });
  }
  // Tags by size, smallest first.
  footings.sort((a, b) => a.padIn - b.padIn || a.depthIn - b.depthIn);
  footings.forEach((t, i) => (t.tag = `F${i + 1}`));
  for (const pp of posts) pp.tag = byKey.get(typeKey(pp.post.footing, pp.post.size))?.tag ?? "F?";

  // ── The stairs' own footings and pads.
  const stairFootings: PlanModel["stairFootings"] = [];
  const stairPads: PlanModel["stairPads"] = [];
  s.stairs.forEach((st, i) => {
    if (st.level !== "upper") return;
    for (const ft of st.footings) {
      stairFootings.push({ tag: "", x: ft.x, y: ft.y, footing: ft, stair: i });
    }
    const pad = st.members.find((m) => m.role === "pad" && m.nominal === "concrete");
    if (pad && st.pad) {
      const yaw = pad.yaw ?? 0;
      const ux = Math.cos(yaw);
      const uy = Math.sin(yaw);
      // The pad's member box: `sx` across the stair, `sy` along the run (lib/deck/stairs builds it with yawU).
      const hx = pad.sx / 2;
      const hy = pad.sy / 2;
      const pts: V2[] = [
        { x: pad.cx - ux * hx + uy * hy, y: pad.cy - uy * hx - ux * hy },
        { x: pad.cx + ux * hx + uy * hy, y: pad.cy + uy * hx - ux * hy },
        { x: pad.cx + ux * hx - uy * hy, y: pad.cy + uy * hx + ux * hy },
        { x: pad.cx - ux * hx - uy * hy, y: pad.cy - uy * hx + ux * hy },
      ];
      stairPads.push({ tag: "", pts, stair: i, lengthIn: st.pad.lengthIn, widthIn: st.pad.widthIn, thickIn: st.pad.thickIn });
    }
  });
  if (stairFootings.length) {
    const sk = new Map<string, FootingType>();
    for (const sf of stairFootings) {
      const k = `${sf.footing.padIn}|${sf.footing.padThickIn}|${sf.footing.pierIn}|${sf.footing.depthIn}`;
      let t = sk.get(k);
      if (!t) {
        // The stair's own support posts, whatever size the engine stood there (the deck's post size).
        const post = s.stairs[sf.stair]?.members.find((mb) => mb.role === "stair-post")?.nominal ?? "4x4";
        t = { tag: `SF${sk.size + 1}`, kind: "stair-post", type: sf.footing.type, padIn: sf.footing.padIn, thickIn: sf.footing.padThickIn, pierIn: sf.footing.pierIn, depthIn: sf.footing.depthIn, at: [], post, requiredIn: sf.footing.required?.roundIn ?? null, basis: `${RULE.footing} · stair support` };
        sk.set(k, t);
        footings.push(t);
      }
      sf.tag = t.tag;
      t.at.push(`Stair ${sf.stair + 1}`);
    }
  }
  stairPads.forEach((p, i) => {
    p.tag = stairPads.length > 1 ? `SP${i + 1}` : "SP";
    footings.push({ tag: p.tag, kind: "stair-pad", type: "pad", padIn: Math.round(p.widthIn), thickIn: p.thickIn, pierIn: 0, depthIn: 0, at: [`Stair ${p.stair + 1}`], post: null, requiredIn: null, basis: "Landing at the foot of the stair, IRC R311.7.6" });
  });

  // ── The bearing check of every post footing: the deck it carries × (live + dead) on the soil.
  const soil = d.soilPsf;
  const load = f.load;
  const bearing: BearingRow[] = posts.map((pp) => {
    const p = pp.post;
    const trib = p.tributarySqFt;
    const liveLb = trib * load;
    const deadLb = trib * DEAD_PSF;
    const totalLb = liveLb + deadLb;
    const reqAreaSqFt = totalLb / soil;
    const reqDiaIn = Math.sqrt((4 * reqAreaSqFt) / Math.PI) * 12;
    const padAreaSqFt = p.footing.type === "poured" ? (Math.PI * (p.footing.padIn / 2) ** 2) / 144 : (p.footing.padIn * p.footing.padIn) / 144;
    const ratio = padAreaSqFt > 0 ? reqAreaSqFt / padAreaSqFt : 9;
    return { grid: pp.grid, tag: pp.tag, tribSqFt: round1(trib), liveLb: Math.round(liveLb), deadLb: Math.round(deadLb), totalLb: Math.round(totalLb), soilPsf: soil, reqAreaSqFt, reqDiaIn, padIn: p.footing.padIn, padAreaSqFt, ratio, ok: ratio <= 1.0001 };
  });

  // ── Where the crew strings each footing from: the left end of the ledger at the house face (or the deck's back-left corner).
  const points: LayoutPoint[] = posts.map((pp) => ({ name: pp.grid, x: pp.post.x, y: pp.post.y, what: `${pp.tag} · ${pp.post.size} post` }));
  for (const sf of stairFootings) points.push({ name: `${sf.tag}`, x: sf.x, y: sf.y, what: `stair post footing` });
  const diagonals: Diagonal[] = [];
  const front = [...beams].sort((a, b) => b.y - a.y)[0];
  const frontPosts = front ? posts.filter((pp) => pp.post.beamId === front.id).sort((a, b) => a.post.x - b.post.x) : [];
  if (frontPosts.length >= 2) {
    const first = frontPosts[0].post;
    const last = frontPosts[frontPosts.length - 1].post;
    if (house) {
      const lx0 = attached ? Math.min(...f.ledgers.map((l) => l.x0)) : 0;
      const lx1 = attached ? Math.max(...f.ledgers.map((l) => l.x1)) : W;
      diagonals.push({ from: attached ? "Ledger, left end" : "House line, left", to: frontPosts[frontPosts.length - 1].grid, lengthIn: Math.hypot(last.x - lx0, last.y) });
      diagonals.push({ from: attached ? "Ledger, right end" : "House line, right", to: frontPosts[0].grid, lengthIn: Math.hypot(first.x - lx1, first.y) });
    } else {
      const back = [...beams].sort((a, b) => a.y - b.y)[0];
      const backPosts = back ? posts.filter((pp) => pp.post.beamId === back.id).sort((a, b) => a.post.x - b.post.x) : [];
      if (backPosts.length >= 2 && back !== front) {
        diagonals.push({ from: backPosts[0].grid, to: frontPosts[frontPosts.length - 1].grid, lengthIn: Math.hypot(last.x - backPosts[0].post.x, last.y - backPosts[0].post.y) });
        diagonals.push({ from: backPosts[backPosts.length - 1].grid, to: frontPosts[0].grid, lengthIn: Math.hypot(first.x - backPosts[backPosts.length - 1].post.x, first.y - backPosts[backPosts.length - 1].post.y) });
      }
    }
  }
  const origin = attached ? "The left end of the ledger, at the face of the house" : house ? "The deck's left end, at the face of the house" : "The deck's back-left corner";

  // ── Member tags and their checks against the tables.
  const beamTag = new Map<string, string>();
  beams.forEach((b, i) => beamTag.set(b.id, `B${i + 1}`));
  const tags: MemberTag[] = [];
  const maxSpan = Math.max(...f.zones.flatMap((z) => z.spansIn));
  const jt = f.spacingIn;
  // The same table the engine's own joist check reads (lib/deck/checks).
  const allowJoist = joistMaxSpanIn(f.load, f.group, f.joistSize, f.spacingIn);
  // OC LUMBER (2026-11-12): the schedule names the material and Owens Corning's tables.
  const R = rulesFor(f.group);
  const oc = f.group === "OC";
  const stock = oc ? "OC Lumber" : "treated";
  tags.push({
    tag: "J1",
    member: "Joists",
    spec: `${f.joistSize} @ ${jt}" o.c., ${speciesWords(f.species)}`,
    where: "Hung from the ledger, over the beam",
    check: allowJoist ? { actual: ftIn(maxSpan), allowed: ftIn(allowJoist), ratio: maxSpan / allowJoist, rule: R.joist } : undefined,
  });
  tags.push({ tag: "R1", member: "Rim joist", spec: `${oc ? "OC Lumber " : ""}${f.joistSize}${d.framing.doubleRim ? ", doubled" : ""}`, where: "Every open edge; outside joists doubled", check: undefined });
  if (attached) {
    const l = f.ledgers[0];
    tags.push({ tag: "L1", member: "Ledger", spec: `${f.joistSize} ${stock}, ${LEDGER_FASTENER_LABEL[d.ledger.fastener]} @ ${l.spacingIn}" o.c. staggered`, where: "Against the house band, flashed", check: { actual: `${l.spacingIn}" o.c.`, allowed: `${l.spacingIn}" o.c. at ${ftIn(l.joistSpanFt * 12)}`, ratio: 1, rule: l.rule, byTable: true } });
  }
  for (const b of beams) {
    const t = beamTag.get(b.id) ?? "B";
    tags.push({
      tag: t,
      member: `Beam ${t.slice(1)}`,
      spec: `${oc ? "OC Lumber " : ""}${beamLabel(b)}${b.style === "flush" ? ", flush" : ", dropped"}`,
      where: `${ftIn(b.y)} from the house, ${b.postXs.length} posts`,
      check: b.maxSpanIn > 0 ? { actual: ftIn(b.spanIn), allowed: ftIn(b.maxSpanIn), ratio: b.spanIn / b.maxSpanIn, rule: b.table === "DCA6" ? RULE.solidBeam : R.beam } : undefined,
    });
  }
  const tallest = mainPosts.reduce((m, p) => Math.max(m, p.heightIn), 0);
  const tallestMax = mainPosts.reduce((m, p) => (p.heightIn === tallest ? p.maxHeightIn : m), 0);
  tags.push({ tag: "P1", member: "Posts", spec: oc ? "3-ply 2x6 OC Lumber, screwed, braced" : `${d.framing.post} treated, ground-contact`, where: oc ? "On post bases; 2-ply beams notched in, 3-ply capped" : "On post bases, capped to the beam", check: tallestMax > 0 ? { actual: ftIn(tallest), allowed: ftIn(tallestMax), ratio: tallest / tallestMax, rule: R.post } : undefined });
  if (f.blockingRows.length) tags.push({ tag: "BK", member: "Blocking", spec: `${oc ? "OC Lumber " : ""}${f.joistSize} solid`, where: f.blockingRows.some((r) => r.why === "beam") ? "Over the beam, between joists" : "Mid-span rows" });
  return { s, f, W, D, outline, attached, house, houseEnds, cols, rows, posts, footings, bearing, layout: { origin, points, diagonals }, tags, beamTag, stairFootings, stairPads };
}

/** A beam as it is ordered: "(2) 2x10" for built-up, "4x10" solid. */
export function beamLabel(b: Beam): string {
  if (b.spec.kind === "built-up" || /^\d-/.test(String(b.spec.size))) {
    const [n, stock] = String(b.spec.size).split("-");
    return `(${n}) ${stock}`;
  }
  return String(b.spec.size);
}

