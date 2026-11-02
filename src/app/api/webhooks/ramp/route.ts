// POST /api/webhooks/ramp — Ramp tells JobFlex a card transaction cleared, needs a job, or got its receipt
// (2026-10-29); a bill was approved or paid; an invited person accepted (round 2). Two kinds of request: the verification challenge when the subscription is made (answered through
// Ramp's verify endpoint), and the business events, each signed with the subscription's secret (X-Ramp-Signature,
// HMAC-SHA256 of the raw body). An event names the business and the transaction; the transaction is read from the
// API and processed like any other. Always 200 once the signature holds, so Ramp does not retry forever.
import crypto from "node:crypto";
import { after, NextResponse } from "next/server";
import { orgOfRampBusiness, orgOfRampWebhook, patchRampConnection, rampApiFor, readRampConnection } from "@/lib/ramp/connection";
import { processRampTransaction } from "@/lib/ramp/sync";
import { refreshRampBill } from "@/lib/ramp/bills";
import { resumeRampCardOrders } from "@/lib/ramp/cards";
import { rampEventTransactionId, rampSignatureMatches } from "@/lib/ramp/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hmacHex = (secret: string, raw: string) => crypto.createHmac("sha256", secret).update(raw).digest("hex");
const hmacB64 = (secret: string, raw: string) => crypto.createHmac("sha256", secret).update(raw).digest("base64");

type Payload = { id?: string; type?: string; business_id?: string; webhook_id?: string; challenge?: string; object?: Record<string, unknown> | null };

export async function POST(req: Request) {
  const raw = await req.text();
  let payload: Payload;
  try {
    payload = JSON.parse(raw) as Payload;
  } catch {
    return NextResponse.json({ error: "Not JSON" }, { status: 400 });
  }
  const type = payload.type ?? "";

  // The subscription's own verification: find the subscription, answer the challenge through the API.
  if (type === "webhooks.verification" || (payload.challenge && !payload.business_id)) {
    const challenge = String(payload.challenge ?? payload.object?.challenge ?? "");
    const webhookId = String(payload.webhook_id ?? payload.object?.webhook_id ?? payload.object?.id ?? "");
    const organizationId = (webhookId ? await orgOfRampWebhook(webhookId) : null) ?? (payload.business_id ? await orgOfRampBusiness(payload.business_id) : null);
    if (!organizationId || !challenge) return NextResponse.json({ ok: false }, { status: 404 });
    const got = await rampApiFor(organizationId);
    if (!got) return NextResponse.json({ ok: false }, { status: 404 });
    const id = webhookId || got.conn.webhookId || "";
    try {
      const r = await got.api.verifyWebhook(id, challenge);
      if (r.success) await patchRampConnection(organizationId, { webhookVerified: true });
      return NextResponse.json({ ok: !!r.success });
    } catch {
      return NextResponse.json({ ok: false }, { status: 502 });
    }
  }

  const businessId = payload.business_id ?? "";
  const organizationId = businessId ? await orgOfRampBusiness(businessId) : null;
  if (!organizationId) return NextResponse.json({ ok: true, ignored: "unknown business" });
  const conn = await readRampConnection(organizationId);
  if (!conn) return NextResponse.json({ ok: true, ignored: "not connected" });
  if (!conn.webhookSecret || !rampSignatureMatches(raw, conn.webhookSecret, req.headers.get("x-ramp-signature"), hmacHex, hmacB64)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  // A bill moved (approved, paid, rejected…): read it again; paid books the job's expense.
  if (type.startsWith("bills.")) {
    const billId = String(payload.object?.id ?? payload.object?.bill_id ?? (payload as { data?: { id?: string } }).data?.id ?? "");
    if (billId) after(async () => {
      try {
        await refreshRampBill(organizationId, billId);
      } catch (err) {
        console.warn("[ramp] webhook", type, billId, err instanceof Error ? err.message : err);
      }
    });
    return NextResponse.json({ ok: true });
  }
  // Someone accepted Ramp's invite: a card order waiting on them goes ahead.
  if (type === "users.invite_accepted") {
    after(async () => {
      await resumeRampCardOrders(organizationId).catch((err) => console.warn("[ramp] webhook invite", err instanceof Error ? err.message : err));
    });
    return NextResponse.json({ ok: true });
  }
  if (!type.startsWith("transactions.")) return NextResponse.json({ ok: true, ignored: type });
  const txId = rampEventTransactionId(payload);
  if (!txId) return NextResponse.json({ ok: true, ignored: "no transaction id" });
  after(async () => {
    try {
      const got = await rampApiFor(organizationId);
      if (!got) return;
      const tx = await got.api.transaction(txId);
      await processRampTransaction(organizationId, got.conn, got.api, tx);
      await patchRampConnection(organizationId, { webhookVerified: true });
    } catch (err) {
      console.warn("[ramp] webhook", type, txId, err instanceof Error ? err.message : err);
    }
  });
  return NextResponse.json({ ok: true });
}
