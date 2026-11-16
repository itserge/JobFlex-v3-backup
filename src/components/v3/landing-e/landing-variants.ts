/* TRADE-ADAPTIVE HERO — the one table behind `?industry=`.
   Copy pattern (owner, 2026-09-10): h1 "The full [result]. / From just
   [input]."; sub lists what is inside, and the time.
   ============================================================
   An ad lands on jobflex.app/?industry=<trade> and the landing swaps ONLY its
   first screen: the headline, the line under it, the primary button's words,
   the product shot, and which estimator the showcase opens on. Everything
   below the fold is shared. Without the parameter the page is byte-for-byte
   what it was — DEFAULT_LANDING is the hero's original copy moved here.

   The variant is resolved ON THE SERVER (src/app/page.tsx reads the query —
   only the query) so the first paint already carries the right hero; nothing
   here sniffs the client. This module is deliberately free of next/headers so both
   the server page and client components can import it.

   ONE KEY PER TRADE. The keys are the 20 real trades of TRADE_TYPES ("Other"
   is not a direction anyone advertises), as URL slugs. Every key already
   works end to end — the register links carry it, the register form
   pre-selects the trade, the cookie remembers it — and a key whose entry is
   still null simply shows the default hero. Filling a trade in is data:
   write its LandingVariant, and if it plays the Smart Proposal sequence, its
   scenario in smart-scenarios.ts. */

import { TRADE_TYPES, type TradeType } from "@/lib/tradeTypes";
import type { DemoFilmKey } from "./demo-media";
import type { SmartScenarioKey } from "./smart-scenarios";

export type ShowcaseSlideKey = "smart" | "roof" | "fence" | "hvac" | "video";

export type LandingVariant = {
  /** Two lines — the hero broke the H1 exactly once. Since 2026-10-19 the
   *  hero shows `title` instead; an ad hook's two lines still come here. */
  h1: [string, string];
  /** THE FIRST SCREEN'S ONE THOUGHT (2026-10-19): the H1, one short sentence,
   *  no line under it — "Stop Spending Hours on <Trade> Estimates.". The film
   *  follows it, then the button. A `?hook=` replaces it with the ad's lines. */
  title?: string;
  /** The description under the reviews (hero-proof.tsx): two short
   *  sentences on what the trade gets — never "AI analyzes". */
  pitch?: string;
  /** Three short lines under the description — only what the estimator
   *  really does. Each stands beside the figure of the same index in `proof`. */
  points?: [string, string, string];
  /** The description's figures, one per line of `points` (hero-proof.tsx):
   *  a big value in the trade estimator's colour and a few words under it.
   *  Only facts the page already states (PROOF below says where each is from). */
  proof?: [LandingProof, LandingProof, LandingProof];
  /** The how-it-works section's kicker over the pitch: the tool the trade
   *  works in ("HVAC Estimator", "Smart Proposal"). */
  kicker?: string;
  /** The how-it-works pictures, one per line of `points`: a real frame of
   *  that step (public/landing-e/how/, 760×570, ≤ 90 KB each). */
  how?: [LandingShot, LandingShot, LandingShot];
  /** One grey line under the pitch: the way from the trade's first input to
   *  the signed proposal. */
  lede?: string;
  /** One line under the H1. Absent on the default hero, which never had one. */
  sub?: string;
  /** Words on the solid CTA. */
  primaryCta: string;
  /** Which estimator the showcase opens on; auto-advance carries on from it. */
  showcaseSlide: ShowcaseSlideKey;
  /** The showcase's own set, in order (2026-10-20): an ad landing shows its
   *  own estimator first, then Smart, then Video — not the other trades'
   *  tools. Absent: the full set, as every other landing has it. */
  showcaseSlides?: readonly ShowcaseSlideKey[];
  /** The hero's product shot. "dashboard" is the default's; a trade picks
   *  one of the three estimator sequences. */
  visual: "dashboard" | "roof" | "fence" | "hvac" | "smart" | "deck";
  /** The estimator's demo film in the shot's place (demo-film.tsx, files in
   *  demo-media.ts) — HVAC, roofing and fencing since 2026-10-19. The shot
   *  above stays the showcase's. */
  film?: DemoFilmKey;
  /** For visual "smart": which job the sequence prices. */
  scenario?: SmartScenarioKey;
  /** A headline a sentence long (owner, 2026-10-01: HVAC, roofing): set a
   *  size down so it stays two or three lines instead of five. */
  h1Long?: boolean;
  /** The sub's last line takes more than one word (owner, 2026-10-01:
   *  fencing's "phone." stood alone at 1440): balanced lines (.lp-sub--even). */
  subEven?: boolean;
  /** One bold line under the sub (HVAC). */
  subStrong?: string;
  /** The hero's own primary button, when it differs from the top-of-page CTA
   *  the nav, the showcase and the sticky bar carry (cta-copy.ts).
   *  NOT SHOWN since 2026-10-16 (owner): every hero's button says the trial,
   *  as the default page's does (hero.tsx trialCta). Kept to bring back. */
  heroCta?: string;
  /** The two headline lines are two sentences (an ad's opening line and its
   *  answer): the break between them holds on a phone too. */
  h1Break?: boolean;

  /* THE AD'S FIRST SCREEN (2026-10-04) — the analyst's fixes for a landing
     that ad clicks arrive on, tried on roofing first: the price in the first
     screen, the product shot playing on a phone, a sign-up button where the
     hero's readers stop. A variant without these fields is as it was. */
  /** The plan row the hero's price is read from: the cheapest plan on sale
   *  that ticks this row is what the trade's estimator costs after the trial
   *  (hero-price.ts). No such plan in the catalogue: no price line. */
  priceFeature?: string;
  /** What follows the amount on the price line. */
  priceNote?: string;
  /** The product shot plays its sequence on a phone too; without it a phone
   *  opens the shot filled (hero-visual.tsx). */
  playOnPhone?: boolean;
  /** A sign-up button stands under the product shot. */
  shotCta?: boolean;
};

/** A how-it-works picture: the file and what it shows, for a screen reader. */
export type LandingShot = { img: string; alt: string };

/** A figure beside a line of the description: "0" over "site visits before the estimate". */
export type LandingProof = { value: string; label: string };

/* THE DESCRIPTION'S FIGURES (2026-10-19). Each belongs to the line it
   stands under (same index in `points`), and says only what the code or
   the page already does:
   - "Manual J + S": the HVAC load is Manual J-based (never "ACCA-approved" —
     the claims review) and the unit is checked to Manual S (lib/hvac
     checks.ts, engine.ts);
   - "Every line" for HVAC: every line priced, the equipment in Good /
     Better / Best tiers (lib/hvac engine.ts tiers);
   - "Aerial": the roof measured from aerial imagery — EagleView by
     default, Google's Solar data where it is the provider or the fallback;
   - "Every line" for a roof: every quantity labelled measured, estimated or
     entered, priced at the shop's rates (the "line-by-line" ad);
   - "On the lot line": the fence drawn on the satellite map over the
     parcel's property lines (the fence film, the "drive-out" ad);
   - "Every post & bag": posts and 60 lb concrete bags per post counted and
     priced (lib/fence concreteBagsPerPost);
   - "To code": the deck's frame picked from the span tables (lib/deck
     codeTables, structure.ts);
   - "50 boards": lib/deck/catalog DECKING, 50 boards, each priced per foot;
   - "< 1 min": the estimator films, address to proposal in 40–44 s
     (demo-media DEMO_CAPTION); "90 s": the Deck Studio film's own card,
     "From the first click to the client's signature, in ninety seconds";
   - "No site visit": a Smart Proposal is written from the description (and
     a photo) the contractor types;
   - "1 app": estimate, proposal, the client's signature and the deposit in
     one app (the roofing ads' "Address to Signature. One App.", "Get Paid
     by Stage"); "4": roof, fence, HVAC and deck, each a tool of its own;
     "$40M+": the stats section's "Companies using JobFlex made $40,000,000+". */
type Proof3 = [LandingProof, LandingProof, LandingProof];
const PROOF = {
  minute: { value: "< 1 min", label: "address to proposal in the demo" },
  everyLine: { value: "Every line", label: "materials and labor, priced" },
  signPay: { value: "1 app", label: "your client signs and pays" },
} as const satisfies Record<string, LandingProof>;
const HVAC_PROOF: Proof3 = [
  { value: "Manual J + S", label: "a Manual J-based load, the unit checked to Manual S" },
  { value: "Every line", label: "priced, equipment in Good / Better / Best" },
  PROOF.minute,
];
const ROOF_PROOF: Proof3 = [{ value: "Aerial", label: "measured from imagery, no ladder" }, { value: "Every line", label: "materials and labor at your rates" }, PROOF.minute];
const FENCE_PROOF: Proof3 = [{ value: "On the lot line", label: "drawn on the satellite map" }, { value: "Every post & bag", label: "counted and priced" }, PROOF.minute];
const DECK_PROOF: Proof3 = [
  { value: "To code", label: "the frame picked from the span tables" },
  { value: "50 boards", label: "in the catalog, each priced per foot" },
  { value: "90 s", label: "first click to signature in the demo" },
];
/** A Smart Proposal trade's: written from what you describe, priced line by line, signed and paid in the app. */
const SMART_PROOF: Proof3 = [{ value: "No site visit", label: "priced from what you describe" }, PROOF.everyLine, PROOF.signPay];
/* THE HOW-IT-WORKS PICTURES (2026-10-19): real frames, cropped to the
   step's fragment — the estimator films for HVAC, roof, fence and deck
   (public/landing-e/*-demo-*.mp4, the same recordings as the hero's), and
   the real pages on a local production build for Smart Proposal and the
   default page (a demo company's fictional records). Cropped and encoded by
   .cache/herofit/how/crop.sh. */
const shots = (key: string, alts: [string, string, string]): [LandingShot, LandingShot, LandingShot] =>
  alts.map((alt, i) => ({ img: `/landing-e/how/${key}-0${i + 1}.webp`, alt })) as [LandingShot, LandingShot, LandingShot];
const HOW = {
  hvac: shots("hvac", [
    "The HVAC estimator: the address typed, the county's design temperatures and the house's records found",
    "The HVAC estimator: the Good and Better equipment with prices and the unit's fit to the load under Manual S",
    "The client's proposal: AC and furnace replacement, the total and the Accept proposal button",
  ]),
  roofing: shots("roofing", [
    "The roof estimator: total area, roofing squares and pitch over the aerial measurement of the house",
    "The roof estimate: total, materials and labor, 26 lines to review",
    "The client's proposal: the roof as measured from the air, the Accept proposal button and the priced lines",
  ]),
  fencing: shots("fencing", [
    "The fence estimator: the fence drawn along the property lines on the satellite map, each run measured",
    "The fence takeoff: posts, concrete bags, rails, pickets and hardware, each counted",
    "The client's proposal: a board-on-board fence, the total and the fence in 3D",
  ]),
  decking: shots("decking", [
    "The deck estimator's framing plan: joists and beam picked from the span tables",
    "The deck estimator's materials: Better and Best packages, the deck boards and the framing lumber",
    "The deck's proposal on the client's phone beside the lumber-yard list and the permit set",
  ]),
  smart: shots("smart", [
    "Smart Proposal: the job described in a few lines, ready to price",
    "A proposal's estimate detail: materials and labor lines, subtotal, tax and the total due",
    "The client's proposal: the total and the proposal accepted",
  ]),
  dashboard: shots("default", [
    "Proposals: the total value of open proposals and the list with each one's status",
    "The calendar: a month of jobs and visits, each with its crew",
    "Financials: revenue against expenses and the month's revenue, expenses and profit",
  ]),
} as const;

/** The line under the pitch, by where the trade's estimate starts. */
const LEDE = {
  address: "From the first address to a signed proposal.",
  deck: "From the first click to a signed proposal.",
  smart: "From the first description to a signed proposal.",
} as const;

/** The hero as it shipped on 2026-08-25 — the page with no `?industry=`. */
export const DEFAULT_LANDING: LandingVariant = {
  h1: ["Turn your trade", "into a business."],
  title: "Turn your trade into a business.",
  pitch: "Start with the first call. Estimate, send proposals, schedule your crew, and get paid in one app.",
  points: ["Estimates & proposals", "Jobs, crew & schedule", "Invoices & payments"],
  kicker: "JobFlex",
  how: HOW.dashboard,
  lede: "From the first call to the final invoice.",
  proof: [
    { value: "4", label: "estimators: roof, fence, HVAC and deck" },
    { value: "1 app", label: "jobs, crew and calendar in one place" },
    { value: "$40M+", label: "made by companies using JobFlex" },
  ],
  primaryCta: "Start free trial",
  showcaseSlide: "smart",
  visual: "dashboard",
};

/* ── keys ──────────────────────────────────────────────────
   TRADE_TYPES minus "Other", slugged. The map is the single place a key is
   tied to its trade; the register form's pre-select and the alias table both
   read it. */
export const VARIANT_TRADE = {
  flooring: "Flooring",
  tile: "Tile",
  countertops: "Countertops",
  plumbing: "Plumbing",
  electrical: "Electrical",
  carpentry: "Carpentry",
  painting: "Painting",
  roofing: "Roofing",
  fencing: "Fencing",
  decking: "Decking",
  siding: "Siding",
  "kitchen-bath": "Kitchen & Bath",
  hvac: "HVAC",
  landscaping: "Landscaping",
  concrete: "Concrete",
  demolition: "Demolition",
  drywall: "Drywall",
  insulation: "Insulation",
  windows: "Windows",
  "general-contractor": "General Contractor",
} as const satisfies Record<string, Exclude<TradeType, "Other">>;

export type LandingVariantKey = keyof typeof VARIANT_TRADE;

export const VARIANT_KEYS = Object.keys(VARIANT_TRADE) as LandingVariantKey[];

/* ── the variants ──────────────────────────────────────────
   null = not written yet: the key works (links, cookie, register pre-select)
   and the hero is the default. The dev gallery (/dev/landing-variants)
   shows these as TODO plates. */
export const LANDING_VARIANTS: Record<LandingVariantKey, LandingVariant | null> = {
  // Owner's copy, 2026-10-01 — verbatim. The new words are the hero's own
  // button only; the nav, the sections and the sticky bar keep the trade's.
  fencing: {
    h1: ["Still Driving to the Job Site", "Just to Measure a Fence?"],
    title: "Stop Spending Hours on Fence Estimates.",
    pitch: "Start with an address. Draw the fence on the lot, price materials and labor, and create a customer-ready proposal.",
    points: ["Draw the fence on the lot line", "Material takeoff & pricing", "Professional proposals"],
    proof: FENCE_PROOF,
    how: HOW.fencing,
    kicker: "Fence Estimator",
    lede: LEDE.address,
    h1Long: true,
    sub: "Enter the project address. JobFlex generates the measurements, materials, labor, pricing, and a complete customer-ready estimate and proposal — in seconds, right from your phone.",
    subEven: true,
    primaryCta: "Start free — estimate a fence",
    heroCta: "Create My Free Estimate →",
    showcaseSlide: "fence",
    showcaseSlides: ["fence", "smart", "video"],
    visual: "fence",
    film: "fence",
    // The ad's first screen, as on roofing and HVAC (2026-10-04): the fence
    // estimator's plan price, the sequence on a phone, a button under it.
    priceFeature: "Fence estimator",
    priceNote: "fence estimator included",
    playOnPhone: true,
    shotCta: true,
  },
  // Owner's copy, 2026-10-01 — verbatim.
  roofing: {
    h1: ["Complete Roof Report & Proposal —", "in Seconds."],
    title: "Stop Spending Hours on Roof Estimates.",
    pitch: "Start with an address. Measure the roof, price materials and labor, and create a customer-ready proposal.",
    points: ["Roof measurements from aerial imagery", "Materials, labor & pricing", "Professional proposals"],
    proof: ROOF_PROOF,
    how: HOW.roofing,
    kicker: "Roof Estimator",
    lede: LEDE.address,
    h1Long: true,
    sub: "Enter an address. JobFlex AI analyzes the property and generates a detailed, customer-ready proposal — roof measurements, materials, labor, pricing, and more — without waiting hours for a report or driving to the job first.",
    primaryCta: "Start free — measure a roof",
    heroCta: "Get My First Roofing Report & Proposal →",
    showcaseSlide: "roof",
    showcaseSlides: ["roof", "smart", "video"],
    visual: "roof",
    film: "roof",
    // The ad's first screen (2026-10-04): the roof estimator's plan price
    // under the buttons, the sequence on a phone, a button under the shot.
    // The page's own order — the demo second, the comparison by the pricing —
    // is lib/landing-sections; the ads' opening lines are LANDING_HOOKS below.
    priceFeature: "Roof estimator",
    priceNote: "roof estimator included",
    playOnPhone: true,
    shotCta: true,
  },
  "kitchen-bath": {
    h1: ["The full remodel estimate.", "From a description and a photo."],
    title: "Stop Spending Hours on Remodel Estimates.",
    pitch: "Start with a description and a photo. Price demo, rough-in, cabinets, tile, fixtures and labor, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Demo, rough-in, cabinets, tile, fixtures and labor — written in minutes.",
    primaryCta: "Start free — write an estimate",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "kitchen",
  },
  painting: {
    h1: ["The whole paint bid.", "From the square footage."],
    title: "Stop Spending Hours on Painting Estimates.",
    pitch: "Start with the square footage. Price prep, primer, coats, trim and labor, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Prep, primer, coats, trim and labor — interior or exterior.",
    primaryCta: "Start free — quote a paint job",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "painting",
  },
  // THE DECK STUDIO'S OWN PAGE (owner, 2026-10-11: "let's do vertical" — lib/editions).
  // /deck and the deck host land here; the sign-up it writes carries the edition.
  // No plan is the Deck Studio's: the trial holds it, then the $79/mo add-on (lib/editions).
  decking: {
    h1: ["Deck Studio: the deck in 3D,", "to your state's code, priced."],
    title: "Stop Spending Hours on Deck Estimates.",
    pitch: "Start with the house. Design the deck in 3D, frame it from the span tables, price it, and create a customer-ready proposal.",
    points: ["Deck design in 3D, framed to code", "Boards, framing & pricing", "Proposals & permit set"],
    proof: DECK_PROOF,
    how: HOW.decking,
    kicker: "Deck Studio",
    lede: LEDE.deck,
    sub: "Draw it on the house's own photo, frame it from the span tables, print the permit set and send the proposal — with the office around it: clients, calendar, crew and payments. Decks only, nothing else in the way.",
    primaryCta: "Start Deck Studio — free trial",
    showcaseSlide: "smart",
    // The studio's own pictures (deck-shots.tsx): the 3D on the house photo; no Smart Proposal shot here.
    visual: "deck",
    // Its 87-second walk-through in the hero's place since 2026-10-19 (demo-media.ts).
    film: "deck",
    scenario: "decking",
    priceFeature: "Deck Studio",
    priceNote: "the office included",
    shotCta: true,
  },

  // Batch 2 (2026-09-08): no tool of their own — the Smart Estimator
  // sequence with the trade's own job. Copy stays short and promises no
  // measurement.
  siding: {
    h1: ["The whole siding bid.", "From the wall area."],
    title: "Stop Spending Hours on Siding Estimates.",
    pitch: "Start with the wall area. Price tear-off, wrap, siding, trim and labor, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Tear-off, wrap, lap siding, trim and labor — per sq ft, in one proposal.",
    primaryCta: "Start free — quote a siding job",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "siding",
  },
  concrete: {
    h1: ["The whole pour, priced.", "Before you order the mix."],
    title: "Stop Spending Hours on Concrete Estimates.",
    pitch: "Start with the slab you describe. Price demo, base, forms, rebar, finish and labor, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Demo, base, forms, rebar, finish and labor from the slab you describe.",
    primaryCta: "Start free — price a pour",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "concrete",
  },
  landscaping: {
    h1: ["The full yard proposal.", "From what you describe."],
    title: "Stop Spending Hours on Landscaping Estimates.",
    pitch: "Start with the yard you describe. Price grading, pavers, retaining walls, sod and labor, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Grading, pavers, retaining wall, sod and labor — priced line by line.",
    primaryCta: "Start free — estimate a yard",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "landscaping",
  },
  flooring: {
    h1: ["The complete floor bid.", "From a room list."],
    title: "Stop Spending Hours on Flooring Estimates.",
    pitch: "Start with a room list. Price tear-out, underlayment, planks, trim and labor, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Tear-out, underlayment, planks, trim and labor — room by room.",
    primaryCta: "Start free — quote a floor",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "flooring",
  },
  tile: {
    h1: ["The whole tile job, priced.", "From the rooms you describe."],
    title: "Stop Spending Hours on Tile Estimates.",
    pitch: "Start with the rooms you describe. Price demo, prep, waterproofing, tile, grout and labor, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Demo, prep, waterproofing, tile, grout and labor, floor to shower.",
    primaryCta: "Start free — price a tile job",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "tile",
  },

  // Batch 3 (2026-09-08): the unit-priced trades — fixtures, points,
  // equipment, sheets, openings. Smart Estimator sequence, no measurement
  // promised.
  plumbing: {
    h1: ["The whole job, priced.", "Fixture by fixture."],
    title: "Stop Spending Hours on Plumbing Estimates.",
    pitch: "Start with the job you describe. Price the water heater, rough-ins, fixtures, drain runs and labor, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Water heater, rough-ins, fixtures, drain runs and labor from what you describe.",
    primaryCta: "Start free — price a plumbing job",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "plumbing",
  },
  electrical: {
    h1: ["The full electrical quote.", "From the scope."],
    title: "Stop Spending Hours on Electrical Estimates.",
    pitch: "Start with the scope. Price the panel, circuits, outlets, cans and labor, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Panel, circuits, outlets, cans and labor — point by point.",
    primaryCta: "Start free — quote electrical",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "electrical",
  },
  // HVAC (2026-10-01): its own window — the real estimator's flow on three
  // example house (hvac-estimator-shot.tsx) — and its own showcase slide, like the
  // roof and the fence. The Smart scenario stays for the showcase's first slide.
  // Owner's copy, 2026-10-01 — verbatim.
  hvac: {
    h1: ["Turn an Address Into a Complete", "HVAC Estimate — in Seconds."],
    title: "Stop Spending Hours on HVAC Estimates.",
    pitch: "Start with an address. Build load estimates, size equipment, review pricing, and create a customer-ready proposal.",
    points: ["Load estimates & equipment sizing", "Equipment options & pricing", "Professional proposals"],
    proof: HVAC_PROOF,
    how: HOW.hvac,
    kicker: "HVAC Estimator",
    lede: LEDE.address,
    h1Long: true,
    sub: "JobFlex AI analyzes the property and builds a detailed estimate with system sizing, equipment, pricing, energy costs, and more — before the first site visit.",
    subStrong: "No unnecessary drive. No hours of calculations.",
    primaryCta: "Start free — price an HVAC job",
    heroCta: "Build My First Estimate →",
    showcaseSlide: "hvac",
    showcaseSlides: ["hvac", "smart", "video"],
    visual: "hvac",
    film: "hvac",
    scenario: "hvac",
    // The ad's first screen, as on roofing (2026-10-04). The HVAC window
    // already plays on a phone. The price line waits for the plan cards:
    // none of them lists an "HVAC estimator" row today (every plan opens the
    // estimator, capped per plan by limitsJson hvacEstimates), so the hero
    // prints no price until /admin/plans gives the plans that include it
    // that row — then it reads it like roofing's.
    priceFeature: "HVAC estimator",
    priceNote: "HVAC estimator included",
    playOnPhone: true,
    shotCta: true,
  },
  drywall: {
    h1: ["The complete drywall bid.", "From the sheet count."],
    title: "Stop Spending Hours on Drywall Estimates.",
    pitch: "Start with the sheet count. Price hanging, tape, finish, texture and labor, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Hang, tape, level 4 finish, texture and labor per sheet.",
    primaryCta: "Start free — quote drywall",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "drywall",
  },
  windows: {
    h1: ["Every opening, priced.", "From your count."],
    title: "Stop Spending Hours on Window Estimates.",
    pitch: "Start with your count of openings. Price the units, casing, install and haul-away, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Units, patio door, casing, install and haul-away in one proposal.",
    primaryCta: "Start free — price windows",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "windows",
  },

  // Batch 4 (2026-09-08): the last five. General Contractor is the one
  // that differs in kind — a project assembled from phases, not one trade's
  // estimate — and its scenario prices each phase off the sub-trade's anchor.
  countertops: {
    h1: ["The full countertop quote.", "From the slab and the foot."],
    title: "Stop Spending Hours on Countertop Estimates.",
    pitch: "Start with the slab and the run. Price the sq ft, sink cutout, backsplash, template and install, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Quartz by the sq ft, sink cutout, backsplash, template and install.",
    primaryCta: "Start free — price countertops",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "countertops",
  },
  carpentry: {
    h1: ["The complete carpentry bid.", "Cut by cut."],
    title: "Stop Spending Hours on Carpentry Estimates.",
    pitch: "Start with the scope you type. Price trim by the foot, doors, built-ins, framing and labor, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Trim by the foot, doors, built-ins, framing and labor from the scope you type.",
    primaryCta: "Start free — quote carpentry",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "carpentry",
  },
  insulation: {
    h1: ["The whole insulation job, priced.", "From the R-value."],
    title: "Stop Spending Hours on Insulation Estimates.",
    pitch: "Start with the area and the R-value. Price removal, blown-in, batts, air sealing and labor, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Removal, blown-in attic, batts, air sealing and labor per sq ft.",
    primaryCta: "Start free — price insulation",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "insulation",
  },
  demolition: {
    h1: ["The whole tear-out, priced.", "Dumpster to dumpster."],
    title: "Stop Spending Hours on Demolition Estimates.",
    pitch: "Start with the tear-out you describe. Price containment, demo, loads out, disposal and cleanup, and create a customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Containment, demo by the sq ft, loads out, disposal and cleanup.",
    primaryCta: "Start free — quote a tear-out",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "demolition",
  },
  "general-contractor": {
    h1: ["The whole job, every trade.", "One estimate."],
    title: "Stop Spending Hours on Project Estimates.",
    pitch: "Start with the whole job. Price each phase at its sub's rate, demo to finish, and create one customer-ready proposal.",
    points: ["Estimate from what you describe", "Materials, labor & pricing", "Professional proposals"],
    proof: SMART_PROOF,
    how: HOW.smart,
    kicker: "Smart Proposal",
    lede: LEDE.smart,
    sub: "Demo to finish — each phase at its sub's price, in a single proposal.",
    primaryCta: "Start free — price the whole job",
    showcaseSlide: "smart",
    visual: "smart",
    scenario: "general-contractor",
  },
};

/** The hero content for a key: its variant, or the default while unwritten. */
export function variantContent(key: LandingVariantKey | undefined): LandingVariant {
  return (key && LANDING_VARIANTS[key]) || DEFAULT_LANDING;
}

/** True when the key has a written hero (not a TODO placeholder). */
export function isVariantReady(key: LandingVariantKey): boolean {
  return LANDING_VARIANTS[key] !== null;
}

/* ── the ad's opening line as the headline ─────────────────
   `?hook=<key>` beside `?industry=<trade>` (2026-10-04; the analyst: "the
   hero does not continue the ad's first line"). An ad that opens on "Stop
   buying roof reports" lands on a first screen whose headline says exactly
   that, with the ad's next line under it. Only the two lines change: the
   button, the trial badge, the price and the product shot stay the trade's.

   A KEY, NEVER THE WORDS. The URL carries a key into this table and nothing
   else — a headline read from the query string would let anyone print their
   own sentence under JobFlex's name and pass the link around. An unknown
   key, or a key on a trade that has no table, is the trade's own hero.

   EVERY ENTRY IS AN AD THAT EXISTS (advertisement/…): the headline is that
   ad's opening line and the line under it says no more than the ad shows.
   A new ad gets a new entry; the admin's "Links for your ads" lists them. */
export type LandingHook = {
  /** The ad's opening line, as the hero's two lines. */
  h1: [string, string];
  /** The ad's next line, under it. */
  sub: string;
  /** Which ad opens this way, for the admin's link builder. */
  ad: string;
};

export const LANDING_HOOKS: Partial<Record<LandingVariantKey, Readonly<Record<string, LandingHook>>>> = {
  roofing: {
    "no-report": {
      h1: ["Stop Buying Roof Reports.", "Stop Retyping Them."],
      sub: "Type the address and hit Measure. The roof lands on your estimate and rides into the proposal — no PDF to order, no hours to wait.",
      ad: "No report to buy · 40 s",
    },
    hours: {
      h1: ["Roof Estimates Shouldn't Take Hours.", "From Address to Signed Roof Contract."],
      sub: "Measure. Estimate. Send. Get signed. All in JobFlex.",
      ad: "Address to signed · 40 s and the 23 s cut",
    },
    "all-in-one": {
      h1: ["No Report to Buy.", "No Proposal to Rebuild."],
      sub: "Type the address: the roof is measured, priced at your rates and sent as a proposal your client signs on their phone.",
      ad: "All in one · 40 s",
    },
    "one-address": {
      h1: ["One Address.", "The Whole Roof Is Priced."],
      sub: "Hit Measure: squares, pitch, facets, eaves, ridges and valleys — usually in under a minute. The estimate is already built, at your rates.",
      ad: "Measured & built · dark, with voice",
    },
    "your-price": {
      h1: ["Your Price. Your Proposal.", "And You See It First."],
      sub: "Start with your own rates: change a number and every line re-prices. Preview exactly what the homeowner sees, then send.",
      ad: "Your price, previewed · dark, with voice",
    },
    "line-by-line": {
      h1: ["Where Does the Number Come From?", "Let's Go Line by Line."],
      sub: "Every quantity on the estimate is labeled measured, estimated or entered — shingles with waste, ice and water, drip edge, ridge cap, labor by pitch.",
      ad: "Line by line · dark, with voice",
    },
    coffee: {
      h1: ["Your Coffee's Still Hot.", "The Roof Is Already Priced."],
      sub: "Type the address. The house is found from the air, measured and priced line by line, and the proposal is on your client's phone.",
      ad: "Coffee clock · 28 s",
    },
    signature: {
      h1: ["Address to Signature.", "One App."],
      sub: "Measured from the air, priced in shingles or metal, sent as a proposal with the roof picture, accepted on the phone.",
      ad: "Five sheets · 28 s",
    },
    deposit: {
      h1: ["Stop Chasing the Deposit.", "Get Paid by Stage."],
      sub: "Your client accepts on the phone and the deposit is due right then. Every job shows what is paid and what is due.",
      ad: "Receipt roll · 28 s",
    },
    "two-prices": {
      h1: ["Same Roof.", "Two Prices."],
      sub: "Shingles or metal with one switch. Every line re-prices, any line can be edited, and it goes to the client's phone.",
      ad: "Metal switch · 28 s",
    },
    "first-bid": {
      h1: ["The First Bid Wins.", "Be Their First Bid."],
      sub: "The homeowner gets a proposal with their own roof on it, priced line by line, and accepts it on their phone.",
      ad: "First bid · 28 s",
    },
    "win-more": {
      h1: ["Estimate Faster.", "Win More Roofs."],
      sub: "Type the address. JobFlex finds the roof from the air and measures it — squares, ridge, hips, valleys. One click makes the proposal.",
      ad: "Address to accepted · 50 s",
    },
  },
  // The three fence ads (advertisement/fence, fence-voice): each one's
  // on-screen opening line — the same picture carries the silent cut and
  // both voiced takes. Their "text it" line stays out: texting a proposal
  // needs the shop's own registered number.
  fencing: {
    "drive-out": {
      h1: ["Price the Fence", "Before You Drive Out."],
      sub: "Type the address and the lot line pops up. Click the fence in, drop the gates — it is priced while you draw, then they see it in 3D.",
      ad: "Address to fence · 30 s",
    },
    slope: {
      h1: ["Yards Aren't Flat.", "Your Bids Shouldn't Be."],
      sub: "Tap Topo and it reads the lidar on the lot: every run racked or stepped, the extended posts and slope labor priced into the bid.",
      ad: "Reads the ground · 30 s",
    },
    money: {
      h1: ["Stop Leaving Money", "On the Fence Line."],
      sub: "Every fence type priced as you click, three packages ready to sell, tear-out and steel posts added with a tap — the material list writes itself.",
      ad: "Money on the line · 30 s",
    },
  },
  // The HVAC ads (advertisement/hvac, hvac-40), held to their claims review:
  // the load is "Manual J-based", state rules exist for six states, there is
  // no duct diagram. The service-plans clip has no entry while plans are
  // early access (lib/earlyAccess) — a new account could not open them.
  hvac: {
    tonnage: {
      h1: ["Still Sizing by the Square Foot?", "Stop Guessing Tonnage."],
      sub: "Size it from the load: a Manual J-based block load on the county's design day, the unit that fits it, and the code checks behind it.",
      ad: "Sized to the house · 41 s, with voice",
    },
    "every-call": {
      h1: ["Not Every Call Is a Full System.", "Repairs. Swaps. Service."],
      sub: "A furnace or condenser swap, a ductless zone for the addition, a service call priced task by task — every HVAC call in one estimator.",
      ad: "Every HVAC call · 43 s, with voice",
    },
    math: {
      h1: ["The HVAC Estimate", "That Does the Math."],
      sub: "Type the address: the house is pulled, the load figured on the county's design day, the system sized and every line written for you.",
      ad: "The whole estimate · 49 s",
    },
    "nine-jobs": {
      h1: ["One House.", "Nine HVAC Jobs."],
      sub: "Full system, furnace, heat pump, water heater, ductless or a service call — pick the job and it is sized and priced for that house.",
      ad: "Pick the job · 36 s",
    },
    address: {
      h1: ["Type the Address.", "Get the House."],
      sub: "One click pulls the parcel record, the building outline, the lidar elevation and the county's design day — every fact shows its source.",
      ad: "Type an address · 29 s",
    },
    code: {
      h1: ["Code-Checked,", "Rule by Rule."],
      sub: "Each code check comes with the rule behind it — state rules for CA, WA, OR, FL, TX and NY, the federal efficiency floors everywhere.",
      ad: "Code by state · 37 s",
    },
    "repair-replace": {
      h1: ["Repair It or Replace It?", "The Math Says."],
      sub: "Price the service call from your own menu, task by task — and when the repairs outgrow the system, one click quotes the replacement.",
      ad: "Service & repair · 21 s",
    },
    inventory: {
      h1: ["Know What's Short", "Before the Truck Rolls."],
      sub: "Connect the estimate to your shelf: every material checked against stock, short items grouped by supplier, the crew's list to load.",
      ad: "Inventory · 38 s",
    },
  },
};

/** `?hook=No_Report` → "no-report" when the trade has that hook; anything
 *  else → undefined (the trade's own hero). Case, spaces and underscores do
 *  not matter. */
export function resolveLandingHook(variant: LandingVariantKey | undefined, raw: string | string[] | null | undefined): string | undefined {
  const table = variant ? LANDING_HOOKS[variant] : undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!table || typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase().replace(/[\s_]+/g, "-").slice(0, 40);
  return Object.prototype.hasOwnProperty.call(table, key) ? key : undefined;
}

/** The hook's lines for a resolved key. */
export function hookContent(variant: LandingVariantKey | undefined, key: string | undefined): LandingHook | undefined {
  const table = variant ? LANDING_HOOKS[variant] : undefined;
  return table && key && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** A trade's hooks, in the table's order — the admin's link builder lists them. */
export function hooksOf(variant: LandingVariantKey | undefined): Array<{ key: string } & LandingHook> {
  const table = variant ? LANDING_HOOKS[variant] : undefined;
  return table ? Object.entries(table).map(([key, hook]) => ({ key, ...hook })) : [];
}

/** The trade's hero with the ad's two lines in place of its own. A hook is
 *  set as the ad sets it — two sentences, or one over two lines — so the
 *  break holds on a phone; the bold third line some trades carry belongs to
 *  their own copy and goes with it. */
export function withHook(v: LandingVariant, hook: LandingHook | undefined): LandingVariant {
  if (!hook) return v;
  return { ...v, h1: hook.h1, title: undefined, sub: hook.sub, subStrong: undefined, subEven: true, h1Long: true, h1Break: true };
}

/* ── normalisation ─────────────────────────────────────────
   What an ad link may carry, lower-cased: the key itself, the TRADE_TYPES
   name ("Kitchen & Bath"), and the obvious short forms. Anything else is
   the default page. */
const VARIANT_ALIASES: Record<string, LandingVariantKey> = {
  // short forms and plurals
  fence: "fencing",
  fences: "fencing",
  fencer: "fencing",
  fencers: "fencing",
  roof: "roofing",
  roofs: "roofing",
  roofer: "roofing",
  roofers: "roofing",
  reroof: "roofing",
  deck: "decking",
  decks: "decking",
  paint: "painting",
  painter: "painting",
  painters: "painting",
  sider: "siding",
  siders: "siding",
  "flooring-contractor": "flooring",
  tiler: "tile",
  tilers: "tile",
  "hvac-contractor": "hvac",
  // The HVAC page's second version (2026-10-19) is the HVAC page again: its
  // links land there.
  hvac2: "hvac",
  "hvac-v2": "hvac",
  "gc-contractor": "general-contractor",
  kitchen: "kitchen-bath",
  kitchens: "kitchen-bath",
  bath: "kitchen-bath",
  bathroom: "kitchen-bath",
  bathrooms: "kitchen-bath",
  "kitchen-and-bath": "kitchen-bath",
  kitchen_bath: "kitchen-bath",
  remodel: "kitchen-bath",
  gc: "general-contractor",
  general: "general-contractor",
  contractor: "general-contractor",
  floor: "flooring",
  floors: "flooring",
  tiles: "tile",
  tiling: "tile",
  countertop: "countertops",
  counters: "countertops",
  quartz: "countertops",
  trim: "carpentry",
  framing: "carpentry",
  plumber: "plumbing",
  plumbers: "plumbing",
  electric: "electrical",
  electrician: "electrical",
  electricians: "electrical",
  carpenter: "carpentry",
  carpenters: "carpentry",
  heating: "hvac",
  cooling: "hvac",
  ac: "hvac",
  landscape: "landscaping",
  landscaper: "landscaping",
  landscapers: "landscaping",
  hardscape: "landscaping",
  demo: "demolition",
  sheetrock: "drywall",
  insulate: "insulation",
  window: "windows",
  "windows-doors": "windows",
  doors: "windows",
};

/** Lower-cased lookup table: keys, TRADE_TYPES names, slugs of those names, aliases. */
const LOOKUP: Record<string, LandingVariantKey> = (() => {
  const t: Record<string, LandingVariantKey> = {};
  for (const key of VARIANT_KEYS) {
    t[key] = key;
    const name = VARIANT_TRADE[key].toLowerCase();
    t[name] = key; // "kitchen & bath", "general contractor"
    t[name.replace(/\s*&\s*/g, "-").replace(/\s+/g, "-")] = key; // "kitchen-bath"
    t[name.replace(/\s*&\s*/g, " and ").replace(/\s+/g, "-")] = key; // "kitchen-and-bath"
    t[name.replace(/[^a-z]+/g, "")] = key; // "kitchenbath", "generalcontractor"
  }
  Object.assign(t, VARIANT_ALIASES);
  return t;
})();

/** `?industry=Fencing`, `?trade=fence`, `?industry=Kitchen%20%26%20Bath`, `?industry=gc`
 *  → the key; anything else → undefined (the default page). Case and
 *  surrounding whitespace do not matter. */
export function resolveLandingVariant(raw: string | string[] | null | undefined): LandingVariantKey | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const norm = value.trim().toLowerCase().replace(/\s+/g, " ");
  return LOOKUP[norm] ?? LOOKUP[norm.replace(/[\s_]+/g, "-")];
}

/** The same resolution from the register form's side: the trade to pre-select. */
export function variantTrade(key: LandingVariantKey | undefined): TradeType | null {
  return key ? VARIANT_TRADE[key] : null;
}

// Every real trade has a key, and every key names a real trade — checked at
// module load so the two lists cannot drift without a thrown error in dev.
if (process.env.NODE_ENV !== "production") {
  const covered = new Set<string>(Object.values(VARIANT_TRADE));
  for (const t of TRADE_TYPES) {
    if (t !== "Other" && !covered.has(t)) throw new Error(`landing-variants: no key for trade "${t}"`);
  }
}

/* ── memory ────────────────────────────────────────────────
   Same pattern as the promo/referral capture (attribution-capture.tsx):
   a 30-day first-party cookie, written by the page once a variant has been
   asked for explicitly. Read by /auth/register (trade pre-select) and the
   Google return only — the landing never reads it (owner, 2026-09-10): the
   page with no `?industry=` is always the default page. */
export const INDUSTRY_COOKIE = "jf_industry";
export const INDUSTRY_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

/* ── links ─────────────────────────────────────────────────
   Every register link on a variant page carries the variant, and whatever
   utm_* the visit arrived with, so the register form and the analytics see
   the same campaign the hero did. */
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export type UtmParams = Partial<Record<(typeof UTM_KEYS)[number], string>>;

/** The utm_* pairs present in a query, values trimmed and capped. */
export function pickUtm(params: Record<string, string | string[] | undefined>): UtmParams {
  const out: UtmParams = {};
  for (const key of UTM_KEYS) {
    const raw = params[key];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value) out[key] = value.slice(0, 120);
  }
  return out;
}

/* The utm_* of the visit, remembered the same way as the trade (30 days,
   first-party) so the Google button and a later visit with no
   parameters still hand the campaign to the signup (CRO stage 1, 2026-09-09).
   Stored as a query string; read back through pickUtm so the keys and caps
   are the same as for a URL. */
export const UTM_COOKIE = "jf_utm";

export function serializeUtm(utm: UtmParams): string {
  const q = new URLSearchParams();
  for (const key of UTM_KEYS) {
    const v = utm[key];
    if (v) q.set(key, v);
  }
  return q.toString();
}

export function parseUtmCookie(value: string | undefined): UtmParams {
  if (!value) return {};
  try {
    return pickUtm(Object.fromEntries(new URLSearchParams(value)));
  } catch {
    return {};
  }
}

/** True when the visit carried any utm_* at all. */
export function hasUtm(utm: UtmParams | undefined): boolean {
  return !!utm && UTM_KEYS.some((k) => !!utm[k]);
}

/* Meta's click id (2026-09-30). An ad link arrives with `?fbclid=…`; the
   register link carries it on, so the visit stays attributed to the ad
   (lib/traffic-visitor). Only Meta's own alphabet passes. */
export function pickFbclid(params: Record<string, string | string[] | undefined>): string | undefined {
  const raw = params.fbclid;
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value && /^[\w-]{1,500}$/.test(value) ? value : undefined;
}

/* The click id across the Google round trip (2026-10-01). A NEW address comes
   back from Google through the auth callback's own redirect
   (lib/googleSignup.googleSignupReturnUrl), which never sees the callbackUrl —
   so the Google button also leaves the fbclid in this cookie for an hour, and
   the return puts it back on the register URL. Written with marketing consent
   only: it is an advertising identifier. */
export const FBCLID_COOKIE = "jf_fbclid";
export const FBCLID_MAX_AGE_S = 60 * 60; // 1 hour

/** `/auth/register` → `/auth/register?industry=fencing&utm_source=…&fbclid=…`.
 *  With no variant, utm or fbclid it returns `base` untouched, so the default
 *  page's markup is exactly what it was. */
export function signupHref(base: string, opts: { industry?: LandingVariantKey; utm?: UtmParams; fbclid?: string; /** The tool the ad sold (lib/planSpotlight) — the plan cards mark it. */ tool?: string }): string {
  const q = new URLSearchParams();
  if (opts.industry) q.set("industry", opts.industry);
  if (opts.tool) q.set("tool", opts.tool);
  for (const key of UTM_KEYS) {
    const v = opts.utm?.[key];
    if (v) q.set(key, v);
  }
  if (opts.fbclid) q.set("fbclid", opts.fbclid);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
