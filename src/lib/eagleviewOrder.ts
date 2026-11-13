// ORDERING AN ADDRESS PACK BY PACK — the planner behind measureRoofInstant.
//
// Until 2026-09-08 one request asked EagleView for all seven diagram packs;
// when the account lost its entitlement to any one of them the whole order
// was refused (403 / 10880) and the page got nothing, though pack 001 still
// orders. This module buys what can be bought:
//
//   1. [001] alone. It is the roof area, the one pack a measurement cannot do
//      without: a refusal here is the caller's error, as before.
//   2. ONE request for every other pack the account is known to be entitled
//      to (`live` in EagleViewEntitlement). Refused → the entitlement changed
//      since it was recorded, so fall through to 3 for those packs.
//   3. Pack by pack, in PROBE_ORDER, for everything unknown, stale-denied, or
//      knocked out of step 2. 202 → live; 403 → denied (a refusal is free);
//      anything else → failed, verdict unchanged (the reason is written on
//      the pack's row since 2026-11-12, dated, so a re-check is never silent).
//   The imagery (008, PAIRED_ONLY) is never asked alone — EagleView refuses it
//   that way even to an entitled account. It rides along with step 2's
//   request (or, when nothing else is ordered, with the roof area), and a
//   refusal with it aboard is asked again without it to say whose it was.
//
// THE AREA IS THE MEASUREMENT; THE REST LANDS BEHIND IT (2026-09-18). Until
// 2026-09-17 every accepted order was polled to completion — up to 30 s each —
// before the next one was even placed, so a first click on a new address could
// wait 30 s × 7 and the function limit cut it off. The 2026-09-17 review then
// placed all seven up front and waited for all of them together, and the first
// live run showed the cost: the click waited the whole budget for the slowest
// pack, and with seven orders on the same address at once the area itself was
// still processing after it. Now the area order is placed ALONE and waited for
// ALONE (asked round after round, up to the budget); the moment it lands the
// other packs are placed and the click returns — those are reported as
// `pending`: placed, paid, and collected by the page without a new charge
// (collectPendingInstant), never as failed and never re-ordered. The page
// prices nothing until they are in.
//
// Whatever the billing model, only accepted packs are paid for: EagleView
// rejects a refused request whole. Every accepted request is written to the
// ledger BEFORE its first poll, exactly as the single order was (a lost
// requestId is a paid result nobody can fetch).
//
// Plain module, no "use server": the I/O comes in through `deps`, so the plan
// can be exercised against fakes without ordering anything.

import {
  PD_DIAGRAM_PACKS,
  PD_PACK,
  PdEntitlementError,
  mergeInstantResults,
  type EvOrderInput,
  type InstantRoofData,
  type InstantStructure,
  type PdPack,
} from "@/lib/eagleview";
import { PAIRED_ONLY, PROBE_ORDER, needsProbe, type PackRecord, type PackStatus } from "@/lib/eagleviewEntitlements";

/** What a measurement's Instant answer is made of, pack by pack. */
export interface PackReport {
  /** Bought — by this order or an earlier one for the same address. */
  have: string[];
  /** The account is not entitled (403). */
  denied: string[];
  /** Errored for another reason (timeout, 5xx); verdict unchanged. */
  failed: string[];
  /** Neither bought nor refused — not attempted. */
  missing: string[];
  /**
   * Ordered and paid for, not delivered yet when the answer was saved. The
   * page collects these without a new charge; nothing is priced on a roof
   * whose pitch or details are still on the way.
   */
  pending?: string[];
  /**
   * No record either way: an answer reused from a measurement row saved
   * before the ledger (2026-08-26) says what it CONTAINS, not what was asked
   * for — a pack whose fields are absent may have been refused, empty for
   * this address, or never ordered.
   */
  unknown?: string[];
}

export function packReport(
  have: Iterable<string>,
  denied: Iterable<string>,
  failed: Iterable<string>,
  unknown: Iterable<string> = [],
  pending: Iterable<string> = [],
): PackReport {
  const h = new Set(have);
  const p = new Set([...pending].filter((x) => !h.has(x)));
  const d = new Set([...denied].filter((x) => !h.has(x) && !p.has(x)));
  const f = new Set([...failed].filter((x) => !h.has(x) && !p.has(x) && !d.has(x)));
  const u = new Set([...unknown].filter((x) => !h.has(x) && !p.has(x) && !d.has(x) && !f.has(x)));
  return {
    have: PD_DIAGRAM_PACKS.filter((x) => h.has(x)),
    denied: PD_DIAGRAM_PACKS.filter((x) => d.has(x)),
    failed: PD_DIAGRAM_PACKS.filter((x) => f.has(x)),
    missing: PD_DIAGRAM_PACKS.filter((x) => !h.has(x) && !p.has(x) && !d.has(x) && !f.has(x) && !u.has(x)),
    ...(p.size ? { pending: PD_DIAGRAM_PACKS.filter((x) => p.has(x)) } : {}),
    ...(u.size ? { unknown: PD_DIAGRAM_PACKS.filter((x) => u.has(x)) } : {}),
  };
}

/** The packs a report says are still on the way (absent on rows saved before 2026-09-17). */
export const pendingPacks = (r: PackReport | null | undefined): string[] => r?.pending ?? [];

/** Whether an Instant answer describes a roof at all: at least one structure with an area. */
export function hasRoof(instant: InstantRoofData | null | undefined): boolean {
  return !!instant?.structures?.some((s) => (s.areaSqft ?? 0) > 0);
}

/**
 * Which packs a stored answer EVIDENTLY contains — read off its fields. For
 * rows saved before the ledger this is the only record of what was bought;
 * everything not evidenced is `unknown`, never assumed.
 */
export function packsFromContent(instant: InstantRoofData): { have: PdPack[]; unknown: PdPack[] } {
  const st = instant.structures ?? [];
  const any = (f: (s: InstantStructure) => boolean) => st.some(f);
  const have: PdPack[] = [];
  if (any((s) => s.areaSqft != null)) have.push(PD_PACK.ROOF_AREA);
  if (any((s) => s.pitch != null || s.eaveHeightFt != null)) have.push(PD_PACK.PITCH_EAVE);
  // Facet count and shape arrive in 003 with the material, NOT in 005 — read
  // off the stored raw bodies (2026-10-16): every order carrying
  // structure_roof_facet_count included 003, none without it ever had one,
  // and a completed 005 body holds only chimney / solar / AC / occlusion.
  if (any((s) => s.material != null || s.conditionRating != null || s.facetCount != null || s.shape != null)) have.push(PD_PACK.MATERIAL_CONDITION);
  if (any((s) => s.roofAgeYears != null)) have.push(PD_PACK.ROOF_AGE);
  if (any((s) => s.chimney != null || s.solarPanels != null || s.rooftopAcCount != null)) have.push(PD_PACK.PROPERTY_DETAILS);
  if (any((s) => (s.outline?.length ?? 0) >= 3)) have.push(PD_PACK.OUTLINES);
  if ((instant.imagery ?? []).length > 0) have.push(PD_PACK.ORTHO);
  return { have, unknown: PD_DIAGRAM_PACKS.filter((p) => !have.includes(p)) };
}

/** `InstantOrder.packs` → pack ids. Rows from before per-pack ordering carry
 *  null: those were single seven-pack orders. */
export function rowPacks(packsJson: string | null | undefined): string[] {
  if (!packsJson) return [...PD_DIAGRAM_PACKS];
  try {
    const arr = JSON.parse(packsJson);
    return Array.isArray(arr) ? arr.map(String) : [...PD_DIAGRAM_PACKS];
  } catch {
    return [...PD_DIAGRAM_PACKS];
  }
}

export interface OrderDeps {
  /** Places ONE billed order; throws PdEntitlementError on 403. */
  submit(input: EvOrderInput, packs: PdPack[]): Promise<{ requestId: string; completeAddress: string }>;
  /**
   * Asks for a placed order's result; null while still processing. `maxWaitMs`
   * 0 means ONE request and no waiting — the planner does its own waiting,
   * across every placed order, so no single order is waited on alone.
   */
  poll(requestId: string, input: EvOrderInput, completeAddress: string, onRaw: (body: string) => void, maxWaitMs: number): Promise<InstantRoofData | null>;
  ledger: {
    create(requestId: string, packs: PdPack[]): Promise<void>;
    complete(requestId: string, instant: InstantRoofData, raw: string | null): Promise<void>;
    fail(requestId: string, error: string): Promise<void>;
  };
  entitlements: {
    read(): Promise<Map<string, PackRecord>>;
    mark(packs: readonly string[], status: PackStatus, error?: string | null): Promise<void>;
    /** A re-check that reached no verdict: the reason is written, the verdict and its date stay. */
    note?(packs: readonly string[], reason: string): Promise<void>;
  };
  /** Whether a poll error is EagleView's final verdict on the order. */
  isTerminalFailure(err: unknown): boolean;
  log?(msg: string): void;
  /** Test seams: the pause between rounds of the collect loop, and the clock. */
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

export interface OrderOutcome {
  /** Merged answer, or null when nothing could be bought (base refused → thrown instead). */
  instant: InstantRoofData;
  report: PackReport;
}

const ROOF_AREA = PD_PACK.ROOF_AREA;

/** How long a fresh order is waited for, all packs together, before the rest is left pending. */
export const ORDER_COLLECT_BUDGET_MS = 75_000;
/** Pause between rounds of asking each placed order in turn. */
export const COLLECT_ROUND_MS = 2_000;
/**
 * An order still `pending` this long after it was placed is closed as failed
 * and taken off the spend count (lib/instantOrderExpiry). EagleView answers in
 * seconds; ten minutes is an order that is not coming (owner, 2026-10-26).
 */
export const PENDING_EXPIRE_MS = 10 * 60_000;

/** A placed, ledgered order the collect loop is waiting on. */
export interface PlacedOrder {
  requestId: string;
  packs: PdPack[];
  completeAddress: string;
}

export interface CollectOutcome {
  /** Orders that completed, with their answers; the pack-001 order first. */
  landed: Array<{ order: PlacedOrder; instant: InstantRoofData }>;
  /** Still processing when the budget ran out — placed and paid, collected later. */
  pending: PlacedOrder[];
  /** EagleView's final verdict was failure; recorded in the ledger. */
  failed: PlacedOrder[];
}

/**
 * Collect placed orders together: one result request at a time, every order
 * still open asked in turn, a short pause between rounds, until all have
 * answered or the budget is spent. A transport error on one ask is not a
 * verdict — the order stays open and is asked again next round; only
 * EagleView's own failed/rejected/cancelled status closes an order as failed.
 * A budget of 0 is one round: every order asked once, no waiting. With
 * `untilPack` the wait ends the moment the order carrying that pack has
 * answered (landed or failed) — the others are left pending for the page.
 */
export async function collectPlacedOrders(
  orders: readonly PlacedOrder[],
  input: EvOrderInput,
  deps: OrderDeps,
  budgetMs: number,
  opts: { untilPack?: PdPack } = {},
): Promise<CollectOutcome> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const open = [...orders];
  const landed: CollectOutcome["landed"] = [];
  const failed: PlacedOrder[] = [];
  const deadline = now() + Math.max(0, budgetMs);
  let first = true;
  const waitingFor = (): boolean => !opts.untilPack || open.some((o) => o.packs.includes(opts.untilPack as PdPack));
  while (open.length && waitingFor()) {
    // The first round asks every order once without a pause; from then on
    // the loop waits between rounds and stops when the budget is spent.
    if (!first) {
      if (now() >= deadline) break;
      await sleep(Math.min(COLLECT_ROUND_MS, Math.max(0, deadline - now())));
    }
    first = false;
    for (const order of [...open]) {
      let raw: string | null = null;
      try {
        const got = await deps.poll(order.requestId, input, order.completeAddress, (body) => { raw = body; }, 0);
        if (!got) continue;
        await deps.ledger.complete(order.requestId, got, raw).catch(() => {});
        landed.push({ order, instant: got });
        open.splice(open.indexOf(order), 1);
      } catch (err) {
        if (deps.isTerminalFailure(err)) {
          await deps.ledger.fail(order.requestId, err instanceof Error ? err.message : String(err)).catch(() => {});
          failed.push(order);
          open.splice(open.indexOf(order), 1);
        } else {
          deps.log?.(`result for ${order.requestId} (${order.packs.join(",")}) not answered this round: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!waitingFor()) break;
    }
  }
  landed.sort((a, b) => Number(b.order.packs.includes(ROOF_AREA)) - Number(a.order.packs.includes(ROOF_AREA)));
  return { landed, pending: open, failed };
}

/** One accepted order: ledger row the moment EagleView accepts it, before anything else. */
async function placeOrder(deps: OrderDeps, input: EvOrderInput, packs: PdPack[]): Promise<PlacedOrder> {
  const { requestId, completeAddress } = await deps.submit(input, packs);
  try {
    await deps.ledger.create(requestId, packs);
  } catch (err) {
    deps.log?.(`COULD NOT RECORD instant order ${requestId} (${packs.join(",")}) — a lost id is a paid result nobody can fetch: ${String(err)}`);
  }
  return { requestId, packs, completeAddress };
}

/**
 * Buy the diagram packs for an address, minus `skip` (packs the address
 * already has from earlier orders, complete or still processing). The area
 * (pack 001) is placed alone and waited for alone: it is the measurement,
 * and a click returns the moment it lands. Throws when 001 is refused or
 * fails to place — there is no measurement without the area — and when 001
 * is placed but has not answered within the budget (the order is in the
 * ledger; the next click collects it for free). The other packs are placed
 * once the area is in and are NOT waited for: they come back as `pending`
 * and the page collects them.
 */
export async function orderPacksFor(
  input: EvOrderInput,
  deps: OrderDeps,
  opts: { skip?: readonly string[]; base?: InstantRoofData | null; collectBudgetMs?: number } = {},
): Promise<OrderOutcome> {
  const skip = new Set(opts.skip ?? []);
  const wanted = PD_DIAGRAM_PACKS.filter((p) => !skip.has(p));
  const have = new Set<string>(skip);
  const denied = new Set<string>();
  const failed = new Set<string>();
  const parts: InstantRoofData[] = [];

  // ── 1. the area, alone: placed, then waited for ──
  if (wanted.includes(ROOF_AREA)) {
    let areaOrder: PlacedOrder;
    try {
      areaOrder = await placeOrder(deps, input, [ROOF_AREA]);
      await deps.entitlements.mark([ROOF_AREA], "live");
    } catch (err) {
      if (err instanceof PdEntitlementError) await deps.entitlements.mark([ROOF_AREA], "denied", err.message);
      throw err;
    }
    const c = await collectPlacedOrders([areaOrder], input, deps, opts.collectBudgetMs ?? ORDER_COLLECT_BUDGET_MS);
    if (c.pending.length) {
      throw new Error(
        `Property Data is taking longer than expected (order ${areaOrder.requestId}, roof area). The order is saved — measuring this address again will collect it without paying twice.`,
      );
    }
    const landed = c.landed[0];
    if (!landed) throw new Error(`Property Data request failed for the roof area (order ${areaOrder.requestId})`);
    parts.push(landed.instant);
    have.add(ROOF_AREA);
    // No roof in the area answer — an address EagleView could not place, or a
    // place with no structure: the other packs would describe nothing, and
    // every one of them is a paid order (2026-10-26, ticket 8KETUL: five more
    // packs were placed on "Invalid address" and never arrived).
    if (!hasRoof(landed.instant)) {
      const all = opts.base ? [opts.base, landed.instant] : [landed.instant];
      return { instant: mergeInstantResults(all), report: packReport(have, denied, failed) };
    }
  }

  // ── 2. the rest: placed now, collected by the page ──
  const placed: PlacedOrder[] = [];
  const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const note = async (packs: readonly string[], reason: string) => {
    if (packs.length) await deps.entitlements.note?.(packs, reason).catch(() => {});
  };
  const rest = wanted.filter((p) => p !== ROOF_AREA);
  const known = await deps.entitlements.read();
  const live = rest.filter((p) => known.get(p)?.status === "live");
  // Due a check: never asked, or refused more than a day ago.
  const due = rest.filter((p) => !live.includes(p) && needsProbe(known.get(p)));
  for (const p of rest) if (!live.includes(p) && !due.includes(p)) denied.add(p); // fresh refusals, not re-asked
  // A pack EagleView refuses when asked alone (the imagery, PAIRED_ONLY) is
  // checked riding along with another order — never by itself.
  const riders = due.filter((p) => (PAIRED_ONLY as readonly string[]).includes(p)) as PdPack[];
  let oneByOne: string[] = due.filter((p) => !riders.includes(p as PdPack));

  // 2a. everything the account is known to have, in one request — with the
  //     riders aboard. Their partner, in this order of preference:
  //       · the known-live packs (the usual case);
  //       · else the first pack due a probe — it is being bought or probed
  //         this click anyway;
  //       · else the roof area again, when the address already has it — a
  //         "buy the missing packs" click on an address that has everything
  //         but the imagery: that click is a paid order either way, and the
  //         area is the one pack that is always entitled.
  //     When the area was bought by this very call and nothing else is
  //     ordered, there is no partner worth paying for: the riders wait, and
  //     their row says so.
  const probeOrder = PROBE_ORDER as readonly string[];
  const byProbeOrder = (ps: readonly string[]) => [...probeOrder.filter((p) => ps.includes(p)), ...ps.filter((p) => !probeOrder.includes(p))];
  // A refused grouped order sends its packs to be probed one by one — all but
  // a paired-only pack, which a lone probe would deny whatever the account
  // has: its verdict stays, and its row says the check settled nothing.
  const probeLiveOneByOne = async (why: string) => {
    const paired = live.filter((p) => (PAIRED_ONLY as readonly string[]).includes(p));
    oneByOne = [...live.filter((p) => !paired.includes(p)), ...oneByOne];
    paired.forEach((p) => failed.add(p));
    await note(paired, why);
  };
  let partner: PdPack[] = [];
  let partnerIsProbe = false;
  if (live.length) partner = live;
  else if (riders.length && oneByOne.length) {
    partner = [byProbeOrder(oneByOne)[0] as PdPack];
    oneByOne = oneByOne.filter((p) => p !== partner[0]);
    partnerIsProbe = true;
  } else if (riders.length && !wanted.includes(ROOF_AREA)) partner = [ROOF_AREA];
  if (riders.length && !partner.length) {
    await note(riders, "not re-checked — nothing else was ordered to carry it (EagleView refuses this pack asked alone)");
  }
  if (partner.length) {
    const aboard = [...partner, ...riders];
    const failPartner = () => partner.filter((p) => p !== ROOF_AREA).forEach((p) => failed.add(p));
    let refusal: PdEntitlementError | null = null;
    try {
      placed.push(await placeOrder(deps, input, aboard));
      await deps.entitlements.mark(aboard, "live");
    } catch (err) {
      if (err instanceof PdEntitlementError) refusal = err;
      else {
        failPartner();
        deps.log?.(`grouped order for ${aboard.join(",")} could not be placed: ${msg(err)}`);
        await note(riders, `the order carrying it (${partner.join(",")}) could not be placed: ${msg(err)}`);
      }
    }
    if (refusal && !riders.length) {
      deps.log?.(`grouped order for ${live.join(",")} refused — entitlement changed, probing one by one`);
      await probeLiveOneByOne(`the grouped order carrying it was refused: ${refusal.message}`);
    } else if (refusal && partner[0] === ROOF_AREA) {
      // With the always-entitled area as partner, the refusal is the riders'.
      riders.forEach((p) => denied.add(p));
      await deps.entitlements.mark(riders, "denied", `${refusal.message} (asked together with ${partner.join(",")})`);
    } else if (refusal) {
      // Refused with the riders aboard: ask again without them. Accepted → it
      // was the riders, and they are denied with EagleView's own words.
      try {
        placed.push(await placeOrder(deps, input, partner));
        await deps.entitlements.mark(partner, "live");
        riders.forEach((p) => denied.add(p));
        await deps.entitlements.mark(riders, "denied", `${refusal.message} (asked together with ${partner.join(",")})`);
      } catch (err) {
        if (err instanceof PdEntitlementError && partnerIsProbe) {
          // a single-pack probe refused: that verdict is the partner's own
          denied.add(partner[0]);
          await deps.entitlements.mark(partner, "denied", err.message);
          await note(riders, `refused together with ${partner.join(",")}, which is itself refused: ${msg(err)}`);
        } else if (err instanceof PdEntitlementError) {
          deps.log?.(`grouped order for ${live.join(",")} refused — entitlement changed, probing one by one`);
          await probeLiveOneByOne(`refused together with ${partner.join(",")}, and those were refused without it too: ${msg(err)}`);
          await note(riders, `refused together with ${partner.join(",")}, and those were refused without it too: ${msg(err)}`);
        } else {
          failPartner();
          deps.log?.(`order for ${partner.join(",")} could not be placed: ${msg(err)}`);
          await note(riders, `refused together with ${partner.join(",")}; the order without it then failed: ${msg(err)}`);
        }
      }
    }
  }

  // 2b. one pack at a time, in the order the page misses them
  const ordered = byProbeOrder(oneByOne);
  for (const pack of ordered as PdPack[]) {
    try {
      placed.push(await placeOrder(deps, input, [pack]));
      await deps.entitlements.mark([pack], "live");
    } catch (err) {
      if (err instanceof PdEntitlementError) {
        denied.add(pack);
        await deps.entitlements.mark([pack], "denied", err.message);
      } else {
        failed.add(pack);
        deps.log?.(`pack ${pack} could not be placed: ${msg(err)}`);
        await note([pack], `the probe could not be placed: ${msg(err)}`);
      }
    }
  }
  // Placed and paid, not waited for: the page collects them (collectPendingInstant).
  const stillPending = placed.flatMap((o) => o.packs);
  // A rider whose re-check settled nothing keeps its last verdict in the report.
  for (const p of riders) if (!stillPending.includes(p) && !denied.has(p) && known.get(p)?.status === "denied") denied.add(p);

  // The base (pack 001, this order's or an earlier one's) goes first so every
  // later part fills its structures in; the merge re-derives the totals.
  const all = opts.base ? [opts.base, ...parts] : parts;
  if (!all.length) throw new Error("Property Data returned nothing to measure from");
  return { instant: mergeInstantResults(all), report: packReport(have, denied, failed, [], stillPending) };
}
