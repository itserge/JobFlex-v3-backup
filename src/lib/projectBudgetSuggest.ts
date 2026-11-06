import "server-only";
// A BUDGET FILLED IN FOR YOU (owner, 2026-11-06: "make it smart"). Two ways, honest about which:
//
//   estimate — the sold proposals' lines carry material and labor costs under their price (the estimators and
//              Smart Proposal write them): those are the Materials and Labor budget to the dollar. Lines with no
//              cost of their own that read like a permit, a rental or a sub are taken at their price (a sub's at
//              85% — a markup is usual). The subs' bills already logged are never under-budgeted.
//   rule     — nothing costed: a rule of thumb for the trade — a usual cost share of the contract, split the
//              usual way — plainly labelled so the office knows to make it theirs.
//
// Nothing is written: the card fills its fields and the office presses Save.

import { db } from "@/lib/db";
import { projectMoney } from "@/lib/projectMoney";
import { proposalTrade } from "@/lib/projectStages/shared";
import { parseTradeTypes } from "@/lib/tradeTypes";

export type BudgetSuggestion = {
  source: "estimate" | "rule" | "none";
  trade: string | null;
  lines: Array<{ category: string; amount: number }>;
  /** One or two sentences on where the figures come from. */
  words: string;
};

const SOLD = new Set(["ACCEPTED", "COMPLETED", "PAID"]);
const OPEN = new Set(["DRAFT", "SENT", "VIEWED"]);

type Rule = { cost: number; split: Record<string, number> };
/** Usual cost shares of the contract by trade, and how the cost usually splits. Rules of thumb, not promises. */
const RULES: Record<string, Rule> = {
  Decking: { cost: 0.62, split: { MATERIALS: 0.55, LABOR: 0.35, PERMITS: 0.03, EQUIPMENT: 0.02, OTHER: 0.05 } },
  Roofing: { cost: 0.6, split: { MATERIALS: 0.5, LABOR: 0.4, EQUIPMENT: 0.05, PERMITS: 0.03, OTHER: 0.02 } },
  Fencing: { cost: 0.6, split: { MATERIALS: 0.55, LABOR: 0.4, PERMITS: 0.02, OTHER: 0.03 } },
  Siding: { cost: 0.6, split: { MATERIALS: 0.5, LABOR: 0.42, EQUIPMENT: 0.05, PERMITS: 0.02, OTHER: 0.01 } },
  "Kitchen & Bath": { cost: 0.68, split: { MATERIALS: 0.42, LABOR: 0.27, SUBCONTRACTORS: 0.23, PERMITS: 0.03, EQUIPMENT: 0.02, OTHER: 0.03 } },
  "General Contractor": { cost: 0.7, split: { MATERIALS: 0.4, LABOR: 0.3, SUBCONTRACTORS: 0.2, PERMITS: 0.04, EQUIPMENT: 0.03, OTHER: 0.03 } },
  Flooring: { cost: 0.62, split: { MATERIALS: 0.55, LABOR: 0.4, EQUIPMENT: 0.03, OTHER: 0.02 } },
  Tile: { cost: 0.62, split: { MATERIALS: 0.5, LABOR: 0.45, EQUIPMENT: 0.02, OTHER: 0.03 } },
  Countertops: { cost: 0.65, split: { MATERIALS: 0.65, LABOR: 0.3, OTHER: 0.05 } },
  HVAC: { cost: 0.65, split: { MATERIALS: 0.55, LABOR: 0.3, SUBCONTRACTORS: 0.08, PERMITS: 0.05, OTHER: 0.02 } },
  Concrete: { cost: 0.62, split: { MATERIALS: 0.45, LABOR: 0.45, EQUIPMENT: 0.07, PERMITS: 0.03 } },
  Painting: { cost: 0.55, split: { MATERIALS: 0.3, LABOR: 0.65, EQUIPMENT: 0.03, OTHER: 0.02 } },
  Landscaping: { cost: 0.6, split: { MATERIALS: 0.5, LABOR: 0.4, EQUIPMENT: 0.08, OTHER: 0.02 } },
  Windows: { cost: 0.65, split: { MATERIALS: 0.65, LABOR: 0.3, PERMITS: 0.03, OTHER: 0.02 } },
};
const DEFAULT_RULE: Rule = { cost: 0.65, split: { MATERIALS: 0.45, LABOR: 0.35, SUBCONTRACTORS: 0.1, PERMITS: 0.04, EQUIPMENT: 0.03, OTHER: 0.03 } };

const dollars = (n: number) => Math.round(n);
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export async function suggestBudget(organizationId: string, projectId: string): Promise<BudgetSuggestion> {
  const p = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      id: true,
      proposals: {
        where: { status: { not: "ARCHIVED" } },
        orderBy: { total: "desc" },
        select: { id: true, title: true, status: true, trade: true, scopeOfWork: true, total: true, lineItems: { select: { name: true, materialCost: true, laborCost: true, total: true } } },
      },
      expenses: { where: { category: "SUBCONTRACTORS" }, select: { amount: true } },
      organization: { select: { tradeTypesJson: true } },
    },
  });
  if (!p) throw new Error("Project not found");
  const orgTrades = parseTradeTypes(p.organization.tradeTypesJson);
  const sold = p.proposals.filter((x) => SOLD.has(x.status));
  const pool = sold.length ? sold : p.proposals.filter((x) => OPEN.has(x.status));
  const lead = pool[0];
  const trade = lead ? proposalTrade({ estimator: lead.trade, title: lead.title, scope: lead.scopeOfWork, orgTrades }) : (orgTrades[0] ?? null);
  const m = (await projectMoney(organizationId, [p.id])).get(p.id);
  const priced = sold.length ? (m?.contract ?? 0) : (m?.pipeline ?? 0);
  if (!lead || priced <= 0) {
    return { source: "none", trade, lines: [], words: "Nothing is priced on this project yet. Sell or draft a proposal and the budget can be read from it — or type the figures." };
  }

  // The estimate's own costs.
  let materials = 0;
  let labor = 0;
  let subs = 0;
  let permits = 0;
  let equipment = 0;
  let costed = 0;
  let costedPrice = 0;
  for (const pr of pool) {
    for (const l of pr.lineItems) {
      const c = Math.max(0, l.materialCost) + Math.max(0, l.laborCost);
      if (c > 0) {
        materials += Math.max(0, l.materialCost);
        labor += Math.max(0, l.laborCost);
        costed += c;
        costedPrice += Math.max(0, l.total);
        continue;
      }
      const name = l.name.toLowerCase();
      const price = Math.max(0, l.total);
      if (/permit|inspection|\bfees?\b/.test(name)) permits += price;
      else if (/dumpster|rental|\brent\b|scaffold|\blift\b|porta/.test(name)) equipment += price;
      else if (/subcontract|\bsubs?\b/.test(name)) subs += price * 0.85;
    }
  }
  const subsLogged = p.expenses.reduce((n, e) => n + e.amount, 0);
  subs = Math.max(subs, subsLogged);
  // Real costs sit under their lines' price with room for a margin; "costs" at 90%+ of the price are the price
  // copied over (a quick estimate), and the rule of thumb reads truer than they do.
  const suggestedTotal = materials + labor + subs + permits + equipment;
  if (costed > 0 && costed <= 0.9 * costedPrice && suggestedTotal < priced) {
    const lines = [
      { category: "MATERIALS", amount: dollars(materials) },
      { category: "LABOR", amount: dollars(labor) },
      { category: "SUBCONTRACTORS", amount: dollars(subs) },
      { category: "PERMITS", amount: dollars(permits) },
      { category: "EQUIPMENT", amount: dollars(equipment) },
    ].filter((l) => l.amount > 0);
    const total = lines.reduce((n, l) => n + l.amount, 0);
    const names = pool.map((x) => x.title).slice(0, 2).join(" and ");
    const extras = [permits ? "permits" : "", equipment ? "rentals" : "", subs ? "subs" : ""].filter(Boolean);
    return {
      source: "estimate",
      trade,
      lines,
      words: `Read from the ${names} estimate: materials and labor as costed on each line${extras.length ? `, with the ${extras.join(", ")} lines at their price` : ""} — ${money(total)}, ${Math.round((total / priced) * 100)}% of the ${money(priced)} ${sold.length ? "contract" : "price"}.`,
    };
  }

  const rule = (trade && RULES[trade]) || DEFAULT_RULE;
  const cost = priced * rule.cost;
  const lines = Object.entries(rule.split)
    .map(([category, share]) => ({ category, amount: dollars(cost * share) }))
    .map((l) => (l.category === "SUBCONTRACTORS" ? { ...l, amount: Math.max(l.amount, dollars(subsLogged)) } : l))
    .filter((l) => l.amount > 0);
  return {
    source: "rule",
    trade,
    lines,
    words: `A rule of thumb for ${trade ? `a ${trade.toLowerCase()} job` : "this kind of job"} — about ${Math.round(rule.cost * 100)}% of the ${money(priced)} ${sold.length ? "contract" : "price"} as cost, split the usual way. The estimate has no costs on its lines to read, so change any figure to what you know.`,
  };
}
