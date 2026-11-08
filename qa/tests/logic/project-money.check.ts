// WHO IT IS FOR, AND THE MONEY — the pure core (2026-11-07, part 5 of the plan "Projects: Remodel and New
// construction"): the settings read tolerantly and their words, the price a cost budget implies, the budget laid out
// over the phases to the dollar, a phase's heading-for (60% done and 80% spent is over before it is late), the totals
// and the margin at this pace, the advisor's rules and their order. Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/project-money.check.ts
import "../_lib/_server-only";
import { advise, defaultMode, headlineWords, layoutPhaseBudgets, marginAtPace, moneyTotals, parseMoneySettings, phaseHeading, phaseMoney, priceFromCost, settingsWords, type MoneySettings, type PhaseMoney } from "../../../src/lib/projectMoneyPlan/shared";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}

// ── the settings ──
const client: MoneySettings = { forWhom: "CLIENT", moneyMode: "PROJECT_MARGIN", marginPct: 18, feeAmount: null, salePrice: null };
const self: MoneySettings = { forWhom: "SELF", moneyMode: "NONE", marginPct: null, feeAmount: null, salePrice: 780_000 };
check("settings: read tolerantly — odd values are a client build with no mode; one's own build never has a mode", parseMoneySettings(null).forWhom === "CLIENT" && parseMoneySettings(null).moneyMode === "NONE" && parseMoneySettings({ forWhom: "SELF", moneyMode: "COST_PLUS", marginPct: -3, salePrice: 780000 }).moneyMode === "NONE" && parseMoneySettings({ forWhom: "SELF", marginPct: -3 }).marginPct === null && parseMoneySettings({ forWhom: "CLIENT", moneyMode: "COST_PLUS", feeAmount: 45000 }).feeAmount === 45000 && defaultMode("CLIENT") === "PROJECT_MARGIN" && defaultMode("SELF") === "NONE");
check("settings: the words", settingsWords(client) === "for a client · one margin on the whole project, 18%" && settingsWords(self) === "for yourself · sale price $780,000" && settingsWords({ ...client, moneyMode: "COST_PLUS", feeAmount: 45000 }) === "for a client · cost-plus, a $45,000 fee" && settingsWords({ ...self, salePrice: null }) === "for yourself · a cost tracker", settingsWords(client));
check("price: the cost plus the margin, the cost plus the fee, nothing on one's own build", priceFromCost(400_000, client) === 472_000 && priceFromCost(400_000, { ...client, moneyMode: "COST_PLUS", feeAmount: 45_000 }) === 445_000 && priceFromCost(400_000, { ...client, moneyMode: "COST_PLUS", marginPct: 12, feeAmount: null }) === 448_000 && priceFromCost(400_000, self) === null && priceFromCost(400_000, { ...client, marginPct: null }) === null);

// ── the budget laid out ──
const shares = [{ id: "a", share: 0.02 }, { id: "b", share: 0.05 }, { id: "c", share: 0.05 }, { id: "d", share: 0.08 }, { id: "e", share: 0.1 }, { id: "f", share: 0.2 }, { id: "g", share: 0.14 }, { id: "h", share: 0.08 }, { id: "i", share: 0.25 }, { id: "j", share: 0.03 }];
const laid = layoutPhaseBudgets(412_345, shares);
check("layout: the total split by the shares, to the dollar", laid.reduce((n, x) => n + x.budget, 0) === 412_345 && laid.find((x) => x.id === "f")!.budget === 82_469 && laid.every((x) => Number.isInteger(x.budget)), laid);
const kept = layoutPhaseBudgets(100_000, [{ id: "a", share: 0.5, budget: 30_000 }, { id: "b", share: 0.25 }, { id: "c", share: 0.25 }], { keep: true });
check("layout: a phase with a budget of its own keeps it; the rest shares what is left", kept.map((x) => x.budget).join(",") === "30000,35000,35000", kept);

// ── a phase's money ──
const pm = (status: PhaseMoney["status"], budget: number, spent: number, committed: number, done: number) => phaseMoney({ id: "x", name: "Framing", status, budget, spent, committed, done });
check("heading: done = what it cost; planned = the budget (or more once something is on it); 60% done and 80% spent heads for 133%", phaseHeading({ status: "DONE", budget: 100, spent: 90, committed: 0, done: 1 }) === 90 && phaseHeading({ status: "PLANNED", budget: 100, spent: 0, committed: 0, done: 0 }) === 100 && phaseHeading({ status: "PLANNED", budget: 100, spent: 40, committed: 70, done: 0 }) === 110 && phaseHeading({ status: "ACTIVE", budget: 100, spent: 80, committed: 0, done: 0.6 }) === 133.33 && phaseHeading({ status: "ACTIVE", budget: 100, spent: 5, committed: 0, done: 0.05 }) === 100 && phaseHeading({ status: "ACTIVE", budget: 100, spent: 30, committed: 0, done: 0.5 }) === 60, {
  a: phaseHeading({ status: "ACTIVE", budget: 100, spent: 80, committed: 0, done: 0.6 }),
});
const framing = pm("ACTIVE", 80_000, 50_000, 14_000, 0.6);
check("phase: left and over", framing.left === 16_000 && framing.headingFor === 106_666.67 && framing.over === 26_666.67, framing);
const phases: Array<PhaseMoney & { key: string }> = [
  { ...pm("DONE", 10_000, 8_000, 0, 1), id: "land", key: "LAND", name: "Land and feasibility" },
  { ...framing, id: "frame", key: "FRAME" },
  { ...pm("PLANNED", 30_000, 0, 0, 0), id: "shop", key: "SHOP", name: "Shop" },
];
const totals = moneyTotals(phases, { budget: 5_000, spent: 6_000, committed: 0 });
check("totals: the phases plus what is on no phase; heading-for never under the loose spend", totals.budget === 125_000 && totals.spent === 64_000 && totals.committed === 14_000 && totals.left === 47_000 && totals.headingFor === 150_666.67 && totals.over === 25_666.67, totals);
check("margin at this pace: the contract less the heading-for; nothing without a contract", marginAtPace(180_000, totals.headingFor)?.amount === 29_333.33 && marginAtPace(180_000, totals.headingFor)?.pct === 16.3 && marginAtPace(null, 1) === null && marginAtPace(0, 1) === null);
check("headline: over by, where; on budget", /^Over by \$25,667 at this pace — framing$/.test(headlineWords(totals, phases)) && headlineWords({ budget: 100, spent: 10, committed: 0, left: 90, headingFor: 95, over: -5 }, []) === "On budget — heading for $95 of $100" && headlineWords({ ...totals, budget: 0 }, []) === "No budget laid out yet", headlineWords(totals, phases));

// ── the advisor ──
const advice = advise({
  settings: client,
  totals,
  phases,
  selections: [
    { id: "cab", name: "Cabinets", allowance: 20_000, chosen: false, price: null, cheaper: 16_500, phaseName: "Finishes" },
    { id: "tile", name: "Tile", allowance: 6_000, chosen: false, price: null, cheaper: null, phaseName: "Finishes" },
    { id: "light", name: "Lighting", allowance: 3_000, chosen: true, price: 4_200, cheaper: null, phaseName: "Finishes" },
  ],
  quotes: [{ id: "q1", stageId: "s1", stageName: "Framing", contractor: "Ridge Framing", amount: 52_000, line: 48_000, status: "AWARDED", trade: "Carpentry" }, { id: "q2", stageId: "s2", stageName: "Rough-ins", contractor: "Flow Plumbing", amount: 20_000, line: 24_000, status: "AWARDED", trade: "Plumbing" }],
  swaps: [{ id: "m1", name: "Decking", total: 9_000, cheaperTotal: 7_200, store: "Lumber Yard" }],
  selfPerform: [{ phaseId: "shop", phaseName: "Shop", bid: 30_000, crew: 22_000, hours: 400, rate: 55 }],
  contingency: { budget: 12_000, spent: 2_000 },
});
const kinds = advice.map((a) => a.kind);
check("advisor: the client's own overrun comes first as a change order, then the rules by dollars saved", kinds[0] === "change_order" && advice[0].saves === 1_200 && kinds.slice(1).join(",") === "defer_scope,move_contingency,self_perform,rebid_sub,lower_allowance,move_contingency,swap_material,lower_allowance", kinds);
check("advisor: the numbers — the shop's budget, the crew against the bid, the award over the line, the proposal's cheaper cabinets, a tier down on the tile, the contingency left, the slack, the swap", advice.find((a) => a.kind === "defer_scope")!.saves === 30_000 && advice.find((a) => a.kind === "self_perform")!.saves === 8_000 && advice.find((a) => a.kind === "rebid_sub")!.saves === 4_000 && advice.filter((a) => a.kind === "lower_allowance")[0].saves === 3_500 && advice.filter((a) => a.kind === "lower_allowance")[1].saves === 900 && advice.filter((a) => a.kind === "move_contingency")[0].saves === 10_000 && advice.filter((a) => a.kind === "move_contingency")[1].saves === 2_000 && advice.find((a) => a.kind === "swap_material")!.saves === 1_800, advice.map((a) => `${a.kind}:${a.saves}`));
check("advisor: only one award is over its line; the plumber under the line is left alone", advice.filter((a) => a.kind === "rebid_sub").length === 1 && /Ridge Framing is \$4,000 over the line/.test(advice.find((a) => a.kind === "rebid_sub")!.title));
check("advisor: one's own build gets no change order; the rest holds", !advise({ settings: self, totals, phases, selections: [{ id: "light", name: "Lighting", allowance: 3_000, chosen: true, price: 4_200, cheaper: null, phaseName: null }], quotes: [], swaps: [], selfPerform: [], contingency: null }).some((a) => a.kind === "change_order"));
check("advisor: which ones a tap applies", advice.filter((a) => a.tap).map((a) => a.kind).sort().join(",") === "defer_scope,lower_allowance,lower_allowance,move_contingency,rebid_sub", advice.filter((a) => a.tap).map((a) => a.kind));

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
