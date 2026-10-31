// ONE HOMEOWNER PORTAL (owner, 2026-10-28: "why does pricing have a separate URL? everything should be on one home
// portal — the only place they pre-estimate and submit their project; make it smart"). /homeowner is the door: the
// homeowner writes what they want, and the portal points at the estimator that prices it for their house — the roof
// from the sky, the deck in 3D, the fence on the lot, heating & cooling sized to the house, anything else from their
// words and photos — at /homeowner/price/<trade>. The old addresses (/price, /price/roof, /estimate/jobflex/<trade>)
// forward here with their query, so emails, cost guides and bookmarks keep working.
//
// Pure: the wizards (client), the estimator pages (server) and the middleware read it.

/** The estimators the portal runs: "smart" is "any project" (kitchen, bath, remodels — Smart Proposal). */
export type PortalTrade = "roof" | "deck" | "fence" | "hvac" | "smart";

export const PORTAL_TRADES: ReadonlyArray<PortalTrade> = ["roof", "deck", "fence", "hvac", "smart"];

export const PORTAL_PATH = "/homeowner";
export const PORTAL_PRICE_PATH = "/homeowner/price";

export const isPortalTrade = (x: unknown): x is PortalTrade => typeof x === "string" && (PORTAL_TRADES as readonly string[]).includes(x);

export const portalPriceHref = (t: PortalTrade): string => `${PORTAL_PRICE_PATH}/${t}`;

/** What the portal says when the description points at an estimator — true of each estimator as it runs. */
export const PRICE_NUDGE: Record<PortalTrade, { say: string; go: string }> = {
  roof: { say: "Your roof can be priced right here — measured from the sky for your house, a range in about a minute.", go: "See my roof price" },
  deck: { say: "Design your deck in 3D on your lot and see the price as you build it.", go: "Design my deck" },
  fence: { say: "Draw your fence on your lot from the air — a price range in about a minute.", go: "Price my fence" },
  hvac: { say: "We look up your house and size the system to it — a price range in about a minute.", go: "Price my new system" },
  smart: { say: "We can price this from your words and photos — a range in about a minute.", go: "See my price" },
};

// In order: the first that matches wins. Roof before deck ("roof over the deck" is a covered deck — the deck studio
// draws roofs too, but a homeowner who says "roof" first means the house's roof often enough). Words only a
// homeowner would write; "leak" alone is not a roof (a sink leaks too), "gate" alone is not a fence.
const RULES: ReadonlyArray<[PortalTrade, RegExp]> = [
  ["hvac", /\b(hvac|furnace|heat\s?pump|air\s?condition\w*|a\/c|ac\s+unit|central\s+air|mini[\s-]?split|boiler|heating|cooling)\b/i],
  ["roof", /\b(re-?roof\w*|roof\w*|shingles?)\b/i],
  ["deck", /\b(decks?|decking|pergolas?|gazebos?)\b/i],
  ["fence", /\b(fenc(e|es|ing))\b/i],
  ["smart", /\b(kitchen|bath(room)?s?|shower|tub|vanity|remodel\w*|renovat\w*|cabinets?|counter\s?tops?|backsplash|tile|tiling|floor(s|ing)?|hardwood|basement|paint\w*|drywall|addition|siding|windows?|doors?)\b/i],
];

/** The estimator a homeowner's words point at, or null (too short, or nothing priceable). `house`: the Lead Center
 *  names the house org, so deck, fence, heating & cooling and any project are priced here; without it only the roof. */
export function priceTradeFor(text: string, house: boolean): PortalTrade | null {
  const t = String(text ?? "").trim();
  if (t.length < 4) return null;
  for (const [trade, re] of RULES) {
    if (!re.test(t)) continue;
    if (trade === "roof" || house) return trade;
    return null;
  }
  return null;
}

/** The old pricing addresses → their place in the portal (the middleware 308s, the query kept), or null. */
export function movedPricePath(pathname: string): string | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (p === "/price") return PORTAL_PATH;
  if (p === "/price/roof") return portalPriceHref("roof");
  const m = /^\/estimate\/jobflex\/([a-z]+)$/.exec(p);
  if (m && isPortalTrade(m[1])) return portalPriceHref(m[1]);
  return null;
}

/** The portal's promise under the headline (desk and phone say the same) — only what the estimators on now do; two lines
 *  on a desk (2026-10-31: the dashboard line is the proof cards' to say). */
export function portalHeroSub(house: boolean): string {
  return house
    ? "Roofs, decks, fences, heating & cooling and remodels are priced for your house in about a minute. Then a local pro on JobFlex takes it — free, no account needed."
    : "Roofs are priced for your house in about a minute; anything else becomes a written scope a local pro on JobFlex can price — free, no account needed.";
}
