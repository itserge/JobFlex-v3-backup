// DRAWS — the pure core (2026-11-07, part 6 of the plan "Projects: Remodel and New construction"): the usual five
// draws by the phase that releases each, a schedule read tolerantly, the dollars to the dollar, the retainage held and
// released at the final, where each draw stands against the phases (ready when its phase is closed and every
// inspection passed), the words, and the bundle a lender gets with a request. Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/project-draws.check.ts
import "../_lib/_server-only";
import { DEFAULT_DRAWS, DEFAULT_RETAINAGE_PCT, drawAmounts, drawPayout, drawWords, parseSchedule, parseSnapshot, readDraws, snapshotFrom, type DrawLike, type PhaseStateLike } from "../../../src/lib/projectDraws/shared";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}

// ── the schedule ──
check("schedule: five draws that sum to 100, the final last", DEFAULT_DRAWS.length === 5 && DEFAULT_DRAWS.reduce((n, d) => n + d.pct, 0) === 100 && DEFAULT_DRAWS[4].afterPhase === "FINAL" && DEFAULT_DRAWS[0].afterPhase === "PERMITS" && DEFAULT_RETAINAGE_PCT === 10);
check("schedule: read tolerantly — a bad set falls back to the usual five; a good one is kept", parseSchedule(null).length === 5 && parseSchedule([{ name: "A", afterPhase: "FRAME", pct: 60 }, { name: "B", afterPhase: "FINAL", pct: 30 }]).length === 5 && parseSchedule([{ name: "Half", afterPhase: "FRAME", pct: 50 }, { name: "Rest", afterPhase: "FINAL", pct: 50 }]).map((d) => d.name).join(",") === "Half,Rest");
const amounts = drawAmounts(412_345, DEFAULT_DRAWS);
check("amounts: the total split by the percents to the dollar", amounts.reduce((n, a) => n + a.amount, 0) === 412_345 && amounts[2].amount === 123_703 && amounts[1].amount === 61_852 && amounts.every((a) => Number.isInteger(a.amount)), amounts);
check("payout: the retainage comes off every draw but the final, which releases what was held", drawPayout(100_000, 10, false, 0).released === 90_000 && drawPayout(100_000, 10, false, 0).held === 10_000 && drawPayout(80_000, 10, true, 25_000).released === 105_000 && drawPayout(80_000, 10, true, 25_000).releasedRetainage === 25_000 && drawPayout(100_000, 70, false, 0).held === 50_000);

// ── where the draws stand ──
const phases: PhaseStateLike[] = [
  { key: "LAND", name: "Land and feasibility", status: "DONE", holding: [] },
  { key: "DESIGN", name: "Design and engineering", status: "DONE", holding: [] },
  { key: "PERMITS", name: "Permits and fees", status: "DONE", holding: [] },
  { key: "SITE", name: "Site work", status: "DONE", holding: [] },
  { key: "FOUNDATION", name: "Foundation", status: "DONE", holding: [{ name: "Foundation wall" }] },
  { key: "FRAME", name: "Framing and dry-in", status: "ACTIVE", holding: [{ name: "Framing" }] },
  { key: "DRYWALL", name: "Insulation and drywall", status: "PLANNED", holding: [] },
  { key: "FINAL", name: "Final and keys", status: "PLANNED", holding: [] },
];
const mk = (n: number, status: string, extra: Partial<DrawLike> = {}): DrawLike => ({ id: `d${n}`, number: n, name: DEFAULT_DRAWS[n - 1].name, afterPhase: DEFAULT_DRAWS[n - 1].afterPhase, pct: DEFAULT_DRAWS[n - 1].pct, amount: [40_000, 60_000, 120_000, 100_000, 80_000][n - 1], status, requestedAt: null, fundedAt: null, retainagePct: 10, ...extra });
const read = readDraws([mk(1, "FUNDED", { fundedAt: "2026-10-01" }), mk(2, "PLANNED"), mk(3, "PLANNED"), mk(4, "PLANNED"), mk(5, "PLANNED")], phases);
check("read: the first draw funded holds its retainage; the foundation's phase is done but its inspection has not passed, so draw 2 waits", read.funded === 36_000 && read.held === 4_000 && read.draws[1].ready === false && drawWords(read.draws[1]) === "waits on Foundation — Foundation wall" && drawWords(read.draws[2]) === "after Framing and dry-in" && read.next?.number === 2 && read.total === 400_000, { funded: read.funded, held: read.held, w1: drawWords(read.draws[1]), w2: drawWords(read.draws[2]) });
const passedPhases = phases.map((p) => (p.key === "FOUNDATION" ? { ...p, holding: [] } : p));
const read2 = readDraws([mk(1, "FUNDED", { fundedAt: "2026-10-01" }), mk(2, "PLANNED"), mk(3, "REQUESTED", { requestedAt: "2026-11-05" }), mk(4, "PLANNED"), mk(5, "PLANNED")], passedPhases);
check("read: the inspection passed makes draw 2 ready; a requested draw says what is to come", read2.draws[1].ready && drawWords(read2.draws[1]) === "ready to request" && drawWords(read2.draws[2]) === "requested Nov 5 · $108,000 to come" && read2.requested === 120_000, { ready: read2.draws[1].ready, w1: drawWords(read2.draws[1]), w2: drawWords(read2.draws[2]), requested: read2.requested });
const read3 = readDraws([mk(1, "FUNDED"), mk(2, "FUNDED"), mk(3, "FUNDED"), mk(4, "FUNDED"), mk(5, "FUNDED", { fundedAt: "2026-12-20" })], phases.map((p) => ({ ...p, status: "DONE" as const, holding: [] })));
check("read: every draw funded — the final released the retainage, nothing is held, the funded total is the whole", read3.held === 0 && read3.funded === 400_000 && drawWords(read3.draws[4]) === "funded Dec 20 · $32,000 retainage released" && read3.next === null, { held: read3.held, funded: read3.funded, w: drawWords(read3.draws[4]) });
check("read: a draw set by hand with no phase is ready at once", readDraws([mk(1, "PLANNED", { afterPhase: null })], phases).draws[0].ready);

// ── the bundle ──
const snap = snapshotFrom({ takenAt: "2026-11-07T18:00:00Z", done: 42.4, phases: [{ name: "Land and feasibility", status: "DONE", done: 100 }, { name: "Framing and dry-in", status: "ACTIVE", done: 60 }], inspections: [{ name: "Setback and footing", result: "PASSED", date: "2026-10-20", stage: "Foundation" }, { name: "Framing", result: "PENDING", date: null, stage: "Framing" }], photos: 37, spent: 212_345.678, committed: 48_000, draw: { number: 3, name: "Dry-in", amount: 120_000 } });
check("snapshot: the paragraph the lender gets", snap.words === "Draw 3, Dry-in — $120,000. The house is 42% done; 1 of 2 phases closed (Land and feasibility); 1 inspection passed (Setback and footing); 37 photos on file; $212,346 spent and $48,000 committed so far." && snap.spent === 212_345.68, snap.words);
check("snapshot: a stored one reads back; garbage is null", parseSnapshot(JSON.stringify(snap))?.photos === 37 && parseSnapshot("nope") === null && parseSnapshot(null) === null);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
