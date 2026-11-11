// THE DECK STUDIO ADD-ON (owner, 2026-10-19: "if existing users didn't purchase Deck Studio, they can't use it. Only
// preview it. And option to add it to the plan." — then: preview = design without saving, $49/month added to the
// plan, the whole studio during the free trial; owner-locked 2026-10-20 in CLAUDE.md: no plan carries it).
// Pure: the price, the Stripe line's kind, what a stored record says.
//
// $79 A MONTH SINCE 2026-10-26 (owner): $790 on a yearly plan. A shop that bought it at $49 keeps $49 — its line
// keeps the price it was bought at. Nothing that rebuilds a subscription's lines swaps an add-on line for the new
// price: the line is told by its price's `jfKind`, never by its amount, and is left as it is. What the shop pays is
// read off its own line (`DeckAddonRecord.cents`), never from DECK_ADDON_CENTS.
//
// The add-on is a SECOND LINE on the subscription the shop already has (lib/deckAddonBilling), never a plan of its
// own and never a second subscription: one bill, one card, one cancel. A yearly plan carries the yearly line — ten
// months' price for twelve, the custom plan's rule (lib/customPlan CUSTOM_YEAR_MULTIPLIER).

import { CUSTOM_YEAR_MULTIPLIER } from "@/lib/customPlan";
import { isWebAddonLine } from "@/lib/webAddon";
import { isToolsExtraKind } from "@/lib/toolPlans/shared";

/** $79 a month (from 2026-10-26; $49 before — those lines keep $49). */
export const DECK_ADDON_CENTS = 7900;
/** The Stripe price's `jfKind` (lib/stripePriceCache) — how the line is told from the plan's own. */
export const DECK_ADDON_KIND = "deck-addon";
export const DECK_ADDON_NAME = "JobFlex Deck Studio add-on";

export type AddonInterval = "MONTH" | "YEAR";

/** What the line costs per term. */
export function deckAddonCents(interval: AddonInterval = "MONTH"): number {
  return interval === "YEAR" ? DECK_ADDON_CENTS * CUSTOM_YEAR_MULTIPLIER : DECK_ADDON_CENTS;
}

/** "$79/month" · "$790/year". */
export function deckAddonPriceWords(interval: AddonInterval = "MONTH"): string {
  return `$${Math.round(deckAddonCents(interval) / 100)}/${interval === "YEAR" ? "year" : "month"}`;
}

/** "$79/mo" · "$790/yr" — on a button. */
export function deckAddonShortWords(interval: AddonInterval = "MONTH"): string {
  return `$${Math.round(deckAddonCents(interval) / 100)}/${interval === "YEAR" ? "yr" : "mo"}`;
}

/** What the trial says wherever the add-on is offered (owner, 2026-10-20): the trial holds the studio, and the
 *  add-on button puts nothing on the subscription during it (picking a plan "with Deck Studio" does — lib/planChange,
 *  billed after the trial). */
export function deckTrialWords(interval: AddonInterval = "MONTH"): string {
  return `Included in your trial. After the trial, Deck Studio is a ${deckAddonShortWords(interval)} add-on.`;
}

/** What the plan pickers say beside "Add Deck Studio" in a trial (owner, 2026-10-26). */
export const DECK_PICK_TRIAL_WORDS = "Included in your trial, billed after it";

/** What a line bought at `cents` costs, in words: "$79/mo", or "$49/mo (your price)" for a line bought before the
 *  price changed (or at any price but today's). `mark: false` leaves "(your price)" off — for a sentence that says
 *  "your" already. */
export function deckAddonHeldWords(cents: number | null | undefined, interval: AddonInterval = "MONTH", { long = false, mark = true }: { long?: boolean; mark?: boolean } = {}): string {
  const list = deckAddonCents(interval);
  const c = typeof cents === "number" && cents > 0 ? cents : list;
  const d = c / 100;
  const amount = Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
  const per = interval === "YEAR" ? (long ? "year" : "yr") : long ? "month" : "mo";
  return `${amount}/${per}${mark && c !== list ? " (your price)" : ""}`;
}

/** A Stripe line (or anything with its price's metadata) that is the add-on. */
export function isDeckAddonLine(item: { price?: { metadata?: Record<string, string> | null } | null } | null | undefined): boolean {
  return item?.price?.metadata?.jfKind === DECK_ADDON_KIND;
}

/** Any add-on line: the Deck Studio one, a website estimator's (lib/webAddon, 2026-10-27), or — on the new plans
 *  (lib/toolPlans, 2026-11-10) — a tool's line or the extra-people line. Never the plan's own line. */
export function isAddonLine(item: { price?: { metadata?: Record<string, string> | null } | null } | null | undefined): boolean {
  return isDeckAddonLine(item) || isWebAddonLine(item) || isToolsExtraKind(item?.price?.metadata?.jfKind);
}

/** The plan's own lines — every line but the add-ons. A subscription's plan is read off these, never an add-on. */
export function planLines<T extends { price?: { metadata?: Record<string, string> | null } | null }>(items: readonly T[]): T[] {
  return items.filter((i) => !isAddonLine(i));
}

/** The plan's line: the first that is not the add-on (the first line as it was, when the add-on is all there is). */
export function planLine<T extends { price?: { metadata?: Record<string, string> | null } | null }>(items: readonly T[]): T | undefined {
  return planLines(items)[0] ?? items[0];
}

/** What we keep per organization (SyncState `deckAddon:<orgId>`): the subscription and the line that carry it. */
export interface DeckAddonRecord {
  subId: string;
  itemId: string;
  interval: AddonInterval;
  /** When it was added (ISO). */
  since: string;
  /** What the line bills per term, from its own price (records from before 2026-10-26 have none: read off Stripe). */
  cents?: number;
}

export function parseDeckAddonRecord(raw: string | null | undefined): DeckAddonRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<DeckAddonRecord>;
    if (typeof r.subId !== "string" || !r.subId || typeof r.itemId !== "string" || !r.itemId) return null;
    return {
      subId: r.subId,
      itemId: r.itemId,
      interval: r.interval === "YEAR" ? "YEAR" : "MONTH",
      since: typeof r.since === "string" ? r.since : "",
      ...(typeof r.cents === "number" && r.cents > 0 ? { cents: r.cents } : {}),
    };
  } catch {
    return null;
  }
}

/** The record opens the studio only on the subscription it was bought on: a plan bought again through a new
 *  Checkout (a new subscription) does not carry the old line, so it does not carry the add-on either. */
export function addonHeld(record: DeckAddonRecord | null, externalSubId: string | null | undefined): boolean {
  return !!record && !!externalSubId && record.subId === externalSubId;
}

/** WHAT A PLAN PICKER SHOWS FOR "Add Deck Studio" (owner, 2026-10-26): the box, or why there is none — on the plan
 *  already (at its own price), or the studio open without it. No Stripe call but a held line's price, once. */
export interface DeckAddonPick {
  /** The box is drawn: the studio is neither on the plan nor included in it. */
  offer: boolean;
  /** On the plan: what it costs ("$49/mo (your price)" for a line bought before 2026-10-26) and its term. */
  held: { words: string; interval: AddonInterval } | null;
  /** The studio is open without it: a complimentary plan, the Custom plan's deck page, or a platform admin
   *  (lib/fullAccess — the studio is always whole for them, lib/editions). */
  included: "grant" | "custom" | "admin" | null;
  /** In a trial — the box says "Included in your trial, billed after it". */
  trialing: boolean;
}
