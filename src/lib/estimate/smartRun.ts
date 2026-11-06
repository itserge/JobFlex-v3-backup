import "server-only";
// THE SMART ESTIMATE'S RUN, WITHOUT A SESSION (2026-11-05). Moved out of actions/advancedEstimator (a
// "use server" file, where every export is a public action) so the JobFlex Assistant can price a job from a
// text or a call (lib/assistant/build) through the very run Smart Proposal and the website's Smart estimate use.
// The callers keep their own gates — the session, the page, the feature, the caps — and pass the company in.
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { friendlyAIError, getOpenAI, isTransientAIError, resolveOpenAIModel } from "@/lib/sdk/openai";
import { type LimitKey } from "@/lib/planLimits";
import { resolveMarkupRates } from "@/lib/pricing/markup";
import { measureUnit } from "@/lib/estimate/console-model";
import { applyRepairs, repairInstruction, validateEstimate } from "@/lib/estimate/validate-estimate";
import { computeLines, computedPromptBlock, mergeComputed } from "@/lib/estimate/computed-lines";
import { detectTrade, GENERAL_TRADE, TRADES, type TradeProfile } from "@/lib/estimate/trade-knowledge";
import { buildLegacyEstimatePrompt, effectiveProcedure, legacyEstimateFromText, LEGACY_SYSTEM_MESSAGE } from "@/lib/estimate/legacy-estimate";
import { loadPromptOverrides } from "@/lib/estimate/promptOverrides";
import { floorNote, floorToRange, fullerAnswer, linesTotal, retryReasons } from "@/lib/estimate/remodel-sanity";
import { bindLinesToBrief, bindTextToBrief, scrubUnaskedText, scrubUnaskedWork } from "@/lib/estimate/brief";
import { holdPermitDecision, permitSummary } from "@/lib/estimate/permits";
import { applyCompanyPricing, companyPricingActive, hoursPromptBlock, snapshotOf } from "@/lib/estimate/companyPricing";
import { readCompanyPricing } from "@/lib/estimate/companyPricingServer";
import { type GeneratedEstimate } from "@/lib/estimatorSchema";
import { briefFingerprint, keepEstimate, photoPrint, SAME_NOTE, sameEstimate } from "@/lib/estimate/sameBrief";
import { bindLinesToTakeoff } from "@/lib/plans/tradeBrief";
import { GENERAL_CONDITIONS_PROCEDURE, newBuildPhases, newBuildProcedure, type PlanTradeRun } from "@/lib/plans/tradeSetup";

/** The "Project type:" line of a user turn — omitted when the intake no longer
 *  asks for one (2026-09-02), so the model reads the type off the brief. */
export function projectLine(projectType: string | null | undefined): string {
  const t = (projectType ?? "").trim();
  return t ? `Project type: ${t}` : "Project type: infer it from the description";
}

/** How long to wait before the single retry of a busy model call. */
const RETRY_DELAY_MS = 3_000;

export const STUB: GeneratedEstimate = {
  title: "Sample Roof Replacement Estimate · AI Disabled",
  scope:
    "Full tear-off, synthetic underlayment, 30-year architectural shingles, new ridge vents, ice & water shield at valleys and eaves, drip edge, pipe collars. Full cleanup and magnetic sweep.",
  assumptions: [
    "No decking replacement needed beyond 2 sheets",
    "Existing chimney flashing to be reused",
    "One-layer tear-off; dumpster on driveway",
    "Pricing placeholders — add OPENAI_API_KEY for real generation",
  ],
  materials: [
    { name: "Architectural shingles (30-yr)", quantity: 24, unitPrice: 115, unit: "sq boards" },
    { name: "Synthetic underlayment", quantity: 24, unitPrice: 32, unit: "sq boards" },
    { name: "Ice & water shield", quantity: 400, unitPrice: 1.1, unit: "sqft" },
    { name: "Ridge vent system", quantity: 60, unitPrice: 6, unit: "linear ft" },
    { name: "Drip edge + flashing", quantity: 1, unitPrice: 480, unit: "fixed" },
  ],
  labor: [
    { name: "Tear-off + disposal", quantity: 2400, unitPrice: 0.8, unit: "sqft" },
    { name: "Installation labor", quantity: 2400, unitPrice: 1.8, unit: "sqft" },
    { name: "Cleanup + magnetic sweep", quantity: 1, unitPrice: 380, unit: "fixed" },
  ],
  estimatedTimelineDays: 3,
};

export interface GenerateInput {
  projectType: string;
  description: string;
  location?: string;
  sqft?: number;
  qualityTier?: "budget" | "standard" | "luxury";
  /** User-edited assumptions fed back in via "Regenerate with AI" — treated as constraints. */
  assumptions?: string[];
  /**
   * Site photos from the intake step, as base64 data URLs (or https URLs).
   * Sent to the model as vision input, never stored. See `safePhotos`.
   */
  photos?: SitePhoto[];
  /** "Ask for a fresh estimate": price it again even when this exact brief was priced before (lib/estimate/sameBrief). */
  fresh?: boolean;
}

/**
 * One site photo. The browser sends `{ url }`: React's server-action decoder refuses an
 * ARRAY whose strings add up past a million characters ("Maximum array nesting
 * exceeded"), which two phone photos do. A bare string is still read, for older pages.
 */
export type SitePhoto = string | { url: string };

/** How many times a rejected estimate is handed back to the model with its
 *  violations before the deterministic repair takes over (audit 2026-09-17). */
const MAX_ESTIMATE_REPAIRS = 2;
// ── Site photos (vision input) ──────────────────────────────────────────────
//
// The intake step lets a contractor drop photos of the job. They are read to
// base64 data URLs in the browser and passed straight through to the model —
// nothing is uploaded or persisted, so a photo exists only for the length of
// the request that prices it.
//
// The cap is deliberate: images dominate the token cost of these calls, and a
// modern phone camera roll will happily hand over 12MB frames. Six images at
// roughly 6MB of base64 each is the ceiling a single estimate can spend.
const MAX_PHOTOS = 6;
const MAX_PHOTO_CHARS = 8_000_000; // ~6MB binary once base64-decoded.

/**
 * Keep only what is safe to hand OpenAI as an image: an inline base64 image, or
 * an https image URL. Anything else — a `javascript:` scheme, a `file:` path, a
 * non-image data URL, an oversized frame — is dropped silently rather than
 * failing the estimate the contractor is waiting on.
 */
export function safePhotos(photos: SitePhoto[] | undefined): string[] {
  if (!photos?.length) return [];
  const clean: string[] = [];
  for (const p of photos) {
    const raw = typeof p === "string" ? p : p && typeof p === "object" && typeof p.url === "string" ? p.url : "";
    const v = raw.trim();
    if (!v || v.length > MAX_PHOTO_CHARS) continue;
    const inlineImage = /^data:image\/(png|jpe?g|webp|gif|heic|heif);base64,[A-Za-z0-9+/=]+$/i.test(v);
    const httpsImage = /^https:\/\//i.test(v);
    if (inlineImage || httpsImage) clean.push(v);
    if (clean.length === MAX_PHOTOS) break;
  }
  return clean;
}

/**
 * A chat `content` value carrying the prompt text plus any photos.
 *
 * Returns the plain string when there are no photos so the text-only path stays
 * byte-identical to what it was before photos existed — the multimodal array
 * form is only used when it earns its place.
 */
export function withPhotos(text: string, photos: string[]) {
  if (!photos.length) return text;
  return [
    { type: "text", text },
    ...photos.map((url) => ({ type: "image_url", image_url: { url, detail: "auto" } })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any;
}

/**
 * The Smart estimate: the model writes the job's lines, the brief's measured
 * phases are costed here, and validation holds both to the contractor's own
 * numbers. No store is searched — material prices come from the trade price
 * book (owner, 2026-10-09: a shop list of the wrong products embarrassed the
 * contractor in front of the client).
 */
export type EstimateRun =
  | { ok: true; data: GeneratedEstimate; disabled?: false }
  | { ok: true; data: GeneratedEstimate; disabled: true }
  | { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: LimitKey };

/** The validator's view of a blueprint trade: its profile without the remodel phases. */
function planProfile(run: PlanTradeRun): TradeProfile {
  const base = TRADES.find((t) => t.id === run.setup.profileId) ?? GENERAL_TRADE;
  return { ...base, phases: newBuildPhases(base.phases), lineRange: run.setup.lineRange ?? base.lineRange };
}

/**
 * The estimate itself, once the gates have passed — for a brief (generateAdvancedEstimate)
 * or for one trade of a house off its plans (pricePlanTrade, `plan` set).
 */
export async function runSmartEstimate(organizationId: string, input: GenerateInput, plan: PlanTradeRun | null, refund: () => Promise<void>): Promise<EstimateRun> {
  const qualityTier = input.qualityTier ?? "standard";
  // "Regenerate with AI" feeds the user's edited assumptions in as constraints.
  const cleanAssumptions = (input.assumptions ?? []).map((a) => a.trim()).filter(Boolean);
  // Photos ride into the estimate call: the estimator needs them to see what
  // is actually on site (a second layer of shingles, a rotted post, the fence
  // that is already there) before it prices anything.
  const photos = safePhotos(input.photos);

  try {
    const client = getOpenAI();

    // ── Step 1 · The estimate — the old quote-draft call, verbatim ─────────
    // Owner, 2026-09-03: "exactly like the old one". lib/estimate/legacy-estimate
    // assembles the previous JobFlex prompt (master prompt in the admin slot,
    // specialty preamble, material profile, price book, tax guidance, template
    // rules, pricing rules, key questions) and parses the reply with the old
    // parser. One call at temperature 0 with seed 42, as it always ran.
    const [org, company] = await Promise.all([
      db.organization.findUnique({ where: { id: organizationId }, select: { name: true, materialMarkupPct: true, laborMarkupPct: true } }),
      plan ? Promise.resolve(null) : readCompanyPricing(organizationId),
    ]);
    // The company's own method (Settings → Estimating, lib/estimate/companyPricing): on, with a rate. A blueprint
    // trade keeps the builder price book — the method is for Smart Proposal and the video estimator.
    const companyOn = companyPricingActive(company) ? company : null;
    // gpt-5-class models (what the previous JobFlex ran) get the verbatim old
    // prompt. gpt-4o-class models answer it with 4-6 lines, so they also get
    // the trade profile + hard rules in the old "extra admin" slot, which
    // brings them to the old output's 12-13 lines (harness, 2026-09-03).
    // The model this process can actually call — the env name when the key's
    // project is entitled to it, the default when it is not (lib/sdk/openai).
    const model = await resolveOpenAIModel();
    const reasoningModel = /^(gpt-5|o[1-9])/.test(model);
    // What the platform admin changed on /admin/prompts — the master prompt,
    // the system message, a specialty's preamble or procedure. Defaults when
    // nothing was saved (or the table is not there yet).
    const overrides = await loadPromptOverrides();
    // A trade off a blueprint prices from its specialty's procedure without the steps a
    // new house never has (a tear-off, a removal, a patch), or — for the general
    // conditions — from the builder's own list (lib/plans/tradeSetup).
    const planProcedure = plan
      ? plan.trade === "general"
        ? GENERAL_CONDITIONS_PROCEDURE
        : (() => {
            const own = effectiveProcedure(plan.setup.specialtyId, overrides);
            return own ? newBuildProcedure(own) : null;
          })()
      : null;
    const promptOverrides =
      plan && planProcedure
        ? { ...overrides, specialties: { ...overrides.specialties, [plan.setup.specialtyId]: { ...overrides.specialties[plan.setup.specialtyId], procedure: planProcedure } } }
        : overrides;
    const legacy = buildLegacyEstimatePrompt(
      {
        description: input.description,
        location: input.location,
        projectType: input.projectType,
        sqft: input.sqft,
        companyName: org?.name ?? null,
        assumptions: cleanAssumptions,
        qualityTier,
      },
      {
        // The trade-rules block re-detects the trade and lists its remodel phases;
        // a blueprint trade has its takeoff block instead.
        withTradeRules: !reasoningModel && !plan,
        overrides: promptOverrides,
        specialtyId: plan?.setup.specialtyId,
        newBuild: plan ? { permit: plan.setup.permit, benchmarkQty: plan.benchmarkQty } : null,
      },
    );
    console.info(
      `[advancedEstimator] Step 1 (estimate) · specialty=${legacy.specialty.id} scope=${legacy.scope} method=${legacy.remodelDomains.join("+") || "none"} utility=${legacy.utilityJob ?? "none"} prices=${legacy.priced ? `${legacy.priced.steps}/${legacy.priced.of}` : "none"} range=${legacy.range ? `${legacy.range.low}-${legacy.range.high}` : "none"} procedure=${legacy.procedure} hvac=${legacy.hvac} tier=${qualityTier} photos=${photos.length} prompt=${legacy.prompt.length}ch`
    );
    // temperature 0 + seed 42, as the old provider sent. This is NOT
    // determinism: the audit of 2026-09-17 ran ten briefs three times each and
    // the same brief came back between 4% and 98% apart — a water-heater swap
    // at $1,021 and at $3,000. That is why the answer is validated below
    // rather than trusted. Reasoning models reject a temperature.
    const askEstimate = async (extra: string, prefix = "") => {
      const completion = await client.chat.completions.create(
        {
          model,
          ...(reasoningModel ? {} : { temperature: 0, seed: 42 }),
          messages: [
            // The platform admin's system message when one is saved on
            // /admin/prompts, the built-in one otherwise.
            { role: "system", content: overrides.system?.trim() || LEGACY_SYSTEM_MESSAGE },
            // A blueprint trade's takeoff rides last of the prompt proper, on every ask.
            { role: "user", content: withPhotos(`${prefix}${legacy.prompt}${plan ? `\n\n${plan.block}` : ""}${extra}`, photos) },
          ],
          response_format: { type: "json_object" },
        },
        // The SDK retries twice on its own, which turned one busy minute into
        // six requests and a minute of a contractor watching a spinner. The
        // retry policy for this call is the one below, and it is visible.
        { maxRetries: 0 },
      );
      return legacyEstimateFromText(completion.choices[0]?.message?.content ?? "{}", legacy.specialty);
    };

    /* THE FIRST ASK, ONCE MORE IF THE SERVICE WAS BUSY (owner, 2026-09-18).
       429 and 5xx are the two answers that mean "not now" rather than "no", and
       a single three-second wait clears most of them. One retry, not a loop: a
       contractor waiting on an estimate would rather be told than watched. A
       live key is never quietly answered with the demo stub — that stub exists
       for a workspace with no key at all, and dressing a failure as an estimate
       would put invented prices in front of a customer. */
    const askEstimateOnce = async (extra: string, prefix = "") => {
      try {
        return await askEstimate(extra, prefix);
      } catch (err) {
        if (!isTransientAIError(err)) throw err;
        const status = (err as { status?: number })?.status;
        console.warn(`[advancedEstimator] Step 1 · ${status} from the model — one retry in ${RETRY_DELAY_MS} ms`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        return askEstimate(extra, prefix);
      }
    };

    // ── Step 1b · Judge the answer, and make it fix what it got wrong ──────
    // Up to two re-asks with the violations listed; whatever is still wrong
    // after that is repaired here and said out loud on the estimate
    // (lib/estimate/validate-estimate).
    const trade = plan ? planProfile(plan) : detectTrade(`${input.projectType ?? ""} ${input.description}`);

    // ── Step 1a · The lines the brief MEASURES, priced without the model ────
    // The audit of 2026-09-17 showed the spread is a quantity problem: asked
    // the same brief three times the model invented a different set of
    // quantities each time, for work the customer had never mentioned. So the
    // phases the description actually measures are costed here — quantity out
    // of the brief, material and labor from the trade anchor at this state's
    // index — handed to the model as settled facts, and merged back over
    // anything it restates anyway.
    //
    // No priceMaterial: the estimate is disconnected from store listings
    // (owner, 2026-10-09), so a computed line's material is always its anchor
    // — which also makes two runs of one brief agree to the cent.
    const computed = await computeLines({
      // A blueprint trade's quantities are the takeoff's, bound after the answer.
      description: plan ? "" : input.description,
      trade,
      state: input.location,
      // No organization stores a labor rate today (schema check, 2026-09-18),
      // so this is always null and labor comes from the anchor. The hook is
      // here so the day one exists, one line changes.
      orgLaborRate: null,
    });
    if (computed.lines.length) {
      console.info(
        `[advancedEstimator] Step 1a · ${computed.lines.length} computed line(s) [${computed.lines.map((l) => `${l.phaseId}:${l.quantity}${l.unit}`).join(", ")}], ${computed.skipped.length} phase(s) left to the model`,
      );
    }
    // With the company's method on, every ask also says to give each line its hours.
    const computedBlock = computedPromptBlock(computed.lines) + (companyOn ? hoursPromptBlock(companyOn) : "");

    /** Every answer, first or re-ask, gets the computed lines merged over it. */
    const withComputed = (r: Awaited<ReturnType<typeof askEstimateOnce>>) => {
      const merged = mergeComputed(r.items, computed.lines);
      if (merged.dropped.length) {
        console.info(`[advancedEstimator] Step 1a · dropped ${merged.dropped.length} model line(s) already computed: ${merged.dropped.map((d) => d.name.slice(0, 40)).join(" | ")}`);
      }
      return { ...r, items: merged.items as typeof r.items };
    };

    // ── Same brief, same estimate (lib/estimate/sameBrief) ──────────────────
    // The fingerprint of exactly this question: the built prompt carries the brief, the place, the price book, the
    // procedures and the tier; the rest is what decides the answer outside it.
    const fingerprint = briefFingerprint({
      v: 1,
      model,
      system: overrides.system?.trim() || LEGACY_SYSTEM_MESSAGE,
      prompt: legacy.prompt,
      plan: plan?.block ?? null,
      computed: computedBlock,
      photos: photos.map(photoPrint),
      company: companyOn ? snapshotOf(companyOn) : null,
      markup: [org?.materialMarkupPct ?? null, org?.laborMarkupPct ?? null],
      tier: qualityTier,
    });
    if (!input.fresh) {
      const before = await sameEstimate(organizationId, fingerprint);
      if (before) {
        // No AI was spent: the trial's use goes back.
        await refund().catch(() => {});
        console.info(`[advancedEstimator] same brief as ${before.at} · the estimate it got then (${fingerprint.slice(0, 10)})`);
        return { ok: true, data: { ...before.estimate, notes: [SAME_NOTE, ...(before.estimate.notes ?? [])], remembered: { at: before.at } } };
      }
    }

    let called = withComputed(await askEstimateOnce(computedBlock));

    /* ONE RE-ASK BUDGET, TWO REASONS TO SPEND IT (merge, 2026-09-19).
       Two passes used to ask the model again for different reasons: this one,
       because the answer is thin or cheap for the job it describes
       (lib/estimate/remodel-sanity — a bathroom that came back as eight lines,
       a whole remodel priced under its range), and the validation pass below,
       because the answer broke a rule. Both are worth asking for, and neither
       is worth two more minutes and two more calls on top of each other, so
       they share MAX_ESTIMATE_REPAIRS between them: whatever this one spends,
       the validation loop no longer has. A brief for part of a room has no
       line quota; a stated price has no range. The fuller answer is kept. */
    let reaskBudget = MAX_ESTIMATE_REPAIRS;
    const reasons = retryReasons({
      lines: called.items.length,
      coreSteps: legacy.procedureCoreSteps,
      total: linesTotal(called.items),
      range: legacy.range,
    });
    if (reasons.length && reaskBudget > 0) {
      console.warn(
        `[advancedEstimator] asking again · ${called.items.length} lines for ${legacy.procedureCoreSteps} core steps · total ${Math.round(linesTotal(called.items))}${legacy.range ? ` vs ${legacy.range.low}-${legacy.range.high} (${legacy.range.job}, ${legacy.range.place})` : ""}`,
      );
      reaskBudget -= 1;
      try {
        // Merged through the same computed-lines path, or the two answers
        // would be compared on different terms.
        const again = withComputed(
          await askEstimateOnce(computedBlock, reasons.join("\n\n") + "\n\n"),
        );
        console.info(`[advancedEstimator] second answer: ${again.items.length} lines, total ${Math.round(linesTotal(again.items))}`);
        called = fullerAnswer(called, again);
      } catch (err) {
        // The answer in hand is still an answer.
        console.warn(`[advancedEstimator] thin-answer re-ask failed, keeping the first: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (called.warnings.length) console.warn(`[advancedEstimator] parser: ${called.warnings.join(" | ")}`);
    if (called.items.length === 0) throw new Error("The estimator returned no line items — try a more specific description.");
    // Whether this job takes a permit, decided from the brief when the prompt
    // was built (lib/estimate/permits): the validator asks for a permit line
    // only when it does.
    const permit = legacy.permit?.need ?? null;
    let report = validateEstimate({ items: called.items, description: input.description, location: input.location, assumptions: called.assumptions, trade, permit });
    for (let attempt = 1; attempt <= reaskBudget && report.blocking.length; attempt++) {
      console.info(`[advancedEstimator] Step 1b · ${report.blocking.length} blocking violation(s), re-asking (${attempt}/${reaskBudget} left of ${MAX_ESTIMATE_REPAIRS}): ${report.blocking.map((x) => x.code).join(", ")}`);
      // A re-ask that fails (rate limit, spent account, a bad reply) must
      // never cost the contractor the estimate already in hand.
      let retry: Awaited<ReturnType<typeof askEstimate>>;
      try {
        retry = await askEstimate(`${computedBlock}${repairInstruction(report)}`);
      } catch (err) {
        console.warn(`[advancedEstimator] Step 1b · re-ask failed, keeping the first answer: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
      if (!retry.items.length) break;
      retry = withComputed(retry);
      const retryReport = validateEstimate({ items: retry.items, description: input.description, location: input.location, assumptions: retry.assumptions, trade, permit });
      // Keep the better answer: fewer blocking violations wins, ties go to the newer.
      if (retryReport.blocking.length <= report.blocking.length) {
        called = retry;
        report = retryReport;
      }
      if (!report.blocking.length) break;
    }
    const repaired = applyRepairs({ items: called.items, description: input.description, location: input.location, assumptions: called.assumptions, trade, permit }, report);
    const estimateNotes = repaired.notes;
    if (estimateNotes.length) console.info(`[advancedEstimator] Step 1b · ${estimateNotes.join(" ")}`);
    called = { ...called, items: repaired.items, assumptions: repaired.assumptions };
    // A job that needs no permit (or whose city decides) carries no permit
    // line even when the model wrote one anyway, and says why (owner,
    // 2026-10-09: a door swap came back with "Permit and inspection").
    const held = holdPermitDecision({ items: called.items, assumptions: called.assumptions, scope: called.scope }, legacy.permit, input.location);
    console.info(`[advancedEstimator] permit · ${legacy.permit ? `${legacy.permit.need} (${legacy.permit.reason})` : "the trade's procedure decides"}${held.dropped.length ? ` · dropped ${held.dropped.join(" | ")}` : ""}`);
    called = { ...called, items: held.items, assumptions: held.assumptions, scope: held.scope };
    // Said under the ledger, where the contractor reads the checks.
    const permitLine = permitSummary(legacy.permit, input.location);
    if (permitLine) estimateNotes.push(permitLine);
    // The last word on the prices, after every re-ask and repair: a total
    // still far under the job's range is not an estimate. Every line but the
    // pass-through fees rises by one share to the range's point for the tier
    // (lib/estimate/remodel-sanity).
    // Not on a blueprint trade: its benchmark is shown to the model, but a house's
    // trade is held to the builder price book on the estimate's notes instead
    // (lib/plans/priceChecks) — raising it silently would hide the question.
    const floored = plan ? null : floorToRange(called.items, legacy.range, qualityTier);
    if (floored && legacy.range) {
      console.warn(
        `[advancedEstimator] raised to the range · total ${Math.round(floored.from)} → ${Math.round(floored.to)} (${legacy.range.job}, ${legacy.range.place}, ${qualityTier})`,
      );
      called = { ...called, items: floored.items, assumptions: [...called.assumptions, floorNote(legacy.range, floored.from, floored.to)] };
    }
    // Guard the ledger's arithmetic: no negative or NaN quantities, no line
    // with nothing on it. A zero-priced line is kept (the contractor fills it)
    // but logged, so a silent regression in the prompt is visible.
    const parsedItems = called.items.map((it) => ({
      ...it,
      dimensions: null as string | null,
      quantity: Number.isFinite(it.quantity) && it.quantity > 0 ? it.quantity : 1,
      unit: measureUnit(it.unit, it.materialUnitPrice > 0 ? "materials" : "labor"),
    }));
    // ── The contractor's numbers win (lib/estimate/brief) ──────────────────
    // Work the brief never asked for comes off (a coatings reply's moisture
    // testing), the stated quantity goes back on every line in that unit (a
    // 450 that was 400 plus waste), and the stated customer price is what the
    // lines add up to — after the org's markup, which the proposal applies.
    const scrub = scrubUnaskedWork(parsedItems, input.description, legacy.specialty.id);
    if (scrub.dropped.length) console.info(`[advancedEstimator] dropped work the brief did not ask for: ${scrub.dropped.join(" | ")}`);
    const bound = plan
      ? { ...bindLinesToTakeoff(scrub.lines, plan.items), snapped: [] as ReturnType<typeof bindLinesToBrief>["snapped"], fitted: false, sellTotal: undefined }
      : bindLinesToBrief(scrub.lines, legacy.facts, resolveMarkupRates(null, org));
    if (bound.snapped.length || bound.fitted) console.info(`[advancedEstimator] held to the brief · snapped ${bound.snapped.map((x) => `${x.from}→${x.to} ${x.unit}`).join(", ") || "none"} · fitted ${bound.fitted ? `$${bound.sellTotal}` : "no"}`);
    const items = bound.lines;
    const heldTitle = bindTextToBrief(scrubUnaskedText(called.title, input.description, legacy.specialty.id), bound.snapped);
    const heldScope = bindTextToBrief(scrubUnaskedText(called.scope, input.description, legacy.specialty.id), bound.snapped);
    const zeroed = items.filter((it) => it.materialUnitPrice <= 0 && it.laborUnitPrice <= 0);
    if (zeroed.length) {
      console.warn(`[advancedEstimator] ${zeroed.length} line(s) came back unpriced: ${zeroed.map((z) => z.name).join(" | ")}`);
    }
    console.info(`[advancedEstimator] Step 1 produced ${items.length} lines`);

    // ── Step 2 · The wire format ────────────────────────────────────────────
    // SPLIT each fused item into a material row (every item, so pairing and
    // order survive) and a labor row when the item carries labor, under ONE id
    // so the client pairs them exactly (console-model pairEstimateLines).
    const materials: GeneratedEstimate["materials"] = [];
    const labor: GeneratedEstimate["labor"] = [];
    if (companyOn) {
      // THE COMPANY'S WAY (2026-10-16): materials at cost × its markup, labor its own rows in hours × its rate,
      // overhead and profit inside the prices — the screens and the proposal show what the company would charge.
      const priced = applyCompanyPricing(items, companyOn, (i) => `i${i + 1}-${randomUUID().slice(0, 8)}`);
      materials.push(...priced.materials);
      labor.push(...priced.labor);
      estimateNotes.unshift(`Priced your company's way (Settings → Estimating): ${snapshotOf(companyOn).words}.`);
      if (priced.derivedHours) {
        estimateNotes.push(`${priced.derivedHours} labor line${priced.derivedHours === 1 ? "" : "s"} came without hours from the estimator — the hours were worked out from the price book's labor cost. Check ${priced.derivedHours === 1 ? "it" : "them"}.`);
      }
      // A price named in the brief was fitted at the price book's rates; the company's own rates decide here, so the
      // contractor sees both figures rather than a stated price quietly missed.
      if (bound.fitted && bound.sellTotal) {
        const own = [...materials, ...labor].reduce((a, r) => a + r.quantity * r.unitPrice, 0);
        if (Math.abs(own - bound.sellTotal) >= 1) {
          estimateNotes.push(`Your brief named $${Math.round(bound.sellTotal).toLocaleString("en-US")}; priced your company's way the lines come to $${Math.round(own).toLocaleString("en-US")} before tax.`);
        }
      }
      console.info(`[advancedEstimator] company pricing · ${materials.length} material row(s), ${labor.length} labor row(s) in hours, ${priced.derivedHours} hours worked out`);
    } else items.forEach((it, i) => {
      const id = `i${i + 1}-${randomUUID().slice(0, 8)}`;
      materials.push({
        id,
        name: it.name.trim(),
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: it.materialUnitPrice,
        // What the validation pass did to this line, for the row to show and
        // for the totals to honour (a suggestion is not billed).
        flag: it.flag,
        flagNote: it.flagNote,
        dimensions: it.dimensions?.trim() || undefined,
        notes: it.notes?.trim() || undefined,
      });
      if (it.laborUnitPrice > 0) {
        labor.push({ id, name: it.name.trim(), quantity: it.quantity, unit: it.unit, unitPrice: it.laborUnitPrice, flag: it.flag, flagNote: it.flagNote });
      }
    });
    const estimate: GeneratedEstimate = {
      title: heldTitle.trim(),
      scope: heldScope,
      assumptions: [...bound.notes, ...called.assumptions],
      estimatedTimelineDays: called.estimatedTimelineDays,
      materials,
      labor,
      notes: estimateNotes.length ? estimateNotes : undefined,
      ...(companyOn ? { pricing: snapshotOf(companyOn) } : {}),
    };
    console.info(`[advancedEstimator] Step 2 complete · ${materials.length} lines, ${labor.length} carry labor`);
    // This brief's answer from now on (a fresh estimate replaces the one before).
    await keepEstimate(organizationId, fingerprint, estimate);

    return { ok: true, data: estimate };
  } catch (err: any) {
    // A message this code wrote itself (no line items, a length cap) is for the
    // contractor; anything the provider raised is for the log only.
    if (typeof err?.status !== "number" && err?.message) {
      console.error(`[advancedEstimator] generation failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
    await refund();
    return { ok: false, error: friendlyAIError(err, "estimate generation") };
  }
}
