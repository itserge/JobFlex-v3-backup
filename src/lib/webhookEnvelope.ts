// Webhook idempotency envelope, shared by every inbound provider route
// (Stripe platform, Stripe Connect, Square). One WebhookEvent row per
// (provider, eventId): a PROCESSED duplicate is dropped before any side
// effect; a FAILED or RECEIVED row (handler threw / crashed mid-flight, the
// provider is retrying) re-dispatches — otherwise a transient error would
// turn the retry into a "duplicate" 200 and the event would be lost.
import { credentialErrorMessage } from "./payments/credentialErrors";
import { db } from "@/lib/db";
import { WebhookEventStatus } from "@/lib/prismaEnums";
import { logServerError } from "@/lib/server-events";

export type EnvelopeResult =
  | { outcome: "duplicate" }
  | { outcome: "processed" }
  | { outcome: "failed"; error: string };

export async function runWebhookEnvelope(
  meta: { provider: "STRIPE" | "SQUARE" | "STAX" | "WISETACK" | "RESEND"; eventId: string; type: string },
  handler: () => Promise<void>,
): Promise<EnvelopeResult> {
  const where = { provider_eventId: { provider: meta.provider, eventId: meta.eventId } };
  try {
    await db.webhookEvent.create({
      data: {
        provider: meta.provider,
        eventId: meta.eventId,
        type: meta.type,
        status: WebhookEventStatus.RECEIVED,
      },
    });
  } catch (createErr) {
    const existing = await db.webhookEvent.findUnique({ where });
    if (!existing) throw createErr;
    if (existing.status === WebhookEventStatus.PROCESSED) return { outcome: "duplicate" };
  }

  try {
    await handler();
    await db.webhookEvent.update({
      where,
      data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date(), error: null },
    });
    return { outcome: "processed" };
  } catch (err: unknown) {
    // Resend (inbound mail) has no credential dictionary: its errors are reported as they come.
    const msg = meta.provider === "RESEND" ? (err instanceof Error ? err.message : String(err)) : credentialErrorMessage(meta.provider === "STRIPE" ? "Stripe" : meta.provider === "SQUARE" ? "Square" : meta.provider === "WISETACK" ? "Wisetack" : "Stax", err);
    // The route answers 500 and the provider retries; this is where the
    // failure is seen — `server_error`, scoped to provider and event type.
    logServerError(`webhooks/${meta.provider.toLowerCase()}:${meta.type}`, new Error(msg), { kind: "webhook" });
    await db.webhookEvent.update({
      where,
      data: { status: WebhookEventStatus.FAILED, error: msg.slice(0, 1000) },
    });
    return { outcome: "failed", error: msg };
  }
}
