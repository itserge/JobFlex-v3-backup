// Server-only: the mail a partner gets when their money moves.
//
// Sent from the places that change the status — approve, reject, the payout
// run's close-of-books, a dispute opening, a dispute lost — never from a page.
// Every send is best-effort: a mail outage must not fail a money path, so
// each one logs and returns false. On the dev server EMAIL_DEV_OUTBOX=<dir>
// writes them as .html files instead (lib/sdk/resend).

import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { LedgerEntryState, LedgerEntryType } from "@/lib/prismaEnums";
import type { EmailDoc } from "@/lib/email/doc";

const usd = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * The daily payout run is 06:30 UTC (vercel.json). An approval before that is
 * sent today; one after it goes out tomorrow.
 */
export function nextPayoutRunDate(now: Date = new Date()): Date {
  const run = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6, 30));
  if (now.getTime() >= run.getTime()) run.setUTCDate(run.getUTCDate() + 1);
  return run;
}

async function deliver(to: string, doc: EmailDoc): Promise<boolean> {
  try {
    const { sendEmail } = await import("@/lib/sdk/resend");
    const { renderEmail } = await import("@/lib/email/renderEmail");
    const { subject, html } = renderEmail(doc);
    await sendEmail({ mailClass: "transactional", to, subject, html });
    return true;
  } catch (err) {
    console.warn("[influencerMail] send failed:", err);
    return false;
  }
}

async function payoutsHref() {
  return `${await appBaseUrl()}/influencer/payouts`;
}

export async function mailPayoutApproved(requestId: string): Promise<boolean> {
  const req = await db.payoutRequest.findUnique({
    where: { id: requestId },
    select: { amountCents: true, influencer: { select: { email: true, displayName: true } } },
  });
  if (!req) return false;
  const { buildPartnerPayoutApproved } = await import("@/lib/email/build/platform");
  return deliver(
    req.influencer.email,
    buildPartnerPayoutApproved({
      name: req.influencer.displayName,
      amount: usd(req.amountCents),
      expectedDate: day(nextPayoutRunDate()),
      href: await payoutsHref(),
    }),
  );
}

export async function mailPayoutDeclined(requestId: string): Promise<boolean> {
  const req = await db.payoutRequest.findUnique({
    where: { id: requestId },
    select: { amountCents: true, rejectedReason: true, influencer: { select: { email: true, displayName: true } } },
  });
  if (!req) return false;
  const { buildPartnerPayoutDeclined } = await import("@/lib/email/build/platform");
  return deliver(
    req.influencer.email,
    buildPartnerPayoutDeclined({
      name: req.influencer.displayName,
      amount: usd(req.amountCents),
      reason: req.rejectedReason,
      href: await payoutsHref(),
    }),
  );
}

export async function mailPayoutSent(transferId: string): Promise<boolean> {
  const t = await db.payoutTransfer.findUnique({
    where: { id: transferId },
    select: {
      amountCents: true,
      stripeTransferId: true,
      stripeConnectAccountId: true,
      influencer: { select: { email: true, displayName: true } },
    },
  });
  if (!t) return false;
  const { buildPartnerPayoutSent } = await import("@/lib/email/build/platform");
  return deliver(
    t.influencer.email,
    buildPartnerPayoutSent({
      name: t.influencer.displayName,
      amount: usd(t.amountCents),
      accountLast4: t.stripeConnectAccountId.slice(-4),
      reference: t.stripeTransferId,
      href: await payoutsHref(),
    }),
  );
}

/** Every partner with commission now HELD on this payment — one mail each. */
export async function mailCommissionHeld(chargeId: string, openedAt: Date): Promise<number> {
  const rows = await db.commissionLedger.findMany({
    where: { stripeChargeId: chargeId, state: LedgerEntryState.HELD },
    select: { amountCents: true, influencer: { select: { id: true, email: true, displayName: true } } },
  });
  return mailPerPartner(rows, async (inf, cents) => {
    const { buildPartnerCommissionHeld } = await import("@/lib/email/build/platform");
    return buildPartnerCommissionHeld({
      name: inf.displayName,
      amount: usd(cents),
      openedDate: day(openedAt),
      href: `${await appBaseUrl()}/influencer/earnings`,
    });
  });
}

/** Every partner charged back by this lost dispute — one mail each. */
export async function mailChargeback(disputeId: string, closedAt: Date): Promise<number> {
  const rows = await db.commissionLedger.findMany({
    where: { entryType: LedgerEntryType.REVERSED, idempotencyKey: { startsWith: `dispute:${disputeId}:` } },
    select: { amountCents: true, influencer: { select: { id: true, email: true, displayName: true } } },
  });
  return mailPerPartner(rows, async (inf, cents) => {
    const { buildPartnerChargeback } = await import("@/lib/email/build/platform");
    return buildPartnerChargeback({
      name: inf.displayName,
      amount: usd(-cents),
      closedDate: day(closedAt),
      href: `${await appBaseUrl()}/influencer/earnings`,
    });
  });
}

async function mailPerPartner(
  rows: { amountCents: number; influencer: { id: string; email: string; displayName: string } }[],
  build: (inf: { email: string; displayName: string }, cents: number) => Promise<EmailDoc>,
): Promise<number> {
  const byPartner = new Map<string, { inf: { email: string; displayName: string }; cents: number }>();
  for (const r of rows) {
    const cur = byPartner.get(r.influencer.id) ?? { inf: r.influencer, cents: 0 };
    cur.cents += r.amountCents;
    byPartner.set(r.influencer.id, cur);
  }
  let sent = 0;
  for (const { inf, cents } of byPartner.values()) {
    if (cents === 0) continue;
    if (await deliver(inf.email, await build(inf, cents))) sent++;
  }
  return sent;
}
