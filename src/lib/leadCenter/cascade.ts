// Lead Center cascade — the routing state machine every other surface calls.
// Plain server module (NOT "use server"): invoked only from guarded actions
// (accept/decline, admin assign), the public-but-validated homeowner intake,
// and the CRON_SECRET-gated sweep route.
//
// Lifecycle:  MATCHING ─startCascade→ OFFERED ─accept→ MATCHED
//                │                      │decline/expire
//                │                      └─advanceCascade→ next candidate…
//                └(no candidates)→ MANUAL_QUEUE   (≥3 attempts)→ MANUAL_QUEUE
//
// Ranking is SNAPSHOTTED at submission (rankingJson) for admin explainability;
// each step re-validates the next candidate's live eligibility and skips orgs
// that have since opted out, lost their geocode, or dropped the trade.
import { db } from "@/lib/db";
import { loadRankingInputs, rankWith, withinServiceRadius, type Candidate } from "./matching";
import { parseTradeTypes, orgCoversTrade, isTradeType, type TradeType } from "@/lib/tradeTypes";
import { notifyLeadOfferCreated } from "@/lib/notify";
import { TEST_QUEUE_REASON } from "./testLeads";
import { isSandboxLead, setWouldRank } from "./sandbox";
import { getRoutingMode, MANUAL_MODE_REASON, RETURNED_REASON } from "./routingMode";
import { readLeadEstimates } from "./estimateStore";
import { autoPriceOn, exclusiveOf, offerPriceFor } from "./autoPrice";

export const OFFER_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_ATTEMPTS = 3;
const STUCK_MATCHING_MS = 10 * 60 * 1000;
/** How long before an offer lapses the shop gets its one reminder. */
export const OFFER_REMINDER_MS = 2 * 60 * 60 * 1000;

/** Marker that an offer's reminder has gone, so a sweep every 15 minutes does
 *  not send twelve of them across the last two hours. `SyncState` is the app's
 *  key→string store (the same one the routing mode and the lead gate use), and
 *  the marker is deleted when the offer resolves, so nothing accumulates. */
const remindedKey = (offerId: string) => `offerReminded:${offerId}`;

/**
 * Park a lead in the manual queue, with the honest reason and — when the
 * automatic pool is what ran out — a word to the homeowner.
 *
 * Both halves are fixes from the 2026-09-17 run. The reason was "EXHAUSTED"
 * whenever ANY offer had been made, so a lead offered once and then out of
 * candidates was filed under "three shops passed"; and nothing at all was sent
 * to the homeowner, who had been promised a contractor within 24 hours and was
 * never told the search had moved to a human.
 */
async function parkInManualQueue(
  platformLeadId: string,
  reason: string,
  opts: { tellHomeowner: boolean },
): Promise<void> {
  await db.platformLead.update({
    where: { id: platformLeadId },
    data: { status: "MANUAL_QUEUE", queueReason: reason },
  });
  // A request that had been offered or matched is a person's job again: the
  // admins hear it (lib/leadCenter/alerts — never for a test lead, and never
  // for a new one, which the intake's own alert covers).
  try {
    const { alertBackInQueue } = await import("./alerts");
    await alertBackInQueue(platformLeadId);
  } catch (err) {
    console.warn("[lead-center] admin alert failed:", err);
  }
  if (!opts.tellHomeowner) return;
  try {
    const { notifyHomeownerManualQueue } = await import("@/lib/notify");
    await notifyHomeownerManualQueue(platformLeadId);
  } catch (err) {
    console.warn("[lead-center] manual-queue notify failed:", err);
  }
}

export async function startCascade(platformLeadId: string): Promise<void> {
  const pl = await db.platformLead.findUnique({ where: { id: platformLeadId } });
  // Only drive fresh/stuck leads — the cron re-drive may race a submission
  // that already progressed.
  if (!pl || pl.status !== "MATCHING") return;
  // A test lead never reaches a shop through the cascade (lib/leadCenter/testLeads) — except a test-environment
  // lead (lib/leadCenter/sandbox), which runs it among JobFlex's own organizations, whatever the routing mode.
  const sandbox = pl.isTest && (await isSandboxLead(platformLeadId));
  if (pl.isTest && !sandbox) {
    await parkInManualQueue(platformLeadId, TEST_QUEUE_REASON, { tellHomeowner: false });
    return;
  }
  // Manual mode (lib/leadCenter/routingMode): the cascade does not start — the
  // cron's re-drive of a stuck lead included.
  if (!sandbox && (await getRoutingMode()) === "MANUAL") {
    await parkInManualQueue(platformLeadId, MANUAL_MODE_REASON, { tellHomeowner: false });
    return;
  }

  // No usable detected trade — this lead must not cascade at all (owner,
  // 2026-09-04: the AI classification is the ONLY trade source, and an
  // unclassified lead goes to a human, never to the "Other" bucket). The
  // intake normally parks these itself; this guard covers the cron re-drive
  // of leads whose submission crashed between insert and routing.
  if (!pl.detectedTrade || !isTradeType(pl.detectedTrade) || pl.detectedTrade === "Other") {
    await db.platformLead.update({
      where: { id: platformLeadId },
      data: { status: "MANUAL_QUEUE", queueReason: "TRADE_UNDETERMINED: no routable detected trade" },
    });
    return;
  }

  const inputs = await loadRankingInputs();
  let ranking: Candidate[];
  if (sandbox) {
    // What production would do, kept for the test run; what this run does, among internal organizations only.
    const real = rankWith(pl, inputs);
    await setWouldRank(platformLeadId, real.map((c) => ({ orgId: c.orgId, orgName: c.orgName, score: c.score, distanceMi: c.distanceMi })));
    ranking = rankWith(pl, { ...inputs, orgs: inputs.orgs.filter((o) => o.isInternal) });
  } else {
    ranking = rankWith(pl, inputs);
  }
  await db.platformLead.update({
    where: { id: platformLeadId },
    data: { rankingJson: JSON.stringify(ranking) },
  });
  if (!ranking.length) {
    // Nobody qualified at all. The homeowner is NOT mailed here: this fires
    // seconds after "we got your request", and two messages in a row saying
    // opposite things is worse than the status page they already have a link to.
    await parkInManualQueue(platformLeadId, "NO_CANDIDATES", { tellHomeowner: false });
    return;
  }
  await offerToNext(platformLeadId);
}

// Called after a decline or expiry has already transitioned the offer row.
export async function advanceCascade(platformLeadId: string): Promise<void> {
  const pl = await db.platformLead.findUnique({ where: { id: platformLeadId } });
  if (!pl) return;
  // Terminal states — e.g. an admin manually assigned while an offer was open.
  if (pl.status === "MATCHED" || pl.status === "MANUAL_QUEUE") return;
  // A test lead an internal shop passed on goes back to the admin, not onward — a test-environment lead goes on,
  // to the next internal organization, as a real one would (lib/leadCenter/sandbox).
  const sandbox = pl.isTest && (await isSandboxLead(platformLeadId));
  if (pl.isTest && !sandbox) {
    await parkInManualQueue(platformLeadId, TEST_QUEUE_REASON, { tellHomeowner: false });
    return;
  }
  // Manual mode: a pass, a lapse or the homeowner's "another contractor" puts
  // the lead back in the queue for a person — never on to the next shop.
  if (!sandbox && (await getRoutingMode()) === "MANUAL") {
    await parkInManualQueue(platformLeadId, MANUAL_MODE_REASON, { tellHomeowner: false });
    return;
  }
  // Automatic mode, but an admin had placed this lead: it is the admin's to
  // place again (switching to automatic cascades NEW requests only).
  if (pl.assignedByAdminId) {
    await parkInManualQueue(platformLeadId, RETURNED_REASON, { tellHomeowner: false });
    return;
  }

  if (pl.attemptCount >= MAX_ATTEMPTS) {
    // The real EXHAUSTED: three shops were asked and none took it.
    await parkInManualQueue(platformLeadId, "EXHAUSTED", { tellHomeowner: true });
    return;
  }
  await offerToNext(platformLeadId);
}

// Walk the snapshot past already-offered orgs, re-validate live eligibility,
// and open a 24h offer to the first org that still qualifies. No candidates
// left → manual queue.
async function offerToNext(platformLeadId: string): Promise<void> {
  const pl = await db.platformLead.findUnique({
    where: { id: platformLeadId },
    include: { offers: { select: { organizationId: true } } },
  });
  if (!pl || pl.status === "MATCHED" || pl.status === "MANUAL_QUEUE") return;

  let ranking: Candidate[] = [];
  try {
    ranking = JSON.parse(pl.rankingJson ?? "[]");
  } catch {
    ranking = [];
  }
  const alreadyOffered = new Set(pl.offers.map((o) => o.organizationId));
  const detected: TradeType =
    pl.detectedTrade && isTradeType(pl.detectedTrade) ? pl.detectedTrade : "Other";

  for (const cand of ranking) {
    if (alreadyOffered.has(cand.orgId)) continue;

    const org = await db.organization.findUnique({
      where: { id: cand.orgId },
      select: { id: true, leadOffersEnabled: true, lat: true, lng: true, tradeTypesJson: true, serviceRadiusMiles: true, isInternal: true },
    });
    if (!org || !org.leadOffersEnabled || org.lat == null || org.lng == null) continue;
    // A test lead reaches JobFlex's own organizations only (lib/leadCenter/testLeads), whatever its snapshot says.
    if (pl.isTest && !org.isInternal) continue;
    if (!orgCoversTrade(parseTradeTypes(org.tradeTypesJson), detected)) continue;
    // The radius as it is NOW: a shop that narrowed it since the snapshot is skipped.
    if (!withinServiceRadius(pl, org)) continue;

    // The lead's price: the admin's own, else — a lead the homeowner priced, with this trade's switch on
    // (lib/leadCenter/autoPrice, 2026-10-27) — the suggestion, written onto the lead so the next shop pays the same.
    const estimate = (await readLeadEstimates([platformLeadId])).get(platformLeadId) ?? null;
    const priceCents = offerPriceFor({
      priceCents: pl.priceCents && pl.priceCents > 0 ? pl.priceCents : null,
      estimate,
      exclusive: estimate ? await exclusiveOf(platformLeadId) : false,
      autoOn: estimate ? await autoPriceOn(estimate.trade) : false,
    });
    const offer = await db.$transaction(async (tx) => {
      const created = await tx.leadOffer.create({
        data: {
          platformLeadId,
          organizationId: cand.orgId,
          attempt: pl.attemptCount + 1,
          score: cand.score,
          scoreBreakdownJson: JSON.stringify(cand),
          expiresAt: new Date(Date.now() + OFFER_TTL_MS),
          // The lead's price travels with every offer of it (lib/leadCenter/purchase) — the next shop pays the same.
          priceCents,
        },
      });
      if (priceCents && !(pl.priceCents && pl.priceCents > 0)) {
        await tx.platformLead.update({ where: { id: platformLeadId }, data: { priceCents } });
      }
      await tx.platformLead.update({
        where: { id: platformLeadId },
        data: { status: "OFFERED", attemptCount: { increment: 1 } },
      });
      return created;
    });

    // Best-effort: the offer stands even if the org can't be pinged.
    await notifyLeadOfferCreated(offer.id).catch((err) =>
      console.warn("[lead-center] offer notify failed:", err),
    );
    try {
      await db.activityEvent.create({
        data: {
          organizationId: cand.orgId,
          kind: "CREATED",
          summary: `New lead offer: ${pl.name} · ${pl.detectedTrade ?? pl.projectType ?? "project"} — respond within 24h`,
        },
      });
    } catch {
      /* non-fatal */
    }
    return;
  }

  // Nobody left on the list. Three reasons reach this line and they are NOT
  // the same fact, so they no longer share one word:
  //
  //   NO_CANDIDATES      nobody ever qualified — the ranking was empty.
  //   CANDIDATES_SPENT   some shops were asked; the rest of the ranking is
  //                      gone (opted out, lost its geocode, dropped the trade)
  //                      before the three attempts were used.
  //   EXHAUSTED          all three attempts were spent — set in advanceCascade.
  //
  // Before this, anything with one prior offer was filed as EXHAUSTED, and the
  // admin queue printed "3 offers, no takers" over a lead that had been offered
  // exactly once. The admin's next move differs for each: find a shop, fix a
  // shop's profile, or place it by hand.
  const offered = pl.offers.length;
  const reason =
    offered === 0 ? "NO_CANDIDATES" : `CANDIDATES_SPENT: ${offered} offered, none left to ask`;
  // A homeowner is told only when shops WERE asked and the automatic pool ran
  // dry on them. NO_CANDIDATES at submission time is a different message and
  // would arrive seconds after "we got your request".
  await parkInManualQueue(platformLeadId, reason, { tellHomeowner: offered > 0 });
}

// Cron sweep: expire due offers and cascade each one, then re-drive leads
// stuck in MATCHING (a submission-time cascade error leaves them there).
export async function runDueOfferSweep(): Promise<{
  expired: number;
  advanced: number;
  reminded: number;
  redriven: number;
}> {
  const now = new Date();
  const due = await db.leadOffer.findMany({
    where: { status: "OFFERED", expiresAt: { lte: now } },
    select: { id: true, platformLeadId: true },
    take: 100,
  });

  let expired = 0;
  let advanced = 0;
  for (const o of due) {
    // Conditional transition — loses cleanly to a concurrent accept/decline/cancel.
    const res = await db.leadOffer.updateMany({
      where: { id: o.id, status: "OFFERED" },
      data: { status: "EXPIRED" },
    });
    if (res.count === 0) continue;
    expired++;
    // The reminder marker dies with the offer it was about.
    await db.syncState.delete({ where: { key: remindedKey(o.id) } }).catch(() => {});
    try {
      await advanceCascade(o.platformLeadId);
      advanced++;
    } catch (err) {
      console.warn("[lead-center] cascade advance failed:", err);
    }
  }

  // THE ONE REMINDER, two hours out. An offer used to run its full 24 hours
  // with a single mail at minute zero and then simply vanish to the next shop.
  //
  // The window is "inside the last two hours and not yet reminded" rather than
  // a narrow slice of the clock: a missed cron run must not cost the shop its
  // warning. The marker is what keeps a 15-minute sweep from sending eight of
  // them.
  let reminded = 0;
  const expiring = await db.leadOffer.findMany({
    where: {
      status: "OFFERED",
      expiresAt: { gt: now, lte: new Date(now.getTime() + OFFER_REMINDER_MS) },
    },
    select: { id: true },
    take: 100,
  });
  for (const o of expiring) {
    // Claim the marker BEFORE sending: two overlapping sweeps then produce one
    // reminder, not two, because the second `create` loses on the unique key.
    try {
      await db.syncState.create({
        data: { key: remindedKey(o.id), cursor: now.toISOString() },
      });
    } catch {
      continue; // already reminded (or the store is unavailable — skip quietly)
    }
    try {
      const { notifyLeadOfferExpiring } = await import("@/lib/notify");
      await notifyLeadOfferExpiring(o.id);
      reminded++;
    } catch (err) {
      console.warn("[lead-center] expiry reminder failed:", err);
    }
  }

  const stuck = await db.platformLead.findMany({
    where: { status: "MATCHING", createdAt: { lt: new Date(now.getTime() - STUCK_MATCHING_MS) } },
    select: { id: true },
    take: 25,
  });
  for (const pl of stuck) {
    await startCascade(pl.id).catch((err) =>
      console.warn("[lead-center] re-drive failed:", err),
    );
  }

  // Orphan recovery: an OFFERED lead with no open offer (a decline whose
  // advanceCascade errored) would otherwise wait forever.
  const orphaned = await db.platformLead.findMany({
    where: {
      status: "OFFERED",
      updatedAt: { lt: new Date(now.getTime() - STUCK_MATCHING_MS) },
      offers: { none: { status: "OFFERED" } },
    },
    select: { id: true },
    take: 25,
  });
  for (const pl of orphaned) {
    await advanceCascade(pl.id).catch((err) =>
      console.warn("[lead-center] orphan re-drive failed:", err),
    );
  }

  return { expired, advanced, reminded, redriven: stuck.length + orphaned.length };
}

// ── The test environment's clock (lib/leadCenter/sandbox, 2026-10-29) ───────────────────────────────────────────
// A test run cannot wait 24 hours for an offer to lapse or 22 for its reminder. These do now what the sweep does at
// its time — the same transition, the same advance, the same letters (recorded, not sent). Platform-admin actions
// call them for test-environment leads only.

/** Lapse an open offer now and move the lead on, exactly as the sweep does when its 24 hours are up. */
export async function expireOfferNow(offerId: string): Promise<boolean> {
  const o = await db.leadOffer.findUnique({ where: { id: offerId }, select: { platformLeadId: true } });
  if (!o) return false;
  const res = await db.leadOffer.updateMany({ where: { id: offerId, status: "OFFERED" }, data: { status: "EXPIRED", expiresAt: new Date() } });
  if (res.count === 0) return false;
  await db.syncState.delete({ where: { key: remindedKey(offerId) } }).catch(() => {});
  await advanceCascade(o.platformLeadId);
  return true;
}

/** The two-hours-left reminder, now. */
export async function remindOfferNow(offerId: string): Promise<void> {
  const { notifyLeadOfferExpiring } = await import("@/lib/notify");
  await notifyLeadOfferExpiring(offerId);
}
