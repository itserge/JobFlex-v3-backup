// A cost guide's words and numbers (2026-10-26): everything /cost/<work>/<city>
// prints, built from the priced model (./pricing), the city's indices
// (./cities) and the state's facts (./local). The page component only lays it
// out. Every sentence that names a number or a local fact is computed from
// data; a fact that is missing leaves its sentence or block out. Server-side.

import { SEO_TRADES, type SeoTrade } from "./trades";
import { SEO_PHRASES } from "./keywords";
import { nearbyCities, citiesInState, rankIn, SEO_CITIES, type SeoCity } from "./cities";
import { censusParagraphs } from "./census";
import { CENSUS_ACS_YEARS, CENSUS_CBP_YEAR } from "./city-census.data";
import { quote, costModel, bookSources, calibration } from "./pricing";
import { stateFacts, permitFor, LUMBER_WORDS } from "./local";
import { usd, unitUsd, roundMoney, type CalcModel } from "./calc";
import { TRADES } from "@/lib/estimate/trade-knowledge";

import { SEO_YEAR } from "./updated";

export { SEO_BUILT, SEO_YEAR, SEO_UPDATED } from "./updated";

export type CostRow = { key: string; label: string; detail?: string; lo: string; hi: string; avg: string; per: string; href?: string };
export type CostFact = { title: string; text: string };
export type CostFaq = { q: string; a: string };
export type CostLink = { href: string; label: string; note?: string };

export type CostPage = {
  trade: SeoTrade;
  city: SeoCity;
  path: string;
  h1: string;
  title: string;
  description: string;
  lede: string[];
  answer: { avg: string; range: string; per: string; alt?: string; basis: string; split: string; avgNum: number; loNum: number; hiNum: number };
  calc: { model: CalcModel; typical: number; variantId: string };
  materials: { heading: string; intro: string; rows: CostRow[]; outro: string };
  sizes: { heading: string; intro: string; rows: CostRow[]; outro: string };
  included: { heading: string; intro: string; rows: CostRow[]; outro: string };
  factors: { heading: string; items: CostFact[] };
  questions: { heading: string; items: string[] };
  compare: { heading: string; intro: string; rows: CostRow[] } | null;
  faq: CostFaq[];
  otherWorks: CostLink[];
  sameState: CostLink[];
  method: string[];
  sources: string[];
  /** For the JSON-LD offer. */
  low: number;
  high: number;
};

const fmtSize = (t: SeoTrade, n: number) => n.toLocaleString("en-US");
const pctOff = (x: number) => Math.round(Math.abs(x - 1) * 100);
/** 0.92 → "8% below", 1.25 → "25% above", 1.00 → "right at". */
function vsAverage(x: number, what = "the U.S. average"): string {
  const p = pctOff(x);
  if (p === 0) return `right at ${what}`;
  return `${p}% ${x > 1 ? "above" : "below"} ${what}`;
}
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
const pct = (part: number, whole: number) => Math.round((part / (whole || 1)) * 100);
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pctRate = (r: number) => `${(Math.round(r * 100000) / 1000).toString()}%`;

export const costPath = (trade: SeoTrade, city: SeoCity) => `/cost/${trade.slug}/${city.slug}`;

/** The price of the work's typical job in a city, for the comparison tables and links. */
export function typicalAvg(trade: SeoTrade, city: SeoCity | null): number {
  return quote(trade, city, trade.size.typical).avg;
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:—–-]+$/, "") + "…";
}

export function costTitle(trade: SeoTrade, city: SeoCity): string {
  const full = `${trade.name} Cost in ${city.place} (${SEO_YEAR}) | JobFlex`;
  if (full.length <= 60) return full;
  const bare = `${trade.name} Cost in ${city.place} (${SEO_YEAR})`;
  return bare.length <= 60 ? bare : `${trade.name} Cost in ${city.place}`;
}

export function costPage(trade: SeoTrade, city: SeoCity): CostPage {
  const ph = SEO_PHRASES[trade.slug];
  const facts = stateFacts(city.state);
  const typical = trade.size.typical;
  const variant = trade.variants.find((v) => v.id === trade.defaultVariant) ?? trade.variants[0];
  const q = quote(trade, city, typical);
  const nat = quote(trade, null, typical);
  const sizeWords = trade.size.phrase(fmtSize(trade, typical));
  const per = (n: number, size: number) => `${unitUsd(n / size)} ${trade.size.per}`;
  const path = costPath(trade, city);
  const ix = city.indices;

  const h1 = `${trade.name} Cost in ${city.place} (${SEO_YEAR})`;
  const description = clip(
    `${cap(trade.job)} in ${city.place} averages ${usd(q.avg)} (${usd(q.lo)}–${usd(q.hi)}) for ${sizeWords}, ${per(q.avg, typical)}. Costs by ${ph.materialNoun} and size, plus free local quotes.`,
    155,
  );

  // ── Lede ──
  const matWords = (m: number) => (pctOff(m) === 0 ? "materials sit at the national level" : `materials ${pctOff(m)}% ${m > 1 ? "above" : "below"}`);
  const labor = ix?.labor != null && ix.material != null ? `: construction labor in the ${city.city} area runs ${vsAverage(ix.labor, "the national mean")}, ${matWords(ix.material)}` : "";
  const lede = [
    `${ph.ask} in ${city.city}? For ${sizeWords} with ${lc(variant.label)}, homeowners in ${city.place} pay about ${usd(q.avg)} on average, and most quotes land between ${usd(q.lo)} and ${usd(q.hi)} — ${unitUsd(q.lo / typical)} to ${unitUsd(q.hi / typical)} ${trade.size.per}. The price covers ${trade.covers}.`,
    `The ${ph.price} in ${city.city} runs ${vsAverage(city.factor)}${labor}. The same job averages ${usd(nat.avg)} nationally${city.stateFactor ? ` and about ${usd(typicalAvgAt(trade, city.stateFactor))} at the ${city.stateName} statewide index` : ""}.`,
  ];

  // ── Answer card ──
  const answer = {
    avg: usd(q.avg),
    range: `${usd(q.lo)} – ${usd(q.hi)}`,
    per: `${unitUsd(q.lo / typical)} – ${unitUsd(q.hi / typical)} ${trade.size.per}`,
    ...(trade.altUnit ? { alt: `${unitUsd((q.avg / typical) * trade.altUnit.factor)} ${trade.altUnit.per}` } : {}),
    basis: `${cap(sizeWords)}, ${lc(variant.label)}`,
    split: `${pct(q.labor, q.avg)}% labor · ${pct(q.material, q.avg)}% materials${q.fees > 0 ? ` · ${usd(q.fees)} permit` : ""}`,
    avgNum: roundMoney(q.avg),
    loNum: roundMoney(q.lo),
    hiNum: roundMoney(q.hi),
  };

  // ── By material ──
  const matQuotes = trade.variants.map((v) => ({ v, r: quote(trade, city, typical, v.id) }));
  const sorted = [...matQuotes].sort((a, b) => a.r.avg - b.r.avg);
  const cheap = sorted[0];
  const dear = sorted[sorted.length - 1];
  const materials = {
    heading: `${cap(trade.lower)} price in ${city.city} by ${ph.materialNoun}`,
    intro: `What ${sizeWords} costs in ${city.city} with each ${ph.materialNoun}, installed:`,
    rows: matQuotes.map(({ v, r }) => ({ key: v.id, label: v.label, detail: v.detail, lo: usd(r.lo), hi: usd(r.hi), avg: usd(r.avg), per: per(r.avg, typical) })),
    outro:
      cheap.v.id === dear.v.id
        ? ""
        : `The least expensive option in ${city.city} is ${lc(cheap.v.label)}, at about ${usd(cheap.r.avg)}; ${lc(dear.v.label)} averages ${usd(dear.r.avg)}, ${(dear.r.avg / cheap.r.avg).toFixed(1)} times as much.`,
  };

  // ── By size ──
  const sizeQuotes = trade.size.sizes.map((s) => ({ s, r: quote(trade, city, s) }));
  const first = sizeQuotes[0];
  const last = sizeQuotes[sizeQuotes.length - 1];
  const fixedLabels = trade.lines.filter((l) => l.scale === "fixed").slice(0, 3).map((l) => lc(l.label));
  const sizes = {
    heading: `${cap(ph.costTo)} in ${city.city} by size`,
    intro: `With ${lc(variant.label)}, priced for ${city.place}:`,
    rows: sizeQuotes.map(({ s, r }) => ({ key: String(s), label: cap(trade.size.phrase(fmtSize(trade, s))), lo: usd(r.lo), hi: usd(r.hi), avg: usd(r.avg), per: per(r.avg, s) })),
    outro:
      first.r.avg / first.s > last.r.avg / last.s
        ? `Some costs stay the same whatever the size — ${fixedLabels.join(", ")} — so a bigger job costs less per unit: ${unitUsd(last.r.avg / last.s)} ${trade.size.per} for ${trade.size.phrase(fmtSize(trade, last.s))} against ${unitUsd(first.r.avg / first.s)} for ${trade.size.phrase(fmtSize(trade, first.s))}.`
        : "",
  };

  // ── Line by line ──
  const included = {
    heading: `What ${/^(hvac|[aeiou])/i.test(trade.lower) ? "an" : "a"} ${trade.lower} in ${city.city} includes`,
    intro: `Line by line, the ${usd(q.avg)} average for ${sizeWords} breaks down like this: ${pct(q.labor, q.avg)}% labor, ${pct(q.material, q.avg)}% materials and equipment${q.fees > 0 ? `, and ${usd(q.fees)} in permit fees passed through at cost` : ""}.`,
    rows: q.lines.map((l, i) => ({ key: String(i), label: l.label, lo: usd(l.lo), hi: usd(l.hi), avg: usd((l.lo + l.hi) / 2), per: "" })),
    outro: (() => {
      const k = calibration(trade, variant.id)?.k ?? 1;
      return k < 1
        ? `Each line is the price book's U.S. rate for that step, scaled by ${k.toFixed(2)} to the installed price published sources give for the whole job (see how these prices are built), times ${city.city}'s index of ${city.factor.toFixed(2)}; permit fees are not scaled.`
        : `Each line is the price book's U.S. rate for that step times ${city.city}'s index of ${city.factor.toFixed(2)}; permit fees are not scaled.`;
    })(),
  };

  // ── What moves the price ──
  const items: CostFact[] = [];
  if (ix?.labor != null && ix.material != null) {
    const metro = ix.laborMetro != null && ix.county != null && Math.abs(ix.county - 1) >= 0.005;
    items.push({
      title: `Labor and materials in ${city.city}`,
      text: metro
        ? `Construction wages in the ${city.city} metro run ${vsAverage(ix.laborMetro as number, "the U.S. mean")} (BLS, May 2025), and specialty-contractor pay in the city's county moves that ${(ix.county as number) > 1 ? "up" : "down"} by ${pctOff(ix.county as number)}%, to ${vsAverage(ix.labor, "the national mean")}. Materials in the area's ZIP codes price ${vsAverage(ix.material, "the national average")}. Together they give ${city.city} a construction cost index of ${city.factor.toFixed(2)}.`
        : `Construction wages in the ${city.city} area run ${vsAverage(ix.labor, "the U.S. mean")} (BLS, May 2025), and materials in its ZIP codes price ${vsAverage(ix.material, "the national average")}. Together they give ${city.city} a construction cost index of ${city.factor.toFixed(2)}.`,
    });
  }
  const inState = citiesInState(city.state);
  if (inState.length > 1) {
    const { rank, of } = rankIn(inState, city);
    const top = [...inState].sort((a, b) => b.factor - a.factor)[0];
    const low = [...inState].sort((a, b) => a.factor - b.factor)[0];
    const ties = inState.filter((c) => Math.abs(c.factor - city.factor) < 1e-9).length > 1;
    const where = rank === 1 ? (ties ? "ties for the most expensive" : "is the most expensive") : `is the ${ordinal(rank)} most expensive`;
    const ends = [
      top.slug === city.slug || Math.abs(top.factor - city.factor) < 1e-9 ? null : `${top.city} is the dearest at ${top.factor.toFixed(2)}`,
      Math.abs(low.factor - city.factor) < 1e-9 ? `no ${city.stateName} city in it costs less` : `${low.city} is the least expensive at ${low.factor.toFixed(2)}`,
    ].filter(Boolean);
    items.push({
      title: `Where ${city.city} sits in ${city.stateName}`,
      text: `${city.city} ${where} of the ${of} ${city.stateName} cities in our index${city.stateFactor ? `, against a statewide index of ${city.stateFactor.toFixed(2)}` : ""}. ${cap(ends.join("; "))}.`,
    });
  }
  const nationally = rankIn(SEO_CITIES, city);
  items.push({
    title: "Against the rest of the country",
    text: `Of the ${nationally.of} U.S. cities in JobFlex's index, ${city.city} ranks ${ordinal(nationally.rank)} from the most expensive. The job that averages ${usd(q.avg)} here averages ${usd(nat.avg)} at the national rate.`,
  });
  items.push(...tradeFacts(trade, city));
  items.push(...censusFacts(trade, city, q.avg));
  if (facts.salesTax != null) {
    items.push({
      title: `Sales tax in ${city.stateName}`,
      text:
        facts.salesTax === 0
          ? `${cap(city.stateName)} has no state sales tax${facts.laborTaxed ? ", though installation labor can still be taxed locally" : ""}. Prices on this page are before any tax.`
          : `${cap(city.stateName)}'s base state sales tax is ${pctRate(facts.salesTax)}${city.state === "DC" ? "" : ", and cities and counties can add their own"}. ${facts.laborTaxed ? `${cap(city.stateName)} also taxes installation labor on real property, so ask whether a quote includes tax on the whole job.` : "How it applies to a home-improvement contract varies, so ask whether a quote includes it."} Prices on this page are before tax.`,
    });
  }

  // ── Questions a contractor asks ──
  const profile = TRADES.find((t) => t.id === trade.tradeId);
  const questions = { heading: `What a ${city.city} contractor will ask before quoting`, items: profile?.keyQuestions ?? [] };

  // ── Nearby cities ──
  const others = nearbyCities(city);
  const compare = others.length
    ? {
        heading: `${cap(trade.lower)} cost in cities near ${city.city}`,
        intro: `${cap(sizeWords)} with ${lc(variant.label)} averages ${usd(q.avg)} in ${city.city}; ${others
          .slice(0, 3)
          .map((o) => `${usd(typicalAvg(trade, o))} in ${o.city}`)
          .join(", ")}.`,
        rows: others.map((o) => {
          const r = quote(trade, o, typical);
          const d = Math.round(((o.factor - city.factor) / city.factor) * 100);
          return { key: o.slug, label: o.place, href: costPath(trade, o), lo: usd(r.lo), hi: usd(r.hi), avg: usd(r.avg), per: d === 0 ? "same as " + city.city : `${Math.abs(d)}% ${d > 0 ? "more" : "less"}` };
        }),
      }
    : null;

  // ── FAQ ──
  const faq = buildFaq(trade, city, q, nat);

  const otherWorks = SEO_TRADES.filter((t) => t.slug !== trade.slug).map((t) => ({ href: costPath(t, city), label: `${cap(t.lower)} cost in ${city.city}`, note: `about ${usd(typicalAvg(t, city))}` }));
  const sameState = others.map((o) => ({ href: costPath(trade, o), label: `${cap(trade.lower)} cost in ${o.place}` }));

  const checks = [ix?.rsmeans != null ? `RSMeans residential ${ix.rsmeans.toFixed(2)}` : null, ix?.hud != null ? `HUD ${ix.hud.toFixed(2)}` : null, ix?.craftsman != null ? `Craftsman ${ix.craftsman.toFixed(2)}` : null].filter(Boolean);
  const method = [
    `Every price on this page comes from JobFlex's contractor price book: what a homeowner pays a licensed contractor for each step of the job, as a U.S. national average per unit, with the contractor's overhead and profit included and sales tax left out. The ${trade.lower} is priced step by step, then multiplied by ${city.city}'s construction cost index of ${city.factor.toFixed(2)}.`,
    ...calibrationNote(trade),
    ...(city.census ? [`Facts about ${city.city}'s homes come from the Census Bureau's American Community Survey (${CENSUS_ACS_YEARS} 5-year estimates); contractor counts from its County Business Patterns (${CENSUS_CBP_YEAR}).`] : []),
    `The index weighs local construction wages (BLS Occupational Employment and Wage Statistics, May 2025) at 60% and the area's material prices (Craftsman ZIP-area factors) at 40%.${checks.length ? ` Published indices for ${city.city}, each on its own base: ${checks.join(", ")}.` : ""} Treat any city figure as about ±5%; a contractor's quote for your house is the number to plan with.`,
  ];

  return {
    trade,
    city,
    path,
    h1,
    title: costTitle(trade, city),
    description,
    lede,
    answer,
    calc: { model: costModel(trade, city.factor), typical, variantId: variant.id },
    materials,
    sizes,
    included,
    factors: { heading: `What affects ${trade.lower} prices in ${city.city}`, items },
    questions,
    compare,
    faq,
    otherWorks,
    sameState,
    method,
    sources: bookSources(trade),
    low: roundMoney(q.lo),
    high: roundMoney(q.hi),
  };
}

/** The method's sentence on the options scaled to a cited source (lib/seo/pricing calibration), or nothing. */
function calibrationNote(trade: SeoTrade): string[] {
  const items = trade.variants.flatMap((v) => {
    const c = calibration(trade, v.id);
    if (!c || c.k >= 1) return [];
    if (c.from !== v.id) {
      const ref = trade.variants.find((x) => x.id === c.from);
      return [`${lc(v.label)} × ${c.k.toFixed(2)}, following ${lc(ref?.label ?? "the default option")}`];
    }
    const range = c.per === "unit" ? `${unitUsd(c.cited[0])}–${unitUsd(c.cited[1])} ${trade.size.per}` : `${usd(c.cited[0])}–${usd(c.cited[1])}`;
    const names = c.sources.map((src) => src.split(":")[0]).join(" plus ");
    return [`${lc(v.label)} × ${c.k.toFixed(2)} (${names}: ${range})`];
  });
  if (!items.length) return [];
  return [
    `Where the price book's steps for an option add up to more than 20% over the installed price a published source gives for the whole job, every step but a permit fee is scaled down to the middle of that range: ${items.join("; ")}.`,
  ];
}

/** The city's Census paragraphs for this work (./census censusParagraphs): bucketed wording, set against the nearest city, in the work's own order. */
function censusFacts(trade: SeoTrade, city: SeoCity, avg: number): CostFact[] {
  if (!city.census) return [];
  const n = nearbyCities(city, 1)[0];
  const near = n?.census ? { city: n.city, census: n.census } : null;
  const list = citiesInState(city.state).flatMap((o) => (o.slug !== city.slug && o.census ? [o.census] : []));
  const peers = { stateName: city.stateName, list };
  return censusParagraphs(city.census, { slug: city.slug, city: city.city, trade: trade.slug, lower: trade.lower, avg, usd, cbpYear: CENSUS_CBP_YEAR, near, peers });
}

function typicalAvgAt(trade: SeoTrade, factor: number): number {
  return quote(trade, { factor }, trade.size.typical).avg;
}

/** The facts a state gives this work: frost, code, wood, climate. */
function tradeFacts(trade: SeoTrade, city: SeoCity): CostFact[] {
  const f = stateFacts(city.state);
  const out: CostFact[] = [];
  if ((trade.slug === "fence-installation" || trade.slug === "deck-building") && f.frostIn != null && !(trade.slug === "deck-building" && f.deckCode?.notes.some((n) => /frost/i.test(n)))) {
    const what = trade.slug === "fence-installation" ? "Fence posts" : "Deck footings";
    out.push({
      title: `Frost depth in ${city.stateName}`,
      text:
        f.frostIn > 0
          ? `${what} go below the frost line, or they heave by the second spring. The typical code frost depth in ${city.stateName} is about ${f.frostIn} in.${f.frostIn >= 36 ? " — deep holes, more concrete and more digging time than in the South." : "."} Your building department sets the exact figure.`
          : `${cap(city.stateName)} has little or no frost depth to dig below, so ${lc(what)} go to the usual minimum depth rather than a frost line. Your building department sets the exact figure.`,
    });
  }
  if (trade.slug === "fence-installation" && f.lumber) {
    out.push({ title: `Fence wood in ${city.stateName}`, text: `${cap(LUMBER_WORDS[f.lumber])}. That shows up in a wood fence's material line more than in vinyl or chain link, which ship from national plants.` });
  }
  if (trade.slug === "deck-building") {
    if (f.deckCode) {
      out.push({
        title: `The deck code in ${city.stateName}`,
        text: `${f.deckCode.statewide ? "Decks here are built to the" : "There is no statewide code; decks follow the"} ${f.deckCode.name}. Guards are required at ${f.deckCode.guardIn} in. where the deck is more than 30 in. up, and stair risers can be up to ${f.deckCode.riserMaxIn} in.${deckNote(f.deckCode) ? ` ${deckNote(f.deckCode)}` : ""}`,
      });
    }
    if (f.deckBoards) out.push({ title: `What decks are built of in ${city.stateName}`, text: f.deckBoards });
  }
  if (trade.slug === "hvac-replacement" && f.design) {
    out.push({
      title: `Climate a system is sized for in ${city.stateName}`,
      text: `Contractors size equipment for the local design temperatures. ${f.design.median ? `Across ${city.stateName}'s counties the median is` : `In ${city.city} it is`} about ${f.design.coolingF}°F on a hot summer day and ${f.design.heatingF}°F on a cold winter night (ENERGY STAR county table)${f.design.median ? ", and your county can differ" : ""}. ${f.design.heatingF <= 5 ? "Winters that cold are where a cold-climate heat pump or a furnace earns its price." : f.design.heatingF >= 40 ? "With winters that mild, a standard heat pump covers heating for most homes." : "A standard heat pump handles most winters here; a furnace or a cold-climate model covers the coldest nights."}`,
    });
  }
  return out;
}

function buildFaq(trade: SeoTrade, city: SeoCity, q: ReturnType<typeof quote>, nat: ReturnType<typeof quote>): CostFaq[] {
  const ph = SEO_PHRASES[trade.slug];
  const f = stateFacts(city.state);
  const typical = trade.size.typical;
  const variant = trade.variants.find((v) => v.id === trade.defaultVariant) ?? trade.variants[0];
  const big = trade.size.sizes[2];
  const bq = quote(trade, city, big);
  const out: CostFaq[] = [];

  out.push({
    q: `${ph.ask} in ${city.place}?`,
    a: `About ${usd(q.avg)} for ${trade.size.phrase(typical.toLocaleString("en-US"))} with ${lc(variant.label)}, and most ${city.city} quotes fall between ${usd(q.lo)} and ${usd(q.hi)}. That is ${vsAverage(city.factor)}, where the same job averages ${usd(nat.avg)}.`,
  });
  out.push({
    q: `What is the ${ph.perUnit.replace(/^(\w+) cost/, "$1 price")} in ${city.city}?`,
    a: `${unitUsd(q.lo / typical)} to ${unitUsd(q.hi / typical)} ${trade.size.per}, about ${unitUsd(q.avg / typical)} on average${trade.altUnit ? `, or ${unitUsd((q.avg / typical) * trade.altUnit.factor)} ${trade.altUnit.per},` : ""} with ${lc(variant.label)}. Smaller jobs cost more per unit, because the fixed costs are spread over less.`,
  });
  out.push({
    q: `How much is ${trade.size.phrase(big.toLocaleString("en-US"))} in ${city.city}?`,
    a: `${usd(bq.lo)} to ${usd(bq.hi)}, about ${usd(bq.avg)} on average, with ${lc(variant.label)} — ${unitUsd(bq.avg / big)} ${trade.size.per}.`,
  });

  const permit = permitFor(trade);
  // A pass-through fee line, else the line whose name carries the permit (a deck's plans, permit and layout).
  const fee = q.lines.find((l) => l.fee) ?? q.lines.find((l) => /permit/i.test(l.label));
  if (permit) {
    const lead =
      permit.need === "required"
        ? `Yes — ${permit.reason} needs a permit nearly everywhere, ${city.city} included.`
        : permit.need === "not-needed"
          ? `Usually not: ${permit.reason} is exempt under the International Residential Code, though ${city.city} or an HOA can still ask for one.`
          : `It depends on the city: for ${permit.reason} some building departments want a permit and some don't, so check with ${city.city}'s.`;
    const codeLine = trade.slug === "deck-building" && f.deckCode ? ` In ${city.stateName}, decks follow the ${f.deckCode.name}.` : "";
    out.push({
      q: `Do you need a permit for ${trade.lower} in ${city.city}?`,
      a: `${lead}${codeLine}${fee ? ` The prices on this page carry ${usd(fee.lo)}–${usd(fee.hi)} for ${fee.fee ? "the permit and inspection" : lc(fee.label)}.` : ""}`,
    });
  }

  if (f.salesTax != null) {
    out.push({
      q: `Does the price include sales tax in ${city.stateName}?`,
      a:
        f.salesTax === 0
          ? `No tax is included, and ${city.stateName} has no state sales tax.`
          : `No. The prices here are before tax; ${city.stateName}'s base state rate is ${pctRate(f.salesTax)}, plus any local rate.${f.laborTaxed ? ` ${cap(city.stateName)} taxes installation labor too.` : ""}`,
    });
  }

  if (trade.slug === "hvac-replacement" && f.design) {
    out.push({
      q: `What size HVAC system does a house in ${city.city} need?`,
      a: `It is worked out with a Manual J load calculation for the house — included in the prices above — not from square footage alone. Here it is run against design temperatures of about ${f.design.coolingF}°F in summer and ${f.design.heatingF}°F in winter${f.design.median ? ` (the ${city.stateName} median)` : ""}.`,
    });
  } else if (trade.slug === "fence-installation" && f.frostIn != null) {
    out.push({
      q: `How deep do fence posts go in ${city.stateName}?`,
      a: `Below frost depth, at least a third of the post's height and never less than 24 in.${f.frostIn > 24 ? ` With a typical frost depth of about ${f.frostIn} in. in ${city.stateName}, expect holes that deep.` : ""}`,
    });
  } else if (trade.slug === "deck-building" && f.deckBoards) {
    out.push({ q: `What decking do people choose in ${city.stateName}?`, a: f.deckBoards });
  } else {
    const sorted = trade.variants.map((v) => ({ v, r: quote(trade, city, typical, v.id) })).sort((a, b) => a.r.avg - b.r.avg);
    if (sorted.length > 1) {
      out.push({
        q: `What is the cheapest ${ph.materialNoun} for ${trade.lower} in ${city.city}?`,
        a: `${sorted[0].v.label}, at about ${usd(sorted[0].r.avg)} for ${trade.size.phrase(typical.toLocaleString("en-US"))}. ${sorted[sorted.length - 1].v.label} runs about ${usd(sorted[sorted.length - 1].r.avg)}.`,
      });
    }
  }
  return out;
}

/** The /cost/<work> index: each city's typical price, by state. */
export function tradeIndexRows(trade: SeoTrade): Array<{ state: string; stateName: string; rows: Array<{ href: string; label: string; avg: string }> }> {
  const states = new Map<string, { stateName: string; rows: Array<{ href: string; label: string; avg: string }> }>();
  for (const c of SEO_CITIES) {
    const s = states.get(c.state) ?? { stateName: c.stateName, rows: [] };
    s.rows.push({ href: costPath(trade, c), label: c.city, avg: usd(typicalAvg(trade, c)) });
    states.set(c.state, s);
  }
  return [...states.entries()].map(([state, v]) => ({ state, ...v })).sort((a, b) => a.stateName.localeCompare(b.stateName));
}

/** The deck code's note a homeowner gains from: the frost rule where the state writes one, else its first amendment (a state with no statewide code says so in its own words already). */
function deckNote(code: NonNullable<ReturnType<typeof stateFacts>["deckCode"]>): string | undefined {
  return code.notes.find((n) => /frost/i.test(n)) ?? (code.statewide ? code.notes[0] : undefined);
}
