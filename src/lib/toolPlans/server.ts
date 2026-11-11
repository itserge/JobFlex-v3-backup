import "server-only";
// THE PLANS SWITCH (owner, 2026-11-10: "add the new subscription type and its switch in Trial watch, and keep it off;
// as soon as it's built we'll switch it on"). SyncState `pricingModel` = { mode, by, at }; no row = "classic".
//
//   classic — today: the plan cards, the sign-up and every gate work exactly as they do now.
//   tools   — new sign-ups get Basic / Professional / Advanced / Complete plus the tools (lib/toolPlans/shared).
//             Shops already on a plan stay Classic for good: their slugs are Classic slugs, and the rules follow the
//             slug (isToolsSlug), never the switch.
//
// The switch could not be turned on until the build was finished: TOOLS_PLANS_READY flipped to true in part 4, the part
// that made the new plans buyable end to end (checkout, the menu, the Subscription page, the cards). Before that the
// admin panel showed the "Base + Tools" button greyed with the parts still to come, and setPricingModel refused it.

import { db } from "@/lib/db";

/** True since part 4 (2026-11-11): the new plans are buyable end to end — the plan cards, the sign-up's card page and
 *  its checkout, the menu, the Subscription and welcome pages. The switch itself stays where the owner leaves it
 *  (off until he turns it on in Admin → Trial watch). Part 5 (2026-11-11) added the numbers: Admin → Revenue's
 *  "New plans (Base + Tools)" section (lib/toolPlans/numbers). */
export const TOOLS_PLANS_READY = true;

/** What is built and what is still to come — the admin panel lists it beside the greyed button. */
export const TOOLS_PLANS_PARTS: ReadonlyArray<{ part: number; what: string; done: boolean }> = [
  { part: 1, what: "The new plans and tools, the price check, and this switch", done: true },
  { part: 2, what: "Plans, people and tools on the bill (Stripe lines, prices in Admin → Plans)", done: true },
  { part: 3, what: "A menu with only what the shop has, the Subscription page, the welcome page, 3-day tries", done: true },
  { part: 4, what: "Ads open their plan: the plan cards, Change tool at sign-up, Switch my main tool", done: true },
  { part: 5, what: "The numbers: MRR by tool, tries kept, Classic vs new (Admin → Revenue)", done: true },
];

export type PricingModel = "classic" | "tools";

export function isPricingModel(value: unknown): value is PricingModel {
  return value === "classic" || value === "tools";
}

export const PRICING_MODEL_KEY = "pricingModel";

export interface PricingModelSetting {
  mode: PricingModel;
  source: "admin" | "default";
  by: string | null;
  at: string | null;
  /** When the new plans were last turned on — shops that signed up before it are Classic. */
  onSince: string | null;
}

const CACHE_MS = 10_000;
let cache: { at: number; value: PricingModelSetting } | null = null;

/** The plans in force for NEW sign-ups. Never throws: a hiccup reads as Classic, uncached. */
export async function readPricingModel({ fresh = false }: { fresh?: boolean } = {}): Promise<PricingModelSetting> {
  const now = Date.now();
  if (!fresh && cache && now - cache.at < CACHE_MS) return cache.value;
  let value: PricingModelSetting = { mode: "classic", source: "default", by: null, at: null, onSince: null };
  try {
    const row = await db.syncState.findUnique({ where: { key: PRICING_MODEL_KEY }, select: { cursor: true } });
    if (row?.cursor) {
      const r = JSON.parse(row.cursor) as Record<string, unknown>;
      if (isPricingModel(r.mode)) {
        value = {
          // Not ready = Classic, whatever a row says (a row written by hand can't switch the new plans on early).
          mode: TOOLS_PLANS_READY ? r.mode : "classic",
          source: "admin",
          by: typeof r.by === "string" ? r.by : null,
          at: typeof r.at === "string" ? r.at : null,
          onSince: typeof r.onSince === "string" ? r.onSince : null,
        };
      }
    }
  } catch (err) {
    console.warn("[pricing-model] read failed, using Classic:", err);
    return value;
  }
  cache = { at: now, value };
  return value;
}

/** True when new sign-ups get the new plans. */
export async function toolsPlansOn(): Promise<boolean> {
  return (await readPricingModel()).mode === "tools";
}

export async function setPricingModel(mode: PricingModel, by: string | null): Promise<PricingModelSetting> {
  if (mode === "tools" && !TOOLS_PLANS_READY) throw new Error("not-ready");
  const before = await readPricingModel({ fresh: true });
  const at = new Date().toISOString();
  // Keep the first "on" moment across off/on flips only while it stays on; turning it on again starts a new one.
  const onSince = mode === "tools" ? (before.mode === "tools" && before.onSince ? before.onSince : at) : null;
  const cursor = JSON.stringify({ mode, by, at, onSince });
  await db.syncState.upsert({ where: { key: PRICING_MODEL_KEY }, create: { key: PRICING_MODEL_KEY, cursor }, update: { cursor } });
  cache = null;
  return readPricingModel({ fresh: true });
}
