// SETTLEMENT — the only writer of "money landed" state. Called by the Connect
// webhook, the Square webhook, the return-page active verify, the reconcile
// cron, and the contractor's manual mark-paid. One transaction:
//   Payment row (dedupe on provider+externalId) → stages PAID → proposal PAID
//   when nothing is owed → ActivityEvent. Never drops money: a payment for a
//   deleted proposal becomes an orphan row; an amount the schedule cannot
//   place is recorded as unapplied and the owner is told to refund.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { contractSchedule } from "@/lib/contractTotal";
import { approvedChangeOrders } from "@/lib/changeOrders/extras";
import { ActivityKind, InstallmentStatus, PaymentStatus, ProposalStatus } from "@/lib/prismaEnums";
import {
  applyPaymentToSchedule,
  fromMinor,
  IMPLICIT_STAGE_LABEL,
  resolveSchedule,
  toMinor,
} from "@/lib/paymentSchedule";
import { notifyPaymentIssue, notifyPaymentReceived } from "@/lib/notify";
import { billPlatformFee } from "./feeBilling";
import { reopenInvoicesForPayment, repriceOpenInvoices, settleInvoicesForPayment } from "./invoiceRecord";
import { trackActivation } from "@/lib/activation-events";
import { providerName, providerWord } from "./providerWords";

type Tx = Prisma.TransactionClient;

export interface SettleInput {
  provider: "STRIPE" | "SQUARE" | "STAX" | "MANUAL" | "WISETACK";
  /** Dedupe key: Stripe checkout session id / Square order id / Stax invoice id. Null for manual. */
  externalId: string | null;
  /** Refund key: Stripe payment_intent / Square payment id. */
  externalPaymentId?: string | null;
  organizationId: string;
  proposalId: string | null;
  installmentIds: string[];
  amountMinor: number;
  feeMinor: number;
  /** How JobFlex's cut is collected: inside the charge (Connect / Square app
   *  fee) or, for a key-joined Stripe account, as an invoice item on the
   *  org's JobFlex subscription after settle (feeBilling.ts). */
  feeBilling?: "in_payment" | "invoice";
  currency: string;
  livemode: boolean;
  method: string | null;
  scheduleVersion: number | null;
  clientId?: string | null;
  paidAt?: Date;
  actorId?: string | null;
  note?: string;
}

export type SettleResult =
  | { outcome: "duplicate"; paymentId: string }
  | { outcome: "orphan"; paymentId: string }
  | {
      outcome: "settled";
      paymentId: string;
      proposalPaid: boolean;
      unappliedMinor: number;
      coveredLabels: string[];
    };

/** A proposal with no installments gets its one real stage on first use. */
export async function ensureSchedule(proposalId: string, tx: Tx | typeof db = db) {
  const existing = await tx.installment.findMany({
    where: { proposalId },
    orderBy: { position: "asc" },
  });
  if (existing.length) return existing;
  const row = await tx.installment.create({
    data: { proposalId, label: IMPLICIT_STAGE_LABEL, amount: 100, isPercent: true, position: 0 },
  });
  return [row];
}

export async function settleInstallmentPayment(input: SettleInput): Promise<SettleResult> {
  const paidAt = input.paidAt ?? new Date();
  const amount = fromMinor(input.amountMinor);
  const fee = fromMinor(input.feeMinor);

  const result = await db.$transaction(async (tx) => {
    // 1) dedupe
    if (input.externalId) {
      const dup = await tx.payment.findUnique({
        where: { provider_externalId: { provider: input.provider, externalId: input.externalId } },
        select: { id: true },
      });
      if (dup) return { outcome: "duplicate", paymentId: dup.id } as const;
    }

    const base = {
      organizationId: input.organizationId,
      amount,
      currency: input.currency.toUpperCase(),
      provider: input.provider,
      status: PaymentStatus.PAID,
      externalId: input.externalId,
      externalPaymentId: input.externalPaymentId ?? null,
      method: input.method,
      paidAt,
      feeAmount: fee,
      netAmount: Math.round((amount - fee) * 100) / 100,
      livemode: input.livemode,
      scheduleVersion: input.scheduleVersion,
    };

    // 2) proposal gone → orphan
    const proposal = input.proposalId
      ? await tx.proposal.findUnique({
          where: { id: input.proposalId },
          include: { installments: { orderBy: { position: "asc" } }, changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } } },
        })
      : null;
    if (!proposal) {
      const orphan = await tx.payment.create({
        data: { ...base, clientId: input.clientId ?? null, meta: JSON.stringify({ orphan: true, note: input.note }) },
      });
      return { outcome: "orphan", paymentId: orphan.id } as const;
    }

    const installments = proposal.installments.length
      ? proposal.installments
      : await ensureSchedule(proposal.id, tx);
    const schedule = resolveSchedule({
      ...contractSchedule(proposal.total, proposal.changeOrders),
      currency: proposal.currency,
      installments,
    });

    // 3) clean match: same version, every target stage still collectable,
    //    amounts add up exactly → mark exactly those stages.
    const targets = input.installmentIds
      .map((id) => schedule.stages.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    const targetsOpen = targets.every((s) => s.status === "UNPAID" || s.status === "PENDING");
    const targetSum = targets.reduce((n, s) => n + s.amountMinor, 0);
    const versionOk = input.scheduleVersion === null || input.scheduleVersion === proposal.scheduleVersion;
    const cleanStages =
      targets.length === input.installmentIds.length && targets.length > 0 && targetsOpen && versionOk && targetSum === input.amountMinor;
    // "pay remaining" is also clean when it equals what is owed, even if the
    // stage list drifted (a balance row has no id).
    const cleanRemaining =
      !cleanStages && versionOk && input.amountMinor === schedule.remainingMinor && targetsOpen;

    const payment = await tx.payment.create({
      data: { ...base, proposalId: proposal.id, clientId: input.clientId ?? proposal.clientId },
    });

    let unappliedMinor = 0;
    const coveredLabels: string[] = [];
    /** The stages this payment closed outright — the invoice book keys on them. */
    const coveredIds: string[] = [];
    /** stage → the stage that inherited its unpaid part, when this payment only
     *  partly covered it. An open invoice claim follows the money. */
    const successors: Record<string, string> = {};
    let meta: Record<string, unknown> = {};

    if (cleanStages) {
      for (const s of targets) {
        await tx.installment.update({
          where: { id: s.id },
          data: {
            status: InstallmentStatus.PAID,
            paidAt,
            paidAmount: fromMinor(s.amountMinor),
            paymentId: payment.id,
            checkoutProvider: null,
            checkoutRef: null,
            checkoutOrderId: null,
            checkoutOpenedAt: null,
          },
        });
        coveredLabels.push(s.label);
        coveredIds.push(s.id);
      }
    } else if (cleanRemaining) {
      // Everything still open gets paid; the balance (if any) rides on the last stage.
      const open = schedule.stages.filter(
        (s) => (s.status === "UNPAID" || s.status === "PENDING") && !s.synthetic,
      );
      let placed = 0;
      for (let i = 0; i < open.length; i += 1) {
        const s = open[i];
        const last = i === open.length - 1;
        const amt = last ? input.amountMinor - placed : s.amountMinor;
        placed += amt;
        await tx.installment.update({
          where: { id: s.id },
          data: {
            status: InstallmentStatus.PAID,
            paidAt,
            paidAmount: fromMinor(amt),
            paymentId: payment.id,
            checkoutProvider: null,
            checkoutRef: null,
            checkoutOrderId: null,
            checkoutOpenedAt: null,
          },
        });
        coveredLabels.push(s.label);
        coveredIds.push(s.id);
      }
      if (!open.length) {
        const row = await tx.installment.create({
          data: {
            proposalId: proposal.id,
            label: "Balance",
            amount: amount,
            isPercent: false,
            position: (installments.at(-1)?.position ?? 0) + 1,
            status: InstallmentStatus.PAID,
            paidAt,
            paidAmount: amount,
            paymentId: payment.id,
          },
        });
        coveredLabels.push(row.label);
        coveredIds.push(row.id);
      }
    } else {
      // 4) drifted: greedy application over the CURRENT schedule.
      const app = applyPaymentToSchedule(schedule, input.amountMinor);
      for (const m of app.markPaid) {
        const s = schedule.stages.find((x) => x.id === m.id)!;
        await tx.installment.update({
          where: { id: m.id },
          data: {
            status: InstallmentStatus.PAID,
            paidAt,
            paidAmount: fromMinor(m.paidAmountMinor),
            paymentId: payment.id,
            checkoutProvider: null,
            checkoutRef: null,
            checkoutOrderId: null,
            checkoutOpenedAt: null,
          },
        });
        coveredLabels.push(s.label);
        coveredIds.push(m.id);
      }
      if (app.split) {
        const s = schedule.stages.find((x) => x.id === app.split!.id)!;
        // The stage itself becomes PAID for the part that arrived; the rest
        // becomes a new fixed UNPAID stage right after it.
        await tx.installment.update({
          where: { id: s.id },
          data: {
            status: InstallmentStatus.PAID,
            paidAt,
            paidAmount: fromMinor(app.split.paidPartMinor),
            paymentId: payment.id,
            checkoutProvider: null,
            checkoutRef: null,
            checkoutOrderId: null,
            checkoutOpenedAt: null,
          },
        });
        await tx.installment.updateMany({
          where: { proposalId: proposal.id, position: { gt: s.position } },
          data: { position: { increment: 1 } },
        });
        const remainder = await tx.installment.create({
          data: {
            proposalId: proposal.id,
            label: `${s.label} (remainder)`,
            amount: fromMinor(app.split.remainderMinor),
            isPercent: false,
            position: s.position + 1,
          },
        });
        meta = { ...meta, splitRemainderId: remainder.id };
        successors[s.id] = remainder.id;
        coveredLabels.push(`${s.label} (part)`);
        // PAID for the part that arrived: real money, so the invoice book
        // closes its claim on this stage for exactly that.
        coveredIds.push(s.id);
      }
      if (app.newBalanceStage) {
        const covers = app.newBalanceStage.paidAmountMinor >= schedule.remainingMinor;
        const row = await tx.installment.create({
          data: {
            proposalId: proposal.id,
            label: schedule.implicit ? (covers ? IMPLICIT_STAGE_LABEL : "Partial payment") : "Balance",
            amount: fromMinor(app.newBalanceStage.paidAmountMinor),
            isPercent: false,
            position: (installments.at(-1)?.position ?? 0) + 1,
            status: InstallmentStatus.PAID,
            paidAt,
            paidAmount: fromMinor(app.newBalanceStage.paidAmountMinor),
            paymentId: payment.id,
          },
        });
        coveredLabels.push(row.label);
        coveredIds.push(row.id);
      }
      unappliedMinor = app.unappliedMinor;
      if (unappliedMinor > 0) meta = { ...meta, unappliedMinor };
      if (!versionOk) meta = { ...meta, staleVersion: input.scheduleVersion };
    }

    // Any other stage still pointing at this checkout (a "remaining" session
    // that drifted) is released.
    if (input.externalId) {
      await tx.installment.updateMany({
        where: { proposalId: proposal.id, checkoutRef: input.externalId, status: InstallmentStatus.PENDING },
        data: {
          status: InstallmentStatus.UNPAID,
          checkoutProvider: null,
          checkoutRef: null,
          checkoutOrderId: null,
          checkoutOpenedAt: null,
        },
      });
    }

    // 5) recompute → proposal PAID when nothing is owed
    const after = resolveSchedule({
      ...contractSchedule(proposal.total, proposal.changeOrders),
      currency: proposal.currency,
      installments: await tx.installment.findMany({ where: { proposalId: proposal.id }, orderBy: { position: "asc" } }),
    });
    const proposalPaid = after.remainingMinor <= 0;
    if (proposalPaid) {
      await tx.installment.updateMany({
        where: { proposalId: proposal.id, status: { in: [InstallmentStatus.UNPAID, InstallmentStatus.PENDING] } },
        data: {
          status: InstallmentStatus.WAIVED,
          paidAmount: 0,
          checkoutProvider: null,
          checkoutRef: null,
          checkoutOrderId: null,
          checkoutOpenedAt: null,
        },
      });
      if (proposal.status !== ProposalStatus.PAID) {
        await tx.proposal.update({
          where: { id: proposal.id },
          data: { status: ProposalStatus.PAID, paidAt },
        });
      }
    }

    // 6) the invoice book: whatever this payment covered stops being
    //    outstanding. Same transaction as the stages, so the Invoices tab can
    //    never show "pending" for a stage this commit marked PAID. Read the
    //    schedule once more when the sweep above waived stages — a claim on a
    //    waived stage closes for what it collected, which is nothing.
    const bookStages = proposalPaid
      ? resolveSchedule({
          ...contractSchedule(proposal.total, proposal.changeOrders),
          currency: proposal.currency,
          installments: await tx.installment.findMany({ where: { proposalId: proposal.id }, orderBy: { position: "asc" } }),
        }).stages
      : after.stages;
    const closedInvoiceIds = await settleInvoicesForPayment(tx, {
      organizationId: proposal.organizationId,
      proposalId: proposal.id,
      clientId: input.clientId ?? proposal.clientId,
      justPaidIds: coveredIds,
      successors,
      stages: bookStages,
      paidAt,
      provider: input.provider,
    });

    if (Object.keys(meta).length || input.note || closedInvoiceIds.length === 1) {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          // One invoice closed → the payment row points at it. Several, and
          // the link would have to pick a winner, so it stays off.
          ...(closedInvoiceIds.length === 1 ? { invoiceId: closedInvoiceIds[0] } : {}),
          ...(Object.keys(meta).length || input.note
            ? { meta: JSON.stringify({ ...meta, note: input.note }) }
            : {}),
        },
      });
    }

    await tx.activityEvent.create({
      data: {
        organizationId: proposal.organizationId,
        proposalId: proposal.id,
        clientId: proposal.clientId ?? undefined,
        actorId: input.actorId ?? undefined,
        kind: ActivityKind.PAYMENT_RECEIVED,
        summary: `${amountLabel(amount)} received${coveredLabels.length ? ` (${coveredLabels.join(", ")})` : ""} via ${providerWord(input.provider, input.method)}`,
        meta: JSON.stringify({
          paymentId: payment.id,
          installmentIds: input.installmentIds,
          feeMinor: input.feeMinor,
          remainingMinor: after.remainingMinor,
        }),
      },
    });

    return {
      outcome: "settled",
      paymentId: payment.id,
      proposalPaid: proposalPaid && proposal.status !== ProposalStatus.PAID,
      unappliedMinor,
      coveredLabels,
      _proposalId: proposal.id,
      _orgId: proposal.organizationId,
    } as const;
  });

  // ── after commit: best-effort side effects ────────────────────────────
  if (result.outcome === "orphan") {
    await notifyPaymentIssue({
      organizationId: input.organizationId,
      title: "A payment arrived for a proposal that no longer exists",
      detail: `${amountLabel(amount)} was paid through ${providerWord(input.provider, input.method)} for a proposal that has since been deleted. Refund it from your ${providerName(input.provider)} dashboard if it isn't owed.`,
      amount,
    }).catch(() => {});
    return { outcome: "orphan", paymentId: result.paymentId };
  }
  if (result.outcome === "settled") {
    // Every door — Stripe, Square, Stax, a cheque entered by hand — settles here.
    trackActivation("payment_recorded", input.organizationId, { provider: input.provider, online: input.provider !== "MANUAL" });
    await notifyPaymentReceived({ paymentId: result.paymentId }).catch((err) =>
      console.warn("[settle] notify failed", err),
    );
    if (result.unappliedMinor > 0) {
      await notifyPaymentIssue({
        organizationId: result._orgId,
        proposalId: result._proposalId,
        title: `Overpayment of ${amountLabel(fromMinor(result.unappliedMinor))}`,
        detail: `A client paid more than the proposal owes. The extra ${amountLabel(fromMinor(result.unappliedMinor))} is recorded but not applied to any stage — refund it from your ${providerName(input.provider)} dashboard.`,
        amount: fromMinor(result.unappliedMinor),
      }).catch(() => {});
    }
    if (result.proposalPaid) {
      // Its project's "Collect the final payment" task, when nothing on the project still owes.
      await import("@/lib/projectStages/server").then((m) => m.tickFinalPayment(result._proposalId)).catch(() => undefined);
      try {
        const { scheduleFollowUpsFor } = await import("@/lib/followUps/engine");
        await scheduleFollowUpsFor(result._proposalId, ProposalStatus.PAID);
      } catch (err) {
        console.warn("[settle] follow-ups failed", err);
      }
    }
    if (input.feeBilling === "invoice" && input.feeMinor > 0) {
      const pct = Math.round((input.feeMinor / Math.max(1, input.amountMinor)) * 10000) / 100;
      const outcome = await billPlatformFee({
        paymentId: result.paymentId,
        organizationId: result._orgId,
        feeMinor: input.feeMinor,
        currency: input.currency,
        description: `JobFlex platform fee (${pct}%) on ${amountLabel(amount)} received ${paidAt.toISOString().slice(0, 10)}`,
      }).catch((err) => {
        console.warn("[settle] fee billing failed", err);
        return "failed" as const;
      });
      if (outcome === "failed") console.warn("[settle] platform fee not billed for payment", result.paymentId);
    }
    return {
      outcome: "settled",
      paymentId: result.paymentId,
      proposalPaid: result.proposalPaid,
      unappliedMinor: result.unappliedMinor,
      coveredLabels: result.coveredLabels,
    };
  }
  return result;
}

export interface RefundInput {
  provider: "STRIPE" | "SQUARE" | "STAX";
  /** The org the delivering endpoint belongs to. A refund is only ever
   *  recorded against that org's payment: a contractor holds the signing
   *  secret of the endpoint on their own account and could otherwise name
   *  another org's payment intent (audit, 2026-09-20). */
  organizationId: string;
  /** payment_intent (Stripe) / payment id (Square). */
  externalPaymentId: string;
  refundedMinor: number;
  /** Provider says the whole charge is refunded. */
  full: boolean;
}

export async function recordRefund(input: RefundInput): Promise<"not_found" | "recorded"> {
  const outcome = await db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { provider: input.provider, externalPaymentId: input.externalPaymentId, organizationId: input.organizationId },
      include: { installments: true, proposal: { select: { id: true, status: true, total: true, currency: true } } },
    });
    if (!payment) return null;
    const refundedAmount = fromMinor(input.refundedMinor);
    const full = input.full || input.refundedMinor >= toMinor(payment.amount);
    if (payment.status === PaymentStatus.REFUNDED) return { payment, changed: false, full };

    const meta = safeMeta(payment.meta);
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: full ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
        refundedAmount: full ? payment.amount : refundedAmount,
      },
    });

    if (full && payment.proposal) {
      for (const inst of payment.installments) {
        await tx.installment.update({
          where: { id: inst.id },
          data: { status: InstallmentStatus.UNPAID, paidAt: null, paidAmount: null, paymentId: null },
        });
      }
      const remainderId = typeof meta.splitRemainderId === "string" ? meta.splitRemainderId : null;
      if (remainderId) {
        await tx.installment.deleteMany({
          where: { id: remainderId, status: { in: [InstallmentStatus.UNPAID, InstallmentStatus.PENDING] } },
        });
      }
      const after = resolveSchedule({
        ...contractSchedule(payment.proposal.total, await approvedChangeOrders(payment.proposal.id, tx)),
        currency: payment.proposal.currency,
        installments: await tx.installment.findMany({ where: { proposalId: payment.proposal.id } }),
      });
      if (after.remainingMinor > 0) {
        await tx.installment.updateMany({
          where: { proposalId: payment.proposal.id, status: InstallmentStatus.WAIVED },
          data: { status: InstallmentStatus.UNPAID, paidAmount: null },
        });
        if (payment.proposal.status === ProposalStatus.PAID) {
          await tx.proposal.update({
            where: { id: payment.proposal.id },
            data: { status: ProposalStatus.ACCEPTED, paidAt: null },
          });
        }
      }
      // The invoice book follows the money back out: what this payment closed
      // is owed again, and the receipt row settlement wrote for it goes away.
      // Without this the tab would keep reporting a refunded payment as
      // collected (lib/payments/invoiceRecord).
      await reopenInvoicesForPayment(tx, {
        organizationId: payment.organizationId,
        proposalId: payment.proposal.id,
        stageIds: payment.installments.map((i) => i.id),
        stages: after.stages,
        invoiceId: payment.invoiceId,
      });
      await repriceOpenInvoices(tx, {
        organizationId: payment.organizationId,
        proposalId: payment.proposal.id,
        stages: resolveSchedule({
          ...contractSchedule(payment.proposal.total, await approvedChangeOrders(payment.proposal.id, tx)),
          currency: payment.proposal.currency,
          installments: await tx.installment.findMany({ where: { proposalId: payment.proposal.id } }),
        }).stages,
      });
    }

    await tx.activityEvent.create({
      data: {
        organizationId: payment.organizationId,
        proposalId: payment.proposalId ?? undefined,
        clientId: payment.clientId ?? undefined,
        kind: ActivityKind.PAYMENT_REFUNDED,
        summary: `${amountLabel(full ? payment.amount : refundedAmount)} refunded via ${providerWord(input.provider, payment.method)}${full ? "" : " (partial)"}`,
        meta: JSON.stringify({ paymentId: payment.id, refundedMinor: input.refundedMinor, full }),
      },
    });
    return { payment, changed: true, full };
  });

  if (!outcome) return "not_found";
  if (outcome.changed) {
    await notifyPaymentIssue({
      organizationId: outcome.payment.organizationId,
      proposalId: outcome.payment.proposalId,
      title: outcome.full ? "A payment was refunded" : "A payment was partly refunded",
      detail: outcome.full
        ? "The stage it covered is open again and the client can pay it from the proposal."
        : "The stage stays marked paid. Adjust the schedule if the balance should change.",
      amount: fromMinor(input.refundedMinor),
    }).catch(() => {});
  }
  return "recorded";
}

function safeMeta(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function amountLabel(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export { providerName, providerWord };
