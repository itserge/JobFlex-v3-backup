// MINUTE PACKS, BOUGHT — server only. The Lead Center's card-on-file flow
// (lib/leadCenter/purchase) applied to one product: 300 minutes for $29. Charged to the
// card the subscription bills ("Charge $29 to Visa •4242?"), or paid on Stripe Checkout;
// the return page or the webhook lands it on the balance (lib/aiDesk/minutes
// addPackSeconds — once per payment), with an expense in the company's books and a line
// on the trail. Auto top-up charges the card off-session when the balance runs out.
import { createHash } from "crypto";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import { brandLabel, cardOnFile } from "@/lib/leadCenter/purchase";
import type { DeskMinutesData } from "@/components/v3/settings-blueprint/settings-data";
import { ExpensePaidBy, ExpenseStatus } from "@/lib/prismaEnums";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { DESK_PACK, dollars, type DeskBalance, type DeskPackRecord, type DeskPackVia } from "./shared";
import { addPackSeconds, deskBalanceFor, ownerOf, readDeskPacks, tellOwner } from "./minutes";
import { CARD_ONLY_CHECKOUT } from "@/lib/stripeCheckoutCard";

export const PACK_PURPOSE = "desk-pack";
export const PACK_EXPENSE_CATEGORY = "AI desk minutes";
export const PACK_EXPENSE_PURPOSE = "DESK";

export type PackBuyer = { organizationId: string; userId: string | null; email: string | null };

export type PackStep =
  | { kind: "added"; minutes: number; balance: DeskBalance; history: DeskPackRecord[]; card: { brand: string; last4: string } | null }
  | { kind: "confirm"; amountCents: number; brand: string; last4: string }
  | { kind: "checkout"; url: string; reason?: string }
  | { kind: "no-billing"; reason: string };

const describe = () => `JobFlex AI desk · ${DESK_PACK.minutes} minutes`;

function metadataFor(buyer: PackBuyer, via: DeskPackVia): Record<string, string> {
  return { jf_purpose: PACK_PURPOSE, jf_via: via, organizationId: buyer.organizationId, userId: buyer.userId ?? "", minutes: String(DESK_PACK.minutes), priceCents: String(DESK_PACK.cents) };
}

/** A second request under the same key while the first is in flight is answered 409 by Stripe. */
async function withIdempotencyRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const e = err as { type?: string; code?: string };
      const inFlight = e?.type === "StripeIdempotencyError" || e?.code === "idempotency_key_in_use";
      if (!inFlight || i >= 4) throw err;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
}

/** "Add 300 minutes": a card to confirm, or Checkout. */
export async function startPackPurchase(buyer: PackBuyer, baseUrl: string): Promise<PackStep> {
  const { stripe } = await getStripeClient();
  const card = await cardOnFile(stripe, buyer.organizationId);
  if (card) return { kind: "confirm", amountCents: DESK_PACK.cents, brand: brandLabel(card.brand), last4: card.last4 };
  return { kind: "checkout", url: await checkoutUrl(stripe, buyer, null, baseUrl) };
}

/** Stripe Checkout, mode=payment — one session per buyer and quarter-hour (a double click is one page). */
async function checkoutUrl(stripe: Stripe, buyer: PackBuyer, customerId: string | null, baseUrl: string): Promise<string> {
  const metadata = metadataFor(buyer, "checkout");
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    ...CARD_ONLY_CHECKOUT,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: DESK_PACK.cents,
          product_data: { name: describe(), description: `${DESK_PACK.minutes} minutes for the AI desk, used after the plan's included minutes. They don't expire.` },
        },
      },
    ],
    ...(customerId ? { customer: customerId } : buyer.email ? { customer_email: buyer.email } : {}),
    payment_intent_data: { description: describe(), metadata, ...(buyer.email ? { receipt_email: buyer.email } : {}) },
    metadata,
    client_reference_id: buyer.organizationId,
    success_url: `${baseUrl}/dashboard/settings?pane=desk&pack_paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/dashboard/settings?pane=desk&pack_checkout=cancelled`,
  };
  const bucket = Math.floor(Date.now() / 900_000);
  const salt = createHash("sha256").update([buyer.organizationId, buyer.userId ?? "", baseUrl, String(bucket)].join("|")).digest("hex").slice(0, 16);
  const session = await withIdempotencyRetry(() => stripe.checkout.sessions.create(params, { idempotencyKey: `jf-desk-pack-checkout-${salt}` }));
  if (!session.url) throw new Error("Stripe did not return a checkout page.");
  return session.url;
}

/** "Charge $29 to Visa •4242" confirmed — or auto top-up (`via: "auto"`, which never sends anyone to Checkout). */
export async function chargePackOnFile(buyer: PackBuyer, baseUrl: string, via: "card-on-file" | "auto" = "card-on-file"): Promise<PackStep> {
  const { stripe } = await getStripeClient();
  const [card, packsBefore] = await Promise.all([cardOnFile(stripe, buyer.organizationId), readDeskPacks(buyer.organizationId)]);
  if (!card) return via === "auto" ? { kind: "no-billing", reason: "There is no card on file." } : { kind: "checkout", url: await checkoutUrl(stripe, buyer, null, baseUrl) };

  let pi: Stripe.PaymentIntent | null = null;
  let reason = "";
  try {
    pi = await withIdempotencyRetry(() =>
      stripe.paymentIntents.create(
        {
          amount: DESK_PACK.cents,
          currency: "usd",
          customer: card.customerId,
          payment_method: card.paymentMethodId,
          off_session: true,
          confirm: true,
          description: describe(),
          metadata: metadataFor(buyer, via),
          ...(buyer.email ? { receipt_email: buyer.email } : {}),
        },
        // A double click is one charge (same pack count, same minute); the next pack — a
        // top-up right after a purchase — is a new one.
        { idempotencyKey: `jf-desk-pack-pi-${buyer.organizationId}-${packsBefore.history.length}-${Math.floor(Date.now() / 60_000)}` },
      ),
    );
  } catch (err) {
    const e = err as { type?: string; code?: string; message?: string; raw?: { payment_intent?: { id?: string } } };
    if (e?.type !== "StripeCardError") throw err;
    reason = e.code === "authentication_required" ? "Your bank wants to confirm this payment — finish it on Stripe's page." : "The card on file was declined — pay on Stripe's page with another card.";
    await cancelQuietly(stripe, e.raw?.payment_intent?.id);
  }

  if (pi?.status === "succeeded") {
    const cardWords = { brand: brandLabel(card.brand), last4: card.last4 };
    await landPack({ organizationId: buyer.organizationId, paymentIntentId: pi.id, amountCents: pi.amount_received || pi.amount, via, userId: buyer.userId, card: cardWords });
    const [balance, packs] = await Promise.all([deskBalanceFor(buyer.organizationId), readDeskPacks(buyer.organizationId)]);
    return { kind: "added", minutes: DESK_PACK.minutes, balance, history: packs.history, card: cardWords };
  }
  if (pi) {
    // requires_action (3-D Secure) — never confirmed here; Checkout asks for it.
    reason ||= "Your bank wants to confirm this payment — finish it on Stripe's page.";
    await cancelQuietly(stripe, pi.id);
  }
  if (via === "auto") return { kind: "no-billing", reason: reason || "The card could not be charged." };
  return { kind: "checkout", url: await checkoutUrl(stripe, buyer, card.customerId, baseUrl), reason };
}

async function cancelQuietly(stripe: Stripe, id: string | null | undefined) {
  if (!id) return;
  await stripe.paymentIntents.cancel(id).catch(() => {});
}

/** The pack on the balance, the expense in the books, the trail — once per payment. */
async function landPack(fact: { organizationId: string; paymentIntentId: string; amountCents: number; via: DeskPackVia; userId: string | null; card: { brand: string; last4: string } | null }): Promise<boolean> {
  const { added } = await addPackSeconds(fact.organizationId, { minutes: DESK_PACK.minutes, cents: fact.amountCents, via: fact.via, ref: fact.paymentIntentId });
  if (!added) return false;
  await db.jobExpense
    .create({
      data: {
        organizationId: fact.organizationId,
        jobId: null,
        category: PACK_EXPENSE_CATEGORY,
        amount: fact.amountCents / 100,
        note: `${DESK_PACK.minutes} minutes for the AI desk · Stripe ${fact.paymentIntentId}`,
        vendor: "JobFlex",
        paidBy: ExpensePaidBy.COMPANY,
        status: ExpenseStatus.APPROVED,
        purpose: PACK_EXPENSE_PURPOSE,
        submittedById: fact.userId,
        spentAt: new Date(),
      },
    })
    .catch((err: unknown) => console.warn("[aiDesk] pack expense not booked:", err));
  const cardWords = fact.card ? `${fact.card.brand} •${fact.card.last4}` : null;
  await logActivity({ organizationId: fact.organizationId, actorId: fact.userId, kind: TRAIL_KINDS.EXPENSE, summary: `${DESK_PACK.minutes} AI desk minutes added — ${dollars(fact.amountCents)}${cardWords ? ` to ${cardWords}` : ""}${fact.via === "auto" ? " (auto top-up)" : ""}` }).catch(() => null);
  if (fact.via === "auto") await tellOwner(fact.organizationId, "auto-bought", cardWords);
  return true;
}

const refId = (v: string | { id: string } | null | undefined): string | null => (typeof v === "string" ? v : (v?.id ?? null));

/** Back from Checkout (`?pane=desk&pack_paid=1&session_id=…`). */
export async function finishPackCheckout(organizationId: string, sessionId: string): Promise<{ status: "added" | "pending" | "invalid"; already?: boolean }> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return { status: "invalid" };
  const { stripe } = await getStripeClient();
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return { status: "invalid" };
  }
  if (session.metadata?.jf_purpose !== PACK_PURPOSE || session.metadata.organizationId !== organizationId) return { status: "invalid" };
  if (session.payment_status !== "paid") return { status: "pending" };
  const pi = refId(session.payment_intent);
  if (!pi) return { status: "invalid" };
  const added = await landPack({ organizationId, paymentIntentId: pi, amountCents: session.amount_total ?? DESK_PACK.cents, via: "checkout", userId: session.metadata.userId || null, card: null });
  return { status: "added", already: !added };
}

/** The webhook's checkout.session.completed: true when the session was a pack (handled or not ours to handle further). */
export async function completeFromPackSession(session: Stripe.Checkout.Session): Promise<boolean> {
  if (session.metadata?.jf_purpose !== PACK_PURPOSE) return false;
  const organizationId = session.metadata.organizationId;
  const pi = refId(session.payment_intent);
  if (!organizationId || !pi || session.payment_status !== "paid") return true;
  await landPack({ organizationId, paymentIntentId: pi, amountCents: session.amount_total ?? DESK_PACK.cents, via: "checkout", userId: session.metadata.userId || null, card: null });
  return true;
}

/** The settings card's data: the balance, the packs, the card the one-click buy would charge. */
export async function deskMinutesView(organizationId: string): Promise<DeskMinutesData> {
  const [balance, packs] = await Promise.all([deskBalanceFor(organizationId), readDeskPacks(organizationId)]);
  let card: DeskMinutesData["card"] = null;
  let billingOn = isStripeEnabled();
  if (billingOn) {
    try {
      const { stripe } = await getStripeClient();
      const c = await cardOnFile(stripe, organizationId);
      if (c) card = { brand: brandLabel(c.brand), last4: c.last4 };
    } catch {
      billingOn = false;
    }
  }
  return { balance, history: packs.history, pack: { minutes: DESK_PACK.minutes, cents: DESK_PACK.cents }, card, autoFailedAt: packs.autoFailedAt, billingOn };
}

/** Auto top-up: the owner's card, off-session, no page involved. */
export async function autoBuyPack(organizationId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const owner = await ownerOf(organizationId);
  const step = await chargePackOnFile({ organizationId, userId: owner.userId, email: owner.email }, "", "auto");
  if (step.kind === "added") return { ok: true };
  if (step.kind === "no-billing") return { ok: false, error: step.reason };
  return { ok: false, error: step.kind === "checkout" ? (step.reason ?? "The card could not be charged.") : "The card could not be charged." };
}
