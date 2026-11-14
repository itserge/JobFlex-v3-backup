// THE DETAILS AND THE STAIR SECTION (2026-10-23) — pure.
//
// The engine already draws the details a reviewer expects (lib/deck/permit:
// the ledger, the lateral load connection, the post, beam and footing, the
// guard post, the bracing, the roof's connections) from this deck's own
// numbers. Here they are carried into the plan set's drafting — real scale,
// line weights, hatches, lettering — and joined by what the sample sets do
// not draw: the ledger's fastener pattern with the code's edge distances, the
// stair's stringer at the rim, and a section through the stair with every
// riser and tread dimensioned.
import type { StairBuild } from "../stairs";
import { TREAD_NOSING_IN, STRINGER_DEPTH_IN, HANDRAIL_HEIGHT_IN } from "../stairs";
import { detailDrawings, lateralDevices, type DetailDrawing, type DrawItem } from "../permit";
import { LEDGER_FASTENER_LABEL } from "../codeTables";
import { Sketch, ftInFrac, inFrac, type ArchScale, type DItem, type Fill, type Pen, type TextSize, type View } from "./draft";
import type { PlanModel } from "./model";

/* ── The engine's details, redrawn ─────────────────────────────────────── */

const PEN_FOR: Record<string, Pen> = { ink: "medium", wood: "medium", concrete: "medium", steel: "medium", hatch: "light", dash: "hidden", thin: "fine", dim: "dim", grade: "heavy", glass: "fine" };
const FILL_FOR: Record<string, Fill> = { wood: "wood", concrete: "concrete", steel: "steel", hatch: "poche", glass: "glass" };

/** A permit.ts drawing (inches, Z up) as plan-set items (y down). */
export function fromDrawing(items: DrawItem[]): DItem[] {
  const out: DItem[] = [];
  for (const it of items) {
    switch (it.t) {
      case "rect":
        out.push({ k: "poly", pts: [it.x, -(it.z + it.h), it.x + it.w, -(it.z + it.h), it.x + it.w, -it.z, it.x, -it.z], pen: PEN_FOR[it.cls] ?? "medium", fill: FILL_FOR[it.cls] ?? "none", closed: true });
        break;
      case "line":
        out.push({ k: "line", x1: it.x1, y1: -it.z1, x2: it.x2, y2: -it.z2, pen: PEN_FOR[it.cls] ?? "medium" });
        break;
      case "poly": {
        const pts: number[] = [];
        for (let i = 0; i + 1 < it.pts.length; i += 2) pts.push(it.pts[i], -it.pts[i + 1]);
        out.push({ k: "poly", pts, pen: PEN_FOR[it.cls] ?? "medium", fill: it.closed ? FILL_FOR[it.cls] ?? "none" : "none", closed: !!it.closed });
        break;
      }
      case "circle":
        out.push({ k: "circle", x: it.x, y: -it.z, r: it.r, pen: it.cls === "steel" ? null : PEN_FOR[it.cls] ?? "medium", fill: FILL_FOR[it.cls] ?? "none" });
        break;
      case "text": {
        const size: TextSize = it.cls === "label" ? "md" : "sm";
        out.push({ k: "text", x: it.x, y: -it.z, s: it.s.toUpperCase(), size, anchor: it.anchor, rot: it.rot || undefined, bold: it.cls === "label", halo: true });
        break;
      }
      case "dim":
        out.push({ k: "dim", x1: it.x1, y1: -it.z1, x2: it.x2, y2: -it.z2, off: 0.0001, label: it.label.toUpperCase(), minor: true });
        break;
    }
  }
  return out;
}

export interface PlanDetail {
  key: "ledger" | "lateral" | "post" | "guard" | "guard2" | "bracing" | "pattern" | "stringer" | "roof" | "uplift" | "roofBracing";
  title: string;
  notes: string[];
  build: (sc: ArchScale) => View;
}

/** The details of the floor, in the order the framing plan's bubbles number them. */
export function floorDetails(m: PlanModel): PlanDetail[] {
  const s = m.s;
  const out: PlanDetail[] = [];
  const eng = detailDrawings(s, "floor");
  const find = (t: string) => eng.find((d) => d.title === t);
  const wrap = (key: PlanDetail["key"], dt: DetailDrawing): PlanDetail => ({
    key,
    title: dt.title,
    notes: dt.notes,
    build: (sc) => {
      const k = new Sketch(sc.k);
      k.items.push(...fromDrawing(dt.drawing.items));
      return k.view(`det-${key}`, dt.title, sc.label, 0.08);
    },
  });
  const ledger = find("Ledger attachment");
  if (ledger) out.push(wrap("ledger", ledger));
  const lateral = find("Lateral load connection");
  if (lateral) out.push(wrap("lateral", lateral));
  const post = find("Post, beam and footing");
  if (post) out.push(wrap("post", post));
  const guard = find("Guard post");
  if (guard) out.push(wrap("guard", guard));
  if (m.attached) out.push(ledgerPattern(m));
  const st = s.stairs.find((x) => x.level === "upper" && x.kind === "flight" && x.risers > 0);
  if (st) out.push(stringerDetail(m, st));
  const bracing = find("Lateral bracing, free-standing");
  if (bracing) out.push(wrap("bracing", bracing));
  // A side of the deck whose rail is mounted the other way (2026-11-13) has its own guard detail — last, so the other
  // details keep the numbers the framing plan's bubbles call them by.
  const guard2 = eng.find((dt) => dt.title.startsWith("Guard post, "));
  if (guard2) out.push(wrap("guard2", guard2));
  return out;
}

/* ── The ledger's fastener pattern (IRC R507.9.1.3) ────────────────────── */
function ledgerPattern(m: PlanModel): PlanDetail {
  const f = m.f;
  const d = m.s.design;
  const run = f.ledgers[0];
  const H = f.joistSize === "2x12" ? 11.25 : f.joistSize === "2x8" ? 7.25 : f.joistSize === "2x6" ? 5.5 : 9.25;
  const spacing = run?.spacingIn ?? 16;
  const L = Math.max(48, spacing * 3 + 8);
  return {
    key: "pattern",
    title: "Ledger fastener pattern",
    notes: [
      `${LEDGER_FASTENER_LABEL[d.ledger.fastener]} at ${spacing}" on centre along the ledger, staggered top and bottom row — ${run?.fasteners ?? 0} on this ledger (${run?.rule ?? "IRC Table R507.9.1.3(1)"}).`,
      `In the ledger: 2" from the top edge and 3/4" from the bottom edge, 2" from the ends, rows at least 1-5/8" apart; in the house band joist: 3/4" from its top, 2" from its bottom (IRC Table R507.9.1.3(2)). Lag tips through the band, washers under every head.`,
      `Two 1,500-lb lateral load devices within 24" of each end of the deck (IRC R507.9.2) — LD-1 and LD-2 on S-102.`,
    ],
    build: (sc) => {
      const k = new Sketch(sc.k);
      const p = (v: number) => k.p(v);
      // The band joist behind (its own outline), the ledger in front, the joists hung on it (dashed, beyond).
      k.rect(-4, -(H + 1.5), L + 8, H + 3, "hidden", "none");
      k.rect(0, -H, L, H, "medium", "wood");
      for (let x = 8; x < L - 2; x += 16) k.rect(x - 0.75, -H, 1.5, H, "fine", "none");
      // Flashing over the top.
      k.poly([-4, -H - 1.6, L + 4, -H - 1.6, L + 4, -H - 0.2, L + 3, -H - 0.2], "medium", "none", false);
      // The lags: top row 2" down, bottom row 3/4"… shown at their edge distances, staggered.
      const top = 2;
          let i = 0;
      for (let x = 2; x <= L - 2 + 1e-6; x += spacing / 2) {
        // Top row 2" down from the ledger's top edge; bottom row 3/4" up from its bottom edge (plus the lag's radius).
        const zz = i % 2 === 0 ? -H + top : -(0.75 + 0.5);
        k.circle(x, zz, 0.5, "medium", "steel");
        k.line(x - 0.9, zz, x + 0.9, zz, "fine");
        i++;
        if (i > 12) break;
      }
      k.dim(L + 4, -H, L + 4, -H + top, -0.16, `2" MIN.`, true);
      k.dim(L + 4, -(0.75 + 0.5), L + 4, 0, -0.16, `3/4" MIN.`, true);
      k.dim(2, -H - p(0.32), 2 + spacing, -H - p(0.32), 0.0001, `${spacing}" O.C., EACH ROW`, true);
      k.dim(0, 4, 2, 4, -0.1, `2"`, true);
      k.text(L / 2, 2.8 + p(0.35), `${f.joistSize} P.T. LEDGER — ${LEDGER_FASTENER_LABEL[d.ledger.fastener].toUpperCase()}, STAGGERED`, "sm", { anchor: "middle", bold: true });
      k.text(L / 2, 2.8 + p(0.5), "HOUSE BAND JOIST BEHIND (DASHED) · METAL FLASHING OVER", "xs", { anchor: "middle", tone: "muted" });
      return k.view("det-pattern", "Ledger fastener pattern", sc.label, 0.08);
    },
  };
}

/* ── The stair's stringer at the rim and at its foot ───────────────────── */
function stringerDetail(m: PlanModel, st: StairBuild): PlanDetail {
  const f = m.f;
  const depth = f.joistSize === "2x12" ? 11.25 : f.joistSize === "2x8" ? 7.25 : 9.25;
  return {
    key: "stringer",
    title: "Stringer at the rim",
    notes: [
      `${st.stringers.count} ${st.stringers.nominal} P.T. cut stringers at ${st.stringers.spacingIn}" on centre (${st.stringers.spacingIn < 16 ? "composite treads ask for 12" : "16"}"), each hung on the rim with a sloped stringer connector and its listed fasteners — ${st.hardware.stringerConnectors} in all.`,
      `At least 5" of solid stringer below every cut (the throat); a cut stringer spans no more than 6 ft between supports${st.midSupport ? " — this one has a beam on posts midway" : ""} (AWC DCA 6).`,
      `At the foot a treated 2x4 kicker anchored to the ${st.pad ? "pad" : "landing"}; the stringers notched over it and fastened.`,
    ],
    build: (sc) => {
      const k = new Sketch(sc.k);
      const p = (v: number) => k.p(v);
      const r = st.riserIn;
      const run = st.runIn;
      const t = 1;
      // The rim (in section) and the decking on the deck side.
      k.rect(-1.5, 0, 1.5, depth, "cut", "woodCut");
      k.rect(-20, -t, 20 + 0, t, "medium", "wood");
      k.rect(-20, 0, 18.5, depth, "light", "wood");
      // The stringer: hung below the decking, its top line under the tread backs.
      const theta = Math.atan2(r, run);
      const len = 46;
      const dx = Math.cos(theta) * len;
      const dz = Math.sin(theta) * len;
      const d = STRINGER_DEPTH_IN / Math.cos(theta);
      const topAt = r + t;
      k.poly([0, topAt - 1, dx, topAt + dz - 1, dx, topAt + dz - 1 + d, 0, topAt - 1 + d], "medium", "wood");
      // Two steps cut into it, the treads and the risers.
      for (let i = 0; i < 2; i++) {
        const x0 = i * run;
        const z0 = topAt + i * r;
        k.rect(x0 - TREAD_NOSING_IN, z0 - t, run + TREAD_NOSING_IN, t, "medium", "wood");
        k.rect(x0, z0 - t - r + t, 0.75, r - t, "light", "wood");
      }
      // The connector: a steel strap folded under the stringer's top and onto the rim's face.
      k.poly([0.1, topAt - 0.2, 0.1, topAt + 6, 3.2, topAt + 6.5], "medium", "none", false);
      k.rect(0, topAt - 0.3, 0.25, 7, null, "steel");
      k.leader(1.6, topAt + 5.6, 1.6 + p(0.5), topAt + 5.6 + p(0.45), ["SLOPED STRINGER CONNECTOR", "WITH ITS LISTED FASTENERS"], "arrow", "sm");
      k.leader(-0.75, depth * 0.55, -0.75 - p(0.45), depth + p(0.35), [`${f.joistSize} RIM (R1)`], "dot", "sm");
      k.leader(dx * 0.6, topAt + dz * 0.6 + d * 0.6, dx * 0.6 + p(0.35), topAt + dz * 0.6 + d + p(0.2), [`${st.stringers.nominal} P.T. STRINGER`, `${st.stringers.count} @ ${st.stringers.spacingIn}" O.C.`], "dot", "sm");
      k.dim(run, topAt, run, topAt + r, -0.14, inFrac(r), true);
      k.dim(0, topAt - t - p(0.12), run, topAt - t - p(0.12), 0.0001, inFrac(run), true);
      return k.view("det-stringer", "Stringer at the rim", sc.label, 0.08);
    },
  };
}

/* ── The section through a stair ────────────────────────────────────────── */
export function stairSection(m: PlanModel, st: StairBuild, n: number, sc: ArchScale): View {
  const k = new Sketch(sc.k);
  const p = (v: number) => k.p(v);
  const f = m.f;
  const S = f.surfaceIn;
  const r = st.riserIn;
  const run = st.runIn;
  const R = st.risers;
  const T = Math.max(0, R - 1);
  const t = 1;
  const landZ = S - R * r;
  const totalRun = T * run;
  // The deck's edge: decking, rim, a joist.
  const stub = 20;
  k.rect(-stub, -S, stub, t, "medium", "wood");
  k.rect(-1.5, -f.joistTopIn, 1.5, f.joistTopIn - f.joistBottomIn, "cut", "woodCut");
  k.rect(-stub, -f.joistTopIn, stub - 1.5, f.joistTopIn - f.joistBottomIn, "light", "wood");
  // The steps: treads (with their nosing) and risers.
  for (let i = 1; i <= T; i++) {
    const z = S - i * r;
    const x0 = (i - 1) * run;
    k.rect(x0 - TREAD_NOSING_IN, -z, run + TREAD_NOSING_IN, t, "medium", "wood");
    k.rect(x0, -(z + r - t), 0.75, r - t, "light", "wood");
  }
  k.rect(totalRun, -(landZ + r - 0), 0.75, r - t, "light", "wood");
  // The stringer under them: its top line on the tread backs, 11-1/4" deep, cut at the foot onto the landing.
  const theta = Math.atan2(r, run);
  const d = STRINGER_DEPTH_IN / Math.cos(theta);
  const zTop = S - r - t;
  const tan = Math.tan(theta);
  const xt = (zTop - landZ) / tan;
  const xb = Math.max(0, (zTop - d - landZ) / tan);
  k.poly([0, -zTop, xt, -landZ, xb, -landZ, 0, -Math.max(landZ, zTop - d)], "hidden", "none");
  // The landing: a pad (or the patio) at the foot.
  const padLen = st.pad?.lengthIn ?? 42;
  if (st.pad) {
    k.rect(totalRun - 6, -landZ, padLen, st.pad.thickIn, "cut", "concrete");
    k.leader(totalRun - 6 + padLen * 0.55, -(landZ - st.pad.thickIn), totalRun - 6 + padLen * 0.55 - p(0.15), -(landZ - st.pad.thickIn) + p(0.32), [`${inFrac(st.pad.thickIn)} CONC. LANDING (SP)`], "dot", "sm");
  }
  k.rect(totalRun + 0.25, -(landZ + 1.5), 3.5, 1.5, "medium", "wood");
  // The ground.
  k.rect(-stub, -(landZ - (st.pad?.thickIn ?? 0)), totalRun + padLen + stub + 12, p(0.07), null, "earth");
  k.line(-stub, -(landZ - (st.pad?.thickIn ?? 0)), totalRun + padLen + 12, -(landZ - (st.pad?.thickIn ?? 0)), "heavy");
  // The handrail, 36" over the nosing line.
  if (st.rail.sides > 0) {
    const nose = (x: number) => S - (x / Math.max(1, totalRun + run)) * (S - landZ);
    const hx0 = 0;
    const hx1 = totalRun;
    k.line(hx0, -(nose(hx0) + HANDRAIL_HEIGHT_IN), hx1, -(nose(hx1) + HANDRAIL_HEIGHT_IN), "medium");
    k.line(hx0, -(nose(hx0) + HANDRAIL_HEIGHT_IN), hx0, -S, "light");
    k.line(hx1, -(nose(hx1) + HANDRAIL_HEIGHT_IN), hx1, -(landZ + r), "light");
    k.dim(totalRun * 0.55, -nose(totalRun * 0.55), totalRun * 0.55, -(nose(totalRun * 0.55) + HANDRAIL_HEIGHT_IN), -0.14, `34"–38"`, true);
    k.leader(totalRun * 0.3, -(nose(totalRun * 0.3) + HANDRAIL_HEIGHT_IN), totalRun * 0.3 + p(0.25), -(nose(totalRun * 0.3) + HANDRAIL_HEIGHT_IN) - p(0.3), ["GRASPABLE HANDRAIL"], "dot", "sm");
  }
  // The dimensions: one riser and one tread named, the total rise and run.
  k.dim(run, -(S - r), run, -(S - 2 * r), -0.14, inFrac(r), true);
  k.dim(run, -(S - 2 * r) + p(0.12), 2 * run, -(S - 2 * r) + p(0.12), 0.0001, inFrac(run), true);
  k.dim(-stub - p(0.2), -S, -stub - p(0.2), -landZ, 0.18, `${R} RISERS @ ${inFrac(r)} = ${ftInFrac(R * r, 8)}`);
  k.dim(0, -landZ + p(0.35) + (st.pad?.thickIn ?? 0), totalRun, -landZ + p(0.35) + (st.pad?.thickIn ?? 0), -0.12, `${T} TREADS @ ${inFrac(run)} = ${ftInFrac(totalRun, 8)}`);
  k.leader(totalRun * 0.62, -(S - R * r * 0.62) + 6, totalRun * 0.62 + p(0.3), -(S - R * r * 0.62) + p(0.5), [`(${st.stringers.count}) ${st.stringers.nominal} STRINGERS @ ${st.stringers.spacingIn}"`], "dot", "sm");
  k.leader(-1, -(S - 4), -1 - p(0.25), -(S + p(0.3)), [`CONNECTOR, 6/S-501`], "dot", "sm");
  if (st.midSupport) k.text(totalRun * 0.45, -(landZ + 3), "BEAM ON POSTS AT MID-RUN (SF1)", "sm", { anchor: "middle", tone: "muted" });
  k.datum(totalRun + padLen + p(0.25), -S, "T.O. DECK", `+${ftInFrac(S, 8)}`);
  k.datum(totalRun + padLen + p(0.25), -landZ, "LANDING", `+${ftInFrac(Math.max(0, landZ), 8)}`);
  return k.view(`stair-${n}`, `Stair ${n} section`, sc.label);
}

export { lateralDevices };
