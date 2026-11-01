// WEBSITE ESTIMATORS (owner, 2026-10-27): a contractor puts JobFlex's estimator on THEIR OWN website — a link, a button
// or a full-page embed — so a homeowner types an address, picks a material and sees a price range in the shop's own
// prices; "Get my full quote" makes a Lead on the shop's My leads, with the measurement and the package, and the shop
// opens its estimator already measured and priced. One add-on per trade, each a line on the shop's subscription
// (like the Deck Studio add-on): roof $179, HVAC $79, fence $99 (confirmed by the owner 2026-10-27), deck $150.
//
// Pure: the trades and their prices, a shop's settings (what to show, which materials, the domains the button may run
// on), the price range, the embed snippets, the lead's words, the SyncState keys. The public address is the company's
// own handle, the one /book/<slug> uses: jobflex.app/estimate/<slug>/<trade>. The server side is
// lib/webEstimatorServer (settings, the estimate, the lead, the counters), the public pages
// app/(portal)/estimate/[slug]/[trade], the settings pane settings-blueprint/panes/website-pane.
// PREVIEW (owner): until the WEB_OPEN switch is on, only platform admins see the pane and can turn a trade on, and
// nothing is billed; the Stripe line per trade comes when the owner has tested the flow. Not on the pricing page.

import { LEAD_CONSENT_TEXT } from "./leadConsent";
import { PRO, PRO_IS } from "./home/jobflexPro";

export const WEB_TRADES = ["roof", "hvac", "fence", "deck", "smart"] as const;
export type WebTrade = (typeof WEB_TRADES)[number];
export const isWebTrade = (v: unknown): v is WebTrade => typeof v === "string" && (WEB_TRADES as readonly string[]).includes(v);

export interface WebTradeInfo {
  /** The add-on's name on the bill and in Settings. */
  name: string;
  /** What the homeowner sees. */
  title: string;
  /** The button's words on the contractor's site. */
  button: string;
  /** A month, in cents. */
  cents: number;
  /** The Stripe price's jfKind (lib/stripePriceCache) — one price per trade. */
  kind: string;
  /** The estimator the lead opens in (lib/estimateSeed EstimatorId). */
  estimator: "roof" | "hvac" | "fence" | "deck" | "smart";
  /** Said under the price on the public page: where the number comes from. */
  basis: string;
}

export const WEB_TRADE: Record<WebTrade, WebTradeInfo> = {
  roof: { name: "Roof estimator on your website", title: "Your roof, priced", button: "Get my roof price", cents: 17900, kind: "web-roof", estimator: "roof", basis: "Measured from aerial imagery. The final price follows a visit." },
  hvac: { name: "HVAC estimator on your website", title: "Your new system, priced", button: "Price my new system", cents: 7900, kind: "web-hvac", estimator: "hvac", basis: "Sized to the house with a Manual J-style load. The final price follows a visit." },
  fence: { name: "Fence estimator on your website", title: "Your fence, priced", button: "Price my fence", cents: 9900, kind: "web-fence", estimator: "fence", basis: "Priced per foot in this area. The final price follows a visit." },
  deck: { name: "Deck Studio on your website", title: "Your deck, designed and priced", button: "Design my deck", cents: 15000, kind: "web-deck", estimator: "deck", basis: "Priced from the design, to code. The final price follows a visit." },
  // Smart Proposal for remodelers (owner, 2026-10-28) — no price named; $99 a month stands in.
  smart: { name: "Smart Proposal on your website", title: "Your project, priced", button: "Price my project", cents: 9900, kind: "web-smart", estimator: "smart", basis: "Priced from your description and photos. The final price follows a visit." },
};

/** What the shop asks the homeowner for before the full quote. Name and one way to reach them are always asked. */
export interface WebTradeSettings {
  on: boolean;
  /** "range" shows a band around the price; "exact" shows the number. */
  show: "range" | "exact";
  /** The band, as a share of the price each way (0.1 = ±10 %). */
  spread: number;
  /** Material / package ids the homeowner may pick from; empty = the trade's default list. */
  materials: string[];
  /** Ask for the email too (the phone is always asked: the shop calls). */
  askEmail: boolean;
  /** Words under the price, the shop's own; empty = the trade's basis line. */
  note: string;
}

export interface WebEstimatorSettings {
  /** The hosts the button may run on; empty = any site. The link itself always works. */
  domains: string[];
  /** The public estimates allowed a month across the trades (a cost guard); 0 = the default. */
  monthlyCap: number;
  trades: Record<WebTrade, WebTradeSettings>;
}

export const DEFAULT_MONTHLY_CAP = 300;
export const SPREAD_MIN = 0.05;
export const SPREAD_MAX = 0.3;

export const defaultTradeSettings = (): WebTradeSettings => ({ on: false, show: "range", spread: 0.12, materials: [], askEmail: true, note: "" });

export function defaultWebEstimatorSettings(): WebEstimatorSettings {
  return { domains: [], monthlyCap: DEFAULT_MONTHLY_CAP, trades: Object.fromEntries(WEB_TRADES.map((t) => [t, defaultTradeSettings()])) as Record<WebTrade, WebTradeSettings> };
}

// ── the shop, the estimate and the lead — the shapes (the server half keeps and reads them)

export interface WebShop {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  phone: string | null;
  website: string | null;
  /** The shop's state (from its address), the trade engines' default when the homeowner's address has none. */
  state: string | null;
  settings: WebEstimatorSettings;
}

/** What every trade's engine gives the public page — the words, the number, and what the lead will carry. */
export interface WebEstimateRecord {
  token: string;
  organizationId: string;
  trade: WebTrade;
  at: string;
  /** The homeowner's address as typed, and its parts when known. */
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** One line about what was measured or asked: "26 squares at a 6:12 pitch, 3 facets." */
  summary: string;
  /** What they picked: "GAF Timberline HDZ, Charcoal". */
  choice: string;
  /** The price before the band, in cents, and the band shown. */
  cents: number;
  band: { low: number; high: number };
  show: "range" | "exact";
  /** The trade's own facts for the estimator hand-off (a RoofMeasurement id, the HVAC inputs, the deck design…). */
  facts: Record<string, unknown>;
}

export interface WebLeadContact { name: string; phone: string; email: string | null; note: string | null }

/** What the lead carries beyond the Lead row — read by My leads and the estimator hand-off. */
export interface WebLeadRecord { leadId: string; trade: WebTrade; estimate: WebEstimateRecord; contact: WebLeadContact; at: string }

// ── THE HOUSE (owner, 2026-10-28: "let people get preliminary estimates for HVAC, fence, roof, Deck Studio and the smart
// estimator using our models; when they like it they submit, we give it to the contractor"). The same estimators run for
// the homeowner in JobFlex's own homeowner portal (/homeowner/price/<trade>, lib/home/portalPrice) with JobFlex as the shop: the internal
// organization the admin picks on the Lead Center (lib/publicEstimate/store houseOrgId) is the shop's id — its price
// books, its spend, its counters — and the send becomes a Lead Center lead, never a lead of that org. Every trade but
// the roof (one roof flow: /homeowner/price/roof), always a range, its own ceilings. Design:
// docs/superpowers/specs/2026-10-28-home-portal-house-estimators-design.md.

export const HOUSE_SLUG = "jobflex";
export const HOUSE_NAME = "JobFlex";
/** The house's own ceilings — a shop's are DEFAULT_MONTHLY_CAP and SHOP_HOURLY. */
export const HOUSE_MONTHLY_CAP = 2000;
export const HOUSE_HOURLY = { estimates: 600, leads: 120 } as const;
export const SHOP_HOURLY = { estimates: 120, leads: 60 } as const;

export function houseSettings(): WebEstimatorSettings {
  const s = defaultWebEstimatorSettings();
  for (const t of WEB_TRADES) s.trades[t].on = t !== "roof";
  s.monthlyCap = HOUSE_MONTHLY_CAP;
  return s;
}

/** The house as a shop: JobFlex on the house org — no logo (the product mark), no phone, no website, no state. */
export function houseShop(orgId: string): WebShop {
  return { id: orgId, name: HOUSE_NAME, slug: HOUSE_SLUG, logoUrl: null, primaryColor: null, phone: null, website: null, state: null, settings: houseSettings() };
}

export const isHouse = (shop: { slug: string }): boolean => shop.slug === HOUSE_SLUG;

/** The per-shop hourly brakes: the house's own, else today's. */
export function shopHourly(shop: { slug: string }): { estimates: number; leads: number } {
  return isHouse(shop) ? HOUSE_HOURLY : SHOP_HOURLY;
}

/** The page's words where a shop's name stood: a shop's page names the shop (the strings the pages always printed);
 *  the house's names a local JobFlex pro (lib/home/jobflexPro), since up to three contractors may call, and carries
 *  the Lead Center's own consent. */
export function pageWords(shop: { name: string; house?: boolean }, noun: string): { who: string; sees: string; quote: string; consent: string; foot: string; call: string } {
  if (shop.house) {
    return {
      who: PRO,
      sees: `No account, no payment. JobFlex sends your request to ${PRO} only when you send it.`,
      quote: `The full, line-by-line quote comes from ${PRO} after they look at it. You pick a time; they confirm the price.`,
      consent: LEAD_CONSENT_TEXT,
      foot: `Estimates by JobFlex. No prices are shown to anyone else; ${PRO} confirms on site. ${PRO_IS}`,
      call: `Describe it instead and ${PRO} prices it.`,
    };
  }
  return {
    who: shop.name,
    sees: `No account, no payment. ${shop.name} sees your request only when you send it.`,
    quote: `The full, line-by-line quote comes from ${shop.name} after they look at it. You pick a time; they confirm the price.`,
    consent: `${shop.name} may call, text or email me about this ${noun}.`,
    foot: `Estimates by JobFlex for ${shop.name}. No prices are shown to anyone else; the final price follows a visit.`,
    call: `Call ${shop.name} and they will price it in person.`,
  };
}

/** Whatever was stored, as settings: unknown fields dropped, numbers clamped, hosts cleaned. */
export function normalizeWebEstimatorSettings(raw: unknown): WebEstimatorSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = defaultWebEstimatorSettings();
  out.domains = Array.isArray(r.domains) ? r.domains.map((d) => cleanHost(String(d))).filter((d): d is string => !!d).slice(0, 10) : [];
  const cap = Number(r.monthlyCap);
  out.monthlyCap = Number.isFinite(cap) && cap > 0 ? Math.min(5000, Math.round(cap)) : DEFAULT_MONTHLY_CAP;
  const trades = (r.trades && typeof r.trades === "object" ? r.trades : {}) as Record<string, unknown>;
  for (const t of WEB_TRADES) {
    const x = (trades[t] && typeof trades[t] === "object" ? trades[t] : {}) as Record<string, unknown>;
    const d = out.trades[t];
    d.on = x.on === true;
    d.show = x.show === "exact" ? "exact" : "range";
    const sp = Number(x.spread);
    d.spread = Number.isFinite(sp) ? Math.min(SPREAD_MAX, Math.max(SPREAD_MIN, sp)) : d.spread;
    d.materials = Array.isArray(x.materials) ? x.materials.filter((m): m is string => typeof m === "string" && m.length <= 80).slice(0, 40) : [];
    d.askEmail = x.askEmail !== false;
    d.note = typeof x.note === "string" ? x.note.trim().slice(0, 200) : "";
  }
  return out;
}

// ── where things are kept (SyncState keys; no schema change — the production schema is not pushed by the build)

/** The one switch: false = the feature shows only to platform admins (the owner's test); true = every account. */
export const WEB_OPEN_KEY = "webEstimator:open";
export const webSettingsKey = (organizationId: string) => `webEstimator:${organizationId}`;
/** A month's views / estimates / leads for a shop. */
export const webCountsKey = (organizationId: string, month: string) => `webEstimatorCounts:${organizationId}:${month}`;
/** A public estimate, kept an hour so the quote form can name it. */
export const webEstimateKey = (token: string) => `webEstimate:${token}`;
/** What a website lead chose: the trade, the measurement, the package, the band — read by the estimator hand-off. */
export const webLeadKey = (leadId: string) => `webLead:${leadId}`;
export const WEB_ESTIMATE_TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;

// ── the price range

/** Round a dollar amount to a figure a homeowner can hold: $50 under $5,000, $100 under $20,000, $500 above. */
export function roundDollars(d: number): number {
  const step = d < 5000 ? 50 : d < 20000 ? 100 : 500;
  return Math.round(d / step) * step;
}

/** The band shown for a price: [low, high] in dollars, rounded; "exact" gives the rounded price twice. */
export function priceBand(cents: number, show: "range" | "exact", spread: number): { low: number; high: number } {
  const d = Math.max(0, cents) / 100;
  if (show === "exact") { const r = roundDollars(d); return { low: r, high: r }; }
  const sp = Math.min(SPREAD_MAX, Math.max(SPREAD_MIN, spread));
  return { low: roundDollars(d * (1 - sp)), high: roundDollars(d * (1 + sp)) };
}

export const money = (d: number): string => "$" + Math.round(d).toLocaleString("en-US");
export const bandWords = (b: { low: number; high: number }): string => (b.low === b.high ? money(b.low) : `${money(b.low)} – ${money(b.high)}`);

// ── the embed

/** The button's colour when the shop has set no brand colour — the blueprint blue. */
export const WEB_BUTTON_COLOR = "#1854a0";
/** The shop's brand colour (Settings → Company) as the button paints it: a hex colour, else the blueprint blue. */
export const embedButtonColor = (c: string | null | undefined): string => (c && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()) ? c.trim().toLowerCase() : WEB_BUTTON_COLOR);
/** White or ink on the button, whichever reads on its colour (the same rule public/embed/estimator.js applies). */
export function embedButtonInk(color: string): string {
  const h = embedButtonColor(color).slice(1);
  const full = h.length === 3 ? h.replace(/./g, (x) => x + x) : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#0b0d12" : "#ffffff";
}

/** The three ways onto a website, from the app's base URL, the slug and the trade. The button carries the trade's
 *  words and the shop's brand colour (`color`, Settings → Company), so it paints as the shop's own. */
export function embedSnippets(base: string, slug: string, trade: WebTrade, color?: string | null): { link: string; button: string; iframe: string } {
  const b = base.replace(/\/+$/, "");
  const link = `${b}/estimate/${slug}/${trade}`;
  return {
    link,
    button: `<script src="${b}/embed/estimator.js" data-shop="${slug}" data-trade="${trade}" data-label="${WEB_TRADE[trade].button}" data-color="${embedButtonColor(color)}" async></script>`,
    iframe: `<iframe src="${link}?embed=1" title="${WEB_TRADE[trade].title}" style="width:100%;min-height:720px;border:0;border-radius:12px" loading="lazy" allow="geolocation"></iframe>`,
  };
}

/** A host as stored: lower-case, no scheme, no path, no port, no leading www. */
export function cleanHost(v: string): string | null {
  let h = v.trim().toLowerCase();
  h = h.replace(/^https?:\/\//, "").split("/")[0].split("?")[0].split(":")[0].replace(/^www\./, "");
  // a real site name (ridgelineroofing.com, shop.ridgeline.co.uk, 192.168.1.20) or localhost — their web developer's machine
  return h === "localhost" || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : null;
}

/** A typed address with no map pick — "4312 Lakeview Dr, Kirkland, WA 98033" — split into its parts when the shape is
 *  plain; anything else stays whole in `address`. Keeps the lead's city/state/zip filled for alerts and the estimators. */
export function splitTypedAddress(a: { address: string; city: string; state: string; zip: string }): { address: string; city: string; state: string; zip: string } {
  if (a.city || a.state || a.zip) return a;
  const m = a.address.trim().replace(/,?\s*(USA|United States)$/i, "").match(/^(.+?),\s*([A-Za-z .'-]+?),?\s+([A-Za-z]{2})(?:\s+(\d{5})(?:-\d{4})?)?$/);
  if (!m) return a;
  return { address: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] ?? "" };
}

/** What one click on the lead page does for each trade — said plainly, no more than the estimator will do. */
export const HANDOFF_WORDS: Record<WebTrade, string> = {
  roof: "Opens on their aerial measurement with the material they chose, priced in your book — the number they saw.",
  hvac: "Opens with their house looked up and sized, the tier they picked selected and priced in your book — adjust, then send the proposal.",
  fence: "Opens on their lot with the fence as they drew it — the style, the height, the gates — priced in your book.",
  deck: "Opens as a draft with their deck designed and priced the way they saw it — adjust, then send the proposal.",
  smart: "Opens Smart Proposal at the result with the lines they were priced on — re-price in your own method and send the proposal.",
};

/** May the button run on `host`? Empty list = anywhere; a listed domain covers its subdomains; the app itself always. */
export function hostAllowed(domains: readonly string[], host: string | null | undefined, appHost?: string | null): boolean {
  if (!domains.length) return true;
  const h = cleanHost(host || "");
  if (!h) return false;
  if (appHost && (h === cleanHost(appHost) || h.endsWith("." + cleanHost(appHost)))) return true;
  return domains.some((d) => h === d || h.endsWith("." + d));
}

// ── the lead

/** Stored on the Lead: the existing "Website" source (lib/leads/sources — the shop's own side), the trade as the project type. */
export const WEB_LEAD_SOURCE = "WEBSITE";
export const PROJECT_TYPE: Record<WebTrade, string> = { roof: "Roofing", hvac: "HVAC", fence: "Fence", deck: "Deck", smart: "Remodel" };

/** The month a counter belongs to, in the shop's calendar: "2026-10". */
export const monthKey = (d: Date = new Date()): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export interface WebMonthCounts { views: number; estimates: number; leads: number }
export const emptyCounts = (): WebMonthCounts => ({ views: 0, estimates: 0, leads: 0 });

/** The words of the lead's description, from what the homeowner chose — read on My leads and by the estimator seed. */
export function leadDescription(trade: WebTrade, parts: { summary: string; choice: string; band: { low: number; high: number }; show: "range" | "exact"; note?: string }): string {
  const price = parts.show === "exact" ? `Priced at ${money(parts.band.low)}` : `Shown ${bandWords(parts.band)}`;
  return [`From the ${WEB_TRADE[trade].name.replace(" on your website", "").toLowerCase()} on your website.`, parts.summary, parts.choice ? `Chose: ${parts.choice}.` : "", `${price} (before tax).`, parts.note || ""].filter(Boolean).join(" ");
}

// ── A REQUEST WITH NO PRICE (2026-11-01): the estimator resting for the month (the shop's cap), or no aerial read of
// this house — the form still takes the request; the lead says no price was shown, the homeowner is told the shop
// prices it. Counted as a lead, never an estimate.

export type WebUnpricedWhy = "resting" | "unpriced";
export const isWebUnpricedWhy = (v: unknown): v is WebUnpricedWhy => v === "resting" || v === "unpriced";

/** The lead's words when no price was shown. */
export function unpricedLeadDescription(trade: WebTrade, why: WebUnpricedWhy, note?: string | null): string {
  const tool = WEB_TRADE[trade].name.replace(" on your website", "").toLowerCase();
  const when = why === "resting" ? "Sent while the estimator was resting for the month (your monthly cap)" : "The estimator couldn't price this address";
  return [`From the ${tool} on your website.`, `${when} — no price was shown. Price it and get back to them.`, note || ""].filter(Boolean).join(" ");
}

/** The homeowner's confirmation when no price was shown. */
export function homeownerUnpricedEmail(input: { shop: string; trade: WebTrade; address: string; phone?: string | null }): { subject: string; text: string } {
  const t = WEB_TRADE[input.trade];
  return {
    subject: `Your request — ${input.shop}`,
    text: [
      `Thanks for using the ${t.name.replace(" on your website", "").toLowerCase()} on ${input.shop}'s website.`,
      ``,
      `We couldn't show a price online this time. ${input.shop} has your request for ${input.address} and will price it and get back to you${input.phone ? ` at ${input.phone}` : ""}.`,
    ].join("\n"),
  };
}

/** What the homeowner's confirmation says. */
export function homeownerEmail(input: { shop: string; trade: WebTrade; band: { low: number; high: number }; show: "range" | "exact"; summary: string; choice: string; phone?: string | null; note?: string | null; house?: { url: string } | null }): { subject: string; text: string } {
  const price = input.show === "exact" ? money(input.band.low) : bandWords(input.band);
  const t = WEB_TRADE[input.trade];
  if (input.house) {
    // The house (2026-10-28): JobFlex priced it and sends it on — a local JobFlex pro calls, not JobFlex; the request page's link.
    const noun = { roof: "roof", hvac: "new system", fence: "fence", deck: "deck", smart: "project" }[input.trade];
    return {
      subject: `${t.title} — ${price} — ${HOUSE_NAME}`,
      text: [
        `Thanks for pricing your ${noun} on ${HOUSE_NAME}.`,
        ``,
        `${input.summary}${input.choice ? ` ${input.choice}.` : ""}`,
        `Estimated price: ${price}, before tax. ${input.note ?? t.basis}`,
        ``,
        `${HOUSE_NAME} is sending it to ${PRO}, who will be in touch to confirm the details${input.phone ? ` at ${input.phone}` : ""}. ${PRO_IS}`,
        `Follow your request: ${input.house.url}`,
      ].join("\n"),
    };
  }
  return {
    subject: `${t.title} — ${price} — ${input.shop}`,
    text: [
      `Thanks for using the ${t.name.replace(" on your website", "").toLowerCase()} on ${input.shop}'s website.`,
      ``,
      `${input.summary}${input.choice ? ` ${input.choice}.` : ""}`,
      `Estimated price: ${price}, before tax. ${input.note ?? t.basis}`,
      ``,
      `${input.shop} has your request and will be in touch to confirm the details${input.phone ? ` at ${input.phone}` : ""}.`,
    ].join("\n"),
  };
}
