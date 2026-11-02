// Admin Lead Center — Blueprint edition. Every number on the sheet is read
// here: the latest platform leads with their offer history and ranking
// snapshot, every organization's eligibility, and the 30-day routing stats
// (intake by trade, accept rate, median accept time, the daily series and the
// geocoded points the site plan projects). No fixtures.
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { isTradeType, orgCoversTrade, parseTradeTypes } from "@/lib/tradeTypes";
import { getRoutingMode } from "@/lib/leadCenter/routingMode";
import { loadRankingInputs, rankWith } from "@/lib/leadCenter/matching";
import { purchasesByPlatformLead } from "@/lib/leadCenter/purchase";
import { readTestKey } from "@/lib/leadCenter/testLeads";
import { readSandboxRuns } from "@/lib/leadCenter/sandbox";
import { appBaseUrl } from "@/lib/appUrl";
import { orgRatingsByIds } from "@/lib/reviews/publicSummary";
import { SEO_SOURCE_RE } from "@/lib/seo/links";
import { seoTrade } from "@/lib/seo/trades";
import { seoCity } from "@/lib/seo/cities";
import { PRICE_PLAN_TAG, PRICED_TRADES, estimateShort, parsePlanEstimate, parsePlanSite, type PricedTrade } from "@/lib/leadCenter/estimate";
import { readLeadEstimates } from "@/lib/leadCenter/estimateStore";
import { autoPriceOn, exclusivesOf } from "@/lib/leadCenter/autoPrice";
import { houseOrgId } from "@/lib/publicEstimate/store";
import {
  AdminLeadCenterContent,
  type SavedRangeDTO,
  type PlatformLeadDTO,
  type OrgPickDTO,
  type RankEntry,
  type StatsDTO,
  type TestRunDTO,
} from "@/components/v3/admin-lead-center/lead-center-content";

/** The Source column: a cost guide by its work and city, any other start by the page it was sent from. */
function sourceOf(row: { source: string | null; consentPage: string | null } | undefined): PlatformLeadDTO["source"] {
  if (!row) return null;
  // Priced on /price (2026-10-27): the homeowner's own estimator.
  if (row.source === "price:roof") return { label: "Priced by the homeowner", detail: "Price my roof" };
  if (row.source && SEO_SOURCE_RE.test(row.source)) {
    const [, work, city] = row.source.split(":");
    const t = seoTrade(work);
    const c = seoCity(city);
    return { label: "Cost guide", detail: t && c ? `${t.name} · ${c.place}` : row.source };
  }
  return { label: "Direct", detail: row.consentPage?.split("?")[0] ?? null };
}

/** A hand-sent offer carries `manual: true` in its breakdown (lib/leadCenter/route). */
function isManualOffer(o: { scoreBreakdownJson: string | null }): boolean {
  try {
    return JSON.parse(o.scoreBreakdownJson ?? "{}")?.manual === true;
  } catch {
    return false;
  }
}

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const SERIES_DAYS = 34;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default async function AdminLeadCenterPage() {
  await requirePlatformAdmin();

  const now = new Date();
  const today = startOfDay(now);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const seriesStart = startOfDay(new Date(now.getTime() - (SERIES_DAYS - 1) * DAY_MS));

  const [platformLeads, orgs, recent, resolvedOffers, openOffers, rankingInputs] = await Promise.all([
    db.platformLead.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        offers: {
          orderBy: { createdAt: "asc" },
          include: { organization: { select: { name: true } } },
        },
      },
    }),
    db.organization.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        tradeTypesJson: true,
        otherTrade: true,
        lat: true,
        lng: true,
        address: true,
        phone: true,
        billingEmail: true,
        leadOffersEnabled: true,
        isInternal: true,
        serviceRadiusMiles: true,
        createdAt: true,
      },
    }),
    // The stats window — wider than the ledger's 200-row cap on a busy platform.
    // Test leads (lib/leadCenter/testLeads) are rehearsals: no statistic counts them.
    db.platformLead.findMany({
      where: { createdAt: { gte: seriesStart < since30 ? seriesStart : since30 }, isTest: false },
      select: {
        id: true,
        createdAt: true,
        matchedAt: true,
        detectedTrade: true,
        status: true,
        lat: true,
        lng: true,
        city: true,
      },
    }),
    db.leadOffer.findMany({
      where: { createdAt: { gte: since30 }, status: { in: ["ACCEPTED", "DECLINED", "EXPIRED"] }, platformLead: { isTest: false } },
      select: { status: true, attempt: true, createdAt: true, respondedAt: true },
    }),
    db.leadOffer.findMany({
      where: { status: "OFFERED", expiresAt: { gt: now }, platformLead: { isTest: false } },
      select: { expiresAt: true },
    }),
    // What the cascade ranks on, loaded once for every lead still to place.
    loadRankingInputs(),
  ]);
  const tradesByOrg = new Map(rankingInputs.orgs.map((o) => [o.id, parseTradeTypes(o.tradeTypesJson)]));
  // What shops paid for their leads (lib/leadCenter/purchase) — the Paid column.
  const purchases = await purchasesByPlatformLead(platformLeads.map((p) => p.id));
  // The estimate a homeowner priced on /price rides beside its lead (lib/leadCenter/estimate, 2026-10-27), with
  // "exclusive" and the per-trade auto-price switch (lib/leadCenter/autoPrice).
  const [estimates, exclusives, autoPriceAll, houseOrg, savedPlans] = await Promise.all([
    readLeadEstimates(platformLeads.map((p) => p.id)),
    exclusivesOf(platformLeads.map((p) => p.id)),
    Promise.all(PRICED_TRADES.map((t) => autoPriceOn(t))),
    houseOrgId(),
    // "Priced, not asking yet" (owner, 2026-10-27): ranges people only asked to have emailed — counted and shown with
    // their city, never their name or email, never routed or priced.
    db.homePlan
      .findMany({ where: { status: "PLANNED", notes: { startsWith: PRICE_PLAN_TAG } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, createdAt: true, notes: true, home: { select: { city: true, state: true } } } })
      .catch(() => [] as Array<{ id: string; createdAt: Date; notes: string | null; home: { city: string | null; state: string | null } }>),
  ]);
  const savedRanges: SavedRangeDTO[] = savedPlans
    .map((p) => {
      const e = parsePlanEstimate(p.notes);
      const site = parsePlanSite(p.notes);
      return e ? { id: p.id, at: p.createdAt.toISOString(), place: [site?.city ?? p.home.city, site?.state ?? p.home.state].filter(Boolean).join(", ") || null, words: estimateShort(e) } : null;
    })
    .filter((r): r is SavedRangeDTO => !!r);
  // Where each request started and the consent it was sent with (LeadSource,
  // 2026-10-26) — the Source column and the sheet's consent line. A database
  // without the table yet reads as no rows.
  const leadSources = new Map(
    (
      await db.leadSource
        .findMany({ where: { platformLeadId: { in: platformLeads.map((p) => p.id) } } })
        .catch(() => [] as Array<{ platformLeadId: string; source: string | null; consentText: string | null; consentAt: Date | null; consentIp: string | null; consentPage: string | null }>)
    ).map((r) => [r.platformLeadId, r]),
  );

  // ── ledger DTO ──────────────────────────────────────────────────────────
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const unresolved = [
    ...new Set(platformLeads.map((p) => p.matchedOrgId).filter((v): v is string => !!v && !orgName.has(v))),
  ];
  if (unresolved.length) {
    const extra = await db.organization.findMany({
      where: { id: { in: unresolved } },
      select: { id: true, name: true },
    });
    for (const o of extra) orgName.set(o.id, o.name);
  }

  // Did the shop the lead was routed to actually take it? A routed lead lands
  // in that shop's Incoming tab as a Lead row with status ROUTED, and stays
  // ROUTED until someone there accepts it. "Routed" and "accepted" are two
  // different answers to "where is this homeowner", so the sheet says which.
  const matchedLeadIds = platformLeads
    .map((p) => p.matchedLeadId)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const shopLeadStatus = new Map<string, string>();
  if (matchedLeadIds.length) {
    const rows = await db.lead.findMany({
      where: { id: { in: matchedLeadIds } },
      select: { id: true, status: true },
    });
    for (const r of rows) shopLeadStatus.set(r.id, r.status);
  }

  const leads: PlatformLeadDTO[] = platformLeads.map((p) => {
    let ranking: RankEntry[] = [];
    try {
      ranking = JSON.parse(p.rankingJson ?? "[]");
    } catch {
      ranking = [];
    }
    const active = p.offers.find((o) => o.status === "OFFERED" && o.expiresAt > now);
    const accepted = p.offers.find((o) => o.status === "ACCEPTED");
    // The hand-send list, in the cascade's order (2026-10-02): every shop that
    // takes platform leads, scored as the cascade scores, each marked whether
    // it covers this lead's trade. A lead with no trade read covers everyone.
    const trade = p.detectedTrade && isTradeType(p.detectedTrade) ? p.detectedTrade : null;
    const shopOrder =
      p.status === "MATCHED"
        ? []
        : rankWith(p, rankingInputs, { anyTrade: true, anyDistance: true }).map((c) => ({
            orgId: c.orgId,
            score: c.score,
            coversTrade: trade ? orgCoversTrade(tradesByOrg.get(c.orgId) ?? [], trade) : true,
            // The service radius (2026-10-03): in it, how far, and the shop's miles.
            inRadius: c.inRadius === true,
            distanceMi: c.distanceMi,
            radiusMi: c.radiusMi ?? 50,
          }));
    return {
      id: p.id,
      isTest: p.isTest,
      name: p.name,
      email: p.email,
      phone: p.phone,
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
      projectType: p.projectType,
      description: p.description,
      detectedTrade: p.detectedTrade,
      aiConfidence: p.aiConfidence,
      geocoded: p.lat != null && p.lng != null,
      lat: p.lat,
      lng: p.lng,
      status: p.status,
      attemptCount: p.attemptCount,
      queueReason: p.queueReason,
      matchedOrgName: p.matchedOrgId ? (orgName.get(p.matchedOrgId) ?? null) : null,
      // Whichever contractor the row is about — the one that has it, else the
      // one currently holding the offer. The row's "Went to" cell opens them.
      wentToOrgId: p.matchedOrgId ?? active?.organizationId ?? null,
      matchedAt: p.matchedAt ? p.matchedAt.toISOString() : null,
      // Sent by hand = the offer the shop accepted was a hand-sent one; a
      // legacy ROUTED match has no accepted offer and reads the admin stamp.
      manuallyAssigned: accepted ? isManualOffer(accepted) : p.assignedByAdminId != null,
      shopLeadStatus: p.matchedLeadId ? (shopLeadStatus.get(p.matchedLeadId) ?? null) : null,
      createdAt: p.createdAt.toISOString(),
      ranking,
      shopOrder,
      priceCents: p.priceCents && p.priceCents > 0 ? p.priceCents : null,
      source: sourceOf(leadSources.get(p.id)),
      estimate: estimates.get(p.id) ?? null,
      exclusive: exclusives.has(p.id),
      consent: (() => {
        const r = leadSources.get(p.id);
        return r?.consentAt && r.consentText ? { at: r.consentAt.toISOString(), ip: r.consentIp, page: r.consentPage, text: r.consentText } : null;
      })(),
      paid: (() => {
        const rec = purchases.get(p.id);
        if (!rec) return null;
        return {
          offerId: rec.offerId,
          amountCents: rec.amountCents,
          paidAt: rec.paidAt,
          orgName: orgName.get(rec.organizationId) ?? "a shop",
          paymentIntentId: rec.paymentIntentId,
          mode: rec.mode,
          via: rec.via,
          refund: rec.refund ? { amountCents: rec.refund.amountCents, reason: rec.refund.reason, at: rec.refund.at } : null,
        };
      })(),
      offers: p.offers.map((o) => ({
        id: o.id,
        orgName: o.organization.name,
        attempt: o.attempt,
        status: o.status,
        score: o.score,
        expiresAt: o.expiresAt.toISOString(),
        respondedAt: o.respondedAt ? o.respondedAt.toISOString() : null,
        createdAt: o.createdAt.toISOString(),
      })),
      activeOffer: active
        ? {
            orgName: active.organization.name,
            attempt: active.attempt,
            expiresAt: active.expiresAt.toISOString(),
            score: active.score,
            manual: isManualOffer(active),
          }
        : null,
    };
  });

  // How each shop has behaved: offers seen, offers taken, leads currently held.
  // One grouped pass each — a row per shop per stat would not scale, and this
  // roster is read on every visit.
  const [offerCounts, acceptCounts, matchedCounts, ratings] = await Promise.all([
    db.leadOffer.groupBy({ by: ["organizationId"], where: { platformLead: { isTest: false } }, _count: { _all: true } }),
    db.leadOffer.groupBy({ by: ["organizationId"], where: { status: "ACCEPTED", platformLead: { isTest: false } }, _count: { _all: true } }),
    db.platformLead.groupBy({
      by: ["matchedOrgId"],
      where: { matchedOrgId: { not: null }, isTest: false },
      _count: { _all: true },
    }),
    // The same rating routing scores on — hidden reviews included, so the
    // admin sees what the algorithm sees, not what the shop chose to show.
    orgRatingsByIds(orgs.map((o) => o.id), { includeHidden: true }),
  ]);
  const offersBy = new Map(offerCounts.map((r) => [r.organizationId, r._count._all]));
  const acceptsBy = new Map(acceptCounts.map((r) => [r.organizationId, r._count._all]));
  const matchedBy = new Map(matchedCounts.map((r) => [r.matchedOrgId as string, r._count._all]));

  const orgPicks: OrgPickDTO[] = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    trades: parseTradeTypes(o.tradeTypesJson),
    otherTrade: o.otherTrade,
    geocoded: o.lat != null && o.lng != null,
    lat: o.lat,
    lng: o.lng,
    address: o.address,
    phone: o.phone,
    email: o.billingEmail,
    offersEnabled: o.leadOffersEnabled,
    isInternal: o.isInternal,
    radiusMi: o.serviceRadiusMiles,
    offersReceived: offersBy.get(o.id) ?? 0,
    offersAccepted: acceptsBy.get(o.id) ?? 0,
    leadsMatched: matchedBy.get(o.id) ?? 0,
    ratingAvg: ratings.get(o.id)?.avg ?? null,
    ratingCount: ratings.get(o.id)?.count ?? 0,
    joinedAt: o.createdAt.toISOString(),
  }));

  // ── stats ───────────────────────────────────────────────────────────────
  const last30 = recent.filter((p) => p.createdAt >= since30);
  const todayRows = recent.filter((p) => p.createdAt >= today);

  const countBy = (rows: typeof recent) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = r.detectedTrade ?? "Unclassified";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const dist = countBy(last30).slice(0, 6);
  const distMax = dist[0]?.[1] ?? 1;
  const tradeDist = dist.map(([trade, n]) => ({ trade, n, pct: Math.round((n / distMax) * 100) }));

  const accepted = resolvedOffers.filter((o) => o.status === "ACCEPTED");
  const acceptRatePct = resolvedOffers.length ? (accepted.length / resolvedOffers.length) * 100 : null;
  const medianAcceptMin = median(
    accepted
      .filter((o) => o.respondedAt)
      .map((o) => (o.respondedAt!.getTime() - o.createdAt.getTime()) / 60_000),
  );
  const routedTotal = await db.platformLead.count({ where: { status: "MATCHED", isTest: false } });

  const stats: StatsDTO = {
    todayCreated: todayRows.length,
    todayMatched: recent.filter((p) => p.matchedAt && p.matchedAt >= today).length,
    tradeDist,
    acceptRatePct,
    medianAcceptMin,
    routedTotal,
    openOffers: openOffers.length,
    expiringSoon: openOffers.filter((o) => o.expiresAt.getTime() - now.getTime() < 12 * 60 * 60 * 1000).length,
    queue: platformLeads.filter((p) => p.status === "MANUAL_QUEUE" && !p.isTest).length,
  };

  const routingMode = await getRoutingMode();
  // The test link, whole (the admin copies it): /homeowner?test=<key>.
  const testKey = await readTestKey();
  const testLink = testKey ? { link: `${await appBaseUrl()}/homeowner?test=${testKey.key}`, createdAt: testKey.createdAt } : null;
  // The test environment's runs (lib/leadCenter/sandbox): which test leads route automatically, who production
  // would have offered each to, and every email and text recorded instead of sent.
  const runs = await readSandboxRuns(platformLeads.filter((p) => p.isTest).map((p) => p.id));
  const testRuns: Record<string, TestRunDTO> = Object.fromEntries(
    [...runs].map(([id, r]) => [id, { createdAt: r.createdAt, wouldRank: r.wouldRank, messages: [...r.messages].reverse() }]),
  );

  return (
    <AdminLeadCenterContent
      leads={leads}
      orgs={orgPicks}
      stats={stats}
      routingMode={routingMode}
      autoPrice={Object.fromEntries(PRICED_TRADES.map((t, i) => [t, autoPriceAll[i]])) as Record<PricedTrade, boolean>}
      houseOrgId={houseOrg}
      savedRanges={savedRanges}
      testLink={testLink}
      testRuns={testRuns}
    />
  );
}
