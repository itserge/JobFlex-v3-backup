"use server";
import { MINUTE, RateLimitError, clientIp, enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { z } from "zod";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { clearFilingContext, readFilingContext } from "@/lib/filingContext";
import { friendlyAIError, getOpenAI, isOpenAIEnabled, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { checkPlanLimit, enforcePlanLimit } from "@/lib/limitsEngine";
import { PLAN_LIMIT_MESSAGE, type LimitKey } from "@/lib/planLimits";
import { resolveMarkupRates } from "@/lib/pricing/markup";
import { PRICING_RULES, UNIT_RULES } from "@/lib/estimate/master-prompt";
import { specialtyFor } from "@/lib/estimate/legacy-estimate";
import { costQuestionBlock, costQuestions } from "@/lib/estimate/intake-questions";
import { procedureFor } from "@/lib/estimate/procedures";
import { bindEstimateToBrief, keepCostCritical, readBrief } from "@/lib/estimate/brief";
import {
  estimateSchema,
  promptAnalysisSchema,
  type GeneratedEstimate,
  type PromptAnalysis,
} from "@/lib/estimatorSchema";
import { noteRequestOrg, takeTrialCap } from "@/lib/trialMeter";
import { bumpWebCount, storeWebEstimate, webCapReached, webShopBySlug, type WebShop } from "@/lib/webEstimatorServer";
import { webShopServes } from "@/lib/webAddonBilling";
import { WEB_TRADE, priceBand, shopHourly, splitTypedAddress } from "@/lib/webEstimator";
import type { WebEstimateView } from "@/actions/webEstimator";
import { requirePage } from "@/lib/customPageAccess";
import { readPlanPass } from "@/lib/plans/planToken";
import { planTradeRun } from "@/lib/plans/tradeSetup";
import { tradePriceInput } from "@/lib/plans/wire";
import { convertEstimateAs, convertInput, saveEstimateAs } from "@/lib/estimate/convertCore";
import { STUB, projectLine, runSmartEstimate, safePhotos, withPhotos, type EstimateRun, type GenerateInput, type SitePhoto } from "@/lib/estimate/smartRun";

/**
 * Quota gate for the AI *run* functions. Returned (not thrown) because these
 * actions signal errors via { ok: false } unions and thrown messages are
 * redacted in prod. Runs are capped by the same "estimatorUses" budget that
 * saveEstimate consumes (usage = saved AiEstimate rows).
 */
async function estimatorRunBlocked(
  organizationId: string,
): Promise<{ ok: false; error: string; code: "PLAN_LIMIT_REACHED"; resource: LimitKey } | null> {
  const quota = await checkPlanLimit(organizationId, "estimatorUses");
  if (quota.allowed) return null;
  return {
    ok: false,
    error: PLAN_LIMIT_MESSAGE,
    code: "PLAN_LIMIT_REACHED",
    // estimatorUses is capped by proposalsCreated (every estimate → a proposal),
    // so report whichever actually ran out.
    resource: quota.cappedBy ?? "estimatorUses",
  };
}

/**
 * Intake gate — runs BEFORE generation. Corrects the location and judges whether
 * the brief is descriptive enough for an accurate proposal. When it's thin, it
 * returns 3-8 targeted clarifying questions (scaled to how under-specified the
 * brief is). Never blocks: on any failure it returns enoughDetail=true.
 */
export async function analyzeEstimatePrompt(input: {
  projectType: string;
  description: string;
  location?: string;
  sqft?: number;
  /** Site photos as data/https URLs — a photo often answers a question the gate would otherwise ask. */
  photos?: SitePhoto[];
}): Promise<
  | { ok: true; data: PromptAnalysis }
  | { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: LimitKey }
> {
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
    await requirePage(organizationId, ["smart-proposal", "video-estimator"]);
    await enforceRateLimit(`ai:${organizationId}`, 60, HOUR, "AI runs");
    const { requireFeatureOrThrow } = await import("@/lib/entitlements");
    const { getOrgPlanById } = await import("@/lib/orgPlan");
    const plan = await getOrgPlanById(organizationId);
    requireFeatureOrThrow(plan, "advanced_estimator");
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Upgrade required" };
  }
  const blocked = await estimatorRunBlocked(organizationId);
  if (blocked) return blocked;

  if (!isOpenAIEnabled()) return { ok: true, data: analyzePassthrough(input) };
  // The card-less trial's AI ceiling (lib/trialMeter): one run, one use.
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return trial.failure;
  return analyzeBrief(input, trial.refund);
}

type AnalyzeInput = Parameters<typeof analyzeEstimatePrompt>[0];
const analyzePassthrough = (input: AnalyzeInput): PromptAnalysis => ({ correctedLocation: input.location?.trim() || null, enoughDetail: true, questions: [] });

/** THE INTAKE GATE ITSELF, gate-free (2026-10-28): the dashboard action above and the shop's website (webSmartAnalyze)
 *  both run it, each behind its own gate, brakes and caps. `refund` gives the trial's run back when the provider refused. */
async function analyzeBrief(input: AnalyzeInput, refund: () => Promise<void>): Promise<{ ok: true; data: PromptAnalysis }> {
  const passthrough = analyzePassthrough(input);
  const analyzePhotos = safePhotos(input.photos);
  const facts = readBrief(input.description, { sqft: input.sqft });
  // What to ask is decided here, not by the model: the job's own measure
  // (without it no range checks the price) and the conditional steps of this
  // trade's procedure, ranked by what each costs on this job
  // (lib/estimate/intake-questions). The model only puts them in words.
  const gateSpecialty = specialtyFor({ description: input.description, projectType: input.projectType }).specialty;
  const wanted = costQuestions(gateSpecialty.id, procedureFor(gateSpecialty.id), facts, input.location, { brief: input.description });
  const wantedBlock = costQuestionBlock(wanted);
  const stated = [
    facts.area ? `the area (${facts.area} sqft)` : "",
    facts.length ? `the run (${facts.length} linear ft)` : "",
    facts.sellPerUnit ? `the customer price ($${facts.sellPerUnit.amount} per ${facts.sellPerUnit.unit})` : "",
    facts.sellTotal ? `the job price ($${facts.sellTotal.amount})` : "",
  ].filter(Boolean);

  try {
    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      // The model this process may call (lib/sdk/openai), at temperature 0 with a seed (2026-10-21): this read
      // corrects the place the job is priced in and words the questions, so the same brief should read the same way
      // twice — at 0.2 the place could come back differently and move the city's price index.
      model: await resolveOpenAIModel(),
      ...(await samplingOptions(0, 42)),
      messages: [
        {
          role: "system",
          content:
            'You are a senior estimator\'s intake assistant. Return JSON ONLY matching: {"correctedLocation": string|null, "enoughDetail": boolean, "questions": [{"id": string, "question": string, "why": string, "kind": "select"|"number"|"text", "options"?: string[], "unit"?: string, "placeholder"?: string}]}. ' +
            "(1) correctedLocation: if a location is given, fix typos and normalize to \"City, ST\" (2-letter US state). If none or clearly not a place, null. " +
            "(2) The contractor's brief is the whole intake. Ask a question ONLY when its answer is critical to the cost — an existing condition the contractor cannot price without knowing, that adds a line or moves the job's price by roughly 10% or more: cracks, pits or spalling to repair; an old coating, sealer or floor to grind off or remove; a second layer of shingles; rotten decking or framing; a fence to tear out; rocky or sloped ground; drywall repairs before paint; lead or asbestos era; a panel with no room. " +
            "Never ask about preferences or logistics: color, pattern, brand, style, finish look, schedule, start date, access, parking, how they found you, or anything the brief already states. Never ask for a quantity, a system or a price the brief gives. " +
            "Most briefs need NO question: then enoughDetail=true and questions=[]. Ask at most 3, the most cost-critical first. Each question is one plain sentence a contractor answers in a tap, its `why` is one short clause saying how the answer moves the price ('crack repair adds prep time and epoxy patch'), and its options (2-4, kind 'select') always include the standard case first ('Bare, sound concrete') so the contractor can confirm the default. Use kind 'number' with a `unit` for a measurement, 'text' with a `placeholder` only when no options fit.",
        },
        {
          role: "user",
          content: withPhotos(
            `${projectLine(input.projectType)}
${input.location ? `Location: ${input.location}` : "Location: (none given)"}
${input.sqft ? `Approx size: ${input.sqft} sqft` : ""}
Description: ${input.description}${stated.length ? `\n\nThe brief already states ${stated.join(", ")} — do not ask about those.` : ""}${wantedBlock ? `\n\n${wantedBlock}` : ""}${
              analyzePhotos.length
                ? `\n\n${analyzePhotos.length} site photo(s) are attached. Read them before asking — a photo that shows the slab, the roof or the ground answers the condition question.`
                : ""
            }`,
            analyzePhotos,
          ),
        },
      ],
      response_format: { type: "json_object" },
    });
    const text = completion.choices[0]?.message?.content ?? "{}";
    const parsed = promptAnalysisSchema.parse(JSON.parse(text));
    // Only cost-critical questions survive (preferences and logistics are
    // dropped whatever the model said), at most three, and an option-less
    // "select" becomes "text" so the UI never renders an unanswerable one. If
    // "not enough" but zero questions came back, the brief is enough.
    // The chosen questions ride in their own order with the model's wording;
    // anything else it asked follows, and the cost-critical filter still rules.
    // A missing measure is a fact, so it is always asked. A condition is a
    // judgment: it rides only when the model, which read the brief and the
    // photos, asked it back — that is what drops the ones the job rules out.
    const said = new Map(parsed.questions.map((q) => [q.id, q]));
    const asked = wanted
      .filter((w) => w.id === "job-measure" || said.has(w.id))
      .map((w) => {
        const m = said.get(w.id);
        return {
          id: w.id,
          question: m?.question?.trim() || w.question,
          why: m?.why?.trim() || w.why,
          kind: m?.kind ?? w.kind,
          options: w.kind === "select" ? (m?.options?.length ? m.options : w.options) : m?.options,
          unit: w.unit ?? m?.unit,
          placeholder: m?.placeholder,
        };
      });
    const extras = parsed.questions.filter((q) => !wanted.some((w) => w.id === q.id));
    const questions = keepCostCritical([...asked, ...extras], input.description)
      .slice(0, 3)
      .map((q) =>
        q.kind === "select" && (!q.options || q.options.length === 0)
          ? { ...q, kind: "text" as const }
          : q,
      );
    console.info(
      `[analyzeEstimatePrompt] ${gateSpecialty.id} · ${wanted.length} cost-critical (${wanted.map((w) => `${w.id} $${Math.round(w.impact)}`).join(", ") || "none"}) · asking ${questions.length}`,
    );
    return {
      ok: true,
      data: { ...parsed, questions, enoughDetail: parsed.enoughDetail || questions.length === 0 },
    };
  } catch (err: any) {
    console.warn(`[analyzeEstimatePrompt] failed, proceeding without clarify: ${err?.message ?? err}`);
    // The provider refused (no completion billed): the run is given back.
    if (typeof err?.status === "number") await refund();
    return { ok: true, data: passthrough };
  }
}

export async function generateAdvancedEstimate(input: GenerateInput): Promise<EstimateRun> {
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
    await requirePage(organizationId, ["smart-proposal", "video-estimator"]);
    await enforceRateLimit(`ai:${organizationId}`, 60, HOUR, "AI runs");
    const { requireFeatureOrThrow } = await import("@/lib/entitlements");
    const { getOrgPlanById } = await import("@/lib/orgPlan");
    const plan = await getOrgPlanById(organizationId);
    requireFeatureOrThrow(plan, "advanced_estimator");
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Upgrade required" };
  }
  const blocked = await estimatorRunBlocked(organizationId);
  if (blocked) return blocked;

  if (!isOpenAIEnabled()) {
    return { ok: true, data: { ...STUB, title: `${input.projectType || "Sample"} estimate · AI disabled` }, disabled: true };
  }
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return trial.failure;
  return runSmartEstimate(organizationId, input, null, trial.refund);
}

/**
 * A trade of a house priced from its blueprint takeoff (lib/plans): the brief is
 * written on the server from the takeoff, the specialty is pinned, and the trial cap
 * was taken once when the plan set was opened (planEstimator.startPlanSession) — the
 * signed pass that proves it rides with every trade.
 */
export async function pricePlanTrade(raw: unknown): Promise<EstimateRun> {
  const parsed = tradePriceInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "This trade's takeoff could not be read — open the plans again." };
  const input = parsed.data;
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
    await requirePage(organizationId, ["smart-proposal"]);
    const { requireFeatureOrThrow } = await import("@/lib/entitlements");
    const { getOrgPlanById } = await import("@/lib/orgPlan");
    requireFeatureOrThrow(await getOrgPlanById(organizationId), "advanced_estimator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upgrade required" };
  }
  const pass = readPlanPass(input.token, organizationId);
  if (!pass) return { ok: false, error: "This blueprint session has expired — open the plans again." };
  try {
    // One whole house is 18 trades: pricing it twice (after a takeoff change) with a
    // few retries is fine, a loop is not — the whole plan set cost one trial use.
    await enforceRateLimit(`plan-price:${pass.nonce}`, 40, 6 * HOUR, "trade estimates");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many trade estimates." };
  }
  const blocked = await estimatorRunBlocked(organizationId);
  if (blocked) return blocked;
  if (!isOpenAIEnabled()) return { ok: false, error: "Pricing needs the estimator's AI service, which is not set up on this workspace." };
  const run = planTradeRun({ trade: input.trade, house: input.house, items: input.items, alsoPriced: input.alsoPriced, ask: input.ask ?? null });
  if (!run.items.length) return { ok: false, error: `The takeoff has nothing for ${run.label.toLowerCase()}.` };
  return runSmartEstimate(organizationId, { projectType: input.ask?.title ?? run.label, description: run.brief, location: input.location ?? undefined }, run, async () => {});
}

// ── Incremental refine ──────────────────────────────────────────────────────
// The "Apply changes" path. Unlike generateAdvancedEstimate, this does NOT
// re-plan — it makes a single surgical pass that edits the EXISTING estimate
// per the contractor's request, preserving every untouched line and price.
// Same costing rules, applied only where asked; nothing is shopped.
const refineInputSchema = z.object({
  projectType: z.string(),
  location: z.string().optional(),
  // NOTE: no intake UI sets a tier yet, so refine effectively always runs at
  // "standard". If a tier picker ships, the client MUST start sending this or
  // every refine will silently re-price at standard.
  qualityTier: z.enum(["budget", "standard", "luxury"]).optional(),
  instructions: z
    .string()
    .max(4000, "Change request is too long — keep it under 4,000 characters.")
    .default(""),
  // The last few APPLIED change requests (oldest first). The refine itself is
  // stateless — this is its short-term memory, so "now make it cheaper" knows
  // what "it" was.
  history: z.array(z.string().max(4000)).max(10).default([]),
  assumptions: z.array(z.string()).default([]),
  current: estimateSchema,
});

export async function refineAdvancedEstimate(raw: unknown): Promise<
  | {
      ok: true;
      data: GeneratedEstimate;
      /** Human-readable caveats for the review UI. */
      warnings: string[];
      /** Always false since the estimate stopped shopping (2026-10-09); kept on
       *  the wire so the review screens need no change. */
      reshopFailed: boolean;
      disabled?: boolean;
    }
  | { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: LimitKey }
> {
  let input: z.infer<typeof refineInputSchema>;
  try {
    input = refineInputSchema.parse(raw);
  } catch (err) {
    // Surface the friendly custom message (e.g. the instructions length cap);
    // fall back to the generic line for structural mismatches.
    const first = err instanceof z.ZodError ? err.issues[0]?.message : null;
    return { ok: false, error: first?.includes("—") ? first : "Invalid estimate payload" };
  }

  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
    await requirePage(organizationId, ["smart-proposal", "video-estimator"]);
    await enforceRateLimit(`ai:${organizationId}`, 60, HOUR, "AI runs");
    const { requireFeatureOrThrow } = await import("@/lib/entitlements");
    const { getOrgPlanById } = await import("@/lib/orgPlan");
    const plan = await getOrgPlanById(organizationId);
    requireFeatureOrThrow(plan, "advanced_estimator");
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Upgrade required" };
  }
  const blocked = await estimatorRunBlocked(organizationId);
  if (blocked) return blocked;

  const cleanAssumptions = input.assumptions.map((a) => a.trim()).filter(Boolean);
  const instructions = input.instructions.trim();

  // No AI configured — echo the current estimate back (folding in any edited
  // assumptions) so the UI stays consistent in demo mode.
  if (!isOpenAIEnabled()) {
    return {
      ok: true,
      data: {
        ...input.current,
        assumptions: cleanAssumptions.length ? cleanAssumptions : input.current.assumptions,
      },
      warnings: [],
      reshopFailed: false,
      disabled: true,
    };
  }
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return trial.failure;

  const qualityTier = input.qualityTier ?? "standard";
  try {
    const client = getOpenAI();
    console.info(
      `[advancedEstimator] refine · "${instructions.slice(0, 80)}" · ${input.current.materials.length} materials`
    );
    const completion = await client.chat.completions.create({
      model: await resolveOpenAIModel(),
      ...(await samplingOptions(0.3)),
      messages: [
        {
          role: "system",
          content:
            'You are a senior contractor AI estimator EDITING an existing estimate. You receive the current estimate as JSON plus a plain-English change request from the contractor. Apply ONLY the requested changes and return the COMPLETE updated estimate as JSON matching: {title, scope, assumptions: string[], materials: [{id, name, quantity, unitPrice, unit, dimensions, notes}], labor: [{id, name, quantity, unitPrice, unit, notes}], estimatedTimelineDays: number, discount: {label, amount, isPercent} | null}. ' +
            "Rules: (1) Preserve every line, price, and dimensions that the request does NOT touch — copy them through unchanged; do not re-price untouched items. " +
            `(2) Keep the same costing formula as the original: quality tier "${qualityTier}", waste factors (10% tile/drywall/paint, 15% lumber/trim, 0% fixtures), quantities MEASURED in the line's unit (never package counts) and unitPrice = the estimator's price per ONE of that unit from the pricing guidelines, never a listing's package price. ${UNIT_RULES} ${PRICING_RULES} EXCEPT if the instructions or assumptions explicitly ask for a different quality/grade for specific items, adjust those items. ` +
            "(3) Keep `dimensions` set to each product's real size/pack spec. " +
            "(4) If you add a new material, OR if you upgrade/change a material's specification based on the instructions or assumptions, price it per ONE of its unit from the pricing guidelines at the new grade. " +
            "(5) Treat the contractor's assumptions as ground truth. If an assumption conflicts with the current estimate (e.g. requires a different material, quantity, or scope), you MUST update the estimate to match. " +
            "(6) Every existing line carries an `id`. Keep the SAME `id` on every line you keep or edit — including renamed or re-specced lines. A task's material row and its labor row share one id and one name (material and labor are two prices of ONE line item); keep them paired, and when you add a task that has both, give its material row and its labor row the same new id and name. Omit `id` only on brand-new lines. " +
            "(7) Renaming or rewording a line is NOT a spec change: keep its id, price, and quantity unchanged unless the request explicitly changes the product itself. " +
            "(8) If the request asks for a discount ('10% off', 'knock $500 off'), do NOT alter any line prices — set `discount` to {label, amount, isPercent} (isPercent=true means amount is a 0-100 percentage). If asked to remove the discount, set it to null. Otherwise copy the existing discount through unchanged. " +
            "(9) Update `scope` and `estimatedTimelineDays` when the changes affect them; otherwise copy them through unchanged. Return JSON only." +
            // Priced the company's way (lib/estimate/companyPricing): labor is its own rows, in hours, at the company's rate.
            (input.current.pricing
              ? ` (10) THIS ESTIMATE IS PRICED THE COMPANY'S WAY (${input.current.pricing.words}). Labor is NOT paired with materials here: every labor row is its own line, unit "hour", quantity = ${input.current.pricing.laborBasis === "crew" ? "crew-hours" : "person-hours"}, id ending in "-L", named "Labor · <the work> (${input.current.pricing.laborBasis === "crew" ? "crew-hours" : "person-hours"})", and every one keeps the SAME unitPrice it has now. A new task gets a material row and its own labor row of that shape; a change in work changes the HOURS, never the rate. Material prices already include the company's markup — keep them as they are unless a material itself changes. Never add an overhead, profit or tax line.`
              : ""),
        },
        {
          role: "user",
          content: `${projectLine(input.projectType)}
${input.location ? `Location: ${input.location}` : ""}
Quality tier: ${qualityTier}

${
  input.history.length
    ? `Changes already applied in earlier passes (oldest first — context, do not re-apply):
${input.history.map((h) => `- ${h}`).join("\n")}

`
    : ""
}Change request from the contractor:
${instructions || "(no free-text request — apply the updated assumptions below)"}

${
  cleanAssumptions.length
    ? `Assumptions to honor:\n${cleanAssumptions.map((a) => `- ${a}`).join("\n")}\n\n`
    : ""
}Current estimate (JSON) — edit this and return the full updated version:
${JSON.stringify(input.current)}`,
        },
      ],
      response_format: { type: "json_object" },
    });
    const text = completion.choices[0]?.message?.content ?? "{}";
    const parsed = estimateSchema.parse(JSON.parse(text));
    // How it was priced is the estimate's, not the model's to drop.
    if (input.current.pricing) parsed.pricing = input.current.pricing;

    // The estimate carries no shop list any more (owner, 2026-10-09), so no
    // store, link, picture or listing price survives an edit — not even one an
    // estimate made before the change still holds.
    for (const mat of parsed.materials) {
      mat.store = undefined;
      mat.productUrl = undefined;
      mat.imageUrl = undefined;
      mat.retailPrice = undefined;
    }

    // A price in the change request ("make it $4,000 total", "$10 per sq ft
    // on the 400") is held the way the brief's is.
    const asked = readBrief(instructions);
    if (asked.targetSell) {
      const org = await db.organization.findUnique({ where: { id: organizationId }, select: { materialMarkupPct: true, laborMarkupPct: true } });
      const held = bindEstimateToBrief(parsed, { ...asked, area: undefined, length: undefined, measures: [] }, resolveMarkupRates(null, org));
      parsed.assumptions = [...held.notes, ...parsed.assumptions.filter((a) => !/^Priced to /.test(a))];
      console.info(`[advancedEstimator] refine · held to $${held.sellTotal}`);
    }

    console.info(
      `[advancedEstimator] refine complete · ${parsed.materials.length} materials, ${parsed.labor.length} labor`
    );
    return { ok: true, data: parsed, warnings: [], reshopFailed: false };
  } catch (err: any) {
    // Never leak Zod/OpenAI internals into the toast: the parse failures have
    // their own line, everything the provider raised goes through the one
    // helper that writes the log line and returns a sentence (lib/sdk/openai).
    if (err instanceof z.ZodError || err instanceof SyntaxError) {
      console.error(`[advancedEstimator] refine failed: ${err?.message ?? err}`);
      return {
        ok: false,
        error: "The AI returned an edit we couldn't apply. Try rephrasing, or make one change at a time.",
      };
    }
    if (typeof err?.status === "number") await trial.refund();
    return { ok: false, error: friendlyAIError(err, "estimate refine") };
  }
}

// Persist estimate
export async function saveEstimate(raw: {
  projectType: string;
  location?: string | null;
  data: GeneratedEstimate;
}) {
  const { organizationId, user } = await requireEstimatorOrManager();
  await requirePage(organizationId, ["smart-proposal", "video-estimator"]);
  await enforcePlanLimit(organizationId, "estimatorUses");
  return saveEstimateAs({ organizationId, userId: user.id }, raw);
}

export async function convertEstimateToProposal(raw: unknown) {
  const { organizationId, user, role } = await requireEstimatorOrManager();
  await requirePage(organizationId, ["smart-proposal", "video-estimator"]);
  await enforcePlanLimit(organizationId, "proposalsCreated");
  const data = convertInput.parse(raw);
  // Started from a project, a client's page or a lead, the picker recorded where this estimate files
  // (lib/filingContext); an explicit client still wins. The convert itself: lib/estimate/convertCore.
  const filing = await readFilingContext(organizationId);
  const made = await convertEstimateAs({ organizationId, userId: user.id, role }, data, filing);
  if (filing) await clearFilingContext();
  return made;
}

// ── SMART PROPOSAL ON THE SHOP'S WEBSITE (owner, 2026-10-28; lib/webEstimator "smart"): a homeowner describes the
// project and shows photos; the intake gate asks only the cost-critical questions; the estimate runs in the shop's own
// method and price book (runSmartEstimate, as the dashboard's); the page shows the price the shop's way; "Get my full
// quote" (actions/webEstimator webLead) makes the lead and the shop opens Smart Proposal with the brief. Each door: the
// shop by its handle, the trade on and paid, the website's brakes, the shop's monthly cap and its trial cap.

async function webSmartGate(slug: unknown): Promise<{ ok: true; shop: WebShop } | { ok: false; error: string; code?: string }> {
  if (typeof slug !== "string") return { ok: false, error: "This estimator isn't here." };
  const shop = await webShopBySlug(slug);
  if (!shop || !(await webShopServes(shop, "smart"))) return { ok: false, error: "This estimator isn't turned on." };
  try {
    await enforceRateLimit(`web-smart-ip:${await clientIp()}`, 4, 10 * MINUTE, "estimates");
    await enforceRateLimit(`web-est-shop:${shop.id}`, shopHourly(shop).estimates, HOUR, "estimates");
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: "That's a lot of estimates at once — give it a few minutes and try again.", code: "braked" };
    throw err;
  }
  if (await webCapReached(shop)) return { ok: false, error: "This estimator has had a busy month and is resting. Leave your details and the shop will price it by hand.", code: "capped" };
  if (!isOpenAIEnabled()) return { ok: false, error: "The estimator is resting right now. Leave your details and the shop will price it by hand.", code: "unavailable" };
  return { ok: true, shop };
}

function cleanWebBrief(raw: unknown) {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const sqft = Number(r.sqft);
  const photos = Array.isArray(r.photos) ? r.photos.filter((x): x is string => typeof x === "string").slice(0, 3) : [];
  const qualityTier: "budget" | "standard" | "luxury" = r.qualityTier === "budget" ? "budget" : r.qualityTier === "luxury" ? "luxury" : "standard";
  return { description: s(r.description, 4000), location: s(r.location, 200), sqft: Number.isFinite(sqft) && sqft > 0 ? Math.round(sqft) : undefined, qualityTier, photos, answers: s(r.answers, 2000) };
}

const RESTING = "This estimator is resting for now. Leave your details and the shop will price it by hand.";

/** The intake gate for a website brief: the cost-critical questions, or none. */
export async function webSmartAnalyze(slug: unknown, raw: unknown): Promise<{ ok: true; questions: PromptAnalysis["questions"]; location: string | null } | { ok: false; error: string; code?: string }> {
  const g = await webSmartGate(slug);
  if (!g.ok) return g;
  const b = cleanWebBrief(raw);
  if (b.description.length < 20) return { ok: false, error: "Tell us a little more about the project — a sentence or two.", code: "input" };
  const trial = await takeTrialCap(g.shop.id, "aiCalls").catch(() => null);
  if (trial && !trial.ok) return { ok: false, error: RESTING, code: "capped" };
  await noteRequestOrg(g.shop.id).catch(() => {});
  const r = await analyzeBrief({ projectType: "", description: b.description, location: b.location || undefined, sqft: b.sqft, photos: b.photos }, trial ? trial.refund : async () => {});
  return { ok: true, questions: r.data.questions, location: r.data.correctedLocation };
}

/** The estimate for a website brief, in the shop's own method and book; the price the shop's way. */
export async function webSmartGenerate(slug: unknown, raw: unknown): Promise<{ ok: true; estimate: WebEstimateView; scope: string; included: string[] } | { ok: false; error: string; code?: string }> {
  const g = await webSmartGate(slug);
  if (!g.ok) return g;
  const b = cleanWebBrief(raw);
  if (b.description.length < 20) return { ok: false, error: "Tell us a little more about the project — a sentence or two.", code: "input" };
  const trial = await takeTrialCap(g.shop.id, "aiCalls").catch(() => null);
  if (trial && !trial.ok) return { ok: false, error: RESTING, code: "capped" };
  const description = b.answers ? `${b.description}\n\nAnswers to the estimator's questions: ${b.answers}` : b.description;
  const run = await runSmartEstimate(g.shop.id, { projectType: "", description, location: b.location || undefined, sqft: b.sqft, qualityTier: b.qualityTier, photos: b.photos }, null, trial ? trial.refund : async () => {});
  if (!run.ok) return { ok: false, error: "The estimate couldn't be made just now. Leave your details and the shop will price it by hand.", code: "unavailable" };
  const d = run.data;
  const lines = [...d.materials, ...d.labor];
  const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  const discount = d.discount ? (d.discount.isPercent ? (subtotal * d.discount.amount) / 100 : d.discount.amount) : 0;
  const cents = Math.max(0, Math.round((subtotal - discount) * 100));
  if (!cents) return { ok: false, error: "The estimate came back empty. Leave your details and the shop will price it by hand.", code: "unavailable" };
  const ts = g.shop.settings.trades.smart;
  const band = priceBand(cents, ts.show, ts.spread);
  const typed = splitTypedAddress({ address: b.location, city: "", state: "", zip: "" });
  const scope = (d.scope || d.title).slice(0, 300);
  const est = await storeWebEstimate({
    organizationId: g.shop.id, trade: "smart", address: typed.address, city: typed.city || null, state: typed.state || g.shop.state, zip: typed.zip || null,
    summary: scope, choice: d.title.slice(0, 120), cents, band, show: ts.show,
    facts: { estimate: d, brief: description, qualityTier: b.qualityTier, sqft: b.sqft ?? null, photos: b.photos.length, timelineDays: d.estimatedTimelineDays ?? null },
  });
  await bumpWebCount(g.shop.id, "estimates").catch(() => {});
  const included = lines.map((l) => l.name).filter(Boolean).slice(0, 8);
  return { ok: true, estimate: { token: est.token, summary: scope, choice: d.title, band, show: ts.show, basis: ts.note || WEB_TRADE.smart.basis, askEmail: ts.askEmail }, scope: d.scope, included };
}
