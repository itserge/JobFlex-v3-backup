// OPENING PRICED (2026-10-28): a lead from a website estimator — or from the house (/estimate/jobflex/<trade>, bought on
// the Lead Center) — carries the record the public page priced from (`webLead:<leadId>`, lib/webEstimator
// WebLeadRecord). The deck opens priced (actions/webEstimator openWebLeadInEstimator); the roof (2026-11-01), the fence,
// HVAC and Smart Proposal estimators open with the address and the words only. These readers turn the record's facts
// into the one thing each of those estimators applies at open — the fence as drawn, the house with its tier, the
// generated lines — so the contractor opens it priced in their own book. The estimator's page reads the record by the
// seed's lead id (the seed cookie is ~4 KB and carries none of this). Pure; the server read is lib/webEstimatorServer
// readWebLeadFor. Design: docs/superpowers/specs/2026-10-28-home-portal-house-estimators-design.md.
import type { WebLeadRecord } from "./webEstimator";
import type { RoofPackageSpec } from "./roofPackage/takeoff";
import type { SiteFacts } from "./hvac/intake";
import { estimateSchema, type GeneratedEstimate } from "./estimatorSchema";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pinOf = (v: unknown): { lat: number; lng: number } | null => {
  const p = v as { lat?: unknown; lng?: unknown } | null | undefined;
  const lat = num(p?.lat), lng = num(p?.lng);
  return lat !== null && lng !== null ? { lat, lng } : null;
};

// ── the roof: what webRoofPrice stored (lib/webEstimatorTrades priceWebRoof, 2026-11-01) ──

export type WebRoofSeedLine = { name: string; quantity: number; unitPrice: number; unit: string };
export type WebRoofSeed = {
  /** The aerial measurement row the hand-off wrote (openWebLeadInEstimator): opened, nothing ordered. */
  measurementId: string;
  /** The package's choices as the website priced them — the system (the material the homeowner chose; a flat roof's
   *  membrane), the brand, the shop's rates — seeded into the build card. */
  spec: RoofPackageSpec;
  materials: WebRoofSeedLine[];
  labor: WebRoofSeedLine[];
  scope: string;
  assumptions: string[];
  /** The words of what they chose and the price they saw: the estimator's note. */
  choice: string;
  address: string;
  shown: { low: number; high: number };
};

export function roofSeedFromWebLead(rec: WebLeadRecord): WebRoofSeed | null {
  if (rec.trade !== "roof" || rec.estimate.trade !== "roof") return null;
  const f = rec.estimate.facts;
  const measurementId = typeof f.measurementId === "string" && /^[\w-]{1,64}$/.test(f.measurementId) ? f.measurementId : null;
  const spec = f.spec && typeof f.spec === "object" && typeof (f.spec as { systemId?: unknown }).systemId === "string" ? (f.spec as RoofPackageSpec) : null;
  const lines = (f.lines && typeof f.lines === "object" ? f.lines : {}) as { materials?: unknown; labor?: unknown; scope?: unknown; assumptions?: unknown };
  const line = (v: unknown): WebRoofSeedLine | null => {
    const l = v as { name?: unknown; quantity?: unknown; unitPrice?: unknown; unit?: unknown } | null;
    const quantity = num(l?.quantity), unitPrice = num(l?.unitPrice);
    return l && typeof l.name === "string" && quantity !== null && unitPrice !== null ? { name: l.name, quantity, unitPrice, unit: typeof l.unit === "string" ? l.unit : "" } : null;
  };
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 200).map(line).filter((l): l is WebRoofSeedLine => !!l) : []);
  const materials = list(lines.materials), labor = list(lines.labor);
  if (!measurementId || !spec || !materials.length) return null;
  const words = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 60) : []);
  return {
    measurementId,
    spec,
    materials,
    labor,
    scope: words(lines.scope).join("\n"),
    assumptions: words(lines.assumptions),
    choice: rec.estimate.choice,
    address: [rec.estimate.address, rec.estimate.city].filter(Boolean).join(", "),
    shown: rec.estimate.band,
  };
}

// ── the fence: what webFencePrice stored (actions/webEstimator) ──

export type WebFenceSeed = {
  /** The address's pin: the local-feet frame the points are in; null when the feet were typed without a map. */
  pin: { lat: number; lng: number } | null;
  /** The path as drawn, in feet from the pin (components/estimator/fence PathPoint); empty when typed. */
  points: Array<{ x: number; y: number; gap?: boolean }>;
  runsFt: number[];
  /** The fence type's id (lib/fence/catalog FENCE_TYPES — the studio's own vocabulary). */
  type: string;
  heightFt: number;
  gates: number;
  doubles: number;
};

export function fenceSeedFromWebLead(rec: WebLeadRecord): WebFenceSeed | null {
  if (rec.trade !== "fence" || rec.estimate.trade !== "fence") return null;
  const f = rec.estimate.facts;
  const runsFt = Array.isArray(f.runsFt) ? f.runsFt.map(num).filter((n): n is number => n !== null && n > 0) : [];
  if (!runsFt.length) return null;
  const points = Array.isArray(f.points)
    ? f.points
        .map((p) => (p && typeof p === "object" ? { x: num((p as { x?: unknown }).x), y: num((p as { y?: unknown }).y), gap: (p as { gap?: unknown }).gap === true } : null))
        .filter((p): p is { x: number; y: number; gap: boolean } => !!p && p.x !== null && p.y !== null)
        .slice(0, 200)
        .map((p) => (p.gap ? { x: p.x, y: p.y, gap: true } : { x: p.x, y: p.y }))
    : [];
  return {
    pin: pinOf(f.pin),
    points,
    runsFt,
    type: typeof f.type === "string" ? f.type : "",
    heightFt: num(f.heightFt) ?? 6,
    gates: Math.max(0, Math.round(num(f.gates) ?? 0)),
    doubles: Math.max(0, Math.round(num(f.doubles) ?? 0)),
  };
}

// ── HVAC: the tier's facts (lib/webEstimatorTrades sizeWebHvac) ──

export type WebHvacSeed = {
  /** The house as the homeowner confirmed it (lib/hvac/intake SiteFacts) — stored since 2026-10-28; rebuilt from the
   *  address, the pin and the square feet for a lead from before. */
  site: SiteFacts;
  /** "split-ac-furnace" | "split-heat-pump" | "furnace-only" | "none" — the form's existing.kind. */
  existing: string;
  /** "yes" | "no" — gas at the house. */
  gas: string;
  outdoorKind: "heat-pump" | "air-conditioner";
  tier: "value" | "mid" | "premium";
  /** The catalog id of the unit they were priced on; null on a lead from before. */
  itemId: string | null;
};

const EXISTING = ["split-ac-furnace", "split-heat-pump", "furnace-only", "none"];

export function hvacSeedFromWebLead(rec: WebLeadRecord): WebHvacSeed | null {
  if (rec.trade !== "hvac" || rec.estimate.trade !== "hvac") return null;
  const f = rec.estimate.facts;
  const tier = f.tier === "value" || f.tier === "mid" || f.tier === "premium" ? f.tier : null;
  if (!tier) return null;
  const e = rec.estimate;
  const stored = f.site && typeof f.site === "object" && typeof (f.site as { address?: unknown }).address === "string" ? (f.site as SiteFacts) : null;
  const pin = pinOf(f.pin);
  const site: SiteFacts = stored
    ? { ...stored, sources: stored.sources && typeof stored.sources === "object" ? stored.sources : {} }
    : {
        address: [e.address, e.city, [e.state, e.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
        state: e.state ?? "",
        ...(pin ? { lat: pin.lat, lng: pin.lng } : {}),
        ...(num(f.sqft) ? { livingSqft: num(f.sqft)! } : {}),
        ...(num(f.storeys) ? { storeys: num(f.storeys)! } : {}),
        ...(num(f.yearBuilt) ? { yearBuilt: num(f.yearBuilt)! } : {}),
        ...(typeof f.county === "string" && f.county ? { county: f.county } : {}),
        sources: {},
      };
  return {
    site,
    existing: typeof f.existing === "string" && EXISTING.includes(f.existing) ? f.existing : "split-ac-furnace",
    gas: f.gas === "no" ? "no" : "yes",
    outdoorKind: f.outdoorKind === "heat-pump" ? "heat-pump" : "air-conditioner",
    tier,
    itemId: typeof f.itemId === "string" && f.itemId ? f.itemId : null,
  };
}

// ── Smart Proposal: the generated estimate the price came from (actions/advancedEstimator webSmartGenerate) ──

export type WebSmartSeed = {
  /** The estimate as generated, re-validated against the schema — the same lines and discount the homeowner saw. */
  estimate: GeneratedEstimate;
  /** The homeowner's brief (with their answers to the intake's questions), as the estimate was run from it. */
  brief: string;
};

export function smartSeedFromWebLead(rec: WebLeadRecord): WebSmartSeed | null {
  if (rec.trade !== "smart" || rec.estimate.trade !== "smart") return null;
  const f = rec.estimate.facts;
  const brief = typeof f.brief === "string" ? f.brief.trim() : "";
  if (!brief) return null;
  const parsed = estimateSchema.safeParse(f.estimate);
  if (!parsed.success) return null;
  // The house org's pricing method (its labor rate, markup, tax rule — the `pricing` snapshot) never rides to the
  // buyer: their own applies once they re-price, and their tax rule goes on the sheet.
  const { pricing: _pricing, ...estimate } = parsed.data;
  void _pricing;
  return { estimate, brief };
}
