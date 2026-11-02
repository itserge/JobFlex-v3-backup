"use client";

// ADMIN LEAD CENTER — BLUEPRINT
// /admin/lead-center
//
// The platform's routing desk: every homeowner request (PlatformLead), where it
// went, and the escape hatch when it went nowhere. Data is read by the server
// page; the only writes are the two admin actions (manualAssignPlatformLead /
// requeuePlatformLead), and `router.refresh()` is the update.
//
// ── WHAT THIS PAGE IS FOR, AND THE 2026-08-27 REBUILD ─────────────────────
// One question brings anyone here: WHERE IS THIS HOMEOWNER'S REQUEST. The first
// build answered it fourth. Above the leads sat three analytics cards (an arc
// gauge, a 26-segment trade bar, a 34-day sparkline beside three KPIs), a
// full-bleed schematic map, and a contractor roster that listed every shop that
// could NOT take a lead as loudly as the two that could — on a platform with
// one lead a day, every one of those was a chart of nothing.
//
// The rebuild is subtraction, and the rules it follows:
//   · ONE JOB PER BLOCK. Status → Leads → Coverage, in that order, top to
//     bottom. Three sections, each answering a different question.
//   · NO CHART WITHOUT DATA. A figure that has nothing to plot is not rendered
//     dim or drawn as an em-dash — it is not rendered. Placeholders were the
//     single biggest source of text on the page.
//   · SAY IT ONCE. "1 plotted" and "1 leads plotted" were the same fact twice;
//     a Status chip and an Expires column carried the same state; the routing
//     rules were recited in the kicker on every visit.
//   · A ROW IS FOUR COLUMNS, NOT SIX. Lead / homeowner / where it went /
//     status. The score and the attempt count are detail, and detail lives in
//     the sheet.
// The visual system (2px ink frames, hard offset shadows, mono annotation
// layer) is unchanged — this is an editing pass, not a re-skin.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { relative, shortDate } from "@/lib/format";
import {
  manualAssignPlatformLead,
  clearTestMessages,
  createTestLead,
  expireTestOffer,
  readTestMessage,
  refundLeadPurchase,
  remindTestOffer,
  requeuePlatformLead,
  rotateLeadTestKey,
  routeAllWaitingLeads,
  setLeadRoutingMode,
  setLeadAutoPrice,
  setHouseOrg,
  setLeadExclusive,
  setOrganizationInternal,
  setPlatformLeadPrice,
} from "@/actions/adminLeadCenter";
import { PRICED_TRADES, TRADE_NOUN, estimatorNameFor, suggestedLeadPriceCents, type LeadEstimate, type PricedTrade } from "@/lib/leadCenter/estimate";
import type { RoutingMode } from "@/lib/leadCenter/routingMode";
import { TRADE_TYPES } from "@/lib/tradeTypes";
import { LeadMap, type MapFilter } from "./lead-map";
import {
  Chip,
  Empty,
  Ic,
  Sheet,
  type Tone,
  actionError,
  cx,
  useMdl,
  useReveal,
} from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import { StarsInline } from "@/components/reviews/StarsInline";
import { haversineMiles } from "@/lib/geo";
import styles from "./lead-center.module.css";

/* ============================================================
   DTOs — shaped by the server page
   ============================================================ */

/** One scoring-snapshot entry (matching.ts Candidate, parsed from rankingJson). */
export interface RankEntry {
  orgId: string;
  orgName: string;
  score: number;
  distanceMi: number | null;
  distanceScore: number;
  ratingScore: number;
  respScore: number;
  /** Raw review numbers (matching.ts, 2026-09-13). Absent on older snapshots —
   *  the sheet falls back to the shop roster's live figure. */
  ratingAvg?: number | null;
  ratingCount?: number;
  fallback: boolean;
}

export interface OfferDTO {
  id: string;
  orgName: string;
  attempt: number;
  status: string;
  score: number;
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
}

export interface PlatformLeadDTO {
  id: string;
  /** A test lead (lib/leadCenter/testLeads): internal organizations only, no stats. */
  isTest: boolean;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  projectType: string | null;
  description: string | null;
  detectedTrade: string | null;
  aiConfidence: number | null;
  geocoded: boolean;
  /** Real coordinates, for the map. Null when the address could not be geocoded. */
  lat: number | null;
  lng: number | null;
  status: string; // MATCHING | OFFERED | MATCHED | MANUAL_QUEUE
  attemptCount: number;
  queueReason: string | null; // NO_CANDIDATES | EXHAUSTED
  matchedOrgName: string | null;
  /** The contractor this row names, if any — matched, else the live offer's. */
  wentToOrgId: string | null;
  matchedAt: string | null;
  manuallyAssigned: boolean;
  /** The shop-side Lead row's status: ROUTED until someone at the shop accepts
   *  it, then CLAIMED / whatever their pipeline moved it to. Null when the lead
   *  has not been matched. */
  shopLeadStatus: string | null;
  createdAt: string;
  ranking: RankEntry[];
  /** The hand-send list in the cascade's order: every shop taking platform
   *  leads, scored now, marked whether it covers this lead's trade. Empty once
   *  the lead is matched. */
  shopOrder: {
    orgId: string;
    score: number;
    coversTrade: boolean;
    /** Lead pin within the shop's service radius (lib/leadCenter/matching). */
    inRadius: boolean;
    /** Pin to pin; null when the lead has no pin. */
    distanceMi: number | null;
    radiusMi: number;
  }[];
  /** The admin's price for the lead, in cents; null = free (2026-10-02). */
  priceCents: number | null;
  /** Where the request was started (LeadSource, 2026-10-26): a cost guide, or the page it was sent from. Null before that. */
  source: { label: string; detail: string | null } | null;
  /** The TCPA consent it was sent with: the words, when, from which IP and page. Null before 2026-10-26. */
  consent: { at: string; ip: string | null; page: string | null; text: string } | null;
  /** The range the homeowner priced on /price and the whole estimate under it (lib/leadCenter/estimate, 2026-10-27). */
  estimate: LeadEstimate | null;
  /** "Exclusive — nobody else gets this lead" (lib/leadCenter/autoPrice). */
  exclusive: boolean;
  /** What the shop paid to open it (lib/leadCenter/purchase), when it did. */
  paid: {
    offerId: string;
    amountCents: number;
    paidAt: string;
    orgName: string;
    paymentIntentId: string;
    mode: "live" | "test";
    via: "card-on-file" | "checkout";
    refund: { amountCents: number; reason: string; at: string } | null;
  } | null;
  offers: OfferDTO[];
  activeOffer: {
    orgName: string;
    attempt: number;
    expiresAt: string;
    score: number;
    /** Sent by an admin, not the cascade. */
    manual: boolean;
  } | null;
}

/** A test-environment run (lib/leadCenter/sandbox): who production would have offered it to, and every email and
 *  text its path made — recorded, never sent. */
export interface TestRunDTO {
  createdAt: string;
  /** The real ranking's first shops; null until it routed. */
  wouldRank: { orgId: string; orgName: string; score: number; distanceMi: number | null }[] | null;
  /** Newest first. */
  messages: {
    n: number;
    at: string;
    channel: "email" | "sms";
    to: string;
    subject?: string | null;
    note?: string | null;
    what?: string | null;
    excerpt: string;
  }[];
}

/** A CONTRACTOR — one of our shops, not a homeowner. */
/** A range someone only asked to have emailed (a planned project on their dashboard): where and what, never who. */
export interface SavedRangeDTO {
  id: string;
  at: string;
  place: string | null;
  /** "$14,200–$19,800 · architectural shingle · 21 sq · aerial read" */
  words: string;
}

export interface OrgPickDTO {
  id: string;
  name: string;
  trades: string[];
  otherTrade: string | null;
  geocoded: boolean;
  lat: number | null;
  lng: number | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  offersEnabled: boolean;
  /** JobFlex's own organization — the only kind a test lead can be sent to. */
  isInternal: boolean;
  /** The shop's service radius, miles. */
  radiusMi: number;
  offersReceived: number;
  offersAccepted: number;
  leadsMatched: number;
  /** Client rating across ALL completed reviews (hidden ones included — what
   *  routing scores on). Null / 0 when the shop has none. */
  ratingAvg: number | null;
  ratingCount: number;
  joinedAt: string;
}

/* ============================================================
   STARS — a shop's client rating, read the way a person reads it
   ============================================================ */

function ratingLabel(avg: number | null, count: number): string {
  if (!count || avg == null) return "no reviews";
  return `${(Math.round(avg * 10) / 10).toFixed(1)} (${count})`;
}

function Stars({ avg, count, compact }: { avg: number | null; count: number; compact?: boolean }) {
  if (!count || avg == null) return <span className={cx(styles.stars, styles.starsNone)}>no reviews</span>;
  const a = (Math.round(avg * 10) / 10).toFixed(1);
  return (
    <span
      className={styles.stars}
      title={`${a} from ${count} client review${count === 1 ? "" : "s"} — hidden reviews count too`}
    >
      <StarsInline value={avg} size={11} />
      <b>{a}</b>
      {compact ? null : <i>({count})</i>}
    </span>
  );
}

export interface StatsDTO {
  todayCreated: number;
  todayMatched: number;
  /** Up to 6 trades, biggest first, over 30 days. */
  tradeDist: { trade: string; n: number; pct: number }[];
  acceptRatePct: number | null;
  medianAcceptMin: number | null;
  routedTotal: number;
  openOffers: number;
  expiringSoon: number;
  queue: number;
}

/* ============================================================
   VOCABULARY
   ============================================================ */

const TRADE_ICON: Record<string, string> = {
  Roofing: "roof",
  Fencing: "fence",
  Decking: "fence",
  "General Contractor": "hardhat",
  "Kitchen & Bath": "building",
  Remodeling: "building",
  Flooring: "grid",
  Tile: "grid",
  Landscaping: "target",
  Electrical: "bulb",
  Plumbing: "box",
  HVAC: "box",
  Siding: "building",
  Painting: "pen",
};
function tradeIcon(trade: string | null): string {
  return (trade && TRADE_ICON[trade]) || "target";
}

function shortId(id: string): string {
  return "#LD-" + id.slice(-4).toUpperCase();
}

function statusTone(l: PlatformLeadDTO): { tone: Tone; label: string } {
  switch (l.status) {
    case "OFFERED":
      return { tone: "wait", label: "Offered" };
    case "MATCHING":
      return { tone: "mute", label: "Matching" };
    case "MATCHED":
      // "Matched" used to cover both a shop that accepted and one that has not
      // opened the tab yet. Those are different answers, so they read
      // differently.
      return l.shopLeadStatus === "ROUTED"
        ? { tone: "bp", label: "With shop" }
        : { tone: "ok", label: "Accepted" };
    case "MANUAL_QUEUE":
      return { tone: "mute", label: "Queue" };
    default:
      return { tone: "mute", label: l.status };
  }
}

type Tab = "ALL" | "OFFERED" | "MATCHED" | "QUEUE" | "PRICED";
const TABS: { key: Tab; label: string; match: (l: PlatformLeadDTO) => boolean }[] = [
  { key: "ALL", label: "All", match: () => true },
  { key: "PRICED", label: "Priced by the homeowner", match: (l) => !!l.estimate },
  { key: "OFFERED", label: "Open", match: (l) => l.status === "OFFERED" || l.status === "MATCHING" },
  { key: "MATCHED", label: "Routed", match: (l) => l.status === "MATCHED" },
  { key: "QUEUE", label: "Queue", match: (l) => l.status === "MANUAL_QUEUE" },
];

/** The score the row shows: the live offer's, else the last offer's, else the top candidate's. */
function rowScore(l: PlatformLeadDTO): number | null {
  if (l.activeOffer) return l.activeOffer.score;
  const last = l.offers[l.offers.length - 1];
  if (last) return last.score;
  return l.ranking[0]?.score ?? null;
}

/** Where the lead is, in one phrase — the answer the page exists to give. */
function destination(l: PlatformLeadDTO): string {
  if (l.activeOffer) return l.activeOffer.orgName;
  if (l.status === "MATCHED") return l.matchedOrgName ?? "a shop";
  if (l.status === "MANUAL_QUEUE") return "Nobody yet";
  return "Ranking shops…";
}

/** The small line under it: why it is there, or how long is left. */
function destinationNote(l: PlatformLeadDTO): string {
  const score = rowScore(l);
  const match = score == null ? "" : `match ${Math.round(score * 100)}`;
  if (l.status === "OFFERED") {
    if (l.activeOffer?.manual) return ["sent by hand", match].filter(Boolean).join(" · ");
    return [`offer ${Math.min(Math.max(l.attemptCount, 1), 3)} of 3`, match].filter(Boolean).join(" · ");
  }
  if (l.status === "MATCHED") {
    const how =
      l.shopLeadStatus === "ROUTED" ? "routed by hand" : l.manuallyAssigned ? "sent by hand · accepted" : "accepted";
    return [how, l.matchedAt ? relative(l.matchedAt) : ""].filter(Boolean).join(" · ");
  }
  if (l.status === "MANUAL_QUEUE") {
    if (l.queueReason === "TEST_LEAD") return "test lead · internal only";
    if (l.queueReason === "RETURNED") return "came back · send it again";
    if (l.queueReason === "NO_CANDIDATES") return "no contractor covers this";
    // Manual mode parks every request here on purpose — saying "3 offers, no
    // takers" about a lead nobody was offered is the page lying to itself.
    if (l.queueReason === "MANUAL_MODE") return "waiting for you";
    if (l.queueReason?.startsWith("TRADE_UNDETERMINED")) return "trade unclear — needs a person";
    // The count is the ROW'S, not a constant. This line read "3 offers, no
    // takers" for every queued lead, including one that had been offered
    // exactly once and then run out of shops — the admin was being told two
    // shops had passed who were never asked (2026-09-17).
    const offers = Math.max(0, l.attemptCount);
    if (offers === 0) return "nobody was offered this";
    return `${offers} offer${offers === 1 ? "" : "s"}, no takers`;
  }
  return match;
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function place(l: PlatformLeadDTO): string {
  return [l.city, l.state].filter(Boolean).join(", ") || l.zip || "no location";
}

function isMatchable(o: OrgPickDTO): boolean {
  return o.offersEnabled && o.geocoded && o.trades.length > 0;
}
function eligibility(o: OrgPickDTO): string {
  if (!o.offersEnabled) return "Paused";
  if (!o.geocoded) return "No address";
  if (!o.trades.length) return "No trades";
  return "Matchable";
}

/* ============================================================
   PAGE
   ============================================================ */

type DetailHandle = { open: (lead: PlatformLeadDTO) => void };

/** The switch's word for each priced trade. */
const TRADE_WORD: Record<PricedTrade, string> = { roof: "Roof", deck: "Deck", fence: "Fence", hvac: "Heating & cooling", smart: "Any project" };

export function AdminLeadCenterContent({
  leads,
  orgs,
  stats,
  routingMode,
  autoPrice,
  houseOrgId,
  savedRanges,
  testLink,
  testRuns,
}: {
  leads: PlatformLeadDTO[];
  orgs: OrgPickDTO[];
  stats: StatsDTO;
  routingMode: RoutingMode;
  /** "Charge the suggested price on automatic routing", per trade (lib/leadCenter/autoPrice). */
  autoPrice: Record<PricedTrade, boolean>;
  /** The internal org the house estimators run as (lib/publicEstimate/store), null until one is picked. */
  houseOrgId: string | null;
  /** "Priced, not asking yet": ranges people saved but did not ask quotes for — counts and ranges, nothing to route. */
  savedRanges: SavedRangeDTO[];
  /** The /homeowner?test=<key> link, whole; null until one is created. */
  testLink: { link: string; createdAt: string } | null;
  /** The test environment's runs, by lead id (lib/leadCenter/sandbox). */
  testRuns: Record<string, TestRunDTO>;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);

  const [tab, setTab] = useState<Tab>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailRef = useRef<DetailHandle | null>(null);
  const shopRef = useRef<ShopHandle | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  /** The lead the map is currently placing, if any: picking a lead pin arms
   *  the map, and the next shop you click is offered that lead. */
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [mapFilter, setMapFilter] = useState<MapFilter>("leads");
  const [mode, setMode] = useState<RoutingMode>(routingMode);
  const [auto, setAuto] = useState<Record<PricedTrade, boolean>>(autoPrice);
  const [autoBusy, setAutoBusy] = useState(false);
  async function switchAutoPrice(trade: PricedTrade, next: boolean) {
    if (autoBusy) return;
    setAutoBusy(true);
    setAuto((a) => ({ ...a, [trade]: next }));
    const noun = TRADE_WORD[trade];
    try {
      await setLeadAutoPrice(trade, next);
      toast.success(next ? `${noun} leads priced on automatic routing` : `${noun} leads go out unpriced again`, next ? `An unpriced ${noun.toLowerCase()} lead the homeowner priced goes out at the suggested price, and keeps it.` : "New offers go out free unless you type a price; a lead already priced keeps its price.");
      router.refresh();
    } catch (err) {
      setAuto((a) => ({ ...a, [trade]: !next }));
      toast.error("Couldn't save the switch", actionError(err));
    } finally {
      setAutoBusy(false);
    }
  }
  // THE HOUSE ORG (2026-10-28): which of JobFlex's own organizations the house estimators run as; none = closed.
  const [house, setHouse] = useState<string>(houseOrgId ?? "");
  const [houseBusy, setHouseBusy] = useState(false);
  async function pickHouse(next: string) {
    if (houseBusy) return;
    setHouseBusy(true);
    const before = house;
    setHouse(next);
    try {
      await setHouseOrg(next || null);
      toast.success(next ? "House estimators on" : "House estimators off", next ? "Deck, fence, heating & cooling and any project price themselves on /price and land here as leads." : "The /price cards describe and match again; the house pages are closed.");
      router.refresh();
    } catch (err) {
      setHouse(before);
      toast.error("Couldn't save the house org", actionError(err));
    } finally {
      setHouseBusy(false);
    }
  }
  const [modeBusy, setModeBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const counts = useMemo(() => {
    const c = {} as Record<Tab, number>;
    for (const t of TABS) c[t.key] = leads.filter((l) => t.match(l)).length;
    return c;
  }, [leads]);
  const rows = useMemo(() => {
    const t = TABS.find((x) => x.key === tab) ?? TABS[0];
    return leads.filter((l) => t.match(l));
  }, [leads, tab]);

  const byId = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  const openLead = useCallback(
    (id: string) => {
      const l = byId.get(id);
      if (!l) return;
      setSelectedId(id);
      detailRef.current?.open(l);
    },
    [byId],
  );

  // /admin/lead-center?lead=<id> — the admin's new-request mail lands on the
  // lead's sheet, open.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("lead");
    if (!id || !byId.has(id)) return;
    // After the first paint: the sheet is a dialog the page has to be there for.
    const t = window.setTimeout(() => openLead(id), 0);
    return () => window.clearTimeout(t);
    // first render only: the link names one lead
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shopById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs]);

  /** A lead pin: arm the map with it and show the shops, so the next click is
   *  the answer to "who should get this". */
  const armLead = useCallback((id: string) => {
    setPlacingId(id);
    setSelectedId(id);
    setMapFilter("both");
  }, []);

  /** A shop pin or a shop row. With a lead armed the sheet asks whether to send
   *  it; without one it is just the contractor's record. */
  const openShop = useCallback(
    (id: string) => {
      const o = shopById.get(id);
      if (!o) return;
      shopRef.current?.open(o, placingId ? (byId.get(placingId) ?? null) : null);
    },
    [shopById, byId, placingId],
  );

  async function switchMode(next: RoutingMode) {
    if (modeBusy || next === mode) return;
    setModeBusy(true);
    const prev = mode;
    setMode(next);
    try {
      await setLeadRoutingMode(next);
      toast.success(
        next === "AUTO" ? "Routing automatically" : "Routing by hand",
        next === "AUTO"
          ? "New requests go straight to the best-matching shop."
          : "New requests wait here until you send them.",
      );
      router.refresh();
    } catch (err) {
      setMode(prev);
      toast.error("Couldn't change the mode", actionError(err));
    } finally {
      setModeBusy(false);
    }
  }

  async function routeAll() {
    if (bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await routeAllWaitingLeads();
      toast.success(
        `${res.routed} routed`,
        res.skipped > 0 ? `${res.skipped} had no eligible shop and stayed put.` : "Every waiting lead has a shop.",
      );
      router.refresh();
    } catch (err) {
      toast.error("Couldn't route them", actionError(err));
    } finally {
      setBulkBusy(false);
    }
  }

  const waiting = leads.filter((l) => l.status === "MANUAL_QUEUE" || l.status === "MATCHING").length;

  return (
    <div ref={rootRef} className={styles.root}>
      <div className="page-head rv">
        <div>
          <div className="kicker">Platform routing</div>
          <h1 className="page-title">Lead Center</h1>
        </div>
        <div className="page-actions">
          {/* WHO DECIDES. Automatic hands a new request to the best-scoring
              shop the moment it lands; Manual holds every request here until
              somebody sends it. One switch, because it is one decision. */}
          <div className={styles.modeSw} role="group" aria-label="Routing mode">
            {(["AUTO", "MANUAL"] as RoutingMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={cx(styles.modeBtn, mode === m && styles.modeOn)}
                aria-pressed={mode === m}
                disabled={modeBusy}
                onClick={() => void switchMode(m)}
              >
                <Ic name={m === "AUTO" ? "send" : "target"} />
                {m === "AUTO" ? "Automatic" : "Manual"}
              </button>
            ))}
          </div>
          {/* THE SUGGESTED PRICE ON AUTOMATIC ROUTING (owner, 2026-10-27): per trade, off until turned on. */}
          {PRICED_TRADES.map((t) => (
            <label key={t} className={styles.autoPrice} data-lead-auto-price={t}>
              <input type="checkbox" role="switch" aria-checked={auto[t]} checked={auto[t]} disabled={autoBusy} onChange={(e) => void switchAutoPrice(t, e.target.checked)} />
              <span>Charge the suggested price on automatic routing · {TRADE_WORD[t].toLowerCase()}</span>
            </label>
          ))}
          {/* THE HOUSE ORG (2026-10-28): the house estimators run as one of JobFlex's own organizations. */}
          <label className={styles.autoPrice} data-lead-house-org>
            <span>House estimators</span>
            <select value={house} disabled={houseBusy} onChange={(e) => void pickHouse(e.target.value)} aria-label="The organization the house estimators run as">
              <option value="">— off —</option>
              {orgs.filter((o) => o.isInternal).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
          {/* Who hears that a request came in, and when (2026-10-03). */}
          <Link className="btn btn-ghost" href={"/admin/lead-center/alerts" as Route}>
            <Ic name="bell" />
            Alerts
          </Link>
          <button className="btn btn-ghost" type="button" onClick={() => router.refresh()}>
            <Ic name="undo" />
            Refresh
          </button>
          {/* Manual mode's bulk escape: send everything waiting to its best
              match in one pass. Only offered when there is something waiting. */}
          {waiting > 0 ? (
            <button
              className={cx("btn btn-primary", bulkBusy && ui.btnBusy)}
              type="button"
              disabled={bulkBusy || mode === "MANUAL"}
              title={mode === "MANUAL" ? "Off in manual mode — send each lead by hand" : undefined}
              onClick={() => void routeAll()}
            >
              <Ic name="check" />
              {bulkBusy ? "Routing…" : `Route all ${waiting}`}
              {mode === "MANUAL" ? <span className={styles.modeTag}>Manual mode</span> : null}
            </button>
          ) : null}
        </div>
      </div>

      <StatusCard stats={stats} />

      <section className={cx("card rv", styles.ledgerCard)}>
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title">Leads</div>
          </div>
          {stats.openOffers > 0 ? (
            <span className={styles.live}>
              <span className={styles.liveDot} />
              {stats.openOffers} live
            </span>
          ) : null}
          <div className={ui.filters} role="group" aria-label="Filter leads">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={cx(ui.filter, tab === t.key && ui.filterOn)}
                aria-pressed={tab === t.key}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                <i>{counts[t.key]}</i>
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <Empty>
            {leads.length === 0
              ? "No homeowner requests yet."
              : `Nothing ${TABS.find((t) => t.key === tab)?.label.toLowerCase()}.`}
          </Empty>
        ) : (
          <div className={ui.tbl} role="table" aria-label="Platform leads">
            <div className={cx(ui.tr, ui.th, styles.cols)} role="row">
              <span>Lead</span>
              <span>Homeowner</span>
              <span>Source</span>
              <span>Went to</span>
              <span>Paid</span>
              <span>Status</span>
            </div>
            {rows.map((l) => (
              <LedgerRow
                key={l.id}
                lead={l}
                selected={l.id === selectedId}
                onOpen={() => openLead(l.id)}
                onOpenShop={openShop}
              />
            ))}
          </div>
        )}
      </section>

      {/* PRICED, NOT ASKING YET (owner, 2026-10-27): ranges people only asked to have emailed — a planned project on
          their dashboard, not a lead. Counted and shown with the city, never with a name or an email; nothing here
          routes, prices or opens. */}
      {savedRanges.length ? (
        <section className={cx("card rv", styles.ledgerCard)} data-lead-saved-ranges>
          <div className={styles.dSec} style={{ padding: "12px 16px 0" }}>Priced, not asking yet · {savedRanges.length}</div>
          <ul className={styles.savedList}>
            {savedRanges.slice(0, 50).map((r) => (
              <li key={r.id}>
                <span>{r.place ?? "—"}</span>
                <span>{r.words}</span>
                <span className={styles.dim}>{new Date(r.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </li>
            ))}
          </ul>
          <p className={cx(styles.dim, styles.savedNote)}>They saved a range and have not asked for quotes. Their dashboard and a nudge in two days offer it; nothing to route or sell here.</p>
        </section>
      ) : null}

      <TestLeadsCard testLink={testLink} leads={leads} orgs={orgs} testRuns={testRuns} onOpenLead={openLead} />

      <div ref={mapRef}>
        <MapCard
        leads={leads}
        orgs={orgs}
        filter={mapFilter}
        onFilter={setMapFilter}
        placing={placingId ? (byId.get(placingId) ?? null) : null}
        onClearPlacing={() => setPlacingId(null)}
        onPickLead={armLead}
        onPickShop={openShop}
        onOpenLead={openLead}
        />
      </div>

      <div className={styles.two}>
        <ShopsCard orgs={orgs} onOpen={openShop} />
        <AlgorithmCard />
      </div>

      <DetailSheet
        handleRef={detailRef}
        orgs={orgs}
        mode={mode}
        onClosed={() => setSelectedId(null)}
        onPlace={(id) => {
          armLead(id);
          mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
      <ShopSheet handleRef={shopRef} onSent={() => setPlacingId(null)} />
    </div>
  );
}

/* ============================================================
   STATUS — the four numbers, and nothing that has no data
   ============================================================ */

function StatusCard({ stats }: { stats: StatsDTO }) {
  const cells: { label: string; value: string; tone?: "live" | "warn" }[] = [
    { label: "New today", value: String(stats.todayCreated) },
    { label: "Matched today", value: String(stats.todayMatched) },
    { label: "Offers open", value: String(stats.openOffers), tone: stats.openOffers ? "live" : undefined },
    { label: "Need routing", value: String(stats.queue), tone: stats.queue ? "warn" : undefined },
  ];

  // The 30-day facts, as one line of prose, and only the parts that exist.
  const facts: string[] = [];
  if (stats.acceptRatePct != null) facts.push(`${Math.round(stats.acceptRatePct)}% of offers accepted`);
  if (stats.medianAcceptMin != null) {
    const m = stats.medianAcceptMin;
    facts.push(m >= 90 ? `${(m / 60).toFixed(1)} h to accept` : `${Math.round(m)} min to accept`);
  }
  if (stats.routedTotal > 0) facts.push(`${stats.routedTotal.toLocaleString("en-US")} routed all time`);

  return (
    <section className="card rv">
      <div className={styles.kpis}>
        {cells.map((c) => (
          <div key={c.label} className={styles.kpi}>
            <div className={styles.kpiLbl}>{c.label}</div>
            <div
              className={cx(
                styles.kpiVal,
                c.tone === "live" && styles.kpiLive,
                c.tone === "warn" && styles.kpiWarn,
              )}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {facts.length || stats.tradeDist.length ? (
        <div className={styles.statusFoot}>
          {facts.length ? <div className={styles.facts}>Last 30 days · {facts.join(" · ")}</div> : null}
          {stats.tradeDist.length ? (
            <div className={styles.trades}>
              {stats.tradeDist.slice(0, 4).map((t) => (
                <span key={t.trade} className={styles.trade}>
                  <Ic name={tradeIcon(t.trade)} />
                  <span className={styles.tradeName}>{t.trade}</span>
                  <span className={styles.tradeBar} aria-hidden="true">
                    <span style={{ width: `${Math.max(6, t.pct)}%` }} />
                  </span>
                  <span className={styles.tradeN}>{t.n}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* ============================================================
   LEDGER ROW
   ============================================================ */

function LedgerRow({
  lead,
  selected,
  onOpen,
  onOpenShop,
}: {
  lead: PlatformLeadDTO;
  selected: boolean;
  onOpen: () => void;
  /** The row names two records: a homeowner and a contractor. Each name opens
   *  its own, so the row is two handles rather than one. */
  onOpenShop: (id: string) => void;
}) {
  const st = statusTone(lead);
  return (
    <div
      className={cx(ui.tr, styles.cols, styles.trClick, selected && styles.trOn)}
      role="row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className={styles.lid}>
        <span className={styles.lidIc}>
          <Ic name={tradeIcon(lead.detectedTrade)} />
        </span>
        <span className={styles.lidNo}>{shortId(lead.id)}</span>
        {lead.isTest ? <span className={styles.testTag}>Test</span> : null}
      </div>

      <div className={ui.tdWide}>
        <span className={ui.tdLbl}>Homeowner</span>
        {/* The name is the handle for everything about this person, so it looks
            like one. The whole row opens the sheet; this is the affordance. */}
        <div className={cx(ui.tdName, styles.nameLink)} title={lead.name}>
          {lead.name}
        </div>
        <div className={ui.tdSub}>
          {lead.detectedTrade ?? lead.projectType ?? "Unclassified"} · {place(lead)}
        </div>
      </div>

      {/* SOURCE — where the request was started (LeadSource): a cost guide by
          its work and city, else the page it was sent from. */}
      <div className={ui.tdWide}>
        <span className={ui.tdLbl}>Source</span>
        <div className={ui.tdName} title={lead.source ? [lead.source.label, lead.source.detail].filter(Boolean).join(" · ") : undefined}>
          {lead.source?.label ?? <span className={styles.paidNone}>—</span>}
        </div>
        {lead.source?.detail ? <div className={ui.tdSub}>{lead.source.detail}</div> : null}
      </div>

      <div className={ui.tdWide}>
        <span className={ui.tdLbl}>Went to</span>
        {lead.wentToOrgId ? (
          <button
            type="button"
            className={cx(ui.tdName, styles.nameLink, styles.cellBtn)}
            title={destination(lead)}
            onClick={(e) => {
              // The row itself opens the homeowner; this cell opens the shop.
              e.stopPropagation();
              onOpenShop(lead.wentToOrgId as string);
            }}
          >
            {destination(lead)}
          </button>
        ) : (
          <div className={ui.tdName} title={destination(lead)}>
            {destination(lead)}
          </div>
        )}
        <div className={ui.tdSub}>{destinationNote(lead)}</div>
      </div>

      {/* PAID — what the shop paid to open it; a priced lead nobody has paid
          for yet shows its price, a free one a dash. */}
      <div className={styles.paidCell}>
        <span className={ui.tdLbl}>Paid</span>
        {lead.paid ? (
          <>
            <span className={cx(styles.paidAmt, lead.paid.refund && styles.paidRefunded)}>{usd(lead.paid.amountCents)}</span>
            <span className={styles.paidSub}>
              {lead.paid.refund ? "refunded" : shortDate(lead.paid.paidAt)}
              {lead.paid.mode === "test" ? " · test" : ""}
            </span>
          </>
        ) : lead.priceCents ? (
          <>
            <span className={styles.paidNone}>—</span>
            <span className={styles.paidSub}>price {usd(lead.priceCents)}</span>
          </>
        ) : (
          <span className={styles.paidNone}>—</span>
        )}
      </div>

      <div className={styles.statusCell}>
        <span className={ui.tdLbl}>Status</span>
        <Chip tone={st.tone}>{st.label}</Chip>
        {/* The countdown is the one thing a chip cannot say: how long is left. */}
        {lead.status === "OFFERED" && lead.activeOffer ? (
          <Countdown until={lead.activeOffer.expiresAt} />
        ) : null}
      </div>
    </div>
  );
}

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return (
    <span className={styles.countdown}>{s === 0 ? "expiring" : `${hh}:${mm} left`}</span>
  );
}

/* ============================================================
   SHOPS — the contractors, and who can take a lead
   ============================================================ */

function ShopsCard({ orgs, onOpen }: { orgs: OrgPickDTO[]; onOpen: (id: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const ready = orgs.filter(isMatchable).sort((a, b) => a.name.localeCompare(b.name));
  const notReady = orgs.filter((o) => !isMatchable(o)).sort((a, b) => a.name.localeCompare(b.name));

  const row = (o: OrgPickDTO, off?: boolean) => (
    <button key={o.id} type="button" className={styles.shop} onClick={() => onOpen(o.id)}>
      <span className={cx(styles.shopName, styles.nameLink, off && styles.shopOff)} title={o.name}>
        {o.name}
      </span>
      <Stars avg={o.ratingAvg} count={o.ratingCount} compact />
      {off ? (
        <Chip tone="mute">{eligibility(o)}</Chip>
      ) : (
        <span className={styles.shopTrades}>
          {o.trades.slice(0, 3).map((t) => (
            <span key={t} className={styles.shopTrade}>
              {t}
            </span>
          ))}
          {o.trades.length > 3 ? <span className={styles.shopTrade}>+{o.trades.length - 3}</span> : null}
        </span>
      )}
    </button>
  );

  return (
    <section className="card rv">
      <div className="card-head">
        <div className="card-titles">
          <div className="card-title">Contractors</div>
          <div className="card-sub">
            {ready.length} of {orgs.length} can receive offers.
          </div>
        </div>
      </div>

      {ready.length === 0 ? (
        <Empty>No contractor can receive offers yet — each needs trades, an address and offers on.</Empty>
      ) : (
        <div className={styles.shops}>{ready.map((o) => row(o))}</div>
      )}

      {/* The shops that cannot take a lead are a to-do list, not a roster: they
          collapse to one line until somebody asks. */}
      {notReady.length ? (
        <div className={styles.notReady}>
          <button
            type="button"
            className={cx(styles.disclose, showAll && styles.discloseOn)}
            onClick={() => setShowAll((v) => !v)}
          >
            <Ic name="chev" />
            {notReady.length} not ready
          </button>
          {showAll ? <div className={styles.shops}>{notReady.map((o) => row(o, true))}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

/* ============================================================
   MAP — leads in red, contractors in blue
   ============================================================ */

const FILTERS: { key: MapFilter; label: string }[] = [
  { key: "leads", label: "Leads" },
  { key: "shops", label: "Contractors" },
  { key: "both", label: "Both" },
];

function MapCard({
  leads,
  orgs,
  filter,
  onFilter,
  placing,
  onClearPlacing,
  onPickLead,
  onPickShop,
  onOpenLead,
}: {
  leads: PlatformLeadDTO[];
  orgs: OrgPickDTO[];
  filter: MapFilter;
  onFilter: (f: MapFilter) => void;
  placing: PlatformLeadDTO | null;
  onClearPlacing: () => void;
  onPickLead: (id: string) => void;
  onPickShop: (id: string) => void;
  onOpenLead: (id: string) => void;
}) {
  const mapLeads = useMemo(
    () =>
      leads
        .filter((l) => l.lat != null && l.lng != null)
        .map((l) => ({
          id: l.id,
          name: l.name,
          lat: l.lat as number,
          lng: l.lng as number,
          status: l.status,
          trade: l.detectedTrade,
          city: l.city,
        })),
    [leads],
  );
  const mapShops = useMemo(
    () =>
      orgs
        .filter((o) => o.lat != null && o.lng != null)
        .map((o) => ({
          id: o.id,
          name: o.name,
          lat: o.lat as number,
          lng: o.lng as number,
          matchable: isMatchable(o),
        })),
    [orgs],
  );

  const missing = leads.length - mapLeads.length;

  return (
    <section className={cx("card rv", styles.mapCard)}>
      <div className={cx("card-head", styles.mapHead)}>
        <div className="card-titles">
          <div className="card-title">Map</div>
        </div>
        <div className={ui.filters} role="group" aria-label="What the map shows">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={cx(ui.filter, filter === f.key && ui.filterOn)}
              aria-pressed={filter === f.key}
              onClick={() => onFilter(f.key)}
            >
              {f.label}
              <i>{f.key === "leads" ? mapLeads.length : f.key === "shops" ? mapShops.length : mapLeads.length + mapShops.length}</i>
            </button>
          ))}
        </div>
      </div>

      {/* Armed: the next contractor clicked is offered this lead. The bar is
          the only thing standing between a click and a real assignment, so it
          names the homeowner and stays until it is cleared. */}
      {placing ? (
        <div className={styles.placing}>
          <span className={styles.placingDot} />
          <span className={styles.placingTxt}>
            Sending <b>{placing.name}</b> · {placing.detectedTrade ?? "project"} — click a contractor on the map.
          </span>
          <button type="button" className={styles.placingBtn} onClick={() => onOpenLead(placing.id)}>
            Lead details
          </button>
          <button type="button" className={styles.placingBtn} onClick={onClearPlacing}>
            Cancel
          </button>
        </div>
      ) : null}

      <LeadMap
        leads={mapLeads}
        shops={mapShops}
        filter={filter}
        selectedLeadId={placing?.id ?? null}
        onPickLead={onPickLead}
        onPickShop={onPickShop}
        className={styles.mapHost}
      />

      <div className={styles.legend}>
        <span className={styles.leg}>
          <span className={cx(styles.legSq, styles.legLead)} />
          Homeowner lead
        </span>
        <span className={styles.leg}>
          <span className={cx(styles.legSq, styles.legShop)} />
          Contractor
        </span>
        <span className={styles.leg}>Click a lead, then a contractor, to send it.</span>
        {missing > 0 ? (
          <span className={cx(styles.leg, styles.legRight)}>{missing} without an address</span>
        ) : null}
      </div>
    </section>
  );
}

/* ============================================================
   HOW THE MATCH IS MADE — the algorithm, drawn
   ============================================================ */

/** The live numbers from lib/leadCenter/matching.ts and cascade.ts. If those
 *  move, these move with them — the diagram is documentation that has to stay
 *  true, not decoration. */
const FACTORS = [
  { label: "Distance", weight: 45, note: "≈50 mi falloff" },
  { label: "Rating", weight: 35, note: "client reviews, 4.0 prior · hidden ones count" },
  { label: "Response", weight: 20, note: "past accept speed" },
];

function AlgorithmCard() {
  return (
    <section className="card rv">
      <div className="card-head">
        <div className="card-titles">
          <div className="card-title">How a lead is matched</div>
        </div>
      </div>

      {/* Step 1 — the gate. Three yes/no conditions, drawn as three blocks. */}
      <div className={styles.algoStep}>
        <span className={styles.algoNo}>1</span>
        <span className={styles.algoLbl}>Who is eligible</span>
      </div>
      <div className={styles.gates}>
        {["Offers on", "Has an address", "Covers the trade", "Within its service radius"].map((g) => (
          <span key={g} className={styles.gate}>
            <Ic name="check" />
            {g}
          </span>
        ))}
      </div>

      {/* Step 2 — the score. Bars sized by weight; the label carries the number
          so the picture and the figure agree. */}
      <div className={styles.algoStep}>
        <span className={styles.algoNo}>2</span>
        <span className={styles.algoLbl}>Score each one</span>
      </div>
      <div className={styles.factors}>
        {FACTORS.map((f) => (
          <div key={f.label} className={styles.factor}>
            <span className={styles.factorName}>{f.label}</span>
            <span className={styles.factorBar}>
              <span style={{ width: `${f.weight}%` }} />
            </span>
            <span className={styles.factorPct}>{f.weight}%</span>
            <span className={styles.factorNote}>{f.note}</span>
          </div>
        ))}
      </div>

      {/* Step 3 — the cascade. Three attempts, then here. */}
      <div className={styles.algoStep}>
        <span className={styles.algoNo}>3</span>
        <span className={styles.algoLbl}>Offer in order</span>
      </div>
      <div className={styles.cascade}>
        {[1, 2, 3].map((n) => (
          <span key={n} className={styles.casStep}>
            <span className={styles.casNo}>#{n}</span>
            <span className={styles.casTime}>24 h</span>
          </span>
        ))}
        <span className={styles.casArrow}>
          <Ic name="arrow" />
        </span>
        <span className={cx(styles.casStep, styles.casEnd)}>
          <span className={styles.casNo}>Queue</span>
          <span className={styles.casTime}>you route it</span>
        </span>
      </div>
    </section>
  );
}

/* ============================================================
   DETAIL SHEET — who they are, where the lead went, what you can do
   ============================================================ */

function DetailSheet({
  handleRef,
  orgs,
  mode,
  onClosed,
  onPlace,
}: {
  handleRef: React.RefObject<DetailHandle | null>;
  orgs: OrgPickDTO[];
  /** Manual mode switches the cascade off — and its button with it. */
  mode: RoutingMode;
  onClosed: () => void;
  /** Hand this lead to the map: it arms, and the next contractor clicked gets
   *  it. The same journey as clicking the lead's pin, from the row. */
  onPlace: (id: string) => void;
}) {
  const router = useRouter();
  const [lead, setLead] = useState<PlatformLeadDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllShops, setShowAllShops] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);
  const [showRanking, setShowRanking] = useState(false);

  const { ref: mdlRef, open: openDialog, close: closeDialog } = useMdl();
  const close = useCallback(() => {
    closeDialog();
    onClosed();
  }, [closeDialog, onClosed]);

  const open = useCallback(
    (l: PlatformLeadDTO) => {
      setLead(l);
      setError(null);
      setBusy(null);
      setShowAllShops(false);
      setShowOutOfArea(false);
      setShowRanking(false);
      openDialog();
    },
    [openDialog],
  );
  useEffect(() => {
    handleRef.current = { open };
  }, [handleRef, open]);

  async function assign(org: OrgPickDTO) {
    if (busy || !lead) return;
    setBusy(org.id);
    setError(null);
    try {
      await manualAssignPlatformLead(lead.id, org.id);
      toast.success("Offer sent", `${org.name} has 24 hours to accept or pass. The homeowner's contacts open when they accept.`);
      close();
      router.refresh();
    } catch (err) {
      setError(actionError(err));
    } finally {
      setBusy(null);
    }
  }

  async function requeue() {
    if (busy || !lead) return;
    setBusy("requeue");
    setError(null);
    try {
      await requeuePlatformLead(lead.id);
      toast.success("Sent to cascade", "Attempts reset; shops already offered are skipped.");
      close();
      router.refresh();
    } catch (err) {
      setError(actionError(err));
    } finally {
      setBusy(null);
    }
  }

  // The hand-send list keeps the cascade's rules (lib/leadCenter/matching):
  // shops that take this lead's trade AND whose service radius reaches it come
  // first, in the cascade's own order. Two exceptions a person may still make
  // stay behind their own switches: "Show out of area" (the trade, but beyond
  // the shop's miles or with no pin to measure), nearest first; and "Show all"
  // (other trades, then shops not set up for leads at all).
  // Before 2026-10-02 the list was every set-up shop, trade unchecked; before
  // 2026-10-03 distance was only a score, so a Tucson lead listed a Missouri shop.
  const order = new Map((lead?.shopOrder ?? []).map((s, i) => [s.orgId, { i, ...s }]));
  const byOrder = (a: OrgPickDTO, b: OrgPickDTO) =>
    (order.get(a.id)?.i ?? 9999) - (order.get(b.id)?.i ?? 9999) || a.name.localeCompare(b.name);
  const byDistance = (a: OrgPickDTO, b: OrgPickDTO) =>
    (order.get(a.id)?.distanceMi ?? Infinity) - (order.get(b.id)?.distanceMi ?? Infinity) || byOrder(a, b);
  const inTrade = (o: OrgPickDTO) => isMatchable(o) && order.get(o.id)?.coversTrade === true;
  const readyShops = orgs.filter((o) => inTrade(o) && order.get(o.id)?.inRadius === true).sort(byOrder);
  const outOfAreaShops = orgs.filter((o) => inTrade(o) && order.get(o.id)?.inRadius !== true).sort(byDistance);
  const otherShops = [
    ...orgs.filter((o) => isMatchable(o) && order.get(o.id)?.coversTrade !== true).sort(byOrder),
    ...orgs.filter((o) => !isMatchable(o)).sort(byOrder),
  ];
  // A test lead (lib/leadCenter/testLeads) goes to JobFlex's own organizations
  // only — whatever their trade, area or setup — and to nobody else.
  const internalShops = orgs.filter((o) => o.isInternal).sort((a, b) => a.name.localeCompare(b.name));
  const listed = lead?.isTest
    ? internalShops
    : [...readyShops, ...(showOutOfArea ? outOfAreaShops : []), ...(showAllShops ? otherShops : [])];
  const tradeLabel = lead?.detectedTrade ?? "this trade";
  /** "12 mi", "1,113 mi", or why there is no number. */
  const milesLabel = (o: OrgPickDTO): string | null => {
    const s = order.get(o.id);
    if (!s) return null;
    if (s.distanceMi == null) return "no pin";
    return `${Math.round(s.distanceMi).toLocaleString("en-US")} mi`;
  };
  /** The small line on a hand-send row: how far, and why it sits where it does. */
  const assignNote = (o: OrgPickDTO): string => {
    if (lead?.isTest) {
      // Every internal organization is listed for a test lead — whatever its
      // trade, radius, offers switch or pin — so the row says, for
      // information, what it takes and how far it is when both pins exist.
      const trades = o.trades.length ? o.trades.join(", ") : o.otherTrade || "no trades";
      const miles =
        lead.lat != null && lead.lng != null && o.lat != null && o.lng != null
          ? `${Math.round(haversineMiles({ lat: lead.lat, lng: lead.lng }, { lat: o.lat, lng: o.lng })).toLocaleString("en-US")} mi`
          : "no distance";
      return [trades, miles, o.offersEnabled ? null : "offers off"].filter(Boolean).join(" · ");
    }
    if (!isMatchable(o)) return eligibility(o);
    const s = order.get(o.id);
    const miles = milesLabel(o);
    const score = s ? `match ${Math.round(s.score * 100)}` : null;
    if (s?.coversTrade !== true) return [miles, "other trade", score].filter(Boolean).join(" · ");
    if (s && !s.inRadius) return [miles, `outside ${s.radiusMi} mi`].filter(Boolean).join(" · ");
    return [miles, score, `★ ${ratingLabel(o.ratingAvg, o.ratingCount)}`].filter(Boolean).join(" · ");
  };
  // The ranking table reads stars off the snapshot when it carries them, else
  // off the live roster (snapshots taken before 2026-09-13 have no numbers).
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const rankRating = (r: RankEntry) => {
    const live = orgById.get(r.orgId);
    const avg = r.ratingCount != null ? (r.ratingAvg ?? null) : (live?.ratingAvg ?? null);
    const count = r.ratingCount ?? live?.ratingCount ?? 0;
    return ratingLabel(avg, count);
  };

  return (
    <Sheet
      mdlRef={mdlRef}
      title={lead ? `${lead.name} · ${shortId(lead.id)}` : "Lead"}
      titleId="lcDetailTitle"
      size="lg"
      onClose={close}
      error={error}
      foot={
        lead ? (
          <>
            <button className="btn btn-ghost" type="button" onClick={close} disabled={busy !== null}>
              Close
            </button>
            {lead.status !== "MATCHED" ? (
              <button
                className="btn btn-ghost"
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  onPlace(lead.id);
                  close();
                }}
              >
                <Ic name="pin" />
                Pick on the map
              </button>
            ) : null}
            {lead.status === "MANUAL_QUEUE" && !lead.isTest ? (
              <button
                className={cx("btn btn-primary", busy === "requeue" && ui.btnBusy)}
                type="button"
                onClick={requeue}
                disabled={busy !== null || mode === "MANUAL"}
                title={mode === "MANUAL" ? "Off in manual mode — send it by hand" : undefined}
              >
                <Ic name="send" />
                {busy === "requeue" ? "Sending…" : "Try the cascade again"}
                {mode === "MANUAL" ? <span className={styles.modeTag}>Manual mode</span> : null}
              </button>
            ) : null}
          </>
        ) : null
      }
    >
      {!lead ? null : (
        <>
          {/* WHERE IS IT — the sentence the admin came for, first and in plain
              words. Everything below is the evidence for it. */}
          <div className={styles.dLede}>
            <Chip tone={statusTone(lead).tone}>{statusTone(lead).label}</Chip>
            {lead.isTest ? <span className={styles.testTag}>Test</span> : null}
            <span>{whereItStands(lead)}</span>
          </div>

          {/* WHO THEY ARE — reachable, not just readable: the email and the
              phone are links, because the next thing an admin does with them is
              get in touch. */}
          <div className={styles.dSec}>Homeowner</div>
          <div className={styles.fields}>
            <Field label="Email">
              <a className={styles.link} href={`mailto:${lead.email}`}>
                {lead.email}
              </a>
            </Field>
            <Field label="Phone">
              {lead.phone ? (
                <a className={styles.link} href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>
                  {lead.phone}
                </a>
              ) : (
                <span className={styles.dim}>not given</span>
              )}
            </Field>
            <Field label="Address">
              {[lead.address, place(lead)].filter(Boolean).join(" · ")}
              {lead.geocoded ? "" : " · no map pin"}
            </Field>
            <Field label="Trade">
              {lead.detectedTrade ?? lead.projectType ?? "Unclassified"}
              {lead.aiConfidence != null ? (
                <span className={styles.dim}> · {Math.round(lead.aiConfidence * 100)}% sure</span>
              ) : null}
            </Field>
            <Field label="Source">
              {lead.source ? [lead.source.label, lead.source.detail].filter(Boolean).join(" · ") : <span className={styles.dim}>not recorded</span>}
            </Field>
            {/* The TCPA consent the request was sent with (lib/leadConsent): the words are on hover. */}
            <Field label="Contact consent">
              {lead.consent ? (
                <span title={lead.consent.text}>
                  Ticked {shortDate(lead.consent.at)} {new Date(lead.consent.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  <span className={styles.dim}>
                    {lead.consent.ip ? ` · IP ${lead.consent.ip}` : ""}
                    {lead.consent.page ? ` · ${lead.consent.page}` : ""}
                  </span>
                </span>
              ) : (
                <span className={styles.dim}>not recorded</span>
              )}
            </Field>
          </div>

          {lead.estimate ? <PricedBlock estimate={lead.estimate} /> : null}

          {lead.description ? (
            <>
              <div className={styles.dSec}>What they asked for</div>
              <div className={styles.dDesc}>{lead.description}</div>
            </>
          ) : null}

          {/* THE TRAIL — only when there is one. Three empty boxes under three
              headings was most of the old sheet. */}
          {lead.offers.length ? (
            <>
              <div className={styles.dSec}>Offers sent</div>
              <div className={styles.tl}>
                {lead.offers.map((o) => (
                  <div key={o.id} className={styles.tlRow}>
                    <span title={o.orgName}>
                      {o.attempt}. {o.orgName}
                    </span>
                    <span className={styles.mono}>
                      {o.status === "OFFERED"
                        ? "waiting"
                        : o.status.toLowerCase() + (o.respondedAt ? ` ${relative(o.respondedAt)}` : "")}
                    </span>
                    <Chip tone={OFFER_TONE[o.status] ?? "mute"}>{Math.round(o.score * 100)}</Chip>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {lead.ranking.length ? (
            <>
              <button
                type="button"
                className={cx(styles.disclose, showRanking && styles.discloseOn)}
                onClick={() => setShowRanking((v) => !v)}
              >
                <Ic name="chev" />
                Why these shops ({lead.ranking.length} scored)
              </button>
              {showRanking ? (
                <div className={styles.rank}>
                  <div className={cx(styles.rankRow, styles.rankHead)}>
                    <span>#</span>
                    <span>Shop</span>
                    <span className={cx(styles.rankN, styles.rankHide)}>Dist</span>
                    <span className={cx(styles.rankN, styles.rankHide)}>Rating</span>
                    <span className={cx(styles.rankN, styles.rankHide)}>Resp</span>
                    <span className={styles.rankN}>Total</span>
                  </div>
                  {lead.ranking.map((r, i) => (
                    <div key={r.orgId} className={styles.rankRow}>
                      <span className={styles.rankNo}>{i + 1}</span>
                      <span className={styles.rankOrg} title={r.orgName}>
                        {r.orgName}
                      </span>
                      <span className={cx(styles.rankN, styles.rankHide)}>
                        {r.distanceMi == null ? (r.fallback ? "zip" : "—") : `${r.distanceMi} mi`}
                      </span>
                      <span
                        className={cx(styles.rankN, styles.rankHide)}
                        title={`Rating component: ${Math.round(r.ratingScore * 100)} of 100 (4.0 prior, weight 5)`}
                      >
                        {rankRating(r)}
                      </span>
                      <span className={cx(styles.rankN, styles.rankHide)}>{Math.round(r.respScore * 100)}</span>
                      <span className={cx(styles.rankN, styles.rankTot)}>{Math.round(r.score * 100)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          {/* A paid lead: the payment, and the admin's refund. */}
          {lead.paid ? <PaidBlock key={`paid-${lead.id}`} lead={lead} /> : null}

          {/* THE PRICE sits with the hand-send: set it, then send. */}
          {lead.status !== "MATCHED" ? <PriceBlock key={`price-${lead.id}`} lead={lead} /> : null}

          {lead.status !== "MATCHED" ? (
            <>
              <div className={styles.dSec}>Send it by hand</div>
              <div className={styles.assign}>
                {listed.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={styles.assignBtn}
                    disabled={busy !== null}
                    onClick={() => assign(o)}
                  >
                    <Ic name={isMatchable(o) ? "check" : "ban"} />
                    <span>{o.name}</span>
                    <i>{busy === o.id ? "sending…" : assignNote(o)}</i>
                  </button>
                ))}
                {lead.isTest && internalShops.length === 0 ? (
                  <Empty>No internal organization yet — mark one in its contractor sheet.</Empty>
                ) : null}
                {!lead.isTest && readyShops.length === 0 && !showAllShops && !showOutOfArea ? (
                  <Empty>No shop that takes {tradeLabel} serves this area.</Empty>
                ) : null}
                {!lead.isTest && outOfAreaShops.length ? (
                  <button
                    type="button"
                    className={cx(styles.disclose, showOutOfArea && styles.discloseOn)}
                    aria-pressed={showOutOfArea}
                    onClick={() => setShowOutOfArea((v) => !v)}
                  >
                    <Ic name="chev" />
                    {showOutOfArea ? "Hide out of area" : `Show out of area · ${outOfAreaShops.length}`}
                  </button>
                ) : null}
                {!lead.isTest && otherShops.length ? (
                  <button
                    type="button"
                    className={cx(styles.disclose, showAllShops && styles.discloseOn)}
                    onClick={() => setShowAllShops((v) => !v)}
                  >
                    <Ic name="chev" />
                    {showAllShops ? "Hide other shops" : `Show all · ${otherShops.length} more`}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

/* ============================================================
   PAID LEADS (2026-10-02) — the price an admin sets, and the
   payment a shop made (lib/leadCenter/purchase)
   ============================================================ */

/** THE RANGE THE HOMEOWNER PRICED (2026-10-27): what they saw and chose, the roof's size and where the number came
 *  from, their budget. The whole estimate under it opens in the buyer's roof estimator, never here. */
function PricedBlock({ estimate: e }: { estimate: LeadEstimate }) {
  // A range in whole dollars, grouped — not a payment amount.
  const money = (dollars: number) => "$" + Math.round(dollars).toLocaleString("en-US");
  if (e.trade !== "roof") {
    // A house estimate (2026-10-28): the website estimator's own record — the choice, the summary, the band.
    return (
      <>
        <div className={styles.dSec}>Priced by the homeowner</div>
        <div className={styles.dDesc} data-lead-priced>
          <b>{money(e.range.low)}–{money(e.range.high)}</b> · {e.web.choice} · {TRADE_NOUN[e.trade]}
          <br />
          {e.web.summary}
          {e.note ? <> · their note: &ldquo;{e.note}&rdquo;</> : null}
          <br />
          <span className={styles.dim}>Opens priced in the buyer&rsquo;s {estimatorNameFor(e.trade)}.</span>
        </div>
      </>
    );
  }
  const basis = e.measurementId ? "measured" : e.basis === "solar" ? "aerial read" : "from home size";
  return (
    <>
      <div className={styles.dSec}>Priced by the homeowner</div>
      <div className={styles.dDesc} data-lead-priced>
        <b>{money(e.range.low)}–{money(e.range.high)}</b> · {e.materialLabel.toLowerCase()} · {e.tearOffLayers === 0 ? "no tear-off" : `tear-off ${e.tearOffLayers} layer${e.tearOffLayers === 1 ? "" : "s"}`} · {e.storeys} floor{e.storeys === 1 ? "" : "s"}
        <br />
        {Math.round(e.squares)} squares · {e.pitchLabel} · {basis}
        {e.budgetCents ? <> · budget about {money(e.budgetCents / 100)}</> : null}
        {e.guideRange ? <> · the city guide says {money(e.guideRange.low)}–{money(e.guideRange.high)}</> : null}
        <br />
        <span className={styles.dim}>The whole estimate ({e.hidden.materials.length + e.hidden.labor.length} lines) opens in the buyer&rsquo;s roof estimator.</span>
      </div>
    </>
  );
}

/** "Lead price, $" — optional; empty is free. Changes until a shop accepts. */
function PriceBlock({ lead }: { lead: PlatformLeadDTO }) {
  const router = useRouter();
  const [saved, setSaved] = useState<number | null>(lead.priceCents);
  const [draft, setDraft] = useState(lead.priceCents ? String(lead.priceCents / 100) : "");
  const [busy, setBusy] = useState(false);
  const [exclusive, setExclusiveOn] = useState(lead.exclusive);
  const [exBusy, setExBusy] = useState(false);
  const suggested = lead.estimate ? suggestedLeadPriceCents(lead.estimate, exclusive) : null;
  async function flipExclusive(next: boolean) {
    if (exBusy) return;
    setExBusy(true);
    setExclusiveOn(next);
    try {
      await setLeadExclusive(lead.id, next);
      router.refresh();
    } catch (err) {
      setExclusiveOn(!next);
      toast.error("Couldn't save", actionError(err));
    } finally {
      setExBusy(false);
    }
  }
  const id = `lcPrice-${lead.id}`;

  const trimmed = draft.trim();
  const parsed = trimmed === "" ? null : Math.round(Number(trimmed) * 100);
  const invalid = parsed != null && (!Number.isFinite(parsed) || parsed < 100 || parsed > 100_000);
  const dirty = parsed !== saved;

  async function save() {
    if (busy || invalid || !dirty) return;
    setBusy(true);
    try {
      const res = await setPlatformLeadPrice(lead.id, parsed);
      setSaved(res.priceCents);
      toast.success(
        res.priceCents ? `Price set · ${usd(res.priceCents)}` : "Price removed",
        res.priceCents ? "The open offer and every next one ask this to unlock the contacts." : "This lead is free again.",
      );
      router.refresh();
    } catch (err) {
      toast.error("Couldn't save the price", actionError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={styles.dSec}>Lead price</div>
      <div className={styles.priceRow}>
        <div className="mf">
          <label className="mf-lbl" htmlFor={id}>
            Lead price, $
          </label>
          <input
            className="mf-in"
            id={id}
            type="number"
            inputMode="decimal"
            min={1}
            max={1000}
            step="1"
            placeholder="Free"
            value={draft}
            aria-invalid={invalid}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
          />
        </div>
        <button
          className={cx("btn btn-ghost", ui.btnSm, busy && ui.btnBusy)}
          type="button"
          disabled={busy || invalid || !dirty}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save price"}
        </button>
      </div>
      {suggested != null ? (
        <div className={cx(ui.hint, styles.priceHint)} data-lead-suggested>
          Suggested: {usd(suggested)} — priced by the homeowner{lead.estimate?.measurementId ? ", measured" : ""}{lead.estimate?.measurementId && lead.estimate?.budgetCents ? ", with a budget" : ""}{exclusive ? ", exclusive" : ""}.{" "}
          <button type="button" className={cx("btn btn-ghost", ui.btnSm)} disabled={busy || parsed === suggested} onClick={() => setDraft(String(suggested / 100))} data-lead-use-suggested>
            Use it
          </button>
        </div>
      ) : null}
      {lead.estimate ? (
        <label className={styles.exclusive} data-lead-exclusive>
          <input type="checkbox" checked={exclusive} disabled={exBusy} onChange={(e) => void flipExclusive(e.target.checked)} />
          <span>Exclusive — nobody else gets this lead (doubles the suggestion, said on the offer)</span>
        </label>
      ) : null}
      <div className={cx(ui.hint, styles.priceHint, invalid && styles.hintBad)}>
        {invalid
          ? "A price is $1 to $1,000 — or leave it empty for a free lead."
          : saved
            ? `Shops pay ${usd(saved)} to open the homeowner's contacts. Change it any time before one accepts.`
            : "Empty = free, as before. With a price, the contacts open only after the shop pays."}
      </div>
    </>
  );
}

/** The payment a shop made for this lead, and the refund (admin only, with a reason). */
function PaidBlock({ lead }: { lead: PlatformLeadDTO }) {
  const router = useRouter();
  const paid = lead.paid!;
  const [refund, setRefund] = useState(paid.refund);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const id = `lcRefund-${lead.id}`;

  async function doRefund() {
    if (busy || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await refundLeadPurchase(paid.offerId, reason.trim());
      setRefund({ amountCents: paid.amountCents, reason: reason.trim(), at: new Date().toISOString() });
      setAsking(false);
      toast.success(`Refunded ${usd(paid.amountCents)}`, `${paid.orgName} gets it back on the card; the reason is in their activity log.`);
      router.refresh();
    } catch (err) {
      toast.error("Couldn't refund", actionError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={styles.dSec}>Payment</div>
      <div className={styles.fields}>
        <Field label="Paid">
          <span className={styles.payVal}>{usd(paid.amountCents)}</span>
          <span className={styles.dim}> · {shortDate(paid.paidAt)}</span>
        </Field>
        <Field label="By">{paid.orgName}</Field>
        <Field label="How">{paid.via === "checkout" ? "Stripe Checkout" : "Card on file"}</Field>
        <Field label="Stripe">
          {/* Exact case: a PaymentIntent id is what support searches Stripe for. */}
          <span className={styles.payVal} title={paid.paymentIntentId}>
            {paid.paymentIntentId}
          </span>
          {paid.mode === "test" ? <span className={styles.dim}> · test mode</span> : null}
        </Field>
      </div>
      {refund ? (
        <div className={styles.refundDone}>
          Refunded {usd(refund.amountCents)} on {shortDate(refund.at)} — {refund.reason}
        </div>
      ) : asking ? (
        <div className={styles.refundForm}>
          <div className="mf">
            <label className="mf-lbl" htmlFor={id}>
              Reason for the refund
            </label>
            <textarea
              className={cx("mf-in", ui.area)}
              id={id}
              rows={2}
              maxLength={400}
              value={reason}
              placeholder="e.g. phone number disconnected, homeowner never asked"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className={ui.hint}>
            Goes back to the shop&apos;s card through Stripe and into their activity log. It cannot be undone.
          </div>
          <div className={styles.refundAct}>
            <button
              className={cx("btn", ui.btnSm, ui.btnBad, busy && ui.btnBusy)}
              type="button"
              disabled={busy || reason.trim().length < 3}
              onClick={() => void doRefund()}
            >
              {busy ? "Refunding…" : `Refund ${usd(paid.amountCents)}`}
            </button>
            <button className={cx("btn btn-ghost", ui.btnSm)} type="button" disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className={cx("btn", ui.btnSm, ui.btnBad, styles.refundOpen)} type="button" onClick={() => setAsking(true)}>
          Refund
        </button>
      )}
    </>
  );
}

/** One plain sentence: where this request stands right now. */
function whereItStands(l: PlatformLeadDTO): string {
  switch (l.status) {
    case "MATCHED": {
      const shop = l.matchedOrgName ?? "a shop";
      const when = l.matchedAt ? ` on ${shortDate(l.matchedAt)}` : "";
      return l.shopLeadStatus === "ROUTED"
        ? `Sent to ${shop}${when} — waiting for them to accept it.`
        : `${shop} accepted it${when}.`;
    }
    case "OFFERED":
      if (l.activeOffer?.manual) {
        return `Sent by hand to ${l.activeOffer.orgName} — 24 hours to accept or pass. The homeowner's contacts open when they accept.`;
      }
      return l.activeOffer
        ? `Offered to ${l.activeOffer.orgName} — attempt ${l.activeOffer.attempt} of 3, 24 hours to answer.`
        : "An offer is open.";
    case "MANUAL_QUEUE":
      if (l.queueReason === "TEST_LEAD") {
        return "Test lead — it never goes to the cascade. Send it to an internal organization.";
      }
      if (l.queueReason === "RETURNED") {
        return "Back from the shop it was sent to — it passed, ran out of time, or the homeowner asked for another. Send it again.";
      }
      if (l.queueReason === "NO_CANDIDATES") {
        return "No contractor covers this trade or area — send it by hand.";
      }
      if (l.queueReason === "MANUAL_MODE") {
        return "Held for you: routing is set to manual, so nothing was offered.";
      }
      if (l.queueReason?.startsWith("TRADE_UNDETERMINED")) {
        return "The trade could not be read from the description — send it by hand.";
      }
      // Two different endings, told apart rather than blurred into one:
      // the pool was used up, or the pool ran dry early. The dialog used to say
      // "Three contractors passed" over an offer list showing one line.
      if (l.queueReason?.startsWith("CANDIDATES_SPENT")) {
        const n = Math.max(0, l.attemptCount);
        return `${n === 1 ? "The one shop that qualified" : `All ${n} shops that qualified`} ${
          n === 1 ? "did not take it" : "were asked and none took it"
        }, and there are no others in range — send it by hand.`;
      }
      return "Three contractors passed or ran out of time — send it by hand.";
    default:
      return "Ranking shops now.";
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <div className={styles.fieldLbl}>{label}</div>
      <div className={styles.fieldVal}>{children}</div>
    </div>
  );
}

const OFFER_TONE: Record<string, Tone> = {
  OFFERED: "wait",
  ACCEPTED: "ok",
  DECLINED: "bad",
  EXPIRED: "mute",
  CANCELLED: "mute",
};

/* ============================================================
   CONTRACTOR SHEET — the shop's record, and the send-this-lead confirm
   ============================================================ */

type ShopHandle = { open: (shop: OrgPickDTO, lead: PlatformLeadDTO | null) => void };

function ShopSheet({
  handleRef,
  onSent,
}: {
  handleRef: React.RefObject<ShopHandle | null>;
  onSent: () => void;
}) {
  const router = useRouter();
  const [shop, setShop] = useState<OrgPickDTO | null>(null);
  const [lead, setLead] = useState<PlatformLeadDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { ref: mdlRef, open: openDialog, close: closeDialog } = useMdl();
  const close = useCallback(() => closeDialog(), [closeDialog]);

  const open = useCallback(
    (s: OrgPickDTO, l: PlatformLeadDTO | null) => {
      setShop(s);
      setLead(l);
      setError(null);
      setBusy(false);
      openDialog();
    },
    [openDialog],
  );
  useEffect(() => {
    handleRef.current = { open };
  }, [handleRef, open]);

  async function send() {
    if (!shop || !lead || busy) return;
    setBusy(true);
    setError(null);
    try {
      await manualAssignPlatformLead(lead.id, shop.id);
      toast.success("Offer sent", `${shop.name} has 24 hours to accept or pass. The homeowner's contacts open when they accept.`);
      close();
      onSent();
      router.refresh();
    } catch (err) {
      setError(actionError(err));
    } finally {
      setBusy(false);
    }
  }

  const acceptPct =
    shop && shop.offersReceived > 0 ? Math.round((shop.offersAccepted / shop.offersReceived) * 100) : null;

  return (
    <Sheet
      mdlRef={mdlRef}
      title={shop ? shop.name : "Contractor"}
      titleId="lcShopTitle"
      size="md"
      onClose={close}
      error={error}
      foot={
        shop ? (
          <>
            <button className="btn btn-ghost" type="button" onClick={close} disabled={busy}>
              Close
            </button>
            {lead ? (
              <button
                className={cx("btn btn-primary", busy && ui.btnBusy)}
                type="button"
                onClick={() => void send()}
                disabled={busy}
              >
                <Ic name="send" />
                {busy ? "Sending…" : `Send ${lead.name}`}
              </button>
            ) : null}
          </>
        ) : null
      }
    >
      {!shop ? null : (
        <>
          <div className={styles.dLede}>
            <Chip tone={isMatchable(shop) ? "ok" : "mute"}>{eligibility(shop)}</Chip>
            <span>
              {shop.trades.length
                ? `Takes ${shop.trades.join(", ")}${shop.otherTrade ? `, ${shop.otherTrade}` : ""}.`
                : "No trades picked yet, so nothing can be matched to them."}
            </span>
          </div>

          <div className={styles.dSec}>Contact</div>
          <div className={styles.fields}>
            <Field label="Email">
              {shop.email ? (
                <a className={styles.link} href={`mailto:${shop.email}`}>
                  {shop.email}
                </a>
              ) : (
                <span className={styles.dim}>not set</span>
              )}
            </Field>
            <Field label="Phone">
              {shop.phone ? (
                <a className={styles.link} href={`tel:${shop.phone.replace(/[^\d+]/g, "")}`}>
                  {shop.phone}
                </a>
              ) : (
                <span className={styles.dim}>not set</span>
              )}
            </Field>
            <Field label="Address">
              {shop.address || <span className={styles.dim}>not set</span>}
              {shop.address && !shop.geocoded ? <span className={styles.dim}> · no map pin</span> : null}
            </Field>
            <Field label="With us since">{shortDate(shop.joinedAt)}</Field>
          </div>

          <div className={styles.dSec}>Track record</div>
          <div className={styles.fields}>
            <Field label="Client rating">
              <Stars avg={shop.ratingAvg} count={shop.ratingCount} />
            </Field>
            <Field label="Offers seen">{shop.offersReceived}</Field>
            <Field label="Accepted">
              {shop.offersAccepted}
              {acceptPct != null ? <span className={styles.dim}> · {acceptPct}%</span> : null}
            </Field>
            <Field label="Leads held">{shop.leadsMatched}</Field>
            <Field label="Offers">{shop.offersEnabled ? "On" : "Paused"}</Field>
            <Field label="Service radius">{shop.radiusMi} mi</Field>
          </div>

          {/* INTERNAL — JobFlex's own organization: the only kind a test lead
              can be sent to (lib/leadCenter/testLeads). */}
          <InternalSwitch key={shop.id} shop={shop} />

          {/* WHAT IS ABOUT TO HAPPEN. The confirm button says the homeowner's
              name; this says what they asked for, so the decision is made on
              the job and not on a name alone. */}
          {lead ? (
            <>
              <div className={styles.dSec}>The lead you are sending</div>
              <div className={styles.dDesc}>
                <b>{lead.name}</b> · {lead.detectedTrade ?? lead.projectType ?? "Unclassified"} ·{" "}
                {place(lead)}
                {lead.description ? (
                  <>
                    <br />
                    {lead.description}
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

/* ============================================================
   TEST LEADS (2026-10-03) — lib/leadCenter/testLeads
   ============================================================ */

function InternalSwitch({ shop }: { shop: OrgPickDTO }) {
  const router = useRouter();
  const [on, setOn] = useState(shop.isInternal);
  const [busy, setBusy] = useState(false);
  async function flip() {
    if (busy) return;
    setBusy(true);
    try {
      await setOrganizationInternal(shop.id, !on);
      setOn(!on);
      toast.success(!on ? "Marked internal" : "No longer internal", !on ? `${shop.name} can receive test leads.` : `${shop.name} gets no test leads.`);
      router.refresh();
    } catch (err) {
      toast.error("Couldn't change it", actionError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.internalRow}>
      <div>
        <div className={styles.internalT}>Internal organization</div>
        <div className={styles.internalH}>JobFlex&apos;s own. Test leads go to internal organizations only.</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Internal organization"
        className={cx(styles.switch, on && styles.switchOn)}
        disabled={busy}
        onClick={() => void flip()}
      >
        <span />
      </button>
    </div>
  );
}

function TestLeadsCard({
  testLink,
  leads,
  orgs,
  testRuns,
  onOpenLead,
}: {
  testLink: { link: string; createdAt: string } | null;
  leads: PlatformLeadDTO[];
  orgs: OrgPickDTO[];
  testRuns: Record<string, TestRunDTO>;
  onOpenLead: (id: string) => void;
}) {
  const router = useRouter();
  const [link, setLink] = useState(testLink);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // THE TEST ENVIRONMENT (owner, 2026-10-29): on by default — a run routes automatically to the internal
  // organizations, and every email and text is recorded below instead of sent.
  const blank = { name: "", email: "", zip: "", address: "", trade: "", description: "", auto: true };
  const [form, setForm] = useState(blank);

  async function rotate() {
    if (busy) return;
    setBusy("key");
    try {
      const res = await rotateLeadTestKey();
      setLink({ link: res.link, createdAt: res.createdAt });
      setConfirming(false);
      toast.success(link ? "New test link" : "Test link created", link ? "The old link no longer makes test leads." : "Copy it and open it anywhere.");
      router.refresh();
    } catch (err) {
      toast.error("Couldn't make the link", actionError(err));
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.link);
      toast.success("Link copied", "Open it in any browser — no sign-in needed.");
    } catch {
      toast.error("Couldn't copy", "Select the link and copy it by hand.");
    }
  }

  const formOk =
    form.name.trim().length > 0 &&
    /^\S+@\S+\.\S+$/.test(form.email.trim()) &&
    /^\d{5}$/.test(form.zip.trim()) &&
    form.description.trim().length >= 10;

  async function create() {
    if (busy || !formOk) return;
    setBusy("lead");
    try {
      await createTestLead({
        name: form.name.trim(),
        email: form.email.trim(),
        zip: form.zip.trim(),
        address: form.address.trim() || undefined,
        trade: form.trade || undefined,
        description: form.description.trim(),
        auto: form.auto,
      });
      if (form.auto) toast.success("Test run started", "It routes to your internal organizations. Nothing is sent — every message is listed under Test runs.");
      else toast.success("Test lead created", "It is in the queue, marked TEST — send it to an internal organization.");
      setForm({ ...blank, auto: form.auto });
      router.refresh();
    } catch (err) {
      toast.error("Couldn't create the test lead", actionError(err));
    } finally {
      setBusy(null);
    }
  }

  const set = (k: Exclude<keyof typeof form, "auto">) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <section className="card rv" aria-labelledby="lcTestTitle">
      <div className="card-head">
        <div className="card-titles">
          <div className="card-title" id="lcTestTitle">
            Test leads
          </div>
          <div className="card-sub">
            Internal organizations only, kept out of every number on this page. In the test environment a lead routes
            automatically and nothing is sent.
          </div>
        </div>
      </div>

      <div className={styles.tlBody}>
        {/* THE LINK — what a tester opens: the ordinary homeowner page. */}
        <div className={styles.tlBlock}>
          <div className={styles.tlLbl}>Test link</div>
          {link ? (
            <>
              <div className={styles.tlLinkRow}>
                <input
                  className={styles.tlIn}
                  readOnly
                  value={link.link}
                  aria-label="Test link"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button className={cx("btn btn-primary", ui.btnSm)} type="button" onClick={() => void copy()}>
                  Copy link
                </button>
              </div>
              <div className={styles.tlNote}>Key created {shortDate(link.createdAt)}. Requests sent through it are marked TEST.</div>
              {confirming ? (
                <div className={styles.tlConfirm} role="group" aria-label="Replace the test key">
                  <span>Replace the key? The current link stops making test leads at once.</span>
                  <button
                    className={cx("btn", ui.btnSm, ui.btnBad, busy === "key" && ui.btnBusy)}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void rotate()}
                  >
                    {busy === "key" ? "Replacing…" : "Replace key"}
                  </button>
                  <button className={cx("btn btn-ghost", ui.btnSm)} type="button" disabled={busy !== null} onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className={cx("btn btn-ghost", ui.btnSm, styles.tlGen)} type="button" onClick={() => setConfirming(true)}>
                  Generate new key
                </button>
              )}
            </>
          ) : (
            <>
              <div className={styles.tlNote}>No test link yet.</div>
              <button
                className={cx("btn btn-primary", ui.btnSm, busy === "key" && ui.btnBusy, styles.tlGen)}
                type="button"
                disabled={busy !== null}
                onClick={() => void rotate()}
              >
                {busy === "key" ? "Creating…" : "Create test link"}
              </button>
            </>
          )}
        </div>

        {/* QUICK RUN — the same intake, without the wizard. */}
        <div className={styles.tlBlock}>
          <div className={styles.tlLbl}>Create test lead</div>
          <div className={styles.tlGrid}>
            <label className={styles.tlField}>
              <span>Name</span>
              <input className={styles.tlIn} value={form.name} onChange={set("name")} autoComplete="off" />
            </label>
            <label className={styles.tlField}>
              <span>Email</span>
              <input className={styles.tlIn} type="email" value={form.email} onChange={set("email")} autoComplete="off" />
            </label>
            <label className={styles.tlField}>
              <span>ZIP</span>
              <input className={styles.tlIn} inputMode="numeric" maxLength={5} value={form.zip} onChange={set("zip")} autoComplete="off" />
            </label>
            <label className={cx(styles.tlField, styles.tlWide)}>
              <span>Street · optional, for a closer pin</span>
              <input className={styles.tlIn} value={form.address} onChange={set("address")} autoComplete="off" />
            </label>
            <label className={cx(styles.tlField, styles.tlWide)}>
              <span>Trade</span>
              <select className={styles.tlIn} value={form.trade} onChange={set("trade")}>
                <option value="">Let the AI read it from the description</option>
                {TRADE_TYPES.filter((t) => t !== "Other").map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className={cx(styles.tlField, styles.tlWide)}>
              <span>Description</span>
              <textarea className={cx(styles.tlIn, styles.tlArea)} rows={3} value={form.description} onChange={set("description")} />
            </label>
          </div>
          <label className={cx(styles.tlAuto, form.auto && styles.tlAutoOn)}>
            <input type="checkbox" checked={form.auto} onChange={(e) => setForm((f) => ({ ...f, auto: e.target.checked }))} />
            <span>
              <b>Test environment</b>
              {form.auto
                ? "Routes automatically, offer by offer, to internal organizations. Every email and text is recorded under Test runs, and nothing is sent."
                : "Off: the lead parks in the queue for you to send by hand, and its emails go out for real."}
            </span>
          </label>
          <button
            className={cx("btn btn-primary", ui.btnSm, busy === "lead" && ui.btnBusy, styles.tlGen)}
            type="button"
            disabled={busy !== null || !formOk}
            onClick={() => void create()}
          >
            {busy === "lead" ? "Creating…" : form.auto ? "Start test run" : "Create test lead"}
          </button>
        </div>
      </div>

      <TestRuns leads={leads} orgs={orgs} testRuns={testRuns} onOpenLead={onOpenLead} />
    </section>
  );
}

/* ============================================================
   TEST RUNS (owner, 2026-10-29: "a testing environment where we can send out automatic leads without actually
   sending, so we can test and debug") — lib/leadCenter/sandbox. Each run: where it stands now, the offers it made,
   who production would have offered it to, and every email and text, recorded and readable whole. The clock is in
   the admin's hands: an offer can lapse now, its reminder go now.
   ============================================================ */

function TestRuns({
  leads,
  orgs,
  testRuns,
  onOpenLead,
}: {
  leads: PlatformLeadDTO[];
  orgs: OrgPickDTO[];
  testRuns: Record<string, TestRunDTO>;
  onOpenLead: (id: string) => void;
}) {
  const runs = leads.filter((l) => testRuns[l.id]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ready = orgs.filter((o) => o.isInternal && isMatchable(o));
  return (
    <div className={styles.trWrap} data-test-runs>
      <div className={styles.tlLbl}>Test runs · {runs.length}</div>
      {ready.length === 0 ? (
        <p className={styles.trWarn}>
          No internal organization can take a lead yet, so a run has nowhere to go. Open a shop such as QA Co below, turn
          on Internal, and make sure it has lead offers on, an address and a trade.
        </p>
      ) : (
        <p className={styles.tlNote}>Runs go to {ready.map((o) => o.name).join(", ")}, ranked the way production ranks.</p>
      )}
      {runs.length === 0 ? (
        <p className={styles.tlNote}>No runs yet. Start one above with the test environment on.</p>
      ) : (
        <div className={styles.trList}>
          {runs.map((l) => (
            <TestRunItem key={l.id} lead={l} run={testRuns[l.id]} onOpenLead={onOpenLead} />
          ))}
        </div>
      )}
    </div>
  );
}

const OFFER_WORD: Record<string, string> = { OFFERED: "Open", ACCEPTED: "Accepted", DECLINED: "Passed", EXPIRED: "Lapsed", CANCELLED: "Withdrawn" };

function TestRunItem({ lead, run, onOpenLead }: { lead: PlatformLeadDTO; run: TestRunDTO; onOpenLead: (id: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"lapse" | "remind" | "clear" | null>(null);
  const [openN, setOpenN] = useState<number | null>(null);
  const [bodies, setBodies] = useState<Record<number, string>>({});
  const st = statusTone(lead);

  async function act(kind: "lapse" | "remind" | "clear") {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind === "lapse") await expireTestOffer(lead.id);
      else if (kind === "remind") await remindTestOffer(lead.id);
      else await clearTestMessages(lead.id);
      toast.success(
        kind === "lapse" ? "Offer lapsed" : kind === "remind" ? "Reminder recorded" : "Log cleared",
        kind === "lapse" ? "The lead moved on, as it would after 24 hours." : kind === "remind" ? "The two-hours-left letter is in the log, not sent." : "The run keeps going; new messages land here.",
      );
      router.refresh();
    } catch (err) {
      toast.error("Couldn't do that", actionError(err));
    } finally {
      setBusy(null);
    }
  }

  async function view(n: number) {
    if (openN === n) {
      setOpenN(null);
      return;
    }
    setOpenN(n);
    if (bodies[n] != null) return;
    try {
      const r = await readTestMessage(lead.id, n);
      setBodies((b) => ({ ...b, [n]: r.body }));
    } catch (err) {
      setOpenN(null);
      toast.error("Couldn't open the message", actionError(err));
    }
  }

  const now =
    lead.status === "OFFERED" && lead.activeOffer
      ? `Offered to ${lead.activeOffer.orgName} · offer ${lead.activeOffer.attempt} of 3`
      : lead.status === "MATCHED"
        ? `Accepted by ${lead.matchedOrgName ?? "a shop"}`
        : lead.status === "MANUAL_QUEUE"
          ? `In the queue · ${destinationNote(lead)}`
          : "Routing…";

  return (
    <article className={styles.trRun}>
      <header className={styles.trHead}>
        <span className={styles.testTag}>Test</span>
        <button className={styles.trName} type="button" onClick={() => onOpenLead(lead.id)} title="Open the lead">
          {lead.name} · {lead.detectedTrade ?? lead.projectType ?? "Trade unread"} · {place(lead)}
        </button>
        <Chip tone={st.tone}>{st.label}</Chip>
        <span className={styles.trTime}>{relative(lead.createdAt)}</span>
      </header>

      <div className={styles.trNow}>
        <span className={styles.trNowT}>{now}</span>
        {lead.status === "OFFERED" && lead.activeOffer ? <Countdown until={lead.activeOffer.expiresAt} /> : null}
        {lead.status === "OFFERED" ? (
          <span className={styles.trActs}>
            <button className={cx("btn btn-primary", ui.btnSm, busy === "lapse" && ui.btnBusy)} type="button" disabled={busy !== null} onClick={() => void act("lapse")}>
              {busy === "lapse" ? "Lapsing…" : "Let it lapse now"}
            </button>
            <button className={cx("btn btn-ghost", ui.btnSm, busy === "remind" && ui.btnBusy)} type="button" disabled={busy !== null} onClick={() => void act("remind")}>
              {busy === "remind" ? "Sending…" : "Send the reminder now"}
            </button>
          </span>
        ) : null}
      </div>

      <div className={styles.trCols}>
        <div>
          <div className={styles.trSub}>Offers in this run</div>
          {lead.offers.length ? (
            <ol className={styles.trOffers}>
              {lead.offers.map((o) => (
                <li key={o.id}>
                  <span>{o.attempt}</span>
                  <b>{o.orgName}</b>
                  <em>{OFFER_WORD[o.status] ?? o.status}</em>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.trDim}>None yet.</p>
          )}
        </div>
        <div>
          <div className={styles.trSub}>Production would offer it to</div>
          {run.wouldRank == null ? (
            <p className={styles.trDim}>Not ranked. The run stopped before routing.</p>
          ) : run.wouldRank.length ? (
            <ol className={styles.trOffers}>
              {run.wouldRank.map((c, i) => (
                <li key={c.orgId}>
                  <span>{i + 1}</span>
                  <b>{c.orgName}</b>
                  <em>
                    {Math.round(c.score * 100)}
                    {c.distanceMi != null ? ` · ${c.distanceMi} mi` : ""}
                  </em>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.trDim}>Nobody. No real shop covers this trade and area.</p>
          )}
        </div>
      </div>

      <div className={styles.trSubRow}>
        <div className={styles.trSub}>Messages · recorded, not sent · {run.messages.length}</div>
        {run.messages.length ? (
          <button className={cx("btn btn-ghost", ui.btnSm, busy === "clear" && ui.btnBusy)} type="button" disabled={busy !== null} onClick={() => void act("clear")}>
            {busy === "clear" ? "Clearing…" : "Clear log"}
          </button>
        ) : null}
      </div>
      {run.messages.length ? (
        <ul className={styles.trMsgs}>
          {run.messages.map((m) => (
            <li key={m.n} className={styles.trMsg}>
              <div className={styles.trMsgRow}>
                <span className={cx(styles.trTag, m.channel === "sms" && styles.trTagSms)}>{m.channel === "sms" ? "Text" : "Email"}</span>
                <div className={styles.trMsgMain}>
                  <div className={styles.trMsgTo}>To {m.to}</div>
                  <div className={styles.trMsgSubj}>{m.channel === "email" ? (m.subject ?? "(no subject)") : m.excerpt}</div>
                  {m.note ? <div className={styles.trMsgNote}>{m.note}</div> : null}
                </div>
                <span className={styles.trTime}>{relative(m.at)}</span>
                <button className={cx("btn btn-ghost", ui.btnSm)} type="button" aria-expanded={openN === m.n} onClick={() => void view(m.n)}>
                  {openN === m.n ? "Hide" : "View"}
                </button>
              </div>
              {openN === m.n ? (
                bodies[m.n] == null ? (
                  <p className={styles.trDim}>Opening…</p>
                ) : m.channel === "email" ? (
                  <iframe className={styles.trFrame} sandbox="" srcDoc={bodies[m.n]} title={`Recorded email: ${m.subject ?? ""}`} />
                ) : (
                  <p className={styles.trSms}>{bodies[m.n]}</p>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.trDim}>Nothing yet. The homeowner&apos;s confirmation and each offer&apos;s letter land here.</p>
      )}
    </article>
  );
}
