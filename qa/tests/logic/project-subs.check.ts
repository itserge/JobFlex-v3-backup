// CONTRACTORS: QUOTES AND INVOICES — the pure core (2026-11-07, part 2 of the plan "Projects: Remodel and New
// construction"): the statuses, the scope a stage reads as, the reply-by rule, the trade a stage points at, the
// comparison against the budget line, the overdue rule, the list's flags and the texts. Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/project-subs.check.ts
import "../_lib/_server-only";
import { QUOTE_LABEL, QUOTE_STATUSES, askText, awardText, compareQuotes, overdue, quoteFlags, quoteStatusOf, replyByDefault, scopeFor, stageSubsBudget, tradeForStage, type QuoteLike } from "../../../src/lib/projectSubs/shared";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}

const q = (id: string, status: string, amount: number | null, more: Partial<QuoteLike> = {}): QuoteLike => ({ id, status, amount, dueBy: null, stageId: "s1", contractorName: `C${id}`, ...more });

// ── statuses ──
check("statuses: six, each labelled; an odd one reads as asked", QUOTE_STATUSES.length === 6 && QUOTE_STATUSES.every((s) => QUOTE_LABEL[s]) && quoteStatusOf("PAID") === "PAID" && quoteStatusOf("nope") === "ASKED");

// ── the scope ──
const scope = scopeFor("Framing and dry-in", ["Floor system", "Walls and trusses", "Inspection: framing", "Final photos of the house", "Collect the final payment"]);
check("scope: the stage's name, then the contractor's tasks as lines; the office's own left out", scope.split("\n")[0] === "Framing and dry-in" && /- Floor system/.test(scope) && /- Walls and trusses/.test(scope) && !/Inspection/.test(scope) && !/Final photos/.test(scope) && !/final payment/.test(scope), scope);

// ── reply by ──
check("reply by: five work days out, never a weekend", replyByDefault("2026-11-06") === "2026-11-13" && replyByDefault("2026-11-07") === "2026-11-13" && !/^(2026-11-08|2026-11-14|2026-11-15)$/.test(replyByDefault("2026-11-06")), replyByDefault("2026-11-06"));

// ── the trade a stage points at ──
check("trade: framing is carpentry, rough-ins' plumbing is plumbing, a kitchen's cabinets are countertops, nothing for 'final'", tradeForStage("Framing and dry-in") === "Carpentry" && tradeForStage("Plumbing rough-in") === "Plumbing" && tradeForStage("Cabinets and counters") === "Countertops" && tradeForStage("Foundation") === "Concrete" && tradeForStage("Final") === null);

// ── the budget line ──
check("budget line: the stage's weight share of the subs budget; nothing without one", stageSubsBudget(0.2, 1, 50_000) === 10_000 && stageSubsBudget(0.25, 0.5, 20_000) === 10_000 && stageSubsBudget(0.2, 1, 0) === null && stageSubsBudget(0, 1, 50_000) === null);

// ── comparing ──
{
  const quotes = [q("a", "QUOTED", 12_000), q("b", "QUOTED", 9_500), q("c", "ASKED", null), q("d", "DECLINED", 8_000)];
  const cmp = compareQuotes(quotes, 10_000);
  const by = (id: string) => cmp.find((c) => c.quote.id === id)!;
  check("compare: the lowest price in is best; a declined one never wins even if cheaper", by("b").best && !by("a").best && !by("d").best && !by("c").best);
  check("compare: over the line is flagged with how far; under is not", by("a").over && by("a").overBy === 2_000 && !by("b").over && by("b").overBy === null);
  const awarded = compareQuotes([q("a", "AWARDED", 12_000), q("b", "QUOTED", 9_500)], null);
  check("compare: the awarded one leads whatever its price; no line, nothing over", awarded.find((c) => c.quote.id === "a")!.best && !awarded.find((c) => c.quote.id === "b")!.best && awarded.every((c) => !c.over));
}

// ── overdue and the flags ──
{
  const today = "2026-11-10";
  const late = q("l", "ASKED", null, { dueBy: "2026-11-07", contractorName: "Ridge Framing" });
  const fine = q("f", "ASKED", null, { dueBy: "2026-11-12" });
  const quoted = q("q", "QUOTED", 5_000, { contractorName: "Lee Carpentry" });
  const inv = q("i", "INVOICED", 5_000, { contractorName: "Pipe Co" });
  check("overdue: asked and past the reply-by day", overdue(late, today) && !overdue(fine, today) && !overdue({ ...late, status: "QUOTED" }, today));
  const flags = quoteFlags([late, fine, quoted, inv], today);
  check("flags: an overdue quote, a quote in and an invoice in, each named", flags.length === 3 && flags[0].kind === "quote-overdue" && /Ridge Framing/.test(flags[0].text) && flags[1].kind === "quote-in" && /Lee Carpentry/.test(flags[1].text) && flags[2].kind === "invoice-in" && /Pipe Co/.test(flags[2].text), flags);
  check("flags: several of a kind are counted", quoteFlags([late, { ...late, id: "l2" }], today)[0].text === "2 quotes overdue" && quoteFlags([], today).length === 0);
}

// ── the texts ──
check("texts: the ask carries the company, the project, the day and the link; the award asks for the invoice", /^Ridge Builders: could you quote the work on Lee house\? Reply by Nov 13\. Details and a price box: https:\/\/x\/q\/t1$/.test(askText("Ridge Builders", "Lee house", "Nov 13", "https://x/q/t1")) && /you've got the work on Lee house .* send your invoice here: https:\/\/x\/q\/t1$/.test(awardText("Ridge Builders", "Lee house", "https://x/q/t1")));

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
