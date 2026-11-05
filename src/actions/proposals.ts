"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { InstallmentStatus, MEASUREMENT_TYPES } from "@/lib/prismaEnums";
import { diffUnpaid, fromMinor, resolveSchedule, toMinor } from "@/lib/paymentSchedule";
import { expireOpenCheckoutsForProposal } from "@/lib/payments/checkouts";
import { repriceOpenInvoices } from "@/lib/payments/invoiceRecord";
import { contractSchedule } from "@/lib/contractTotal";
import { approvedChangeOrders } from "@/lib/changeOrders/extras";
import { randomUUID } from "node:crypto";
// Proposal actions use requireProposalStaff: managers operate on any org
// proposal; SALES / ESTIMATOR callers get `proposalScope` ({ ownerId }) which is
// AND-ed into every lookup so they can only touch proposals they own.
import { requireManager, requireProposalStaff } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { recordInventoryLink } from "@/lib/inventoryPick";
import { ProposalStatus } from "@/lib/prismaEnums";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { assertLinksInOrg } from "@/lib/assertLinksInOrg";
import { isBlobEnabled, uploadBlob } from "@/lib/sdk/blob";
import { IMAGE_DATA_URL, safeFilename } from "@/lib/safeHref";
import { priceLinesForClient } from "@/lib/pricing/markup";
import { parseProposalPhotos } from "@/components/v3/proposals-c/types";
import { trackActivation, trackProposalCreated } from "@/lib/activation-events";
import { applyMemberDiscount } from "@/lib/servicePlanBook";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { sendProposalAs, sendToInput } from "@/lib/proposals/sendCore";
import { snapshotProposal } from "@/lib/proposals/snapshot";

const lineItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  measurementType: z.enum(MEASUREMENT_TYPES),
  quantity: z.number().min(0),
  unitPrice: z.number().min(0),
  materialCost: z.number().min(0).default(0),
  laborCost: z.number().min(0).default(0),
  // Live-pricing product metadata — pass-through so an edit/re-save (incl.
  // autosave's delete+recreate) doesn't wipe the Materials Request data.
  store: z.string().nullable().optional(),
  productUrl: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  dimensions: z.string().nullable().optional(),
});

// `id` round-trips so an edit UPDATES a stage instead of recreating it —
// a PAID stage keeps its money, a PENDING one keeps its open checkout.
const installmentSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  amount: z.number().min(0),
  isPercent: z.boolean(),
});

// One order-level discount, the same shape `convertEstimateToProposal` already
// materialises (a Discount row plus Proposal.discountTotal). ADDITIVE and
// tri-state on purpose:
//   undefined — the key was not sent. Nothing about the proposal's discount is
//               read or written, so every caller that predates this field
//               (proposal-builder-a, the estimators) behaves exactly as before.
//   null      — "no discount", written: the total drops the discount and any
//               existing Discount rows are cleared.
//   object    — the discount to apply.
const discountSchema = z.object({
  label: z.string().default("Discount"),
  amount: z.number().min(0),
  isPercent: z.boolean(),
});

const proposalInput = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  clientId: z.string().optional().nullable(),
  inventoryLinked: z.boolean().optional().nullable(),
  // The project the proposal belongs to. Absent leaves it as it was (callers
  // that know nothing of projects — the estimators — never move one); null
  // takes it out of its project.
  projectId: z.string().optional().nullable(),
  description: z.string().optional(),
  scopeOfWork: z.string().optional(),
  notes: z.string().optional(),
  address: z.string().optional(),
  taxRate: z.number().min(0).max(1).default(0),
  lineItems: z.array(lineItemSchema).default([]),
  installments: z.array(installmentSchema).default([]),
  discount: discountSchema.nullish(),
  materialMarkupPct: z.number().min(0).max(500).optional(),
  laborMarkupPct: z.number().min(0).max(500).optional(),
  overheadPct: z.number().min(0).max(200).optional(),
  profitPct: z.number().min(0).max(200).optional(),
  // "Show to client" — presentation only. Absent leaves the row as it was.
  showBreakdown: z.boolean().optional(),
  showScope: z.boolean().optional(),
  showSignature: z.boolean().optional(),
  marginOnLabor: z.boolean().optional(),
});

type ProposalInput = z.infer<typeof proposalInput>;

function computeTotals(
  input: Pick<
    ProposalInput,
    "lineItems" | "taxRate" | "materialMarkupPct" | "laborMarkupPct" | "overheadPct" | "profitPct" | "discount"
  >,
) {
  // Every stored line carries the client-facing SELL price: its cost marked up
  // by the material/labor %s, then the overhead and profit load on top — the
  // same chain the manual builder's sheet prints (manual-focus-math), so the
  // portal, the PDF and the builder quote one number. Unit prices are quoted
  // in cents and a line's total is quantity × that rounded price, so the
  // client's own arithmetic checks out row by row. At 0% everywhere this is
  // the raw unitPrice and the old subtotal exactly.
  const priced = priceLinesForClient(input.lineItems, input);
  const subtotal = Math.round((priced.reduce((a, l) => a + l.total, 0) + Number.EPSILON) * 100) / 100;
  // Discount comes off BEFORE tax, so tax is charged on what the client owes
  // rather than on a figure nobody pays — the same order the builder's own
  // ledger prints, and the order convertEstimateToProposal already uses. Capped
  // at the subtotal: a discount larger than the job would produce a negative
  // tax and a total that climbs as the discount grows.
  const d = input.discount;
  const discountTotal = d
    ? Math.min(d.isPercent ? (subtotal * Math.min(d.amount, 100)) / 100 : d.amount, subtotal)
    : 0;
  const taxable = subtotal - discountTotal;
  const taxTotal = taxable * input.taxRate;
  // With no discount sent this is byte-for-byte the previous arithmetic.
  return { subtotal, discountTotal, taxTotal, total: taxable + taxTotal, priced };
}

type StageRow = {
  id: string;
  label: string;
  amount: number;
  isPercent: boolean;
  position: number;
  status: string;
  paidAmount: number | null;
  checkoutOpenedAt: Date | null;
  changeOrderId?: string | null;
};
type StageInput = z.infer<typeof installmentSchema>;

const PENDING_LOCK_MS = 60 * 60 * 1000;

/** PAID / WAIVED stages, and PENDING ones with a checkout open less than an
 *  hour, may not be removed or re-priced. Labels may still change. */
function isLockedStage(s: StageRow, now = Date.now()): boolean {
  // A stage an approved change order created is the client's signed money,
  // not the builder's to drop or re-price.
  if (s.changeOrderId) return true;
  if (s.status === InstallmentStatus.PAID || s.status === InstallmentStatus.WAIVED) return true;
  return (
    s.status === InstallmentStatus.PENDING &&
    s.checkoutOpenedAt !== null &&
    now - s.checkoutOpenedAt.getTime() < PENDING_LOCK_MS
  );
}

function assertLockedStagesUntouched(existing: StageRow[], incoming: StageInput[]) {
  for (const s of existing) {
    if (!isLockedStage(s)) continue;
    // The builder never sees change-order stages; upsertInstallments keeps them.
    if (s.changeOrderId) continue;
    const word = s.status === InstallmentStatus.PENDING ? "being paid right now" : "already paid";
    const next = incoming.find((i) => i.id === s.id);
    if (!next) throw new Error(`"${s.label}" is ${word} and can't be removed`);
    if (next.amount !== s.amount || next.isPercent !== s.isPercent) {
      throw new Error(`"${s.label}" is ${word} and its amount can't change`);
    }
  }
}

/**
 * Upsert the schedule by id. Stale PENDING claims (>1 h, the provider session
 * is dead) are released first. If anything a client could still be charged
 * for changed, scheduleVersion bumps and any open checkout whose amount no
 * longer matches is expired so the client gets a fresh one.
 */
async function upsertInstallments(
  organizationId: string,
  proposalId: string,
  prev: { total: number; currency: string; installments: StageRow[] },
  next: { total: number; currency: string },
  incoming: StageInput[],
) {
  const now = Date.now();
  const stale = prev.installments.filter(
    (s) => s.status === InstallmentStatus.PENDING && !isLockedStage(s, now),
  );
  if (stale.length) {
    await db.installment.updateMany({
      where: { id: { in: stale.map((s) => s.id) } },
      data: {
        status: InstallmentStatus.UNPAID,
        checkoutProvider: null,
        checkoutRef: null,
        checkoutOrderId: null,
        checkoutOpenedAt: null,
      },
    });
  }
  // Approved change orders do not change during a save; they only move the
  // contract value the resolver measures against (lib/contractTotal).
  const cos = await approvedChangeOrders(proposalId);
  const before = resolveSchedule({
    ...contractSchedule(prev.total, cos),
    currency: prev.currency,
    installments: prev.installments,
  });

  const byId = new Map(prev.installments.map((s) => [s.id, s]));
  const keep = new Set<string>();
  for (let idx = 0; idx < incoming.length; idx += 1) {
    const inst = incoming[idx];
    const row = inst.id ? byId.get(inst.id) : undefined;
    if (row) {
      keep.add(row.id);
      const locked = isLockedStage(row, now);
      await db.installment.update({
        where: { id: row.id },
        data: {
          label: inst.label,
          position: idx,
          ...(locked ? {} : { amount: inst.amount, isPercent: inst.isPercent }),
        },
      });
    } else {
      const created = await db.installment.create({
        data: { proposalId, label: inst.label, amount: inst.amount, isPercent: inst.isPercent, position: idx },
      });
      keep.add(created.id);
    }
  }
  // Change-order stages are kept as they are and re-indexed after the
  // builder's rows, so a save from a stale tab cannot drop signed money.
  const coRows = prev.installments.filter((s) => s.changeOrderId);
  for (let i = 0; i < coRows.length; i += 1) {
    keep.add(coRows[i].id);
    await db.installment.update({ where: { id: coRows[i].id }, data: { position: incoming.length + i } });
  }
  const dropIds = prev.installments
    .filter((s) => !keep.has(s.id) && !isLockedStage(s, now))
    .map((s) => s.id);
  if (dropIds.length) await db.installment.deleteMany({ where: { id: { in: dropIds } } });

  const fresh = await db.installment.findMany({ where: { proposalId }, orderBy: { position: "asc" } });
  const after = resolveSchedule({ ...contractSchedule(next.total, cos), currency: next.currency, installments: fresh });
  // The stages an open invoice bills may have been re-amounted or dropped by
  // this very save, so its rows are re-priced against the schedule that now
  // exists — otherwise the Invoices tab keeps asking for the old figure
  // (lib/payments/invoiceRecord).
  await repriceOpenInvoices(db, { organizationId, proposalId, stages: after.stages }).catch((err) =>
    console.warn("[proposals] could not re-price the open invoices:", err),
  );
  if (diffUnpaid(before, after)) {
    await db.proposal.update({ where: { id: proposalId }, data: { scheduleVersion: { increment: 1 } } });
    // An in-flight checkout is only killed when the money it asks for is
    // no longer right; one for an unchanged stage stays usable.
    const changedPending = fresh
      .filter((s) => s.status === InstallmentStatus.PENDING)
      .filter((s) => {
        const b = before.stages.find((x) => x.id === s.id);
        const a = after.stages.find((x) => x.id === s.id);
        return !b || !a || b.amountMinor !== a.amountMinor;
      })
      .map((s) => s.id);
    if (changedPending.length) {
      const untouched = fresh
        .filter((s) => s.status === InstallmentStatus.PENDING && !changedPending.includes(s.id))
        .map((s) => s.id);
      await expireOpenCheckoutsForProposal(proposalId, { except: untouched });
    }
  }
}

export async function saveProposal(raw: unknown) {
  const { organizationId, user, proposalScope } = await requireProposalStaff();
  const data = proposalInput.parse(raw);
  // The linked client must be this org's — a foreign id would make the portal,
  // PDF and sendProposal address another tenant's customer.
  await assertLinksInOrg(organizationId, { clientId: data.clientId, projectId: data.projectId });
  const { subtotal, discountTotal, taxTotal, total, priced } = computeTotals(data);
  // Only callers that SENT the key own the proposal's discount — see the
  // tri-state note on discountSchema. `undefined` leaves both the column and
  // the Discount rows exactly as they were.
  const writesDiscount = data.discount !== undefined;
  if (data.id) {
    // The schedule BEFORE this edit — paid stages are frozen and any change
    // to what the client can still be asked for bumps scheduleVersion.
    const prev = await db.proposal.findFirst({
      where: { id: data.id, organizationId, ...proposalScope },
      select: {
        total: true,
        currency: true,
        installments: { orderBy: { position: "asc" } },
      },
    });
    if (!prev) throw new Error("Not found");
    assertLockedStagesUntouched(prev.installments, data.installments);

    // Ownership-gated update in a single Prisma call (no TOCTOU window).
    // Proposal has no compound unique on (id, organizationId), so we use
    // updateMany which accepts non-unique filter fields and reports count.
    const { count } = await db.proposal.updateMany({
      where: { id: data.id, organizationId, ...proposalScope },
      data: {
        title: data.title,
        clientId: data.clientId ?? null,
        ...(data.projectId !== undefined ? { projectId: data.projectId ?? null } : {}),
        description: data.description,
        scopeOfWork: data.scopeOfWork,
        notes: data.notes,
        address: data.address?.trim() || null,
        taxRate: data.taxRate,
        materialMarkupPct: data.materialMarkupPct ?? undefined,
        laborMarkupPct: data.laborMarkupPct ?? undefined,
        overheadPct: data.overheadPct ?? undefined,
        profitPct: data.profitPct ?? undefined,
        showBreakdown: data.showBreakdown ?? undefined,
        showScope: data.showScope ?? undefined,
        showSignature: data.showSignature ?? undefined,
        marginOnLabor: data.marginOnLabor ?? undefined,
        subtotal,
        ...(writesDiscount ? { discountTotal } : {}),
        taxTotal,
        total,
      },
    });
    if (count === 0) throw new Error("Not found");
    // Nested writes aren't allowed on updateMany; rewrite children scoped
    // by proposalId. These only execute if the ownership-gated update above
    // succeeded, so they remain org-isolated.
    const proposalId = data.id;
    // The job a proposal became travels with it between projects.
    if (data.projectId !== undefined) {
      await db.job.updateMany({ where: { organizationId, proposalId }, data: { projectId: data.projectId ?? null } });
      if (data.projectId) revalidatePath(`/dashboard/projects/${data.projectId}`);
      revalidatePath("/dashboard/projects");
    }
    await db.lineItem.deleteMany({ where: { proposalId } });
    for (let i = 0; i < priced.length; i += 1) {
      const l = priced[i];
      await db.lineItem.create({
        data: {
          proposalId,
          name: l.name,
          description: l.description,
          measurementType: l.measurementType,
          quantity: l.quantity,
          // The client-facing price: markup, overhead and profit inside it.
          unitPrice: l.unitPrice,
          materialCost: l.materialCost,
          laborCost: l.laborCost,
          total: l.total,
          position: i,
          store: l.store ?? null,
          productUrl: l.productUrl ?? null,
          imageUrl: l.imageUrl ?? null,
          dimensions: l.dimensions ?? null,
        },
      });
    }
    if (writesDiscount) {
      await db.discount.deleteMany({ where: { proposalId } });
      if (data.discount) {
        await db.discount.create({
          data: {
            proposalId,
            label: data.discount.label,
            amount: data.discount.amount,
            isPercent: data.discount.isPercent,
          },
        });
      }
    }
    await upsertInstallments(organizationId, proposalId, prev, { total, currency: prev.currency }, data.installments);
    const refreshed = await db.proposal.findUnique({
      where: { id: proposalId },
      select: { id: true, publicId: true },
    });
    await db.activityEvent.create({
      data: {
        organizationId,
        actorId: user.id,
        proposalId: data.id,
        clientId: data.clientId ?? null,
        kind: "EDITED",
        summary: `Edited "${data.title}"`,
      },
    });
    revalidatePath("/dashboard/proposals");
    revalidatePath(`/dashboard/proposals/${proposalId}`);
    return { id: refreshed!.id, publicId: refreshed!.publicId };
  }

  // New proposal — gate on the monthly "proposals created" plan limit.
  await enforcePlanLimit(organizationId, "proposalsCreated");

  const created = await db.proposal.create({
    data: {
      publicId: randomUUID(),
      organizationId,
      ownerId: user.id,
      clientId: data.clientId ?? null,
      projectId: data.projectId ?? null,
      title: data.title,
      description: data.description,
      scopeOfWork: data.scopeOfWork,
      notes: data.notes,
      address: data.address?.trim() || null,
      taxRate: data.taxRate,
      materialMarkupPct: data.materialMarkupPct ?? 0,
      laborMarkupPct: data.laborMarkupPct ?? 0,
      overheadPct: data.overheadPct ?? 0,
      profitPct: data.profitPct ?? 0,
      showBreakdown: data.showBreakdown ?? true,
      showScope: data.showScope ?? true,
      showSignature: data.showSignature ?? true,
      marginOnLabor: data.marginOnLabor ?? false,
      subtotal,
      discountTotal,
      taxTotal,
      total,
      status: ProposalStatus.DRAFT,
      validUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      lineItems: {
        create: priced.map((l, i) => ({ ...l, position: i })),
      },
      installments: {
        create: data.installments.map((i, idx) => ({ ...i, position: idx })),
      },
      ...(data.discount
        ? {
            discounts: {
              create: [
                {
                  label: data.discount.label,
                  amount: data.discount.amount,
                  isPercent: data.discount.isPercent,
                },
              ],
            },
          }
        : {}),
    },
  });
  // A member client (2026-09-22): the plan's discount rides on the new proposal (lib/servicePlanBook).
  await applyMemberDiscount(created.id).catch(() => {});
  // The connect-or-not choice, when one was made (lib/inventoryPick; null = the company's default).
  await recordInventoryLink(organizationId, created.id, data.inventoryLinked, user.id);

  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      proposalId: created.id,
      clientId: data.clientId ?? null,
      kind: "CREATED",
      summary: `Created proposal "${created.title}"`,
    },
  });

  trackProposalCreated(organizationId, "editor");

  revalidatePath("/dashboard/proposals");
  if (created.projectId) revalidatePath(`/dashboard/projects/${created.projectId}`);
  return { id: created.id, publicId: created.publicId };
}

export async function sendProposal(id: string, rawTo?: unknown) {
  const { organizationId, user, proposalScope } = await requireProposalStaff();
  // The send itself lives in lib/proposals/sendCore (2026-11-04), shared with the JobFlex Assistant.
  return sendProposalAs({ organizationId, userId: user.id, proposalScope }, id, sendToInput.parse(rawTo));
}

export type StatusResult =
  | { ok: true }
  | { ok: false; reason: "provider_paid" }
  | { ok: false; reason: "has_paid_stages" };

/**
 * Manual status moves. PAID needs nothing outstanding on the schedule — the
 * contractor records a manual payment first (src/actions/installments.ts).
 * Un-marking is refused when a stage was paid through Stripe/Square (refund
 * from the provider; it syncs back), and DRAFT is refused once anything is
 * paid at all. These come back as results, not throws, so the UI can open
 * the right dialog.
 */
export async function updateProposalStatus(id: string, status: ProposalStatus): Promise<StatusResult> {
  const { organizationId, user, proposalScope } = await requireProposalStaff();
  const p = await db.proposal.findFirst({
    where: { id, organizationId, ...proposalScope },
    include: { installments: { include: { payment: { select: { provider: true } } } } },
  });
  if (!p) throw new Error("Not found");
  const paidStages = p.installments.filter((s) => s.status === InstallmentStatus.PAID);
  // COMPLETED IS A FACT ABOUT THE WORK, NOT THE MONEY (owner, 2026-09-03).
  // "Mark completed" used to refuse while any stage was owed, which left a
  // finished job parked under Accepted until the last cheque cleared. It
  // files now regardless; the unpaid stages stay open on the sheet, Mark
  // paid still works on each, and the row carries what is still owed
  // (ProposalRow.owed). The other direction is unchanged: paying the last
  // stage still files the job automatically (payments/settle.ts).
  if (status === "ACCEPTED" && p.status === "PAID") {
    if (paidStages.some((s) => s.payment && s.payment.provider !== "MANUAL")) {
      return { ok: false, reason: "provider_paid" };
    }
  }
  if (status === "DRAFT" && paidStages.length > 0) {
    return { ok: false, reason: "has_paid_stages" };
  }
  await db.proposal.update({
    where: { id },
    data: {
      status,
      ...(status === "PAID" ? { paidAt: new Date() } : {}),
      // Reverting a completed (PAID) proposal back to ACCEPTED — "unmark as paid"
      // — must drop the paid timestamp so the record isn't half-paid. On a fresh
      // client acceptance paidAt is already null, so this is a no-op there.
      ...(status === "ACCEPTED" ? { paidAt: null } : {}),
      ...(status === "DRAFT" ? { acceptedAt: null, paidAt: null } : {}),
    },
  });
  if (status === "ACCEPTED" || status === "PAID") {
    await snapshotProposal(id, status === "ACCEPTED" ? "accepted" : "manual");
  }
  // The office marking it accepted (a signature on paper); the client's own
  // click reports from api/public-quote/[publicId]/accept. Un-marking PAID or
  // COMPLETED back to ACCEPTED is not an approval.
  if (status === "ACCEPTED" && (p.status === "DRAFT" || p.status === "SENT" || p.status === "VIEWED" || p.status === "DECLINED")) {
    trackActivation("proposal_approved", organizationId, { via: "office" });
  }
  // Work is done → the client gets their review link (once per proposal,
  // whichever door completed it — see lib/reviews/requestForProposal.ts).
  if (status === "COMPLETED" && p.status !== "COMPLETED") {
    try {
      const { ensureReviewRequestForProposal } = await import("@/lib/reviews/requestForProposal");
      await ensureReviewRequestForProposal(id);
    } catch (err) {
      console.warn("[updateProposalStatus] review request failed:", err);
    }
  }
  // Schedule any follow-ups watching this status
  try {
    const { scheduleFollowUpsFor } = await import("@/lib/followUps/engine");
    await scheduleFollowUpsFor(id, status);
  } catch (err) {
    console.warn("[updateProposalStatus] schedule failed:", err);
  }
  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      proposalId: id,
      clientId: p.clientId ?? null,
      kind:
        status === "ACCEPTED" || status === "DECLINED" || status === "PAID" || status === "SENT"
          ? status
          : "UPDATED",
      summary: `${p.title} → ${status}`,
    },
  });
  revalidatePath("/dashboard/proposals");
  revalidatePath(`/dashboard/proposals/${id}`);
  return { ok: true };
}

// ── Pricing snapshots ──────────────────────────────────────
// The writer is lib/proposals/snapshot (shared with the send core).

export async function saveSnapshotManual(proposalId: string) {
  const { organizationId, proposalScope } = await requireProposalStaff();
  const p = await db.proposal.findFirst({ where: { id: proposalId, organizationId, ...proposalScope } });
  if (!p) throw new Error("Not found");
  await snapshotProposal(proposalId, "manual");
  revalidatePath(`/dashboard/proposals/${proposalId}`);
}

// ── Bulk operations ────────────────────────────────────────

export async function bulkUpdateProposalStatus(ids: string[], status: ProposalStatus) {
  const { organizationId, user, proposalScope } = await requireProposalStaff();
  if (ids.length === 0) return { updated: 0 };
  let eligible = ids;
  if (status === "PAID") {
    // Same rule as updateProposalStatus: only proposals with nothing owed.
    const rows = await db.proposal.findMany({
      where: { id: { in: ids }, organizationId, ...proposalScope },
      select: { id: true, total: true, currency: true, installments: true, changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } } },
    });
    eligible = rows
      .filter(
        (p) =>
          resolveSchedule({ ...contractSchedule(p.total, p.changeOrders), currency: p.currency, installments: p.installments })
            .remainingMinor <= 0,
      )
      .map((p) => p.id);
    if (eligible.length === 0) return { updated: 0, skipped: ids.length };
  }
  const touched = await db.proposal.findMany({
    where: { id: { in: eligible }, organizationId, ...proposalScope },
    select: { id: true, title: true, clientId: true },
  });
  const { count } = await db.proposal.updateMany({
    where: { id: { in: eligible }, organizationId, ...proposalScope },
    data: {
      status,
      ...(status === "PAID" ? { paidAt: new Date() } : {}),
    },
  });
  revalidatePath("/dashboard/proposals");
  const label = status.toLowerCase().replace("_", " ");
  if (touched.length <= 5) {
    for (const p of touched) {
      await logActivity({ organizationId, actorId: user.id, kind: "UPDATED", summary: `Marked "${p.title}" ${label}`, proposalId: p.id, clientId: p.clientId, meta: { status, bulk: true } });
    }
  } else {
    await logActivity({ organizationId, actorId: user.id, kind: "UPDATED", summary: `Marked ${count} proposals ${label}`, meta: { status, bulk: true, ids: touched.map((p) => p.id) } });
  }
  return { updated: count };
}

export async function bulkDeleteProposals(ids: string[]) {
  const { organizationId, user, proposalScope } = await requireProposalStaff();
  if (ids.length === 0) return { deleted: 0 };
  const doomed = await db.proposal.findMany({
    where: { id: { in: ids }, organizationId, ...proposalScope },
    select: { id: true, title: true, clientId: true, total: true },
  });
  const { count } = await db.proposal.deleteMany({
    where: { id: { in: ids }, organizationId, ...proposalScope },
  });
  revalidatePath("/dashboard/proposals");
  // The rows are gone, so no proposalId link — the title is what is left.
  if (doomed.length <= 5) {
    for (const p of doomed) {
      await logActivity({ organizationId, actorId: user.id, kind: "DELETED", summary: `Deleted proposal "${p.title}"`, clientId: p.clientId, meta: { deletedProposalId: p.id, amount: p.total, bulk: true } });
    }
  } else {
    await logActivity({ organizationId, actorId: user.id, kind: "DELETED", summary: `Deleted ${count} proposals`, meta: { bulk: true, titles: doomed.map((p) => p.title).slice(0, 50) } });
  }
  return { deleted: count };
}

export async function duplicateProposal(id: string) {
  const { organizationId, user, proposalScope } = await requireProposalStaff();
  const p = await db.proposal.findFirst({
    where: { id, organizationId, ...proposalScope },
    include: { lineItems: true, installments: true, discounts: true },
  });
  if (!p) throw new Error("Not found");
  await enforcePlanLimit(organizationId, "proposalsCreated");
  const dup = await db.proposal.create({
    data: {
      publicId: randomUUID(),
      organizationId,
      ownerId: user.id,
      clientId: p.clientId,
      // A copy is still that trade's job (2026-10-17): its trade board, its stock and the list's kind keep it.
      trade: p.trade,
      title: `${p.title} (copy)`,
      description: p.description,
      scopeOfWork: p.scopeOfWork,
      notes: p.notes,
      address: p.address,
      taxRate: p.taxRate,
      subtotal: p.subtotal,
      taxTotal: p.taxTotal,
      total: p.total,
      // Carry the hidden markup so the copy stays consistent: its stored
      // unitPrices are already sell prices, and the editor re-derives sell from
      // these rates. Dropping them would silently revert the copy to raw cost.
      materialMarkupPct: p.materialMarkupPct,
      laborMarkupPct: p.laborMarkupPct,
      status: "DRAFT",
      lineItems: {
        create: p.lineItems.map((l) => ({
          name: l.name,
          description: l.description,
          measurementType: l.measurementType,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          materialCost: l.materialCost,
          laborCost: l.laborCost,
          total: l.total,
          position: l.position,
          store: l.store,
          productUrl: l.productUrl,
          imageUrl: l.imageUrl,
          dimensions: l.dimensions,
        })),
      },
      installments: {
        create: p.installments.map((i) => ({
          label: i.label,
          amount: i.amount,
          isPercent: i.isPercent,
          position: i.position,
        })),
      },
    },
  });
  revalidatePath("/dashboard/proposals");
  await logActivity({ organizationId, actorId: user.id, kind: "CREATED", summary: `Duplicated "${p.title}" as "${dup.title}"`, proposalId: dup.id, clientId: p.clientId, meta: { sourceProposalId: p.id, amount: p.total } });
  return { id: dup.id };
}

/**
 * uploadProposalPhoto — before/after shots for the Completed tear-sheet.
 * Called from the client with a base64 data URL. If Vercel Blob is configured
 * the bytes are pushed there; otherwise the data URL is persisted inline so the
 * demo works with zero external dependencies (same fallback as uploadJobPhoto).
 * Photos are stored as a JSON array on Proposal.beforePhotos / afterPhotos.
 */
export async function uploadProposalPhoto(
  proposalId: string,
  dataUrl: string,
  filename: string,
  slot: "before" | "after",
) {
  const { organizationId, proposalScope } = await requireProposalStaff();
  const proposal = await db.proposal.findFirst({
    where: { id: proposalId, organizationId, ...proposalScope },
  });
  if (!proposal) throw new Error("Not found");

  // Inline image only — anything else would be stored verbatim as the photo
  // URL and rendered on the public quote page.
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match || !IMAGE_DATA_URL.test(dataUrl)) throw new Error("Photo must be an image");
  let url = dataUrl;
  if (isBlobEnabled()) {
    const buf = Buffer.from(match[2], "base64");
    const res = await uploadBlob(
      `proposals/${proposalId}/${slot}/${Date.now()}-${safeFilename(filename, "photo")}`,
      buf,
      { contentType: match[1].toLowerCase() },
    );
    url = res.url;
  }

  const photo = { id: randomUUID(), url };
  if (slot === "before") {
    const next = [...parseProposalPhotos(proposal.beforePhotos), photo];
    await db.proposal.update({
      where: { id: proposalId },
      data: { beforePhotos: JSON.stringify(next) },
    });
  } else {
    const next = [...parseProposalPhotos(proposal.afterPhotos), photo];
    await db.proposal.update({
      where: { id: proposalId },
      data: { afterPhotos: JSON.stringify(next) },
    });
  }
  revalidatePath("/dashboard/proposals");
  return photo;
}

export async function removeProposalPhoto(
  proposalId: string,
  slot: "before" | "after",
  photoId: string,
) {
  const { organizationId, proposalScope } = await requireProposalStaff();
  const proposal = await db.proposal.findFirst({
    where: { id: proposalId, organizationId, ...proposalScope },
  });
  if (!proposal) throw new Error("Not found");

  if (slot === "before") {
    const next = parseProposalPhotos(proposal.beforePhotos).filter((p) => p.id !== photoId);
    await db.proposal.update({
      where: { id: proposalId },
      data: { beforePhotos: JSON.stringify(next) },
    });
  } else {
    const next = parseProposalPhotos(proposal.afterPhotos).filter((p) => p.id !== photoId);
    await db.proposal.update({
      where: { id: proposalId },
      data: { afterPhotos: JSON.stringify(next) },
    });
  }
  revalidatePath("/dashboard/proposals");
}

const paymentRequestInput = z.object({
  proposalId: z.string().min(1),
  label: z.string().trim().min(1).max(60),
  amount: z.number().positive(),
  isPercent: z.boolean(),
});

/**
 * REQUEST A PAYMENT (owner, 2026-11-04: "in the projects get the payments as
 * well, where you can send to the client like for deposits or for that job
 * done, request a payment"). Adds one stage to a SOLD proposal's schedule,
 * next in line after what is paid or being paid, through upsertInstallments —
 * the builder's own write — so paid stages stay frozen, a checkout whose money
 * changed is expired and the open invoices are re-priced. What it asks for
 * comes out of the end of the schedule: the remaining balance is authoritative
 * and the last stages clamp (lib/paymentSchedule). Returns the new stage, for
 * the caller to invoice.
 */
export async function addPaymentRequest(raw: unknown): Promise<{ installmentId: string }> {
  const { organizationId, user } = await requireManager();
  const data = paymentRequestInput.parse(raw);
  const prev = await db.proposal.findFirst({
    where: { id: data.proposalId, organizationId },
    select: { id: true, title: true, status: true, total: true, currency: true, clientId: true, projectId: true, installments: { orderBy: { position: "asc" } } },
  });
  if (!prev) throw new Error("Not found");
  if (prev.status !== ProposalStatus.ACCEPTED && prev.status !== ProposalStatus.COMPLETED) {
    throw new Error("A payment is requested on an accepted proposal");
  }
  if (data.isPercent && data.amount > 100) throw new Error("A percentage is 100 at most");
  const cos = await approvedChangeOrders(prev.id);
  const schedule = resolveSchedule({ ...contractSchedule(prev.total, cos), currency: prev.currency, installments: prev.installments });
  if (schedule.remainingMinor <= 0) throw new Error("Nothing is owed on this proposal");
  const askMinor = data.isPercent ? Math.round((toMinor(prev.total) * data.amount) / 100) : toMinor(data.amount);
  if (askMinor > schedule.remainingMinor) {
    throw new Error(`Only $${fromMinor(schedule.remainingMinor).toLocaleString("en-US", { minimumFractionDigits: 2 })} is still owed`);
  }

  const own = prev.installments.filter((st) => !st.changeOrderId);
  const now = Date.now();
  let at = 0;
  own.forEach((st, i) => {
    if (isLockedStage(st, now)) at = i + 1;
  });
  const incoming: StageInput[] = own.map((st) => ({ id: st.id, label: st.label, amount: st.amount, isPercent: st.isPercent }));
  incoming.splice(at, 0, { label: data.label, amount: data.amount, isPercent: data.isPercent });
  await upsertInstallments(organizationId, prev.id, prev, { total: prev.total, currency: prev.currency }, incoming);

  const made = await db.installment.findFirst({
    where: { proposalId: prev.id, position: at, label: data.label, changeOrderId: null, status: InstallmentStatus.UNPAID },
    select: { id: true },
  });
  if (!made) throw new Error("Could not add the payment");
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.PAY,
    summary: `Asked for ${data.label} (${data.isPercent ? `${data.amount}%` : `$${data.amount.toLocaleString("en-US")}`}) on ${prev.title}`,
    proposalId: prev.id,
    clientId: prev.clientId,
    meta: { installmentId: made.id, projectId: prev.projectId ?? undefined },
  });
  revalidatePath("/dashboard/proposals");
  if (prev.projectId) revalidatePath(`/dashboard/projects/${prev.projectId}`);
  return { installmentId: made.id };
}
