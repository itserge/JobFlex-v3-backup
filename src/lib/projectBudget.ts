// PROJECT BUDGET — the arithmetic behind a project's Budget card (owner,
// 2026-09-18: "offer me the budgeting budgets and track that budgets within
// the project").
//
// Pure: no database, no framework. The loader feeds it the rows, the page
// renders what it returns, and the same rules hold on desktop and phone.
//
//   budget      — ProjectBudgetLine rows, one per category. A project that
//                 carries only the old single Project.budget figure (created
//                 before categories existed) reads as that total, unsplit.
//   spent       — ProjectExpense rows (costs logged straight to the project)
//                 plus JobExpense rows of the project's jobs, the job's free-
//                 text category mapped onto the six budget categories.
//   contract    — what the client has agreed to pay BEFORE SALES TAX: the
//                 project's accepted, completed and paid proposals, with their
//                 approved change orders (owner, 2026-11-04: the tax is the
//                 state's, never profit). `billed` is the same with the tax.
//   pipeline    — the open proposals (draft, sent, viewed), before tax.
//   spent       — also the crew's pay on the project's jobs (Labor) and the
//                 warehouse stock issued to them (Materials) — lib/jobCost.
//   projected   — cost at completion: per category, the larger of what was
//                 budgeted and what is already spent (an overrun is a cost
//                 whether or not the budget admits it), plus an allowance for
//                 approved change orders whose cost is not in the budget yet,
//                 at the project's own planned cost share.
//   margin      — what is sold and still open, less the projected cost. While
//                 the proposals cover less than the cost budget the card says
//                 so ("short") instead of calling a half-priced remodel a loss.

export const BUDGET_CATEGORIES = ["MATERIALS", "LABOR", "SUBCONTRACTORS", "PERMITS", "EQUIPMENT", "OTHER"] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<BudgetCategory, string> = {
  MATERIALS: "Materials",
  LABOR: "Labor",
  SUBCONTRACTORS: "Subcontractors",
  PERMITS: "Permits & fees",
  EQUIPMENT: "Equipment & rentals",
  OTHER: "Other",
};

/** Where a spend sits against its budget. */
export type BudgetTone = "ok" | "warn" | "over" | "none";
/** 80% spent is the warning line; past 100% the category is over. */
export const WARN_AT = 0.8;

export function isBudgetCategory(v: string): v is BudgetCategory {
  return (BUDGET_CATEGORIES as readonly string[]).includes(v);
}

// MORE KINDS OF BUDGET (owner, 2026-11-06: "make option to add more kind of budgets"). A budget line whose category
// is not one of the six is its own kind — "Tile", "Cabinets", "Dumpster" — tracked like the six: expenses logged on
// the project under that name count against it. The six keep their keys; a custom kind's key is its name as typed.

/** How many kinds of its own a project's budget holds — a lender's budget brought in runs to 40 lines and more
 *  (2026-11-07, lib/projectBudgetImport). */
export const MAX_KINDS = 60;

/** The six's label, or a custom kind's own name. */
export function categoryLabel(c: string): string {
  return isBudgetCategory(c) ? CATEGORY_LABEL[c] : c;
}

/** A kind typed by hand onto a key: the six when it names one ("materials", "Permits & fees", "subs"), else its own
 *  name, tidied — one space between words, 40 characters at most. */
export function normalizeKind(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 40);
  const up = name.toUpperCase();
  if (isBudgetCategory(up)) return up;
  const low = name.toLowerCase();
  for (const c of BUDGET_CATEGORIES) if (CATEGORY_LABEL[c].toLowerCase() === low) return c;
  if (/^(subs?|subcontractors?)$/.test(low)) return "SUBCONTRACTORS";
  if (/^(permits?|fees)$/.test(low)) return "PERMITS";
  if (/^(equipment|rentals?)$/.test(low)) return "EQUIPMENT";
  return name;
}

/** The custom kinds a project's budget lines carry, in order; the first spelling of a name wins. */
export function customKinds(lines: ReadonlyArray<{ category: string; label?: string | null }>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (l.label || isBudgetCategory(l.category)) continue;
    const key = l.category.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(l.category.trim());
  }
  return out;
}

/** A job expense's free-text category ("Materials", "lumber", "Dumpster") onto the six. */
export function categoryOf(raw: string | null | undefined): BudgetCategory {
  const s = (raw ?? "").toLowerCase();
  if (isBudgetCategory((raw ?? "").toUpperCase())) return (raw ?? "").toUpperCase() as BudgetCategory;
  if (/sub ?contract|\bsub\b|install crew|trade/.test(s)) return "SUBCONTRACTORS";
  if (/permit|\bfees?\b|inspection|licen/.test(s)) return "PERMITS";
  if (/equip|rental|rent\b|tool|dumpster|lift|scaffold|machine/.test(s)) return "EQUIPMENT";
  if (/labou?r|wage|payroll|crew|hour/.test(s)) return "LABOR";
  if (/material|lumber|supply|supplies|concrete|shingle|paint|hardware|home depot|lowe/.test(s)) return "MATERIALS";
  return "OTHER";
}

export type BudgetLineIn = { category: string; amount: number; label?: string | null };
export type SpendIn = { category: string; amount: number };
export type ContractIn = {
  status: string;
  /** What the client pays BEFORE sales tax: the proposal's total less its tax, plus its approved change orders before tax. */
  revenue: number;
  /** The same with sales tax — what the client is billed. */
  billed: number;
};
/** An approved change order whose cost is not in the budget yet (no budget line carries its label). */
export type UncostedChange = { id: string; label: string; amount: number };

/** The label a change order's cost line carries in the budget — how the card knows it is costed. */
export const changeLineLabel = (number: number | null | undefined, title: string) => `Change order${number ? ` #${number}` : ""} · ${title}`.slice(0, 120);

/** How the margin reads: nothing priced yet; the proposals cover less than the cost; open proposals still to win; all sold. */
export type MarginState = "none" | "short" | "projected" | "sold";

export type CategoryRow = {
  /** One of the six, or a custom kind's name. */
  category: string;
  label: string;
  budget: number;
  spent: number;
  remaining: number;
  /** spent / budget, or null when nothing is budgeted. */
  pct: number | null;
  tone: BudgetTone;
};

export type BudgetSummary = {
  /** The budgeted cost: the lines' sum, or the old single figure when there are no lines. */
  budget: number;
  /** True when the budget is the old single figure, not split by category. */
  unsplit: boolean;
  spent: number;
  remaining: number;
  pct: number | null;
  tone: BudgetTone;
  /** Agreed with the client, before sales tax: sold proposals with approved change orders. */
  contract: number;
  /** The same with sales tax — what the client is billed. */
  billed: number;
  /** billed − contract: collected for the state, never profit. */
  salesTax: number;
  /** Proposed but not yet agreed, before tax. */
  pipeline: number;
  /** Cost at completion: per category, the larger of budget and spend, plus the change-order allowance. */
  projectedCost: number;
  /** The cost counted for approved change orders that have no budget line yet. */
  changeAllowance: number;
  /** Those change orders, for the card's "add its cost" line. */
  uncosted: UncostedChange[];
  /** The planned cost share used for the allowance (budget ÷ what the proposals priced), or null. */
  costShare: number | null;
  /** contract + pipeline − projected cost, or null when nothing is priced yet. */
  margin: number | null;
  /** margin ÷ (contract + pipeline). */
  marginPct: number | null;
  marginState: MarginState;
  /** projected cost − (contract + pipeline) while the proposals do not cover the cost, else 0. */
  uncovered: number;
  /** Categories over their budget (keys — categoryLabel prints them), for the card's warning and the list's "Needs a look". */
  overCategories: string[];
  rows: CategoryRow[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function toneOf(spent: number, budget: number): BudgetTone {
  if (budget <= 0) return spent > 0 ? "over" : "none";
  const pct = spent / budget;
  if (pct > 1) return "over";
  if (pct >= WARN_AT) return "warn";
  return "ok";
}

const SOLD = new Set(["ACCEPTED", "COMPLETED", "PAID"]);
const OPEN = new Set(["DRAFT", "SENT", "VIEWED"]);

export function summarizeBudget(input: {
  lines: BudgetLineIn[];
  /** Project.budget — used only when there are no lines. */
  projectBudget: number;
  spends: SpendIn[];
  proposals: ContractIn[];
  /** Approved change orders whose cost has no budget line yet. */
  uncosted?: UncostedChange[];
}): BudgetSummary {
  // The keys: the six, and each custom kind under its own name (a change order's labelled line counts under its
  // category). A spend names a custom kind exactly (any case) or falls onto the six by its words.
  const kinds = customKinds(input.lines);
  const kindKey = new Map(kinds.map((k) => [k.toLowerCase(), k]));
  const keyOf = (raw: string): string => {
    const custom = kindKey.get(raw.trim().toLowerCase());
    if (custom) return custom;
    return categoryOf(raw);
  };
  const budgetBy = new Map<string, number>();
  for (const l of input.lines) {
    const c = isBudgetCategory(l.category) ? l.category : (kindKey.get(l.category.trim().toLowerCase()) ?? "OTHER");
    budgetBy.set(c, (budgetBy.get(c) ?? 0) + Math.max(0, l.amount || 0));
  }
  const spentBy = new Map<string, number>();
  for (const s of input.spends) {
    const c = keyOf(s.category);
    spentBy.set(c, (spentBy.get(c) ?? 0) + Math.max(0, s.amount || 0));
  }
  const keys: string[] = [...BUDGET_CATEGORIES, ...kinds];

  const linesTotal = [...budgetBy.values()].reduce((a, b) => a + b, 0);
  // A change order's cost line (labelled) is an addition, not a split: a project still on its one figure stays unsplit,
  // its budget that figure (Project.budget holds it with the additions — actions/projectBudget).
  const categoryLines = input.lines.filter((l) => !l.label);
  const extras = input.lines.filter((l) => !!l.label).reduce((n, l) => n + Math.max(0, l.amount || 0), 0);
  const unsplit = categoryLines.length === 0 && input.projectBudget - extras > 0.005;
  const budget = unsplit ? input.projectBudget : linesTotal;
  const spent = [...spentBy.values()].reduce((a, b) => a + b, 0);

  const rows: CategoryRow[] = keys
    .map((c) => {
      const b = budgetBy.get(c) ?? 0;
      const s = spentBy.get(c) ?? 0;
      return { category: c, label: categoryLabel(c), budget: r2(b), spent: r2(s), remaining: r2(b - s), pct: b > 0 ? s / b : null, tone: toneOf(s, b) };
    })
    .filter((r) => r.budget > 0 || r.spent > 0);

  // An unsplit budget has no categories to hold an overrun against: the
  // projection is the larger of the whole budget and the whole spend.
  const projectedCost = unsplit ? Math.max(budget, spent) : keys.reduce((n, c) => n + Math.max(budgetBy.get(c) ?? 0, spentBy.get(c) ?? 0), 0);

  const sold = input.proposals.filter((p) => SOLD.has(p.status));
  const contract = sold.reduce((n, p) => n + Math.max(0, p.revenue || 0), 0);
  const billed = sold.reduce((n, p) => n + Math.max(0, p.billed || 0), 0);
  const pipeline = input.proposals.filter((p) => OPEN.has(p.status)).reduce((n, p) => n + Math.max(0, p.revenue || 0), 0);

  // Approved change orders with no cost line yet: counted at the project's own planned cost share — the budget against
  // what the proposals priced before those changes — so a change never reads as pure profit. Without a budget to read a
  // share from, the change is counted at its full price (no profit claimed on it).
  const uncosted = (input.uncosted ?? []).filter((c) => c.amount > 0);
  const changeRevenue = uncosted.reduce((n, c) => n + c.amount, 0);
  const pricedBefore = contract + pipeline - changeRevenue;
  const costShare = budget > 0 && pricedBefore > 0 ? Math.min(1.5, budget / pricedBefore) : null;
  const changeAllowance = uncosted.reduce((n, c) => n + c.amount * (costShare ?? 1), 0);
  const projected = projectedCost + changeAllowance;

  const covered = contract + pipeline;
  const margin = covered > 0 ? covered - projected : null;
  const uncovered = covered > 0 && covered < projected ? projected - covered : 0;
  const marginState: MarginState = covered <= 0 ? "none" : uncovered > 0.005 ? "short" : pipeline > 0 ? "projected" : "sold";

  return {
    budget: r2(budget),
    unsplit,
    spent: r2(spent),
    remaining: r2(budget - spent),
    pct: budget > 0 ? spent / budget : null,
    tone: toneOf(spent, budget),
    contract: r2(contract),
    billed: r2(billed),
    salesTax: r2(Math.max(0, billed - contract)),
    pipeline: r2(pipeline),
    projectedCost: r2(projected),
    changeAllowance: r2(changeAllowance),
    uncosted,
    costShare,
    margin: margin == null ? null : r2(margin),
    marginPct: margin == null || covered <= 0 ? null : margin / covered,
    marginState,
    uncovered: r2(uncovered),
    overCategories: rows.filter((r) => r.tone === "over" && r.budget > 0).map((r) => r.category),
    rows,
  };
}
