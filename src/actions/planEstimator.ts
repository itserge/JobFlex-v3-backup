"use server";
// BLUEPRINTS — the server half of Smart Proposal's plan reader (lib/plans).
//
//   startPlanSession  the gates of an estimate run, the trial cap taken ONCE for the
//                     whole plan set, and a signed pass the sheet reads and the trade
//                     estimates carry after it (lib/plans/planToken)
//   readPlanSheet     one sheet — its picture, close-up tiles of a scan, and its text
//                     layer — read by the vision model into a SheetRead
//   getPlanPriceChecks the builder price book's ranges for the house and its trades
//                     (no model call), for the notes under the ledger
//   askPlan           the contractor's request ("granite countertops") made into a job:
//                     the build-list lines it takes, what to measure on which sheets, the
//                     specialty that prices it (lib/plans/ask)
//   measurePlanSheet  one sheet looked at again for exactly what the job measures
//   skimPlanSheet     a first look at a sheet — what kind it is, from its title block —
//                     so the set is read in the order jobs need it (lib/plans/readOrder)
//
// Pricing a trade is the Smart estimate's own pipeline: advancedEstimator.pricePlanTrade.
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { requirePage } from "@/lib/customPageAccess";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { PLAN_LIMIT_MESSAGE, type LimitKey } from "@/lib/planLimits";
import { takeTrialCap } from "@/lib/trialMeter";
import { friendlyAIError, getOpenAI, getVisionModel, isOpenAIEnabled, isTransientAIError, samplingOptions } from "@/lib/sdk/openai";
import { issuePlanPass, readPlanPass } from "@/lib/plans/planToken";
import { PLAN_READ_SYSTEM, planReadPrompt } from "@/lib/plans/readPrompt";
import { cleanSheetRead, type SheetRead } from "@/lib/plans/sheet";
import { planPriceChecks, type PriceChecks } from "@/lib/plans/priceChecks";
import { askPlanInput, MAX_SHEET_IMAGE_CHARS, measureSheetInput, planHvacInput, priceChecksInput, sheetReadInput, skimSheetInput } from "@/lib/plans/wire";
import { planHvacLoad, type PlanPlace } from "@/lib/plans/hvacLoad";
import type { PlanHvacLoad } from "@/lib/plans/hvacEnvelope";
import { cleanSkim, SKIM_SYSTEM, skimPrompt, type SheetSkim } from "@/lib/plans/readOrder";
import { ASK_SYSTEM, askPlanPrompt, cleanFocus, cleanScope, FOCUS_SYSTEM, focusPrompt, scopeByRules, scopeExtras, unitWord, type FocusRead, type JobScope, type MeasureAsk } from "@/lib/plans/ask";
import { houseFacts } from "@/lib/plans/tradeBrief";
import { BUILD_SPECIALTIES, isBuildSpecialty, scopeBySpecialty, settleSpecialties } from "@/lib/plans/specialties";
import type { TakeoffItem } from "@/lib/plans/takeoff";

type Fail = { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: LimitKey };

const EXPIRED = "This blueprint session has expired — open the plans again.";

/**
 * Open a plan set: the same gates as an estimate run, and the one trial cap use the
 * whole set costs. Nothing is read yet — the browser has the pages.
 */
export async function startPlanSession(): Promise<{ ok: true; token: string } | Fail> {
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
    // The blueprint estimator, and the HVAC estimator's "from the plans" (2026-10-18): either page opens a session.
    // "blueprint-estimator" is Smart Proposal's page on a Classic plan (lib/customPlan classicEquivalent).
    await requirePage(organizationId, ["blueprint-estimator", "hvac-estimator"]);
    await enforceRateLimit(`ai-plans:${organizationId}`, 12, HOUR, "blueprint runs");
    const { requireFeatureOrThrow } = await import("@/lib/entitlements");
    const { getOrgPlanById } = await import("@/lib/orgPlan");
    requireFeatureOrThrow(await getOrgPlanById(organizationId), "advanced_estimator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upgrade required" };
  }
  // The same monthly budget an estimate run is held to (saved estimates).
  const quota = await checkPlanLimit(organizationId, "estimatorUses");
  if (!quota.allowed) return { ok: false, error: PLAN_LIMIT_MESSAGE, code: "PLAN_LIMIT_REACHED", resource: quota.cappedBy ?? "estimatorUses" };
  if (!isOpenAIEnabled()) return { ok: false, error: "Reading blueprints needs the estimator's AI service, which is not set up on this workspace." };
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return trial.failure;
  try {
    return { ok: true, token: issuePlanPass(organizationId).token };
  } catch (err) {
    await trial.refund();
    return { ok: false, error: err instanceof Error ? err.message : "Could not open the plans." };
  }
}

/** The model's reply as an object: plain JSON, or the first {...} in a chatty one. */
function replyObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(text.slice(a, b + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}

/**
 * Read one sheet. The picture goes at high detail — a plan's dimension strings are
 * eighth-inch text — with the sheet's own text layer, which a CAD export carries and
 * the model is told to trust over the pixels. The answer is cleaned into a SheetRead
 * (lib/plans/sheet), which never throws: a sheet the model misread is an empty one.
 */
export async function readPlanSheet(raw: unknown): Promise<{ ok: true; sheet: SheetRead } | Fail> {
  const parsed = sheetReadInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "This sheet could not be sent — read it again." };
  const input = parsed.data;
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign in again." };
  }
  const pass = readPlanPass(input.token, organizationId);
  if (!pass) return { ok: false, error: EXPIRED };
  if (input.images.reduce((n, i) => n + i.url.length, 0) > MAX_SHEET_IMAGE_CHARS) return { ok: false, error: "This sheet's pictures are too large to send." };
  try {
    // A 60-sheet set read once, with room to re-read the few that fail.
    await enforceRateLimit(`plan-read:${pass.nonce}`, 75, 6 * HOUR, "sheet reads");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many sheet reads." };
  }

  const client = getOpenAI();
  const model = getVisionModel();
  const content = [
    { type: "text" as const, text: planReadPrompt({ page: input.page, pages: input.pages, textLayer: input.textLayer, tiles: input.images.length - 1, grid: input.grid ?? null, fileName: input.fileName }) },
    ...input.images.map((i) => ({ type: "image_url" as const, image_url: { url: i.url, detail: "high" as const } })),
  ];
  // Temperature 0: the same sheet reads the same way twice (a reasoning model takes none).
  const sampling = await samplingOptions(0);
  const ask = () =>
    client.chat.completions.create(
      {
        model,
        ...sampling,
        messages: [
          { role: "system", content: PLAN_READ_SYSTEM },
          { role: "user", content },
        ],
        response_format: { type: "json_object" },
      },
      { maxRetries: 0 },
    );
  try {
    let completion: Awaited<ReturnType<typeof ask>>;
    try {
      completion = await ask();
    } catch (err) {
      // 429 and 5xx mean "not now": one wait, one more try.
      if (!isTransientAIError(err)) throw err;
      await new Promise((r) => setTimeout(r, 3_000));
      completion = await ask();
    }
    const sheet = cleanSheetRead(input.page, replyObject(completion.choices[0]?.message?.content ?? "{}"));
    console.info(
      `[planEstimator] sheet ${input.page}/${input.pages} · ${sheet.kind} "${sheet.title ?? ""}" · rooms ${sheet.rooms.length} · windows ${sheet.windows.length} · doors ${sheet.doors.length} · ${sheet.confidence} · model=${model} text=${input.textLayer.length}ch images=${input.images.length}`,
    );
    return { ok: true, sheet };
  } catch (err) {
    console.warn(`[planEstimator] sheet ${input.page} failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: friendlyAIError(err, "reading this sheet") };
  }
}

/** The builder price book's ranges for this house in its market (no model call). */
export async function getPlanPriceChecks(raw: unknown): Promise<{ ok: true; data: PriceChecks } | Fail> {
  const parsed = priceChecksInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The takeoff could not be read." };
  try {
    await requireEstimatorOrManager();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign in again." };
  }
  const { house, items, location } = parsed.data;
  return { ok: true, data: planPriceChecks(house, items, location) };
}

/** Where the job is, as the HVAC engine's design tables want it: the county (Census geocoder, then OpenStreetMap +
 *  the FCC block lookup), else the state named in the address, else nothing. Kept an hour per address. */
const placeCache = new Map<string, { at: number; place: PlanPlace | null }>();
async function placeOf(location: string): Promise<PlanPlace | null> {
  const key = location.trim().toLowerCase();
  if (!key) return null;
  const hit = placeCache.get(key);
  if (hit && Date.now() - hit.at < HOUR) return hit.place;
  const { censusGeocode, countyAtPoint, nominatimGeocode } = await import("@/lib/hvac/publicGeo");
  const { stateFromAddress } = await import("@/lib/pricing/salesTax");
  let place: PlanPlace | null = null;
  // A new house's lot is often not on any map yet ("Lot 12, …", a street still being built): the address, then the
  // town and ZIP after its first comma, then the ZIP alone — the county is what the design tables need.
  const tail = location.includes(",") ? location.slice(location.indexOf(",") + 1).trim() : "";
  const zip = location.match(/\b\d{5}\b/)?.[0] ?? "";
  const tries = Array.from(new Set([location, tail, zip ? `${zip}, USA` : ""].filter((x) => x.length >= 3)));
  for (const q of tries) {
    const census = await censusGeocode(q).catch(() => null);
    if (census?.state && census.county) {
      place = { state: census.state, county: census.county, lat: census.lat, lng: census.lng, label: `${census.county}, ${census.state}` };
      break;
    }
    const osm = await nominatimGeocode(q).catch(() => null);
    const at = osm ? await countyAtPoint(osm.lat, osm.lng).catch(() => null) : null;
    if (at) {
      place = { state: at.state, county: at.county, lat: osm?.lat, lng: osm?.lng, label: `${at.county}, ${at.state}` };
      break;
    }
  }
  if (!place) {
    const st = stateFromAddress(location);
    if (st) place = { state: st, county: null, label: st };
  }
  placeCache.set(key, { at: Date.now(), place });
  return place;
}

/** THE HEATING & COOLING LOAD FROM THE PLANS (owner, 2026-10-18: "make sure the blueprint estimator can estimate
 *  HVAC Manual J based"): the envelope the browser took out of the takeoff, the job's place → the HVAC engine's
 *  Manual J-style block load and the Manual S size (lib/plans/hvacLoad). No model call; the plan pass gates it. */
export async function planHvacLoadAction(raw: unknown): Promise<{ ok: true; load: PlanHvacLoad } | Fail> {
  const parsed = planHvacInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The plans' house could not be read for the load." };
  const input = parsed.data;
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign in again." };
  }
  const pass = readPlanPass(input.token, organizationId);
  if (!pass) return { ok: false, error: EXPIRED };
  try {
    await enforceRateLimit(`plan-hvac:${pass.nonce}`, 30, 6 * HOUR, "load calculations");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many load calculations." };
  }
  const where = (input.location ?? input.envelope.address ?? "").trim();
  const place = where ? await placeOf(where) : null;
  const { designConditionsFor } = await import("@/lib/hvac/designConditions");
  const lookup = designConditionsFor(place?.state ?? "", place?.county ?? null, place?.elevationFt ?? 0);
  const label = place?.label ?? (where || "location not given");
  try {
    return { ok: true, load: planHvacLoad(input.envelope, place ?? { state: "", county: null, label }, lookup.conditions, { match: place ? lookup.match : "none" }) };
  } catch (err) {
    console.warn("[plans] hvac load failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "The heating & cooling load could not be worked out from these plans." };
  }
}

/** One JSON answer from the vision model, with one patient retry on a rate limit or a 5xx. */
async function askJson(system: string, content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "high" | "low" } }>): Promise<unknown> {
  const client = getOpenAI();
  const model = getVisionModel();
  const sampling = await samplingOptions(0);
  const ask = () =>
    client.chat.completions.create(
      { model, ...sampling, messages: [{ role: "system", content: system }, { role: "user", content }], response_format: { type: "json_object" } },
      { maxRetries: 0 },
    );
  let completion: Awaited<ReturnType<typeof ask>>;
  try {
    completion = await ask();
  } catch (err) {
    if (!isTransientAIError(err)) throw err;
    await new Promise((r) => setTimeout(r, 3_000));
    completion = await ask();
  }
  return replyObject(completion.choices[0]?.message?.content ?? "{}");
}

/**
 * The contractor's request made into a job. The keyword reading (lib/plans/ask JOBS) is
 * the model's first guess and the answer when the model's plan is unusable; a request
 * neither can place comes back asking for the trade in other words.
 */
export async function askPlan(raw: unknown): Promise<{ ok: true; scope: JobScope; extra: TakeoffItem[] } | Fail> {
  const parsed = askPlanInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The request could not be sent — try again." };
  const input = parsed.data;
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign in again." };
  }
  const pass = readPlanPass(input.token, organizationId);
  if (!pass) return { ok: false, error: EXPIRED };
  try {
    await enforceRateLimit(`plan-ask:${pass.nonce}`, 40, 6 * HOUR, "requests on these plans");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many requests on these plans." };
  }
  const items = input.items as TakeoffItem[];
  const guess = scopeByRules(input.request, items, input.sheets);
  let scope: JobScope | null = null;
  // The whole house needs no planning: every line of the build list.
  if (guess?.wholeHouse) scope = guess;
  else {
    try {
      const answer = await askJson(ASK_SYSTEM, askPlanPrompt({ request: input.request, houseFacts: houseFacts(input.house), sheets: input.sheets, items, guess, specialties: BUILD_SPECIALTIES }));
      scope = cleanScope(answer, items, input.sheets, isBuildSpecialty);
    } catch (err) {
      console.warn(`[planEstimator] ask: the model's plan failed, the keyword reading stands: ${err instanceof Error ? err.message : String(err)}`);
    }
    // No model plan: the keyword reading; failing that, the specialty the words name,
    // measured on the sheets that show work of its kind.
    scope = scope ?? guess ?? scopeBySpecialty(input.request, input.sheets);
    if (scope) {
      const tradeOf = new Map(items.map((i) => [i.id, i.trade]));
      scope = settleSpecialties(scope, input.request, new Set(scope.itemIds.map((id) => tradeOf.get(id)).filter((t): t is NonNullable<typeof t> => !!t)));
    }
  }
  if (!scope) {
    return { ok: false, error: "I couldn't tell which work you mean. Name the trade or the finish — \"kitchen countertops\", \"drywall with texture\", \"roofing\", \"the whole house\"." };
  }
  console.info(`[planEstimator] ask «${input.request.slice(0, 80)}» → ${scope.title} (${scope.from}) · ${scope.itemIds.length} lines · measure ${scope.measure.map((m) => `${m.label}@${m.pages.join("+")}`).join(", ") || "nothing"} · priced by ${Object.entries(scope.specialties).map(([t, id]) => `${t}:${id}`).join(", ") || "each trade's own"}`);
  return { ok: true, scope, extra: scopeExtras(input.request, scope, items) };
}

/** One sheet looked at again for exactly what the job measures. */
export async function measurePlanSheet(raw: unknown): Promise<{ ok: true; read: FocusRead } | Fail> {
  const parsed = measureSheetInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "This sheet could not be sent — try again." };
  const input = parsed.data;
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign in again." };
  }
  const pass = readPlanPass(input.token, organizationId);
  if (!pass) return { ok: false, error: EXPIRED };
  if (input.images.reduce((n, i) => n + i.url.length, 0) > MAX_SHEET_IMAGE_CHARS) return { ok: false, error: "This sheet's pictures are too large to send." };
  try {
    await enforceRateLimit(`plan-measure:${pass.nonce}`, 120, 6 * HOUR, "sheet measurements");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many sheet measurements." };
  }
  const asks = input.asks.map((a) => ({ n: a.n, m: { label: a.label, unit: unitWord(a.unit) ?? "each", how: a.how } as MeasureAsk }));
  const text = focusPrompt({ request: input.request, title: input.title, page: input.page, pages: input.pages, sheetTitle: input.sheetTitle ?? null, asks, textLayer: input.textLayer, tiles: input.images.length - 1 });
  try {
    const answer = await askJson(FOCUS_SYSTEM, [{ type: "text", text }, ...input.images.map((i) => ({ type: "image_url" as const, image_url: { url: i.url, detail: "high" as const } }))]);
    const read = cleanFocus(input.page, answer, input.asks.map((a) => a.n));
    console.info(`[planEstimator] measure p.${input.page} · ${input.title} · found ${read.answers.map((a) => `#${a.n}=${a.qty} ${a.unit}`).join(", ") || "nothing"}${read.extra.length ? ` · extra ${read.extra.length}` : ""}`);
    return { ok: true, read };
  } catch (err) {
    console.warn(`[planEstimator] measure p.${input.page} failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: friendlyAIError(err, "measuring this sheet") };
  }
}

/**
 * A first look at a sheet: what kind of sheet it is, from its title block and a small
 * view — a few seconds, so the set can be read in the order a job needs it.
 */
export async function skimPlanSheet(raw: unknown): Promise<{ ok: true; skim: SheetSkim } | Fail> {
  const parsed = skimSheetInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "This sheet could not be sent." };
  const input = parsed.data;
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign in again." };
  }
  const pass = readPlanPass(input.token, organizationId);
  if (!pass) return { ok: false, error: EXPIRED };
  try {
    await enforceRateLimit(`plan-skim:${pass.nonce}`, 75, 6 * HOUR, "sheet looks");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many sheet looks." };
  }
  try {
    // The sheet small at low detail; its title block sharp.
    const answer = await askJson(SKIM_SYSTEM, [
      { type: "text", text: skimPrompt(input.page, input.pages, input.images.length) },
      ...input.images.map((i, k) => ({ type: "image_url" as const, image_url: { url: i.url, detail: k === 0 ? ("low" as const) : ("high" as const) } })),
    ]);
    return { ok: true, skim: cleanSkim(answer) };
  } catch (err) {
    return { ok: false, error: friendlyAIError(err, "looking at this sheet") };
  }
}
