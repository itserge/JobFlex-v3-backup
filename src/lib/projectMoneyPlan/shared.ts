// WHO IT IS FOR, AND THE MONEY — the pure half (2026-11-07, the plan "Projects: Remodel and New construction", part
// 5). A build is for a client — the client has a budget and the contractor earns on the work: one margin on the whole
// project, a margin per job (each phase's trade job carries its own), or cost-plus (the client sees the costs and pays
// a fee) — or for the contractor themself: a spec house, their own home, a flip; no margin, one budget from the land
// to the keys, and the project is a cost tracker. Either way the budget is laid out from the total by the phases'
// shares, and every phase reads budget, spent, committed, left and where it is heading — a phase 60% done and 80%
// spent is over before it is late. The advisor, "where to save, where to squeeze", is rules ranked by dollars saved,
// never a model: lower an allowance, re-bid a sub, swap a material, self-perform, defer scope, move contingency —
// and on a client build, when the overrun is the client's, a change order first. Pure: no database, no clock; the
// card, the Operator and the checks read one definition. The database half is ./server.ts.

// ── who it is for, how the money is made ─────────────────────────────────────

export const FOR_WHOM = ["CLIENT", "SELF"] as const;
export type ForWhom = (typeof FOR_WHOM)[number];
export const MONEY_MODES = ["PROJECT_MARGIN", "JOB_MARGIN", "COST_PLUS", "NONE"] as const;
export type MoneyMode = (typeof MONEY_MODES)[number];

export const FOR_WHOM_LABEL: Record<ForWhom, string> = { CLIENT: "For a client", SELF: "For myself" };
export const FOR_WHOM_HINT: Record<ForWhom, string> = {
  CLIENT: "The client has a budget; you earn a margin or a fee on the work.",
  SELF: "A spec house, your own home, a flip: one budget from the land to the keys, no margin.",
};
export const MONEY_MODE_LABEL: Record<MoneyMode, string> = { PROJECT_MARGIN: "One margin on the whole project", JOB_MARGIN: "A margin per job", COST_PLUS: "Cost-plus", NONE: "No margin — a cost tracker" };
export const MONEY_MODE_HINT: Record<MoneyMode, string> = {
  PROJECT_MARGIN: "The contract is the cost budget plus one margin.",
  JOB_MARGIN: "Each phase's trade job carries its own markup, the way proposals do.",
  COST_PLUS: "The client sees the costs and pays a fee — a percentage or a fixed amount.",
  NONE: "What it costs is what it costs; profit shows only against a sale price.",
};

export const isForWhom = (v: unknown): v is ForWhom => typeof v === "string" && (FOR_WHOM as readonly string[]).includes(v);
export const isMoneyMode = (v: unknown): v is MoneyMode => typeof v === "string" && (MONEY_MODES as readonly string[]).includes(v);

export type MoneySettings = {
  forWhom: ForWhom;
  moneyMode: MoneyMode;
  /** The margin (or, on cost-plus with no fixed fee, the fee) as a percent of the cost — 18 means 18%. */
  marginPct: number | null;
  /** Cost-plus: a fixed fee in dollars, which wins over the percent. */
  feeAmount: number | null;
  /** A spec house's sale price: profit at this pace shows against it. */
  salePrice: number | null;
};

/** The mode a build starts with: a client build earns one margin on the whole; one's own build tracks costs. */
export const defaultMode = (forWhom: ForWhom): MoneyMode => (forWhom === "CLIENT" ? "PROJECT_MARGIN" : "NONE");

/** A stored row read tolerantly: anything odd is a client build with no margin mode (every project made before this). */
export function parseMoneySettings(row: { forWhom?: unknown; moneyMode?: unknown; marginPct?: unknown; feeAmount?: unknown; salePrice?: unknown } | null | undefined): MoneySettings {
  const forWhom = isForWhom(row?.forWhom) ? row!.forWhom : "CLIENT";
  let moneyMode = isMoneyMode(row?.moneyMode) ? row!.moneyMode : "NONE";
  if (forWhom === "SELF") moneyMode = "NONE";
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  return { forWhom, moneyMode, marginPct: num(row?.marginPct), feeAmount: num(row?.feeAmount), salePrice: num(row?.salePrice) };
}

/** "for a client · one margin on the whole project, 18%" / "for yourself · cost-plus, a $45,000 fee" / "for yourself · sale price $780,000". */
export function settingsWords(s: MoneySettings): string {
  const who = s.forWhom === "SELF" ? "for yourself" : "for a client";
  if (s.forWhom === "SELF") return `${who}${s.salePrice != null ? ` · sale price ${dollars(s.salePrice)}` : " · a cost tracker"}`;
  const mode = MONEY_MODE_LABEL[s.moneyMode].toLowerCase();
  const how = s.moneyMode === "COST_PLUS" ? (s.feeAmount != null ? `, a ${dollars(s.feeAmount)} fee` : s.marginPct != null ? `, a ${pct(s.marginPct)} fee` : "") : s.moneyMode === "NONE" ? "" : s.marginPct != null ? `, ${pct(s.marginPct)}` : "";
  return `${who} · ${mode}${how}`;
}

/** What the client pays for a cost budget under the settings: cost plus the margin, cost plus the fee, or null when
 *  nothing is earned on it (one's own build, or no mode). The contract itself is the sold proposals' total when there
 *  is one; this is the figure the budget implies, for the read-back and for a project with no proposal yet. */
export function priceFromCost(cost: number, s: MoneySettings): number | null {
  if (s.forWhom === "SELF" || s.moneyMode === "NONE") return null;
  if (s.moneyMode === "COST_PLUS") return s.feeAmount != null ? r2(cost + s.feeAmount) : s.marginPct != null ? r2(cost * (1 + s.marginPct / 100)) : null;
  return s.marginPct != null ? r2(cost * (1 + s.marginPct / 100)) : null;
}

// ── the budget laid out from the total ───────────────────────────────────────

/** The total split over the phases by their shares, to the dollar: the largest remainders take the odd dollars. A
 *  phase with a budget of its own already keeps it when `keep` says so. */
export function layoutPhaseBudgets(total: number, phases: ReadonlyArray<{ id: string; share: number; budget?: number | null }>, opts: { keep?: boolean } = {}): Array<{ id: string; budget: number }> {
  const open = phases.filter((p) => !(opts.keep && p.budget != null && p.budget > 0));
  const kept = phases.filter((p) => !open.includes(p)).reduce((n, p) => n + (p.budget ?? 0), 0);
  const pool = Math.max(0, Math.round(total - kept));
  const weight = open.reduce((n, p) => n + Math.max(0, p.share), 0);
  if (!open.length || weight <= 0) return phases.map((p) => ({ id: p.id, budget: Math.round(p.budget ?? 0) }));
  const raw = open.map((p) => ({ id: p.id, exact: (pool * Math.max(0, p.share)) / weight }));
  const floors = raw.map((r) => ({ id: r.id, budget: Math.floor(r.exact), rest: r.exact - Math.floor(r.exact) }));
  let left = pool - floors.reduce((n, f) => n + f.budget, 0);
  for (const f of [...floors].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    f.budget += 1;
    left -= 1;
  }
  const byId = new Map(floors.map((f) => [f.id, f.budget]));
  return phases.map((p) => ({ id: p.id, budget: byId.get(p.id) ?? Math.round(p.budget ?? 0) }));
}

// ── a phase's money ──────────────────────────────────────────────────────────

export type PhaseMoneyIn = {
  id: string;
  name: string;
  status: "PLANNED" | "ACTIVE" | "DONE";
  budget: number;
  spent: number;
  committed: number;
  /** 0–1: how far along the phase is by its stages' tasks and weights. */
  done: number;
};

export type PhaseMoney = PhaseMoneyIn & {
  left: number;
  /** Spent and committed, plus what the work still to do is expected to cost at this pace. */
  headingFor: number;
  /** Heading-for less the budget: positive when the phase is over. */
  over: number;
};

/**
 * Where a phase is heading: done → what it cost; not started → the budget, or more when something is already spent
 * or committed on it; under way → the spend so far scaled by how far along it is (60% done and 80% spent heads for
 * 133% of the budget), never less than what is already spent and committed, and never less than the budget when it is
 * barely started (under 10%, the scaling would say more than anyone knows).
 */
export function phaseHeading(p: Pick<PhaseMoneyIn, "status" | "budget" | "spent" | "committed" | "done">): number {
  const so = p.spent + p.committed;
  if (p.status === "DONE") return r2(so);
  if (p.status === "PLANNED" || p.done < 0.1) return r2(Math.max(p.budget, so));
  return r2(Math.max(so, Math.max(p.budget, so) > 0 ? so / Math.min(1, p.done) : 0));
}

export function phaseMoney(p: PhaseMoneyIn): PhaseMoney {
  const headingFor = phaseHeading(p);
  return { ...p, left: r2(p.budget - p.spent - p.committed), headingFor, over: r2(headingFor - p.budget) };
}

export type MoneyTotals = { budget: number; spent: number; committed: number; left: number; headingFor: number; over: number };

/** The project's figures: the phases plus what is on no phase (labor, stock, a cost logged without one). */
export function moneyTotals(phases: readonly PhaseMoney[], loose: { budget: number; spent: number; committed: number }): MoneyTotals {
  const budget = r2(phases.reduce((n, p) => n + p.budget, 0) + loose.budget);
  const spent = r2(phases.reduce((n, p) => n + p.spent, 0) + loose.spent);
  const committed = r2(phases.reduce((n, p) => n + p.committed, 0) + loose.committed);
  const headingFor = r2(phases.reduce((n, p) => n + p.headingFor, 0) + Math.max(loose.budget, loose.spent + loose.committed));
  return { budget, spent, committed, left: r2(budget - spent - committed), headingFor, over: r2(headingFor - budget) };
}

/** A client build's margin at this pace — the contract less what the work is heading for — or a spec house's profit
 *  against its sale price; null with nothing to measure against. */
export function marginAtPace(contract: number | null, headingFor: number): { amount: number; pct: number | null } | null {
  if (contract == null || contract <= 0) return null;
  const amount = r2(contract - headingFor);
  return { amount, pct: Math.round((amount / contract) * 1000) / 10 };
}

// ── the advisor ──────────────────────────────────────────────────────────────

export type AdviceKind = "change_order" | "lower_allowance" | "rebid_sub" | "swap_material" | "self_perform" | "defer_scope" | "move_contingency";

export type AdvisorInput = {
  settings: MoneySettings;
  totals: MoneyTotals;
  phases: ReadonlyArray<PhaseMoney & { key: string }>;
  /** The selections not chosen yet, with their allowance and a cheaper figure when one is known (the proposal's lines). */
  selections: ReadonlyArray<{ id: string; name: string; allowance: number | null; chosen: boolean; price: number | null; cheaper: number | null; phaseName: string | null }>;
  /** The sub quotes awarded (or the lowest quoted) against the stage's budget line. */
  quotes: ReadonlyArray<{ id: string; stageId: string | null; stageName: string | null; contractor: string; amount: number | null; line: number | null; status: string; trade: string | null }>;
  /** Materials still to order whose store line has a cheaper twin, when Buying knows one. */
  swaps: ReadonlyArray<{ id: string; name: string; total: number; cheaperTotal: number; store: string | null }>;
  /** A phase's trade bid against what the crew would cost to do it, when both are known. */
  selfPerform: ReadonlyArray<{ phaseId: string; phaseName: string; bid: number; crew: number; hours: number; rate: number }>;
  /** The contingency line: budgeted and spent. */
  contingency: { budget: number; spent: number } | null;
};

export type Advice = {
  kind: AdviceKind;
  title: string;
  words: string;
  /** Dollars this would save, or move, against the overrun. */
  saves: number;
  /** What it costs besides money. */
  costs: "nothing" | "time" | "quality" | "scope";
  /** What one tap applies, by id — the server knows each. */
  ref: Record<string, string | number | null>;
  /** Whether the card can apply it in one tap; otherwise it is a thing to do. */
  tap: boolean;
};

/** The usual drop when a selection goes a tier down and nothing cheaper is priced: about 15% of the allowance. */
export const TIER_DOWN = 0.15;

/**
 * Where to save, where to squeeze — rules, ranked by dollars. On a client build with an overrun that is the client's
 * own (a selection chosen over its allowance), the first suggestion is a change order for the difference.
 */
export function advise(input: AdvisorInput): Advice[] {
  const out: Advice[] = [];
  const over = input.totals.over > 0 ? input.totals.over : 0;

  // 1. the client's own overrun → a change order first
  if (input.settings.forWhom === "CLIENT") {
    const overAllowance = input.selections.filter((s) => s.chosen && s.price != null && s.allowance != null && s.price > s.allowance);
    const sum = r2(overAllowance.reduce((n, s) => n + (s.price! - s.allowance!), 0));
    if (sum > 0) {
      out.push({
        kind: "change_order",
        title: `A change order for ${dollars(sum)} — the client's choices over their allowances`,
        words: `${overAllowance.map((s) => `${s.name} ${dollars(s.price! - s.allowance!)} over`).join(", ")}. The client picked above the allowance; the difference is theirs, not the margin's.`,
        saves: sum,
        costs: "nothing",
        ref: { selectionIds: overAllowance.map((s) => s.id).join(","), amount: sum },
        tap: false,
      });
    }
  }
  // 2. lower an allowance not chosen yet
  for (const s of input.selections) {
    if (s.chosen || s.allowance == null || s.allowance <= 0) continue;
    const cheaper = s.cheaper != null && s.cheaper < s.allowance ? s.cheaper : r2(s.allowance * (1 - TIER_DOWN));
    const saves = r2(s.allowance - cheaper);
    if (saves <= 0) continue;
    out.push({
      kind: "lower_allowance",
      title: `Lower the ${s.name.toLowerCase()} allowance to ${dollars(cheaper)}`,
      words: s.cheaper != null && s.cheaper < s.allowance ? `The proposal's lines price it at ${dollars(s.cheaper)}; the allowance is ${dollars(s.allowance)}.` : `A tier down usually saves about ${Math.round(TIER_DOWN * 100)}% — ${dollars(s.allowance)} to ${dollars(cheaper)}; nothing cheaper is priced yet.`,
      saves,
      costs: "quality",
      ref: { selectionId: s.id, allowance: cheaper },
      tap: true,
    });
  }
  // 3. re-bid a sub whose award is over its line
  for (const q of input.quotes) {
    if (q.status !== "AWARDED" || q.amount == null || q.line == null || q.amount <= q.line) continue;
    const saves = r2(q.amount - q.line);
    out.push({
      kind: "rebid_sub",
      title: `Re-bid ${q.stageName ?? "the work"} — ${q.contractor} is ${dollars(saves)} over the line`,
      words: `Awarded at ${dollars(q.amount)} against a ${dollars(q.line)} line. Two more ${q.trade ? q.trade.toLowerCase() : "contractors"} get the buy link; a quote under the line replaces the award.`,
      saves,
      costs: "time",
      ref: { quoteId: q.id, stageId: q.stageId, trade: q.trade },
      tap: true,
    });
  }
  // 4. swap a material not ordered yet
  for (const m of input.swaps) {
    const saves = r2(m.total - m.cheaperTotal);
    if (saves <= 0) continue;
    out.push({ kind: "swap_material", title: `Swap ${m.name} for the cheaper line${m.store ? ` at ${m.store}` : ""}`, words: `${dollars(m.total)} as listed, ${dollars(m.cheaperTotal)} for the store's cheaper line — not ordered yet.`, saves, costs: "quality", ref: { materialId: m.id }, tap: false });
  }
  // 5. self-perform a phase
  for (const p of input.selfPerform) {
    const saves = r2(p.bid - p.crew);
    if (saves <= 0) continue;
    out.push({ kind: "self_perform", title: `Self-perform ${p.phaseName} — the crew for ${dollars(p.crew)} against a ${dollars(p.bid)} bid`, words: `About ${Math.round(p.hours)} crew hours at ${dollars(p.rate)} an hour. Plan it on Schedule & crew; the bid stays until you decline it.`, saves, costs: "time", ref: { phaseId: p.phaseId }, tap: false });
  }
  // 6. defer scope the certificate of occupancy does not need
  for (const p of input.phases) {
    if (p.key !== "SHOP" || p.status !== "PLANNED") continue;
    const saves = r2(p.budget - p.spent - p.committed);
    if (saves <= 0) continue;
    out.push({ kind: "defer_scope", title: `Defer the shop — ${dollars(saves)} the certificate of occupancy does not need`, words: `The shop is its own lane; the house gets its CO without it. Deferring moves its budget out of the plan and records the decision; its stages stay to pick up later.`, saves, costs: "scope", ref: { phaseId: p.id }, tap: true });
  }
  // 7. move contingency: a phase finished under budget returns its slack
  const slack = input.phases.filter((p) => p.status === "DONE" && p.left > 0);
  const slackSum = r2(slack.reduce((n, p) => n + p.left, 0));
  if (slackSum > 0 && over > 0) {
    out.push({
      kind: "move_contingency",
      title: `Move ${dollars(Math.min(slackSum, over))} of slack from ${slack.map((p) => p.name).join(", ")} to the overrun`,
      words: `${slack.map((p) => `${p.name} finished ${dollars(p.left)} under`).join("; ")}. The slack covers ${Math.min(slackSum, over) >= over ? "the overrun" : `${dollars(Math.min(slackSum, over))} of the ${dollars(over)} overrun`}.`,
      saves: r2(Math.min(slackSum, over)),
      costs: "nothing",
      ref: { fromPhaseIds: slack.map((p) => p.id).join(","), amount: r2(Math.min(slackSum, over)) },
      tap: true,
    });
  }
  if (input.contingency && over > 0) {
    const avail = r2(input.contingency.budget - input.contingency.spent);
    if (avail > 0) {
      out.push({ kind: "move_contingency", title: `${dollars(Math.min(avail, over))} of contingency is still unspent`, words: `Contingency is spent only on an overrun nothing else covers — ${dollars(avail)} of ${dollars(input.contingency.budget)} is left. Spend it last.`, saves: r2(Math.min(avail, over)), costs: "nothing", ref: { contingency: avail }, tap: false });
    }
  }
  const rank: Record<Advice["costs"], number> = { nothing: 0, time: 1, quality: 2, scope: 3 };
  return out.sort((a, b) => (a.kind === "change_order" ? -1 : b.kind === "change_order" ? 1 : 0) || b.saves - a.saves || rank[a.costs] - rank[b.costs]);
}

/** "Over by $12,400 at this pace — the framing and the finishes" / "On budget — heading for $412,000 of $420,000". */
export function headlineWords(t: MoneyTotals, phases: readonly PhaseMoney[]): string {
  if (t.budget <= 0) return "No budget laid out yet";
  if (t.over > 0) {
    const where = phases.filter((p) => p.over > 0).sort((a, b) => b.over - a.over).slice(0, 2).map((p) => p.name.toLowerCase());
    return `Over by ${dollars(t.over)} at this pace${where.length ? ` — ${where.join(" and ")}` : ""}`;
  }
  return `On budget — heading for ${dollars(t.headingFor)} of ${dollars(t.budget)}`;
}

// ── words ────────────────────────────────────────────────────────────────────

export const dollars = (n: number) => (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");
export const pct = (n: number) => `${Math.round(n * 10) / 10}%`;
const r2 = (n: number) => Math.round(n * 100) / 100;
