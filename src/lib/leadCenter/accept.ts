// Accepting a Lead Center offer — the ONE write that turns an offer into the
// shop's lead: the org Lead row (with the homeowner's contacts and the scope),
// the PlatformLead MATCHED to the shop, the intake row linked, every other open
// offer cancelled.
//
// Two callers need exactly this (2026-10-02): the free Accept
// (actions/leadOffers.ts acceptLeadOffer) and a paid lead's unlock
// (lib/leadCenter/purchase.ts), which runs it inside the same transaction that
// records the payment. A paid offer also stamps `unlockedAt`.
//
// Plain server module (NOT "use server") — callers do the auth.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { webLeadKey } from "@/lib/webEstimator";
import { LEAD_ESTIMATE_KEY, buyerWebLeadRecord, parseLeadEstimate } from "./estimate";

type Tx = Prisma.TransactionClient;

export class OfferUnavailableError extends Error {
  constructor() {
    super("This offer is no longer available.");
  }
}

/**
 * Inside a transaction: win the offer and materialize the lead.
 *
 * `allowLapsed` is for money already taken: a payment that cleared a minute
 * after the 24-hour window closed, while the lead was still not placed with
 * anyone else, is honoured rather than refunded. A free accept never gets it.
 */
export async function acceptOfferTx(
  tx: Tx,
  opts: { offerId: string; organizationId: string; userId: string | null; now: Date; unlock: boolean; allowLapsed?: boolean },
): Promise<{ leadId: string; platformLeadId: string }> {
  const { offerId, organizationId, userId, now } = opts;
  const offer = await tx.leadOffer.findUnique({ where: { id: offerId }, include: { platformLead: true } });
  if (!offer || offer.organizationId !== organizationId) throw new OfferUnavailableError();
  const pl = offer.platformLead;

  const won = await tx.leadOffer.updateMany({
    where: opts.allowLapsed
      ? { id: offerId, status: { in: ["OFFERED", "EXPIRED", "CANCELLED"] } }
      : { id: offerId, status: "OFFERED", expiresAt: { gt: now } },
    data: {
      status: "ACCEPTED",
      respondedAt: now,
      respondedById: userId,
      ...(opts.unlock ? { unlockedAt: now } : {}),
    },
  });
  if (won.count === 0) throw new OfferUnavailableError();
  // Someone else holds the lead already (a lapsed offer moved on and the next
  // shop took it): nothing to hand over.
  if (pl.status === "MATCHED" && pl.matchedOrgId !== organizationId) throw new OfferUnavailableError();

  // Quota: ALLOW-BUT-COUNT, same policy as the homeowner form — a routed
  // lead is the contractor's revenue and is never blocked by their plan cap.
  const lead = await tx.lead.create({
    data: {
      organizationId,
      name: pl.name,
      email: pl.email,
      phone: pl.phone,
      address: pl.address,
      city: pl.city,
      state: pl.state,
      zip: pl.zip,
      projectType: pl.projectType,
      description: pl.description,
      scope: pl.scope,
      photos: pl.photos ?? "[]",
      source: "LEAD_CENTER",
      status: "CLAIMED",
      claimedById: userId,
      claimedAt: now,
      aiCategory: pl.detectedTrade,
      aiConfidence: pl.aiConfidence,
    },
  });

  // A lead the homeowner priced in a house estimator (2026-10-28): the website-estimate record goes onto the buyer's
  // lead as `webLead:<leadId>` — the record the website estimators write — so the lead page's "Open in the estimator"
  // opens it priced. The deck's draft stays in the house org; the buyer's copy carries the design only.
  const estRow = await tx.syncState.findUnique({ where: { key: LEAD_ESTIMATE_KEY(pl.id) } });
  const est = parseLeadEstimate(estRow?.cursor);
  if (est && est.trade !== "roof") {
    const rec = buyerWebLeadRecord(est, { leadId: lead.id, organizationId, contact: { name: pl.name, phone: pl.phone ?? "", email: pl.email ?? null, note: est.note } }, now);
    const cursor = JSON.stringify(rec);
    await tx.syncState.upsert({ where: { key: webLeadKey(lead.id) }, update: { cursor }, create: { key: webLeadKey(lead.id), cursor } });
  }

  await tx.platformLead.update({
    where: { id: pl.id },
    data: {
      status: "MATCHED",
      matchedOrgId: organizationId,
      matchedLeadId: lead.id,
      matchedAt: now,
      // The queue note described a state this lead has just left (see the
      // same clear in lib/leadCenter/route.ts).
      queueReason: null,
    },
  });

  // The raw submission now points at the lead it became — see route.ts.
  if (pl.homeownerRequestId) {
    await tx.homeownerRequest.updateMany({
      where: { id: pl.homeownerRequestId },
      data: { convertedLeadId: lead.id, organizationId },
    });
  }

  // Defensive: normally there is exactly one open offer per platform lead.
  await tx.leadOffer.updateMany({
    where: { platformLeadId: pl.id, status: "OFFERED", id: { not: offerId } },
    data: { status: "CANCELLED" },
  });

  return { leadId: lead.id, platformLeadId: pl.id };
}

/** After the commit: the shop's activity line and the homeowner's "you're
 *  matched". Best-effort — the accept stands whether or not anyone hears. */
export async function afterOfferAccepted(opts: {
  organizationId: string;
  userId: string | null;
  leadId: string;
  platformLeadId: string;
  paidCents?: number | null;
}): Promise<void> {
  const pl = await db.platformLead.findUnique({ where: { id: opts.platformLeadId } });
  try {
    const paid = opts.paidCents ? ` — paid $${(opts.paidCents / 100).toFixed(2)}` : "";
    await db.activityEvent.create({
      data: {
        organizationId: opts.organizationId,
        actorId: opts.userId,
        leadId: opts.leadId,
        kind: "ACCEPTED",
        summary: `Accepted platform lead: ${pl?.name ?? "lead"} · ${pl?.detectedTrade ?? pl?.projectType ?? "project"}${paid}`,
      },
    });
  } catch {
    /* non-fatal */
  }
  try {
    const { notifyHomeownerMatched } = await import("@/lib/notify");
    await notifyHomeownerMatched(opts.platformLeadId);
  } catch (err) {
    console.warn("[lead-offers] matched notify failed:", err);
  }
  // SmartBook (2026-10-31): the homeowner agreed on the request form to be contacted by phone, text or email by the
  // contractors it is sent to (LeadSource.consentAt, lib/leadConsent) — so the accepted lead may be texted at once.
  try {
    const consent = await db.leadSource.findUnique({ where: { platformLeadId: opts.platformLeadId }, select: { consentAt: true } });
    const { startSmartBook } = await import("@/lib/smartbook/engine");
    await startSmartBook(opts.leadId, "jobflex", { consent: consent?.consentAt ? { text: "lead-center", call: true } : undefined });
  } catch (err) {
    console.warn("[lead-offers] smartbook failed:", err);
  }
}
