// The proposal book — ONE read, shared by every surface of /dashboard/proposals.
//
// Both entry points of this route render from this function:
//   · src/app/dashboard/proposals/page.tsx        — the desktop blueprint sheet
//   · src/app/(mobile)/mobile-proposals-v2/       — the handheld rebuild, which
//     serves both /mobile-proposals-v2 and /dashboard/proposals at ≤768px
//
// Keeping the query here rather than copied into each page is what stops the
// two designs describing different books. It is the query the Pressroom edition
// already used (src/app/v3/(dashboard)/proposals-c/page.tsx) — same includes,
// same ordering.
//
// Scoping is `requireProposalStaff`, not `requireOrg`: every action the row
// menus call is gated that way (managers see the org, SALES/ESTIMATOR see only
// proposals they own), so the LIST has to be scoped identically or the page
// would show rows whose menu items all fail with "Not found". This function
// never widens that scope and never takes an org id from its caller.

import { proposalKindOf, type KindEvent } from "@/lib/proposalKind";
import { requireProposalStaff } from "@/lib/orgContext";
import { rowsFinancing } from "@/lib/financing/service";
import { db } from "@/lib/db";
import { contractSchedule, contractTotal } from "@/lib/contractTotal";
import { fromMinor, resolveSchedule } from "@/lib/paymentSchedule";
import { parseProposalPhotos } from "@/components/v3/proposals-c/types";
import { describeAddress, zillowSearchUrl } from "@/lib/zillow";
import type { ClientDesignState, Installment, ProposalRow } from "./proposals-data";
import { clientStanding, standingLine, type ClientLinkRow } from "@/lib/deck/clientDesign";
import { clientLinksByProposal } from "@/lib/deck/clientLinksServer";
import { commissionByDeal } from "@/lib/proposalRow/server";
import { callFirstWords } from "@/lib/proposalRow/shared";

/** The donor prints "25m ago" / "3d ago"; anything older gets a coarser unit. */
export function agoLabel(d: Date): string {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  if (s < 86400 * 30) return `${Math.floor(s / (86400 * 7))}w ago`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo ago`;
  return `${Math.floor(s / (86400 * 365))}y ago`;
}

/** Accepted / paid / due plates are the donor's short caps form — "JUL 18". */
export function plateDate(d: Date | null | undefined): string | undefined {
  if (!d) return undefined;
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" }).toUpperCase();
}

/** Directions for the handheld menu. Null when the client carries no address,
 *  which is what disables that row rather than opening a search for nothing. */
function mapsUrl(c: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string | null {
  const q = describeAddress(c);
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/**
 * Every proposal the signed-in caller is allowed to see, newest edit first.
 * Throws UnauthorizedError / NoOrgError from requireProposalStaff — the callers
 * turn those into their own redirects.
 */
export async function readProposalBook(): Promise<ProposalRow[]> {
  const { organizationId, proposalScope, user, ownProposalsOnly } = await requireProposalStaff();
  // WHAT HAPPENED LATELY (2026-10-13, owner: "make something blooming on the proposal when it is accepted,
  // and when the client's design comes back"): the newest acceptance or decline of the last two weeks, stamped,
  // and the client's design link — the row blooms once per stamp in a browser (proposals-behavior).
  const since = new Date(Date.now() - 14 * 864e5);
  const [freshEvents, clientLinks] = await Promise.all([
    db.activityEvent.findMany({ where: { organizationId, kind: { in: ["ACCEPTED", "DECLINED"] }, createdAt: { gt: since }, proposalId: { not: null } }, orderBy: { createdAt: "desc" }, select: { proposalId: true, kind: true, createdAt: true } }).catch(() => []),
    clientLinksByProposal(organizationId).catch(() => new Map<string, ClientLinkRow>()),
  ]);
  const freshBy = new Map<string, { accepted?: string; declined?: string }>();
  for (const e of freshEvents) {
    if (!e.proposalId) continue;
    const f = freshBy.get(e.proposalId) ?? {};
    // Newest first: the first stamp of a kind is the one that counts.
    if (e.kind === "ACCEPTED" && !f.accepted) f.accepted = e.createdAt.toISOString();
    else if (e.kind === "DECLINED" && !f.declined) f.declined = e.createdAt.toISOString();
    freshBy.set(e.proposalId, f);
  }

  const proposals = await db.proposal.findMany({
    where: { organizationId, ...proposalScope },
    orderBy: { updatedAt: "desc" },
    include: {
      client: {
        select: { name: true, email: true, address: true, city: true, state: true, zip: true },
      },
      owner: { select: { id: true, name: true, email: true, phone: true } },
      // The project a proposal is filed under (2026-09-18) — the list chains
      // a project's proposals together under its name.
      project: { select: { id: true, name: true } },
      installments: { orderBy: { position: "asc" }, include: { payment: { select: { provider: true } } } },
      changeOrders: { where: { status: { in: ["DRAFT", "SENT", "APPROVED"] } }, select: { status: true, total: true, amount: true } },
      lineItems: {
        select: {
          id: true,
          name: true,
          description: true,
          measurementType: true,
          quantity: true,
          materialCost: true,
          // Live-pricing metadata — without it the materials sheet can only
          // guess a merchant, so every buy link degrades to a plain search.
          store: true,
          productUrl: true,
          imageUrl: true,
          dimensions: true,
        },
        orderBy: { position: "asc" },
      },
    },
  });

  // WHAT KIND, MADE BY WHAT (2026-10-17, owner: "show which proposal belongs to — deck, roof, fence, or it's
  // a remodel; if it uses Smart Proposal"): the trail line each proposal was made with, oldest first.
  const eventsBy = new Map<string, KindEvent[]>();
  if (proposals.length) {
    const made = await db.activityEvent
      .findMany({
        where: { organizationId, proposalId: { in: proposals.map((p) => p.id) }, kind: { in: ["CREATED", "ESTIMATE"] } },
        orderBy: { createdAt: "asc" },
        select: { proposalId: true, summary: true, meta: true },
      })
      .catch(() => []);
    for (const e of made) {
      if (!e.proposalId) continue;
      const list = eventsBy.get(e.proposalId) ?? [];
      list.push({ summary: e.summary, meta: e.meta });
      eventsBy.set(e.proposalId, list);
    }
  }

  // WHO MADE IT (2026-09-24): the Owner column carries the member's mark —
  // name, role and their color (lib/team/who). The role lives on the
  // membership, not the user, so it is looked up once for the whole book.
  const roleByUser = new Map(
    (await db.membership.findMany({ where: { organizationId }, select: { userId: true, role: true } })).map((m) => [m.userId, m.role]),
  );

  // THE ROW, PART 4 (2026-11-10): the commission on each sold deal, and the rep's phone for "call first".
  const sale = await commissionByDeal(organizationId, proposals.map((p) => p.id)).catch(() => new Map<string, { pct: number; earned: number; full: number; repId: string }>());
  const ownerIds = [...new Set(proposals.filter((p) => p.callRepFirst && p.owner).map((p) => p.owner!.id))];
  const repPhone = new Map(
    ownerIds.length ? (await db.workerProfile.findMany({ where: { organizationId, userId: { in: ownerIds } }, select: { userId: true, phone: true } })).map((w) => [w.userId, w.phone]) : [],
  );

  const rows = proposals.map((p) => {
    const materials = p.lineItems.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      measurementType: l.measurementType,
      quantity: l.quantity,
      materialCost: l.materialCost,
      store: l.store,
      productUrl: l.productUrl,
      imageUrl: l.imageUrl,
      dimensions: l.dimensions,
    }));
    // Same predicate the classic row menu used for its "N items" hint.
    const shoppable = materials.filter((m) => (m.materialCost ?? 0) > 0 && m.quantity > 0);
    const schedule = resolveSchedule({ ...contractSchedule(p.total, p.changeOrders), currency: p.currency, installments: p.installments });
    // The resolver's own per-stage figure, to the cent. A client re-deriving a
    // percent stage from the total cannot land on the same number — it has no
    // largest-remainder allocation and no clamp to the balance — and a prefill
    // that is off by cents makes settle.ts split the stage and leave a
    // remainder installment behind.
    const resolvedOwed = new Map(schedule.stages.map((s) => [s.id, fromMinor(s.amountMinor)]));
    const inst: Installment[] = p.installments.map((i) => ({
      // The Remind button mails THIS instalment — notifyPaymentReminder looks
      // it up by id, so the id has to travel with the row.
      id: i.id,
      label: i.label,
      due: plateDate(i.dueDate) ?? null,
      amount: i.amount,
      pct: i.isPercent,
      owed: resolvedOwed.get(i.id) ?? 0,
      status: i.status,
      paidAmt: i.paidAmount,
      paidVia: i.payment?.provider ?? null,
      // What the row's payment line says about a stage (2026-10-23): when it was paid, whether it is late, when
      // its invoice went and on which rail, when the automatic reminders last wrote.
      paidOn: plateDate(i.paidAt) ?? null,
      overdue: !!i.dueDate && i.dueDate.getTime() < Date.now() && (i.status === "UNPAID" || i.status === "PENDING"),
      invoiced: i.invoiceSentAt ? agoLabel(i.invoiceSentAt) : null,
      invoiceVia: i.invoiceMethod ?? null,
      reminded: i.remindedAt ? agoLabel(i.remindedAt) : null,
    }));
    const addr = {
      address: p.client?.address,
      city: p.client?.city,
      state: p.client?.state,
      zip: p.client?.zip,
    };
    return {
      id: p.id,
      publicId: p.publicId,
      title: p.title,
      client: p.client?.name ?? "Unassigned",
      clientId: p.clientId,
      projectId: p.project?.id ?? null,
      projectName: p.project?.name ?? null,
      clientEmail: p.client?.email ?? null,
      city: p.client?.city ?? "",
      status: p.status,
      total: p.total,
      updated: agoLabel(p.updatedAt),
      views: p.viewCount,
      // When the client last had it open, and when it went out — the list
      // says "opened 2h ago" or "sent 3d ago · not opened" (2026-09-20).
      lastViewed: p.viewedAt ? agoLabel(p.viewedAt) : null,
      sentAgo: p.sentAt ? agoLabel(p.sentAt) : null,
      // PAID is the office's word that the money landed, even when it was never
      // recorded stage by stage (the old "Mark completed" set PAID outright).
      owed: p.status === "PAID" ? 0 : schedule.remainingMinor / 100,
      paidAmt: p.status === "PAID" ? contractTotal(p.total, p.changeOrders) : schedule.paidMinor / 100,
      contract: contractTotal(p.total, p.changeOrders),
      co: {
        count: p.changeOrders.length,
        drafts: p.changeOrders.filter((c) => c.status === "DRAFT").length,
        pending: p.changeOrders.filter((c) => c.status === "SENT").length,
        approvedTotal: Math.round(p.changeOrders.filter((c) => c.status === "APPROVED").reduce((a, c) => a + (c.total ?? c.amount), 0) * 100) / 100,
        pendingTotal: Math.round(p.changeOrders.filter((c) => c.status === "SENT").reduce((a, c) => a + (c.total ?? c.amount), 0) * 100) / 100,
      },
      remindersOn: p.remindersOn ?? null,
      // Billing is the office's (requireManager): a sales rep or an estimator sees the stages, not the buttons.
      canBill: !ownProposalsOnly,
      // The donor prints a single given name in the Owner column.
      owner: p.owner?.name?.trim().split(/\s+/)[0] || "—",
      // The reader's own proposal: the list names an owner only when it is
      // someone else (owner, 2026-09-25).
      mine: !!p.owner && p.owner.id === user.id,
      ownerWho: p.owner
        ? { id: p.owner.id, name: p.owner.name?.trim() || p.owner.email || "Member", role: roleByUser.get(p.owner.id) ?? null }
        : null,
      mat: shoppable.length,
      zillow: zillowSearchUrl(addr),
      maps: mapsUrl(addr),
      accepted: plateDate(p.acceptedAt),
      paid: plateDate(p.paidAt),
      decided: p.status === "ACCEPTED" || p.status === "COMPLETED" || p.status === "PAID" ? (p.acceptedAt ? `accepted ${plateDate(p.acceptedAt)}` : "accepted") : p.status === "DECLINED" ? "declined" : null,
      kind: proposalKindOf({ trade: p.trade, title: p.title, scope: p.scopeOfWork, description: p.description, events: eventsBy.get(p.id), lineNames: p.lineItems.map((l) => l.name) }),
      clientDesign: clientDesignState(clientLinks.get(p.id)),
      fresh: (() => {
        const f = freshBy.get(p.id);
        const link = clientLinks.get(p.id);
        // A returned design blooms while nobody has opened it, however long ago it came.
        const design = !!link?.unseen;
        // An acceptance that is still the proposal's state: an undone one has nothing to show.
        const accepted = p.status === "ACCEPTED" || p.status === "COMPLETED" || p.status === "PAID" ? f?.accepted : undefined;
        const declined = p.status === "DECLINED" ? f?.declined : undefined;
        return accepted || declined || design ? { accepted, declined, design } : null;
      })(),
      inst: inst.length ? inst : undefined,
      // The office sees every deal's commission; a rep sees their own.
      sale: (() => {
        const c = sale.get(p.id);
        return c && (!ownProposalsOnly || c.repId === user.id) ? { pct: c.pct, earned: c.earned, full: c.full } : null;
      })(),
      callFirst: p.callRepFirst ? callFirstWords(p.owner ? { name: p.owner.name, phone: repPhone.get(p.owner.id) ?? p.owner.phone ?? null } : null) : null,
      canceled: p.canceledAt ? { at: plateDate(p.canceledAt) ?? "", reason: p.cancelReason } : null,
      materials,
      // Completion photos — the tear-sheet's Before / After boxes render these
      // and upload into them through uploadProposalPhoto().
      before: parseProposalPhotos(p.beforePhotos),
      after: parseProposalPhotos(p.afterPhotos),
    } satisfies ProposalRow;
  });
  // Wisetack financing (lib/financing): where each client's loan stands, and the office's Send financing link.
  const fin = await rowsFinancing(organizationId, rows.map((r) => ({ id: r.id, status: r.status, owed: r.owed, canBill: r.canBill !== false }))).catch(() => new Map());
  return fin.size ? rows.map((r) => ({ ...r, fin: fin.get(r.id) ?? null })) : rows;
}

/** The client's design link on a proposal, as its row says it (lib/deck/clientDesign standingLine). */
function clientDesignState(l: ClientLinkRow | undefined): ClientDesignState | null {
  if (!l) return null;
  return {
    name: l.clientName.trim().split(/\s+/)[0] || "The client",
    standing: clientStanding(l),
    line: standingLine(l, (iso) => agoLabel(new Date(iso)), { sentAt: l.sentAt, workAt: l.workAt, openedAt: l.openedAt, createdAt: l.createdAt }),
    draftId: l.draftId,
    unseen: l.unseen,
  };
}
