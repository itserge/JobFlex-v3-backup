import "server-only";
// THE $1 CARD CHECK AT A TRIAL SIGN-UP (owner, 2026-11-11).
//
// Stripe's trial Checkout only proves that a card exists (a SetupIntent), so a card with nothing on it starts a trial.
// On the return from the sign-up's Checkout, BEFORE the account is made (actions/signupCheckout completePendingSignup),
// the card just saved is asked for $1.00 on hold — a PaymentIntent with capture_method "manual", off_session, confirmed
// at once — and the hold is cancelled the moment it is granted. Three answers:
//
//   passed    the bank granted it (requires_capture) → released at once → the account, the trial, /dashboard
//   declined  a card refusal (insufficient_funds, card_declined, do_not_honor …) → NO account; the subscription this
//             Checkout made is cancelled at Stripe; the sign-up goes back to the card page with one line
//   skipped   anything else — the network, a Stripe error, 3D Secure asked for (requires_action /
//             authentication_required), a method that takes no hold — the sign-up goes on as before, and the log says
//             "[signup] card hold skipped" with the reason. A failure of OUR check never stops a sign-up.
//
// ONCE PER SIGN-UP: the PaymentIntent's idempotency key is the Checkout Session's id, and the outcome is kept in
// SyncState `signupCardHold:<sessionId>` (read by Admin → Trial watch). A second return, a reload, a second tab reads
// the kept outcome; the webhook makes no hold at all. Every hold carries metadata jfKind "signup_card_hold"; the
// hourly trials cron (sweepSignupCardHolds) cancels any such PaymentIntent still open after ten minutes, and a
// declined sign-up's subscription whose cancel did not go through.
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import type { StripeMode } from "@/lib/stripeMode";
import { CARD_HOLD_STATEMENT_SUFFIX } from "@/lib/signupCardHoldWords";

export const SIGNUP_CARD_HOLD_KIND = "signup_card_hold";
const HOLD_CENTS = 100;
const CALL_TIMEOUT_MS = 8_000;
/** A hold still open after this long is the sweep's to cancel. */
export const STALE_HOLD_MS = 10 * 60 * 1000;
const KEY_PREFIX = "signupCardHold:";
const holdKey = (sessionId: string) => `${KEY_PREFIX}${sessionId}`;

export type CardHoldOutcome = "passed" | "declined" | "skipped";

export type CardHoldRecord = {
  at: string;
  sessionId: string;
  email: string;
  plan: string | null;
  interval: string | null;
  /** The new plans' main tool ("" none) — so "Try another card" reopens the same card page. */
  tool?: string | null;
  result: CardHoldOutcome;
  /** declined: the bank's code (decline_code, else the error code). */
  code?: string | null;
  /** skipped: why. */
  reason?: string | null;
  paymentIntentId?: string | null;
  /** passed: the hold was cancelled. */
  released?: boolean;
  /** declined: the Checkout's subscription was cancelled at Stripe. */
  subId?: string | null;
  subCanceled?: boolean;
  /** passed / skipped: the account the sign-up made. */
  orgId?: string | null;
  livemode?: boolean;
};

export async function readCardHold(sessionId: string): Promise<CardHoldRecord | null> {
  const row = await db.syncState.findUnique({ where: { key: holdKey(sessionId) } }).catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.cursor) as CardHoldRecord;
  } catch {
    return null;
  }
}

async function writeCardHold(rec: CardHoldRecord): Promise<void> {
  const cursor = JSON.stringify(rec);
  await db.syncState
    .upsert({ where: { key: holdKey(rec.sessionId) }, create: { key: holdKey(rec.sessionId), cursor }, update: { cursor } })
    .catch((err) => console.warn("[signup] card hold record not written:", err instanceof Error ? err.message : err));
}

/** After the account exists: which shop this check let in (Admin → Trial watch). */
export async function noteCardHoldAccount(sessionId: string, orgId: string): Promise<void> {
  const rec = await readCardHold(sessionId);
  if (rec && !rec.orgId) await writeCardHold({ ...rec, orgId });
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idOf = (v: string | { id: string } | null | undefined) => (!v ? null : typeof v === "string" ? v : v.id);
type StripeErr = { type?: string; code?: string; decline_code?: string; message?: string; payment_intent?: { id: string; status: string } };

/** Cancel a PaymentIntent; three tries. A PaymentIntent already cancelled counts as done. */
async function releaseHold(stripe: Stripe, id: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try {
      await stripe.paymentIntents.cancel(id, {}, { timeout: CALL_TIMEOUT_MS });
      return true;
    } catch (err) {
      const e = err as StripeErr;
      if (e.code === "payment_intent_unexpected_state") {
        const pi = await stripe.paymentIntents.retrieve(id).catch(() => null);
        if (pi?.status === "canceled") return true;
      }
      console.warn(`[signup] card hold ${id}: cancel try ${i + 1} failed —`, e.message ?? err);
      if (i < 2) await pause(400 * (i + 1));
    }
  }
  return false;
}

/** The method the Checkout saved: the subscription's default, else the SetupIntent's, else the customer's default. */
async function savedPaymentMethod(stripe: Stripe, session: Stripe.Checkout.Session, sub: Stripe.Subscription | null): Promise<string | null> {
  const fromSub = idOf(sub?.default_payment_method as string | { id: string } | null | undefined);
  if (fromSub) return fromSub;
  const si = idOf(session.setup_intent as string | { id: string } | null);
  if (si) {
    const setup = await stripe.setupIntents.retrieve(si, {}, { timeout: CALL_TIMEOUT_MS });
    const pm = idOf(setup.payment_method as string | { id: string } | null);
    if (pm) return pm;
  }
  const customer = idOf(session.customer as string | { id: string } | null);
  if (customer) {
    const c = await stripe.customers.retrieve(customer, {}, { timeout: CALL_TIMEOUT_MS });
    if (!("deleted" in c && c.deleted)) return idOf((c as Stripe.Customer).invoice_settings?.default_payment_method as string | { id: string } | null);
  }
  return null;
}

/**
 * The check itself. Never throws: whatever goes wrong on our side is "skipped".
 * Call it only for a trial sign-up's completed Checkout (the subscription trialing).
 */
export async function checkSignupCard(input: {
  stripe: Stripe;
  mode: StripeMode;
  session: Stripe.Checkout.Session;
  sub: Stripe.Subscription | null;
  token: string;
  email: string;
}): Promise<CardHoldRecord & { fresh?: true }> {
  const { stripe, mode, session, sub, token, email } = input;
  const kept = await readCardHold(session.id);
  if (kept) {
    // A hold granted earlier whose cancel never went through: try again now (the sweep would too).
    if (kept.result === "passed" && !kept.released && kept.paymentIntentId) {
      const released = await releaseHold(stripe, kept.paymentIntentId);
      if (released) await writeCardHold({ ...kept, released });
      return { ...kept, released };
    }
    return kept;
  }
  const base: Omit<CardHoldRecord, "result"> = {
    at: new Date().toISOString(),
    sessionId: session.id,
    email,
    plan: (session.metadata?.planSlug as string | undefined) ?? null,
    interval: (session.metadata?.interval as string | undefined) ?? null,
    tool: (session.metadata?.mainTool as string | undefined) ?? null,
    subId: sub?.id ?? idOf(session.subscription as string | { id: string } | null),
    livemode: session.livemode,
  };
  const skip = async (reason: string, paymentIntentId: string | null = null): Promise<CardHoldRecord> => {
    console.warn(`[signup] card hold skipped: ${reason} (${session.id})`);
    const rec: CardHoldRecord = { ...base, result: "skipped", reason, paymentIntentId };
    await writeCardHold(rec);
    return rec;
  };

  let paymentMethod: string | null;
  try {
    paymentMethod = await savedPaymentMethod(stripe, session, sub);
  } catch (err) {
    return skip(`payment_method_read: ${(err as StripeErr).message ?? String(err)}`.slice(0, 200));
  }
  if (!paymentMethod) return skip("no_payment_method");

  const create = async (): Promise<Stripe.PaymentIntent> => {
    // REHEARSALS ONLY (test-mode Stripe): a Stripe failure at this step, on demand, to prove a sign-up still goes on.
    if (mode === "test" && process.env.SIGNUP_CARD_HOLD_SIMULATE === "api_error") {
      throw Object.assign(new Error("Simulated Stripe API failure (SIGNUP_CARD_HOLD_SIMULATE)"), { type: "StripeAPIError", code: "simulated" });
    }
    const pm = await stripe.paymentMethods.retrieve(paymentMethod!, {}, { timeout: CALL_TIMEOUT_MS });
    return stripe.paymentIntents.create(
      {
        amount: HOLD_CENTS,
        currency: "usd",
        customer: idOf(session.customer as string | { id: string } | null) ?? undefined,
        payment_method: pm.id,
        // The saved method's own type (card, or link): nothing else is offered, nothing redirects.
        payment_method_types: [pm.type],
        capture_method: "manual",
        confirm: true,
        off_session: true,
        description: "JobFlex card check — a $1 hold, released at once",
        statement_descriptor_suffix: CARD_HOLD_STATEMENT_SUFFIX,
        metadata: { jfKind: SIGNUP_CARD_HOLD_KIND, checkoutSession: session.id, signupToken: token },
      },
      { idempotencyKey: `${SIGNUP_CARD_HOLD_KIND}:${session.id}`, timeout: CALL_TIMEOUT_MS },
    );
  };

  let pi: Stripe.PaymentIntent;
  try {
    try {
      pi = await create();
    } catch (err) {
      // The same key still in flight (a second tab, a reload a beat later): wait once, then Stripe answers with the first.
      if ((err as StripeErr).type !== "StripeIdempotencyError") throw err;
      await pause(1500);
      pi = await create();
    }
  } catch (err) {
    const e = err as StripeErr;
    const piId = e.payment_intent?.id ?? null;
    // A refused PaymentIntent sits at requires_payment_method — cancelled, so nothing of ours is left open.
    if (piId) await releaseHold(stripe, piId);
    if (e.type === "StripeCardError") {
      const code = e.decline_code || e.code || "card_declined";
      // 3D Secure asked for off session: the bank wants the person, not a refusal of the card (rule 3).
      if (code === "authentication_required" || e.code === "authentication_required") return skip("authentication_required", piId);
      // Stripe's own trouble reaching the card network.
      if (e.code === "processing_error") return skip("processing_error", piId);
      const rec: CardHoldRecord = { ...base, result: "declined", code, paymentIntentId: piId, subCanceled: false };
      await writeCardHold(rec);
      // Made by this call (not read back): the one the analyst is told about.
      return { ...rec, fresh: true };
    }
    return skip(`${e.type ?? "error"}${e.code ? `:${e.code}` : ""}${e.message ? ` — ${e.message}` : ""}`.slice(0, 240), piId);
  }

  if (pi.status === "requires_capture") {
    const released = await releaseHold(stripe, pi.id);
    if (!released) console.warn(`[signup] card hold ${pi.id} granted but not released — the trials cron cancels it`);
    const rec: CardHoldRecord = { ...base, result: "passed", paymentIntentId: pi.id, released };
    await writeCardHold(rec);
    return rec;
  }
  // requires_action (the bank's 3D Secure), processing (a bank debit) and anything else: not a hold we can read.
  if (pi.status !== "canceled" && pi.status !== "succeeded" && pi.status !== "processing") await releaseHold(stripe, pi.id);
  return skip(`status:${pi.status}`, pi.id);
}

/** The declined sign-up's subscription: cancelled at Stripe at once (no account will ever pay it). Three tries. */
export async function cancelDeclinedSubscription(stripe: Stripe, rec: CardHoldRecord): Promise<boolean> {
  if (!rec.subId) {
    await writeCardHold({ ...rec, subCanceled: true });
    return true;
  }
  for (let i = 0; i < 3; i++) {
    try {
      await stripe.subscriptions.cancel(rec.subId, {}, { timeout: CALL_TIMEOUT_MS });
      await writeCardHold({ ...rec, subCanceled: true });
      return true;
    } catch (err) {
      const e = err as StripeErr;
      // Already gone: the same answer.
      if (e.code === "resource_missing") {
        await writeCardHold({ ...rec, subCanceled: true });
        return true;
      }
      const live = await stripe.subscriptions.retrieve(rec.subId).catch(() => null);
      if (live && (live.status === "canceled" || live.status === "incomplete_expired")) {
        await writeCardHold({ ...rec, subCanceled: true });
        return true;
      }
      console.warn(`[signup] declined sign-up's subscription ${rec.subId}: cancel try ${i + 1} failed —`, e.message ?? err);
      if (i < 2) await pause(400 * (i + 1));
    }
  }
  return false;
}

/**
 * THE SWEEP (the hourly trials cron, /api/cron/trials): every hold of ours still open ten minutes after it was made
 * is cancelled — whatever left it (a cancel that failed three times, a server that stopped mid-check) — and a declined
 * sign-up's subscription whose cancel did not go through is cancelled now.
 */
export async function sweepSignupCardHolds(): Promise<{ checked: number; canceled: number; subsCanceled: number; failed?: string }> {
  const tally = { checked: 0, canceled: 0, subsCanceled: 0 };
  if (!isStripeEnabled()) return tally;
  const { stripe } = await getStripeClient();
  const cutoff = Math.floor((Date.now() - STALE_HOLD_MS) / 1000);
  const open = new Set(["requires_capture", "requires_action", "requires_confirmation", "requires_payment_method"]);
  let page: string | undefined;
  for (let n = 0; n < 5; n++) {
    const res = await stripe.paymentIntents.search({ query: `metadata['jfKind']:'${SIGNUP_CARD_HOLD_KIND}'`, limit: 100, ...(page ? { page } : {}) });
    for (const pi of res.data) {
      tally.checked += 1;
      if (!open.has(pi.status) || pi.created > cutoff) continue;
      if (await releaseHold(stripe, pi.id)) {
        tally.canceled += 1;
        console.info(`[signup] card hold ${pi.id} (${pi.status}) cancelled by the sweep`);
        const sessionId = pi.metadata?.checkoutSession;
        const rec = sessionId ? await readCardHold(sessionId) : null;
        if (rec && rec.result === "passed" && !rec.released) await writeCardHold({ ...rec, released: true });
      }
    }
    if (!res.has_more || !res.next_page) break;
    page = res.next_page;
  }
  // Declined sign-ups of the last week whose subscription is still standing.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db.syncState.findMany({ where: { key: { startsWith: KEY_PREFIX }, updatedAt: { gte: since } }, take: 500 });
  for (const row of rows) {
    let rec: CardHoldRecord;
    try {
      rec = JSON.parse(row.cursor) as CardHoldRecord;
    } catch {
      continue;
    }
    if (rec.result !== "declined" || rec.subCanceled) continue;
    if (await cancelDeclinedSubscription(stripe, rec)) tally.subsCanceled += 1;
  }
  return tally;
}

/** Admin → Trial watch: the latest checks, newest first. */
export async function recentCardHolds(limit = 30): Promise<Array<CardHoldRecord & { orgName: string | null }>> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: KEY_PREFIX } }, orderBy: { updatedAt: "desc" }, take: limit }).catch(() => []);
  const recs = rows.flatMap((r) => {
    try {
      return [JSON.parse(r.cursor) as CardHoldRecord];
    } catch {
      return [];
    }
  });
  const orgIds = recs.map((r) => r.orgId).filter((x): x is string => !!x);
  const orgs = orgIds.length ? await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }).catch(() => []) : [];
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  return recs
    .map((r) => ({ ...r, orgName: r.orgId ? (names.get(r.orgId) ?? null) : null }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** The webhook's guard: an event about one of these holds is ours alone and moves nothing else. */
export function isSignupCardHoldObject(obj: { metadata?: Stripe.Metadata | null } | null | undefined): boolean {
  return obj?.metadata?.jfKind === SIGNUP_CARD_HOLD_KIND;
}
