import { NextResponse, after } from "next/server";
import { inboundConfig } from "@/lib/subInbound/config";
import { ingestReceivedEmail, type IngestResult, type ReceivedEmail } from "@/lib/subInbound/server";
import { claimsClientEmail, fileInboundEmail, type InboxIngest } from "@/lib/inbox/server";
import { runPendingReads } from "@/lib/subQuotes/server";
import { verifyWebhook, webhookHeaders } from "@/lib/supportInbound";
import { runWebhookEnvelope } from "@/lib/webhookEnvelope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Reading the letter back, downloading its attachments, keeping them, one database round for the version.
export const maxDuration = 60;

// QUOTES BY EMAIL — Resend Inbound's webhook (2026-11-08, the subcontractors plan, part 2; lib/subInbound). Resend
// posts `email.received` for every letter to the receiving subdomain (SUBS_INBOUND_DOMAIN), signed in the Standard
// Webhooks way with SUBS_INBOUND_WEBHOOK_SECRET; the payload names the letter, the words and the attachments are
// read back from Resend (RESEND_INBOUND_API_KEY). The request is the token in the address it was sent to
// (rfq-<token>@…); the sub's document becomes a version on their quote and its AI read is queued; anything that
// does not match is held for a person (Quotes & Proposals → Mail to match). The provider's id is the idempotency key
// (WebhookEvent, provider RESEND): a redelivery is a no-op; a failure answers 500 so Resend retries.
//
// Off (no secret or domain in the environment): 503, and nothing is read. A bad signature: 401.

export async function POST(req: Request) {
  const cfg = inboundConfig();
  if (!cfg.secret || !cfg.domain) return NextResponse.json({ ok: false, error: "Quotes by email are not switched on." }, { status: 503 });

  const raw = await req.text();
  if (!verifyWebhook(webhookHeaders((n) => req.headers.get(n)), raw, cfg.secret)) {
    return NextResponse.json({ ok: false, error: "Bad signature." }, { status: 401 });
  }

  let event: { type?: string; data?: ReceivedEmail };
  try {
    event = JSON.parse(raw) as { type?: string; data?: ReceivedEmail };
  } catch {
    return NextResponse.json({ ok: true, dropped: "not-json" });
  }
  if (event.type !== "email.received" || !event.data?.email_id) {
    return NextResponse.json({ ok: true, dropped: "not-a-received-email", type: event.type ?? null });
  }
  const d = event.data;

  // THE INBOX (Smart CRM part 2, 2026-11-08): a client's letter — the thread address c-<token>@…, or a sender
  // exactly one live client wears — files into their thread; everything else is the subcontractors' as before.
  const claim = await claimsClientEmail(d).catch(() => null);
  const box: { result: IngestResult | null; inbox: InboxIngest | null } = { result: null, inbox: null };
  const env = await runWebhookEnvelope({ provider: "RESEND", eventId: d.email_id, type: "email.received" }, async () => {
    if (claim) box.inbox = await fileInboundEmail(d, claim);
    else box.result = await ingestReceivedEmail(d);
  });
  if (env.outcome === "failed") return NextResponse.json({ ok: false, error: env.error }, { status: 500 });
  if (env.outcome === "duplicate") return NextResponse.json({ ok: true, outcome: "duplicate" });
  if (claim) {
    console.info(`[inbound-email] ${d.email_id}: inbox ${box.inbox?.outcome ?? "?"} — ${box.inbox?.words ?? ""}`);
    return NextResponse.json({ ok: true, inbox: box.inbox?.outcome ?? null });
  }

  // The read runs once the answer is out; the ten-minute sweep picks up whatever this misses.
  if (box.result?.outcome === "matched" && box.result.versionId) {
    after(async () => {
      await runPendingReads(2).catch((err: unknown) => console.warn(`[inbound-email] read after the letter failed: ${err instanceof Error ? err.message : String(err)}`));
    });
  }
  console.info(`[inbound-email] ${d.email_id}: ${box.result?.outcome ?? "?"} — ${box.result?.words ?? ""}`);
  return NextResponse.json({ ok: true, ...(box.result ?? {}) });
}
