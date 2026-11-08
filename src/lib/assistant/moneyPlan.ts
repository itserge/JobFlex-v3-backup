import "server-only";
// THE MONEY FOR THE AI OPERATOR (2026-11-07, part 5 of the plan "Projects: Remodel and New construction") — "Where
// are we over on the Lee house?", "what's the margin on the Bennett house?", "where can I save twenty thousand?". One
// read, a thin call into what the Money card reads (lib/projectMoneyPlan): the Operator never adds the money up itself.

import { z } from "zod";
import type { ReadTool } from "@/lib/assistant/tools";
import { projectNamed } from "@/lib/assistant/projects";
import { moneyPlanOf } from "@/lib/projectMoneyPlan/server";
import { dollars, headlineWords } from "@/lib/projectMoneyPlan/shared";

const ID = z.string().min(1).max(64);

const moneyPlan: ReadTool<{ projectId: string; ask: "over" | "margin" | "save" | "all"; amount: number | null }> = {
  kind: "read",
  name: "money_plan",
  need: "projects.read",
  card: {
    label: "Where the money stands",
    purpose: "A project's money at this pace: the budget, spent, committed, left and where it is heading by phase; the margin (or a spec house's profit); and the advisor's list — where to save, where to squeeze.",
    when: "'Where are we over on the Lee house?', 'what's the margin on the Bennett house', 'where can I save twenty thousand on the Lee house': money_plan with the project id (find it first), ask = over | margin | save | all, and the amount to find when they name one.",
    objects: ["project", "money"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-07",
    samples: [{ say: "where can I save twenty thousand on the Lee house?", args: { projectId: "proj_1", ask: "save", amount: 20000 } }],
  },
  description:
    "A project's money at this pace (lib/projectMoneyPlan): who it is for and how the money is made; the budget, spent, committed, left and heading-for in all and by phase (a phase 60% done and 80% spent is over before it is late); the contract and the margin at this pace, or a spec house's profit against its sale price; and the advisor's suggestions ranked by dollars — lower an allowance, re-bid a sub, self-perform, defer the shop, move slack or contingency, a change order when the overrun is the client's. ask = over (which phases are over and by how much) | margin | save (the suggestions, up to the amount when given) | all. Use for: where are we over, what's the margin, where can I save twenty thousand.",
  params: z.object({ projectId: ID, ask: z.enum(["over", "margin", "save", "all"]), amount: z.number().min(0).max(100_000_000).nullable() }),
  async run({ actor }, args) {
    const p = await projectNamed(actor.organizationId, { projectId: args.projectId, query: null });
    if (!("one" in p) || !p.one) return { error: "I couldn't find that project." };
    const r = await moneyPlanOf(actor.organizationId, p.one.id);
    const over = r.phases.filter((x) => x.over > 0).sort((a, b) => b.over - a.over).map((x) => ({ phase: x.name, budget: dollars(x.budget), headingFor: dollars(x.headingFor), over: dollars(x.over), status: x.status.toLowerCase(), done: `${Math.round(x.done * 100)}%` }));
    let picked = r.advice;
    if (args.ask === "save" && args.amount != null && args.amount > 0) {
      let sum = 0;
      picked = [];
      for (const a of r.advice.filter((x) => x.kind !== "change_order")) {
        if (sum >= args.amount) break;
        picked.push(a);
        sum += a.saves;
      }
      const co = r.advice.find((x) => x.kind === "change_order");
      if (co) picked = [co, ...picked];
    }
    return {
      project: p.one.name,
      who: r.words,
      headline: headlineWords(r.totals, r.phases),
      totals: { budget: dollars(r.totals.budget), spent: dollars(r.totals.spent), committed: dollars(r.totals.committed), left: dollars(r.totals.left), headingFor: dollars(r.totals.headingFor), over: r.totals.over > 0 ? dollars(r.totals.over) : null },
      ...(args.ask === "over" || args.ask === "all" ? { over: over.length ? over : "No phase is over at this pace." } : {}),
      ...(args.ask === "margin" || args.ask === "all" ? { contract: r.contract != null ? dollars(r.contract) : r.impliedPrice != null ? `${dollars(r.impliedPrice)} implied by the budget (nothing sold yet)` : null, margin: r.margin ? `${dollars(r.margin.amount)} (${r.margin.pct}%) at this pace, against the ${r.margin.against === "contract" ? "contract" : "price the budget implies"}` : null, profit: r.profit ? `${dollars(r.profit.amount)} (${r.profit.pct}%) against the sale price` : null, note: !r.margin && !r.profit ? (r.settings.forWhom === "SELF" ? "One's own build — set a sale price to see the profit at this pace." : "No contract and no margin mode — set how the money is made on the Money card.") : undefined } : {}),
      ...(args.ask === "save" || args.ask === "all" ? { suggestions: picked.map((a) => ({ what: a.title, words: a.words, saves: dollars(a.saves), costs: a.costs, oneTap: a.tap })), covered: args.amount != null ? `${dollars(picked.filter((x) => x.kind !== "change_order").reduce((n, a) => n + a.saves, 0))} of the ${dollars(args.amount)} asked` : undefined } : {}),
      laidOut: r.laidOut,
      hint: !r.laidOut && r.phases.length ? "The phases have no budgets yet — Lay out the budget on the Money card splits the cost budget over them." : undefined,
    };
  },
};

export const MONEY_PLAN_TOOLS = [moneyPlan] as const;
