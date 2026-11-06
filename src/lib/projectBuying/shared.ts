// BUYING AND DELIVERIES ON A PROJECT — the pure half (the buying build, 2026-11-05).
//
// Owner's plan: "one to-buy list for the whole project, from every sold proposal and change order; buy in parts —
// by stage, by proposal, by hand, or part of a line; order-by dates from the stage's first day less the supplier's
// lead time; three ways to buy — a supplier order, a send-to-a-buyer link (anyone, no login), or from stock;
// deliveries Ordered → Shipped → Delivered, a tracking number pasted; the crew taps Delivered; missing items go
// back on the list." This file holds the words, the dates, the carrier guess and the flags; it imports nothing
// that touches the server. The database half is ./server.ts.

export type OrderHow = "SUPPLIER" | "BUYER" | "STOCK";
export type OrderStatus = "ORDERED" | "SHIPPED" | "DELIVERED" | "PARTIAL" | "CANCELED";
export type LineStatus = "OPEN" | "BOUGHT" | "RECEIVED" | "MISSING";

export const HOW_LABEL: Record<OrderHow, string> = { SUPPLIER: "Supplier order", BUYER: "Someone buys it", STOCK: "From our stock" };
export const STATUS_LABEL: Record<OrderStatus, string> = { ORDERED: "Ordered", SHIPPED: "On its way", DELIVERED: "Delivered", PARTIAL: "Delivered, some missing", CANCELED: "Canceled" };

/** A supplier with no lead time of its own delivers in this many days. */
export const DEFAULT_LEAD_DAYS = 3;

const DAY_MS = 86_400_000;

/** A day (UTC midnight, like the stages' days) as "YYYY-MM-DD". */
export function isoDay(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const t = typeof d === "string" ? Date.parse(d) : d.getTime();
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** "Nov 3" from a day. */
export function dayWords(d: Date | string | null | undefined): string | null {
  const iso = isoDay(d);
  return iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;
}

/** The day to order by: the stage's first day less the lead time (never before today when the stage is near). */
export function orderByDate(stageStart: Date | string | null | undefined, leadDays: number): Date | null {
  const iso = isoDay(stageStart);
  if (!iso) return null;
  const t = Date.parse(`${iso}T00:00:00Z`) - Math.max(0, Math.round(leadDays)) * DAY_MS;
  return new Date(t);
}

/** Whole days from today to a day: negative when it has passed. */
export function daysUntil(d: Date | string | null | undefined, today: Date): number | null {
  const iso = isoDay(d);
  if (!iso) return null;
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Math.floor(today.getTime() / DAY_MS) * DAY_MS) / DAY_MS);
}

/** "by Wed Nov 12", "today", "2 days ago". */
export function dueWords(d: Date | string | null | undefined, today: Date): string | null {
  const n = daysUntil(d, today);
  if (n == null) return null;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n < 0) return `${-n} days ago`;
  return `${dayWords(d)} (in ${n} days)`;
}

// ── the carrier, from the tracking number ────────────────────────────────────

/** Where a pasted tracking number (or a pasted link) goes. Null when it fits nothing known — kept as typed. */
export function carrierOf(raw: string): { carrier: string; url: string } | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) {
    const host = t.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
    const carrier = host.includes("ups") ? "UPS" : host.includes("fedex") ? "FedEx" : host.includes("usps") ? "USPS" : host.includes("amazon") ? "Amazon" : host.includes("homedepot") ? "Home Depot" : host.includes("lowes") ? "Lowe's" : "Link";
    return { carrier, url: t };
  }
  const n = t.replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return { carrier: "UPS", url: `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}` };
  if (/^(9[2-5]\d{18,20}|\d{20,22})$/.test(n)) return { carrier: "USPS", url: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}` };
  if (/^(\d{12}|\d{15})$/.test(n)) return { carrier: "FedEx", url: `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}` };
  if (/^TBA\d{10,13}$/.test(n)) return { carrier: "Amazon", url: `https://www.amazon.com/progress-tracker/package/ref=ppx_yo_dt_b_track_package?itemId=&orderId=&packageIndex=0&shipmentId=&vendorAccountId=` };
  return null;
}

// ── what a material line stands at ───────────────────────────────────────────

export type MaterialLike = { quantity: number; orderedQty: number; receivedQty: number };

export type MaterialState = "to-buy" | "ordered" | "part" | "in";

/** What is still to order on a line. */
export function toBuyQty(m: MaterialLike): number {
  return Math.max(0, r2(m.quantity - m.orderedQty));
}

export function materialState(m: MaterialLike): MaterialState {
  if (m.receivedQty >= m.quantity && m.quantity > 0) return "in";
  if (m.orderedQty >= m.quantity) return m.receivedQty > 0 ? "part" : "ordered";
  return m.orderedQty > 0 || m.receivedQty > 0 ? "part" : "to-buy";
}

export const STATE_LABEL: Record<MaterialState, string> = { "to-buy": "To buy", ordered: "Ordered", part: "Partly in", in: "In" };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "12 sheets" / "1 each". */
export function qtyWords(qty: number, unit: string): string {
  const q = Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, "");
  return `${q} ${unit}`;
}

// ── what counts as a material on a proposal ──────────────────────────────────

/** Words that mark a line as work, not goods. */
const WORK = /\b(labor|labour|install(ation|ed|ing)?|removal|remove|demo(lition)?|haul|dump(ster)?|disposal|permit|fee|tax|deposit|design|engineering|inspection|cleanup|clean-up|service call|trip charge|delivery)\b/i;

/** A line the project has to buy: goods, with a quantity. A line priced only as labor is work. */
export function isMaterialLine(l: { name: string; quantity: number; materialCost?: number | null; laborCost?: number | null; productUrl?: string | null }): boolean {
  if (!(l.quantity > 0)) return false;
  if (WORK.test(l.name)) return false;
  if (l.productUrl) return true;
  const mat = l.materialCost ?? 0;
  const lab = l.laborCost ?? 0;
  if (mat <= 0 && lab > 0) return false;
  return true;
}

/** The unit a proposal line is measured in, in plain words. */
export function unitOf(measurementType: string | null | undefined): string {
  switch ((measurementType ?? "").toUpperCase()) {
    case "SQFT":
      return "sq ft";
    case "LINEAR_FT":
    case "LF":
      return "ln ft";
    case "HOUR":
    case "HOURS":
      return "hours";
    default:
      return "each";
  }
}

// ── flags for the list and the morning watch ─────────────────────────────────

export type BuyingFlag = { kind: "order-by" | "late-delivery"; text: string };

/**
 * What the buying flags on a project: materials for a stage that should have been ordered by now (the order-by day
 * passed, or the stage starts within the lead time) and deliveries past their expected day.
 */
export function buyingFlags(
  input: {
    materials: Array<MaterialLike & { stageName: string | null; stageStart: Date | string | null }>;
    orders: Array<{ status: string; expectedAt: Date | string | null; label: string }>;
  },
  today: Date,
  leadDays = DEFAULT_LEAD_DAYS,
): BuyingFlag[] {
  const out: BuyingFlag[] = [];
  const stages = new Map<string, number>();
  for (const m of input.materials) {
    if (toBuyQty(m) <= 0 || !m.stageStart) continue;
    const by = orderByDate(m.stageStart, leadDays);
    const n = daysUntil(by, today);
    if (n == null || n > 0) continue;
    const key = m.stageName ?? "the work";
    stages.set(key, Math.min(stages.get(key) ?? 0, n));
  }
  for (const [stage, n] of stages) out.push({ kind: "order-by", text: n === 0 ? `Order ${stage}'s materials today` : `${stage}'s materials not ordered — ${-n} day${-n === 1 ? "" : "s"} past the order-by day` });
  for (const o of input.orders) {
    if (o.status === "DELIVERED" || o.status === "PARTIAL" || o.status === "CANCELED") continue;
    const n = daysUntil(o.expectedAt, today);
    if (n == null || n >= 0) continue;
    out.push({ kind: "late-delivery", text: `${o.label} ${-n} day${-n === 1 ? "" : "s"} late` });
  }
  return out;
}

/* Which stage a material belongs to: the stage's own words ("decking" → "Decking and railings") and what each kind
   of stage is known to buy — a stage named Rough-in buys the plumbing and the wire, Finish buys the tile and the
   fixtures, Framing the joists and the lumber. Ties go to the earlier stage. */
const STAGE_HINTS: ReadonlyArray<{ match: RegExp; words: readonly string[] }> = [
  { match: /rough/, words: ["plumb", "electric", "wire", "wiring", "hvac", "duct", "pipe", "drain", "supply line", "outlet", "panel", "pex", "romex"] },
  { match: /drywall|paint/, words: ["drywall", "sheetrock", "mud", "tape", "paint", "primer", "texture"] },
  { match: /cabinet|counter/, words: ["cabinet", "counter", "quartz", "granite", "island", "pull", "knob"] },
  { match: /finish|trim/, words: ["tile", "trim", "stair", "backsplash", "fixture", "vanity", "toilet", "faucet", "light", "fan", "mirror", "accessor", "shower", "tub", "door", "baseboard", "floor", "appliance"] },
  { match: /demo/, words: ["dumpster", "disposal", "tarp"] },
  { match: /footing|post/, words: ["concrete", "footing", "post", "sonotube", "rebar", "gravel", "anchor"] },
  { match: /fram|ledger/, words: ["joist", "beam", "ledger", "lumber", "hanger", "blocking", "2x", "2×", "lag", "bolt", "flashing tape"] },
  { match: /deck|rail/, words: ["deck", "rail", "baluster", "stair", "fascia", "screw", "fastener", "composite", "trex"] },
  { match: /tear/, words: ["dumpster", "tarp"] },
  { match: /dry-in|dry in|underlay/, words: ["underlayment", "ice and water", "drip edge", "felt", "synthetic"] },
  { match: /shingle|flash/, words: ["shingle", "flashing", "vent", "ridge", "starter", "nail", "pipe boot", "cap"] },
  { match: /tile|waterproof/, words: ["tile", "grout", "thinset", "waterproof", "kerdi", "backer", "membrane", "niche"] },
  { match: /fixture/, words: ["vanity", "toilet", "faucet", "shower", "tub", "mirror", "light"] },
  { match: /equipment/, words: ["furnace", "condenser", "air handler", "heat pump", "thermostat", "coil", "unit"] },
  { match: /install/, words: ["line set", "duct", "refrigerant", "pad", "disconnect", "breaker"] },
  { match: /prep/, words: ["grind", "patch", "filler", "primer", "leveler", "crack"] },
  { match: /siding/, words: ["siding", "trim", "corner", "j-channel", "house wrap", "soffit", "fascia"] },
  { match: /panel|gate/, words: ["panel", "picket", "gate", "hinge", "latch", "rail"] },
  { match: /material/, words: [] },
];

/** The stage a material line belongs to, by its words. */
export function stageForLine<T extends { id: string; name: string }>(name: string, stages: readonly T[]): T | null {
  const n = name.toLowerCase();
  let best: { stage: T; score: number } | null = null;
  for (const st of stages) {
    const stageName = st.name.toLowerCase();
    const words = stageName.split(/[^a-z]+/).filter((w) => w.length > 3 && !["and", "the", "final", "ordered", "materials", "inspection", "payment"].includes(w));
    let score = 0;
    for (const w of words) {
      const stem = w.replace(/(ing|ings|s|ed)$/, "");
      if (stem.length > 2 && n.includes(stem)) score += stem.length;
    }
    for (const h of STAGE_HINTS) {
      if (!h.match.test(stageName)) continue;
      for (const w of h.words) if (n.includes(w)) score += 6;
    }
    if (score > 0 && (!best || score > best.score)) best = { stage: st, score };
  }
  return best?.stage ?? null;
}

/** The order's one-line name: "Order 3 · ABC Lumber · 12 lines". */
export function orderLabel(o: { number: number; how: string; supplierName?: string | null; buyerName?: string | null; lineCount: number }): string {
  const who = o.how === "SUPPLIER" ? (o.supplierName ?? "supplier") : o.how === "BUYER" ? (o.buyerName ?? "a buyer") : "our stock";
  return `Order ${o.number} · ${who} · ${o.lineCount} line${o.lineCount === 1 ? "" : "s"}`;
}
