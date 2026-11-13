// The fixes from the 2026-09-17 inspection of the roof estimator: the first
// click gets the whole aerial answer (every pack placed up front, collected
// together, the slow ones pending — never failed, never re-bought), and the
// pricing rules the review found wrong (edges for a hand takeoff, sloped
// rakes and hips, tear-off by what is on the roof, intake that covers the
// exhaust, starter where it belongs, the storey factor, the basis words).
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/roof-review.check.ts
import { PD_DIAGRAM_PACKS, PD_PACK, PdEntitlementError, type EvOrderInput, type InstantRoofData, type InstantStructure, type PdPack } from "../../../src/lib/eagleview";
import {
  collectPlacedOrders,
  hasRoof,
  orderPacksFor,
  packReport,
  type OrderDeps,
  type PlacedOrder,
} from "../../../src/lib/eagleviewOrder";
import type { PackRecord, PackStatus } from "../../../src/lib/eagleviewEntitlements";
import { BUILTIN_LISTS, DECK_BOARDS, EXISTING_STEEP, FASCIA_OPTIONS, storeyLaborFactor, tearOffRatesFor, VENT_TYPES } from "../../../src/lib/roofPackage/catalog";
import {
  buildRoofPackage,
  plywoodRate,
  checkVentilation,
  defaultSpec,
  estimateEdges,
  fastenersName,
  flattenForLowSlope,
  takesStarter,
  type RoofFacts,
  type RoofPackage,
} from "../../../src/lib/roofPackage/takeoff";
import { saneLists } from "../../../src/components/v3/roof-estimator-blueprint/roof-package-builder";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const has = (p: RoofPackage, re: RegExp) => [...p.materials, ...p.labor].some((l) => re.test(l.name));
const line = (p: RoofPackage, re: RegExp) => [...p.materials, ...p.labor].find((l) => re.test(l.name));

// ── a fake EagleView + ledger for the planner ─────────────────────────────
const P = PD_PACK;
const structure = (over: Partial<InstantStructure> = {}): InstantStructure => ({
  areaSqft: null, squares: null, pitch: null, eaveHeightFt: null, footprintSqft: null, outline: null, facetCount: null, shape: null, material: null,
  conditionRating: null, roofAgeYears: null, chimney: null, solarPanels: null, rooftopAcCount: null, occlusion: null, treeOverhang: null, confidence: null, materialRings: null, ...over,
});
const answerFor = (requestId: string, packs: readonly string[]): InstantRoofData => {
  const st = structure({
    ...(packs.includes(P.ROOF_AREA) ? { areaSqft: 2400, squares: 24 } : {}),
    ...(packs.includes(P.PITCH_EAVE) ? { pitch: "6/12", eaveHeightFt: { N: 10, S: 10 } } : {}),
    ...(packs.includes(P.PROPERTY_DETAILS) ? { chimney: true } : {}),
    ...(packs.includes(P.OUTLINES) ? { outline: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.0002 }, { lat: 0.0001, lng: 0.0002 }, { lat: 0.0001, lng: 0 }], footprintSqft: 2000 } : {}),
    ...(packs.includes(P.MATERIAL_CONDITION) ? { material: "Asphalt shingle", facetCount: 4, shape: "Gable" } : {}),
  });
  return { requestId, address: "1 Main St", lat: 0, lng: 0, structures: [st], imagery: packs.includes(P.ORTHO) ? [{ token: "t-" + requestId, view: "ortho", bbox: null }] : [], totals: { areaSqft: st.areaSqft ?? 0, squares: (st.areaSqft ?? 0) / 100, predominantPitch: null, pitchLabel: st.pitch, maxEaveFt: null, facetCount: st.facetCount, footprintSqft: st.footprintSqft } };
};

interface FakeWorld {
  /** asks a placed order needs before it completes; "fail" for EagleView's own failure; "drop" = transport error once then complete */
  readiness: Record<string, number | "fail" | "drop">;
  /** submit verdicts per pack list key ("001", "002,003") */
  refuse?: Record<string, "403" | "5xx">;
  /** keys whose 403 applies to the first order only (a grouped refusal, then an accepted probe) */
  refuseOnce?: string[];
  entitlements?: Array<[string, PackStatus]>;
}
function fakeDeps(world: FakeWorld) {
  const calls: string[] = [];
  const ledger: Record<string, { packs: string[]; status: string }> = {};
  const marks: Array<[string[], PackStatus]> = [];
  const asks: Record<string, number> = {};
  const refusedOnce = new Set<string>();
  let clock = 0;
  let n = 0;
  const packsById: Record<string, string[]> = {};
  const deps: OrderDeps = {
    submit: async (_input: EvOrderInput, packs: PdPack[]) => {
      const key = packs.map((p) => p.slice(-3)).join(",");
      calls.push("submit " + key);
      const verdict = world.refuse?.[key];
      // A refusal applies to the FIRST order for that list: the grouped order
      // is refused, the later single-pack probe of the same pack is accepted
      // (an entitlement that changed since it was recorded).
      if (verdict === "403" && !refusedOnce.has(key) && world.refuseOnce?.includes(key)) {
        refusedOnce.add(key);
        throw new PdEntitlementError("refused " + key, packs, 10880);
      }
      if (verdict === "403" && !world.refuseOnce?.includes(key)) throw new PdEntitlementError("refused " + key, packs, 10880);
      if (verdict === "5xx") throw new Error("eagleview 503 on " + key);
      n += 1;
      const requestId = "req" + n;
      packsById[requestId] = packs.map((p) => p.slice(-3));
      return { requestId, completeAddress: "1 Main St" };
    },
    poll: async (requestId, _input, _addr, onRaw, maxWaitMs) => {
      calls.push(`poll ${requestId}@${maxWaitMs}`);
      asks[requestId] = (asks[requestId] ?? 0) + 1;
      const key = packsById[requestId].join(",");
      const need = world.readiness[key] ?? 1;
      if (need === "fail") throw new Error("Property Data request failed");
      if (need === "drop") {
        if (asks[requestId] === 1) throw new Error("fetch failed: socket hang up");
        onRaw("{}");
        return answerFor(requestId, packsById[requestId].map((p) => "property_data_id_" + p));
      }
      if (asks[requestId] < need) return null;
      onRaw("{}");
      return answerFor(requestId, packsById[requestId].map((p) => "property_data_id_" + p));
    },
    ledger: {
      create: async (requestId, packs) => { calls.push("ledger.create " + requestId); ledger[requestId] = { packs: packs.map((p) => p.slice(-3)), status: "pending" }; },
      complete: async (requestId) => { ledger[requestId].status = "complete"; },
      fail: async (requestId) => { ledger[requestId].status = "failed"; },
    },
    entitlements: {
      read: async () => new Map<string, PackRecord>((world.entitlements ?? [[P.ROOF_AREA, "live"], [P.PITCH_EAVE, "live"]]).map(([pack, status]) => [pack, { pack, status, checkedAt: new Date(), error: null }])),
      mark: async (packs, status) => { marks.push([[...packs], status]); },
    },
    isTerminalFailure: (err) => err instanceof Error && /^Property Data request (?!failed \()/i.test(err.message) && /fail|error|reject|cancel/i.test(err.message),
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  };
  return { deps, calls, ledger, marks, asks };
}
const input: EvOrderInput = { address: "1 Main St", city: "Frisco", state: "TX", zip: "75034" };
const short = (packs: readonly string[]) => packs.map((p) => p.slice(-3)).join(",");

(async () => {
  console.log("── the first click: the area alone, waited for; the rest placed behind it and left to the page");
  {
    const w = fakeDeps({ readiness: { "001": 3, "002": 2, "008": 1, "005": 1, "007": 1, "003": 1, "004": 1 } });
    const out = await orderPacksFor(input, w.deps, { collectBudgetMs: 60_000 });
    const submits = w.calls.map((c, i) => (c.startsWith("submit") ? i : -1)).filter((i) => i >= 0);
    const polls = w.calls.map((c, i) => (c.startsWith("poll") ? i : -1)).filter((i) => i >= 0);
    check("001 is submitted first and alone; the other six follow — the imagery (008) riding with the grouped order, never alone", w.calls[0] === "submit 001" && submits.length === 6 && w.calls.includes("submit 002,008") && !w.calls.includes("submit 008"), w.calls.filter((c) => c.startsWith("submit")).join(" | "));
    check("the area is waited for before anything else is placed", polls.length > 0 && polls.every((i) => i < submits[1]), w.calls.slice(0, 6).join(" | "));
    check("only the area order is ever asked about, one ask per round", w.calls.filter((c) => c.startsWith("poll")).every((c) => c === "poll req1@0") && w.asks.req1 === 3, JSON.stringify(w.asks));
    check("every accepted order is in the ledger", w.calls.filter((c) => c.startsWith("ledger.create")).length === 6);
    check("the answer carries the area; the rest is pending for the page", short(out.report.have) === "001" && short(out.report.pending ?? []) === "002,003,004,005,007,008", JSON.stringify(out.report));
    check("nothing is failed or missing", out.report.failed.length === 0 && out.report.missing.length === 0);
    check("the merged answer has the area", out.instant.totals.areaSqft === 2400);
    check("the base order is pack 001 (merge keeps its id)", out.instant.requestId === "req1", out.instant.requestId);
    check("acceptance marks the packs live", w.marks.some(([p, s]) => s === "live" && p.includes(P.ROOF_AREA)) && w.marks.some(([p, s]) => s === "live" && p.includes(P.OUTLINES)));
  }

  console.log("── the area is waited for up to the budget, and never past it");
  {
    // 001 needs 60 asks: at one ask per 2 s round that is past a 20 s budget.
    const w = fakeDeps({ readiness: { "001": 60 } });
    let msg = "";
    try { await orderPacksFor(input, w.deps, { collectBudgetMs: 20_000 }); } catch (err) { msg = (err as Error).message; }
    check("the area itself still processing → the click fails with the order id kept", /taking longer.*req1.*without paying twice/s.test(msg), msg);
    check("…and the area's ledger row is still pending for the next click", w.ledger.req1.status === "pending");
    check("the wait stopped at the budget (rounds of ~2 s)", w.asks.req1 >= 9 && w.asks.req1 <= 12, `asked ${w.asks.req1} times`);
    check("nothing else was placed over a click that got no measurement", w.calls.filter((c) => c.startsWith("submit")).join() === "submit 001", w.calls.filter((c) => c.startsWith("submit")).join(" | "));
  }

  console.log("── refusals, placement failures, EagleView's own failures");
  {
    const w = fakeDeps({ readiness: { "001": 1, "002": 1, "008": 1, "005": 1, "007": 1, "003": "fail", "004": 1 }, refuse: { "002,008": "403", "002": "403" }, refuseOnce: ["002"] });
    const out = await orderPacksFor(input, w.deps, { collectBudgetMs: 20_000 });
    check("a refused grouped order is probed pack by pack", w.calls.includes("submit 002") && w.calls.filter((c) => c === "submit 002").length === 2, w.calls.filter((c) => c.startsWith("submit")).join(" | "));
    check("the imagery is never asked alone, and an unsettled re-check is no verdict", !w.calls.includes("submit 008") && !w.marks.some(([p]) => p.includes(P.ORTHO)), JSON.stringify(w.marks));
    check("the area is in; the accepted probes are pending for the page (EagleView's own verdict on them comes then)", short(out.report.have) === "001" && short(out.report.pending ?? []) === "002,003,004,005,007", JSON.stringify(out.report));
    check("nothing the page will collect is marked failed", out.report.failed.length === 0 && Object.values(w.ledger).every((r) => r.status !== "failed"));
  }
  {
    const w = fakeDeps({ readiness: { "001": 1, "002": 1 }, refuse: { "002,008": "5xx" } });
    const out = await orderPacksFor(input, w.deps, { collectBudgetMs: 5_000 });
    check("a grouped order that could not be placed is failed, not pending", short(out.report.failed) === "002" && !(out.report.pending ?? []).includes(P.PITCH_EAVE), JSON.stringify(out.report));
  }
  {
    // 400 / 10640 or 403 alike reach the planner as a PdEntitlementError (lib/eagleview pdEntitlementRefusal).
    const w = fakeDeps({ readiness: { "001": 1 }, refuse: { "002,008": "403" } });
    const out = await orderPacksFor(input, w.deps, { collectBudgetMs: 5_000 });
    check("refused with the imagery aboard, accepted without it → 008 is denied, 002 goes on", short(out.report.denied) === "008" && w.calls.includes("submit 002") && (out.report.pending ?? []).includes(P.PITCH_EAVE) && w.marks.some(([p, st]) => st === "denied" && p.includes(P.ORTHO)), w.calls.filter((c) => c.startsWith("submit")).join(" | "));
  }
  {
    // EagleView switched the imagery back on: it rides with the grouped order, is accepted, and is bought from then on.
    const w = fakeDeps({ readiness: { "001": 1 }, entitlements: [[P.ROOF_AREA, "live"], [P.PITCH_EAVE, "live"]] });
    const out = await orderPacksFor(input, w.deps, { collectBudgetMs: 5_000 });
    check("an accepted rider is marked live and its order is pending for the page", w.marks.some(([p, st]) => st === "live" && p.includes(P.ORTHO)) && (out.report.pending ?? []).includes(P.ORTHO), JSON.stringify(w.marks));
  }
  {
    // The imagery is live and the grouped order is refused: the rest is probed alone, the imagery is not.
    const w = fakeDeps({ readiness: { "001": 1 }, refuse: { "002,008": "403" }, entitlements: [[P.ROOF_AREA, "live"], [P.PITCH_EAVE, "live"], [P.ORTHO, "live"]] });
    await orderPacksFor(input, w.deps, { collectBudgetMs: 5_000 });
    check("a refused grouped order with the imagery live never probes the imagery alone", w.calls.includes("submit 002") && !w.calls.includes("submit 008") && !w.marks.some(([p, st]) => st === "denied" && p.includes(P.ORTHO)), w.calls.filter((c) => c.startsWith("submit")).join(" | "));
  }
  {
    // "Order the missing packs" on an address that has everything but the imagery: the area carries it.
    const w = fakeDeps({ readiness: {}, entitlements: [[P.ROOF_AREA, "live"], [P.PITCH_EAVE, "live"]] });
    const base = answerFor("old2", PD_DIAGRAM_PACKS.filter((p) => p !== P.ORTHO));
    await orderPacksFor(input, w.deps, { skip: PD_DIAGRAM_PACKS.filter((p) => p !== P.ORTHO), base, collectBudgetMs: 0 });
    check("the only missing pack is the imagery → one order, 001 + 008", w.calls.filter((c) => c.startsWith("submit")).join(" | ") === "submit 001,008", w.calls.filter((c) => c.startsWith("submit")).join(" | "));
  }
  {
    const w = fakeDeps({ readiness: {}, refuse: { "001": "403" } });
    let thrown: unknown = null;
    try { await orderPacksFor(input, w.deps); } catch (err) { thrown = err; }
    check("the area refused → the click fails and the pack is marked denied", thrown instanceof PdEntitlementError && w.marks.some(([p, s]) => s === "denied" && p.includes(P.ROOF_AREA)));
  }

  console.log("── skip: what the address has, complete or still on the way, is not bought again");
  {
    const w = fakeDeps({ readiness: { "003": 1, "004": 1, "005": 1, "007": 1, "008": 1 } });
    const base = answerFor("old1", [P.ROOF_AREA]);
    const out = await orderPacksFor(input, w.deps, { skip: [P.ROOF_AREA, P.PITCH_EAVE], base, collectBudgetMs: 10_000 });
    check("neither 001 nor the pending 002 is submitted", !w.calls.some((c) => c === "submit 001" || c.includes("002")), w.calls.filter((c) => c.startsWith("submit")).join(" | "));
    check("the stored area is the merge's base", out.instant.requestId === "old1" && out.instant.totals.areaSqft === 2400);
    check("skipped packs count as had", short(out.report.have).startsWith("001,002"));
    check("the bought packs are pending, not waited for (no poll at all)", short(out.report.pending ?? []) === "003,004,005,007,008" && !w.calls.some((c) => c.startsWith("poll")), w.calls.join(" | "));
  }

  console.log("── collecting placed orders together");
  {
    const w = fakeDeps({ readiness: { "001": 1, "002": "drop", "005": "fail" } });
    const orders: PlacedOrder[] = [
      { requestId: "a", packs: [P.PITCH_EAVE], completeAddress: "x" },
      { requestId: "b", packs: [P.ROOF_AREA], completeAddress: "x" },
      { requestId: "c", packs: [P.PROPERTY_DETAILS], completeAddress: "x" },
    ];
    for (const o of orders) { w.ledger[o.requestId] = { packs: o.packs.map((p) => p.slice(-3)), status: "pending" }; }
    // the fake keys readiness by packs; teach it these ids
    (w.deps as unknown as { poll: OrderDeps["poll"] }).poll = async (requestId, _i, _a, onRaw) => {
      w.asks[requestId] = (w.asks[requestId] ?? 0) + 1;
      const o = orders.find((x) => x.requestId === requestId)!;
      const need = w.deps ? ({ a: "drop", b: 1, c: "fail" } as Record<string, number | "drop" | "fail">)[requestId] : 1;
      if (need === "fail") throw new Error("Property Data request failed");
      if (need === "drop" && w.asks[requestId] === 1) throw new Error("socket hang up");
      onRaw("{}");
      return answerFor(requestId, o.packs);
    };
    const c = await collectPlacedOrders(orders, input, w.deps, 10_000);
    check("the area order lands first in the outcome", c.landed[0]?.order.requestId === "b", c.landed.map((l) => l.order.requestId).join(","));
    check("a transport error is not a verdict: the order is asked again and lands", c.landed.some((l) => l.order.requestId === "a") && w.asks.a === 2);
    check("EagleView's failure verdict closes the order as failed", c.failed.map((o) => o.requestId).join() === "c" && w.ledger.c.status === "failed");
    check("nothing is left pending", c.pending.length === 0);
  }

  console.log("── collecting until the area: the pending-collect of a plain click");
  {
    const orders: PlacedOrder[] = [
      { requestId: "a", packs: [P.PITCH_EAVE], completeAddress: "x" },
      { requestId: "b", packs: [P.ROOF_AREA], completeAddress: "x" },
      { requestId: "c", packs: [P.PROPERTY_DETAILS], completeAddress: "x" },
    ];
    const w = fakeDeps({ readiness: {} });
    const need: Record<string, number> = { a: 50, b: 3, c: 50 };
    (w.deps as unknown as { poll: OrderDeps["poll"] }).poll = async (requestId, _i, _a, onRaw) => {
      w.asks[requestId] = (w.asks[requestId] ?? 0) + 1;
      if (w.asks[requestId] < need[requestId]) return null;
      onRaw("{}");
      return answerFor(requestId, orders.find((x) => x.requestId === requestId)!.packs);
    };
    const c = await collectPlacedOrders(orders, input, w.deps, 45_000, { untilPack: P.ROOF_AREA });
    check("the wait ends the moment the area lands", c.landed.map((l) => l.order.requestId).join() === "b" && w.asks.b === 3, JSON.stringify(w.asks));
    check("the others are left pending, asked only while the area was open", c.pending.map((o) => o.requestId).join() === "a,c" && w.asks.a <= 3 && w.asks.c <= 3, JSON.stringify(w.asks));
    const w0 = fakeDeps({ readiness: {} });
    (w0.deps as unknown as { poll: OrderDeps["poll"] }).poll = async (requestId) => { w0.asks[requestId] = (w0.asks[requestId] ?? 0) + 1; return null; };
    const c0 = await collectPlacedOrders(orders, input, w0.deps, 0);
    check("a budget of 0 is one round: each order asked once, nothing waited for", c0.pending.length === 3 && Object.values(w0.asks).every((n) => n === 1), JSON.stringify(w0.asks));
  }

  console.log("── the report and the roof test");
  {
    const r = packReport([P.ROOF_AREA], [P.ROOF_AGE], [P.MATERIAL_CONDITION], [], [P.PITCH_EAVE, P.ROOF_AREA]);
    check("pending never overlaps have; the rest is missing", short(r.have) === "001" && short(r.pending ?? []) === "002" && short(r.denied) === "004" && short(r.failed) === "003" && short(r.missing) === "005,007,008", JSON.stringify(r));
    check("no pending → no pending key (rows saved before it stay readable)", !("pending" in packReport([P.ROOF_AREA], [], [])));
    check("an answer with a structure that has an area is a roof", hasRoof(answerFor("x", [P.ROOF_AREA])));
    check("an answer with no structures is not", !hasRoof({ ...answerFor("x", [P.ROOF_AREA]), structures: [] }));
    check("an answer whose structures carry no area is not either", !hasRoof(answerFor("x", [P.PITCH_EAVE])));
    check("PD_DIAGRAM_PACKS is the seven the planner orders", PD_DIAGRAM_PACKS.length === 7);
  }

  // ── pricing rules ──────────────────────────────────────────────────────
  const L = BUILTIN_LISTS;
  const house = (over: Partial<RoofFacts> = {}): RoofFacts => ({
    squares: 25, squaresBasis: "measured", pitchFamilies: [{ pitch12: 6, share: 1 }], pitchBasis: "measured", perimeterFt: 200, footprintSqft: 2200,
    chimney: true, rooftopAcCount: 0, shape: "Gable", facetCount: 4, measured: null, existingMaterial: "Asphalt shingle", facetConfidence: null, buildingUse: null, ...over,
  });

  console.log("── a hand takeoff has edges");
  {
    const manual = house({ squaresBasis: "entered", pitchBasis: "entered", perimeterFt: null, footprintSqft: null, shape: null, facetCount: null, chimney: null, rooftopAcCount: null, existingMaterial: null });
    const e = estimateEdges(manual);
    check("squares + pitch alone give an edge estimate", !!e && e.eaveFt > 0 && e.rakeFt > 0, JSON.stringify(e));
    // plan area 2500 / √1.25 = 2236; perimeter 4·√2236·1.05 = 198.6
    check("…from the plan area the pitch implies", !!e && near(e.eaveFt + e.rakeFt / Math.sqrt(1.25), 198.6, 0.03), `${e?.eaveFt} + ${e?.rakeFt}`);
    const pkg = buildRoofPackage(defaultSpec(manual, L), manual);
    check("so the package prices drip edge, starter, cap and a ridge vent", has(pkg, /Drip edge/) && has(pkg, /Starter strip/) && has(pkg, /Hip & ridge cap/) && has(pkg, /Ridge vent/), [...pkg.materials].map((l) => l.name).join(" | "));
    check("and every quantity is finite", [...pkg.materials, ...pkg.labor].every((l) => Number.isFinite(l.quantity) && Number.isFinite(l.unitPrice)));
    const flatManual = house({ squaresBasis: "entered", pitchFamilies: [{ pitch12: 0.5, share: 1 }], perimeterFt: null, footprintSqft: null, shape: null, existingMaterial: null });
    const ef = estimateEdges(flatManual);
    check("a flat hand takeoff: all perimeter, no rake, no ridge", !!ef && ef.rakeFt === 0 && ef.ridgeFt === 0 && ef.hipFt === 0 && near(ef.eaveFt, 4 * Math.sqrt(2500) * 1.05, 0.01), JSON.stringify(ef));
  }

  console.log("── rakes and hips run up the slope");
  {
    const g6 = estimateEdges(house())!;
    const g0 = estimateEdges(house({ pitchFamilies: [{ pitch12: 0.01, share: 1 }], shape: "Gable" }))!;
    // isFlatRoof treats ≤ ~2/12 as flat; compare instead against a shallow steep pitch of 3/12 scaled back
    const g3 = estimateEdges(house({ pitchFamilies: [{ pitch12: 3, share: 1 }] }))!;
    check("a gable's rakes grow with the pitch", g6.rakeFt > g3.rakeFt && near(g6.rakeFt / g3.rakeFt, Math.sqrt(1 + 0.25) / Math.sqrt(1 + 0.0625), 0.01), `${g6.rakeFt} vs ${g3.rakeFt}`);
    check("its eave and ridge do not", g6.eaveFt === g3.eaveFt && g6.ridgeFt === g3.ridgeFt);
    void g0;
    const h6 = estimateEdges(house({ shape: "Hip" }))!;
    const h3 = estimateEdges(house({ shape: "Hip", pitchFamilies: [{ pitch12: 3, share: 1 }] }))!;
    check("a hip's hips grow with the pitch by √(2+t²)/√2", near(h6.hipFt / h3.hipFt, Math.sqrt(2 + 0.25) / Math.sqrt(2 + 0.0625), 0.01), `${h6.hipFt} vs ${h3.hipFt}`);
    check("a hip roof has no rake", h6.rakeFt === 0);
  }

  console.log("── tear-off and disposal follow what is on the roof");
  {
    for (const [word, fam] of [["Tile", "tile"], ["Slate", "slate"], ["Metal", "metal"], ["Wood shake", "shake"], ["Asphalt shingle", "asphalt"]] as const) {
      const spec = defaultSpec(house({ existingMaterial: word }), L);
      const want = EXISTING_STEEP[fam];
      check(`${word}: $${want.tearOff} tear-off + $${want.disposal} disposal per square`, spec.tearOffPerSqLayer === want.tearOff && spec.disposalPerSqLayer === want.disposal, `${spec.tearOffPerSqLayer}/${spec.disposalPerSqLayer}`);
    }
    check("unknown material keeps the shingle rates", tearOffRatesFor(null).tearOff === 55 && tearOffRatesFor("Unknown").disposal === 28);
    check("a membrane keeps the shingle rates on the steep path (the flat path has its own)", tearOffRatesFor("TPO").tearOff === 55);
    const tilePkg = buildRoofPackage(defaultSpec(house({ existingMaterial: "Tile" }), L), house({ existingMaterial: "Tile" }));
    check("the tile tear-off line says so and the assumption explains the rate", has(tilePkg, /Tear-off · tile/) && tilePkg.assumptions.some((a) => /tile rates \(\$120 \+ \$75/.test(a)), tilePkg.assumptions.join(" | "));
    const asphaltPkg = buildRoofPackage(defaultSpec(house(), L), house());
    check("the shingle tear-off line reads as before", has(asphaltPkg, /^Tear-off · 1 layer$/));
  }

  console.log("── fascia: replaced with the roof, with the gutters that hang on it");
  {
    const facts = house();
    const spec = defaultSpec(facts, L);
    check("a tear-off opens with the fascia in", spec.fasciaOn && spec.fasciaRun === "eaves" && spec.gutterPlan === "reset");
    const pkg = buildRoofPackage(spec, facts);
    const fasciaMat = [...pkg.materials].find((l) => /^Fascia ·/.test(l.name));
    const fasciaLab = [...pkg.labor].find((l) => /^Fascia ·/.test(l.name));
    check("it prices along the eaves, material and labor", !!fasciaMat && !!fasciaLab && near(fasciaMat.quantity, spec.eaveFt, 0.01) && near(fasciaLab.quantity, spec.eaveFt, 0.01), `${fasciaMat?.name} ${fasciaMat?.quantity}`);
    check("…at the board's own two rates", fasciaMat?.unitPrice === FASCIA_OPTIONS[0].perFt && fasciaLab?.unitPrice === FASCIA_OPTIONS[0].laborPerFt);
    const reset = [...pkg.labor].find((l) => /Gutters · detach & reset/.test(l.name));
    check("the gutters come off and go back on, at the eave length", !!reset && near(reset.quantity, spec.eaveFt, 0.01));
    check("no new gutter is charged for a reset", !has(pkg, /Gutter · 6 in seamless/));
    check("the scope and the assumptions say so", pkg.scope.some((t) => /Replace the fascia board/.test(t)) && pkg.assumptions.some((t) => /Rotten rafter tails/.test(t)));

    const rakes = buildRoofPackage({ ...spec, fasciaRun: "eaves_rakes" }, facts);
    const rakeMat = [...rakes.materials].find((l) => /^Fascia ·/.test(l.name));
    check("eaves + rakes prices the whole perimeter", !!rakeMat && near(rakeMat.quantity, spec.eaveFt + spec.rakeFt, 0.01), String(rakeMat?.quantity));
    const own = buildRoofPackage({ ...spec, fasciaRun: "custom", fasciaFt: 64 }, facts);
    check("a typed length wins and reads as entered", [...own.materials].some((l) => /^Fascia ·/.test(l.name) && l.quantity === 64 && l.basis === "entered"));

    const newGutters = buildRoofPackage({ ...spec, gutterPlan: "replace" }, facts);
    check("replacing gutters prices the gutter and hanging it", has(newGutters, /Gutter · 6 in seamless/) && [...newGutters.labor].some((l) => /Gutters · remove old & hang new/.test(l.name)) && ![...newGutters.labor].some((l) => /detach & reset/.test(l.name)));
    const noGutters = buildRoofPackage({ ...spec, gutterPlan: "none" }, facts);
    check("a house with no gutters is charged for none", !has(noGutters, /Gutter/) && ![...noGutters.labor].some((l) => /Gutters/.test(l.name)));

    const wrap = FASCIA_OPTIONS.find((f) => f.wrap);
    const wrapped = buildRoofPackage({ ...spec, fasciaOptionId: wrap?.id ?? "wrap", fasciaPerFt: wrap?.perFt ?? 3, fasciaLaborPerFt: wrap?.laborPerFt ?? 4 }, facts);
    check("a wrap covers the board instead of replacing it", [...wrapped.labor].some((l) => /Fascia · wrap over existing/.test(l.name)) && wrapped.assumptions.some((t) => /existing board stays/.test(t)));

    const off = buildRoofPackage({ ...spec, fasciaOn: false }, facts);
    check("off prices nothing and says it is only reachable now", !has(off, /Fascia/) && ![...off.labor].some((l) => /Fascia|Gutters/.test(l.name)) && off.assumptions.some((t) => /only reachable while the roof is off/.test(t)));
    check("a flat roof carries no fascia of its own", !flattenForLowSlope(spec).fasciaOn);
  }

  console.log("── intake covers the exhaust");
  {
    const spec = defaultSpec(house(), L);
    const ridge = spec.vents.find((v) => v.id === "ridge")!;
    const soffit = spec.vents.find((v) => v.id === "soffit16x8")!;
    const ridgeSqIn = ridge.qty * VENT_TYPES.find((v) => v.id === "ridge")!.nfaSqIn;
    check("the default soffit count takes in at least what the ridge lets out", soffit.qty * 56 >= ridgeSqIn, `${soffit.qty} × 56 vs ${ridgeSqIn.toFixed(0)}`);
    const v = checkVentilation(spec, house())!;
    check("…and the default package is balanced", v.ok && v.intakeSqIn >= v.exhaustSqIn * 0.95, JSON.stringify(v));
    const starved = { ...spec, vents: [ridge, { ...soffit, qty: 2 }] };
    const v2 = checkVentilation(starved, house())!;
    check("two soffit vents under a long ridge is not balanced", !v2.ok, JSON.stringify(v2));
    const big = defaultSpec(house({ footprintSqft: 4000, perimeterFt: 280 }), L);
    const vb = checkVentilation(big, house({ footprintSqft: 4000, perimeterFt: 280 }))!;
    check("a big attic still gets its half-requirement of intake", vb.intakeSqIn >= vb.requiredSqIn / 2 && vb.ok, JSON.stringify(vb));
  }

  console.log("── starter and fasteners per family");
  {
    check("starter: asphalt, synthetic, shake", takesStarter("asphalt") && takesStarter("synthetic") && takesStarter("shake") && !takesStarter("tile") && !takesStarter("slate") && !takesStarter("metal") && !takesStarter("low-slope"));
    const tile = house({ existingMaterial: "Tile" });
    const tilePkg = buildRoofPackage(defaultSpec(tile, L), tile);
    check("a tile package carries no shingle starter", !has(tilePkg, /Starter strip/));
    check("…but an eave riser along the eaves", !!line(tilePkg, /Eave riser/) && near(line(tilePkg, /Eave riser/)!.quantity, estimateEdges(tile)!.eaveFt, 0.01));
    check("…and its fasteners are clips and hooks", has(tilePkg, /Fasteners · nails, clips & hooks/));
    check("its scope names the riser, not starter", tilePkg.scope.some((s) => /eave riser/.test(s)) && !tilePkg.scope.some((s) => /starter/.test(s)));
    const metal = house({ existingMaterial: "Metal" });
    const metalPkg = buildRoofPackage(defaultSpec(metal, L), metal);
    check("a metal package: eave trim, screws and clips, no starter", has(metalPkg, /Eave trim & closures/) && has(metalPkg, /screws, clips & closures/) && !has(metalPkg, /Starter strip/));
    check("fastener names", fastenersName("asphalt") === "Roofing nails & fasteners" && fastenersName("slate") === "Fasteners · nails, clips & hooks");
    const asphaltPkg = buildRoofPackage(defaultSpec(house(), L), house());
    check("an asphalt package keeps its starter strip and nails", has(asphaltPkg, /Starter strip/) && has(asphaltPkg, /Roofing nails/) && !has(asphaltPkg, /Eave riser|Eave trim/));
  }

  console.log("── the height of the work");
  {
    check("storey factor: 1 for one storey or unknown, 8% for two, 15% for three", storeyLaborFactor(null) === 1 && storeyLaborFactor(1) === 1 && storeyLaborFactor(2) === 1.08 && storeyLaborFactor(3) === 1.15);
    const one = buildRoofPackage(defaultSpec(house({ storeys: 1 }), L), house({ storeys: 1 }));
    const two = buildRoofPackage(defaultSpec(house({ storeys: 2 }), L), house({ storeys: 2 }));
    const i1 = line(one, /^Install ·/)!;
    const i2 = line(two, /^Install ·/)!;
    check("two storeys: install labor carries the factor and says so", near(i2.unitPrice, Math.round(i1.unitPrice * 1.08), 0.01) && /2-storey/.test(i2.name), `${i1.unitPrice} → ${i2.unitPrice} · ${i2.name}`);
    check("…with an assumption line", two.assumptions.some((a) => /20 ft \(2 storeys\).*8% height factor/.test(a)), two.assumptions.join(" | "));
    check("one storey: no factor, no word", !/storey/.test(i1.name) && !one.assumptions.some((a) => /height factor/.test(a)));
  }

  console.log("── basis words and saved lists");
  {
    const spec = defaultSpec(house(), L);
    const pkg = buildRoofPackage(spec, house());
    check("the chimney kit is 'measured' while the count is the data's", line(pkg, /Chimney flashing kit/)?.basis === "measured");
    const pkg2 = buildRoofPackage({ ...spec, chimneyCount: 2 }, house());
    check("…and 'entered' once the contractor changed the count", line(pkg2, /Chimney flashing kit/)?.basis === "entered");
    const measured = house({ measured: { reportId: 7, eaveFt: 120, rakeFt: 60, ridgeFt: 50, hipFt: 0, valleyFt: 84, stepFlashFt: 0 } });
    const mpkg = buildRoofPackage(defaultSpec(measured, L), measured);
    check("a measured valley total reads as a total, not '1 valley at 84 ft'", mpkg.assumptions.some((a) => /^Valleys: 84 ft in total — measured/.test(a)), mpkg.assumptions.find((a) => /alley/.test(a)) ?? "");
    const est = buildRoofPackage(defaultSpec(house({ facetCount: 8 }), L), house({ facetCount: 8 }));
    check("an estimated valley count still reads as a count", est.assumptions.some((a) => /^\d+ valleys? at [\d,.]+ ft — estimated/.test(a)), est.assumptions.find((a) => /alley/.test(a)) ?? "");
    const old = saneLists({ systems: [{ id: "architectural", label: "Arch", family: "asphalt", matPerSq: 100, laborPerSq: 90 }], underlayments: [{ id: "synthetic", label: "Syn", perSq: 20 }] });
    const sys = old?.systems.find((s) => s.id === "architectural");
    check("a saved system without wastePct / capPerFt gets the built-in row's", !!sys && sys.wastePct === L.systems.find((s) => s.id === "architectural")!.wastePct && sys.capPerFt === L.systems.find((s) => s.id === "architectural")!.capPerFt, JSON.stringify(sys));
    const custom = saneLists({ systems: [{ id: "my_own", label: "Mine", family: "asphalt", matPerSq: 100, laborPerSq: 90 }], underlayments: [{ id: "synthetic", label: "Syn", perSq: 20 }] });
    const mine = custom?.systems.find((s) => s.id === "my_own");
    check("a contractor's own row gets plain defaults (10% waste, no cap)", !!mine && mine.wastePct === 10 && mine.capPerFt === 0, JSON.stringify(mine));
    if (custom) {
      const built = buildRoofPackage(defaultSpec(house({ existingMaterial: null }), custom), house({ existingMaterial: null }));
      check("…and a package on it has no NaN", [...built.materials, ...built.labor].every((l) => Number.isFinite(l.quantity * l.unitPrice)));
    }
  }

  console.log("── plywood replacement, said plainly (owner, 2026-10-13)");
  {
    const facts = house();
    const base = defaultSpec(facts, L);
    const lines = (p: RoofPackage) => [...p.materials, ...p.labor].filter((l) => /^Plywood replacement/.test(l.name));
    check("a new roof quotes the plywood rate by default, and prices none", base.plywoodQuote === true && lines(buildRoofPackage(base, facts)).length === 0);
    const r = plywoodRate(base);
    const quoted = buildRoofPackage(base, facts);
    const sentence = quoted.scope.find((s) => /Damaged decking found once the old roof is off/.test(s)) ?? "";
    check("…the client reads the rate per sheet AND per sq ft, installed, not in the price", sentence.includes(`per 4x8 sheet`) && sentence.includes("per sq ft") && /not in the price above/.test(sentence) && Math.abs(r.sqft - r.sheet / 32) < 0.011, sentence);
    check("…and the contractor's notes say it is not in the total", quoted.assumptions.some((a) => /Deck replacement is not in the total: the proposal quotes ½ in CDX plywood/.test(a)));
    check("an overlay (no tear-off) quotes no plywood rate — the deck stays covered", !buildRoofPackage({ ...base, tearOffLayers: 0 }, facts).scope.some((s) => /decking/.test(s)));
    check("Leave it out: no lines, no sentence", (() => { const p = buildRoofPackage({ ...base, plywoodQuote: false }, facts); return lines(p).length === 0 && !p.scope.some((s) => /decking/.test(s)); })());
    const six = buildRoofPackage({ ...base, plywoodSheets: 6 }, facts);
    const six6 = lines(six);
    check("6 sheets known: plywood and fitting lines, 6 each at the sheet prices", six6.length === 2 && six6.every((l) => l.quantity === 6 && l.unit === "each") && six6.some((l) => l.unitPrice === base.plywoodEach) && six6.some((l) => l.unitPrice === base.plywoodLabor), JSON.stringify(six6.map((l) => [l.name, l.quantity, l.unit, l.unitPrice])));
    check("…the client reads what is included and the rate for any more", six.scope.some((s) => /6 sheets \(192 sq ft\) included/.test(s)) && six.scope.some((s) => /Any more damaged decking/.test(s)));
    const sq = buildRoofPackage({ ...base, plywoodUnit: "sqft", plywoodSqft: 100 }, facts);
    const sq2 = lines(sq);
    check("100 sq ft known: priced by the sq ft at the sheet price / 32", sq2.length === 2 && sq2.every((l) => l.quantity === 100 && l.unit === "sq ft") && Math.abs(sq2.reduce((a, l) => a + l.quantity * l.unitPrice, 0) - 100 * r.sqft) < 0.01, JSON.stringify(sq2.map((l) => [l.quantity, l.unitPrice])));
    check("…and says about how many sheets that is", sq.scope.some((s) => /100 sq ft \(about 3\.1 sheets\) included/.test(s)));
    check("a count without the quote: the count only", (() => { const p = buildRoofPackage({ ...base, plywoodSheets: 2, plywoodQuote: false }, facts); return p.scope.some((s) => /2 sheets/.test(s)) && !p.scope.some((s) => /Any more/.test(s)); })());
    // What it is replaced with — kind, thickness, sheet size (owner, 2026-10-13).
    check("the decking list: unique boards, each with its two starting prices", new Set(DECK_BOARDS.map((b) => b.id)).size === DECK_BOARDS.length && DECK_BOARDS.every((b) => b.each > 0 && b.labor > 0 && /in /.test(b.label)));
    check("a new roof patches with ½ in CDX plywood, 4 × 8, at the prices it always had", base.plywoodBoardId === "cdx_12" && base.plywoodSize === "4x8" && base.plywoodEach === 42 && base.plywoodLabor === 35);
    check("…and the client reads the board by name", sentence.includes("½ in CDX plywood at $77 per 4x8 sheet"), sentence);
    const osb = buildRoofPackage({ ...base, plywoodBoardId: "osb_716", plywoodEach: 24, plywoodSheets: 4 }, facts);
    const osbLines = [...osb.materials, ...osb.labor].filter((l) => /replacement/.test(l.name) && /deck/i.test(l.name));
    check("OSB is called roof decking, not plywood, on the lines", osbLines.length === 2 && osbLines.some((l) => l.name === "Roof deck replacement (damaged decking) · 7/16 in OSB, 4 × 8 ft sheets") && !osbLines.some((l) => /^Plywood/.test(l.name)), osbLines.map((l) => l.name).join(" | "));
    check("…and in the client's words", osb.scope.some((s) => s === "Replace damaged roof decking with 7/16 in OSB — 4 sheets (128 sq ft) included."), osb.scope.find((s) => /OSB/.test(s)) ?? "");
    const big = { ...base, plywoodSize: "4x10" as const, plywoodEach: 52.5, plywoodLabor: 43.75 };
    const bigR = plywoodRate(big);
    const bigP = buildRoofPackage({ ...big, plywoodSheets: 3 }, facts);
    check("a 4 × 10 sheet: 40 sq ft each, priced the same by the sq ft", bigR.sheet === 96.25 && bigR.sqft === 2.4 && bigP.scope.some((s) => /3 sheets \(120 sq ft\) included/.test(s)) && bigP.scope.some((s) => /per 4x10 sheet/.test(s)), JSON.stringify(bigR));
    const flat = house({ pitchFamilies: [{ pitch12: 0.5, share: 1 }], shape: "Flat", facetCount: 1, existingMaterial: "Flat", squares: 22, footprintSqft: 2200, perimeterFt: 196 });
    const fs = defaultSpec(flat, L);
    const fp = buildRoofPackage({ ...fs, tearOffLayers: 1 }, flat);
    check("a flat roof torn off quotes the rate too", fp.scope.some((s) => /Damaged decking found once the old roof is off/.test(s)), fp.scope.join(" | "));
  }

  console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
  process.exit(bad ? 1 : 0);
})();
