// Fence material takeoff — layout in, bill of materials out. Pure math, no
// imports beyond the catalog and the slope rules, fully checked by
// scripts/qa/fence-package.check.ts.
//
// Ported 2026-09-18 from the owner's FenceScan app (lib/fence/takeoff.ts)
// with JobFlex's layout shape: runs are the traced polylines (corners
// inside them, ends where they stop), openings carry their own width and
// kind, and the terrain report says how many code-sized steps the crew
// builds. The quantity rules are FenceScan's, unchanged:
//
//   sections between posts every `postSpacingFt`, counted PER RUN;
//   a post at every section boundary, plus corners, ends and two heavy
//   posts per gate; concrete from the hole that actually gets dug (auger
//   rule, frost-aware depth); rails × sections; pickets from the fabric
//   length and the picket pitch (taller fences use LONGER pickets, not
//   more); prefab panels per section; chain-link fabric, top rail, tension
//   wire and the terminal hardware; caps per system; gate kits; stain by
//   the square foot, two coats; tear-out by the foot.

import { effectiveSpacingFt, fenceType, heightFactor, takesCedarGrade, TERRAIN_FACTOR, type FenceType, type FenceTypeId, type Terrain } from "./catalog";
import { burialFt } from "./slope";

/** One drawn run: a polyline with corners inside it and ends where it stops. */
export interface FenceRunInput {
  /** Length along the ground, ft (gate openings included). */
  lengthFt: number;
  /** Direction changes inside the run. */
  corners: number;
  /** A ring back to its own start has no ends. */
  closed?: boolean;
}

/** One gate or door in the fence. */
export interface FenceOpeningInput {
  widthFt: number;
  kind: "gate" | "door";
  /** The page's label for it ("Double gate"). */
  label?: string;
  /** An arched top, a slatted door — the kit costs more, the posts do not. */
  variant?: string;
}

export interface FenceLayoutInput {
  type: FenceTypeId | string;
  heightFt: number;
  runs: FenceRunInput[];
  openings: FenceOpeningInput[];
  terrain: Terrain;
  /** Extra material percentage on cut goods, default 10. */
  wastePct?: number;
  /** Tear-out of an existing fence, LF (0 = none). */
  removalLf?: number;
  /** Stain / seal both faces after install (wood only). */
  stain?: boolean;
  /** Sections that must STEP down a slope (from the terrain report) — each
   *  needs an extended post and extra set-and-trim time. */
  steppedSections?: number;
  /** Post system upgrade (wood fences): galvanized steel, 6×6, post-on-pipe
   *  (a pressure-treated or clear cedar post sleeved over a steel pipe), or
   *  3×3 black steel with brackets. Each carries its own structural warranty
   *  (lib/fence/pricing POST_SYSTEMS). */
  postUpgrade?: PostSystem | null;
  /** Cedar board grade (wood fences): #2 & better, #1 tight-knot, clear. */
  boardGrade?: BoardGrade | null;
  /** Hot-dip galvanized (standard) or stainless — no rust streaks on cedar. */
  fasteners?: "galvanized" | "stainless" | null;
  /** Standard or heavy-duty gate hardware (ball-bearing hinges, heavy latch, cane bolt on doubles). */
  gateHardware?: "standard" | "heavy-duty" | null;
  /** Gates hang on black steel posts even on a wood-post fence (wood gate posts sag). */
  steelGatePosts?: boolean;
  /** The crew clears the 2-ft path along the line (else the owner does). */
  clearLine?: boolean;
  /** Excavated soil is hauled away (else spread along the line). */
  haulSoil?: boolean;
  /** Line-post spacing override, ft o.c. (stick and mesh builds only). */
  postSpacingFt?: number | null;
  /** Code frost depth for the job's market, inches — drives burial and concrete. */
  frostIn?: number;
}

export type PostSystem = "steel" | "6x6" | "post-on-pipe" | "cedar-post-on-pipe" | "black-steel";
export type BoardGrade = "standard" | "tight-knot-1" | "clear";

export type BomUnit = "ea" | "lf" | "bag" | "box" | "gal";

export interface BomLine {
  key: string;
  label: string;
  qty: number;
  unit: BomUnit;
}

export interface FenceTakeoff {
  /** Fence fabric length (gate openings excluded), ft. */
  netFenceLf: number;
  /** Drawn length incl. openings, ft. */
  totalLf: number;
  sections: number;
  spacingFt: number;
  posts: { line: number; corner: number; end: number; gate: number; total: number };
  /** Post lengths the crew orders: standard, and at stepped sections. */
  postLengthFt: { base: number; step: number };
  burialFt: number;
  bom: BomLine[];
  /** Crew-hours estimate (for the crew scheduler). */
  laborHours: number;
  /** The height the type actually builds at (nearest offered). */
  builtHeightFt: number;
}

const CAP_LABEL: Record<string, string> = { flat: "Flat", pyramid: "Pyramid", gothic: "Gothic", dome: "Dome" };

/** Posts come in even-foot lengths — round up. */
const roundPost = (ft: number) => Math.ceil(ft / 2) * 2;

/**
 * Concrete per set post, from the hole that actually gets dug: diameter
 * 3× the post width (the auger rule), depth to the burial line — which
 * is frost-aware — minus the post's own displacement. A 60 lb bag yields
 * ~0.45 ft³; 10% covers spillage and over-dig. A flat bags-by-height
 * schedule ran a crew out of mix mid-job in the South and did not begin
 * to cover a northern frost hole.
 */
/** The grade on a cedar board line: "#1 tight-knot " or "clear " ahead of the stock. */
export function gradeWords(grade: BoardGrade | null | undefined): string {
  return grade === "tight-knot-1" ? "#1 tight-knot " : grade === "clear" ? "Clear " : "";
}

export function concreteBagsPerPost(heightFt: number, postWidthIn: number, frostIn: number): number {
  const depthFt = burialFt(heightFt, frostIn);
  // Auger rule: 3× the post width, floored at 8" and capped at 12" — nobody
  // bores a 16" hole for a 6×6, they size up the auger one step.
  const holeDiaFt = Math.min(12, Math.max(8, postWidthIn * 3)) / 12;
  const holeFt3 = Math.PI * (holeDiaFt / 2) ** 2 * depthFt;
  const postFt3 = (postWidthIn / 12) ** 2 * depthFt;
  return (Math.max(0, holeFt3 - postFt3) / 0.45) * 1.1;
}

/** A post system replaces the stock only on a wood fence, and 6×6 only where the stock is thinner. */
export function postUpgradeApplies(t: FenceType, up: PostSystem | null | undefined): up is PostSystem {
  return !!up && t.category === "wood" && !(up === "6x6" && t.spec.postWidthIn >= 5.5);
}

/**
 * The post the fence actually stands on: the type's own stock, or the post
 * system that REPLACES it. The takeoff used to list the 4×4 wood posts and
 * then "Post upgrade — galvanized steel (every post)" under them — a crew
 * reads that as buying both — and the scope said "4×4 pressure-treated pine
 * post" a line above "Galvanized steel posts throughout".
 */
export function postStock(t: FenceType, up: PostSystem | null | undefined): string {
  if (!postUpgradeApplies(t, up)) return t.spec.postMaterial;
  if (up === "steel") return "galvanized steel post";
  if (up === "black-steel") return "3×3 black powder-coated steel post with brackets";
  if (up === "6x6") return "6×6 pressure-treated post";
  if (up === "cedar-post-on-pipe") return "clear cedar post sleeved over 2⅜″ galvanized pipe";
  return `${t.spec.postMaterial.replace(/\s*\(.*\)$/, "")} sleeved over 2⅜″ galvanized pipe`;
}

/** Gate posts and openings: every opening takes two heavy posts and its width out of the fabric. */
export function openingTotals(openings: readonly FenceOpeningInput[]): { count: number; widthFt: number; posts: number } {
  const real = openings.filter((o) => Number.isFinite(o.widthFt) && o.widthFt > 0);
  return { count: real.length, widthFt: real.reduce((a, o) => a + o.widthFt, 0), posts: real.length * 2 };
}

/** What a gate kit is called on the BOM, by width. */
export function gateKitLabel(o: FenceOpeningInput): string {
  const w = Math.round(o.widthFt * 10) / 10;
  if (o.kind === "door") return `${o.label ?? "Pedestrian door"} kit (${w}')`;
  if (w <= 4.5) return `Walk gate kit (${w}')${o.variant === "arched" ? " · arched" : ""}`;
  if (w >= 9) return `Drive gate kit (${w}', double swing)`;
  return `Gate kit (${w}')`;
}

export function computeFenceTakeoff(input: FenceLayoutInput): FenceTakeoff {
  const t: FenceType = fenceType(input.type);
  const heightFt = t.heightsFt.includes(input.heightFt) ? input.heightFt : nearestOffered(t, input.heightFt);
  const spacingFt = effectiveSpacingFt(t, input.postSpacingFt);
  const waste = 1 + Math.min(30, Math.max(0, input.wastePct ?? 10)) / 100;
  const hf = heightFactor(t, heightFt);
  const frostIn = Math.max(0, input.frostIn ?? 0);

  const runs = input.runs.filter((r) => Number.isFinite(r.lengthFt) && r.lengthFt > 0);
  const totalLf = runs.reduce((a, r) => a + r.lengthFt, 0);
  const gates = openingTotals(input.openings);
  const netFenceLf = Math.max(0, totalLf - gates.widthFt);

  // Sections are counted PER RUN — three 40' runs need ceil(40/8)=5 sections
  // each (15 total), not ceil(120/8)=15 by luck; 3×34' runs need 15, not 13.
  // Gate openings are subtracted proportionally.
  const netRatio = totalLf > 0 ? netFenceLf / totalLf : 0;
  const sections = runs.reduce((acc, r) => acc + Math.max(1, Math.ceil((r.lengthFt * netRatio) / spacingFt)), 0);
  const corners = runs.reduce((a, r) => a + Math.max(0, Math.round(r.corners)), 0);
  const ends = runs.reduce((a, r) => a + (r.closed ? 0 : 2), 0);
  // Posts: one per section boundary. An OPEN run with S sections has S+1
  // boundary posts and contributes 2 ends; a CLOSED ring has exactly S and
  // no ends. So boundaries = sections + ends/2, and the line posts are what
  // is left after corners and ends claim theirs.
  const linePosts = Math.max(0, Math.round(sections - corners - ends / 2));
  const gatePosts = gates.posts;
  const totalPosts = linePosts + corners + ends + gatePosts;

  const bom: BomLine[] = [];
  const add = (key: string, label: string, qty: number, unit: BomUnit) => {
    if (qty > 0) bom.push({ key, label, qty: Math.ceil(qty), unit });
  };

  // Posts are DISCRETE units — a crew orders a spare or two, not 10%. Waste
  // stays on cut goods (pickets, rails, fabric, wire), where offcuts are real.
  const burial = burialFt(heightFt, frostIn);
  const basePost = roundPost(heightFt + burial);
  // An upgraded post system is named on every post row — it replaces the
  // stock, it is not bought beside it.
  const upgraded = postUpgradeApplies(t, input.postUpgrade);
  const stock = postStock(t, input.postUpgrade);
  const named = upgraded ? ` · ${stock}` : "";
  // The posts at the steps of a stepped fence are the taller stock (the panel steps DOWN past them). They are
  // some of the posts counted above, not more of them: the note says "10' posts there, 8' elsewhere", and holes,
  // concrete and caps were always counted on the posts alone — yet the list ordered 63 × 8' AND 56 × 10' for a
  // 63-post fence (2026-11-10). Line posts are swapped first, then corners and ends; and where the step post is
  // no longer than the base post (split rail: "the 6' posts take the drop") nothing is swapped at all.
  const stepped = Math.max(0, Math.round(input.steppedSections ?? 0));
  const stepPost = roundPost(heightFt + burial + 1);
  const stepSwap = stepPost > basePost ? Math.min(stepped, linePosts + corners + ends) : 0;
  const swapLine = Math.min(stepSwap, linePosts);
  const swapCorner = Math.min(stepSwap - swapLine, corners);
  const swapEnd = stepSwap - swapLine - swapCorner;
  add("post-line", `Line posts · ${stock} · ${basePost}' (${spacingFt}' o.c.)`, linePosts - swapLine, "ea");
  add("post-corner", `Corner posts${named} · ${basePost}'`, corners - swapCorner, "ea");
  add("post-end", `End posts${named} · ${basePost}'`, ends - swapEnd, "ea");
  const steelGate = !!input.steelGatePosts && t.category === "wood" && input.postUpgrade !== "steel" && input.postUpgrade !== "black-steel";
  add("post-gate", steelGate ? `Gate posts · 4×4 black steel · ${basePost}'` : `Gate posts · heavy-set${named} · ${basePost}'`, gatePosts, "ea");
  if (t.spec.setInConcrete) {
    const bagsLine = concreteBagsPerPost(heightFt, t.spec.postWidthIn, frostIn);
    const bagsTerm = concreteBagsPerPost(heightFt, t.spec.terminalWidthIn, frostIn);
    add("concrete", `Concrete · 60 lb bags (holes ${Math.round(burial * 12)}" deep)`, linePosts * bagsLine + (corners + ends + gatePosts) * bagsTerm, "bag");
  } else {
    // Split rail is dropped in and tamped so the rails can be re-seated as
    // the ground heaves — gravel backfill, never concrete.
    add("gravel", "Gravel backfill · 50 lb bags", totalPosts * 2, "bag");
  }

  if (t.build === "stick") {
    const railsPer = t.railsPerSection(heightFt);
    const rails = sections * railsPer;
    add("rail", `${t.spec.railMaterial} (${spacingFt}' bays)`, rails * waste, "ea");
    const w = t.picketWidthIn ?? 5.5;
    const gap = t.picketGapIn ?? 0;
    const pitch = Math.max(1.5, w + gap); // board-on-board overlap floors at 1.5"
    if (railsPer === 0) {
      // Horizontal build — the boards ARE the horizontal members, stacked UP
      // the fence: courses = height / board pitch, one board per bay per
      // course. Height is what grows the count here.
      const courses = Math.ceil((heightFt * 12) / pitch);
      const slats = courses * sections;
      add("picket", `${gradeWords(takesCedarGrade(t) ? input.boardGrade : null)}${t.spec.infillMaterial} (${spacingFt}' bays × ${courses} courses)`, slats * waste, "ea");
      // A horizontal fence carries its boards on a vertical 2×2 mid-bay
      // support (two past 6' bays) so they cannot bow, and the posts are
      // dressed with 1×4 trim on both faces — the stock a picket fence never needs.
      add("mid-support", `2×2 kiln-dried cedar mid-bay supports · ${heightFt}'`, sections * (spacingFt > 6 ? 2 : 1) * waste, "ea");
      add("post-trim", `1×4 cedar post trim · ${heightFt}' (both faces)`, totalPosts * 2 * waste, "ea");
      // 4 screws per slat end × 2 ends, 500 per box.
      add("fasteners", input.fasteners === "stainless" ? "Stainless steel screws · 5 lb boxes" : "Screws · 5 lb boxes", (slats * 8) / 500, "box");
    } else {
      let pickets = (netFenceLf * 12) / pitch;
      if (t.id === "shadowbox") pickets *= 2; // both faces
      // Picket COUNT does not grow with height — taller fences use longer
      // pickets (priced via the height factor), not more.
      add("picket", `${gradeWords(takesCedarGrade(t) ? input.boardGrade : null)}${t.spec.infillMaterial} · ${heightFt}'`, pickets * waste, "ea");
      // Two nails per picket per rail (plus 10% bend / misfire); a 5 lb box
      // of ring-shank runs ~500.
      add("fasteners", input.fasteners === "stainless" ? "Stainless ring-shank nails · 5 lb boxes" : "Ring-shank nails · 5 lb boxes", (pickets * Math.max(1, railsPer) * 2 * 1.1) / 500, "box");
    }
  } else if (t.build === "panel") {
    // Panels are discrete units — nobody buys 10% spare prefab panels.
    add("panel", `${t.label} panels · ${t.postSpacingFt}' × ${heightFt}'`, sections, "ea");
    if (t.category === "vinyl") {
      // Vinyl rails slide THROUGH routed posts — no brackets. A privacy
      // panel's bottom rail carries an aluminum stiffener so it cannot sag.
      if (t.id === "vinyl-privacy") add("rail-stiffener", "Bottom-rail aluminum stiffeners", sections, "ea");
    } else if (t.category === "composite") {
      add("rail-set", "Aluminum bottom + composite top rail sets", sections, "ea");
    } else {
      add("bracket", "Panel brackets · pairs", sections * 2, "ea");
    }
  } else if (t.build === "mesh") {
    add("mesh", `${t.spec.infillMaterial} · ${heightFt}'`, netFenceLf * waste, "lf");
    add("top-rail", "Top rail · 1⅜″ OD", netFenceLf * waste, "lf");
    // Residential chain link has no bottom rail — a 7-ga tension wire runs
    // the base to stop the fabric being pushed up.
    add("tension-wire", "Bottom tension wire · 7-ga", netFenceLf * waste, "lf");
    // A corner terminates the fabric, the top rail and the brace on BOTH sides — two of each where an end or a
    // gate post takes one. The bars always counted it so; the bands, cups and brace bands that go with each bar
    // counted a corner once (a 4-corner loop with a gate: 10 bars but 30 bands, 6 cups — 2026-11-10).
    const terminalFaces = ends + corners * 2 + gatePosts;
    add("tension-bar", "Tension bars", terminalFaces, "ea");
    // Bands only wrap TERMINAL posts — line posts carry the fabric on the top rail and ties. One per foot-and-a-bit
    // of height, on every bar.
    add("tension-band", "Tension bands", terminalFaces * (heightFt / 1.2), "ea");
    add("rail-end", "Rail end cups", terminalFaces, "ea");
    add("brace-band", "Brace bands", terminalFaces, "ea");
    add("tie-wire", "Aluminum ties · 100 ct bags", netFenceLf / 60, "box");
  } else if (t.build === "rail") {
    const rails = sections * t.railsPerSection(heightFt);
    add("rail", `${t.spec.railMaterial} (${spacingFt}' bays)`, rails * waste, "ea");
  }

  if (stepSwap > 0) add("step-posts", `Extended posts for stepped sections${named} · ${stepPost}' (slope)`, stepSwap, "ea");
  // The pipe a post-on-pipe system sleeves over is its own stock line.
  // Black steel gate posts are steel already — no pipe to sleeve.
  if (upgraded && (input.postUpgrade === "post-on-pipe" || input.postUpgrade === "cedar-post-on-pipe")) add("post-pipe", `Galvanized pipe · 2⅜″ × ${basePost}' (post-on-pipe)`, totalPosts - (steelGate ? gatePosts : 0), "ea");
  // Caps are per-system hardware, not a generic line: chain-link line posts
  // take loop caps that the top rail threads through while their terminals
  // take solid domes, and split rail is capped with nothing.
  if (t.spec.postCap === "loop") {
    add("cap-loop", "Loop caps · line posts", linePosts, "ea");
    add("cap-dome", "Dome caps · terminal posts", corners + ends + gatePosts, "ea");
  } else if (t.spec.postCap !== "none") {
    add("post-cap", `${CAP_LABEL[t.spec.postCap]} post caps`, totalPosts, "ea");
  }
  // One kit line per opening width, grouped.
  const kits = new Map<string, number>();
  for (const o of input.openings) {
    if (!(o.widthFt > 0)) continue;
    const label = gateKitLabel(o);
    kits.set(label, (kits.get(label) ?? 0) + 1);
  }
  let k = 0;
  for (const [label, n] of kits) add(`gate-kit-${k++}`, label, n, "ea");
  add("gate-hardware", "Gate hinge + latch sets", gates.count, "ea");
  if (input.stain && t.stainable) {
    // Two faces × TWO COATS; a gallon covers ~150 sq ft per coat on rough-sawn wood.
    add("stain", "Stain / seal · gallons (2 coats, both faces)", (netFenceLf * heightFt * 2 * 2) / 150, "gal");
  }
  if ((input.removalLf ?? 0) > 0) add("removal", "Existing fence tear-out & haul-away", input.removalLf!, "lf");

  // Crew-hours: ≈4.5 LF/person-hour for stick builds on flat ground — a
  // 3-man crew doing 100–110 LF/day, which is real residential production.
  // Mesh and panels hang faster; rail is fastest.
  const lfPerHour = t.build === "mesh" ? 7 : t.build === "panel" ? 6 : t.build === "rail" ? 8 : 4.5;
  const laborHours = (netFenceLf / lfPerHour) * TERRAIN_FACTOR[input.terrain] * hf + gates.count * 1.5 + stepped * 0.4 + (input.removalLf ?? 0) / 12;

  return {
    netFenceLf: Math.round(netFenceLf * 10) / 10,
    totalLf: Math.round(totalLf * 10) / 10,
    sections,
    spacingFt,
    posts: { line: linePosts, corner: corners, end: ends, gate: gatePosts, total: totalPosts },
    postLengthFt: { base: basePost, step: stepPost },
    burialFt: Math.round(burial * 100) / 100,
    bom,
    laborHours: Math.round(laborHours * 10) / 10,
    builtHeightFt: heightFt,
  };
}

function nearestOffered(t: FenceType, heightFt: number): number {
  let best = t.defaultHeightFt;
  let bestD = Infinity;
  for (const h of t.heightsFt) {
    const d = Math.abs(h - heightFt);
    if (d < bestD || (d === bestD && h < best)) {
      best = h;
      bestD = d;
    }
  }
  return best;
}
