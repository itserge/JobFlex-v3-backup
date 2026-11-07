// Regression check for resolveSchedule with change orders (tsx, no framework):
//   npx tsx qa/tests/logic/paymentSchedule.check.ts
// A $10,000 proposal, 30% deposit paid, 70% completion; a $1,080 change order
// approved as its own stage. The completion stage must stay $7,000 (70% of the
// ORIGINAL), the change order $1,080, and paying the completion stage must
// not waive the change order.
import { applyUnitToggle, resolveSchedule, scheduleCoverage, unitTogglePatches } from "../../../src/lib/paymentSchedule";
import { contractSchedule } from "../../../src/lib/contractTotal";

let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log("ok  ", name);
  else {
    failed += 1;
    console.log("FAIL", name, detail ?? "");
  }
}

const cos = [{ status: "APPROVED", total: 1080 }];
const stages = [
  { id: "dep", label: "Deposit", amount: 30, isPercent: true, position: 0, status: "PAID", paidAmount: 3000 },
  { id: "done", label: "Completion", amount: 70, isPercent: true, position: 1, status: "UNPAID" },
  { id: "co", label: "Change order #1 · Plywood", amount: 1080, isPercent: false, position: 2, status: "UNPAID", changeOrderId: "co1" },
];
const s = resolveSchedule({ ...contractSchedule(10000, cos), currency: "USD", installments: stages });
check("contract total is original + change order", s.totalMinor === 1108000, s.totalMinor);
check("completion is 70% of the ORIGINAL", s.stages.find((x) => x.id === "done")?.amountMinor === 700000, s.stages);
check("change-order stage keeps its full amount", s.stages.find((x) => x.id === "co")?.amountMinor === 108000);
check("remaining = completion + change order", s.remainingMinor === 808000, s.remainingMinor);
check("no mismatch, no balance row", s.mismatchMinor === 0 && !s.hasBalanceRow, { m: s.mismatchMinor, b: s.balanceMinor });

// Completion paid: the change order is still owed — settle must not waive it.
const afterDone = resolveSchedule({
  ...contractSchedule(10000, cos),
  currency: "USD",
  installments: stages.map((x) => (x.id === "done" ? { ...x, status: "PAID", paidAmount: 7000 } : x)),
});
check("after completion is paid the change order remains owed", afterDone.remainingMinor === 108000, afterDone.remainingMinor);
check("the change order is the next payable stage", afterDone.nextPayableId === "co");

// Implicit schedule: a proposal with only the materialized 100% stage plus a change order.
const implicit = resolveSchedule({
  ...contractSchedule(10000, cos),
  currency: "USD",
  installments: [
    { id: "full", label: "Full payment", amount: 100, isPercent: true, position: 0, status: "UNPAID" },
    { id: "co", label: "Change order #1", amount: 1080, isPercent: false, position: 1, status: "UNPAID", changeOrderId: "co1" },
  ],
});
check("full-payment stage stays the original 100%", implicit.stages[0].amountMinor === 1000000, implicit.stages[0]);
check("implicit + change order add up with no balance row", implicit.scheduledUnpaidMinor === 1108000 && !implicit.hasBalanceRow);

// A credit: no stage, contract shrinks, an overpaid contract shows remaining 0.
const credit = resolveSchedule({
  ...contractSchedule(10000, [{ status: "APPROVED", total: -500 }]),
  currency: "USD",
  installments: [{ id: "full", label: "Full payment", amount: 100, isPercent: true, position: 0, status: "PAID", paidAmount: 10000 }],
});
check("a credit lowers the contract total", credit.totalMinor === 950000, credit.totalMinor);
check("remaining never goes negative", credit.remainingMinor === 0);

// Legacy: an APPROVED row with no total is already folded into the proposal — not counted.
const legacy = resolveSchedule({ ...contractSchedule(11200, [{ status: "APPROVED", total: null }]), currency: "USD", installments: [] });
check("legacy approved change order is not double-counted", legacy.totalMinor === 1120000);

// THE %/$ TOGGLE ON A CONTRACT WITH AN APPROVED CHANGE ORDER (2026-09-19).
// The builder card measures coverage against the CONTRACT and converts the
// unit against the PROPOSAL — a "100%" stage is 100% of the proposal, because
// an approved change order raises what is owed without moving the split. When
// the toggle was handed the contract instead, the order was counted twice:
// $45,368 became $47,488 and a balanced schedule read "$2,120 more than the
// total".
{
  const sched = contractSchedule(45368, [{ status: "APPROVED", total: 2120 }]);
  check("contract is the proposal plus the order", sched.total === 47488, sched.total);
  check("the percent base stays the proposal", sched.pctBase === 45368, sched.pctBase);

  const rows = [
    { id: "full", amount: 100, isPercent: true },
    { id: "co", amount: 2120, isPercent: false },
  ];
  const patches = unitTogglePatches(rows, "full", false, sched.pctBase);
  check("100% converts to the proposal, not the contract", patches.length === 1 && patches[0].patch.amount === 45368, patches);

  const after = scheduleCoverage(applyUnitToggle(rows, "full", false, sched.pctBase), sched.total, sched.pctBase);
  check("and the schedule still covers the contract exactly", after.covered === 47488 && after.state === "exact", after);

  const wrong = scheduleCoverage(applyUnitToggle(rows, "full", false, sched.total), sched.total, sched.pctBase);
  check("converting against the contract would over-schedule", wrong.state === "over", wrong);
}

// 2026-11-06: a 30/40/30 schedule on $36,242.25, the deposit paid at its shown $10,872.68, then a $1,250 change
// order. Completion keeps its shown $10,872.67 and the change order is $1,250.00 — not $1,249.99.
{
  const r = resolveSchedule({
    total: 37492.25,
    pctBase: 36242.25,
    installments: [
      { id: "d", label: "Deposit", amount: 30, isPercent: true, position: 0, status: "PAID", paidAmount: 10872.68 },
      { id: "m", label: "Cabinets set", amount: 40, isPercent: true, position: 1, status: "UNPAID" },
      { id: "c", label: "On completion", amount: 30, isPercent: true, position: 2, status: "UNPAID" },
      { id: "co", label: "Change order #1", amount: 1250, isPercent: false, position: 3, status: "UNPAID" },
    ],
  });
  const by = Object.fromEntries(r.stages.map((s) => [s.id, s.amountMinor]));
  check("a paid deposit leaves the middle stage at $14,496.90", by.m === 1449690, by);
  check("…completion at its shown $10,872.67", by.c === 1087267, by);
  check("…the change order at $1,250.00", by.co === 125000, by);
  check("…and the schedule covers the contract exactly", r.balanceMinor === 0 && r.paidMinor + r.scheduledUnpaidMinor === r.totalMinor, r);
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
