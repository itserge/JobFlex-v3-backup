// Fence package pricing — dollars from a layout, on the same takeoff the
// BOM panel shows, so the ticket, the proposal and the material list can
// never disagree. Ported 2026-09-18 from the owner's FenceScan app
// (lib/pricing.ts buildFenceLineItems + lib/fence/pricing.ts) with one
// JobFlex difference: every line carries its MATERIAL and LABOR halves,
// because a JobFlex proposal prints both to the client (Show to client →
// breakdown) and the org's markup applies to each half on its own.
//
//   per-LF package (materials) + professional installation (labor)
//   + gates by width + slope steps + post upgrade + tear-out + stain
//   + a mobilization floor on a tiny job
//
// Rates: the catalog's national rate, scaled to the job's market (state +
// ZIP), unless the shop's price book sets that figure — a rate the
// contractor typed is the number they charge, not a national equivalent.

import {
  CATEGORY_LABEL,
  effectiveSpacingFt,
  FENCE_TYPES,
  fenceType,
  heightFactor,
  nearestHeight,
  takesCedarGrade,
  TERRAIN_FACTOR,
  TERRAIN_LABEL,
  type FenceType,
  type FenceTypeId,
  type Terrain,
} from "./catalog";
import { blendedFactor, laborFactor, LINE_MATERIAL_SHARE, marketFrostIn, materialFactor, type MarketSnapshot } from "./market";
import { standardRate, type FenceRate, type RateBook } from "./rates";
import { computeFenceTakeoff, gateKitLabel, openingTotals, postStock, postUpgradeApplies, type BoardGrade, type FenceLayoutInput, type FenceOpeningInput, type FenceTakeoff, type PostSystem } from "./takeoff";
import type { SlopeSummary } from "./slope";

/** Share of a fence's $/LF that is the posts + footings. Tightening the
 *  post spacing scales exactly this slice of the line — 8'→4' o.c. doubles
 *  the posts, which is a ~25% material / ~30% labor bump, not a doubling. */
const POST_MATERIAL_SHARE = 0.25;
const POST_LABOR_SHARE = 0.3;

/** Every real crew has a mobilization floor — the truck, the fuel, the
 *  morning that a 20 LF job burns exactly like a 200 LF one. */
export const FENCE_JOB_MINIMUM = 450;

/** Tear-out per LF at national rates — crew time plus the dump fee. */
export const REMOVAL_PER_LF = 4;
/** A slope step: extended post, extra set and trim time. */
export const STEP_EACH = 28;
/** Stain & seal per sq ft of face, two coats. */
export const STAIN_PER_SQFT = 1.1;
export const POST_UPGRADE_EACH = { steel: 24, "6x6": 14 } as const;

/**
 * The post systems a wood fence can be built on (2026-09-23, after the
 * owner's look at a top Washington fence company's estimate): each with
 * its price per post over the standard 4×4 pressure-treated post, the words
 * for the client, and the structural warranty a shop attaches to it. The
 * standard post carries the workmanship warranty only.
 */
export const POST_SYSTEMS: Record<PostSystem, { label: string; short: string; blurb: string; material: number; labor: number; warranty: string | null }> = {
  "6x6": { label: "6×6 pressure-treated posts", short: "6×6", blurb: "heavy 6×6 stock at every post", material: POST_UPGRADE_EACH["6x6"], labor: 0, warranty: null },
  steel: { label: "Galvanized steel posts", short: "Steel", blurb: "steel never rots, warps or leans — hidden inside the fence", material: POST_UPGRADE_EACH.steel, labor: 0, warranty: "Lifetime structural warranty on the post system" },
  "post-on-pipe": { label: "Post-on-pipe — pressure-treated post over steel pipe", short: "Post-on-pipe", blurb: "a 2⅜″ galvanized pipe set in concrete, the wood post sleeved over it — the post can never rot at the ground line", material: 32, labor: 16, warranty: "10-year structural warranty on the post system" },
  "cedar-post-on-pipe": { label: "Post-on-pipe — clear cedar post over steel pipe", short: "Cedar on pipe", blurb: "a clear cedar post sleeved over a steel pipe — the look of cedar, the life of steel", material: 78, labor: 16, warranty: "20-year structural warranty on the post system" },
  "black-steel": { label: "3×3 black steel posts", short: "Black steel 3×3", blurb: "powder-coated 3×3 steel posts with brackets — the modern look, and the post never moves", material: 62, labor: 28, warranty: "Lifetime structural warranty on the post system" },
};
export const POST_SYSTEM_ORDER: PostSystem[] = ["6x6", "steel", "post-on-pipe", "cedar-post-on-pipe", "black-steel"];
/** The board grades a cedar fence is sold in, as a factor on the fence package's material. */
export const BOARD_GRADES: Record<BoardGrade, { label: string; factor: number; blurb: string }> = {
  standard: { label: "#2 & better", factor: 1, blurb: "the standard tight-knot cedar" },
  "tight-knot-1": { label: "#1 tight-knot", factor: 1.12, blurb: "#1 grade tight-knot cedar — tighter, smaller knots, fewer culls" },
  clear: { label: "Clear", factor: 1.6, blurb: "clear vertical-grain cedar — no knots" },
};
export const STAINLESS_PER_LF = 0.5;
export const HEAVY_GATE_HARDWARE = { single: { material: 45, labor: 15 }, double: { material: 120, labor: 30 } } as const;
export const STEEL_GATE_POST = { material: 48, labor: 12 } as const;
export const CLEAR_LINE_PER_LF = 3;
export const HAUL_SOIL_PER_POST = 6;
export const HAUL_SOIL_MINIMUM = 120;

/** A shop's own fence type: built like a catalog type, priced at its own rates. */
export interface CustomFenceType {
  id: string;
  label: string;
  /** The catalog type it is built like — spec, spacing, heights, BOM. */
  like: FenceTypeId;
  materialPerLf: number;
  laborPerLf: number;
  gateSingle?: number;
  color?: string;
}

/** What a type id resolves to on this shop's page: the catalog type (or the
 *  base of a custom one), its label, and the rates that apply. */
export interface ResolvedFenceType {
  type: FenceType;
  id: string;
  label: string;
  custom: CustomFenceType | null;
}

export function resolveFenceType(id: string, customs: readonly CustomFenceType[] = []): ResolvedFenceType {
  const c = customs.find((x) => x.id === id) ?? null;
  const t = fenceType(c ? c.like : id);
  return { type: t, id: c ? c.id : t.id, label: c ? c.label : t.label, custom: c };
}

export interface FencePriceOptions {
  /** The shop's price book. */
  rates?: RateBook;
  /** The shop's own types. */
  customs?: readonly CustomFenceType[];
  /** The job's market, frozen at estimate time. */
  market?: MarketSnapshot;
  /** The shop's tear-out rate, $/LF; default REMOVAL_PER_LF at the market's labor rate. */
  removalPerLf?: number;
  /** Per-opening price overrides ($ each, installed), keyed by the page's opening id. */
  openingPrices?: Record<string, number>;
  jobMinimum?: number;
}

/** The rates a job prices at, and where each came from. */
export interface JobRates extends Required<FenceRate> {
  source: { materialPerLf: "book" | "market" | "catalog"; laborPerLf: "book" | "market" | "catalog"; gateSingle: "book" | "market" | "catalog" };
}

/**
 * The catalog's national rate scaled to the market, unless the book (or a
 * custom type) sets the figure — then that figure, as typed.
 */
export function jobRates(res: ResolvedFenceType, opts: FencePriceOptions): JobRates {
  const std = standardRate(res.type.id);
  const book = res.custom ? { materialPerLf: res.custom.materialPerLf, laborPerLf: res.custom.laborPerLf, gateSingle: res.custom.gateSingle } : opts.rates?.[res.type.id];
  const mk = opts.market;
  const matF = materialFactor(mk, res.type.id);
  const labF = laborFactor(mk);
  const gateF = blendedFactor(mk, res.type.id, LINE_MATERIAL_SHARE.gate);
  const pick = (field: keyof FenceRate, factor: number): [number, "book" | "market" | "catalog"] => {
    const v = book?.[field];
    if (Number.isFinite(v) && (v as number) > 0) return [v as number, "book"];
    return [round2(std[field] * factor), mk && factor !== 1 ? "market" : "catalog"];
  };
  const [materialPerLf, ms] = pick("materialPerLf", matF);
  const [laborPerLf, ls] = pick("laborPerLf", labF);
  const [gateSingle, gs] = pick("gateSingle", gateF);
  return { materialPerLf, laborPerLf, gateSingle, source: { materialPerLf: ms, laborPerLf: ls, gateSingle: gs } };
}

export interface FencePackageLine {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  unit: "ln ft" | "ea" | "sqft" | "lot";
  /** Per-unit cost basis (before the org's markup), material half. */
  materialCost: number;
  /** Per-unit cost basis, labor half. */
  laborCost: number;
  /** material + labor, per unit. */
  unitPrice: number;
  /** Sales tax lands on materials; labor is untaxed in most states. */
  taxable: boolean;
}

export interface FencePackage {
  lines: FencePackageLine[];
  subtotal: number;
  materialSubtotal: number;
  laborSubtotal: number;
  /** subtotal ÷ net fence LF — the headline number. */
  pricePerLf: number;
  netFenceLf: number;
  totalLf: number;
  takeoff: FenceTakeoff;
  resolved: ResolvedFenceType;
  builtHeightFt: number;
  rates: JobRates;
  market?: MarketSnapshot;
  /** What the package promises and what it asks of the owner: warranty by
   *  post system, wood's nature, site prep, soil, utilities, property lines. */
  notes: string[];
}

/** Continuous gate pricing by width: a walk gate (≤4') is 1×, the 10' drive
 *  gate is 2.4×, widths between interpolate; past 10', the drive gate's
 *  per-foot rate. A cliff at 5' once repriced a gate 47% for one extra inch. */
export function gateWidthFactor(widthFt: number): number {
  const w = Math.max(0, widthFt);
  return w <= 4 ? 1 : w <= 10 ? 1 + 1.4 * ((w - 4) / 6) : 2.4 * (w / 10);
}

/** What an arched top or a pedestrian door does to the kit price. */
export function openingVariantFactor(o: FenceOpeningInput): number {
  if (o.kind === "door") return o.variant === "slatted" ? 0.9 : 0.8;
  if (o.variant === "arched") return 1.4;
  return 1;
}

/** What one opening costs on a type at a height — the popover's and the row's figure. */
export function openingEach(res: ResolvedFenceType, opts: FencePriceOptions, o: FenceOpeningInput, heightFt: number): number {
  const override = o.variant ? opts.openingPrices?.[o.variant] : undefined;
  if (Number.isFinite(override) && (override as number) > 0) return override as number;
  const rates = jobRates(res, opts);
  const hf = heightFactor(res.type, nearestHeight(res.type, heightFt));
  return round2(rates.gateSingle * gateWidthFactor(o.widthFt) * openingVariantFactor(o) * hf);
}

/** One openings line per distinct kit. */
function openingLines(openings: readonly FenceOpeningInput[], gateSingle: number, hf: number, opts: FencePriceOptions): FencePackageLine[] {
  const groups = new Map<string, { o: FenceOpeningInput; n: number; each: number }>();
  for (const o of openings) {
    if (!(o.widthFt > 0)) continue;
    const key = `${o.kind}:${o.variant ?? ""}:${o.widthFt}`;
    const override = o.variant ? opts.openingPrices?.[o.variant] : undefined;
    const each = Number.isFinite(override) && (override as number) > 0 ? (override as number) : round2(gateSingle * gateWidthFactor(o.widthFt) * openingVariantFactor(o) * hf);
    const g = groups.get(key) ?? { o, n: 0, each };
    g.n += 1;
    groups.set(key, g);
  }
  return [...groups.values()].map(({ o, n, each }, i) => {
    const kit = gateKitLabel(o).replace(/ kit/, "");
    return {
      id: `gate-${i}`,
      name: `${o.label ?? kit} — framed & hung`,
      description: o.kind === "door" ? "Frame, hinges & latch included" : o.widthFt >= 9 ? "Double swing, drop rod & latch included" : "Heavy-set posts, hinges & latch included",
      quantity: n,
      unit: "ea" as const,
      materialCost: round2(each * LINE_MATERIAL_SHARE.gate),
      laborCost: round2(each - round2(each * LINE_MATERIAL_SHARE.gate)),
      unitPrice: each,
      taxable: true,
    };
  });
}

export function priceFencePackage(layout: FenceLayoutInput, opts: FencePriceOptions = {}): FencePackage {
  const resolved = resolveFenceType(layout.type, opts.customs);
  const t = resolved.type;
  const mk = opts.market;
  const frostIn = layout.frostIn ?? marketFrostIn(mk);
  const takeoff = computeFenceTakeoff({ ...layout, type: t.id, frostIn });
  const hFt = nearestHeight(t, layout.heightFt);
  const hf = heightFactor(t, hFt);
  // A blank field reads as NaN, and NaN through Math.min/max stays NaN — every
  // material cost would then fail the convert schema (QA check, 2026-09-22).
  const waste = 1 + Math.min(30, Math.max(0, Number.isFinite(layout.wastePct) ? (layout.wastePct as number) : 10)) / 100;
  const rates = jobRates(resolved, opts);
  const effSpacing = effectiveSpacingFt(t, layout.postSpacingFt);
  const spacingRatio = t.postSpacingFt / effSpacing;
  const spacingMatF = 1 + POST_MATERIAL_SHARE * (spacingRatio - 1);
  const spacingLabF = 1 + POST_LABOR_SHARE * (spacingRatio - 1);
  const lf = takeoff.netFenceLf;
  const terrain: Terrain = layout.terrain;

  const lines: FencePackageLine[] = [];
  const line = (l: Omit<FencePackageLine, "unitPrice">) => {
    if (l.quantity <= 0) return;
    // The halves must ADD UP to the unit price: the proposal stores them and
    // prices the line at their sum. Rounded apart they missed it by a cent a
    // unit — on a 3,040 sq ft stain line the ticket said $17,828 and the
    // converted proposal $17,797.60. Labor takes the cent, as on the gate lines.
    const unitPrice = round2(l.materialCost + l.laborCost);
    const materialCost = round2(l.materialCost);
    lines.push({ ...l, materialCost, laborCost: round2(unitPrice - materialCost), unitPrice });
  };

  const spacingNote = spacingRatio !== 1 ? ` — ${effSpacing}' post spacing` : "";
  const grade = takesCedarGrade(t) && layout.boardGrade && layout.boardGrade !== "standard" ? BOARD_GRADES[layout.boardGrade] : null;
  line({
    id: "fence-materials",
    name: `${resolved.label} — ${hFt}' fence package${grade ? ` · ${grade.label.toLowerCase()} cedar` : ""}`,
    description: `Posts, ${t.build === "mesh" ? "top rail, fabric & tension hardware" : t.build === "panel" ? "panels" : t.build === "rail" ? "rails" : "rails & pickets"}, concrete, caps & fasteners${spacingNote}`,
    quantity: lf,
    unit: "ln ft",
    materialCost: rates.materialPerLf * hf * waste * spacingMatF * (grade ? grade.factor : 1),
    laborCost: 0,
    taxable: true,
  });
  line({
    id: "fence-labor",
    name: "Professional installation",
    description: terrain === "flat" ? "Layout, post setting, build & cleanup" : `Layout, post setting, build & cleanup — ${TERRAIN_LABEL[terrain].toLowerCase()}`,
    quantity: lf,
    unit: "ln ft",
    materialCost: 0,
    laborCost: rates.laborPerLf * hf * TERRAIN_FACTOR[terrain] * spacingLabF,
    taxable: false,
  });
  // A gate is a piece of the fence beside it — an 8' privacy gate has a
  // heavier frame, a third hinge and more infill than a 4' one, so gate
  // lines take the same height factor as the fence.
  for (const g of openingLines(layout.openings, rates.gateSingle, hf, opts)) lines.push(g);

  const stepped = Math.max(0, Math.round(layout.steppedSections ?? 0));
  if (stepped > 0) {
    const each = STEP_EACH * blendedFactor(mk, t.id, LINE_MATERIAL_SHARE.step);
    line({
      id: "fence-steps",
      name: "Slope steps — extended posts & leveling",
      description: `${stepped} stepped ${stepped === 1 ? "section" : "sections"} on the grade, each ≤ 1' so the top line stays at code height`,
      quantity: stepped,
      unit: "ea",
      materialCost: each * LINE_MATERIAL_SHARE.step,
      laborCost: each * (1 - LINE_MATERIAL_SHARE.step),
      taxable: true,
    });
  }
  // A post upgrade only exists where the base build can take it: wood
  // fences on standard 4×4 stock. Chain link and ornamental are already
  // steel, vinyl rails route through vinyl posts, split rail is mortised —
  // and horizontal-modern ships on 6×6 stock.
  const upgradeApplies = !!layout.postUpgrade && t.category === "wood" && !(layout.postUpgrade === "6x6" && t.spec.postWidthIn >= 5.5);
  // The black steel gate posts below are their own line; with a post system on (6×6, post-on-pipe, cedar on pipe)
  // the gate posts were ALSO in the upgrade's count — paid for twice (2026-11-10).
  const steelGateLine = !!layout.steelGatePosts && t.category === "wood" && takeoff.posts.gate > 0 && layout.postUpgrade !== "steel" && layout.postUpgrade !== "black-steel";
  if (upgradeApplies && takeoff.posts.total - (steelGateLine ? takeoff.posts.gate : 0) > 0) {
    const up = layout.postUpgrade as PostSystem;
    const sys = POST_SYSTEMS[up];
    const posts = takeoff.posts.total - (steelGateLine ? takeoff.posts.gate : 0);
    line({
      id: "fence-post-upgrade",
      name: `${sys.label} — upgrade`,
      description: `${posts} posts — ${sys.blurb}${sys.warranty ? `; ${sys.warranty.toLowerCase()}` : ""}`,
      quantity: posts,
      unit: "ea",
      materialCost: sys.material * materialFactor(mk, up === "6x6" ? "pt-pine-privacy" : "steel-ornamental"),
      laborCost: sys.labor * laborFactor(mk),
      taxable: true,
    });
  }
  // Gates hang on steel even when the fence posts are wood: a wood gate post
  // sags and the gate drags inside a year. Not needed when every post is steel.
  const gatePosts = takeoff.posts.gate;
  if (steelGateLine) {
    line({
      id: "fence-gate-posts-steel",
      name: "Black steel gate posts",
      description: `${gatePosts} 4×4 black steel posts at the gates — the gate hangs true for its life`,
      quantity: gatePosts,
      unit: "ea",
      materialCost: STEEL_GATE_POST.material * materialFactor(mk, "steel-ornamental"),
      laborCost: STEEL_GATE_POST.labor * laborFactor(mk),
      taxable: true,
    });
  }
  if (layout.gateHardware === "heavy-duty" && layout.openings.some((o) => o.widthFt > 0)) {
    const singles = layout.openings.filter((o) => o.widthFt > 0 && o.widthFt <= 5.5).length;
    const doubles = layout.openings.filter((o) => o.widthFt > 5.5).length;
    const material = singles * HEAVY_GATE_HARDWARE.single.material + doubles * HEAVY_GATE_HARDWARE.double.material;
    const labor = singles * HEAVY_GATE_HARDWARE.single.labor + doubles * HEAVY_GATE_HARDWARE.double.labor;
    line({
      id: "fence-gate-hardware",
      name: "Heavy-duty gate hardware — upgrade",
      description: `Ball-bearing hinges and a heavy latch on every gate${doubles ? ", cane bolt on the double" : ""}`,
      quantity: 1,
      unit: "lot",
      materialCost: material * materialFactor(mk, "steel-ornamental"),
      laborCost: labor * laborFactor(mk),
      taxable: true,
    });
  }
  if (layout.fasteners === "stainless" && t.category === "wood") {
    line({
      id: "fence-fasteners",
      name: "Stainless steel fasteners — upgrade",
      description: "Stainless ring-shank nails and screws — no rust streaks down the cedar, ever",
      quantity: lf,
      unit: "ln ft",
      materialCost: STAINLESS_PER_LF * materialFactor(mk, t.id),
      laborCost: 0,
      taxable: true,
    });
  }
  if (layout.clearLine && lf > 0) {
    line({
      id: "fence-clear-line",
      name: "Clear the fence line",
      description: "A 2-ft path along the line: brush, debris and small plants out of the way before the crew digs",
      quantity: lf,
      unit: "ln ft",
      materialCost: 0,
      laborCost: CLEAR_LINE_PER_LF * laborFactor(mk),
      taxable: false,
    });
  }
  if (layout.haulSoil && takeoff.posts.total > 0) {
    const posts = takeoff.posts.total;
    const perPost = Math.max(HAUL_SOIL_PER_POST, HAUL_SOIL_MINIMUM / posts) * laborFactor(mk);
    line({
      id: "fence-haul-soil",
      name: "Haul away excavated soil",
      description: "The spoil from every post hole loaded and hauled off, not spread along the line",
      quantity: posts,
      unit: "ea",
      materialCost: 0,
      laborCost: perPost,
      taxable: false,
    });
  }
  const removal = Math.max(0, layout.removalLf ?? 0);
  if (removal > 0) {
    line({
      id: "fence-removal",
      name: "Tear out & haul away existing fence",
      quantity: round1(removal),
      unit: "ln ft",
      materialCost: 0,
      // The shop's own rate as typed — $0 too (an owner who does tear-out free, or bills it elsewhere). Only a
      // rate never given falls back to the default; a typed 0 used to bill $4/lf × labor while the proposal's
      // assumption said "at $0/lf" (2026-11-10).
      laborCost: Number.isFinite(opts.removalPerLf) && (opts.removalPerLf as number) >= 0 ? (opts.removalPerLf as number) : REMOVAL_PER_LF * laborFactor(mk),
      taxable: false,
    });
  }
  if (layout.stain && t.stainable) {
    const each = STAIN_PER_SQFT * blendedFactor(mk, t.id, LINE_MATERIAL_SHARE.stain);
    line({
      id: "fence-stain",
      name: "Stain & seal (both faces)",
      description: "Premium penetrating stain, 2 coats",
      quantity: Math.ceil(lf * hFt * 2),
      unit: "sqft",
      materialCost: each * LINE_MATERIAL_SHARE.stain,
      laborCost: each * (1 - LINE_MATERIAL_SHARE.stain),
      taxable: true,
    });
  }
  // Mobilization floor: when the whole job sums under the minimum, a visible
  // line makes up the difference — a 30 LF gate repair still rolls a truck.
  const minimum = opts.jobMinimum ?? FENCE_JOB_MINIMUM;
  const jobSubtotal = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  if (jobSubtotal > 0 && jobSubtotal < minimum) {
    line({
      id: "fence-job-minimum",
      name: "Mobilization & job minimum",
      description: "Small-job floor — crew, truck & setup",
      quantity: 1,
      unit: "lot",
      materialCost: 0,
      laborCost: minimum - jobSubtotal,
      taxable: false,
    });
  }

  const subtotal = round2(lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0));
  const materialSubtotal = round2(lines.reduce((a, l) => a + l.quantity * l.materialCost, 0));
  const laborSubtotal = round2(lines.reduce((a, l) => a + l.quantity * l.laborCost, 0));
  return {
    lines,
    subtotal,
    materialSubtotal,
    laborSubtotal,
    pricePerLf: lf > 0 ? round2(subtotal / lf) : 0,
    netFenceLf: lf,
    totalLf: takeoff.totalLf,
    notes: packageNotes(layout, t, takeoff),
    takeoff,
    resolved,
    builtHeightFt: hFt,
    rates,
    market: mk,
  };
}

/* ------------------------------------------------------------------ */
/*  Good / Better / Best                                               */
/* ------------------------------------------------------------------ */

export interface FenceTier {
  id: "good" | "better" | "best";
  name: string;
  tagline: string;
  /** Catalog type this tier quotes (may upgrade the material). */
  type: FenceTypeId;
  stain: boolean;
  recommended?: boolean;
}

/** What a fence is FOR. Good only ever offers a cheaper fence that does the
 *  same job — a privacy fence for a privacy fence, never chain link. */
const FENCE_ROLE: Record<FenceTypeId, "privacy" | "picket" | "chain-link" | "ornamental" | "rail"> = {
  "cedar-privacy": "privacy",
  "pt-pine-privacy": "privacy",
  "board-on-board": "privacy",
  shadowbox: "privacy",
  "horizontal-modern": "privacy",
  "vinyl-privacy": "privacy",
  "composite-privacy": "privacy",
  "wood-picket": "picket",
  "vinyl-picket": "picket",
  "chain-link-galv": "chain-link",
  "chain-link-black": "chain-link",
  "aluminum-ornamental": "ornamental",
  "steel-ornamental": "ornamental",
  "split-rail-2": "rail",
  "ranch-rail-3": "rail",
};

/**
 * Tier ladder for a chosen base type: Good = a cheaper build that does the
 * same job, Better = the chosen type as drawn, Best = chosen type plus
 * stain / seal (wood) or the premium sibling. Every tier is held to the
 * job's height. Good is the family's value build when it is made at that
 * height and costs less; else the cheapest same-job fence that is (its own
 * material first); else there is no Good. A tier that would quote the very
 * fence Better quotes is left out — two cards with one price is not a
 * choice (vinyl privacy at 6' showed "Vinyl privacy $13,642" twice).
 */
export function fenceTiers(base: FenceTypeId, heightFt?: number): FenceTier[] {
  const t = fenceType(base);
  const offered = (id: FenceTypeId): boolean => heightFt === undefined || fenceType(id).heightsFt.includes(heightFt);
  const held = (id: FenceTypeId): FenceTypeId => (id === base || offered(id) ? id : base);
  const costPerLf = (id: FenceTypeId): number => {
    const ft = fenceType(id);
    const h = heightFt !== undefined ? heightFt : ft.defaultHeightFt;
    return (ft.materialPerLf + ft.laborPerLf) * heightFactor(ft, h);
  };
  const preferred: FenceTypeId =
    t.category === "wood"
      ? "pt-pine-privacy"
      : t.category === "vinyl"
        ? "vinyl-picket"
        : t.category === "composite"
          ? "vinyl-privacy"
          : t.category === "chain-link"
            ? "chain-link-galv"
            : t.category === "aluminum" || t.category === "steel"
              ? "aluminum-ornamental"
              : "split-rail-2";
  const cheaper = (id: FenceTypeId) => id !== base && offered(id) && costPerLf(id) < costPerLf(base);
  let valueSibling: FenceTypeId | null = cheaper(preferred) && FENCE_ROLE[preferred] === FENCE_ROLE[base] ? preferred : null;
  if (!valueSibling) {
    const pool = FENCE_TYPES.filter((x) => FENCE_ROLE[x.id] === FENCE_ROLE[base] && cheaper(x.id)).sort(
      (a, b) => Number(a.category !== t.category) - Number(b.category !== t.category) || costPerLf(a.id) - costPerLf(b.id),
    );
    valueSibling = pool[0]?.id ?? null;
  }
  const premiumSibling: FenceTypeId = held(
    t.category === "wood"
      ? "board-on-board"
      : t.category === "chain-link"
        ? "chain-link-black"
        : t.category === "aluminum" || t.category === "steel"
          ? "steel-ornamental"
          : base === "vinyl-picket"
            ? "vinyl-privacy"
            : base === "vinyl-privacy"
              ? "composite-privacy"
              : base === "split-rail-2"
                ? "ranch-rail-3"
                : base,
  );
  const bestType = t.stainable ? base : premiumSibling;
  const tiers: FenceTier[] = [];
  if (valueSibling) tiers.push({ id: "good", name: "Good", tagline: "Solid build, best price", type: valueSibling, stain: false });
  tiers.push({ id: "better", name: "Better", tagline: "The fence as designed", type: base, stain: false, recommended: true });
  // Best is the stained fence or the premium line — never the same fence again, and never one that costs LESS
  // than Better (vinyl picket at 4' had vinyl privacy as Best, $1,000 under Better on 150 ft — 2026-11-10).
  if (t.stainable || (bestType !== base && costPerLf(bestType) > costPerLf(base))) tiers.push({ id: "best", name: "Best", tagline: t.stainable ? "Stained & sealed" : "Premium line", type: bestType, stain: t.stainable });
  return tiers;
}

/* ------------------------------------------------------------------ */
/*  The client's scope, and the contractor's checks                    */
/* ------------------------------------------------------------------ */

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** What the client reads: the work, in plain sentences. No prices, no estimate words. */
export function fenceScope(pkg: FencePackage, layout: FenceLayoutInput, where?: string | null): string[] {
  const t = pkg.resolved.type;
  const tk = pkg.takeoff;
  const gates = openingTotals(layout.openings);
  const out: string[] = [];
  out.push(`Supply and install ${Math.round(pkg.netFenceLf)} linear ft of ${pkg.builtHeightFt}' ${pkg.resolved.label.toLowerCase()}${where ? ` at ${where}` : ""} — ${t.blurb.replace(/\.$/, "")}.`);
  out.push(
    `${t.spec.setInConcrete ? "Posts set in concrete" : "Posts tamped in gravel"}, ${tk.spacingFt}' on center — ${plural(tk.posts.total, "post")} (${[
      tk.posts.line ? `${tk.posts.line} line` : null,
      tk.posts.corner ? `${tk.posts.corner} corner` : null,
      tk.posts.end ? `${tk.posts.end} end` : null,
      tk.posts.gate ? `${tk.posts.gate} gate` : null,
    ]
      .filter(Boolean)
      .join(", ")}), ${postStock(t, layout.postUpgrade)}.`,
  );
  if (t.build === "stick") out.push(`${t.spec.railMaterial}; ${t.spec.infillMaterial}.`);
  else if (t.build === "panel") out.push(`${tk.sections} prefab ${t.postSpacingFt}' panels — ${t.spec.infillMaterial}, ${t.spec.railMaterial}.`);
  else if (t.build === "mesh") out.push(`${t.spec.infillMaterial} stretched on ${t.spec.railMaterial}, tension bars and bands at every terminal post.`);
  else out.push(`${t.spec.railMaterial}.`);
  if (gates.count > 0) {
    const kinds = new Map<string, number>();
    for (const o of layout.openings) {
      if (!(o.widthFt > 0)) continue;
      const k = `${o.label ?? (o.kind === "door" ? "door" : "gate")} (${Math.round(o.widthFt * 10) / 10}')`;
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    out.push(`${[...kinds].map(([k, n]) => `${n} × ${k}`).join(", ")} — hung, latched and adjusted.`);
  }
  if ((layout.steppedSections ?? 0) > 0) out.push(`${plural(layout.steppedSections!, "section")} stepped down the grade with extended posts, each step within 1' so the top line stays at code height.`);
  if (postUpgradeApplies(t, layout.postUpgrade)) {
    // The post sentence above already names the post; this says what it buys.
    const sys = POST_SYSTEMS[layout.postUpgrade];
    out.push(`${sys.blurb.charAt(0).toUpperCase()}${sys.blurb.slice(1)}.${sys.warranty ? ` ${sys.warranty}.` : ""}`);
  }
  if (takesCedarGrade(t) && layout.boardGrade && layout.boardGrade !== "standard") out.push(`Boards in ${BOARD_GRADES[layout.boardGrade].label.toLowerCase()} cedar — ${BOARD_GRADES[layout.boardGrade].blurb}.`);
  if (t.category === "wood" && layout.fasteners === "stainless") out.push("Stainless steel fasteners throughout — no rust streaks down the boards.");
  if (t.category === "wood" && layout.steelGatePosts && layout.postUpgrade !== "steel" && layout.postUpgrade !== "black-steel" && openingTotals(layout.openings).count > 0) out.push("Gates hung on 4×4 black steel posts, so they never sag.");
  if (layout.gateHardware === "heavy-duty" && openingTotals(layout.openings).count > 0) out.push("Heavy-duty gate hardware: ball-bearing hinges, heavy latch, cane bolt on any double gate.");
  if (layout.clearLine) out.push("We clear a 2-ft path along the fence line before digging.");
  if (layout.haulSoil) out.push("Excavated soil is hauled away.");
  if (layout.stain && t.stainable) out.push("Penetrating stain and seal, two coats on both faces, after install.");
  if ((layout.removalLf ?? 0) > 0) out.push(`Tear-out and haul-away of ${Math.round(layout.removalLf!)} linear ft of the existing fence.`);
  out.push("Layout staked and string-lined before digging; site cleaned and swept when the work is done.");
  return out;
}

/**
 * The words under the numbers: what the package promises and what it asks of
 * the owner. The workmanship warranty is every shop's; the structural years
 * ride on the post system; the rest is what a fence contractor's terms say
 * and a homeowner forgets — the line to clear, the soil, the private lines,
 * the property line.
 */
export function packageNotes(layout: FenceLayoutInput, t: FenceType, takeoff: FenceTakeoff): string[] {
  const out: string[] = [];
  const sys = layout.postUpgrade && t.category === "wood" && !(layout.postUpgrade === "6x6" && t.spec.postWidthIn >= 5.5) ? POST_SYSTEMS[layout.postUpgrade] : null;
  out.push(`Warranty: 4-year workmanship on the whole fence${sys?.warranty ? `; ${sys.warranty.toLowerCase()}` : t.category === "wood" ? " (a steel or post-on-pipe post system adds a 10-year to lifetime structural warranty)" : "; limited lifetime structural warranty on the post system"}.`);
  if (t.category === "wood" && takeoff.posts.gate > 0 && !layout.steelGatePosts && layout.postUpgrade !== "steel" && layout.postUpgrade !== "black-steel") out.push("Gates on wood posts: the gate warranty is 6 months — steel gate posts carry it for life.");
  // With stain & seal sold, "staining is the owner's upkeep" read as if it were not.
  if (t.category === "wood") out.push(`Cedar and pressure-treated lumber are natural: color change, checking, small cracks and some movement with the seasons are normal, not defects. ${layout.stain && t.stainable ? "The stain and seal in this proposal protects the wood; a fresh coat every few years is the owner's upkeep." : "Staining or sealing is the owner's upkeep."}`);
  if (!layout.clearLine) out.push("Before the crew arrives, the owner clears a 2-ft path along the fence line (plants to keep are marked); clearing on the day is extra.");
  if (!layout.haulSoil) out.push("Soil from the post holes is spread along the line; hauling it away is extra.");
  out.push("811 marks public utilities; the owner marks private ones — sprinklers, drains, low-voltage, septic. Property lines and HOA approval are the owner's to confirm.");
  return out;
}

export interface FenceCheck {
  level: "info" | "warn";
  text: string;
}

/**
 * The contractor's notes: what the package assumed and what deserves a
 * second look before the quote goes out. Facts about THIS layout only.
 */
export function fenceChecks(pkg: FencePackage, layout: FenceLayoutInput, slope?: SlopeSummary | null): FenceCheck[] {
  const t = pkg.resolved.type;
  const out: FenceCheck[] = [];
  if (pkg.netFenceLf <= 0) return out;
  if (!t.heightsFt.includes(layout.heightFt)) {
    out.push({ level: "warn", text: `${layout.heightFt}' is not offered in ${pkg.resolved.label.toLowerCase()} (${t.heightsFt.map((h) => h + "'").join(", ")}) — priced and built at ${pkg.builtHeightFt}'.` });
  }
  if (pkg.builtHeightFt > 6) {
    out.push({ level: "warn", text: `${pkg.builtHeightFt}' fence — most cities cap backyard fences at 6' and front yards at 4'; check the permit and the HOA before quoting.` });
  }
  if ((t.category === "aluminum" || t.category === "steel") && pkg.builtHeightFt >= 4) {
    out.push({ level: "info", text: `Pickets ${t.spec.infillPitchIn}" on center — under the 4" clear opening most pool-barrier codes require.` });
  }
  const eff = pkg.takeoff.spacingFt;
  if (eff !== t.postSpacingFt) {
    out.push({
      level: "info",
      text: eff < t.postSpacingFt ? `Posts ${eff}' on center — tighter than the ${t.postSpacingFt}' standard: more posts and a stiffer fence; the price and the takeoff follow.` : `Posts ${eff}' on center — wider than the ${t.postSpacingFt}' standard; check that the rail stock spans ${eff}'.`,
    });
  }
  if (layout.terrain !== "flat") {
    out.push({ level: "info", text: `${TERRAIN_LABEL[layout.terrain]} — installation labor ×${TERRAIN_FACTOR[layout.terrain]}${slope ? ` (grade ${slope.avgGradePct}% avg, ${slope.maxGradePct}% max)` : ""}.` });
  }
  if ((layout.steppedSections ?? 0) > 0) {
    const pl = pkg.takeoff.postLengthFt;
    // Frost-deep holes can already make every post long enough for a step.
    out.push({ level: "info", text: pl.step > pl.base
      ? `${plural(layout.steppedSections!, "step")} down the slope — ${pl.step}' posts there, ${pl.base}' elsewhere.`
      : `${plural(layout.steppedSections!, "step")} down the slope — the ${pl.base}' posts take the drop.` });
  }
  if (slope && slope.wallSegments > 0) {
    out.push({ level: "warn", text: `A sheer drop measured on ~${Math.round(slope.wallLikeLf)} LF — a retaining wall or cut bank? Posts on a wall are core-drilled and anchored, not dug; not priced here.` });
  }
  if (slope && slope.rackedExtraLf >= 1) {
    out.push({ level: "info", text: `Racked bays follow the ground: the fabric runs about ${Math.round(slope.rackedExtraLf)} LF longer than the map length — inside the ${layout.wastePct ?? 10}% waste factor.` });
  }
  const frostIn = layout.frostIn ?? marketFrostIn(pkg.market);
  if (frostIn > 0 && t.spec.setInConcrete) {
    const deep = pkg.takeoff.burialFt * 12;
    out.push({ level: "info", text: `Post holes ${Math.round(deep)}" deep${pkg.market?.state ? ` — ${frostIn}" frost line in ${pkg.market.label}` : ""}; ${pkg.takeoff.bom.find((b) => b.key === "concrete")?.qty ?? 0} bags of concrete.` });
  }
  for (const o of layout.openings) {
    if (o.kind === "gate" && o.widthFt > 12) {
      out.push({ level: "warn", text: `A ${Math.round(o.widthFt)}' swing gate is at the limit of hinged hardware — consider a cantilever or slide gate.` });
      break;
    }
  }
  if (t.category === "chain-link" && pkg.builtHeightFt >= 8) {
    out.push({ level: "info", text: "8' chain link — line posts step up to 2⅜″ and the run takes a mid-rail; priced at the standard spec." });
  }
  if ((layout.removalLf ?? 0) > pkg.totalLf + 1) {
    out.push({ level: "warn", text: `Tear-out (${Math.round(layout.removalLf!)} LF) is longer than the new fence (${Math.round(pkg.totalLf)} LF).` });
  }
  if (pkg.lines.some((l) => l.id === "fence-job-minimum")) {
    out.push({ level: "info", text: `Under the $${FENCE_JOB_MINIMUM} job minimum — mobilization makes up the difference.` });
  }
  if (pkg.rates.source.materialPerLf === "market" || pkg.rates.source.laborPerLf === "market") {
    out.push({ level: "info", text: `Rates calibrated to ${pkg.market!.label}: labor ${pctWord(pkg.market!.labor)}, ${CATEGORY_LABEL[t.category].toLowerCase()} materials ${pctWord(materialFactor(pkg.market, t.id))} vs national — until you set your own on the type's row.` });
  }
  return out;
}

const pctWord = (f: number) => `${f >= 1 ? "+" : "−"}${Math.abs(Math.round((f - 1) * 100))}%`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
