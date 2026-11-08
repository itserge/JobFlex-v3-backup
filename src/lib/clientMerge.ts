import "server-only";
// TWO RECORDS OF ONE PERSON (Smart CRM part 1, 2026-11-08). Duplicates are found by a shared email or phone;
// merging always asks first — the page shows "looks like the same person" and a person taps Merge. The merge moves
// every child row to the kept record, fills its blank contact fields from the removed one, soft-deletes the removed
// record and writes a ClientMerge log row, so what happened can be read back. Nothing is hard-deleted.

import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { digits10, samePhone, sameEmail } from "@/lib/clientTimeline/shared";

export interface DuplicateCandidate {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: Date;
  /** What they share: "email", "phone" or "email + phone". */
  via: string;
}

/** Other live records in the company that share this client's email or phone. */
export async function duplicatesOf(client: { id: string; organizationId: string; email: string | null; phone: string | null }): Promise<DuplicateCandidate[]> {
  const email = client.email?.trim().toLowerCase() || null;
  const last7 = digits10(client.phone).slice(-7);
  if (!email && last7.length < 7) return [];
  // A stored phone is spelled every way — "(425) 772-0164", "+1 425-772-0164" — so SQL contains() on bare digits
  // misses most of them: the candidates come wide (everyone with a phone or that email) and the digits meet in code.
  const rows = await db.client.findMany({
    where: {
      organizationId: client.organizationId,
      deletedAt: null,
      id: { not: client.id },
      OR: [...(email ? [{ email: { in: [email, client.email!.trim()] } }] : []), ...(last7.length >= 7 ? [{ phone: { not: null } }] : [])],
    },
    select: { id: true, name: true, email: true, phone: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  return rows
    .map((r) => {
      const byEmail = sameEmail(r.email, client.email);
      const byPhone = samePhone(r.phone, client.phone);
      if (!byEmail && !byPhone) return null;
      return { ...r, via: byEmail && byPhone ? "email + phone" : byEmail ? "email" : "phone" };
    })
    .filter((x): x is DuplicateCandidate => x !== null)
    .slice(0, 5);
}

export interface MergeResult {
  ok: boolean;
  error?: string;
  moved?: Record<string, number>;
}

/** Fold `mergedId` into `keptId`. Children move, blanks fill, the removed record keeps its rows' history in the log. */
export async function mergeClients(organizationId: string, keptId: string, mergedId: string, byUserId: string | null): Promise<MergeResult> {
  if (keptId === mergedId) return { ok: false, error: "That's the same record twice." };
  const [kept, merged] = await Promise.all([
    db.client.findUnique({ where: { id: keptId }, select: { id: true, organizationId: true, name: true, email: true, phone: true, address: true, city: true, state: true, zip: true, notes: true, deletedAt: true } }),
    db.client.findUnique({ where: { id: mergedId }, select: { id: true, organizationId: true, name: true, email: true, phone: true, address: true, city: true, state: true, zip: true, notes: true, deletedAt: true } }),
  ]);
  if (!kept || kept.organizationId !== organizationId || kept.deletedAt) return { ok: false, error: "The record to keep wasn't found." };
  if (!merged || merged.organizationId !== organizationId || merged.deletedAt) return { ok: false, error: "The duplicate record wasn't found." };

  const moved: Record<string, number> = {};
  await db.$transaction(async (tx) => {
    const move = async (name: string, fn: () => Promise<{ count: number }>) => {
      const r = await fn();
      if (r.count) moved[name] = r.count;
    };
    await move("proposals", () => tx.proposal.updateMany({ where: { clientId: mergedId }, data: { clientId: keptId } }));
    await move("jobs", () => tx.job.updateMany({ where: { clientId: mergedId }, data: { clientId: keptId } }));
    await move("projects", () => tx.project.updateMany({ where: { clientId: mergedId }, data: { clientId: keptId } }));
    await move("invoices", () => tx.invoice.updateMany({ where: { clientId: mergedId }, data: { clientId: keptId } }));
    await move("payments", () => tx.payment.updateMany({ where: { clientId: mergedId }, data: { clientId: keptId } }));
    await move("visits", () => tx.appointment.updateMany({ where: { clientId: mergedId }, data: { clientId: keptId } }));
    await move("bookings", () => tx.booking.updateMany({ where: { clientId: mergedId }, data: { clientId: keptId } }));
    await move("activity", () => tx.activityEvent.updateMany({ where: { clientId: mergedId }, data: { clientId: keptId } }));
    await move("reviews", () => tx.reviewRequest.updateMany({ where: { clientId: mergedId }, data: { clientId: keptId } }));
    await move("servicePlans", () => tx.servicePlan.updateMany({ where: { clientId: mergedId }, data: { clientId: keptId } }));
    await move("equipment", () => tx.clientEquipment.updateMany({ where: { clientId: mergedId }, data: { clientId: keptId } }));
    await move("visitReports", () => tx.visitReport.updateMany({ where: { clientId: mergedId }, data: { clientId: keptId } }));
    await move("facts", () => tx.clientFact.updateMany({ where: { clientId: mergedId }, data: { clientId: keptId } }));
    await move("promises", () => tx.clientPromise.updateMany({ where: { clientId: mergedId }, data: { clientId: keptId } }));

    // Tags share a two-column key: only the ones the kept record doesn't already wear move.
    const [mergedTags, keptTags] = await Promise.all([
      tx.clientTag.findMany({ where: { clientId: mergedId }, select: { tagId: true } }),
      tx.clientTag.findMany({ where: { clientId: keptId }, select: { tagId: true } }),
    ]);
    const worn = new Set(keptTags.map((t) => t.tagId));
    const newTags = mergedTags.filter((t) => !worn.has(t.tagId));
    if (newTags.length) {
      await tx.clientTag.createMany({ data: newTags.map((t) => ({ clientId: keptId, tagId: t.tagId })) });
      moved.tags = newTags.length;
    }
    await tx.clientTag.deleteMany({ where: { clientId: mergedId } });
    // The removed record's brief goes; the kept one's is now stale and rebuilds on the next open.
    await tx.clientBrief.deleteMany({ where: { clientId: mergedId } });

    // Blanks on the kept record fill from the removed one; notes join.
    const fills: Record<string, string> = {};
    for (const k of ["email", "phone", "address", "city", "state", "zip"] as const) {
      if (!kept[k]?.trim() && merged[k]?.trim()) fills[k] = merged[k]!.trim();
    }
    if (merged.notes?.trim() && merged.notes.trim() !== kept.notes?.trim()) {
      fills.notes = [kept.notes?.trim(), merged.notes.trim()].filter(Boolean).join("\n");
    }
    if (Object.keys(fills).length) await tx.client.update({ where: { id: keptId }, data: fills });

    await tx.client.update({ where: { id: mergedId }, data: { deletedAt: new Date() } });
    await tx.clientMerge.create({
      data: { organizationId, keptId, mergedId, mergedName: merged.name, mergedEmail: merged.email, mergedPhone: merged.phone, movedJson: JSON.stringify(moved), byUserId },
    });
  });

  await logActivity({
    organizationId,
    actorId: byUserId,
    kind: TRAIL_KINDS.CLIENT,
    clientId: keptId,
    summary: `Merged the duplicate record "${merged.name}" into this one`,
    meta: { mergedId, moved },
  });
  return { ok: true, moved };
}
