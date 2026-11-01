"use server";
// WEBSITE ESTIMATORS · THE ACTIONS (2026-10-27). Two doors:
//   the shop's — Settings → Website estimators: load, save, the admin's "open to every account" switch, and the
//     hand-off that opens a website lead in the shop's own estimator, already measured and priced;
//   the public's — the page on the contractor's website: a view counted, an estimate run, a lead made. Each public
//     action finds the shop by its handle again, checks the trade is on, and is braked per visitor and per shop.
// Rules in lib/webEstimator; the server half in lib/webEstimatorServer; the engines in lib/webEstimatorTrades.
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { NoOrgError, UnauthorizedError, isEstimatorRole, isOwnerRole, requireEstimatorOrManager, requireManager, requireOrg, requirePlatformAdmin } from "@/lib/orgContext";
import { cookies } from "next/headers";
import { ensureClientForLead } from "@/lib/leadClient";
import { FILING_COOKIE, FILING_MAX_AGE_S, type Filing } from "@/lib/filingCookie";
import { dollars, webAddonPriceWords, webModeBills, webTradeServes, type AddonInterval, type WebAddonLine, type WebBillingMode } from "@/lib/webAddon";
import { addWebAddon, quoteWebAddon as quoteWebLine, removeWebAddon, webAddonLines, webBilling, webShopServes } from "@/lib/webAddonBilling";
import { HOUR, MINUTE, RateLimitError, clientIp, enforceRateLimit } from "@/lib/rateLimit";
import { noteRequestOrg, takeTrialCap, trialPointKey } from "@/lib/trialMeter";
import { geocodePlace } from "@/lib/maps";
import { lookupPropertyBoundary } from "@/lib/fence/boundaryLookup";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { startEstimateFromLead } from "@/actions/leadEstimate";
import {
  PROJECT_TYPE,
  WEB_TRADE,
  WEB_TRADES,
  embedSnippets,
  hostAllowed,
  isWebTrade,
  normalizeWebEstimatorSettings,
  priceBand,
  type WebEstimatorSettings,
  type WebMonthCounts,
  type WebTrade,
  splitTypedAddress,
  money,
  bandWords,
  shopHourly,
  isHouse,
} from "@/lib/webEstimator";
import { PRO } from "@/lib/home/jobflexPro";
import { createHouseLead } from "@/lib/publicEstimate/houseLead";
import {
  bumpWebCount,
  createWebLead,
  readWebCounts,
  readWebEstimate,
  readWebLead,
  readWebSettings,
  setWebEstimatorOpen,
  storeWebEstimate,
  webCapReached,
  createWebLeadUnpriced,
  webEstimatorOpen,
  webShopBySlug,
  writeWebSettings,
  type WebShop,
  readWebRoof,
  storeWebRoof,
  readWebHvac,
  storeWebHvac,
  updateWebHvac,
} from "@/lib/webEstimatorServer";
import { imageryWords, measureWebRoof, priceWebDeckDesign, priceWebFenceDrawn, priceWebRoof, runWebTrade, sizeWebHvac, webDeckBase, webRoofChoices, webTradeAllChoices, webTradeChoices, webTradeQuestions, type WebAddress, type WebChoice, type WebQuestion } from "@/lib/webEstimatorTrades";
import { randomBytes } from "node:crypto";
import { CLIENT_TOKEN_RE, mergeClientDesign, type ClientDesignLink } from "@/lib/deck/clientDesign";
import { normalizeDeckDesign, type DeckDesign } from "@/lib/deck/design";
import { fileWebClientLink, readWebClientLink, sendDeckClientDesign, writeWebClientLink } from "@/actions/deckClientDesign";
import { lookupSiteFacts } from "@/lib/hvac/siteLookup";

type Fail = { ok: false; error: string };
const DENIED = "You don't have access to this.";

async function platformAdmin(): Promise<boolean> {
  try { await requirePlatformAdmin(); return true; } catch { return false; }
}

// ── the shop's door

export interface WebEstimatorView {
  settings: WebEstimatorSettings;
  slug: string;
  base: string;
  /** The shop's brand colour (Settings → Company), the embed button's; null when none is set. */
  brandColor: string | null;
  counts: WebMonthCounts;
  /** Everything each trade could offer (the pickers). */
  choices: Record<WebTrade, WebChoice[]>;
  canEdit: boolean;
  admin: boolean;
  /** The owner's switch: false = platform admins only (nothing billed), true = every account. */
  open: boolean;
  /** The money (lib/webAddon): how this shop pays and which lines it holds. */
  billing: WebBillingView;
}

export interface WebBillingView {
  mode: WebBillingMode;
  interval: AddonInterval;
  trialEndsAt: string | null;
  held: Partial<Record<WebTrade, WebAddonLine>>;
  /** The account owner: the one who may put a line on the plan or take one off. */
  owner: boolean;
}

export async function loadWebEstimator(): Promise<{ ok: true; view: WebEstimatorView } | Fail> {
  let ctx;
  try { ctx = await requireManager(); } catch (err) { if (err instanceof UnauthorizedError || err instanceof NoOrgError) return { ok: false, error: DENIED }; throw err; }
  const [admin, open, org, settings, counts] = await Promise.all([
    platformAdmin(), webEstimatorOpen(),
    db.organization.findUnique({ where: { id: ctx.organizationId }, select: { slug: true, primaryColor: true } }),
    readWebSettings(ctx.organizationId), readWebCounts(ctx.organizationId),
  ]);
  if (!open && !admin) return { ok: false, error: DENIED };
  const choices = Object.fromEntries(WEB_TRADES.map((t) => [t, webTradeAllChoices(t)])) as Record<WebTrade, WebChoice[]>;
  const billing = { ...(await webBilling(ctx.organizationId, open)), owner: isOwnerRole(ctx.role) };
  return { ok: true, view: { settings, slug: org?.slug ?? "", base: await appBaseUrl(), brandColor: org?.primaryColor ?? null, counts, choices, canEdit: true, admin, open, billing } };
}

const tradeLabel = (t: WebTrade) => WEB_TRADE[t].name.replace(" on your website", "");

/** Save the settings — and, with the feature open, RECONCILE THE PLAN (lib/webAddon): a trade on means its line on
 *  the subscription, off means off it. A line that can't go on leaves that trade off and says why; what happened to
 *  the money comes back in `notes`. */
export async function saveWebEstimator(raw: unknown): Promise<{ ok: true; settings: WebEstimatorSettings; billing: WebBillingView; notes: string[]; errors: string[] } | Fail> {
  let ctx;
  try { ctx = await requireManager(); } catch (err) { if (err instanceof UnauthorizedError || err instanceof NoOrgError) return { ok: false, error: DENIED }; throw err; }
  const [admin, open] = await Promise.all([platformAdmin(), webEstimatorOpen()]);
  if (!open && !admin) return { ok: false, error: "The website estimators are in preview — a JobFlex admin turns them on for now." };
  const settings = normalizeWebEstimatorSettings(raw);
  const notes: string[] = [];
  const errors: string[] = [];
  const owner = isOwnerRole(ctx.role);
  let billing = await webBilling(ctx.organizationId, open);
  if (open) {
    const before = await readWebSettings(ctx.organizationId);
    for (const t of WEB_TRADES) {
      const want = settings.trades[t].on;
      const held = !!billing.held[t];
      const label = tradeLabel(t);
      if (webModeBills(billing.mode)) {
        if (want && !held) {
          if (!owner) { settings.trades[t].on = false; errors.push(`${label}: only the account owner can add it to the plan.`); continue; }
          const r = await addWebAddon(ctx.organizationId, t);
          if (!r.ok) { settings.trades[t].on = false; errors.push(`${label}: ${r.error}`); continue; }
          const words = webAddonPriceWords(r.termCents, r.interval, true);
          notes.push(
            r.already ? `${label} is on your plan (${words}).`
            : r.trialing ? `${label} added — free until your trial ends, then ${words}.`
            : `${label} added to your plan: ${dollars(r.chargedCents)} charged today for the rest of this period, then ${words}.`,
          );
        } else if (!want && held) {
          if (!owner) { settings.trades[t].on = true; errors.push(`${label}: only the account owner can take it off the plan.`); continue; }
          const r = await removeWebAddon(ctx.organizationId, t);
          if (!r.ok) { settings.trades[t].on = true; errors.push(`${label}: ${r.error}`); continue; }
          notes.push(billing.mode === "trial-card" ? `${label} taken off your plan.` : `${label} taken off your plan; the unused days come back as a credit on your next bill.`);
        }
      } else if (want && !before.trades[t].on && (billing.mode === "free" || billing.mode === "offline")) {
        settings.trades[t].on = false;
        errors.push(`${label}: ${billing.mode === "free" ? "website estimators go on a paid plan — pick a plan on Subscription first." : "your plan isn't billed to a card here; write to us from Help and we'll add it."}`);
      }
    }
    if (notes.length || errors.length) billing = await webBilling(ctx.organizationId, open);
  }
  await writeWebSettings(ctx.organizationId, settings);
  const on = WEB_TRADES.filter((t) => settings.trades[t].on).map((t) => PROJECT_TYPE[t]);
  await logActivity({ organizationId: ctx.organizationId, actorId: ctx.user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Website estimators: ${on.length ? on.join(", ") + " on" : "all off"}${settings.domains.length ? ` · sites ${settings.domains.join(", ")}` : ""}` }).catch(() => {});
  revalidatePath("/dashboard/settings");
  if (notes.length) await logActivity({ organizationId: ctx.organizationId, actorId: ctx.user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Website estimators on the plan: ${notes.join(" ")}`, meta: { area: "billing", webAddons: true } }).catch(() => {});
  return { ok: true, settings, billing: { ...billing, owner }, notes, errors };
}

/** What putting a trade's line on charges today, before it is put on (the card's words when a trade is ticked). */
export async function quoteWebAddon(trade: unknown): Promise<{ ok: true; dueNowCents: number | null; termCents: number; interval: AddonInterval; trialing: boolean } | Fail> {
  try { await requireManager(); } catch (err) { if (err instanceof UnauthorizedError || err instanceof NoOrgError) return { ok: false, error: DENIED }; throw err; }
  if (!isWebTrade(trade)) return { ok: false, error: "No such estimator." };
  const ctx = await requireManager();
  if (!(await webEstimatorOpen())) return { ok: true, dueNowCents: 0, termCents: 0, interval: "MONTH", trialing: false };
  return quoteWebLine(ctx.organizationId, trade);
}

/** The Subscription page's card: the website lines this shop holds, in words. */
export async function getWebAddonLines(): Promise<{ ok: true; lines: Awaited<ReturnType<typeof webAddonLines>>; owner: boolean } | Fail> {
  let ctx;
  try { ctx = await requireOrg(); } catch (err) { if (err instanceof UnauthorizedError || err instanceof NoOrgError) return { ok: false, error: DENIED }; throw err; }
  return { ok: true, lines: await webAddonLines(ctx.organizationId), owner: isOwnerRole(ctx.role) };
}

/** The owner's switch (a platform admin): false keeps the feature to admins and unbilled; true opens it to every account. */
export async function setWebEstimatorOpenAction(on: boolean): Promise<{ ok: true; open: boolean } | Fail> {
  if (!(await platformAdmin())) return { ok: false, error: DENIED };
  await setWebEstimatorOpen(on === true);
  revalidatePath("/dashboard/settings");
  return { ok: true, open: on === true };
}

/** A website lead opens in the shop's own estimator, already measured and priced — the deck as a studio draft, the
 *  roof with its aerial measurement on file, HVAC and fence with the lead's address seeded. Redirects. */
export async function openWebLeadInEstimator(leadId: string): Promise<void> {
  const ctx = await requireEstimatorOrManager();
  if (typeof leadId !== "string" || !/^[\w-]{1,64}$/.test(leadId)) throw new Error("No such lead.");
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: ctx.organizationId }, select: { id: true, name: true, email: true, phone: true, address: true, city: true, state: true, zip: true } });
  const rec = lead ? await readWebLead(lead.id) : null;
  if (!lead || !rec) throw new Error("No such website lead.");
  const est = rec.estimate;
  if (rec.trade === "deck" && typeof est.facts.draftId === "string" && /^[a-f0-9-]{8,40}$/i.test(est.facts.draftId)) {
    // Designed on the website in the client designer: the send already made the studio's draft — open that one,
    // filed under the lead's client (found by email or phone, else made), so the proposal lands on them and Send to
    // client starts with their name (the same cookie startEstimateFromLead writes, lib/filingCookie).
    const client = await ensureClientForLead(ctx.organizationId, lead, { create: !isEstimatorRole(ctx.role) }).catch(() => null);
    const filing: Filing = { ...(client ? { clientId: client.id, clientName: client.name } : {}), leadId: lead.id, leadName: lead.name };
    (await cookies()).set(FILING_COOKIE, JSON.stringify(filing), { path: "/", maxAge: FILING_MAX_AGE_S, sameSite: "lax" });
    redirect(`/dashboard/deck-estimator?draft=${est.facts.draftId}`);
  }
  if (rec.trade === "deck") {
    const design = est.facts.design;
    const id = randomUUID();
    const address = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");
    const body = JSON.stringify({ v: 1, title: `${lead.name} — from the website · ${est.choice}`.slice(0, 120), address: address.slice(0, 300), updatedAt: new Date().toISOString(), by: `${lead.name} (website)`, proposalId: null, clientToken: null, design });
    await db.syncState.upsert({ where: { key: `deckdraft:${ctx.organizationId}:${id}` }, update: { cursor: body }, create: { key: `deckdraft:${ctx.organizationId}:${id}`, cursor: body } });
    redirect(`/dashboard/deck-estimator?draft=${id}`);
  }
  if (rec.trade === "roof" && est.facts.solar && !est.facts.measurementId) {
    // the aerial measurement the homeowner's page made, on the shop's file: the estimator reuses it for this address
    const solar = est.facts.solar as { areaSqft: number; footprintSqft: number; pitchLabel: string; segmentCount: number; center: { lat: number; lng: number }; imageryQuality: string; imageryDate: string | null };
    const pin = est.facts.pin as { lat: number; lng: number };
    const input = { address: lead.address ?? "", city: lead.city ?? "", state: lead.state ?? "", zip: lead.zip ?? "" };
    const structure = { areaSqft: solar.areaSqft, squares: solar.areaSqft / 100, pitch: solar.pitchLabel, footprintSqft: solar.footprintSqft, eaveHeightFt: null, outline: null, facetCount: null, shape: null, material: null, conditionRating: null, roofAgeYears: null, chimney: null, solarPanels: null, rooftopAcCount: null, occlusion: null, treeOverhang: null, confidence: null, materialRings: null };
    const instant = { requestId: "", address: [input.address, input.city, input.state, input.zip].filter(Boolean).join(", "), lat: solar.center.lat, lng: solar.center.lng, structures: [structure], imagery: [], totals: { areaSqft: solar.areaSqft, squares: solar.areaSqft / 100, predominantPitch: Number(String(solar.pitchLabel).split(":")[0]) || null, pitchLabel: solar.pitchLabel, maxEaveFt: null, facetCount: null, footprintSqft: solar.footprintSqft } };
    try {
      const row = await db.roofMeasurement.create({
        data: {
          organizationId: ctx.organizationId, createdById: ctx.user.id, source: "solar",
          address: input.address, city: input.city, state: input.state, zip: input.zip, lat: solar.center.lat, lng: solar.center.lng,
          areaSqft: solar.areaSqft, squares: solar.areaSqft / 100, predominantPitch: solar.pitchLabel, facetCount: solar.segmentCount,
          instantRequestId: null, instantJson: JSON.stringify(instant), modelJson: "{}", chimneyJson: "[]",
          provenanceJson: JSON.stringify({ calibration: null, provenance: { solar, solarRequestedPin: pin, imageryQuality: solar.imageryQuality, imageryDate: solar.imageryDate ?? undefined, website: true } }),
        },
        select: { id: true },
      });
      await db.syncState.update({ where: { key: `webLead:${lead.id}` }, data: { cursor: JSON.stringify({ ...rec, estimate: { ...est, facts: { ...est.facts, measurementId: row.id } } }) } }).catch(() => {});
    } catch (err) {
      console.error("[web-estimator] roof measurement row failed:", err instanceof Error ? err.message : err);
    }
  }
  await startEstimateFromLead(lead.id, WEB_TRADE[rec.trade].estimator);
}

// ── the public door

async function liveShop(slug: unknown, trade: unknown): Promise<{ shop: WebShop; trade: WebTrade } | Fail> {
  if (typeof slug !== "string" || !isWebTrade(trade)) return { ok: false, error: "This estimator isn't here." };
  const shop = await webShopBySlug(slug);
  if (!shop || !(await webShopServes(shop, trade))) return { ok: false, error: "This estimator isn't turned on." };
  return { shop, trade };
}
const brake = async (key: string, max: number, windowMs: number, what: string): Promise<string | null> => {
  try { await enforceRateLimit(key, max, windowMs, what); return null; } catch (err) { if (err instanceof RateLimitError) return "That's a lot of estimates at once — give it a few minutes and try again."; throw err; }
};

/** The page opened on the contractor's site (counted, best-effort). */
export async function webView(slug: unknown, trade: unknown): Promise<void> {
  const r = await liveShop(slug, trade);
  if ("ok" in r) return;
  const ip = await clientIp();
  if (await brake(`web-view:${ip}`, 60, 10 * MINUTE, "views")) return;
  await bumpWebCount(r.shop.id, "views").catch(() => {});
}

export interface WebEstimateView {
  token: string;
  summary: string;
  choice: string;
  band: { low: number; high: number };
  show: "range" | "exact";
  basis: string;
  askEmail: boolean;
}

/** The homeowner's address (and answers) → the price, in the shop's prices. */
export async function webEstimate(slug: unknown, trade: unknown, raw: unknown): Promise<{ ok: true; estimate: WebEstimateView } | (Fail & { code?: string })> {
  const r = await liveShop(slug, trade);
  if ("ok" in r) return r;
  const { shop, trade: t } = r;
  const ip = await clientIp();
  const braked = (await brake(`web-est-ip:${ip}`, 12, 10 * MINUTE, "estimates")) ?? (await brake(`web-est-shop:${shop.id}`, shopHourly(shop).estimates, HOUR, "estimates"));
  if (braked) return { ok: false, error: braked, code: "braked" };
  if (await webCapReached(shop)) return { ok: false, error: "This estimator has had a busy month and is resting. Leave your details and the shop will price it by hand.", code: "capped" };
  const input = cleanInput(raw);
  if (!input) return { ok: false, error: "Type the address of the house.", code: "address" };
  await noteRequestOrg(shop.id).catch(() => {});
  const out = await runWebTrade(shop, t, input);
  if (!out.ok) return { ok: false, error: out.error, code: out.code };
  const ts = shop.settings.trades[t];
  const band = priceBand(out.cents, ts.show, ts.spread);
  const rec = await storeWebEstimate({ organizationId: shop.id, trade: t, address: input.address.address.trim(), city: out.city, state: out.state, zip: out.zip, summary: out.summary, choice: out.choice, cents: out.cents, band, show: ts.show, facts: out.facts });
  await bumpWebCount(shop.id, "estimates").catch(() => {});
  return { ok: true, estimate: { token: rec.token, summary: out.summary, choice: out.choice, band, show: ts.show, basis: ts.note || WEB_TRADE[t].basis, askEmail: ts.askEmail } };
}

// ── THE ROOF ON THE WEBSITE (2026-10-28): measured from the air first and shown on their house; then each material
// they try is priced from that one measurement (no second aerial call); the lead carries the measurement.

export interface WebRoofFacts {
  squares: number;
  areaSqft: number;
  footprintSqft: number;
  pitchLabel: string;
  segmentCount: number;
  imagery: string | null;
  pin: { lat: number; lng: number };
}

export async function webRoofMeasure(slug: unknown, raw: unknown): Promise<{ ok: true; token: string; facts: WebRoofFacts; choices: WebChoice[] } | (Fail & { code?: string; pin?: { lat: number; lng: number } })> {
  const r = await liveShop(slug, "roof");
  if ("ok" in r) return r;
  const { shop } = r;
  const ip = await clientIp();
  const braked = (await brake(`web-roof-ip:${ip}`, 8, 10 * MINUTE, "measurements")) ?? (await brake(`web-est-shop:${shop.id}`, shopHourly(shop).estimates, HOUR, "estimates"));
  if (braked) return { ok: false, error: braked, code: "braked" };
  if (await webCapReached(shop)) return { ok: false, error: "This estimator has had a busy month and is resting. Leave your details and the shop will price it by hand.", code: "capped" };
  const input = cleanInput(raw);
  if (!input) return { ok: false, error: "Type the address of the house.", code: "address" };
  await noteRequestOrg(shop.id).catch(() => {});
  const m = await measureWebRoof(shop, input.address);
  if (!m.ok) return { ok: false, error: m.error, code: m.code, ...("pin" in m ? { pin: m.pin } : {}) };
  const rec = await storeWebRoof(shop.id, m.measure);
  const est = m.measure.est;
  return {
    ok: true,
    token: rec.token,
    facts: { squares: Math.round(est.areaSqft / 100), areaSqft: Math.round(est.areaSqft), footprintSqft: Math.round(est.footprintSqft), pitchLabel: est.pitchLabel, segmentCount: est.segmentCount, imagery: imageryWords(est.imageryDate), pin: { lat: m.measure.pin.lat, lng: m.measure.pin.lng } },
    choices: webRoofChoices(shop, est.predominantPitch12),
  };
}

export async function webRoofPrice(slug: unknown, token: unknown, choice: unknown): Promise<{ ok: true; estimate: WebEstimateView } | (Fail & { code?: string })> {
  const r = await liveShop(slug, "roof");
  if ("ok" in r) return r;
  const { shop } = r;
  if (typeof token !== "string") return { ok: false, error: "Measure the roof first.", code: "input" };
  const rec = await readWebRoof(token, shop.id);
  if (!rec) return { ok: false, error: "That measurement has aged out — measure the roof again.", code: "input" };
  const ip = await clientIp();
  const braked = await brake(`web-est-ip:${ip}`, 12, 10 * MINUTE, "estimates");
  if (braked) return { ok: false, error: braked, code: "braked" };
  const out = await priceWebRoof(shop, rec.measure, typeof choice === "string" && choice.length <= 60 ? choice : null);
  if (!out.ok) return { ok: false, error: out.error, code: out.code };
  const ts = shop.settings.trades.roof;
  const band = priceBand(out.cents, ts.show, ts.spread);
  const est = await storeWebEstimate({ organizationId: shop.id, trade: "roof", address: rec.measure.address.address.trim(), city: out.city, state: out.state, zip: out.zip, summary: out.summary, choice: out.choice, cents: out.cents, band, show: ts.show, facts: out.facts });
  await bumpWebCount(shop.id, "estimates").catch(() => {});
  return { ok: true, estimate: { token: est.token, summary: out.summary, choice: out.choice, band, show: ts.show, basis: ts.note || WEB_TRADE.roof.basis, askEmail: ts.askEmail } };
}

// ── HVAC ON THE WEBSITE (2026-10-28): the house looked up first — the assessor's living area, year built, storeys, the
// footprint, the elevation, the county's design day (lib/hvac/siteLookup, behind the website's brakes and the shop's
// cap) — confirmed by the homeowner; then the load and the shop's three tiers, each priced; they pick one.

export interface WebHouse {
  livingSqft: number | null;
  storeys: number | null;
  yearBuilt: number | null;
  footprintSqft: number | null;
  elevationFt: number | null;
  county: string | null;
  state: string;
  sources: Record<string, string>;
  warnings: string[];
}

export async function webHvacLookup(slug: unknown, raw: unknown): Promise<{ ok: true; token: string; house: WebHouse } | (Fail & { code?: string })> {
  const r = await liveShop(slug, "hvac");
  if ("ok" in r) return r;
  const { shop } = r;
  const ip = await clientIp();
  const braked = (await brake(`web-hvac-ip:${ip}`, 6, 10 * MINUTE, "house lookups")) ?? (await brake(`web-est-shop:${shop.id}`, shopHourly(shop).estimates, HOUR, "estimates"));
  if (braked) return { ok: false, error: braked, code: "braked" };
  if (await webCapReached(shop)) return { ok: false, error: "This estimator has had a busy month and is resting. Leave your details and the shop will size it by hand.", code: "capped" };
  const input = cleanInput(raw);
  if (!input) return { ok: false, error: "Type the address of the house.", code: "address" };
  await noteRequestOrg(shop.id).catch(() => {});
  const a = input.address;
  const address = [a.address, a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const trial = await takeTrialCap(shop.id, "hvacLookups", { dedupe: `hvac:${address.toLowerCase().replace(/\s+/g, " ")}` }).catch(() => ({ ok: true as const }));
  if (!trial.ok) return { ok: false, error: "This estimator is resting for now. Leave your details and the shop will size it in person.", code: "capped" };
  const looked = await lookupSiteFacts({ address, state: a.state || undefined, ...(a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : {}) }, shop.id);
  if (!looked.ok) return { ok: false, error: "We couldn't find that address. Check the street, the city and the state.", code: "address" };
  const f = looked.facts;
  if (!f.state) f.state = a.state || shop.state || "";
  const rec = await storeWebHvac(shop.id, a, f);
  return {
    ok: true,
    token: rec.token,
    house: { livingSqft: f.livingSqft ?? null, storeys: f.storeys ?? null, yearBuilt: f.yearBuilt ?? null, footprintSqft: f.footprintSqft ? Math.round(f.footprintSqft) : null, elevationFt: f.elevationFt ?? null, county: f.county ?? null, state: f.state, sources: { ...(f.sources as Record<string, string>) }, warnings: looked.warnings },
  };
}

export interface WebHvacSizedView {
  load: { heatingBtuh: number; coolingTotalBtuh: number; coolingTons: number };
  design: { heatingF: number; coolingF: number; county: string };
  outdoorKind: "heat-pump" | "air-conditioner";
  summary: string;
  tiers: Array<{ tier: "value" | "mid" | "premium"; label: string; unit: string; words: string }>;
}

export async function webHvacSize(slug: unknown, token: unknown, raw: unknown): Promise<{ ok: true; sized: WebHvacSizedView } | (Fail & { code?: string })> {
  const r = await liveShop(slug, "hvac");
  if ("ok" in r) return r;
  const { shop } = r;
  if (typeof token !== "string") return { ok: false, error: "Look up the house first.", code: "input" };
  const rec = await readWebHvac(token, shop.id);
  if (!rec) return { ok: false, error: "That lookup has aged out — look up the house again.", code: "input" };
  const ip = await clientIp();
  const braked = await brake(`web-est-ip:${ip}`, 12, 10 * MINUTE, "estimates");
  if (braked) return { ok: false, error: braked, code: "braked" };
  const input = cleanInput({ address: rec.address, ...(raw && typeof raw === "object" ? raw : {}) });
  const ans = input?.answers ?? {};
  const num = (v: unknown, lo: number, hi: number, fb: number | undefined) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.min(hi, Math.max(lo, Math.round(x))) : fb; };
  const site = { ...rec.site, livingSqft: num(ans.sqft, 400, 8000, rec.site.livingSqft), storeys: num(ans.storeys, 1, 3, rec.site.storeys ?? 1), yearBuilt: num(ans.year, 1850, 2030, rec.site.yearBuilt ?? 1995) };
  const parts = { city: rec.address.city || null, state: rec.address.state || site.state || null, zip: rec.address.zip || null };
  const sized = await sizeWebHvac(shop, site, parts, ans, input?.choice ?? null);
  if (!sized.ok) return { ok: false, error: sized.error, code: sized.code };
  await updateWebHvac({ ...rec, site, sized });
  const ts = shop.settings.trades.hvac;
  const words = (cents: number) => { const b = priceBand(cents, ts.show, ts.spread); return ts.show === "exact" ? money(b.low) : bandWords(b); };
  return { ok: true, sized: { load: sized.load, design: sized.design, outdoorKind: sized.outdoorKind, summary: sized.tiers[0].summary, tiers: sized.tiers.map((t) => ({ tier: t.tier, label: t.label, unit: t.unit, words: words(t.cents) })) } };
}

export async function webHvacPrice(slug: unknown, token: unknown, tier: unknown): Promise<{ ok: true; estimate: WebEstimateView } | (Fail & { code?: string })> {
  const r = await liveShop(slug, "hvac");
  if ("ok" in r) return r;
  const { shop } = r;
  if (typeof token !== "string") return { ok: false, error: "Size the system first.", code: "input" };
  const rec = await readWebHvac(token, shop.id);
  if (!rec || !rec.sized) return { ok: false, error: "Size the system first.", code: "input" };
  const t = rec.sized.tiers.find((x) => x.tier === tier) ?? rec.sized.tiers.find((x) => x.tier === "mid") ?? rec.sized.tiers[0];
  const ts = shop.settings.trades.hvac;
  const band = priceBand(t.cents, ts.show, ts.spread);
  const est = await storeWebEstimate({ organizationId: shop.id, trade: "hvac", address: rec.address.address.trim(), city: rec.sized.city, state: rec.sized.state, zip: rec.sized.zip, summary: t.summary, choice: t.choice, cents: t.cents, band, show: ts.show, facts: t.facts });
  await bumpWebCount(shop.id, "estimates").catch(() => {});
  return { ok: true, estimate: { token: est.token, summary: t.summary, choice: t.choice, band, show: ts.show, basis: ts.note || WEB_TRADE.hvac.basis, askEmail: ts.askEmail } };
}

// ── FENCE STUDIO ON THE WEBSITE (2026-10-28): the pin for a typed address, the lot lines and the buildings around it
// (lib/fence/boundaryLookup, behind the website's brakes and the shop's caps), and the price of what they drew.

export async function webGeocode(slug: unknown, address: unknown): Promise<{ ok: true; lat: number; lng: number; formatted: string | null } | Fail> {
  const r = await liveShop(slug, "fence");
  if ("ok" in r) return r;
  if (typeof address !== "string" || address.trim().length < 5) return { ok: false, error: "Type the street address." };
  const braked = await brake(`web-geo-ip:${await clientIp()}`, 20, 10 * MINUTE, "lookups");
  if (braked) return { ok: false, error: braked };
  const g = await geocodePlace(address.trim().slice(0, 200)).catch(() => null);
  if (!g) return { ok: false, error: "We couldn't find that address. Check the street and the city." };
  return { ok: true, lat: g.lat, lng: g.lng, formatted: g.formatted ?? null };
}

export interface WebLot { ring: Array<{ lat: number; lng: number }> | null; buildings: Array<{ ring: Array<{ lat: number; lng: number }>; heightFt: number }>; note: string | null }

export async function webFenceLot(slug: unknown, lat: unknown, lng: unknown): Promise<{ ok: true; lot: WebLot } | (Fail & { code?: string })> {
  const r = await liveShop(slug, "fence");
  if ("ok" in r) return r;
  const { shop } = r;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "Find the address first." };
  const braked = (await brake(`web-lot-ip:${await clientIp()}`, 6, 10 * MINUTE, "lot lookups")) ?? (await brake(`web-est-shop:${shop.id}`, shopHourly(shop).estimates, HOUR, "estimates"));
  if (braked) return { ok: false, error: braked, code: "braked" };
  if (await webCapReached(shop)) return { ok: false, error: "This estimator has had a busy month and is resting.", code: "capped" };
  const trial = await takeTrialCap(shop.id, "fenceLookups", { dedupe: trialPointKey(lat, lng), coveredBy: ["hvacLookups", "roofMeasurements"] }).catch(() => ({ ok: true as const }));
  if (!trial.ok) return { ok: false, error: "This estimator is resting for now — draw the fence by hand, or type the feet.", code: "capped" };
  await noteRequestOrg(shop.id).catch(() => {});
  const res = await lookupPropertyBoundary(lat, lng).catch(() => null);
  if (!res) return { ok: true, lot: { ring: null, buildings: [], note: "The lot lines didn't come back — draw the fence by hand." } };
  const buildings = res.buildings.map((b) => ({ ring: b.ring, heightFt: b.heightFt }));
  if (!res.ok) return { ok: true, lot: { ring: null, buildings, note: /REPORTALL_CLIENT_KEY/.test(res.error) ? "Lot lines aren't on for this area — draw the fence by hand." : res.error } };
  return { ok: true, lot: { ring: res.ring, buildings, note: null } };
}

export async function webFencePrice(slug: unknown, raw: unknown): Promise<{ ok: true; estimate: WebEstimateView } | (Fail & { code?: string })> {
  const r = await liveShop(slug, "fence");
  if ("ok" in r) return r;
  const { shop } = r;
  const ip = await clientIp();
  const braked = (await brake(`web-est-ip:${ip}`, 12, 10 * MINUTE, "estimates")) ?? (await brake(`web-est-shop:${shop.id}`, shopHourly(shop).estimates, HOUR, "estimates"));
  if (braked) return { ok: false, error: braked, code: "braked" };
  if (await webCapReached(shop)) return { ok: false, error: "This estimator has had a busy month and is resting. Leave your details and the shop will price it by hand.", code: "capped" };
  const input = cleanInput(raw);
  if (!input) return { ok: false, error: "Type the address of the house.", code: "address" };
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const runsFt = Array.isArray(o.runsFt) ? o.runsFt.map(Number).filter((n) => Number.isFinite(n) && n > 0 && n < 5000).slice(0, 60) : [];
  const n = (v: unknown, fb: number) => { const x = Number(v); return Number.isFinite(x) ? x : fb; };
  const drawn = { address: input.address, runsFt, type: typeof o.type === "string" ? o.type.slice(0, 60) : "", heightFt: n(o.heightFt, 6), gates: n(o.gates, 0), doubles: n(o.doubles, 0), drawn: Array.isArray(o.points) && o.points.length >= 2 };
  await noteRequestOrg(shop.id).catch(() => {});
  const out = await priceWebFenceDrawn(shop, drawn);
  if (!out.ok) return { ok: false, error: out.error, code: out.code };
  const ts = shop.settings.trades.fence;
  const band = priceBand(out.cents, ts.show, ts.spread);
  const points = Array.isArray(o.points) ? o.points.slice(0, 200) : null;
  const est = await storeWebEstimate({ organizationId: shop.id, trade: "fence", address: input.address.address.trim(), city: out.city, state: out.state, zip: out.zip, summary: out.summary, choice: out.choice, cents: out.cents, band, show: ts.show, facts: { ...out.facts, points, pin: input.address.lat != null && input.address.lng != null ? { lat: input.address.lat, lng: input.address.lng } : null } });
  await bumpWebCount(shop.id, "estimates").catch(() => {});
  return { ok: true, estimate: { token: est.token, summary: out.summary, choice: out.choice, band, show: ts.show, basis: ts.note || WEB_TRADE.fence.basis, askEmail: ts.askEmail } };
}

function cleanInput(raw: unknown): { address: WebAddress; choice: string | null; answers: Record<string, string | number> } | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const a = (r.address && typeof r.address === "object" ? r.address : {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const typed = splitTypedAddress({ address: s(a.address, 200), city: s(a.city, 80), state: s(a.state, 2).toUpperCase(), zip: s(a.zip, 10) });
  const address: WebAddress = { ...typed, lat: typeof a.lat === "number" && Number.isFinite(a.lat) ? a.lat : null, lng: typeof a.lng === "number" && Number.isFinite(a.lng) ? a.lng : null };
  if (address.address.length < 5) return null;
  const choice = typeof r.choice === "string" && r.choice.length <= 60 ? r.choice : null;
  const answers: Record<string, string | number> = {};
  const src = (r.answers && typeof r.answers === "object" ? r.answers : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(src).slice(0, 20)) { if (/^[a-z]{1,20}$/.test(k) && (typeof v === "number" || (typeof v === "string" && v.length <= 40))) answers[k] = v; }
  return { address, choice, answers };
}

/** "Get my full quote": the lead for the shop, a confirmation for the homeowner. */
export async function webLead(slug: unknown, trade: unknown, token: unknown, raw: unknown): Promise<{ ok: true; leadId: string; next?: string } | Fail> {
  const r = await liveShop(slug, trade);
  if ("ok" in r) return r;
  const { shop } = r;
  const ip = await clientIp();
  const braked = (await brake(`web-lead-ip:${ip}`, 6, 10 * MINUTE, "requests")) ?? (await brake(`web-lead-shop:${shop.id}`, shopHourly(shop).leads, HOUR, "requests"));
  if (braked) return { ok: false, error: braked };
  // No token (null): a request with no price — the estimator resting for the month, or no read of this house. The
  // form stays live; the lead carries the address and says no price was shown (lib/webEstimatorServer).
  const unpriced = token === null && !isHouse(shop);
  const est = typeof token === "string" ? await readWebEstimate(token, shop.id) : null;
  if (!est && !unpriced) return { ok: false, error: "That estimate has expired — run it again, it only takes a moment." };
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = s(c.name, 80), phone = s(c.phone, 40), email = s(c.email, 120) || null, note = s(c.note, 500) || null;
  if (name.length < 2) return { ok: false, error: "Your name, please." };
  if (phone.replace(/\D/g, "").length < 10) return { ok: false, error: "A phone number with the area code, please." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email doesn't look right." };
  if (c.consent !== true) return { ok: false, error: isHouse(shop) ? `Tick the box so ${PRO} may contact you.` : "Tick the box so the shop may contact you." };
  if (typeof c.company === "string" && c.company.trim()) return { ok: true, leadId: "ok" };   // the honeypot: a bot filled the hidden field
  if (!est) {
    const where = cleanInput(c);
    if (!where) return { ok: false, error: "The address of the house, please." };
    const why = (await webCapReached(shop)) ? "resting" : "unpriced";
    const a = where.address;
    const { leadId } = await createWebLeadUnpriced(shop, r.trade, { address: a.address, city: a.city || null, state: a.state || null, zip: a.zip || null }, { name, phone, email, note }, why);
    return { ok: true, leadId };
  }
  if (isHouse(shop)) {
    // THE HOUSE (2026-10-28): a Lead Center lead with the estimate beside it; the request page next.
    if (!email) return { ok: false, error: "Your email, please — your request page and your dashboard are sent there." };
    const r = await createHouseLead(shop, est, { name, phone, email, note }, { ip, page: `/homeowner/price/${est.trade}` });
    return { ok: true, leadId: r.platformLeadId, next: r.next };
  }
  const { leadId } = await createWebLead(shop, est, { name, phone, email, note });
  return { ok: true, leadId };
}

// ── DECK STUDIO ON THE WEBSITE (2026-10-28): the homeowner designs in 3D in the client designer, through a link the
// website makes for them (lib/deck/clientDesign `web`); the price at the end is the shop's book on what they designed;
// "Get my full quote" sends the design (the studio's draft, the bell) AND makes the lead.

const WEB_DECK_DAYS = 30;

export interface WebDeckProps {
  token: string;
  shop: { name: string; logoUrl: string | null; phone: string | null };
  address: string;
  base: DeckDesign;
  work: DeckDesign | null;
  note: string;
  sentAt: string | null;
  leadId: string | null;
  basis: string;
  askEmail: boolean;
}

function deckLinkProps(link: ClientDesignLink, shop: WebShop): WebDeckProps {
  const ts = shop.settings.trades.deck;
  return {
    token: link.token,
    shop: { name: shop.name, logoUrl: shop.logoUrl, phone: shop.phone },
    address: link.address ?? "",
    base: link.base,
    work: link.work,
    note: link.note,
    sentAt: link.sentAt,
    leadId: link.web?.leadId ?? null,
    basis: ts.note || WEB_TRADE.deck.basis,
    askEmail: ts.askEmail,
  };
}

/** The visitor typed where the deck goes: a link of their own, a blank deck on that site. */
export async function webDeckStart(slug: unknown, rawAddress: unknown): Promise<{ ok: true; props: WebDeckProps } | (Fail & { code?: string })> {
  if (typeof slug !== "string" || typeof rawAddress !== "string") return { ok: false, error: "Something went wrong — try again." };
  const shop = await webShopBySlug(slug);
  if (!shop || !(await webShopServes(shop, "deck"))) return { ok: false, error: "This estimator isn't turned on." };
  try {
    await enforceRateLimit(`web-deck-start:${await clientIp()}`, 8, HOUR, "new designs");
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: "That is a lot of new designs from here. Try again in a while." };
    throw err;
  }
  if (await webCapReached(shop)) return { ok: false, code: "capped", error: "This estimator is resting for the month. Leave your details and the shop will price it by hand." };
  const typed = splitTypedAddress({ address: rawAddress.trim().slice(0, 200), city: "", state: "", zip: "" });
  const address = [typed.address, typed.city, [typed.state, typed.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (address.length < 5) return { ok: false, error: "Type the street address." };
  const now = new Date();
  const link: ClientDesignLink = {
    v: 1, token: randomBytes(18).toString("base64url"), orgId: shop.id, createdBy: null, createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + WEB_DECK_DAYS * 24 * 3600 * 1000).toISOString(),
    clientName: "", clientPhone: null, clientEmail: null, clientId: null, address, title: "From the website", titleAuto: true,
    start: "blank", base: webDeckBase(shop, address), work: null, workAt: null, openedAt: now.toISOString(), note: "", unsure: [],
    status: "open", sentAt: null, sends: 0, draftId: null, proposalId: null, byName: "Website", seenAt: null, pricedAt: null,
    web: { slug: shop.slug, leadId: null, priced: false },
  };
  await writeWebClientLink(link);
  noteRequestOrg(shop.id);
  return { ok: true, props: deckLinkProps(link, shop) };
}

/** Back on the page later (the token is kept in their browser): the same design, where they left it. */
export async function webDeckResume(slug: unknown, token: unknown): Promise<{ ok: true; props: WebDeckProps } | Fail> {
  if (typeof slug !== "string" || typeof token !== "string" || !CLIENT_TOKEN_RE.test(token)) return { ok: false, error: "No such design." };
  const link = await readWebClientLink(token);
  if (!link || link.web?.slug !== slug) return { ok: false, error: "No such design." };
  const shop = await webShopBySlug(slug);
  if (!shop || shop.id !== link.orgId || !(await webShopServes(shop, "deck"))) return { ok: false, error: "This estimator isn't turned on." };
  return { ok: true, props: deckLinkProps(link, shop) };
}

/** THE PRICE AT THE END: what they designed, settled to code and priced in the shop's book, shown the shop's way. */
export async function webDeckPrice(token: unknown, raw: unknown): Promise<{ ok: true; words: string; summary: string; show: "range" | "exact"; basis: string } | Fail> {
  if (typeof token !== "string" || !CLIENT_TOKEN_RE.test(token)) return { ok: false, error: "No such design." };
  const link = await readWebClientLink(token);
  if (!link || !link.web) return { ok: false, error: "This design link has closed." };
  try {
    await enforceRateLimit(`web-deck-price:${token}`, 60, HOUR, "prices");
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: "That is a lot of prices in an hour. Try again in a while." };
    throw err;
  }
  const shop = await webShopBySlug(link.web.slug);
  if (!shop || shop.id !== link.orgId) return { ok: false, error: "This estimator isn't turned on." };
  const ts = shop.settings.trades.deck;
  const merged = mergeClientDesign(link.base, raw);
  const priced = await priceWebDeckDesign(shop, merged, link.address ?? "");
  const band = priceBand(priced.cents, ts.show, ts.spread);
  if (!link.web.priced) {
    await writeWebClientLink({ ...link, web: { ...link.web, priced: true } });
    await bumpWebCount(shop.id, "estimates");
  }
  return { ok: true, words: ts.show === "exact" ? money(band.low) : bandWords(band), summary: priced.summary, show: ts.show, basis: ts.note || WEB_TRADE.deck.basis };
}

/** "GET MY FULL QUOTE": the design goes to the shop as a studio draft (the bell rings), the lead is made with the
 *  price they saw, the homeowner gets the confirmation, and the link joins the shop's client designs. */
export async function webDeckSend(token: unknown, raw: unknown): Promise<{ ok: true; at: string; leadId: string; next?: string } | Fail> {
  if (typeof token !== "string" || !CLIENT_TOKEN_RE.test(token)) return { ok: false, error: "No such design." };
  const link = await readWebClientLink(token);
  if (!link || !link.web) return { ok: false, error: "This design link has closed." };
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  if (str(r.company, 80)) return { ok: true, at: new Date().toISOString(), leadId: "" }; // the honeypot: a bot filled it
  const name = str(r.name, 80), phone = str(r.phone, 40), email = str(r.email, 200).toLowerCase(), note = str(r.note, 1500);
  if (name.length < 2) return { ok: false, error: "Your name, please." };
  if (phone.replace(/\D/g, "").length < 10) return { ok: false, error: "A phone number we can reach you at, please." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };
  try {
    await enforceRateLimit(`web-lead:${await clientIp()}`, 6, 10 * MINUTE, "requests");
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: "That is a lot of requests from here. Try again in a few minutes." };
    throw err;
  }
  const shop = await webShopBySlug(link.web.slug);
  if (!shop || shop.id !== link.orgId) return { ok: false, error: "This estimator isn't turned on." };
  if (r.consent !== true) return { ok: false, error: isHouse(shop) ? `Tick the box so ${PRO} may contact you.` : "Tick the box so the shop may contact you." };
  // The shop's (or the house's) hourly ceiling on leads, as webLead has it.
  const shopBraked = await brake(`web-lead-shop:${shop.id}`, shopHourly(shop).leads, HOUR, "requests");
  if (shopBraked) return { ok: false, error: shopBraked };
  // The house (2026-10-28) needs the email before anything is made: the request page and the dashboard hang off it.
  if (isHouse(shop) && !email) return { ok: false, error: "Your email, please — your request page and your dashboard are sent there." };
  if (link.web.leadId) {
    // Sent before: the design goes again to the same draft; the lead already exists.
    const again = await sendDeckClientDesign(token, { design: r.design, note, name, phone });
    return again.ok ? { ok: true, at: again.at, leadId: link.web.leadId } : again;
  }
  const sent = await sendDeckClientDesign(token, { design: r.design, note, name, phone });
  if (!sent.ok) return sent;
  const after = (await readWebClientLink(token)) ?? link;
  const ts = shop.settings.trades.deck;
  const design = normalizeDeckDesign(after.work ?? r.design);
  const priced = await priceWebDeckDesign(shop, design, link.address ?? "");
  const band = priceBand(priced.cents, ts.show, ts.spread);
  const typed = splitTypedAddress({ address: link.address ?? "", city: "", state: "", zip: "" });
  const est = await storeWebEstimate({
    organizationId: shop.id, trade: "deck", address: typed.address, city: typed.city || null, state: typed.state || null, zip: typed.zip || null,
    summary: priced.summary, choice: priced.choice, cents: priced.cents, band, show: ts.show,
    facts: { design: priced.design, draftId: after.draftId, token, areaSqFt: priced.areaSqFt, pricePerSqFt: priced.pricePerSqFt, designedOnline: true },
  });
  if (isHouse(shop)) {
    // THE HOUSE: a Lead Center lead with the design and the price beside it; the link files under the house org's
    // client designs with the platform lead's id; the homeowner goes to their request page.
    const r = await createHouseLead(shop, est, { name, phone, email, note: note || null }, { ip: await clientIp(), page: "/homeowner/price/deck" });
    await fileWebClientLink(token, { leadId: r.platformLeadId, clientEmail: email }).catch((err) => console.warn("[web-deck] link not filed:", err));
    return { ok: true, at: sent.at, leadId: r.platformLeadId, next: r.next };
  }
  const { leadId } = await createWebLead(shop, est, { name, phone, email: email || null, note: note || null });
  await fileWebClientLink(token, { leadId, clientEmail: email || null }).catch((err) => console.warn("[web-deck] link not filed:", err));
  return { ok: true, at: sent.at, leadId };
}

/** Why this page is off, for the shop's OWN people when signed in (null for everyone else — they get the 404). */
export async function webPageOffReason(slug: string, trade: string): Promise<{ title: string; text: string } | null> {
  let ctx;
  try { ctx = await requireOrg(); } catch { return null; }
  const org = await db.organization.findUnique({ where: { id: ctx.organizationId }, select: { slug: true } });
  if (!org || org.slug !== slug) return null;
  if (!isWebTrade(trade)) return { title: "No such estimator.", text: "The address ends in roof, hvac, fence or deck." };
  const name = tradeLabel(trade);
  const [settings, open] = await Promise.all([readWebSettings(ctx.organizationId), webEstimatorOpen()]);
  if (!settings.trades[trade].on) return { title: `The ${name} is off on your website.`, text: `Turn it on under Settings → Website estimators and press Save — then this page answers. Only you see this note; a homeowner would see a plain "not found".` };
  if (open) {
    const b = await webBilling(ctx.organizationId, open);
    if (!webTradeServes({ open, on: true, mode: b.mode, held: !!b.held[trade] })) {
      return { title: `The ${name} is on, but not on your plan.`, text: b.mode === "free" ? "Website estimators go on a paid plan. Pick a plan on Subscription, then turn the trade on again and Save." : b.mode === "offline" ? "Your plan isn't billed to a card here. Write to us from Help and we'll add it." : "Its line isn't on your subscription. Open Settings → Website estimators and press Save to add it." };
    }
  }
  return { title: `The ${name} is on.`, text: "If this page still says not found, press Save on Settings → Website estimators once more." };
}

// ── what the public page needs to draw (server component helper, not an action-only export)

export async function webPageModel(slug: string, trade: string, host: string | null) {
  if (!isWebTrade(trade)) return null;
  const shop = await webShopBySlug(slug);
  if (!shop || !(await webShopServes(shop, trade))) return null;
  const base = await appBaseUrl();
  let appHost: string | null = null;
  try { appHost = new URL(base).host; } catch { appHost = null; }
  return {
    shop: { name: shop.name, slug: shop.slug, logoUrl: shop.logoUrl, primaryColor: shop.primaryColor, phone: shop.phone, website: shop.website, house: isHouse(shop) },
    trade,
    title: WEB_TRADE[trade].title,
    basis: shop.settings.trades[trade].note || WEB_TRADE[trade].basis,
    askEmail: shop.settings.trades[trade].askEmail,
    choices: trade === "roof" ? webRoofChoices(shop, null) : webTradeChoices(shop, trade),
    questions: webTradeQuestions(trade) as WebQuestion[],
    hostOk: hostAllowed(shop.settings.domains, host, appHost),
    snippets: embedSnippets(base, shop.slug, trade, shop.primaryColor),
  };
}
