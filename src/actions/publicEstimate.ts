"use server";
// THE HOMEOWNER'S ESTIMATORS, with no account (owner, 2026-10-27: "Price my project" in the home portal). Org-less on
// purpose: nothing here imports the contractor gates. Its own brakes instead — a honeypot, 10 roof reads an hour per
// connection and 600 an hour for everyone, the intake's own limits on a submit. Two front doors share these actions:
// the home portal (`caller.kind: "home"` — the lead goes to the Lead Center) and the contractor-website estimators
// (`"site"` — the lead goes to that contractor; wired by that work, accepted here).
//
// Every refusal comes back as `{ ok: false, error }` in words: a thrown error is masked in production, and the
// person reading it has just typed their address from an ad.
import { z } from "zod";
import { getBuildingInsights, isSolarEnabled, SolarUnavailableError } from "@/lib/solar";
import { estimateSolarRoof, type SolarRoofEstimate } from "@/lib/roofSolarEstimate";
import { clientIp, enforceRateLimit, MINUTE } from "@/lib/rateLimit";
import { locationIndex } from "@/lib/estimate/location-index";
import { recordApiSpend } from "@/lib/apiSpend";
import { unitCents } from "@/lib/paidApiCosts";
import { roofGuideRange } from "@/lib/publicEstimate/guide";
import { cacheFresh, cacheable, houseOrgId, inUs, pubRoofKey, readPubRoof, writePubRoof, type PubRoofCache } from "@/lib/publicEstimate/store";
import { disclaimerFor, roofFactsFromSize, roofFactsFromSolar, roofRange, type HomeSize, type MaterialId, type RoofAnswers } from "@/lib/publicEstimate/roof";
import { lookupSiteFacts } from "@/lib/hvac/siteLookup";
import { lookupPropertyBoundary } from "@/lib/fence/boundaryLookup";
import { estimateShort, estimateWords, leadEstimateFrom, planNotesFor, type RoofLeadEstimate } from "@/lib/leadCenter/estimate";
import { buildPriceRangeEmail } from "@/lib/email/build/platform";
import { renderEmail } from "@/lib/email/renderEmail";
import { sendEmail } from "@/lib/sdk/resend";
import { appBaseUrl } from "@/lib/appUrl";
import { homeUrl } from "@/lib/home/portal";
import { createHomeownerLead } from "@/lib/leadCenter/intake";
import { LEAD_CONSENT_TEXT } from "@/lib/leadConsent";
import { findOrCreateHome, homePath } from "@/lib/home/portal";
import { db } from "@/lib/db";

export type PublicCaller = { kind: "home" } | { kind: "site"; orgSlug: string };

const US_STATE = /^[A-Z]{2}$/;
const readSchema = z.object({
  address: z.string().trim().min(3).max(200),
  city: z.string().trim().max(120),
  state: z.string().trim().toUpperCase().regex(US_STATE, "state"),
  zip: z.string().trim().max(12),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  /** The honeypot: a person never fills it. */
  website: z.string().max(200).optional(),
  /** The material the range opens on — for the "typical in <city>" line. */
  material: z.string().max(40).optional(),
});
export type PublicRoofReadInput = z.infer<typeof readSchema>;

export type PublicRoofReadResult =
  | {
      ok: true;
      solar: SolarRoofEstimate | null;
      /** Why there is no roof read, in words for the homeowner; null when `solar` is set. */
      noRoofReason: string | null;
      cityFactor: number;
      cityWords: string | null;
      guide: { low: number; high: number; cityWords: string } | null;
      cached: boolean;
      /** No aerial roof: the home's size from the house lookup — the range is priced from it, nothing asked. */
      size: HomeSize | null;
    }
  | { ok: false; error: string };

const TRY_AGAIN = "Something went wrong — try again.";
/** Roof reads an hour from one connection — 10; a stand walking the flow many times sets PUBROOF_READS_PER_HOUR. */
const READS_PER_HOUR = Math.max(1, Number(process.env.PUBROOF_READS_PER_HOUR) || 10);
const NO_ROOF = "We couldn't read your roof from the sky.";

/** The roof at this address, read from Google Solar — cached per address for 30 days. */
export async function publicRoofRead(raw: unknown, caller: PublicCaller): Promise<PublicRoofReadResult> {
  try {
    return await readInner(raw, caller);
  } catch (err) {
    const e = err as { name?: string; retryAfterMs?: number };
    if (e?.name === "RateLimitError") {
      const mins = Math.max(1, Math.ceil((e.retryAfterMs ?? 60 * MINUTE) / MINUTE));
      return { ok: false, error: `We're pricing a lot of roofs right now — try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
    }
    if (err instanceof z.ZodError) return { ok: false, error: "Pick your address from the list, then try again." };
    console.error("[price] roof read failed:", err);
    return { ok: false, error: TRY_AGAIN };
  }
}

async function readInner(raw: unknown, caller: PublicCaller): Promise<PublicRoofReadResult> {
  const input = readSchema.parse(raw);
  // A filled honeypot is a script: refused before any brake counts it or any call is made.
  if (input.website && input.website.trim() !== "") return { ok: false, error: TRY_AGAIN };
  if (!inUs(input.lat, input.lng)) return { ok: false, error: "We price homes in the US — pick a US address from the list." };
  const ip = await clientIp();
  await enforceRateLimit(`pubroof:${ip}`, READS_PER_HOUR, 60 * MINUTE, "reads");
  await enforceRateLimit("pubroof:global", 600, 60 * MINUTE, "reads");

  const idx = locationIndex(`${input.city}, ${input.state}`);
  const cityFactor = idx.factor;
  const cityWords = idx.level === "national" ? null : idx.place;
  const material = (input.material ?? "architectural") as MaterialId;
  const guide = roofGuideRange(`${input.city}, ${input.state}`, material);

  const key = pubRoofKey(input);
  const now = new Date();
  const cached = await readPubRoof(key);
  if (cacheFresh(cached, now)) {
    return { ok: true, solar: cached!.solar, noRoofReason: cached!.solar || cached!.size ? null : NO_ROOF, cityFactor, cityWords, guide, cached: true, size: cached!.size ?? null };
  }
  if (!isSolarEnabled()) {
    const size = await homeSizeAt(input);
    return { ok: true, solar: null, noRoofReason: size ? null : NO_ROOF, cityFactor, cityWords, guide, cached: false, size };
  }

  // HIGH imagery first; where Google has none (or none the roof math takes), MEDIUM — many US homes have nothing
  // better, and a homeowner's rough range does not need the contractor's precision (2026-10-28).
  let row: PubRoofCache | null = null;
  let outcome: "ok" | "timeout" | "no-coverage" | "config" | "error" = "ok";
  let calls = 0;
  for (const quality of ["HIGH", "MEDIUM"] as const) {
    outcome = "ok";
    calls += 1;
    try {
      const insights = await getBuildingInsights(input.lat, input.lng, quality);
      const est = estimateSolarRoof(insights, { lat: input.lat, lng: input.lng }, now, { minQuality: "MEDIUM" });
      row = { v: 2, at: now.toISOString(), solar: est.ok ? est.estimate : null, error: est.ok ? null : est.error };
      // Google answered: the roof math has what it will get — a second, lower-quality call would not change it.
      break;
    } catch (err) {
      outcome = err instanceof SolarUnavailableError ? err.kind : "error";
      row = { v: 2, at: now.toISOString(), solar: null, error: (err as Error)?.message?.slice(0, 300) ?? "solar failed" };
      // Only "no high-quality data here" is worth asking again at MEDIUM; a bad key or a timeout is not.
      if (outcome !== "no-coverage") break;
    }
  }
  // Every call was made whatever it answered: filed under the house org when there is one.
  const house = await houseOrgId();
  if (house) await recordApiSpend(house, [{ service: "google-solar", op: "buildingInsights", calls, cents: calls * unitCents("google-solar", "buildingInsights") }], now);
  // Why a read came back empty, in the server log: the key, coverage, or the roof math.
  if (!row?.solar) console.warn("[price] roof read empty:", outcome, row?.error ?? "", key);
  // No aerial roof: the home's size worked out from the house lookup — the homeowner is never asked for square feet
  // they do not know (owner, 2026-10-28). Kept with the read.
  const size = row?.solar ? null : await homeSizeAt(input);
  if (row && cacheable(outcome)) await writePubRoof(key, { ...row, size });
  if (caller.kind === "site") console.info("[price] site read", caller.orgSlug, key);
  const solar = row?.solar ?? null;
  return { ok: true, solar, noRoofReason: solar || size ? null : NO_ROOF, cityFactor, cityWords, guide, cached: false, size };
}

/** The home's size when the sky can't read the roof — the HVAC estimator's house lookup (lib/hvac/siteLookup: the
 *  county record's living area and storeys, the building's outline at the pin via the fence estimator's lot lookup),
 *  filed under the house org. Nothing found, or no house org: null, and the homeowner is asked as a last resort. */
async function homeSizeAt(input: PublicRoofReadInput): Promise<HomeSize | null> {
  const house = await houseOrgId();
  if (!house) return null;
  const address = [input.address, input.city, [input.state, input.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const looked = await lookupSiteFacts({ address, state: input.state, lat: input.lat, lng: input.lng }, house, { boundary: lookupPropertyBoundary }).catch((err: unknown) => {
    console.warn("[price] house lookup failed:", err instanceof Error ? err.message : err);
    return null;
  });
  if (!looked || !looked.ok) return null;
  const f = looked.facts;
  if (!f.footprintSqft && !f.livingSqft) return null;
  const source = f.footprintSqft ? (f.sources.footprint ?? "the building's outline") : (f.sources.living ?? "the county record");
  return { footprintSqft: f.footprintSqft ?? null, livingSqft: f.livingSqft ?? null, storeys: f.storeys ?? null, source };
}

// ── The submits ──────────────────────────────────────────────────────────────

const answersSchema = z.object({
  existing: z.enum(["asphalt", "metal", "tile", "shake", "flat", "unsure"]),
  storeys: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  material: z.enum(["architectural", "standing_seam", "impact_resistant", "designer", "three_tab"]),
  tearOffLayers: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  leaks: z.boolean(),
  skylights: z.boolean(),
  solarPanels: z.boolean(),
});
const siteSchema = readSchema.pick({ address: true, city: true, state: true, zip: true, lat: true, lng: true, website: true });
/** What the browser sends about the range: its answers, where the facts came from, a budget — never the numbers.
 *  The server prices again from the cached roof read (or the home's size) and keeps its own result. */
const pricedSchema = z.object({
  answers: answersSchema,
  basis: z.enum(["solar", "size"]),
  budgetCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  /** With `basis: "size"`: the home's square footage the homeowner typed. */
  homeSqft: z.number().int().min(200).max(50_000).optional(),
  timezone: z.string().max(80).optional(),
});
const leadSchema = siteSchema.merge(pricedSchema).extend({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(7).max(40),
  consent: z.boolean(),
  page: z.string().max(300).optional(),
  /** "Send me the range by email too". */
  emailRange: z.boolean().optional(),
  /** A saved range picked up from the dashboard or its email: the plan becomes this request (lib/home/portal). */
  homeKey: z.string().max(200).optional(),
  planId: z.string().max(60).optional(),
  /** The homeowner's own words to the pro (2026-10-28) — what they wrote in the portal's box, or here. */
  note: z.string().trim().max(1000).optional(),
});
const emailSchema = siteSchema.merge(pricedSchema).extend({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(120).optional(),
});
export type PublicRoofLeadInput = z.infer<typeof leadSchema>;
export type PublicRoofEmailInput = z.infer<typeof emailSchema>;

const CONSENT_MISSING = "Please tick the box to agree to be contacted about your request, then send again.";

/** The record, priced by the server from what it trusts: the cached roof read, or the size the homeowner typed. */
async function serverEstimate(input: z.infer<typeof siteSchema> & z.infer<typeof pricedSchema>): Promise<RoofLeadEstimate | null> {
  const answers: RoofAnswers = input.answers;
  const idx = locationIndex(`${input.city}, ${input.state}`);
  const city = idx.level === "national" ? null : { factor: idx.factor, words: idx.place };
  let facts = null;
  let basis: "solar" | "size" = "size";
  if (input.basis === "solar") {
    const cached = await readPubRoof(pubRoofKey(input));
    if (cached?.solar) {
      facts = roofFactsFromSolar(cached.solar, answers, input.state);
      basis = "solar";
    }
  }
  if (!facts) {
    if (!input.homeSqft) return null;
    facts = roofFactsFromSize(input.homeSqft, answers, input.state);
  }
  const range = roofRange(facts, answers, city, basis);
  const guide = roofGuideRange(`${input.city}, ${input.state}`, answers.material);
  const e = leadEstimateFrom(range, answers, guide);
  e.budgetCents = input.budgetCents && input.budgetCents > 0 ? Math.round(input.budgetCents) : null;
  return e;
}

export type PublicRoofLeadResult = { ok: true; statusPath: string; requestToken: string; homePath: string | null } | { ok: false; error: string };

/** The range, by email: the number, what's in it, the one next step. Best-effort — the request or the plan stands. */
async function sendRangeEmail(to: string, name: string | null, site: { address: string; city: string }, e: RoofLeadEstimate, quotes: { url: string; label: string }, home: string | null | undefined): Promise<void> {
  try {
    const basis = `about ${Math.round(e.squares * 100).toLocaleString("en-US")} sq ft of roof${e.basis === "solar" ? ` · ${e.pitchLabel} pitch · read from aerial data` : " · from your home's size"}`;
    const { subject, html } = renderEmail(
      buildPriceRangeEmail({
        name,
        address: `${site.address}, ${site.city}`,
        range: estimateShort(e).split(" · ")[0],
        materialLabel: e.materialLabel,
        basis,
        included: e.hidden.scopeText.split(/(?<=\.)\s+/).filter((l) => !/\$/.test(l)).slice(0, 5),
        quotesUrl: quotes.url,
        quotesLabel: quotes.label,
        homeUrl: home ?? `${await appBaseUrl()}/home`,
        fine: disclaimerFor(e.basis),
      }),
    );
    await sendEmail({ mailClass: "transactional", to, subject, html });
  } catch (err) {
    console.error("[price] the range email did not go:", err);
  }
}

/** "Get quotes from local JobFlex pros": the range becomes a Lead Center lead that carries the whole estimate. */
export async function publicRoofLead(raw: unknown): Promise<PublicRoofLeadResult> {
  try {
    const input = leadSchema.parse(raw);
    if (input.website && input.website.trim() !== "") return { ok: false, error: TRY_AGAIN };
    // Nobody is contacted without the box ticked (owner, 2026-10-26) — said back before the brakes count the attempt.
    if (input.consent !== true) return { ok: false, error: CONSENT_MISSING };
    const ip = await clientIp();
    await enforceRateLimit(`homeowner:${ip}`, 3, 10 * MINUTE, "requests");
    await enforceRateLimit("homeowner:global", 60, MINUTE, "requests");
    const estimate = await serverEstimate(input);
    if (!estimate) return { ok: false, error: "We lost the roof read — go back a step and price it again." };
    const words = estimateWords(estimate);
    const res = await createHomeownerLead(
      {
        name: input.name,
        email: input.email,
        phone: input.phone,
        address: input.address,
        city: input.city,
        state: input.state,
        zip: input.zip,
        projectType: "roofing",
        description: input.note ? `${words}\n\nIn their words: ${input.note}` : words,
        // Pre-written and over 20 characters: the intake keeps it as the scope and skips the scope writer.
        scope: words,
      },
      {
        isTest: false,
        timezone: input.timezone ?? null,
        source: "price:roof",
        consent: { text: LEAD_CONSENT_TEXT, at: new Date(), ip: ip === "local" || ip === "unknown" ? null : ip, page: input.page?.startsWith("/") ? input.page : "/homeowner/price/roof" },
        estimate,
        homeKey: input.homeKey ?? null,
        planId: input.planId ?? null,
        // They priced a roof: the trade is theirs, not a model's guess; the pin is the one they confirmed.
        known: { trade: { trade: "Roofing", confidence: 1, reason: "the homeowner priced a roof in the homeowner portal" }, lat: input.lat, lng: input.lng },
      },
    );
    if (input.emailRange !== false) {
      const base = await appBaseUrl();
      await sendRangeEmail(input.email, input.name, input, estimate, { url: `${base}${res.statusPath}`, label: "Follow your request" }, res.homePath ? `${base}${res.homePath}` : null);
    }
    return { ok: true, statusPath: res.statusPath, requestToken: res.requestToken ?? "", homePath: res.homePath ?? null };
  } catch (err) {
    const e = err as { name?: string; retryAfterMs?: number };
    if (e?.name === "RateLimitError") {
      const mins = Math.max(1, Math.ceil((e.retryAfterMs ?? 10 * MINUTE) / MINUTE));
      return { ok: false, error: `We've had several projects from this connection in the last few minutes, so we're pausing for a moment. Please send again in ${mins} minute${mins === 1 ? "" : "s"}.` };
    }
    if (err instanceof z.ZodError) return { ok: false, error: "Something in the form doesn't look right — check your name, email and phone, then send again." };
    console.error("[price] lead failed:", err);
    return { ok: false, error: "We couldn't send that just now — nothing was lost. Please try again in a minute." };
  }
}

export type PublicRoofEmailResult = { ok: true; homePath: string | null; planId: string } | { ok: false; error: string };

/** "Email me this range": no lead, no consent box — the range becomes a planned project on their home dashboard,
 *  with the plan reminder (lib/home/reminders) nudging in two days; "Get quotes" from the email or the dashboard
 *  turns it into a request. */
export async function publicRoofEmail(raw: unknown): Promise<PublicRoofEmailResult> {
  try {
    const input = emailSchema.parse(raw);
    if (input.website && input.website.trim() !== "") return { ok: false, error: TRY_AGAIN };
    const ip = await clientIp();
    await enforceRateLimit(`pubemail:${ip}`, 5, 10 * MINUTE, "emails");
    await enforceRateLimit("pubemail:global", 60, 60 * MINUTE, "emails");
    if (!inUs(input.lat, input.lng)) return { ok: false, error: "We price homes in the US — pick a US address from the list." };
    const estimate = await serverEstimate(input);
    if (!estimate) return { ok: false, error: "We lost the roof read — go back a step and price it again." };
    // The email alone names the home: nothing of the house goes onto a record that may be somebody else's (the plan
    // carries the house), and the dashboard link is handed back on screen only to a first-timer — an existing home's
    // key goes by email, as the intake does (the review of 2026-10-27).
    const { home, isNew } = await findOrCreateHome({ name: input.name?.trim() || "Homeowner", email: input.email, timezone: input.timezone ?? null });
    const now = new Date();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const plan = await db.homePlan.create({
      data: {
        homeId: home.id,
        title: `Roof · ${input.address}`,
        notes: planNotesFor(estimate, { address: input.address, city: input.city, state: input.state, zip: input.zip, lat: input.lat, lng: input.lng }),
        plannedFor: nextMonth,
        wholeMonth: true,
        remindAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });
    const base = await appBaseUrl();
    await sendRangeEmail(input.email, input.name?.trim() || null, input, estimate, { url: `${base}/homeowner/price/roof?home=${encodeURIComponent(home.accessToken)}&plan=${encodeURIComponent(plan.id)}`, label: "Get quotes from local JobFlex pros" }, await homeUrl(home.accessToken));
    return { ok: true, homePath: isNew ? homePath(home.accessToken) : null, planId: plan.id };
  } catch (err) {
    const e = err as { name?: string; retryAfterMs?: number };
    if (e?.name === "RateLimitError") return { ok: false, error: "That's a few emails from this connection — try again in a few minutes." };
    if (err instanceof z.ZodError) return { ok: false, error: "Check the email address, then try again." };
    console.error("[price] email-only failed:", err);
    return { ok: false, error: "We couldn't send that just now — please try again in a minute." };
  }
}
