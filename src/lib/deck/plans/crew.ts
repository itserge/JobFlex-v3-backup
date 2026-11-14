// THE CREW'S CONSTRUCTION SET (2026-10-23) — pure. The permit set tells the
// building department the deck is right; this short set tells the crew how to
// build it, from the same engine: where each footing goes (measured from the
// house, with the diagonals that prove it square), every piece to cut (each
// stick the engine framed, grouped by size and length, the angled ends
// called out), how to lay out a stringer (the framing square's two numbers,
// the drop at the bottom, the throat that must stay), and the order of the
// work with the inspections where they fall and this deck's own numbers.
import type { StairBuild } from "../stairs";
import { STRINGER_DEPTH_IN, TREAD_NOSING_IN } from "../stairs";
import type { MaterialList } from "../materialList";
import { LEDGER_FASTENER_LABEL } from "../codeTables";
import { railHeldWords } from "../rails";
import { borderWords } from "../surface";
import { OC_POST } from "../ocLumber";
import { Sketch, ftInFrac, inFrac, type ArchScale, type View } from "./draft";
import type { PlanModel } from "./model";
import { beamLabel } from "./model";

/* ── The cut list ──────────────────────────────────────────────────────── */
export interface CutRow {
  tag: string;
  member: string;
  size: string;
  lengthIn: number;
  qty: number;
  cut: string;
}

const ROLE_NAME: Record<string, [string, string]> = { ledger: ["L1", "Ledger"], beam: ["B", "Beam ply"], joist: ["J1", "Joist"], rim: ["R1", "Rim joist"], blocking: ["BK", "Blocking"], brace: ["KB", "Knee brace"] };

export function cutList(m: PlanModel): CutRow[] {
  const { f } = m;
  const clipped = m.s.design.shape.kind === "rect" && m.s.design.shape.front?.kind === "clipped";
  const longest = Math.max(...f.sticks.filter((st) => st.role === "joist").map((st) => st.lengthIn), 0);
  const rows = new Map<string, CutRow>();
  const add = (r: Omit<CutRow, "qty">, n = 1) => {
    const key = `${r.tag}|${r.member}|${r.size}|${Math.round(r.lengthIn * 8)}|${r.cut}`;
    const row = rows.get(key) ?? { ...r, qty: 0 };
    row.qty += n;
    rows.set(key, row);
  };
  for (const st of f.sticks) {
    if (st.role === "post") continue;
    const [tag, member] = ROLE_NAME[st.role] ?? [st.role.toUpperCase().slice(0, 2), st.role];
    const turned = st.yaw != null && Math.abs(Math.sin(st.yaw * 2)) > 0.05;
    let cut = "square both ends";
    if (st.role === "rim" && turned) cut = "22-1/2° mitre each end";
    else if (st.role === "rim" && clipped && st.cy > m.D * 0.5) cut = "22-1/2° mitre at the clipped corners";
    else if (st.role === "joist" && clipped && st.lengthIn < longest - 1) cut = "45° plan cut at the clipped rim";
    else if (st.role === "brace") cut = "45° each end";
    else if (st.role === "beam") cut = "splices over posts only";
    const t = st.role === "beam" ? m.beamTag.get(m.f.beams.find((b) => Math.abs(b.y - st.cy) < 6)?.id ?? "") ?? "B1" : tag;
    add({ tag: t, member, size: st.nominal, lengthIn: st.lengthIn, cut });
  }
  for (const pp of m.posts) {
    // The post stands on a base 1" off the pier; cut it in place to the beam's underside.
    add({ tag: "P1", member: "Post", size: pp.post.size, lengthIn: Math.max(6, pp.post.heightIn - 1), cut: "about — cut in place under the beam" });
  }
  m.s.stairs.forEach((st, i) => {
    if (st.level !== "upper") return;
    const stringers = st.members.filter((mb) => mb.role === "stringer");
    if (stringers.length) add({ tag: `S${i + 1}`, member: "Stringer", size: st.stringers.nominal, lengthIn: st.stringers.lengthIn, cut: "laid out per C-3" }, stringers.length);
    const posts = st.members.filter((mb) => mb.role === "stair-post");
    for (const mb of posts) add({ tag: `S${i + 1}`, member: "Stair post", size: mb.nominal, lengthIn: mb.sz, cut: "cut in place" });
    const beam = st.members.filter((mb) => mb.role === "stair-beam");
    for (const mb of beam) add({ tag: `S${i + 1}`, member: "Stair beam", size: mb.nominal, lengthIn: mb.lengthIn, cut: "square both ends" });
    const kick = st.members.filter((mb) => mb.role === "kicker");
    for (const mb of kick) add({ tag: `S${i + 1}`, member: "Kicker", size: mb.nominal, lengthIn: mb.lengthIn, cut: "square both ends" });
  });
  const order = ["L1", "B1", "B2", "B3", "P1", "J1", "R1", "BK", "KB"];
  return [...rows.values()].sort((a, b) => {
    const ia = order.indexOf(a.tag);
    const ib = order.indexOf(b.tag);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.member.localeCompare(b.member) || b.lengthIn - a.lengthIn;
  });
}

/* ── The stringer ──────────────────────────────────────────────────────── */
export interface StringerLayout {
  rise: number;
  run: number;
  risers: number;
  treads: number;
  treadThick: number;
  /** Cut off the bottom so the first riser matches the rest (the tread's thickness). */
  drop: number;
  totalRise: number;
  totalRun: number;
  lengthIn: number;
  /** Solid wood left under the deepest cut, measured square to the stringer's edge; AWC asks 5" at least. */
  throat: number;
  count: number;
  spacing: number;
}

export function stringerLayout(st: StairBuild, treadThick: number): StringerLayout {
  const rise = st.riserIn;
  const run = st.runIn;
  const hyp = Math.hypot(rise, run);
  const cutDepth = (rise * run) / hyp;
  return {
    rise,
    run,
    risers: st.risers,
    treads: Math.max(0, st.risers - 1),
    treadThick,
    drop: treadThick,
    totalRise: st.risers * rise,
    totalRun: Math.max(0, st.risers - 1) * run,
    lengthIn: st.stringers.lengthIn,
    throat: STRINGER_DEPTH_IN - cutDepth,
    count: st.stringers.count,
    spacing: st.stringers.spacingIn,
  };
}

/**
 * One stringer laid out on its 2x12, to scale, measured from the deck's surface (y down): the board's original top
 * edge runs through the step tips (y = t + x·rise/run, t the tread's thickness); each notch is a level cut (a tread)
 * and a plumb cut (a riser); the top is a plumb cut against the rim one riser down, the foot a level cut on the
 * landing — the last riser short by the tread's thickness (the drop). The throat is what is left under a notch.
 */
export function stringerView(L: StringerLayout, sc: ArchScale): View {
  const k = new Sketch(sc.k);
  const p = (v: number) => k.p(v);
  const { rise, run, treadThick: t } = L;
  const R = L.risers;
  const T = L.treads;
  const tan = rise / run;
  const cos = run / Math.hypot(rise, run);
  const deep = STRINGER_DEPTH_IN / cos;
  const pts: number[] = [0, rise + t];
  for (let i = 1; i <= T; i++) {
    pts.push(i * run, i * rise + t);
    pts.push(i * run, i < T ? (i + 1) * rise + t : R * rise);
  }
  const xf = Math.max(0, (R * rise - t - deep) / tan);
  pts.push(xf, R * rise);
  pts.push(0, t + deep);
  k.poly(pts, "medium", "wood");
  // The board before it was cut: its top edge through the tips.
  k.line(0, t, T * run, t + T * rise, "phantom");
  // Every step numbered on its tread cut.
  for (let i = 1; i <= T; i++) k.text((i - 0.5) * run, i * rise + t - p(0.05), String(i), "sm", { anchor: "middle", bold: true, tone: "muted" });
  // A riser and a tread, the drop, the throat.
  k.dim(run, rise + t, run, 2 * rise + t, -0.16, `RISE ${inFrac(rise)}`, true);
  k.dim(run, 2 * rise + t, 2 * run, 2 * rise + t, 0.14, `RUN ${inFrac(run)}`, true);
  k.dim(T * run, T * rise + t, T * run, R * rise, -0.16, `${inFrac(rise - t)} (DROP ${inFrac(t)})`, true);
  // The throat: square to the board's edge, from an inside corner to the bottom edge.
  const ci = Math.max(1, Math.floor(T / 2));
  const cx = (ci - 1) * run;
  const cy = ci * rise + t;
  const nx = -Math.sin(Math.atan(tan));
  const ny = Math.cos(Math.atan(tan));
  k.dim(cx, cy, cx + nx * L.throat, cy + ny * L.throat, 0.0001, `THROAT ${inFrac(L.throat)} ≥ 5"`, true);
  // The totals.
  // The deck's surface the rise is measured from, and the total down to the landing.
  k.line(-p(0.55), 0, run * 0.6, 0, "light");
  k.text(run * 0.62, -p(0.04), "DECK SURFACE", "xs", { tone: "muted", bold: true });
  k.dim(-p(0.3), 0, -p(0.3), R * rise, -0.0001, `TOTAL RISE ${ftInFrac(R * rise, 8)} = ${R} × ${inFrac(rise)}`);
  k.dim(0, R * rise + p(0.42), T * run, R * rise + p(0.42), 0.0001, `TOTAL RUN ${ftInFrac(T * run, 8)}`);
  k.leader(0, rise + t + (deep - rise) / 2, -p(0.35), rise + t + (deep - rise) / 2 - p(0.35), ["PLUMB CUT — HANGS ON A", "CONNECTOR AT THE RIM"], "dot", "sm");
  k.leader((xf + T * run) / 2, R * rise, (xf + T * run) / 2 - p(0.2), R * rise + p(0.75), ["LEVEL CUT ON THE LANDING;", "NOTCH 1-1/2\" × 3-1/2\" FOR THE KICKER"], "dot", "sm");
  return k.view("stringer", "Stringer layout", sc.label, 0.1);
}

/* ── The order of the work ─────────────────────────────────────────────── */
export interface BuildPhase {
  title: string;
  steps: string[];
  /** An inspection the building department may ask before the next phase. */
  hold?: string;
}

export function buildSequence(m: PlanModel, list: MaterialList): BuildPhase[] {
  const { f, s } = m;
  const d = s.design;
  const ledger = f.ledgers[0];
  const front = [...f.beams].sort((a, b) => b.y - a.y)[0];
  const out: BuildPhase[] = [];
  out.push({
    title: "Lay out",
    steps: [
      `Call 811; wait for the marks. Find the datum: ${m.layout.origin.toLowerCase()}.`,
      `String the beam line ${front ? ftInFrac(front.y, 8) : ""} out from the house and mark every footing from the C-1 table.`,
      ...(m.layout.diagonals.length ? [`Check square: ${m.layout.diagonals.map((dg) => `${dg.from.toLowerCase()} → ${dg.to} ${ftInFrac(dg.lengthIn, 8)}`).join("; ")}.`] : []),
    ],
  });
  out.push({
    title: "Footings",
    steps: [
      `Dig ${m.posts.length} holes to ${inFrac(d.frostIn)} below grade, on undisturbed soil: ${m.footings.filter((x) => x.kind === "post").map((x) => `${x.at.length} × ${x.tag} (${inFrac(x.padIn)} pad)`).join(", ")}.`,
      `Pour the pads, then the ${inFrac(m.posts[0]?.post.footing.pierIn ?? 12)} piers in tubes to 1" above grade; set the post-base anchors wet.`,
    ],
    hold: "Footing inspection — before the concrete, where required.",
  });
  if (m.attached && ledger) {
    out.push({
      title: "Ledger",
      steps: [
        "Siding off where the ledger goes; membrane on the band joist; check the band is solid 2x on the foundation — never brick, never a cantilevered floor.",
        `Hang the ${f.joistSize} ledger at the deck's height less the decking; ${LEDGER_FASTENER_LABEL[d.ledger.fastener]} at ${ledger.spacingIn}" o.c., staggered — ${f.ledgers.reduce((a, l) => a + l.fasteners, 0)} in all (detail 5/S-501).`,
        "Cap flashing over the top, lapped behind the siding.",
      ],
    });
  }
  out.push({
    title: "Posts and beams",
    steps: [
      d.framing.post === OC_POST
        ? `Set the post bases; build each post from three 2x6 OC boards, #10 x 4" stainless screws 8" apart, staggered, from both faces; stand them; cut each in place to the beam's underside (about ${ftInFrac(Math.max(6, (m.posts[0]?.post.heightIn ?? 12) - 1), 8)}) — a 2-ply beam sits in a notch cut in the post, a 3-ply beam in a post cap.`
        : `Set the post bases; stand the ${d.framing.post} posts; cut each in place to the beam's underside (about ${ftInFrac(Math.max(6, (m.posts[0]?.post.heightIn ?? 12) - 1), 8)}).`,
      ...f.beams.map((b) => `Beam ${m.beamTag.get(b.id) ?? ""}: ${beamLabel(b)} on post caps, splices over posts only, crowned up.`),
      ...(f.hardware.braces ? [`Knee braces at the ${f.hardware.braces} corner posts, 2 ft down and 2 ft out, a 1/2" lag each end.`] : []),
    ],
  });
  out.push({
    title: "Joists",
    steps: [
      `Lay out the joists at ${f.spacingIn}" o.c. from the left end on the ledger and the beam — ${f.joists.filter((j) => !j.sister).length} joists, ${f.joistSize}.`,
      `Hang every joist on the ledger (${f.hardware.hangers} hangers, every hole nailed); a tie at every joist on the beam (${f.hardware.ties}).`,
      `Rim and doubled outside joists; ${f.hardware.rimScrews} structural screws, three per joist end; blocking where tagged BK.`,
      ...(m.attached ? ["Lateral hold-downs LD-1 and LD-2 within 24\" of each end, through to the house joists (detail 2/S-501)."] : []),
      ...(d.framing.joistTape ? ["Joist tape over every top."] : []),
    ],
    hold: "Framing inspection — before the decking goes on, where required.",
  });
  out.push({
    title: "Decking and fascia",
    steps: [`${f.decking.label}${s.surface?.border ? `, with ${borderWords(s.surface)} (set the border first, mitred at the corners, on its backing along the sides; the field runs inside it)` : ""}: start square at the house, gaps and fasteners per the maker; ${f.decking.family === "composite" || f.decking.family === "pvc" ? "hidden clips" : "two screws per joist"}.`, "Fascia on the open edges, screwed and plugged."],
  });
  if (s.stairs.length) {
    out.push({
      title: "Stairs",
      steps: s.stairs.map((st, i) => `Stair ${i + 1}: ${st.pad ? "pour the landing pad, " : ""}cut ${st.stringers.count} stringers per C-3, hang them on connectors at ${st.stringers.spacingIn}" o.c., kicker anchored; ${st.risers} risers of ${inFrac(st.riserIn)}, treads ${inFrac(st.runIn + TREAD_NOSING_IN)}.`),
    });
  }
  if (s.rails.on) {
    out.push({
      title: "Guards",
      steps: [`${s.rails.label}, ${s.rails.heightIn}" — ${Math.round(s.rails.totalLf)} ft, posts ${s.rails.topPosts || s.rails.postKind === "metal" ? railHeldWords(s.rails) : "through-bolted to the blocked rim"}, no opening a 4" sphere passes.`, "Handrails on every stair of four or more risers, 34\"–38\" over the nosings."],
    });
  }
  out.push({ title: "Finish", steps: ["Walk the deck with this set; clean up; photos of every connection for the file."], hold: "Final inspection." });
  void list;
  return out;
}
