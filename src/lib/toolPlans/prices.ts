import "server-only";
// THE NEW PLANS' PRICES (owner, 2026-11-10: "prices live in Admin → Plans"). SyncState `toolPrices` =
// { prices: PriceSet, by, at } — only the prices Admin changed; the code's prices are the defaults
// (lib/toolPlans/shared). Saving refuses a price out of range or a bundle that would cost more than its parts
// (priceProblems). A new price makes a new Stripe price the next time a line is put on (lib/stripePriceCache);
// a shop keeps the price its line was bought at.

import { db } from "@/lib/db";
import { isPriceCents, isToolId, priceProblems, withPrices, type Catalog, type PriceSet, type SeatPlanId, type ToolId, type ToolPlanId } from "./shared";

export const TOOL_PRICES_KEY = "toolPrices";

export interface ToolPriceSetting {
  prices: PriceSet;
  source: "admin" | "default";
  by: string | null;
  at: string | null;
}

const PLAN_IDS: readonly ToolPlanId[] = ["basic", "professional", "advanced", "complete"];
const SEAT_IDS: readonly SeatPlanId[] = ["professional", "advanced", "complete"];

/** Keep only known keys with sane prices — a row edited by hand can't put a nonsense price on a bill. */
export function cleanPriceSet(raw: unknown): PriceSet {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <K extends string>(obj: unknown, keys: readonly K[] | ((k: string) => k is K)): Partial<Record<K, number>> => {
    const o = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
    const out: Partial<Record<K, number>> = {};
    for (const [k, v] of Object.entries(o)) {
      const known = typeof keys === "function" ? keys(k) : (keys as readonly string[]).includes(k);
      if (known && isPriceCents(v)) out[k as K] = v;
    }
    return out;
  };
  return { plans: pick(r.plans, PLAN_IDS), seats: pick(r.seats, SEAT_IDS), tools: pick<ToolId>(r.tools, (k): k is ToolId => isToolId(k)) };
}

const CACHE_MS = 30_000;
let cache: { at: number; value: ToolPriceSetting } | null = null;

/** The prices in force. Never throws: a hiccup reads as the defaults, uncached. */
export async function readToolPrices({ fresh = false }: { fresh?: boolean } = {}): Promise<ToolPriceSetting> {
  const now = Date.now();
  if (!fresh && cache && now - cache.at < CACHE_MS) return cache.value;
  let value: ToolPriceSetting = { prices: {}, source: "default", by: null, at: null };
  try {
    const row = await db.syncState.findUnique({ where: { key: TOOL_PRICES_KEY }, select: { cursor: true } });
    if (row?.cursor) {
      const r = JSON.parse(row.cursor) as Record<string, unknown>;
      const prices = cleanPriceSet(r.prices);
      // A stored set that breaks the price rule (a row edited by hand) is not used: the defaults are.
      if (!priceProblems(prices).length) value = { prices, source: "admin", by: typeof r.by === "string" ? r.by : null, at: typeof r.at === "string" ? r.at : null };
    }
  } catch (err) {
    console.warn("[tool-prices] read failed, using the defaults:", err);
    return value;
  }
  cache = { at: now, value };
  return value;
}

/** The plans and tools with the prices in force. */
export async function readToolCatalog(): Promise<Catalog> {
  return withPrices((await readToolPrices()).prices);
}

export type SaveToolPrices = { ok: true; setting: ToolPriceSetting } | { ok: false; problems: string[] };

export async function setToolPrices(raw: unknown, by: string | null): Promise<SaveToolPrices> {
  const prices = cleanPriceSet(raw);
  const problems = priceProblems(prices);
  // Anything the form sent that didn't survive cleaning is a problem too (a typo must not be dropped silently).
  const sent = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const count = (o: Record<string, unknown> | undefined) => Object.keys(o ?? {}).length;
  const kept = count(prices.plans) + count(prices.seats) + count(prices.tools);
  if (count(sent.plans) + count(sent.seats) + count(sent.tools) !== kept && !problems.length) problems.push("Some prices weren't numbers between $1 and $10,000.");
  if (problems.length) return { ok: false, problems };
  const cursor = JSON.stringify({ prices, by, at: new Date().toISOString() });
  await db.syncState.upsert({ where: { key: TOOL_PRICES_KEY }, create: { key: TOOL_PRICES_KEY, cursor }, update: { cursor } });
  cache = null;
  return { ok: true, setting: await readToolPrices({ fresh: true }) };
}
