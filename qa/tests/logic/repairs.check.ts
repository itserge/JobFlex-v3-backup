// REPAIRS AND COME-BACKS — the rules (2026-11-09, the ProSmart gaps plan, part 2), on made-up values. No database.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/repairs.check.ts

import {
  billableByDefault,
  causeLabel,
  cleanReasons,
  countsAgainstCrew,
  crewComebacks,
  foldRepairCosts,
  needsParts,
  parseReasons,
  reasonsFor,
  reasonsFromWords,
  repairFamilyOf,
  repairScope,
  repairTitle,
  whoPaysWords,
} from "@/lib/repairs/shared";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

// ── the trade decides the chips ──
check("gutter guards on a new roof are a gutter job", repairFamilyOf("Gutter guards on the new roof") === "gutters");
check("a roof is roofing, a deck stain is a deck", repairFamilyOf("Roof replacement — Lee") === "roofing" && repairFamilyOf("Deck stain and seal") === "decking");
check("an epoxy garage floor is floors; a gate is fencing", repairFamilyOf("Epoxy garage floor") === "floors" && repairFamilyOf("New gate and posts") === "fencing");
check("the proposal's trade wins over the job's title", repairFamilyOf("Fencing", "Back yard project") === "fencing");
check("nothing known is general", repairFamilyOf(null, "", "Project for Sam") === "general");
const gutterChips = reasonsFor("gutters").map((r) => r.key);
check("a gutter job offers the gutter chips, then the common ones", gutterChips[0] === "gut_leak" && gutterChips.includes("unfinished") && gutterChips[gutterChips.length - 1] === "other");
check("every family ends with Something else", (["roofing", "siding", "decking", "fencing", "floors", "painting", "plumbing", "electrical", "hvac", "windows", "interior", "landscaping", "general"] as const).every((f) => reasonsFor(f).at(-1)?.key === "other"));
check("chip keys are unique across all trades", (() => {
  const all = (["roofing", "gutters", "siding", "decking", "fencing", "floors", "painting", "plumbing", "electrical", "hvac", "windows", "interior", "landscaping", "general"] as const).flatMap((f) => reasonsFor(f).map((r) => r.key));
  const own = all.filter((k) => !["unfinished", "cleanup", "job_damage", "other"].includes(k));
  return new Set(own).size === own.length;
})());

// ── what the installer reads ──
check("unknown keys are dropped, each once", JSON.stringify(cleanReasons(["gut_leak", "nope", "gut_leak", "other"])) === JSON.stringify(["gut_leak", "other"]));
check("stored reasons read back; junk reads as none", JSON.stringify(parseReasons('["fn_gate","x"]')) === JSON.stringify(["fn_gate"]) && parseReasons("{bad").length === 0 && parseReasons(null).length === 0);
check("one reason names itself", repairTitle(["gut_leak"], "Lee Walk") === "Repair: Leaking seam or corner — Lee Walk");
check("several become a count, so it fits a phone", repairTitle(["gut_leak", "gut_slope", "cleanup"], "Lee Walk") === "Repair: Leaking seam or corner +2 more — Lee Walk");
check("a note-only repair is still a repair", repairTitle([], "Lee Walk") === "Repair — Lee Walk" && repairTitle([]) === "Repair");
const scope = repairScope(["gut_leak", "gut_downspout"], "Back corner over the garage.", { title: "Gutters — Lee Walk", done: "Oct 12", crew: ["Alex Walk"] });
check("the scope: each reason as an instruction, the note, then what the first job was", scope === "• Reseal or replace the leaking seam or corner\n• Fix or replace the downspout / elbow and its straps\n\nBack corner over the garage.\n\nCome-back on: Gutters — Lee Walk, done Oct 12 by Alex Walk.", scope);
check("a note alone opens with the note, no blank line first", repairScope([], "Gate drags.", null) === "Gate drags.");
check("a downspout usually needs a part; re-pitching doesn't", needsParts(["gut_downspout"]) && !needsParts(["gut_slope", "gut_leak"]));

// ── why it came back, who pays ──
check("only our work counts on the crew", countsAgainstCrew("WORKMANSHIP") && !countsAgainstCrew("PRODUCT") && !countsAgainstCrew("CLIENT") && !countsAgainstCrew(null));
check("warranty (free) by default; the client's doing is billable", !billableByDefault("WORKMANSHIP") && !billableByDefault(null) && !billableByDefault("PRODUCT") && billableByDefault("CLIENT"));
check("cause words", causeLabel("WORKMANSHIP") === "Our work" && causeLabel(null) === "Not sure yet" && causeLabel("junk") === "Not sure yet");
check("who pays words", whoPaysWords(false, null) === "Warranty — free to the client" && whoPaysWords(true, 250) === "Billable — $250 to the client" && whoPaysWords(true, null) === "Billable — price to set");

// ── the numbers ──
const counts = crewComebacks([
  { repairId: "r1", repairOfId: "j1", cause: "WORKMANSHIP", originalCrew: ["alex", "dan"], cost: 150 },
  { repairId: "r2", repairOfId: "j2", cause: "WORKMANSHIP", originalCrew: ["alex", "alex"], cost: 90.5 },
  { repairId: "r3", repairOfId: "j3", cause: "CLIENT", originalCrew: ["dan"], cost: 400 },
  { repairId: "r4", repairOfId: "j4", cause: null, originalCrew: ["dan"], cost: 60 },
]);
check("Alex: two come-backs on his work, $240.50", counts.get("alex")?.comebacks === 2 && counts.get("alex")?.cost === 240.5, [...counts]);
check("Dan: one — the client's and the not-sure ones don't count", counts.get("dan")?.comebacks === 1 && counts.get("dan")?.cost === 150);

type C = { total: number; repairs: number; repairsCount: number };
const mk = (t: number): C => ({ total: t, repairs: 0, repairsCount: 0 });
const all = foldRepairCosts(new Map<string, C>([["j1", mk(1000)], ["r1", mk(150)], ["r2", mk(0)]]), [{ id: "r1", repairOfId: "j1" }, { id: "r2", repairOfId: "j1" }], () => mk(0), new Set());
check("a list of all jobs: the repairs' cost moves into the job that came back, each dollar once", all.get("j1")?.total === 1150 && all.get("j1")?.repairs === 150 && all.get("j1")?.repairsCount === 2 && !all.has("r1") && !all.has("r2"));
const asked = foldRepairCosts(new Map<string, C>([["j1", mk(1000)], ["r1", mk(150)]]), [{ id: "r1", repairOfId: "j1" }], () => mk(0), new Set(["j1", "r1"]));
check("a repair asked for by id keeps its own entry too", asked.get("r1")?.total === 150 && asked.get("j1")?.total === 1150);
const orphan = foldRepairCosts(new Map<string, C>([["r9", mk(80)]]), [{ id: "r9", repairOfId: "j9" }], () => mk(0), new Set());
check("the original appears even when it had no cost of its own", orphan.get("j9")?.total === 80 && orphan.get("j9")?.repairs === 80);

// ── the Operator's words → chips ──
check("'leaking at the corner' on a gutter job → the leaking seam chip", reasonsFromWords("gutters", "it's leaking at the corner again").includes("gut_leak"));
check("'gate won't latch' on a fence → the gate chip", reasonsFromWords("fencing", "the gate sags and won't latch")[0] === "fn_gate");
check("words that name nothing pick nothing (the note carries them)", reasonsFromWords("roofing", "client called, not happy").length === 0);
check("at most three chips", reasonsFromWords("decking", "loose boards, wobbly railing, stairs, stain, ledger").length <= 3);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
