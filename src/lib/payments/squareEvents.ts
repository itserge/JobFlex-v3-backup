// One Square event pipeline for both ways a seller joins:
//   /api/webhooks/square            the platform app's subscription (`merchant_id` says whose)
//   /api/webhooks/square-key/[id]   the subscription registered on a token-joined app
// The route verifies Square's signature and owns the dedupe envelope; this
// module turns a verified event into settle / release / refund / status
// writes — only for links minted for the org the event's account belongs
// to, with the fee computed here when no app fee was taken.
import type { PaymentConnection } from "@prisma/client";
import { db } from "@/lib/db";
import { InstallmentStatus } from "@/lib/prismaEnums";
import { platformFeeMinor } from "@/lib/paymentSchedule";
import { settleInstallmentPayment, recordRefund } from "./settle";
import { markConnectionRevoked } from "./connections";
import { platformFeeBps } from "./fees";
import { notifyPaymentIssue } from "@/lib/notify";

export interface SquareEvent {
  merchant_id?: string;
  type?: string;
  event_id?: string;
  data?: { type?: string; id?: string; object?: Record<string, unknown> };
}

export interface SquareEventContext {
  via: "app" | "key";
  /** The seller's row, when the event's merchant is known. */
  conn: PaymentConnection | null;
}

type SquarePayment = {
  id?: string;
  status?: string;
  order_id?: string;
  amount_money?: { amount?: number | string; currency?: string };
  app_fee_money?: { amount?: number | string };
  source_type?: string;
};
type SquareRefund = {
  id?: string;
  status?: string;
  payment_id?: string;
  amount_money?: { amount?: number | string };
};

/** JobFlex's cut. OAuth: the app fee Square took inside the payment. A
 *  token-joined app (or a payment that carried none): the server's rate on
 *  the paid amount, billed on the JobFlex invoice. Never from metadata. */
export function squareFeeOf(amountMinor: number, appFeeMinor: number): { feeMinor: number; feeBilling: "in_payment" | "invoice" } {
  if (appFeeMinor > 0) return { feeMinor: appFeeMinor, feeBilling: "in_payment" };
  return { feeMinor: platformFeeMinor(amountMinor, "SQUARE", platformFeeBps()), feeBilling: "invoice" };
}

export async function dispatchSquareEvent(event: SquareEvent, ctx: SquareEventContext): Promise<void> {
  const conn = ctx.conn;

  switch (event.type) {
    case "payment.created":
    case "payment.updated": {
      const p = event.data?.object?.payment as SquarePayment | undefined;
      if (!p?.order_id) return;
      const stages = await db.installment.findMany({
        where: { checkoutOrderId: p.order_id, checkoutProvider: "SQUARE" },
        select: {
          id: true,
          status: true,
          proposalId: true,
          proposal: { select: { organizationId: true, clientId: true, currency: true } },
        },
      });
      if (!stages.length) return; // not one of our links
      const proposal = stages[0].proposal;
      // The link must have been minted for the org this account belongs to.
      if (!conn || proposal.organizationId !== conn.organizationId) {
        console.warn(`[square-${ctx.via}] payment ${p.id ?? "?"} on order ${p.order_id} is not the event account's — ignored`);
        return;
      }
      if (p.status === "COMPLETED") {
        const amountMinor = Number(p.amount_money?.amount ?? 0);
        const fee = squareFeeOf(amountMinor, Number(p.app_fee_money?.amount ?? 0));
        await settleInstallmentPayment({
          provider: "SQUARE",
          externalId: p.order_id,
          externalPaymentId: p.id ?? null,
          organizationId: proposal.organizationId,
          proposalId: stages[0].proposalId,
          installmentIds: stages.map((s) => s.id),
          amountMinor,
          feeMinor: fee.feeMinor,
          feeBilling: fee.feeBilling,
          currency: String(p.amount_money?.currency ?? proposal.currency).toUpperCase(),
          livemode: conn.squareEnv === "production",
          method: p.source_type === "BANK_ACCOUNT" ? "us_bank_account" : "card",
          scheduleVersion: null,
          clientId: proposal.clientId,
        });
        return;
      }
      if (p.status === "FAILED" || p.status === "CANCELED") {
        await db.installment.updateMany({
          where: { checkoutOrderId: p.order_id, status: InstallmentStatus.PENDING },
          data: {
            status: InstallmentStatus.UNPAID,
            checkoutProvider: null,
            checkoutRef: null,
            checkoutOrderId: null,
            checkoutOpenedAt: null,
          },
        });
      }
      return;
    }
    case "refund.created":
    case "refund.updated": {
      const r = event.data?.object?.refund as SquareRefund | undefined;
      if (!r?.payment_id || r.status !== "COMPLETED") return;
      const payment = await db.payment.findFirst({
        where: { provider: "SQUARE", externalPaymentId: r.payment_id },
        select: { amount: true, organizationId: true },
      });
      if (!payment) return;
      if (!conn || payment.organizationId !== conn.organizationId) {
        console.warn(`[square-${ctx.via}] refund for payment ${r.payment_id} is not the event account's — ignored`);
        return;
      }
      const refundedMinor = Number(r.amount_money?.amount ?? 0);
      await recordRefund({
        provider: "SQUARE",
        organizationId: conn.organizationId,
        externalPaymentId: r.payment_id,
        refundedMinor,
        full: refundedMinor >= Math.round(payment.amount * 100),
      });
      return;
    }
    case "oauth.authorization.revoked": {
      if (ctx.via !== "app" || !conn) return;
      await markConnectionRevoked(conn.organizationId, "SQUARE", "Disconnected from the Square dashboard");
      await notifyPaymentIssue({
        organizationId: conn.organizationId,
        title: "Square was disconnected",
        detail: "JobFlex was removed from your Square account. Reconnect it in Settings → Integrations / Payments to take Square payments again.",
      });
      return;
    }
    default:
      return;
  }
}
