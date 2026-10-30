// A cost-guide city's Census facts (cost guides phase 2, docs/seo-phase-2.md,
// 2026-10-26): the record scripts/seo-city-census.ts writes to
// ./city-census.data, the NAICS code each work's contractors are counted
// under, and the distance between two cities. Plain module, no I/O.

import type { SeoTradeSlug } from "./trades";

export type CityCensus = {
  /** The Census name of the matched place or county ("Dallas city", "Kings County"). */
  name: string;
  /** Median year structure built (B25035). */
  yearBuilt: number | null;
  /** Share of homes built before 1980 (B25034). The table's bins do not split at 1978. */
  pre1980: number | null;
  /** Shares of occupied homes by heating fuel (B25040). */
  heat: { gas: number | null; electric: number | null; oil: number | null; propane: number | null } | null;
  /** Share of homes that are single-family detached (B25024). */
  singleFamily: number | null;
  /** Median value of owner-occupied homes, dollars (B25077). */
  homeValue: number | null;
  /** Share of occupied homes that are owner-occupied (B25003). */
  owners: number | null;
  lat: number | null;
  lng: number | null;
  /** The county holding most of the place's homes ("King County"); null for a borough, which is a county itself. */
  county: string | null;
  /** County Business Patterns establishments in that county, by NAICS code. */
  contractors: Record<string, number>;
};

/** The County Business Patterns class each work's contractors are counted in. */
export const CENSUS_NAICS: Record<SeoTradeSlug, string> = {
  "roof-replacement": "238160",
  "siding-installation": "238170",
  "hvac-replacement": "238220",
  "house-painting": "238320",
  "fence-installation": "238990",
  "deck-building": "238990",
};

/** How the Census names the class, in a sentence ("roofing contractors"). */
export const CENSUS_NAICS_WORDS: Record<string, string> = {
  "238160": "roofing contractors",
  "238170": "siding contractors",
  "238220": "plumbing, heating and air-conditioning contractors",
  "238320": "painting and wall-covering contractors",
  "238990": "\"other specialty trade\" contractors",
};

/** Great-circle distance in miles. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

// ── The guide's Census paragraphs (2026-10-30) ──
// Each fact is put in a bucket by its value (old / mixed / new homes, gas /
// electric / mixed / oil-and-propane heat, mostly houses / mixed / mostly
// attached, a small / usual / big job next to home values, many / some / few
// contractors), and each bucket has its own framing, so two neighbouring
// cities read differently where their homes differ, not only in the numbers.
// Each paragraph also sets the city against its nearest neighbour in the
// guides (older or newer homes, more or less gas heat …), from the same data.
// Where a bucket has two phrasings, one is picked by a hash of the city's
// slug: stable from build to build, never random. A missing field drops its
// sentence. The paragraphs come in the order the work cares about (a roofer
// reads age first, an HVAC page fuel first).

export type CensusFact = { title: string; text: string };
type Near = { city: string; census: CityCensus };
/** The state's other guide cities with Census data, for "the 3rd-oldest of 12" sentences. */
type Peers = { stateName: string; list: CityCensus[] };
type Ctx = { slug: string; city: string; trade: SeoTradeSlug; lower: string; avg: number; usd: (n: number) => string; near: Near | null; peers: Peers | null };

/** FNV-1a: a stable pick of phrasing for a city. */
function pick<T>(seed: string, opts: T[]): T {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return opts[(h >>> 0) % opts.length];
}
const pct = (x: number) => `${Math.round(x * 100)}%`;
const aboutCount = (n: number) => (n < 20 ? n : n < 100 ? Math.round(n / 5) * 5 : Math.round(n / 10) * 10);
const aboutValue = (v: number) => (v < 500_000 ? Math.round(v / 5000) * 5000 : Math.round(v / 10_000) * 10_000);
const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Western Connecticut Planning Region" reads with "the". */
const countyWords = (c: string) => (/Planning Region$/.test(c) ? `the ${c}` : c);
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
/**
 * "Among the 25 Texas cities in these guides, Dallas has the 6th-oldest homes."
 * `value` reads a field (null drops the city from the count); `most` and
 * `least` are the superlatives for the two ends ("oldest homes", "newest
 * homes"), and a city in the lower half is counted from its own end. Fewer
 * than four cities with the field: nothing.
 */
function rankLine(c: CityCensus, x: Ctx, value: (k: CityCensus) => number | null, most: string, least: string): string | null {
  const own = value(c);
  if (own == null || !x.peers) return null;
  const vals = [own, ...x.peers.list.map(value).filter((v): v is number => v != null)];
  if (vals.length < 4) return null;
  const fromTop = 1 + vals.filter((v) => v > own).length;
  const fromBottom = 1 + vals.filter((v) => v < own).length;
  const [rank, word] = fromTop <= fromBottom ? [fromTop, most] : [fromBottom, least];
  const what = rank === 1 ? `the ${word}` : `the ${ordinal(rank)}-${word}`;
  return pick(x.slug + ":rank:" + most, [
    `Among the ${vals.length} ${x.peers.stateName} cities in these guides, ${x.city} has ${what}.`,
    `Of the ${vals.length} ${x.peers.stateName} cities these guides cover, ${x.city} has ${what}.`,
  ]);
}
const join = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(" ");

/** How the class reads as a heading ("roofing contractors"). */
const NAICS_TITLE: Record<string, string> = {
  "238160": "roofing contractors",
  "238170": "siding contractors",
  "238220": "HVAC and plumbing contractors",
  "238320": "painting contractors",
  "238990": "specialty-trade contractors",
};

// ── Age ──
export type AgeBucket = "old" | "mixed" | "new";
export function ageBucket(c: CityCensus): AgeBucket | null {
  if (c.yearBuilt == null && c.pre1980 == null) return null;
  if ((c.yearBuilt != null && c.yearBuilt < 1975) || (c.pre1980 != null && c.pre1980 > 0.55)) return "old";
  if ((c.yearBuilt != null && c.yearBuilt > 1995) || (c.pre1980 != null && c.pre1980 < 0.25)) return "new";
  return "mixed";
}
const AGE_TITLE: Record<AgeBucket, Array<(city: string) => string>> = {
  old: [(city) => `An older housing stock in ${city}`, (city) => `${city}'s homes have some age on them`],
  mixed: [(city) => `How old ${city}'s homes are`, (city) => `${city}'s homes by the year they were built`],
  new: [(city) => `Newer homes in ${city}`, (city) => `A young housing stock in ${city}`],
};
const AGE_WORDS: Record<SeoTradeSlug, Record<AgeBucket, string[]>> = {
  "roof-replacement": {
    old: [
      "Most of these houses are on their second or third roof, so a tear-off here often finds more than one layer of shingles and decking that has been nailed through several times. A careful quote prices each sheet of decking replaced, so the final bill isn't a surprise.",
      "A house that old has usually been re-roofed more than once, sometimes by laying new shingles over the old ones. Expect the crew to strip every layer down to the boards, and ask how much rotten or soft decking the quote allows for.",
    ],
    mixed: [
      "Many of these houses are coming up on a replacement now: an asphalt roof put on in the 1990s or 2000s is near the end of its life. With one layer to tear off, the job is usually simpler than on older stock.",
      "A good part of the city is due for its first or second new roof, as shingles laid twenty to thirty years ago wear out. Most of those jobs are a single tear-off, which keeps the labor line close to the book rate.",
    ],
    new: [
      "Much of the city was built recently enough that the first roof is still on, and some are still under the builder's or the shingle maker's warranty. Read that warranty before paying for a full replacement; a repair may be covered.",
      "Many roofs here are the original ones, put on when the house was built. If yours is under twenty years old, a storm repair or a warranty claim may cost far less than the full replacement priced on this page.",
    ],
  },
  "siding-installation": {
    old: [
      "Walls that old have usually been re-sided or covered over at least once, so removing two layers and repairing the sheathing under them is a real line in a quote here.",
      "On houses this old the original clapboard is often under a later layer of vinyl or aluminum; a contractor who opens one section first can price the sheathing repairs honestly.",
    ],
    mixed: [
      "Many of these homes still wear their first siding, now thirty years old or more; faded, cracked or brittle panels are the usual reason homeowners here ask for a quote.",
      "A lot of the city's siding went up in the 1980s and 1990s and is reaching the end of its life, which is when fading, warping and loose panels start to show.",
    ],
    new: [
      "Much of the city's siding is still the original, and on a newer house a repair or a matching section can be worth pricing before a whole-house job.",
      "Most siding here is young enough that a damaged wall can often be patched with matching panels; ask for that price next to the full replacement.",
    ],
  },
  "house-painting": {
    old: [
      "With that much of the city built before 1978, many painting jobs here fall under the EPA's lead-safe (RRP) rules: a certified renovator, plastic containment and a careful cleanup, all of which add time to the quote.",
      "Paint on a house built before 1978 may contain lead, and much of the city is that old. A painter who sands or scrapes it must be EPA lead-safe certified and contain the dust, so expect that work in the quote.",
    ],
    mixed: [
      "Some of these homes predate 1978, the EPA's cutoff for lead paint; on those, a painter who disturbs old paint must follow the lead-safe (RRP) rules, while on later houses the prep is mostly scraping, sanding and priming.",
      "Part of the city was built before 1978, when lead paint was still sold, so the right quote depends on your house's age: lead-safe work on older homes, ordinary prep on newer ones.",
    ],
    new: [
      "Few homes here predate 1978, so the EPA's lead-safe rules rarely come into it; prep on newer houses is mostly cleaning, caulking and spot-priming.",
      "Most houses here were built after lead paint left the market, so the prep is usually a wash, fresh caulk and spot-priming rather than lead-safe containment.",
    ],
  },
  "hvac-replacement": {
    old: [
      "Older houses often carry ductwork and wiring from an earlier system, so a replacement here can turn up duct repairs or an electrical panel upgrade that a newer house wouldn't need.",
      "In homes this old the ducts may have been added after the house was built, and the electrical panel may be small for a modern system; both are worth checking before the quote is final.",
    ],
    mixed: [
      "Many of these homes are on their second or third system, with ducts sized for the first one; the load calculation shows whether they still fit the new equipment.",
      "A typical house here has replaced its original equipment once already, and the ducts it still uses were sized decades ago, so ask the contractor to check them.",
    ],
    new: [
      "In newer houses the ducts and wiring were built for central air, so a like-for-like replacement is usually straightforward.",
      "Most homes here were built with central air from the start, so a replacement usually reuses the ducts, the pad and the wiring as they are.",
    ],
  },
  "fence-installation": {
    old: [
      "Older lots often have a fence already, so tearing out and hauling away the old one is a common line in a quote here.",
      "On lots this old a fence is often already standing, sometimes on a property line nobody has checked in years; a survey or a look at the plat before the new posts go in avoids a dispute.",
    ],
    mixed: [
      "Many lots here have had a fence for decades; removing it, or reusing its post line, changes the price.",
      "A good share of the city's fences went up when the houses did, decades ago, so many jobs here start with taking down the old one.",
    ],
    new: [
      "On newer lots there is often no fence to remove, though a homeowners' association may set the height, style and color.",
      "Newer subdivisions often come with association rules on fences, so check the approved styles before you ask for quotes.",
    ],
  },
  "deck-building": {
    old: [
      "On an older house the builder checks the rim joist and siding before bolting a ledger board to it, and an old deck may have to come down first.",
      "A house this old may not have a rim joist that can take a ledger, and a freestanding deck on its own posts is often the safer design.",
    ],
    mixed: [
      "Many houses here already have a first deck from the 1980s or 1990s, and replacing one starts with tearing it out and checking what it was fastened to.",
      "Decks built with the houses here are reaching thirty years, and many of the jobs are a tear-out and rebuild on the same spot.",
    ],
    new: [
      "Newer homes often came with a small builder's deck or a patio, and a homeowners' association may review the design before the permit.",
      "On a newer house the builder can usually bolt the ledger straight to a sound rim joist, which keeps the framing simple.",
    ],
  },
};
function ageNear(c: CityCensus, x: Ctx): string | null {
  const n = x.near;
  if (!n || c.yearBuilt == null || n.census.yearBuilt == null) return null;
  const d = c.yearBuilt - n.census.yearBuilt;
  if (Math.abs(d) <= 2) return `That's about the same as in ${n.city}, where the median home dates from ${n.census.yearBuilt}.`;
  return `That makes them ${d < 0 ? "older" : "newer"} than ${n.city}'s, where the median home dates from ${n.census.yearBuilt}.`;
}
function ageFact(c: CityCensus, x: Ctx): CensusFact | null {
  const b = ageBucket(c);
  if (!b) return null;
  const num =
    c.yearBuilt != null
      ? pick(x.slug + ":age", [
          `The median ${x.city} home was built in ${c.yearBuilt}${c.pre1980 != null ? `, and ${pct(c.pre1980)} of the city's homes date from before 1980` : ""}.`,
          `Half of ${x.city}'s homes went up before ${c.yearBuilt}${c.pre1980 != null ? `; ${pct(c.pre1980)} are older than 1980` : ""}.`,
        ])
      : `${pct(c.pre1980 as number)} of ${x.city}'s homes were built before 1980.`;
  const rank = rankLine(c, x, (k) => (k.yearBuilt == null ? null : -k.yearBuilt), "oldest homes", "newest homes");
  return { title: pick(x.slug + ":ageT", AGE_TITLE[b])(x.city), text: join(num, ageNear(c, x), rank, pick(x.slug + ":ageW", AGE_WORDS[x.trade][b])) };
}

// ── Heating fuel ──
export type FuelBucket = "gas" | "electric" | "mixed" | "oilPropane";
export function fuelBucket(c: CityCensus): FuelBucket | null {
  const h = c.heat;
  if (!h || h.gas == null || h.electric == null) return null;
  if ((h.oil ?? 0) + (h.propane ?? 0) > 0.1) return "oilPropane";
  if (h.gas > 0.6) return "gas";
  if (h.electric > 0.6) return "electric";
  return "mixed";
}
const FUEL: Record<FuelBucket, { title: Array<(city: string) => string>; words: string[] }> = {
  gas: {
    title: [(city) => `Gas heat in ${city}`, (city) => `${city} heats mostly with gas`],
    words: [
      "With gas in most homes, the usual job here is a new gas furnace with a matching air conditioner. Some owners replacing both add a heat pump and keep the furnace as backup, a dual-fuel system that burns gas only on the coldest days.",
      "Where the gas line is already in, a high-efficiency furnace paired with a new air conditioner is the common replacement, and the quote on this page is priced that way. A heat pump in place of the air conditioner is the upgrade to ask about.",
    ],
  },
  electric: {
    title: [(city) => `Electric heat in ${city}`, (city) => `${city} heats mostly with electricity`],
    words: [
      "With most homes on electric heat, a heat pump is the usual system here: one outdoor unit heats and cools, and it uses far less power for heating than an electric furnace or baseboard.",
      "In an all-electric house the heat pump is the natural replacement, because it moves heat instead of making it and cuts the heating part of the power bill; the air handler inside keeps backup heat strips for cold snaps.",
    ],
  },
  mixed: {
    title: [(city) => `How ${city} heats its homes`, (city) => `Gas and electric heat in ${city}`],
    words: [
      "With gas and electricity close to even, both jobs are common here: a gas furnace and air conditioner where a gas line runs to the house, a heat pump where it doesn't. A quote should say which one it is pricing.",
      "Neither fuel dominates, so the right system depends on the house: keep gas if the line and flue are there, or price a heat pump if the furnace is electric already.",
    ],
  },
  oilPropane: {
    title: [(city) => `Oil and propane heat in ${city}`, (city) => `Delivered fuel in ${city}'s homes`],
    words: [
      "Where a house burns oil or propane, a heat pump is often the change worth pricing: it cuts the fuel deliveries, and a cold-climate model can carry the heating alone or with the old furnace or boiler as backup.",
      "Homes on delivered oil or propane pay for every tank, which is why a cold-climate heat pump, with the old system kept for the coldest nights, is the replacement many of them price first.",
    ],
  },
};
function fuelFact(c: CityCensus, x: Ctx): CensusFact | null {
  const b = fuelBucket(c);
  const h = c.heat;
  if (!b || !h || h.gas == null || h.electric == null) return null;
  const extra = [h.oil != null && h.oil >= 0.05 ? `${pct(h.oil)} with fuel oil` : null, h.propane != null && h.propane >= 0.05 ? `${pct(h.propane)} with propane` : null].filter(Boolean).join(" and ");
  const num = pick(x.slug + ":fuel", [
    `${pct(h.gas)} of ${x.city}'s occupied homes heat with utility gas and ${pct(h.electric)} with electricity${extra ? `; ${extra}` : ""}.`,
    `In ${x.city}, ${pct(h.electric)} of occupied homes heat with electricity and ${pct(h.gas)} with utility gas${extra ? `, ${extra}` : ""}.`,
  ]);
  const n = x.near?.census.heat?.gas;
  const near =
    x.near && n != null
      ? Math.abs(h.gas - n) < 0.03
        ? `Gas heat is about as common in ${x.near.city} (${pct(n)}).`
        : `Gas heat is ${h.gas > n ? "more" : "less"} common here than in ${x.near.city}, where ${pct(n)} of homes use it.`
      : null;
  const rank = rankLine(c, x, (k) => k.heat?.gas ?? null, "largest share of homes on gas heat", "smallest share of homes on gas heat");
  return { title: pick(x.slug + ":fuelT", FUEL[b].title)(x.city), text: join(num, near, rank, pick(x.slug + ":fuelW", FUEL[b].words)) };
}

// ── Single-family share ──
export type HouseBucket = "high" | "mid" | "low";
export function houseBucket(c: CityCensus): HouseBucket | null {
  if (c.singleFamily == null) return null;
  return c.singleFamily > 0.75 ? "high" : c.singleFamily < 0.5 ? "low" : "mid";
}
const HOUSE_TITLE: Record<HouseBucket, Array<(city: string) => string>> = {
  high: [(city) => `Mostly houses in ${city}`, (city) => `${city} is a city of detached houses`],
  mid: [(city) => `Houses and attached homes in ${city}`, (city) => `${city}'s mix of houses and apartments`],
  low: [(city) => `More attached homes in ${city}`, (city) => `Apartments and townhouses in ${city}`],
};
type Group = "roof" | "walls" | "yard" | "hvac";
const GROUP: Record<SeoTradeSlug, Group> = {
  "roof-replacement": "roof",
  "siding-installation": "walls",
  "house-painting": "walls",
  "hvac-replacement": "hvac",
  "fence-installation": "yard",
  "deck-building": "yard",
};
const HOUSE_WORDS: Record<HouseBucket, Record<Group, string[]>> = {
  high: {
    roof: ["Most roofs here belong to the family living under them, so the homeowner picks the material and the contractor.", "With so many detached houses, most roof jobs here are a homeowner's own decision, with no association vote to wait for."],
    walls: ["Most homes here have outside walls of their own, so the owner picks the material, the color and the contractor.", "Detached houses dominate, so the exterior is usually the owner's to change without asking a board."],
    yard: ["Most homes here have a yard of their own to fence or build a deck on.", "With so many detached houses, most homes here come with a back yard, and the work is the owner's to plan."],
    hvac: ["Most homes here have a system of their own, rather than one shared across an apartment building.", "Nearly every household here runs its own furnace or heat pump, which is the job priced on this page."],
  },
  mid: {
    roof: ["The rest are townhouses, duplexes and apartments, where a shared roof or an association can decide who hires the roofer.", "On the attached homes that make up the rest, the roof is often shared and replaced by the association, not the owner."],
    walls: ["The rest are townhouses, duplexes and apartments, where an association often sets the exterior colors and materials.", "Among the attached homes that make up the rest, exterior work usually needs the association's approval."],
    yard: ["The rest are townhouses and apartments, where a shared yard or an association's rules decide what can be built.", "The attached homes that make up the rest seldom have a yard of their own to build on."],
    hvac: ["The rest are townhouses and apartments, where the unit is often smaller and the building's rules can decide where the outdoor equipment goes.", "In the attached homes that make up the rest, systems tend to be smaller and the outdoor unit's spot is set by the building."],
  },
  low: {
    roof: ["Most homes here share walls or roofs, and on a townhouse or condo the association often decides on, and pays for, the roof. The prices on this page are for a detached house.", "Detached houses are the minority here; most roofs cover more than one household and are an association's job. This page prices a detached house's roof."],
    walls: ["Most homes here share walls, and on a condo or townhouse the exterior usually belongs to the association; the prices on this page are for a detached house.", "Detached houses are the minority here, and the outside of an attached home is usually the association's to paint or re-side; this page prices a detached house."],
    yard: ["With fewer private yards, fence and deck work here is concentrated in the detached-house neighborhoods, and on a townhouse an association usually approves the design first.", "Detached houses are the minority here, so most fence and deck jobs come from the neighborhoods of single-family homes."],
    hvac: ["In apartments and condos the system is often smaller or shared, and replacing it can need the building's approval.", "With most homes attached, many systems here are compact split units or shared equipment rather than the whole-house system priced on this page."],
  },
};
function houseFact(c: CityCensus, x: Ctx): CensusFact | null {
  const b = houseBucket(c);
  if (!b) return null;
  const sf = c.singleFamily as number;
  const num = pick(x.slug + ":house", [
    `${pct(sf)} of ${x.city}'s homes are single-family detached houses${c.owners != null ? `, and ${pct(c.owners)} of all homes are lived in by their owners` : ""}.`,
    `Single-family detached houses make up ${pct(sf)} of ${x.city}'s homes${c.owners != null ? `; owners live in ${pct(c.owners)} of them all` : ""}.`,
  ]);
  const n = x.near?.census.singleFamily;
  const near =
    x.near && n != null
      ? Math.abs(sf - n) < 0.03
        ? `${x.near.city} has about the same share (${pct(n)}).`
        : `That's ${sf > n ? "more" : "fewer"} detached houses than in ${x.near.city}, at ${pct(n)}.`
      : null;
  const rank = rankLine(c, x, (k) => k.singleFamily, "largest share of detached houses", "smallest share of detached houses");
  return { title: pick(x.slug + ":houseT", HOUSE_TITLE[b])(x.city), text: join(num, near, rank, pick(x.slug + ":houseW", HOUSE_WORDS[b][GROUP[x.trade]])) };
}

// ── The job next to home values ──
export type ValueBucket = "small" | "usual" | "big";
function valueFact(c: CityCensus, x: Ctx): CensusFact | null {
  if (c.homeValue == null || c.homeValue <= 0) return null;
  const p = (x.avg / c.homeValue) * 100;
  const b: ValueBucket = p < 2 ? "small" : p > 6 ? "big" : "usual";
  const ps = p < 0.95 ? p.toFixed(1) : String(Math.round(p));
  const v = x.usd(aboutValue(c.homeValue));
  const avg = x.usd(x.avg);
  const num = pick(x.slug + ":value", [
    `The median owner-occupied home in ${x.city} is valued at about ${v}, so the typical ${x.lower} here, at ${avg}, is about ${ps}% of that.`,
    `Against a median home value of about ${v} in ${x.city}, the typical ${x.lower} at ${avg} comes to roughly ${ps}% of what a house is worth.`,
  ]);
  const n = x.near?.census.homeValue;
  const near =
    x.near && n != null && n > 0
      ? Math.abs(c.homeValue / n - 1) < 0.05
        ? `Homes in ${x.near.city} are valued about the same.`
        : `Homes in ${x.near.city} are valued ${c.homeValue > n ? "lower" : "higher"}, at about ${x.usd(aboutValue(n))}.`
      : null;
  const words: Record<ValueBucket, { title: string[]; text: string[] }> = {
    small: {
      title: [`A small share of a ${x.city} home's value`, `${capFirst(x.lower)} next to ${x.city} home prices`],
      text: [
        "In a market priced like this one the job is a small line next to the house it protects, so the quality of the work and the warranty matter more than shaving a few hundred dollars off the bid.",
        "Where houses are worth this much, the cheapest bid is rarely the saving it looks like; a well-documented job with a transferable warranty is what a buyer will ask about.",
      ],
    },
    usual: {
      title: [`What the job is worth next to a ${x.city} home`, `${capFirst(x.lower)} and ${x.city} home values`],
      text: [
        "A job that size is usually planned and budgeted rather than paid on the spot: get two or three written quotes and compare what each one includes.",
        "That's a planned expense for most households here, so it's worth getting written quotes that list the same scope, and asking each contractor about payment terms.",
      ],
    },
    big: {
      title: [`A big-ticket job for a ${x.city} home`, `${capFirst(x.lower)} weighs heavily against ${x.city} home values`],
      text: [
        "That is a large share of what a home here is worth, so compare financing as well as price, and ask which parts of the job could wait.",
        "With home values this modest, the job is a major outlay; ask for the work in phases where it can be split, and compare loan terms as carefully as the bids.",
      ],
    },
  };
  const rank = rankLine(c, x, (k) => k.homeValue, "highest home values", "lowest home values");
  return { title: pick(x.slug + ":valueT", words[b].title), text: join(num, near, rank, pick(x.slug + ":valueW", words[b].text)) };
}

// ── Contractors in the county ──
function contractorFact(c: CityCensus, x: Ctx, naics: string, cbpYear: number): CensusFact | null {
  // A borough is a county itself; its Census name is the county's.
  const county = c.county ?? (/ County$/.test(c.name) ? c.name : null);
  if (!county) return null;
  const where = c.county ? `${x.city} is in ${countyWords(county)}` : `In Census terms ${x.city} is ${county}`;
  const n = c.contractors[naics];
  if (n == null || n <= 0) return { title: `${capFirst(x.lower)} in ${county}`, text: `${where}.` };
  const words = CENSUS_NAICS_WORDS[naics];
  const num = pick(x.slug + ":pros", [
    `${where}, where the Census Bureau counted about ${aboutCount(n)} ${words} with a payroll in ${cbpYear} (County Business Patterns).`,
    `The Census Bureau's County Business Patterns for ${cbpYear} counts about ${aboutCount(n)} ${words} with a payroll in ${county}, the county ${x.city} sits in.`,
  ]);
  const nc = x.near?.census;
  const nn = nc?.contractors[naics];
  const near = x.near && nc?.county && nc.county !== c.county && nn != null && nn > 0 ? `Next door, ${countyWords(nc.county)} around ${x.near.city} has about ${aboutCount(nn)}.` : null;
  const note = naics === "238990" ? `That class holds ${x.trade === "deck-building" ? "deck" : "fence"} builders along with other specialty trades, so only some of them do this work.` : null;
  const title = NAICS_TITLE[naics];
  const framing =
    n > 100
      ? {
          title: pick(x.slug + ":prosT", [`Plenty of ${title} in ${county}`, `A crowded field of ${title} in ${county}`]),
          text: pick(x.slug + ":prosW", [
            "With that many firms, homeowners can usually line up several quotes within a week or two, and prices for the same job can differ by a good margin, so compare what each quote includes line by line.",
            "Competition that close keeps bids sharp, but it also means a wide spread of quality; check each firm's license, insurance and recent reviews before signing.",
          ]),
        }
      : n < 20
        ? {
            title: pick(x.slug + ":prosT", [`Few ${title} in ${county}`, `A short list of ${title} in ${county}`]),
            text: pick(x.slug + ":prosW", [
              "With so few firms nearby, schedules fill up early: ask for quotes well before you need the work, and expect some contractors to come in from neighboring counties.",
              "A small local field means longer waits in the busy season and fewer bids to compare; a contractor travelling in from the next county may add a trip charge.",
            ]),
          }
        : {
            title: pick(x.slug + ":prosT", [`${capFirst(title)} in ${county}`, `How many ${title} work in ${county}`]),
            text: pick(x.slug + ":prosW", [
              "That is enough to compare two or three quotes, though the busiest firms can book out several weeks in the main season.",
              "A field that size gives you a real choice, but the well-reviewed firms fill their calendars first, so book early for spring and summer work.",
            ]),
          };
  return { title: framing.title, text: join(num, near, note, framing.text) };
}

type Part = "age" | "fuel" | "house" | "value" | "pros";
const ORDER: Record<SeoTradeSlug, Part[]> = {
  "roof-replacement": ["age", "house", "value", "pros"],
  "siding-installation": ["age", "value", "house", "pros"],
  "house-painting": ["age", "value", "house", "pros"],
  "hvac-replacement": ["fuel", "age", "value", "house", "pros"],
  "fence-installation": ["house", "value", "age", "pros"],
  "deck-building": ["house", "age", "value", "pros"],
};

/** The city's Census paragraphs for one work, in the order that work cares about. `near` is its nearest guide city with Census data; `peers`, the state's other guide cities. */
export function censusParagraphs(
  c: CityCensus,
  x: { slug: string; city: string; trade: SeoTradeSlug; lower: string; avg: number; usd: (n: number) => string; cbpYear: number; near: Near | null; peers: Peers | null },
): CensusFact[] {
  const make: Record<Part, () => CensusFact | null> = {
    age: () => ageFact(c, x),
    fuel: () => fuelFact(c, x),
    house: () => houseFact(c, x),
    value: () => valueFact(c, x),
    pros: () => contractorFact(c, x, CENSUS_NAICS[x.trade], x.cbpYear),
  };
  return ORDER[x.trade].map((p) => make[p]()).filter((f): f is CensusFact => f != null);
}
