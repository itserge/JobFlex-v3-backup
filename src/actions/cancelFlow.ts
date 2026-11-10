"use server";
// THE CANCEL QUESTIONS' TWO EVENTS (owner, 2026-11-09; lib/cancelTree).
// The window (components/billing/CancelFlow) reports each screen it shows
// (cancel_flow_step) and the screen it was closed on without cancelling —
// the cross, the scrim, Esc or a Keep button (cancel_flow_abandoned). Nothing
// else is written: no row, no answer. The step and the path are closed
// vocabularies; anything else is dropped. Owner only, like the window.
import { requireOwner } from "@/lib/orgContext";
import { trackActivation } from "@/lib/activation-events";
import { isCancelPath, isFlowStep } from "@/lib/cancelTree";

export async function trackCancelFlow(raw: unknown): Promise<void> {
  const r = (raw && typeof raw === "object" ? raw : {}) as { kind?: unknown; step?: unknown; path?: unknown; how?: unknown };
  if (!isFlowStep(r.step)) return;
  const { organizationId } = await requireOwner();
  const path = isCancelPath(r.path) ? r.path : "none";
  if (r.kind === "abandoned") {
    const how = r.how === "keep" ? "keep" : "close";
    trackActivation("cancel_flow_abandoned", organizationId, { step: r.step, path, how });
    return;
  }
  trackActivation("cancel_flow_step", organizationId, { step: r.step, path });
}
