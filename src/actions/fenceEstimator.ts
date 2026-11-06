"use server";
import { NoOrgError, UnauthorizedError, requireEstimatorOrManager } from "@/lib/orgContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";

const estimateTotal = (d: { materials: Array<{ quantity: number; unitPrice: number }>; labor: Array<{ quantity: number; unitPrice: number }> }) =>
  Math.round([...d.materials, ...d.labor].reduce((a, l) => a + l.quantity * l.unitPrice, 0));
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
import { clearFilingContext, readFilingContext } from "@/lib/filingContext";
import { getOpenAI, isOpenAIEnabled, samplingOptions, resolveOpenAIModel } from "@/lib/sdk/openai";
import { estimateSchema, type GeneratedEstimate } from "@/lib/estimatorSchema";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { fenceConvertSchema, firstIssue } from "@/lib/fence/convertSchema";
import { logServerError } from "@/lib/server-events";
import { PLAN_LIMIT_MESSAGE, type LimitKey } from "@/lib/planLimits";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { takeTrialCap } from "@/lib/trialMeter";
import { requirePage } from "@/lib/customPageAccess";
// The proposal itself is written in lib/fence/proposalWrite (2026-11-05), shared with the AI Operator.
import { writeFenceProposal } from "@/lib/fence/proposalWrite";

const STUB: GeneratedEstimate = {
  title: "Cedar privacy fence estimate · AI disabled",
  scope: "Install 180 linear ft cedar privacy fence, 6 ft tall, 1 gate.",
  assumptions: [
    "Standard post spacing (8 ft)",
    "Level ground; no slope surcharge",
    "Add OPENAI_API_KEY for real estimates",
  ],
  materials: [
    { name: "Cedar pickets (6ft)", quantity: 360, unitPrice: 4.5, unit: "ea" },
    { name: "4x4 posts (8ft)", quantity: 23, unitPrice: 18, unit: "ea" },
    { name: "Concrete bags", quantity: 46, unitPrice: 7, unit: "ea" },
    { name: "Single walk gate kit", quantity: 1, unitPrice: 180, unit: "ea" },
    { name: "Fasteners + brackets", quantity: 1, unitPrice: 140, unit: "lot" },
  ],
  labor: [
    { name: "Layout + post setting", quantity: 180, unitPrice: 8, unit: "ln ft" },
    { name: "Panel install", quantity: 180, unitPrice: 7, unit: "ln ft" },
    { name: "Cleanup", quantity: 1, unitPrice: 200, unit: "lot" },
  ],
  estimatedTimelineDays: 2,
};

export async function estimateFence(input: {
  linearFt: number;
  heightFt: number;
  material: string;
  gates: number;
  slope: boolean;
  notes?: string;
}): Promise<
  | { ok: true; data: GeneratedEstimate; disabled?: false }
  | { ok: true; data: GeneratedEstimate; disabled: true }
  | { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: LimitKey }
> {
  const { organizationId, user } = await requireEstimatorOrManager();
  await requirePage(organizationId, "fence-estimator");
await enforceRateLimit(`ai:${organizationId}`, 60, HOUR, "AI runs");
  // Union failure (not a throw): thrown messages are redacted in prod, and
  // this action's callers already branch on { ok }.
  const quota = await checkPlanLimit(organizationId, "estimatorUses");
  if (!quota.allowed) {
    return {
      ok: false,
      error: PLAN_LIMIT_MESSAGE,
      code: "PLAN_LIMIT_REACHED",
      resource: quota.cappedBy ?? "estimatorUses",
    };
  }
  if (!isOpenAIEnabled()) return { ok: true, data: STUB, disabled: true };
  // The card-less trial's AI ceiling (lib/trialMeter): one run, one use.
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return trial.failure;
  try {
    // The model this process can actually call, asked once per process and
    // remembered (lib/sdk/openai). OPENAI_MODEL's import-time snapshot answers
    // with whatever string the environment holds, and a string is not an
    // entitlement: a model the key's project has no access to fails every call
    // with 403 model_not_found. Resolved here instead, so one check covers the
    // process and the fallback is a working model rather than a dead one.
    const model = await resolveOpenAIModel();
    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model,
      ...(await samplingOptions(0.4)),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You are a senior fencing estimator. Produce a fence installation estimate as JSON: {title, scope, assumptions: string[], materials: [{name, quantity, unitPrice, unit}], labor: [{name, quantity, unitPrice, unit}], estimatedTimelineDays}. Slope yards add labor. Gates add material. Use realistic US 2026 pricing. Return JSON only.',
        },
        {
          role: "user",
          content: `Linear ft: ${input.linearFt}
Height: ${input.heightFt} ft
Material: ${input.material}
Gates: ${input.gates}
Slope: ${input.slope ? "yes" : "no"}
${input.notes ? `Notes: ${input.notes}` : ""}`,
        },
      ],
    });
    const text = completion.choices[0]?.message?.content ?? "{}";
    const parsed = estimateSchema.parse(JSON.parse(text));
    const total = estimateTotal(parsed);
    await logActivity({
      organizationId,
      actorId: user.id,
      kind: TRAIL_KINDS.ESTIMATE,
      summary: `Priced a fence estimate — ${Math.round(input.linearFt)} ft of ${input.heightFt}-ft ${input.material}${input.gates ? `, ${input.gates} gate${input.gates === 1 ? "" : "s"}` : ""}, ${money(total)}`,
      meta: { trade: "fence", linearFt: input.linearFt, heightFt: input.heightFt, material: input.material, gates: input.gates, amount: total },
    });
    return { ok: true, data: parsed };
  } catch (err: unknown) {
    if (typeof (err as { status?: unknown })?.status === "number") await trial.refund();
    return { ok: false, error: err instanceof Error && err.message ? err.message : "Generation failed" };
  }
}

/** The result of a convert. A FAILURE IS RETURNED, NOT THROWN (2026-09-22):
 *  a thrown Error's message is redacted by Next.js in production, so the page
 *  saw "Couldn't convert" for a plan cap, a role and a bad field alike, and
 *  the plan-limit detection (message equality) only ever worked in dev. */
export type FenceConvertResult =
  | { ok: true; id: string }
  | { ok: false; code: "PLAN_LIMIT_REACHED"; error: string; resource?: LimitKey }
  | { ok: false; code: "FORBIDDEN" | "INVALID" | "FAILED"; error: string };

export async function convertFenceEstimateToProposal(raw: unknown): Promise<FenceConvertResult> {
  let ctx: Awaited<ReturnType<typeof requireEstimatorOrManager>>;
  try {
    ctx = await requireEstimatorOrManager();
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, code: "FORBIDDEN", error: "Only an estimator, a manager or the owner can turn an estimate into a proposal." };
    if (err instanceof NoOrgError) return { ok: false, code: "FORBIDDEN", error: "Sign in to an organization to create a proposal." };
    throw err;
  }
  const { organizationId, user, role } = ctx;
  try {
    await requirePage(organizationId, "fence-estimator");
  } catch (err) {
    return { ok: false, code: "FORBIDDEN", error: err instanceof Error ? err.message : "Fence estimator isn't in your plan." };
  }
  const quota = await checkPlanLimit(organizationId, "proposalsCreated");
  if (!quota.allowed) {
    return { ok: false, code: "PLAN_LIMIT_REACHED", error: PLAN_LIMIT_MESSAGE, resource: quota.cappedBy ?? "proposalsCreated" };
  }
  const parsed = fenceConvertSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID", error: firstIssue(parsed.error) };
  try {
    const filing = await readFilingContext(organizationId);
    const id = await writeFenceProposal({ organizationId, userId: user.id, role }, parsed.data, filing);
    if (filing) await clearFilingContext();
    return { ok: true, id };
  } catch (err) {
    // The cause goes to the log and to PostHog (server_error, scope fence-convert); the page gets one plain line.
    logServerError("fence-convert", err, { kind: "action", organizationId });
    return { ok: false, code: "FAILED", error: "The proposal could not be saved. Try again in a moment; if it keeps failing, tell support the time it happened." };
  }
}
