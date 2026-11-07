// PAYMENT SCHEDULE — the one place money is derived from a proposal's
// installments. Pure: no db, no "use server", no Stripe. Imported by the
// builders (preview + lock warnings), the public portal (what the client can
// pay), the pay routes (what to charge) and the settle path (what a landed
// payment covers). Every amount here is an integer in minor units (cents) so
// three 33.33% stages add up to the total to the cent.
//
// Rules of record:
//   · A PAID/WAIVED stage is FROZEN at `paidAmount`. Editing the proposal
//     total never recomputes it.
//   · Unpaid percent stages recompute from the CURRENT total (largest-
//     remainder rounding); unpaid fixed stages keep their amount.
//   · `remainingMinor = total − paid` is authoritative. The stages are a
//     suggestion of how to split it; if they over-schedule, the last ones
//     clamp; if they under-schedule, a synthetic "Balance" row appears.
//   · Stages are paid in order: only the earliest UNPAID/PENDING stage is
//     `payable`, plus "pay remaining" for everything at once.

export type StageStatus = "UNPAID" | "PENDING" | "PAID" | "WAIVED";
export type PayProvider = "STRIPE" | "SQUARE" | "STAX";

export interface StageInput {
  id: string;
  label: string;
  amount: number;
  isPercent: boolean;
  position: number;
  status?: string | null;
  paidAmount?: number | null;
  /** The approved change order this stage collects, when it is one. */
  changeOrderId?: string | null;
}

export interface ResolvedStage {
  id: string;
  label: string;
  position: number;
  status: StageStatus;
  isPercent: boolean;
  /** Percent of total for percent stages (display), else null. */
  pct: number | null;
  /** What this stage is worth right now (frozen when PAID/WAIVED). */
  amountMinor: number;
  paidAmountMinor: number;
  /** True only for the earliest unpaid stage with money on it. */
  payable: boolean;
  /** Synthetic rows (implicit full-payment / balance) have no DB row. */
  synthetic: boolean;
}

export interface ResolvedSchedule {
  currency: string;
  totalMinor: number;
  paidMinor: number;
  /** total − paid. What the client still owes, whatever the stages say. */
  remainingMinor: number;
  /** Sum of unpaid stage amounts after clamping to `remainingMinor`. */
  scheduledUnpaidMinor: number;
  /** paid + raw unpaid − total. >0 over-scheduled, <0 under-scheduled, 0 exact. */
  mismatchMinor: number;
  /** remaining − scheduledUnpaid when the stages under-schedule. */
  balanceMinor: number;
  hasBalanceRow: boolean;
  stages: ResolvedStage[];
  nextPayableId: string | null;
  /** No DB installments: one synthetic 100% stage stands in. */
  implicit: boolean;
  /** How many DB-backed stages are still collectable. */
  unpaidCount: number;
}

export const IMPLICIT_STAGE_ID = "__total__";
export const BALANCE_STAGE_ID = "__balance__";
export const IMPLICIT_STAGE_LABEL = "Full payment";
export const BALANCE_STAGE_LABEL = "Balance";

/** Provider minimum charge in minor units (USD). Stripe $0.50, Square $1.00. */
export const MIN_MINOR: Record<PayProvider, number> = { STRIPE: 50, SQUARE: 100, STAX: 100 };

export function toMinor(dollars: number): number {
  return Math.round((Number.isFinite(dollars) ? dollars : 0) * 100);
}
export function fromMinor(minor: number): number {
  return Math.round(minor) / 100;
}

/* ============================================================
   THE %/$ UNIT TOGGLE — builder-side, but a money rule
   ============================================================

   Flipping the unit on a stage used to flip `isPercent` and leave `amount`
   where it was, in all six builder skins: a 30% stage became a $30 stage, and
   $1,619.47 became 1619.47% of the total. Six copies of the control, six
   copies of the bug — so the conversion lives here, next to the resolver whose
   arithmetic it has to agree with, and every skin calls it.

   The money stands still. A percentage becomes the figure this module would
   bill for that stage, to the cent; a dollar figure becomes a percentage to
   two decimals, which is as fine as a percentage is ever typed. Two decimals
   can move real money on a large contract — $333,333.33 of $1,000,000 is
   33.3333…%, which prints as 33.33% and is worth $33.33 less — so the
   difference lands on the LAST other stage, the way `cleanRemaining` in
   settle.ts puts the balance on the last stage it pays. The schedule therefore
   covers exactly what it covered before the click.

   Two shapes, one implementation: skins that own the list write the list, and
   skins that can only patch one row at a time apply the patches. */

export interface UnitToggleStage {
  id: string;
  /** Dollars, or a PERCENT of the total when `isPercent`. */
  amount: number;
  isPercent: boolean;
  status?: string | null;
}

export interface UnitTogglePatch {
  id: string;
  patch: { isPercent?: boolean; amount: number };
}

/** A stage in minor units, rounded the way this module rounds one stage. */
function stageMinor(stage: UnitToggleStage, totalMinor: number): number {
  const amount = Number.isFinite(stage.amount) ? stage.amount : 0;
  return stage.isPercent ? Math.round((totalMinor * amount) / 100) : toMinor(amount);
}

function pctOf(minor: number, totalMinor: number): number {
  return Math.round((minor / totalMinor) * 10000) / 100;
}

/**
 * The stage list with `id` switched to percent or dollars and its value
 * converted with it. A no-op when the stage is already in that unit — the
 * segmented controls fire on every tap, including the unit already chosen, and
 * converting twice would turn $3,761.05 into 3761.05%.
 *
 * With no total to convert against (a draft with no priced lines yet) the unit
 * changes and the field is cleared: a percentage of nothing, and a dollar
 * figure derived from nothing, are both fiction, and a fresh stage starts at 0
 * the same way.
 */
export function applyUnitToggle<T extends UnitToggleStage>(
  stages: readonly T[],
  id: string,
  toPercent: boolean,
  total: number,
): T[] {
  const rows = [...stages];
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0 || rows[idx].isPercent === toPercent) return rows;

  const totalMinor = toMinor(total);
  if (totalMinor <= 0) {
    rows[idx] = { ...rows[idx], isPercent: toPercent, amount: 0 };
    return rows;
  }

  const sum = (list: readonly T[]) => list.reduce((n, r) => n + stageMinor(r, totalMinor), 0);
  const before = sum(rows);
  const minor = stageMinor(rows[idx], totalMinor);
  rows[idx] = {
    ...rows[idx],
    isPercent: toPercent,
    amount: toPercent ? pctOf(minor, totalMinor) : fromMinor(minor),
  };

  const drift = before - sum(rows);
  if (drift === 0) return rows;
  // The last stage that is neither the one just converted nor SETTLED:
  // nudging the converted row would undo the conversion the user asked for,
  // and a paid, waived or checkout-pending stage is refused by the save
  // itself ("its amount can't change" — src/actions/proposals.ts).
  let absorber = -1;
  for (let n = rows.length - 1; n >= 0; n -= 1) {
    const st = normStatus(rows[n].status);
    if (n !== idx && st === "UNPAID") {
      absorber = n;
      break;
    }
  }
  // Nowhere to put it: the difference stays visible in the card's own
  // "scheduled $X of $Y" line rather than being hidden in a settled stage.
  if (absorber < 0) return rows;
  const target = stageMinor(rows[absorber], totalMinor) + drift;
  rows[absorber] = {
    ...rows[absorber],
    amount: rows[absorber].isPercent ? pctOf(target, totalMinor) : fromMinor(target),
  };
  return rows;
}

/** The same conversion for a skin that can only patch one stage at a time. */
export function unitTogglePatches<T extends UnitToggleStage>(
  stages: readonly T[],
  id: string,
  toPercent: boolean,
  total: number,
): UnitTogglePatch[] {
  const next = applyUnitToggle(stages, id, toPercent, total);
  const out: UnitTogglePatch[] = [];
  next.forEach((row, n) => {
    const was = stages[n];
    if (!was || (was.amount === row.amount && was.isPercent === row.isPercent)) return;
    out.push({
      id: row.id,
      patch:
        was.isPercent === row.isPercent
          ? { amount: row.amount }
          : { isPercent: row.isPercent, amount: row.amount },
    });
  });
  return out;
}

/** Largest-remainder split of a set of percentages over a base, in minor
 *  units: three 33.33% stages of an odd total still add up to the total, to
 *  the cent. Shared by the resolver and by the builders' coverage read below,
 *  so a card and an invoice never round a stage differently. */
function allocatePercentMinor(pcts: readonly number[], baseMinor: number): number[] {
  const sumPct = pcts.reduce((n, p) => n + p, 0);
  const target = Math.round((baseMinor * sumPct) / 100);
  const raws = pcts.map((p) => (baseMinor * p) / 100);
  const floors = raws.map((r) => Math.floor(r));
  let leftover = target - floors.reduce((n, f) => n + f, 0);
  const order = raws
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (leftover <= 0) break;
    floors[i] += 1;
    leftover -= 1;
  }
  return floors.map((f) => Math.max(0, f));
}

/* ============================================================
   WHAT THE SCHEDULE COVERS — the builders' reading
   ============================================================

   The builder cards print "Scheduled $X of $Y" and a Balanced / Over / Short
   badge. They used to sum every stage as "a percent of the current total, or
   its dollar amount", which ignores the rule this module exists to keep: a
   PAID or WAIVED stage is FROZEN at what it actually collected. On a contract
   whose stages are mostly paid the card therefore invented money — a covered
   $5,398.24 contract read "Scheduled $6,177.18 of $5,398.24", because two paid
   stages were re-derived from their percentages instead of being taken at the
   $1,619.47 and $3,000.00 that landed on them.

   So the cards read their figures here, with the same arithmetic the money
   uses. One difference, on purpose: these amounts are NOT clamped to the
   balance. Clamping is what the money path does to avoid collecting more than
   is owed; a builder that clamped could never say "over by $420", which is the
   one thing the badge is for. `mismatchMinor` in resolveSchedule is the same
   figure this reports as `difference`. */

export type CoverageState = "none" | "under" | "exact" | "over";

export interface CoverageStage {
  id?: string;
  /** Dollars, or a PERCENT of the base when `isPercent`. */
  amount: number;
  isPercent: boolean;
  status?: string | null;
  paidAmount?: number | null;
}

export interface ScheduleCoverage {
  /** What each stage is worth on the card, in dollars, by stage id (or index
   *  for a row that has none yet). A settled stage is what it collected. */
  byId: Record<string, number>;
  /** The same figures in row order. */
  values: number[];
  covered: number;
  coveredMinor: number;
  total: number;
  /** covered − total. Positive is over-scheduled, negative is short. */
  difference: number;
  state: CoverageState;
}

/**
 * What a draft schedule covers, and whether that balances the contract.
 * `pctBase` is what percent stages are percentages OF — the original total,
 * which differs from `total` only once approved change orders are in play.
 */
export function scheduleCoverage(
  stages: readonly CoverageStage[],
  total: number,
  pctBase: number = total,
): ScheduleCoverage {
  const totalMinor = Math.max(0, toMinor(total));
  const pctBaseMinor = Math.max(0, toMinor(pctBase));
  const values: number[] = new Array(stages.length).fill(0);
  const minors: number[] = new Array(stages.length).fill(0);

  // A settled stage is frozen at what it collected; a waived one collected
  // nothing. Everything else is still a plan, and is read as one.
  const openIdx: number[] = [];
  stages.forEach((s, i) => {
    const st = normStatus(s.status);
    if (st === "PAID") minors[i] = Math.max(0, toMinor(s.paidAmount ?? 0));
    else if (st === "WAIVED") minors[i] = 0;
    else openIdx.push(i);
  });

  // Split over every percent stage but the waived, so an open stage keeps the cents it showed (as resolveSchedule).
  const pctIdx = stages.map((s, i) => i).filter((i) => stages[i].isPercent && normStatus(stages[i].status) !== "WAIVED");
  if (pctIdx.some((i) => openIdx.includes(i))) {
    const alloc = allocatePercentMinor(
      pctIdx.map((i) => (Number.isFinite(stages[i].amount) ? stages[i].amount : 0)),
      pctBaseMinor,
    );
    pctIdx.forEach((i, n) => {
      if (openIdx.includes(i)) minors[i] = alloc[n];
    });
  }
  for (const i of openIdx) {
    if (!stages[i].isPercent) minors[i] = Math.max(0, toMinor(stages[i].amount));
  }

  const byId: Record<string, number> = {};
  let coveredMinor = 0;
  stages.forEach((s, i) => {
    values[i] = fromMinor(minors[i]);
    byId[s.id ?? String(i)] = values[i];
    coveredMinor += minors[i];
  });

  const differenceMinor = coveredMinor - totalMinor;
  const state: CoverageState =
    stages.length === 0 || totalMinor <= 0
      ? "none"
      : // A cent of slack: saying "over" about one cent of rounding is the kind
        // of false alarm that trains people to ignore the badge.
        Math.abs(differenceMinor) < 1
        ? "exact"
        : differenceMinor > 0
          ? "over"
          : "under";

  return {
    byId,
    values,
    covered: fromMinor(coveredMinor),
    coveredMinor,
    total: fromMinor(totalMinor),
    difference: fromMinor(differenceMinor),
    state,
  };
}

function normStatus(s: string | null | undefined): StageStatus {
  return s === "PAID" || s === "PENDING" || s === "WAIVED" ? s : "UNPAID";
}

export function resolveSchedule(input: {
  /** The CONTRACT value the client owes: proposal total + approved change orders (lib/contractTotal). */
  total: number;
  /**
   * What percent stages are percentages OF — the ORIGINAL proposal total.
   * Required on purpose (2026-09-13): a change order raises `total` without
   * touching the 30% / 70% stages, which stay 30% / 70% of the original;
   * the change order is its own fixed stage. Passing `total` here would
   * silently grow every unpaid percent stage by its share of the change.
   */
  pctBase: number;
  currency?: string;
  installments: StageInput[];
}): ResolvedSchedule {
  const currency = (input.currency ?? "USD").toUpperCase();
  const totalMinor = Math.max(0, toMinor(input.total));
  const pctBaseMinor = Math.max(0, toMinor(input.pctBase));
  const sorted = [...input.installments].sort((a, b) => a.position - b.position);

  const implicit = sorted.length === 0;
  const source: StageInput[] = implicit
    ? [
        {
          id: IMPLICIT_STAGE_ID,
          label: IMPLICIT_STAGE_LABEL,
          amount: 100,
          isPercent: true,
          position: 0,
          status: "UNPAID",
        },
      ]
    : sorted;

  // ── settled stages: frozen ────────────────────────────────────────────
  const stages: ResolvedStage[] = source.map((s) => {
    const status = normStatus(s.status);
    const settled = status === "PAID" || status === "WAIVED";
    const paidAmountMinor = status === "PAID" ? Math.max(0, toMinor(s.paidAmount ?? 0)) : 0;
    return {
      id: s.id,
      label: s.label,
      position: s.position,
      status,
      isPercent: s.isPercent,
      pct: s.isPercent ? s.amount : null,
      amountMinor: settled ? paidAmountMinor : 0, // unpaid filled below
      paidAmountMinor,
      payable: false,
      synthetic: s.id === IMPLICIT_STAGE_ID,
    };
  });

  const paidMinor = stages.reduce((n, s) => n + (s.status === "PAID" ? s.paidAmountMinor : 0), 0);
  const remainingMinor = Math.max(0, totalMinor - paidMinor);

  // ── unpaid percent stages: largest-remainder over the current total ───
  const unpaid = stages.filter((s) => s.status === "UNPAID" || s.status === "PENDING");
  // Split over every percent stage, the paid ones too, so each keeps the cents it showed when the schedule was made
  // (2026-11-06: 30/40/30 of $36,242.25 read $10,872.68 / $14,496.90 / $10,872.67; once the deposit was paid the last
  // two were re-split alone, completion became $10,872.68 and the cent came off a $1,250 change order: $1,249.99).
  // Only the unpaid ones take their share; a paid stage stays frozen at what it collected.
  const pctAll = stages.filter((s) => s.isPercent && s.status !== "WAIVED");
  if (pctAll.some((s) => s.status === "UNPAID" || s.status === "PENDING")) {
    const alloc = allocatePercentMinor(pctAll.map((s) => s.pct ?? 0), pctBaseMinor);
    pctAll.forEach((s, i) => {
      if (s.status === "UNPAID" || s.status === "PENDING") s.amountMinor = alloc[i];
    });
  }
  for (const s of unpaid) {
    if (!s.isPercent) s.amountMinor = Math.max(0, toMinor(source.find((x) => x.id === s.id)!.amount));
  }

  const rawUnpaid = unpaid.reduce((n, s) => n + s.amountMinor, 0);
  const mismatchMinor = paidMinor + rawUnpaid - totalMinor;

  // ── clamp in order so Σ unpaid ≤ remaining ────────────────────────────
  let running = 0;
  for (const s of unpaid) {
    const allowed = Math.max(0, remainingMinor - running);
    if (s.amountMinor > allowed) s.amountMinor = allowed;
    running += s.amountMinor;
  }
  const scheduledUnpaidMinor = running;
  const balanceMinor = Math.max(0, remainingMinor - scheduledUnpaidMinor);
  const hasBalanceRow = balanceMinor > 0;

  const next = unpaid.find((s) => s.amountMinor > 0) ?? null;
  if (next) next.payable = true;

  return {
    currency,
    totalMinor,
    paidMinor,
    remainingMinor,
    scheduledUnpaidMinor,
    mismatchMinor,
    balanceMinor,
    hasBalanceRow,
    stages,
    nextPayableId: next?.id ?? null,
    implicit,
    unpaidCount: unpaid.filter((s) => s.amountMinor > 0).length,
  };
}

export type PayTarget = { installmentId: string } | "remaining";

export class NotPayableError extends Error {
  constructor(
    public readonly reason:
      | "nothing_due"
      | "not_next"
      | "unknown_stage"
      | "already_paid"
      | "zero_amount",
  ) {
    super(`Stage not payable: ${reason}`);
    this.name = "NotPayableError";
  }
}

export interface PayAmount {
  kind: "installment" | "remaining";
  amountMinor: number;
  /** DB-backed stage ids this charge covers (synthetic ids excluded). */
  installmentIds: string[];
  label: string;
}

/** What to charge for a target. Enforces the sequential rule. */
export function amountForTarget(schedule: ResolvedSchedule, target: PayTarget): PayAmount {
  if (schedule.remainingMinor <= 0) throw new NotPayableError("nothing_due");
  if (target === "remaining") {
    const ids = schedule.stages
      .filter((s) => (s.status === "UNPAID" || s.status === "PENDING") && s.amountMinor > 0)
      .map((s) => s.id);
    return {
      kind: "remaining",
      amountMinor: schedule.remainingMinor,
      installmentIds: ids.filter((id) => id !== IMPLICIT_STAGE_ID),
      label: ids.length > 1 || schedule.hasBalanceRow ? "Remaining balance" : stageLabel(schedule, ids[0]),
    };
  }
  const stage = schedule.stages.find((s) => s.id === target.installmentId);
  if (!stage) throw new NotPayableError("unknown_stage");
  if (stage.status === "PAID" || stage.status === "WAIVED") throw new NotPayableError("already_paid");
  if (stage.amountMinor <= 0) throw new NotPayableError("zero_amount");
  if (schedule.nextPayableId !== stage.id) throw new NotPayableError("not_next");
  return {
    kind: "installment",
    amountMinor: stage.amountMinor,
    installmentIds: stage.id === IMPLICIT_STAGE_ID ? [] : [stage.id],
    label: stage.label,
  };
}

function stageLabel(schedule: ResolvedSchedule, id: string | undefined): string {
  return schedule.stages.find((s) => s.id === id)?.label ?? "Payment";
}

export interface PaymentApplication {
  /** Stages fully covered → PAID at this many cents. */
  markPaid: { id: string; paidAmountMinor: number }[];
  /** A stage only partly covered: record the paid part as its own PAID row
   *  and shrink the original to a fixed remainder. */
  split: { id: string; paidPartMinor: number; remainderMinor: number } | null;
  /** When the payment covered money no stage was holding (balance row) and
   *  no stage was marked in this pass — needs a new PAID "Balance" row. */
  newBalanceStage: { paidAmountMinor: number } | null;
  /** Money beyond what the proposal owes. Never dropped; flagged for refund. */
  unappliedMinor: number;
  /** Stages left unpaid after this payment closed out the proposal. */
  waive: string[];
  /** paid + applied ≥ total. */
  settlesProposal: boolean;
}

/**
 * Greedy, in position order, over the CURRENT schedule. Used when a landed
 * payment cannot be trusted to line up 1:1 with the stages it was minted for
 * (schedule edited under it, second tab paid, manual amount).
 */
export function applyPaymentToSchedule(
  schedule: ResolvedSchedule,
  amountMinor: number,
): PaymentApplication {
  let left = Math.max(0, Math.round(amountMinor));
  const markPaid: PaymentApplication["markPaid"] = [];
  let split: PaymentApplication["split"] = null;
  const unpaid = schedule.stages.filter(
    (s) => (s.status === "UNPAID" || s.status === "PENDING") && !s.synthetic,
  );

  for (const s of unpaid) {
    if (left <= 0) break;
    if (s.amountMinor <= 0) continue;
    if (left >= s.amountMinor) {
      markPaid.push({ id: s.id, paidAmountMinor: s.amountMinor });
      left -= s.amountMinor;
    } else {
      split = { id: s.id, paidPartMinor: left, remainderMinor: s.amountMinor - left };
      left = 0;
    }
  }

  // Money the stages were not holding (under-scheduled balance, or the
  // implicit stage) sticks to the last stage we marked, or becomes its own row.
  const owedBeyondStages = Math.max(
    0,
    schedule.remainingMinor - unpaid.reduce((n, s) => n + s.amountMinor, 0),
  );
  let newBalanceStage: PaymentApplication["newBalanceStage"] = null;
  if (left > 0 && owedBeyondStages > 0) {
    const take = Math.min(left, owedBeyondStages);
    if (markPaid.length) markPaid[markPaid.length - 1].paidAmountMinor += take;
    else newBalanceStage = { paidAmountMinor: take };
    left -= take;
  }
  const appliedMinor = Math.max(0, Math.round(amountMinor)) - left;
  const settlesProposal = schedule.paidMinor + appliedMinor >= schedule.totalMinor;

  const markedIds = new Set(markPaid.map((m) => m.id));
  const waive = settlesProposal
    ? unpaid.filter((s) => !markedIds.has(s.id) && s.id !== split?.id).map((s) => s.id)
    : [];

  return { markPaid, split, newBalanceStage, unappliedMinor: left, waive, settlesProposal };
}

/** JobFlex's cut, in minor units. Stripe: ≤ amount. Square: ≤ 90% of amount. */
export function platformFeeMinor(amountMinor: number, provider: PayProvider, bps: number): number {
  const raw = Math.floor((Math.max(0, amountMinor) * Math.max(0, bps)) / 10_000);
  const cap = provider === "SQUARE" ? Math.floor(amountMinor * 0.9) : amountMinor;
  return Math.max(0, Math.min(raw, cap));
}

export function isBelowMin(amountMinor: number, provider: PayProvider): boolean {
  return amountMinor > 0 && amountMinor < MIN_MINOR[provider];
}

/** Did anything a client could be asked to pay change? Drives scheduleVersion. */
export function diffUnpaid(before: ResolvedSchedule, after: ResolvedSchedule): boolean {
  const pick = (s: ResolvedSchedule) =>
    s.stages
      .filter((x) => x.status === "UNPAID" || x.status === "PENDING")
      .map((x) => `${x.id}|${x.label}|${x.amountMinor}|${x.isPercent ? 1 : 0}`)
      .join("\n");
  return pick(before) !== pick(after) || before.remainingMinor !== after.remainingMinor;
}

/** Percent share a stage represents of the total, for display ("30%"). */
export function stageShare(stage: ResolvedStage, totalMinor: number): string {
  if (stage.pct !== null) return `${trimPct(stage.pct)}%`;
  if (totalMinor <= 0) return "";
  return `${trimPct((stage.amountMinor / totalMinor) * 100)}%`;
}
function trimPct(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}
