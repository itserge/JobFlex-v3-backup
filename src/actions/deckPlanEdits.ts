"use server";
// THE PLAN SET'S EDIT (2026-11-09): keep the contractor's changes to the permit
// set and the construction set — cards taken out, words changed, cards and
// sheets added (lib/deck/plans/edits). Kept by the property, beside the site
// plan; behind the same gate as the site plan's own save ("full" Deck Studio,
// an estimator, a manager or the owner).

import { NoOrgError, UnauthorizedError, requireEstimatorOrManager } from "@/lib/orgContext";
import { deckStudioAccess } from "@/lib/deck/access";
import { logServerError } from "@/lib/server-events";
import { MAX_EDITS_JSON, normalizePlanEdits, type PlanEdits } from "@/lib/deck/plans/edits";
import { planEditsKey, writePlanEdits } from "@/lib/deck/planEditsStore";

type Gate = { ok: true; organizationId: string } | { ok: false; error: string };

async function gate(): Promise<Gate> {
  try {
    const ctx = await requireEstimatorOrManager();
    const level = await deckStudioAccess(ctx.user, ctx.organizationId);
    if (level !== "full") return { ok: false, error: "Editing the permit set is part of Deck Studio." };
    return { ok: true, organizationId: ctx.organizationId };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: "Only an estimator, a manager or the owner can edit the set." };
    if (err instanceof NoOrgError) return { ok: false, error: "Sign in to an organization first." };
    throw err;
  }
}

/** Keep the set's edits for this deck (its address, else its draft or proposal). */
export async function saveDeckPlanEdits(input: { address?: string | null; draftId?: string | null; proposalId?: string | null; edits: unknown }): Promise<{ ok: true; edits: PlanEdits } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const ref = { address: input.address ?? null, draftId: input.draftId ?? null, proposalId: input.proposalId ?? null };
  if (!planEditsKey(g.organizationId, ref)) return { ok: false, error: "Set the job's address in the studio (or save the deck) to keep these edits." };
  const edits = normalizePlanEdits(input.edits);
  if (JSON.stringify(edits).length > MAX_EDITS_JSON) return { ok: false, error: "The edits are too long to keep — take out a long card or two." };
  try {
    await writePlanEdits(g.organizationId, ref, edits);
    return { ok: true, edits };
  } catch (err) {
    logServerError("deck-plan-edits", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The edits could not be saved. Try again in a moment." };
  }
}
