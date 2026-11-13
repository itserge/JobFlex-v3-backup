import "server-only";
// THE EAGLEVIEW ROOF MEASUREMENT, WITHOUT A SESSION (2026-11-06): the order ledger (reuse, top-up, purchase under the
// company's daily ceiling and the plan's month), the witnesses (Google's elevation data registered to the outline,
// coverage, completeness, the parcel veto), the main structure, and the RoofMeasurement row — pulled out of
// actions/roofMeasurement so the AI Operator measures a roof by voice the way the roof page's Measure button does
// (production's provider is EagleView; Google's aerial model is the fallback, lib/roofSolarMeasure). The action is
// a wrapper over instantMeasure (session, page); collectPendingInstant and the rest of the action read the same
// helpers from here. Nothing in the measurement itself changed in the move.
//
// THE FIRST CLICK GETS THE MEASUREMENT; THE DETAILS LAND BEHIND IT
// (2026-09-18). The area pack is ordered alone and waited for alone
// (lib/eagleviewOrder); the moment it lands the other packs are ordered and
// the click returns with them saved as `pending` — the page collects them
// without a new charge and prices nothing until they are in. Nothing pending
// is ever re-bought: a re-measure skips packs the address already has,
// complete or on the way. The one exception is an area order the provider
// has sat on for STALE_PENDING_MS: it no longer blocks the address, and the
// page offers a new, billed lookup over it. The whole action runs under one
// budget (ACTION_BUDGET_MS) below the page's maxDuration, and the elevation
// pass takes only what is left of it.

import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { db } from "@/lib/db";
import {
  isEagleViewEnabled,
  EagleViewUnavailableError,
  PdEntitlementError,
  instantCompleteAddress,
  pollInstantResult,
  submitInstantOrder,
  fetchPropertyImage,
  instantAddressNotFound,
  mergeInstantResults,
  PD_DIAGRAM_PACKS,
  eagleViewIdentity,
  instantAddressKey,
  PD_PACK,
  type EvOrderInput,
  type InstantRoofData,
  type PdPack,
} from "@/lib/eagleview";


import {
  collectPlacedOrders,
  hasRoof,
  ORDER_COLLECT_BUDGET_MS,
  orderPacksFor,
  PENDING_EXPIRE_MS,
  packReport,
  packsFromContent,
  rowPacks,
  type OrderDeps,
  type PackReport,
  type PlacedOrder,
} from "@/lib/eagleviewOrder";
import { markPacks, notePacks, readEntitlements } from "@/lib/eagleviewEntitlements";
import { isSolarEnabled, SOLAR_CALL_BUDGET_MS, SolarUnavailableError, type SolarFailureKind } from "@/lib/solar";
// The Google measurement itself and the row it is kept as live in lib/roofSolarMeasure (2026-11-05), shared with the AI Operator.
import { persistRoofMeasurement } from "@/lib/roofSolarMeasure";

import { EXPIRED_ORDER_ERROR, expireStaleInstantOrders } from "@/lib/instantOrderExpiry";


import { buildReconModel, ReconUnavailableError, type ReconBuild } from "@/lib/roofReconBuild";
import { latLngRingToFrame } from "@/lib/roofRecon/surveyDsm";
import { registerContourToRaster, type Rigid2D } from "@/lib/roofRecon/register";
import { measureCoverage } from "@/lib/roofRecon/coverage";
import { measurePitch } from "@/lib/roofRecon/measuredPitch";
import { checkCompleteness } from "@/lib/roofRecon/completeness";
import { lotMaskFromPair, ringWhollyOutsideLot, type LotMask } from "@/lib/roofDiagram/parcelMask";
import { lotRingForPoint, ringWhollyOutsideLotRing } from "@/lib/lotRing";
import { areaOf, type FootprintPoint } from "@/lib/roofRecon/footprint";
import { foreignIndices, footprintRead, includedIndicesOf, pickMainStructure, pickMainStructureAt, pointOnRing } from "@/lib/roofDiagram/instantTotals";

import type { MeasurementProvenance, RoofMeasurementDTO } from "@/lib/roofDiagram/types";
import { takeTrialCap } from "@/lib/trialMeter";
import { takeRoofOrderCap } from "@/lib/paidCaps";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { isPlanLimitError, PLAN_LIMIT_MESSAGE, type LimitKey } from "@/lib/planLimits";



export type MeasureResult =
  | {
      ok: true;
      measurement: RoofMeasurementDTO;
      unsaved?: boolean;
      reusedInstant?: { requestId: string; how: "stored" | "recovered" };
      /** EagleView identity + the packs bought — for the browser console (EV_DEBUG). */
      debug?: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
      /**
       * The aerial provider answered with no roof at this address. The paid
       * answer is kept so a plain click never re-bills; only an explicit
       * re-measure orders again.
       */
      noRoof?: boolean;
      /** A paid order is still processing — the next click collects it for free. */
      stillProcessing?: boolean;
      /** …and has been for STALE_PENDING_MS: a new, billed lookup may be ordered over it. */
      canReorder?: boolean;
      /** Typed access refusal before an order was accepted; allows provider fallback. */
      providerAccessDenied?: boolean;
      /** The company's daily ceiling on paid orders (lib/paidCaps): nothing was ordered. */
      capped?: boolean;
      /** EagleView could not place the address ("Invalid address") — the person picks it again; nothing more is ordered. */
      addressNotFound?: boolean;
      /** The last area order never arrived and was closed (lib/instantOrderExpiry): only a new, billed lookup measures it. */
      expired?: boolean;
      /** The plan's monthly roof measurements are used (limitsEngine "roofMeasurements") — the plan dialog. */
      code?: "PLAN_LIMIT_REACHED";
      resource?: LimitKey;
      debug?: Record<string, unknown>;
    };

/**
 * What the page sends to measure: the address, and the pin the person saw on
 * the map before ordering — `lat`/`lng` and `userPin` alike (2026-10-26). The
 * pin decides which building is main (pickMainStructure "user-pin").
 */
export type RoofOrderInput = EvOrderInput & { userPin?: LatLng | null };

/** A pin worth believing: two finite numbers on Earth, not EagleView's "nowhere" (0, 0). */
export function cleanPin(p: unknown): LatLng | null {
  const v = p as { lat?: unknown; lng?: unknown } | null | undefined;
  if (!v || typeof v.lat !== "number" || typeof v.lng !== "number") return null;
  if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng) || Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) return null;
  if (v.lat === 0 && v.lng === 0) return null;
  return { lat: v.lat, lng: v.lng };
}

export interface LatLng {
  lat: number;
  lng: number;
}

const SOLAR_CALL_SLOTS = 2;
const RECON_DEADLINE_MS = SOLAR_CALL_SLOTS * SOLAR_CALL_BUDGET_MS;
/**
 * The whole measure action, start to save, stays under this — below the roof
 * page's maxDuration (300 s) with room for the response. The Instant phase
 * takes what it needs (placing up to seven orders, then one collect budget);
 * the elevation pass gets what is left, never less than a floor worth
 * starting; below that it is skipped and the page's free retry runs it.
 */
export const ACTION_BUDGET_MS = 250_000;
const RECON_FLOOR_MS = 20_000;
/** How long a plain click waits for an AREA order an earlier click left processing; detail orders are asked once and left to the page. */
const PENDING_COLLECT_BUDGET_MS = 45_000;
/** An area order the provider has not delivered in this long no longer blocks a new, billed lookup — it is closed (lib/instantOrderExpiry). */
const STALE_PENDING_MS = PENDING_EXPIRE_MS;
/** How long the page's background collect asks about pending orders per call. */
export const BACKGROUND_COLLECT_BUDGET_MS = 12_000;
/** The elevation pass re-run when a late pack changes the roof's outline or pitch. */
export const LATE_RECON_DEADLINE_MS = 40_000;

// ── helpers (module-private: a "use server" file may only export async fns) ──

export const errorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

/**
 * Reject `p` if it has not settled within `ms`. The underlying work is not
 * cancelled (there is no handle to cancel a plane fit); its result is simply
 * discarded, which is what the fallbacks want.
 */
function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * The ortho we hand to the vision model. Unmasked first — EagleView blurs the
 * neighbours on a masked ortho and the blur edge reads as a roof edge to a
 * vision model; any ortho with a bbox is the fallback, since without a bbox a
 * box cannot be placed in the frame at all.
 */

function reconFailureKind(err: unknown): SolarFailureKind {
  if (err instanceof SolarUnavailableError || err instanceof ReconUnavailableError) return err.kind;
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (name === "TimeoutError" || name === "AbortError" || /abort|timed out|timeout/i.test(msg)) return "timeout";
  return "error";
}


/** A terminal Property Data verdict (failed/rejected), as opposed to "not ready yet". */
const isTerminalPdFailure = (err: unknown): boolean =>
  err instanceof Error && /^Property Data request (?!failed \()/i.test(err.message) && /fail|error|reject|cancel/i.test(err.message);

interface ObtainedInstant {
  instant: InstantRoofData;
  /** Absent when this call ordered (and paid for) a fresh lookup. */
  reuse?: { requestId: string; how: "stored" | "recovered" };
  /** Which packs the answer is made of — see MeasurementProvenance.instantPacks. */
  packs: PackReport;
}

/** The I/O the pack-by-pack planner needs, bound to this org's ledger. */
export function orderDeps(organizationId: string, addressKey: string, input: EvOrderInput): OrderDeps {
  return {
    submit: (inp, packs) => submitInstantOrder(inp, packs),
    poll: (requestId, inp, completeAddress, onRaw, maxWaitMs) => pollInstantResult(requestId, inp, completeAddress, maxWaitMs, { onRaw }),
    ledger: {
      create: async (requestId, packs) => {
        console.info("[roofMeasurement] instant order placed", { requestId, packs, org: organizationId });
        await db.instantOrder.create({
          data: { organizationId, addressKey, address: input.address ?? null, requestId, packs: JSON.stringify(packs) },
        });
      },
      complete: async (requestId, instant, raw) => {
        await db.instantOrder.update({
          where: { requestId },
          data: { status: "complete", instantJson: JSON.stringify(instant), ...(raw ? { instantRawJson: raw } : {}) },
        });
      },
      fail: async (requestId, error) => {
        await db.instantOrder.update({ where: { requestId }, data: { status: "failed", error } });
      },
    },
    entitlements: { read: readEntitlements, mark: markPacks, note: notePacks },
    isTerminalFailure: isTerminalPdFailure,
    log: (msg) => console.error("[roofMeasurement] " + msg),
  };
}

/** Every complete order for the address, oldest first, the pack-001 order first of all. */
export async function completeOrdersFor(organizationId: string, addressKey: string): Promise<{ parts: InstantRoofData[]; have: string[]; requestId: string | null }> {
  const rows = await db.instantOrder.findMany({
    where: { organizationId, addressKey, status: "complete", instantJson: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  const parsed: Array<{ instant: InstantRoofData; packs: string[] }> = [];
  for (const row of rows) {
    try {
      parsed.push({ instant: JSON.parse(row.instantJson as string) as InstantRoofData, packs: rowPacks(row.packs) });
    } catch {
      /* an unreadable stored answer is skipped */
    }
  }
  parsed.sort((a, b) => Number(b.packs.includes(PD_PACK.ROOF_AREA)) - Number(a.packs.includes(PD_PACK.ROOF_AREA)));
  const have = [...new Set(parsed.flatMap((p) => p.packs))];
  return { parts: parsed.map((p) => p.instant), have, requestId: parsed[0]?.instant.requestId ?? null };
}

/** Orders for the address that were placed but not collected yet, oldest first — once the company's orders that never arrived are closed. */
export async function pendingOrdersFor(organizationId: string, addressKey: string, input: EvOrderInput): Promise<Array<PlacedOrder & { placedAt: Date }>> {
  await expireStaleInstantOrders({ organizationId }).catch((err) => console.warn("[roofMeasurement] stale orders not closed:", errorMessage(err, String(err))));
  const rows = await db.instantOrder.findMany({ where: { organizationId, addressKey, status: "pending" }, orderBy: { createdAt: "asc" } });
  const completeAddress = instantCompleteAddress(input);
  return rows.map((r) => ({ requestId: r.requestId, packs: rowPacks(r.packs) as PdPack[], completeAddress, placedAt: r.createdAt }));
}

/** What the account is currently refused, for the report of a reused answer. */
export async function deniedNow(): Promise<string[]> {
  try {
    return [...(await readEntitlements()).values()].filter((r) => r.status === "denied").map((r) => r.pack);
  } catch {
    return [];
  }
}

/** The answer's parts with the roof-area part first — the merge's base. */
export const areaFirst = (parts: InstantRoofData[]): InstantRoofData[] =>
  [...parts].sort((a, b) => Number(b.structures.some((s) => s.areaSqft != null)) - Number(a.structures.some((s) => s.areaSqft != null)));

/** The aerial provider answered, and the answer holds no roof. Kept, never re-billed by a plain click. */
/** The company's daily ceiling on paid orders (lib/paidCaps) — said, not thrown at the page. */
export class RoofCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoofCapError";
  }
}

/** EagleView could not place the address at all ("Invalid address", EVPD-10101). Nothing more is ordered for it. */
export class AddressNotFoundError extends Error {
  constructor() {
    super("Address not found — pick it from the suggestions");
    this.name = "AddressNotFoundError";
  }
}

/** The last area order for the address never arrived and was closed (lib/instantOrderExpiry); a plain click does not buy over it. */
export class ExpiredOrderError extends Error {
  constructor(requestId: string) {
    super(`The last measurement ordered for this address never arrived (order ${requestId}) and was closed. Order a new lookup to measure it — billed.`);
    this.name = "ExpiredOrderError";
  }
}

export class NoRoofError extends Error {
  constructor(requestId: string | null) {
    super(
      `No roof was found at this address${requestId ? ` (order ${requestId})` : ""}. Check the address and the pin; a new measurement can be ordered from the report.`,
    );
    this.name = "NoRoofError";
  }
}

/**
 * A paid order for the roof area is still processing — nothing to build on
 * yet, and no second order over it by a plain click. Once the provider has
 * sat on it for STALE_PENDING_MS the order is `stale`: the page may offer a
 * new, billed lookup, which abandons it.
 */
export class StillProcessingError extends Error {
  constructor(requestId: string, readonly stale: boolean) {
    super(
      stale
        ? `This address has been measuring for over ${Math.round(STALE_PENDING_MS / 60_000)} minutes (order ${requestId}). Check again for free, or order a new measurement — billed.`
        : `This address is still being measured (order ${requestId}). Measure again in a minute — the paid order is collected then without a new charge.`,
    );
    this.name = "StillProcessingError";
  }
}

/**
 * The only place the product path gets Instant data, and the reason each click
 * is no longer a new bill:
 *
 *   1. Orders an earlier click left PROCESSING are collected first — all of
 *      them, together, under one budget — and never re-ordered over. This is
 *      the recovery half: a first click whose orders outran the wait leaves
 *      the paid results in the ledger, and the next click picks them up.
 *   2. An already-paid answer for the same address — every complete
 *      InstantOrder row for it, merged (one address is several pack orders
 *      since 2026-09-08), or the latest saved measurement's instantJson — is
 *      reused as is. Nothing is bought on this path, not even packs the
 *      address lacks: buying is a deliberate act (re-measure), and the page
 *      says which packs are missing and offers it.
 *   3. Only then is anything ordered — every pack placed up front and
 *      collected together through lib/eagleviewOrder, each accepted request
 *      written to the ledger BEFORE its first poll, because from the moment
 *      EagleView accepts an order it is billable whether or not we wait.
 *      Losing the id to a timeout exception is how two paid Snohomish lookups
 *      became unrecoverable on 2026-08-26.
 *
 * `forceNewOrder` is the explicit "re-measure at a new cost": it buys the
 * packs the address does not have yet (nothing already bought or still
 * processing is bought twice), and only when the address already has every
 * pack does it place a fresh full order.
 */
export async function obtainInstant(input: EvOrderInput, organizationId: string, forceNewOrder: boolean, deadlineAt: number): Promise<ObtainedInstant> {
  const addressKey = instantAddressKey(input);
  const keyed = addressKey !== "|||";
  const deps = orderDeps(organizationId, addressKey, input);
  const owned = keyed ? await completeOrdersFor(organizationId, addressKey) : { parts: [], have: [], requestId: null };

  // 1. what an earlier click left processing. The area on the way is waited
  //    for (it is the measurement, up to PENDING_COLLECT_BUDGET_MS); detail
  //    orders on the way are asked once and left to the page's collect.
  let recovered: Array<{ instant: InstantRoofData; packs: PdPack[]; requestId: string }> = [];
  let stillPending: string[] = [];
  let pendingArea: { requestId: string; packs: PdPack[]; placedAt: Date } | null = null;
  if (keyed) {
    const open = await pendingOrdersFor(organizationId, addressKey, input);
    if (open.length) {
      const areaOnTheWay = !owned.have.includes(PD_PACK.ROOF_AREA) && open.some((o) => o.packs.includes(PD_PACK.ROOF_AREA));
      const budget = areaOnTheWay ? Math.min(PENDING_COLLECT_BUDGET_MS, Math.max(0, deadlineAt - Date.now() - RECON_FLOOR_MS)) : 0;
      const c = await collectPlacedOrders(open, input, deps, budget, areaOnTheWay ? { untilPack: PD_PACK.ROOF_AREA } : {});
      recovered = c.landed.map((l) => ({ instant: l.instant, packs: l.order.packs, requestId: l.order.requestId }));
      stillPending = c.pending.flatMap((o) => o.packs);
      const pa = c.pending.find((o) => o.packs.includes(PD_PACK.ROOF_AREA));
      if (pa) pendingArea = { requestId: pa.requestId, packs: pa.packs, placedAt: open.find((o) => o.requestId === pa.requestId)?.placedAt ?? new Date() };
    }
  }
  const have = [...new Set([...owned.have, ...recovered.flatMap((r) => r.packs)])];
  const parts = areaFirst([...owned.parts, ...recovered.map((r) => r.instant)]);
  // The area itself is still on the way: nothing to build on, and no second
  // order over it — unless the provider has sat on it past STALE_PENDING_MS
  // and the contractor explicitly orders a new lookup, which abandons it.
  if (!have.includes(PD_PACK.ROOF_AREA) && pendingArea) {
    const stale = Date.now() - pendingArea.placedAt.getTime() >= STALE_PENDING_MS;
    if (!(forceNewOrder && stale)) throw new StillProcessingError(pendingArea.requestId, stale);
    console.warn("[roofMeasurement] abandoning a stale area order for a new lookup", { requestId: pendingArea.requestId, placedAt: pendingArea.placedAt });
    await db.instantOrder
      .update({
        where: { requestId: pendingArea.requestId },
        data: { status: "failed", error: `Not delivered in ${Math.round(STALE_PENDING_MS / 60_000)} min — a new lookup was ordered over it on ${new Date().toISOString()}` },
      })
      .catch(() => {});
    const abandoned = new Set<string>(pendingArea.packs);
    stillPending = stillPending.filter((p) => !abandoned.has(p));
  }

  if (keyed && !forceNewOrder) {
    // 2a. complete orders in the ledger (and what was just collected), merged
    if (parts.length && have.includes(PD_PACK.ROOF_AREA)) {
      const instant = mergeInstantResults(parts);
      if (instantAddressNotFound(instant)) throw new AddressNotFoundError();
      if (!hasRoof(instant)) throw new NoRoofError(instant.requestId);
      const first = recovered.find((r) => r.packs.includes(PD_PACK.ROOF_AREA)) ?? recovered[0];
      return {
        instant,
        reuse: { requestId: first?.requestId ?? owned.requestId ?? instant.requestId, how: recovered.length ? "recovered" : "stored" },
        packs: packReport(have, await deniedNow(), [], [], stillPending),
      };
    }
    // 2b. an answer already saved on a measurement row (rows predate the ledger)
    if (!parts.length) {
      const prior = await db.roofMeasurement.findMany({
        where: { organizationId, source: { not: "solar" }, instantJson: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { instantJson: true, instantRequestId: true, address: true, city: true, state: true, zip: true },
      });
      for (const row of prior) {
        if (instantAddressKey({ address: row.address ?? "", city: row.city ?? "", state: row.state ?? "", zip: row.zip ?? "" }) !== addressKey) continue;
        try {
          const parsed = JSON.parse(row.instantJson as string) as InstantRoofData;
          if (parsed.structures?.some((st) => (st.outline?.length ?? 0) >= 3)) {
            // A pre-ledger row records what the answer CONTAINS, not what was
            // asked for: the packs are read off the fields, the rest is unknown
            // — never "all seven" by assumption (audit 2026-09-09).
            const evident = packsFromContent(parsed);
            return {
              instant: parsed,
              reuse: { requestId: row.instantRequestId ?? parsed.requestId, how: "stored" },
              packs: packReport(evident.have, [], [], evident.unknown),
            };
          }
        } catch {
          /* skip unreadable rows */
        }
      }
    }
  }

  // EagleView already said it cannot place this address: the same words would
  // be refused again, and a re-measure would buy the detail packs on nothing.
  if (parts.length && instantAddressNotFound(mergeInstantResults(parts))) throw new AddressNotFoundError();

  // An area order that never arrived was closed (lib/instantOrderExpiry): a
  // plain click does not place a new paid one over it — that is the explicit
  // re-measure, as it was while the order sat pending.
  if (keyed && !forceNewOrder && !have.includes(PD_PACK.ROOF_AREA)) {
    const expired = await db.instantOrder.findFirst({
      where: { organizationId, addressKey, status: "failed", error: { startsWith: EXPIRED_ORDER_ERROR }, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
      orderBy: { createdAt: "desc" },
      select: { requestId: true, packs: true },
    });
    if (expired && rowPacks(expired.packs).includes(PD_PACK.ROOF_AREA)) throw new ExpiredOrderError(expired.requestId);
  }

  // 3. buy — every pack the address lacks, placed up front and collected
  // together. A re-measure on an address that has every pack is the one case
  // that orders everything again.
  const hasAll = PD_DIAGRAM_PACKS.every((p) => have.includes(p));
  // THE DAILY CEILINGS (2026-10-12, lib/paidCaps): an order is placed below,
  // and it is paid — 30 a day per company, a "measure again" 5 of those.
  // Everything above (a roof already measured, an order collected) is free
  // and never reaches this line.
  // THE PLAN'S MONTH (owner, 2026-10-26 — audit §1): a paid measurement is
  // one of the plan's roofMeasurements; the daily ceiling below still holds.
  await enforcePlanLimit(organizationId, "roofMeasurements");
  const cap = await takeRoofOrderCap(organizationId, forceNewOrder);
  if (!cap.ok) throw new RoofCapError(cap.error);
  const skip = forceNewOrder && hasAll ? [] : [...have, ...stillPending];
  const base = skip.length && parts.length ? mergeInstantResults(parts) : null;
  // The area order is waited for under this budget; the other packs are placed
  // once it lands and left to the page, and the elevation pass keeps its floor.
  const collectBudgetMs = Math.max(15_000, Math.min(ORDER_COLLECT_BUDGET_MS, deadlineAt - Date.now() - RECON_FLOOR_MS - 30_000));
  const { instant, report } = await orderPacksFor(input, deps, { skip, base, collectBudgetMs });
  if (instantAddressNotFound(instant)) throw new AddressNotFoundError();
  if (!hasRoof(instant)) throw new NoRoofError(instant.requestId);
  const pendingNow = [...new Set([...(report.pending ?? []), ...stillPending.filter((p) => !report.have.includes(p))])];
  return { instant, packs: packReport(report.have, report.denied, report.failed, report.unknown ?? [], pendingNow) };
}

/** Everything the witnesses established about an answer — what persistData saves. */
interface Witnessed {
  provenance: MeasurementProvenance;
  origin: LatLng | null;
}

/** A frame-feet ring moved by the registration's rigid transform (register.ts forward). */
function applyRigid(ring: FootprintPoint[], t: Rigid2D): FootprintPoint[] {
  const c = Math.cos((t.thetaDeg * Math.PI) / 180);
  const s = Math.sin((t.thetaDeg * Math.PI) / 180);
  return ring.map((p) => ({ ...p, x: p.x * c - p.y * s + t.dxFt, y: p.x * s + p.y * c + t.dyFt }));
}

function okLatLng(p: { lat?: unknown; lng?: unknown } | null | undefined): p is LatLng {
  return !!p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/**
 * The WITNESSES: everything the free data says about the paid answer —
 * parcel veto, the main structure, the elevation pass (registration,
 * coverage, measured pitch), completeness. One function for both the
 * measure and the late-pack collect, so a pack that lands after the row was
 * saved (the outline, the pitch) gets the same treatment as one that landed
 * on the first click (review 2026-09-17: before this, a late outline never
 * got a coverage figure or a measured pitch).
 *
 * `reconDeadlineMs` ≤ 0 skips the elevation pass and says so on the row; the
 * page's free retry runs it then.
 *
 * THE PERSON'S WORD ON THE BUILDING (2026-10-26, ticket 8KETUL). `userPin` is
 * the pin they saw (and may have moved) on the map before ordering; it picks
 * the main structure ahead of EagleView's own point. `forceMain` is "Make
 * main" — the building they chose after the order; `lot` hands in the lot
 * check a saved row already made, so a re-pick asks EagleView for nothing
 * (the parcel mask is read off EagleView imagery). Every path writes the same
 * keys — `userPin`, `mainStructure`, `included` — so a row reads the same
 * whichever wrote it.
 */
export async function witnessInstant(p: {
  instant: InstantRoofData;
  input: EvOrderInput;
  packs: PackReport;
  refreshSolar: boolean;
  reconDeadlineMs: number;
  /** The pin an earlier pick was made at (a late pack's re-check keeps the same building). */
  pickPin?: LatLng | null;
  /** The pin is a building the contractor chose on the page ("Measure this building instead"). */
  chosen?: boolean;
  userPin?: LatLng | null;
  forceMain?: number | null;
  included?: readonly number[];
  lot?: { parcelSource: MeasurementProvenance["parcelSource"]; parcelVeto: unknown } | null;
}): Promise<Witnessed> {
  const { instant, input, packs } = p;
  const origin: LatLng | null = cleanPin({ lat: instant.lat, lng: instant.lng });
  // WHICH BUILDING (2026-10-26, a contractor's ticket: "wrong building — the apartment building needs to be measured,
  // not the garage"): the pin the contractor confirmed on the map before measuring — or a building they picked on the
  // page ("Measure this one instead") — says which, not the vendor's point for the address, which can stand on the
  // garage of a lot with several buildings.
  const typed = { lat: input.lat, lng: input.lng };
  const chosenPin: LatLng | null = p.pickPin ?? (okLatLng(typed) ? typed : null);
  const contours = instant.structures.map((st) => st.outline ?? []).filter((r) => r.length >= 3);

  const provenance: MeasurementProvenance = {};

  // ПАРСЕЛЬ-ВЕТО: строения целиком вне лота — BEFORE the main structure is
  // chosen, because the choice excludes vetoed structures.
  //
  // TWO WITNESSES, same safe direction (2026-09-17). EagleView's own masked /
  // unmasked ortho pair is one; the recorded lot outline — ParcelCache, then
  // ReportAll, then Regrid only if ReportAll has no parcel here — is the other.
  // The pair is not always there (it needs two ortho images over the pin that
  // differ only by the mask) and at 12117 202nd St SE it produced nothing,
  // leaving nineteen outbuildings looking like part of the property. Either
  // witness may veto, and each only ever vetoes a structure EVERY vertex of
  // which falls outside the lot: keeping a neighbour's shed is a visible
  // mistake, dropping a real roof is an expensive one.
  const known = p.lot ?? null;
  const lot = known ? null : await lotMaskFor(instant, origin);
  const lotRing = known
    ? { ring: [] as { lat: number; lng: number }[], source: known.parcelSource ?? ("none" as const) }
    : origin
      ? await lotRingForPoint(origin.lat, origin.lng)
      : { ring: [] as { lat: number; lng: number }[], source: "none" as const };
  provenance.parcelSource = lotRing.source as MeasurementProvenance["parcelSource"];
  const haveOutline = lotRing.ring.length >= 3;
  if (known) {
    // The saved row's own verdict, as it was made: no lot is looked up again.
    if (known.parcelVeto) (provenance as Record<string, unknown>).parcelVeto = known.parcelVeto;
  } else {
    console.log(
      `[roofMeasurement] lot boundary: ${lotRing.source}` +
        (haveOutline ? ` (${lotRing.ring.length} points)` : " — no outline") +
        `, imagery mask: ${lot ? "yes" : "no"}`,
    );
  }
  if (!known && origin && (lot || haveOutline)) {
    const foreign: string[] = [];
    let byMask = 0;
    let byOutline = 0;
    instant.structures.forEach((st, i) => {
      const ring = st.outline ?? [];
      if (ring.length < 3) return;
      const outsideMask = lot ? ringWhollyOutsideLot(lot, ring) : false;
      const outsideOutline = haveOutline ? ringWhollyOutsideLotRing(lotRing.ring, ring) : false;
      if (!outsideMask && !outsideOutline) return;
      if (outsideMask) byMask += 1;
      if (outsideOutline) byOutline += 1;
      foreign.push("s" + i);
    });
    if (foreign.length) {
      (provenance as Record<string, unknown>).parcelVeto = {
        foreignStructures: foreign,
        /* Which witness saw what, so a veto can be argued with. */
        by: { imageryMask: byMask, lotOutline: byOutline, source: lotRing.source },
      };
      console.log(
        `[roofMeasurement] parcel veto: ${foreign.length} of ${instant.structures.length} structures are off the lot ` +
          `(imagery mask ${byMask}, lot outline ${byOutline} via ${lotRing.source})`,
      );
    }
  }

  // THE MAIN STRUCTURE (audit 2026-09-08). EagleView answers with every
  // structure on the parcel (12117: the house and nineteen outbuildings);
  // the row's figures, the hero, the estimate — and every witness below:
  // registration, coverage, measured pitch, completeness — are about ONE of
  // them. The rest are listed on the page with checkboxes.
  const veto = (provenance as Record<string, unknown>).parcelVeto as { foreignStructures?: string[] } | undefined;
  const userPin = cleanPin(p.userPin);
  // One order of words on which building is main: "Make main" (forceMain) — then the pin the person placed on the map
  // before ordering (userPin: the building under it, else the nearest of this lot) — then the contractor's pin or the
  // building chosen on the page ("Measure this one"), giving way to the vendor's point when it stands on no building.
  const pick =
    p.forceMain != null && instant.structures[p.forceMain]
      ? { index: p.forceMain, how: "chosen" as const }
      : userPin && !p.chosen
        ? pickMainStructure(instant.structures, {
            foreign: foreignIndices(veto?.foreignStructures),
            origin,
            // Either witness counts as knowing where the lot is (a saved row's veto says it was known).
            parcelKnown: lot != null || haveOutline || !!veto,
            userPin,
          })
        : pickMainStructureAt(instant.structures, {
            pin: chosenPin,
            vendor: origin,
            chosen: p.chosen,
            foreign: foreignIndices(veto?.foreignStructures),
            parcelKnown: lot != null || haveOutline || !!veto,
          });
  provenance.userPin = userPin;
  provenance.included = includedIndicesOf({ included: p.included ?? [] }, instant.structures.length, pick.index);
  const mainSt = pick.index != null ? instant.structures[pick.index] : null;
  if (pick.index != null) {
    const others = instant.structures.filter((_, i) => i !== pick.index);
    provenance.mainStructure = {
      index: pick.index,
      how: pick.how,
      others: others.length,
      othersSqft: Math.round(others.reduce((a, s) => a + (s.areaSqft ?? 0), 0)),
      // "Make main": a point on that building, so a re-pick at the pin finds the same one.
      pin: p.forceMain != null && mainSt?.outline && mainSt.outline.length >= 3 ? pointOnRing(mainSt.outline) : chosenPin,
    };
  }
  // Which footprint the estimate will price on, recorded where it can be read
  // back: EagleView's figure, or the building's own outline when the two
  // disagree by more than a tenth (audit 2026-09-17, 12117 202nd St SE).
  if (mainSt) {
    const fp = footprintRead(mainSt);
    if (fp.sqft != null) {
      provenance.footprintSource = {
        source: fp.source,
        sqft: Math.round(fp.sqft),
        reportedSqft: fp.reportedSqft != null ? Math.round(fp.reportedSqft) : null,
        outlineSqft: fp.outlineSqft != null ? Math.round(fp.outlineSqft) : null,
        deltaPct: fp.delta != null ? Math.round(fp.delta * 1000) / 10 : null,
      };
    }
  }
  const mainOutline = mainSt?.outline && mainSt.outline.length >= 3 ? mainSt.outline : contours[0] ?? null;

  // DSM/Solar (бесплатно): покрытие и регистрация; отказ не валит замер
  let recon: ReconBuild | null = null;
  if (!isSolarEnabled()) {
    provenance.reconUnavailable = { kind: "unreachable" as SolarFailureKind, message: "Google Solar is not configured" };
  } else if (p.reconDeadlineMs < RECON_FLOOR_MS) {
    provenance.reconUnavailable = {
      kind: "timeout",
      message: "The aerial order used the time this measurement had; the elevation check was not started. Measure again (free) to add it.",
    };
  } else {
    try {
      recon = await withDeadline(
        buildReconModel({
          ...input,
          ...(p.refreshSolar ? { refreshSolar: true } : {}),
          ...(contours.length ? { contours } : {}),
        }),
        Math.min(RECON_DEADLINE_MS, p.reconDeadlineMs),
        "Roof reconstruction data",
      );
    } catch (err) {
      provenance.reconUnavailable = { kind: reconFailureKind(err), message: errorMessage(err, String(err)) };
    }
  }

  if (recon) {
    provenance.imageryQuality = recon.layers.imageryQuality;
    // Solar hands the capture date as {year, month, day} — stringify it as an
    // ISO day, not String(object) (which stored "[object Object]").
    const d = recon.layers.imageryDate;
    provenance.imageryDate = d?.year
      ? `${d.year}-${String(d.month ?? 0).padStart(2, "0")}-${String(d.day ?? 0).padStart(2, "0")}`
      : undefined;
    provenance.pixelSizeM = recon.dsm.pixelSizeM;
    provenance.googleAreaSqft = recon.googleAreaSqft ?? null;
    provenance.googleSegmentCount = recon.googleSegmentCount ?? null;
    // The raster's frame has its origin at the pin the tile was fetched
    // around (recon.origin) — the Places pin, or the cached tile's — not at
    // EagleView's own lat/lng. Rings are converted into THAT frame; the
    // registration then says how far the outline sits from the roof the
    // raster shows, and coverage is measured on the registered outline
    // (review 2026-09-17: before this, rings converted from the other pin
    // were measured unregistered, and a few metres of offset read as roof
    // the elevation data "did not see").
    const ring0: FootprintPoint[] | null = mainOutline ? (latLngRingToFrame(recon.origin, mainOutline).ring as FootprintPoint[]) : null;
    let mainContours: FootprintPoint[][] = ring0 ? [ring0] : contours.map((r) => latLngRingToFrame(recon!.origin, r).ring as FootprintPoint[]);
    let regT: Rigid2D | null = null;
    if (ring0) {
      try {
        const reg = registerContourToRaster({
          contour: ring0,
          mask: recon.mask as never,
          dsm: recon.dsm as never,
          groundElevFt: recon.diagnostics.groundElevFt,
        });
        if (reg.applied) {
          regT = reg.transform;
          provenance.registration = {
            dxFt: reg.transform.dxFt,
            dyFt: reg.transform.dyFt,
            thetaDeg: reg.transform.thetaDeg,
          } as unknown as MeasurementProvenance["registration"];
        }
      } catch {
        /* регистрация — свидетель, не условие */
      }
    }
    if (regT) mainContours = mainContours.map((r) => applyRigid(r, regT!));
    const cov = measureCoverage({
      mask: recon.mask as never,
      dsm: recon.dsm as never,
      groundElevFt: recon.diagnostics.groundElevFt,
      rings: mainContours,
    });
    if (cov) provenance.coverage = { seenSqft: cov.seenSqft, contourSqft: cov.contourSqft, share: cov.share, insetShare: cov.insetShare };

    // ── measured pitch — the retired line's proven DSM measurement (cells →
    // plane court → consistency), data-only. The report is stored whole; the
    // page decides how to word it. pitchSource mirrors the verdict in the
    // shape confidence.ts already reads. measurePitch applies the transform
    // itself, so it takes the unregistered rings.
    try {
      const pitchLabel = mainSt?.pitch ?? instant.totals.pitchLabel;
      const instantPitch12 = pitchLabel ? Number(pitchLabel.split("/")[0]) : null;
      const solarPanels = mainSt ? mainSt.solarPanels === true : instant.structures.some((st) => st.solarPanels === true);
      const pitchRep = measurePitch({
        dsm: recon.dsm as never,
        contours: ring0 ? [ring0] : contours.map((r) => latLngRingToFrame(recon!.origin, r).ring as FootprintPoint[]),
        transform: regT,
        instantPitch12,
        solarPanels,
        coverageShare: cov?.share ?? null,
      });
      (provenance as Record<string, unknown>).pitchMeasurement = {
        ...pitchRep,
        instantPitch12,
        // Known case (12629/12621 published 6/12, measured ≈7.1): a gap over
        // 1/12 between the measured dominant and the published figure is worth
        // a line in the source status.
        disagrees:
          pitchRep.source === "measured" &&
          instantPitch12 != null &&
          Math.abs(pitchRep.families[0].pitch12 - instantPitch12) > 1,
      };
      provenance.pitchSource = {
        source: pitchRep.source,
        reason: pitchRep.reason,
        trustedShare: pitchRep.trustedShare,
        instantPitch12,
        ...(solarPanels ? { solarPanels } : {}),
      } as unknown as MeasurementProvenance["pitchSource"];
    } catch (err) {
      console.warn("[roofMeasurement] pitch measurement failed:", errorMessage(err, String(err)));
    }
  }

  // completeness по строениям (контуры против Instant)
  //
  // Without pack 007 no structure has a ring; that is "outline not
  // purchased", a warn, never the LOW CONFIDENCE "building missing" verdict
  // that would disable pricing on figures that are complete.
  const frameOrigin = recon?.origin ?? origin;
  const mainFrame = frameOrigin && mainOutline ? (latLngRingToFrame(frameOrigin, mainOutline).ring as FootprintPoint[]) : null;
  const planAreaSqft = mainFrame ? Math.abs(areaOf(mainFrame)) : 0;
  const completeness = checkCompleteness({
    mainIndex: pick.index,
    planAreaSqft,
    structures: instant.structures.map((st, i) => {
      const fr = frameOrigin && st.outline && st.outline.length >= 3 ? (latLngRingToFrame(frameOrigin, st.outline).ring as FootprintPoint[]) : null;
      return {
        prefix: "s" + i,
        ring: fr,
        contourAreaSqft: fr ? Math.abs(areaOf(fr)) : 0,
      };
    }),
    instant,
    // No outline is not a lost building when the outline pack was never
    // bought — or is still on its way: refused, not attempted or pending →
    // a note, not an error.
    outlinesNotPurchased: !packs.have.includes(PD_PACK.OUTLINES),
  });
  provenance.completeness = {
    findings: completeness.findings,
    planSqft: completeness.planSqft,
    instantSqft: (completeness as unknown as { instantSqft?: number | null }).instantSqft ?? null,
  } as unknown as MeasurementProvenance["completeness"];
  provenance.instantPacks = packs;

  return { provenance, origin };
}

/**
 * Collect the packs EagleView had not finished when the measurement was
 * saved. Since 2026-09-18 this is the rule, not the exception: the first
 * click waits for the area alone and returns the moment it lands, with the
 * detail packs saved as `pending` on the row, and the page calls this every
 * few seconds for about two minutes until they are in. Each
 * pending order is asked about briefly; what has landed is merged into the
 * saved row (columns, packs report and all) and, when a pack the witnesses
 * read landed (the outline, the pitch, the details), the elevation pass is
 * re-run so the row gets its coverage and measured pitch the way a first-
 * click answer does. Nothing is ordered.
 */
async function lotMaskFor(instant: InstantRoofData, origin: LatLng | null): Promise<LotMask | null> {
  if (!origin) return null;
  const groups = new Map<string, typeof instant.imagery>();
  for (const im of instant.imagery) {
    if (im.view !== "ortho" || !im.bbox || typeof im.masked !== "boolean") continue;
    const [a, b, c, d] = im.bbox;
    if (!(origin.lng >= a && origin.lng <= c && origin.lat >= b && origin.lat <= d)) continue;
    const k = im.bbox.join(",");
    groups.set(k, [...(groups.get(k) ?? []), im]);
  }
  const area = (b: [number, number, number, number]) => (b[2] - b[0]) * (b[3] - b[1]);
  const pair = [...groups.values()]
    .filter((g) => g.some((i) => i.masked) && g.some((i) => !i.masked))
    .sort((x, y) => area(y[0].bbox!) - area(x[0].bbox!))[0];
  if (!pair) return null;
  try {
    const fetched = await withDeadline(
      Promise.all([
        fetchPropertyImage(pair.find((i) => !i.masked)!.token),
        fetchPropertyImage(pair.find((i) => i.masked)!.token),
      ]),
      8_000,
      "Parcel mask imagery",
    );
    return lotMaskFromPair(new Uint8Array(fetched[0].bytes), new Uint8Array(fetched[1].bytes), pair[0].bbox!);
  } catch (err) {
    console.warn("[roofMeasurement] parcel mask unavailable:", errorMessage(err, String(err)));
    return null;
  }
}


/**
 * What the contractor reads when the aerial order fails. The full message —
 * account, client id, host — stays in the console debug line; the toast
 * says what happened in one plain sentence (review 2026-09-17: the first
 * thing a contractor saw on a failed first measurement was a raw 401 body).
 */
export function userFacingInstantError(err: unknown): string {
  if (err instanceof NoRoofError || err instanceof StillProcessingError) return err.message;
  const msg = errorMessage(err, "");
  if (/not entitled|entitlement|403/i.test(msg)) return "This order was refused: the account is not entitled to roof-area measurements. This is an account setting, not the address.";
  if (/credentials|invalid_client|401|sandbox app/i.test(msg)) return "The measurement service rejected our credentials. This is a setup problem on our side, not the address.";
  if (/taking longer|still processing/i.test(msg)) return msg.replace(/\s*Account org.*$/s, "");
  if (/timed out|timeout|abort/i.test(msg)) return "The measurement did not come back in time. Nothing was lost — measure again in a minute; any order that was placed is collected without a new charge.";
  if (/no request id|nothing to measure/i.test(msg)) return "No roof data came back for this address.";
  return "This address could not be measured" + (msg ? ` (${msg.replace(/\s*Account org.*$/s, "").slice(0, 140)})` : "") + ".";
}

/**
 * Замер: добыть Instant (леджер/идемпотентность/дозабор), добыть
 * DSM/Solar (бесплатно), зарегистрировать контур к растру, померить
 * покрытие и completeness, применить парсель-вето — и сохранить ДАННЫЕ.
 * Чертёж не строится.
 */

/** THE MEASUREMENT ITSELF, for a known company and person: the order ledger (reuse, top-up, purchase), the witnesses,
 *  the row. The action is a wrapper over it (session, page); the AI Operator calls it for the roof by voice. */
export async function instantMeasure(
  input: RoofOrderInput,
  organizationId: string,
  userId: string,
  // `building`: a point on the building the contractor chose to measure on a lot with several — the stored order is
  // reused (it is the same address), only which roof the report is about changes. `mainIndex` names that building
  // exactly ("Make main", 2026-10-26 — also off the lot, where a pin alone gives way to the vendor's point), and
  // `included` carries the buildings already ticked into the estimate over to the new measurement.
  opts?: { forceNewOrder?: boolean; building?: LatLng; mainIndex?: number; included?: number[] },
): Promise<MeasureResult> {
  if (!isEagleViewEnabled()) return { ok: false, error: "Roof measurement is not configured" };
  if (!input.address && input.lat == null) return { ok: false, error: "Pick an address first" };
  // The card-less trial's ceilings (lib/trialMeter): a measurement is one
  // roof measurement — given back below when a stored order answers it — and
  // a paid re-measure is an EagleView order, which needs a card.
  const trial = await takeTrialCap(organizationId, opts?.forceNewOrder ? "eagleViewOrders" : "roofMeasurements");
  if (!trial.ok) return trial.failure;
  const deadlineAt = Date.now() + ACTION_BUDGET_MS;

  // Instant: через леджер заказов (переиспользование, дозабор, покупка)
  let instant: InstantRoofData;
  let reuse: { requestId: string; how: "stored" | "recovered" } | undefined;
  let packs: PackReport;
  try {
    const got = await obtainInstant(input, organizationId, opts?.forceNewOrder === true, deadlineAt);
    instant = got.instant;
    reuse = got.reuse;
    packs = got.packs;
    if (reuse) await trial.refund();
  } catch (err) {
    // Over the company's daily ceiling: nothing was ordered, the trial's
    // allowance goes back, and the person reads why.
    if (err instanceof RoofCapError) {
      await trial.refund();
      return { ok: false, error: err.message, capped: true };
    }
    // The plan's monthly measurements are used: nothing was ordered.
    if (isPlanLimitError(err)) {
      await trial.refund();
      return { ok: false, error: PLAN_LIMIT_MESSAGE, code: "PLAN_LIMIT_REACHED", resource: "roofMeasurements" };
    }
    // Nothing was measured: the address goes back to the person (no Google
    // fallback — it would measure whatever Google makes of the same words).
    if (err instanceof AddressNotFoundError) {
      await trial.refund();
      return { ok: false, error: err.message, addressNotFound: true };
    }
    if (err instanceof ExpiredOrderError) {
      await trial.refund();
      return { ok: false, error: err.message, expired: true, canReorder: true };
    }
    const debug = { ...eagleViewIdentity(), stage: "instant order", error: errorMessage(err, String(err)) };
    console.warn("[roofMeasurement] instant failed", debug);
    // Only submission/auth refusals are safe to refund or switch providers.
    // Pending/no-roof errors contain paid order IDs, which may include 401/403.
    const providerAccessDenied = !(err instanceof NoRoofError) && !(err instanceof StillProcessingError) &&
      (err instanceof PdEntitlementError || (err instanceof EagleViewUnavailableError &&
        err.kind === "auth" && (err.op === "auth" || err.op === "property request")));
    // A refused provider lookup produced no measurement. In particular, a
    // Google fallback must not consume a second trial measurement allowance.
    if (providerAccessDenied) await trial.refund();
    return {
      ok: false,
      error: userFacingInstantError(err),
      providerAccessDenied,
      ...(err instanceof NoRoofError ? { noRoof: true } : {}),
      ...(err instanceof StillProcessingError ? { stillProcessing: true, ...(err.stale ? { canReorder: true } : {}) } : {}),
      debug,
    };
  }
  const debug = { ...eagleViewIdentity(), packs, reused: reuse ?? null, requestId: instant.requestId };

  // The witnesses take what is left of the budget; the elevation pass is
  // skipped (and said so) when the order used it up.
  const { provenance, origin } = await witnessInstant({
    instant,
    input,
    packs,
    refreshSolar: opts?.forceNewOrder === true,
    reconDeadlineMs: deadlineAt - Date.now(),
    pickPin: okLatLng(opts?.building) ? opts.building : null,
    chosen: okLatLng(opts?.building),
    userPin: cleanPin(input.userPin),
    forceMain: Number.isInteger(opts?.mainIndex) && (opts?.mainIndex ?? -1) >= 0 ? opts!.mainIndex : null,
    included: Array.isArray(opts?.included) ? opts.included.slice(0, 500) : [],
  });
  if (reuse) provenance.instantReuse = reuse;

  try {
    const measurement = await persistRoofMeasurement({
      organizationId,
      createdById: userId,
      source: "instant+recon",
      input,
      origin,
      instant,
      provenance,
    });
    const where = [input.address, input.city, input.state].map((s) => s?.trim()).filter(Boolean).join(", ") || (input.lat != null && input.lng != null ? `${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}` : "the map pin");
    await logActivity({
      organizationId,
      actorId: userId,
      kind: TRAIL_KINDS.ESTIMATE,
      summary: reuse
        ? `Measured the roof at ${where} from the ${reuse.how} aerial order`
        : `Ordered an aerial roof measurement at ${where}`,
      meta: { trade: "roof", measurementId: measurement.id, address: where, requestId: instant.requestId, reused: !!reuse, packs },
    });
    return { ok: true, measurement, ...(reuse ? { reusedInstant: reuse } : {}), debug };
  } catch (err) {
    console.warn("[roofMeasurement] row not saved:", errorMessage(err, String(err)));
    return { ok: false, error: "Measured, but the row could not be saved", debug };
  }
}
