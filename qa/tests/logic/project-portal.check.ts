// THE HOMEOWNER'S AND THE LENDER'S PAGES — the rules (2026-11-08, the plan "Projects: Remodel and New construction",
// part 7). Pure, no database: what closes a phase in the homeowner's words, when a choice is needed by, the photos
// under their phase, a draw as the lender reads it, cost-plus in the client's words.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/project-portal.check.ts

import { clientDueWords, clientGateWords, costPlusWords, inspectionNoun, lenderDrawWords, photosByPhase } from "@/lib/projectClient/shared";
import type { DrawRead } from "@/lib/projectDraws/shared";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? `  → ${JSON.stringify(extra)}` : ""}`);
}

// ── what closes a phase ──
const insp = (over: Partial<Parameters<typeof clientGateWords>[0]>) => clientGateWords({ status: "ACTIVE", gateKind: "INSPECTION", gateWords: "the framing inspection", holding: [], stageCount: 2, stagesDone: 1, ...over });
check("a done phase reads done", insp({ status: "DONE" }) === "done");
check("a phase still ahead says nothing", insp({ status: "PLANNED", holding: [{ name: "Framing", result: "PENDING", date: null }] }) === "");
check("an inspection booked", insp({ holding: [{ name: "Framing", result: "PENDING", date: "2026-11-12" }] }) === "Framing inspection booked Nov 12", insp({ holding: [{ name: "Framing", result: "PENDING", date: "2026-11-12" }] }));
check("an inspection not booked yet is ahead", insp({ holding: [{ name: "Framing", result: "PENDING", date: null }] }) === "Framing inspection ahead");
check("a failed one is to be redone", insp({ holding: [{ name: "Framing", result: "FAILED", date: "2026-11-03" }] }) === "Framing inspection to be redone");
check("two gates join with a dot", insp({ holding: [{ name: "Shear wall and nailing", result: "PENDING", date: "2026-11-12" }, { name: "Framing", result: "PENDING", date: null }] }) === "Shear wall and nailing inspection booked Nov 12 · Framing inspection ahead");
check("a name that already says inspection is not doubled", inspectionNoun("Final inspection") === "Final inspection" && inspectionNoun("Framing") === "Framing inspection");
check("every inspection passed on a phase under way", insp({ holding: [], stageCount: 2, stagesDone: 2 }) === "inspections passed");
check("no gate holding but stages still open says nothing", insp({ holding: [], stageCount: 2, stagesDone: 1 }) === "");
check("the client's word", clientGateWords({ status: "ACTIVE", gateKind: "CLIENT", gateWords: "the plans signed off", holding: [], stageCount: 1, stagesDone: 0 }) === "closes with your sign-off");
check("the lender's word", clientGateWords({ status: "ACTIVE", gateKind: "LENDER", gateWords: "the lender's word", holding: [], stageCount: 1, stagesDone: 0 }) === "closes with the lender's OK");
check("never the office's wording", !/waits on|holds/.test(insp({ holding: [{ name: "Framing", result: "PENDING", date: null }] })));

// ── when a choice is needed by ──
const today = "2026-11-08";
check("a month out", clientDueWords("2026-11-30", today) === "needed by Nov 30", clientDueWords("2026-11-30", today));
check("within a week is soon", clientDueWords("2026-11-12", today) === "needed by Nov 12 — soon");
check("today is soon", clientDueWords("2026-11-08", today) === "needed by Nov 8 — soon");
check("exactly a week out is soon", clientDueWords("2026-11-15", today) === "needed by Nov 15 — soon");
check("eight days out is not", clientDueWords("2026-11-16", today) === "needed by Nov 16");
check("past is past due, never 'late' with a count", clientDueWords("2026-11-01", today) === "needed by Nov 1 — past due");
check("no day yet", clientDueWords(null, today) === "the date comes with the schedule");

// ── the photos under their phase ──
const dayOf = (iso: string) => iso.slice(0, 10);
const phases = [
  { id: "site", name: "Site work", position: 4 },
  { id: "fnd", name: "Foundation", position: 5 },
  { id: "frm", name: "Framing and dry-in", position: 6 },
];
const stages = [
  { phaseId: "fnd", lane: null, startsAt: "2026-11-01", endsAt: "2026-11-10", doneAt: "2026-11-08T20:00:00.000Z", position: 1 },
  { phaseId: "frm", lane: null, startsAt: "2026-11-12", endsAt: "2026-11-30", doneAt: null, position: 2 },
  { phaseId: "site", lane: "Site", startsAt: "2026-11-01", endsAt: "2026-11-30", doneAt: null, position: 3 },
  { phaseId: null, lane: null, startsAt: null, endsAt: null, doneAt: null, position: 4 },
];
const photos = [
  { id: "a", at: "2026-11-03T15:00:00.000Z" }, // the foundation's days, and the site lane's — the house wins
  { id: "b", at: "2026-11-15T15:00:00.000Z" }, // framing
  { id: "c", at: "2026-10-20T15:00:00.000Z" }, // before any window
  { id: "d", at: "2026-11-08T15:00:00.000Z" }, // the day the foundation stage was closed
  { id: "e", at: "2026-11-10T15:00:00.000Z" }, // after the foundation closed, before framing: only the site lane
];
const groups = photosByPhase(photos, stages, phases, dayOf);
const ids = (g: { photos: Array<{ id: string }> } | undefined) => (g ? g.photos.map((p) => p.id).join(",") : "");
check("groups follow the phases' order, the loose ones last under no name", groups.map((g) => g.phase).join("|") === "Site work|Foundation|Framing and dry-in|", groups.map((g) => g.phase));
check("the house's stage wins over the site lane", ids(groups.find((g) => g.phase === "Foundation")) === "a,d", ids(groups.find((g) => g.phase === "Foundation")));
check("a photo on the day a stage was closed stays with it (the window ends on doneAt's day, not the planned end)", ids(groups.find((g) => g.phase === "Foundation")).includes("d"));
check("a day only the site lane covers goes to its phase", ids(groups.find((g) => g.phase === "Site work")) === "e");
check("framing's day", ids(groups.find((g) => g.phase === "Framing and dry-in")) === "b");
check("a photo before any window comes last", ids(groups.find((g) => g.phase === null)) === "c");
check("no phases → nothing to group (the page shows one flat grid)", photosByPhase(photos, stages, [], dayOf).length === 1 && photosByPhase(photos, stages, [], dayOf)[0].phase === null);
check("no photos → no groups", photosByPhase([], stages, phases, dayOf).length === 0);

// ── a draw as the lender reads it ──
const base: DrawRead = {
  id: "d1",
  number: 1,
  name: "Soft costs and the land",
  afterPhase: "PERMITS",
  pct: 10,
  amount: 65_000,
  status: "PLANNED",
  requestedAt: null,
  fundedAt: null,
  retainagePct: 10,
  state: "PLANNED",
  phase: { key: "PERMITS", name: "Permits and fees", status: "DONE", closed: true, waitsOn: [] },
  ready: true,
  payout: { released: 58_500, held: 6_500, releasedRetainage: 0 },
  isFinal: false,
};
check("a ready draw reads planned to the lender — never 'ready to request'", lenderDrawWords(base) === "planned — after Permits and fees", lenderDrawWords(base));
check("a draw whose phase is open reads the same", lenderDrawWords({ ...base, ready: false, phase: { ...base.phase!, status: "ACTIVE", closed: false, waitsOn: ["Footing"] } }) === "planned — after Permits and fees");
check("a requested draw keeps the day and what is to come", /^requested Nov 5 · \$58,500 to come$/.test(lenderDrawWords({ ...base, status: "REQUESTED", state: "REQUESTED", requestedAt: "2026-11-05T12:00:00.000Z", ready: false })), lenderDrawWords({ ...base, status: "REQUESTED", state: "REQUESTED", requestedAt: "2026-11-05T12:00:00.000Z", ready: false }));
check("a funded draw keeps the day and the retainage held", /^funded Dec 20 · \$6,500 held$/.test(lenderDrawWords({ ...base, status: "FUNDED", state: "FUNDED", fundedAt: "2026-12-20T12:00:00.000Z", ready: false })), lenderDrawWords({ ...base, status: "FUNDED", state: "FUNDED", fundedAt: "2026-12-20T12:00:00.000Z", ready: false }));

// ── cost-plus in the client's words ──
check("a fixed fee", costPlusWords({ feeAmount: 20_000, marginPct: null }) === "Your contract is cost-plus: you pay the costs as they come, plus a $20,000 fee.");
check("a percent fee", costPlusWords({ feeAmount: null, marginPct: 15 }) === "Your contract is cost-plus: you pay the costs as they come, plus a 15% fee.");
check("no fee set", /plus the agreed fee\.$/.test(costPlusWords({ feeAmount: null, marginPct: null })));

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
