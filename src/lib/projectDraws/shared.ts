// DRAWS — the pure half (2026-11-07, the plan "Projects: Remodel and New construction", part 6). A new build a lender
// finances is paid in draws: the lender releases a slice of the loan when a phase is closed and its inspections have
// passed — soft costs and the land after the permits, the foundation, the dry-in, the drywall, the final — holding
// back a retainage until the end. The office requests a draw with what the lender asks for bundled: the inspections
// passed, the photos, how far along the house is, what has been spent; the lender funds it; the Payments card shows
// draws on a new build where a remodel shows the client's progress payments. Pure: no database, no clock — the card,
// the Operator and the checks read one definition. The database half is ./server.ts.

import type { PhaseKey } from "@/lib/projectPhases/shared";

export const DRAW_STATUSES = ["PLANNED", "REQUESTED", "FUNDED"] as const;
export type DrawStatus = (typeof DRAW_STATUSES)[number];
export const DRAW_LABEL: Record<DrawStatus, string> = { PLANNED: "Planned", REQUESTED: "Requested", FUNDED: "Funded" };
export const drawStatusOf = (s: string): DrawStatus => (s === "REQUESTED" || s === "FUNDED" ? s : "PLANNED");

/** The usual retainage a lender holds back from each draw until the final, in percent. */
export const DEFAULT_RETAINAGE_PCT = 10;

export type DrawTemplate = { number: number; name: string; afterPhase: PhaseKey; pct: number };

/** The usual five draws, by the phase whose close releases each; the percents sum to 100. */
export const DEFAULT_DRAWS: readonly DrawTemplate[] = [
  { number: 1, name: "Soft costs and the land", afterPhase: "PERMITS", pct: 10 },
  { number: 2, name: "Foundation", afterPhase: "FOUNDATION", pct: 15 },
  { number: 3, name: "Dry-in", afterPhase: "FRAME", pct: 30 },
  { number: 4, name: "Drywall", afterPhase: "DRYWALL", pct: 25 },
  { number: 5, name: "Final", afterPhase: "FINAL", pct: 20 },
];

/** A schedule read tolerantly: percents whole, each between 1 and 100, summing to 100; else the usual five. */
export function parseSchedule(raw: unknown): DrawTemplate[] {
  if (!Array.isArray(raw) || !raw.length) return [...DEFAULT_DRAWS];
  const rows = raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x, i) => ({ number: i + 1, name: typeof x.name === "string" && x.name.trim() ? x.name.trim().slice(0, 80) : `Draw ${i + 1}`, afterPhase: (typeof x.afterPhase === "string" ? x.afterPhase : "FINAL") as PhaseKey, pct: typeof x.pct === "number" && Number.isFinite(x.pct) ? Math.round(x.pct) : 0 }));
  const sum = rows.reduce((n, r) => n + r.pct, 0);
  return rows.length && sum === 100 && rows.every((r) => r.pct >= 1) ? rows : [...DEFAULT_DRAWS];
}

/** The draws' dollars from the loan's total by their percents, to the dollar (the largest remainders take the odd
 *  dollars), so the five add up to the total exactly. */
export function drawAmounts(total: number, draws: ReadonlyArray<{ number: number; pct: number }>): Array<{ number: number; amount: number }> {
  const pool = Math.max(0, Math.round(total));
  const weight = draws.reduce((n, d) => n + Math.max(0, d.pct), 0);
  if (!draws.length || weight <= 0) return draws.map((d) => ({ number: d.number, amount: 0 }));
  const raw = draws.map((d) => ({ number: d.number, exact: (pool * Math.max(0, d.pct)) / weight }));
  const floors = raw.map((r) => ({ number: r.number, amount: Math.floor(r.exact), rest: r.exact - Math.floor(r.exact) }));
  let left = pool - floors.reduce((n, f) => n + f.amount, 0);
  for (const f of [...floors].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    f.amount += 1;
    left -= 1;
  }
  return floors.map((f) => ({ number: f.number, amount: f.amount }));
}

/** What the lender releases on a draw and what it holds back: the retainage comes off every draw but the final,
 *  which releases everything held. */
export function drawPayout(amount: number, retainagePct: number, isFinal: boolean, heldSoFar: number): { released: number; held: number; releasedRetainage: number } {
  const pct = Math.max(0, Math.min(50, retainagePct)) / 100;
  if (isFinal) return { released: r2(amount + heldSoFar), held: 0, releasedRetainage: r2(heldSoFar) };
  const held = r2(amount * pct);
  return { released: r2(amount - held), held, releasedRetainage: 0 };
}

// ── where the draws stand ────────────────────────────────────────────────────

export type DrawLike = {
  id: string;
  number: number;
  name: string;
  /** The phase whose close releases it (its key), or null when the office set the draw by hand. */
  afterPhase: string | null;
  pct: number;
  amount: number;
  status: string;
  requestedAt: string | null;
  fundedAt: string | null;
  retainagePct: number;
};

export type PhaseStateLike = { key: string; name: string; status: "PLANNED" | "ACTIVE" | "DONE"; holding: ReadonlyArray<{ name: string }> };

export type DrawRead = DrawLike & {
  state: DrawStatus;
  /** The phase it follows: its state, whether it is closed with its gate passed, and what still holds it. */
  phase: { key: string; name: string; status: "PLANNED" | "ACTIVE" | "DONE"; closed: boolean; waitsOn: string[] } | null;
  /** Planned and its phase closed with every inspection passed: the office can request it. */
  ready: boolean;
  payout: { released: number; held: number; releasedRetainage: number };
  isFinal: boolean;
};

/** Every draw with where it stands against the phases; `next` is the first not funded. */
export function readDraws(draws: readonly DrawLike[], phases: readonly PhaseStateLike[]): { draws: DrawRead[]; next: DrawRead | null; funded: number; requested: number; held: number; total: number } {
  const sorted = [...draws].sort((a, b) => a.number - b.number);
  const last = sorted[sorted.length - 1]?.number ?? 0;
  let heldSoFar = 0;
  const rows: DrawRead[] = sorted.map((d) => {
    const ph = d.afterPhase ? phases.find((p) => p.key === d.afterPhase) ?? null : null;
    const closed = ph ? ph.status === "DONE" && ph.holding.length === 0 : false;
    const isFinal = d.number === last;
    const payout = drawPayout(d.amount, d.retainagePct, isFinal, heldSoFar);
    const state = drawStatusOf(d.status);
    if (state === "FUNDED" && !isFinal) heldSoFar = r2(heldSoFar + payout.held);
    return { ...d, state, phase: ph ? { key: ph.key, name: ph.name, status: ph.status, closed, waitsOn: ph.holding.map((h) => h.name) } : null, ready: state === "PLANNED" && (ph ? closed : true), payout, isFinal };
  });
  return {
    draws: rows,
    next: rows.find((d) => d.state !== "FUNDED") ?? null,
    funded: r2(rows.filter((d) => d.state === "FUNDED").reduce((n, d) => n + d.payout.released, 0)),
    requested: r2(rows.filter((d) => d.state === "REQUESTED").reduce((n, d) => n + d.amount, 0)),
    held: r2(rows.filter((d) => d.state === "FUNDED" && !d.isFinal).reduce((n, d) => n + d.payout.held, 0) - rows.filter((d) => d.state === "FUNDED" && d.isFinal).reduce((n, d) => n + d.payout.releasedRetainage, 0)),
    total: r2(rows.reduce((n, d) => n + d.amount, 0)),
  };
}

/** "Draw 3, Dry-in · $126,000 · ready to request" / "waits on Framing and dry-in — Shear wall and nailing, Framing" / "requested Nov 12" / "funded Nov 20". */
export function drawWords(d: DrawRead): string {
  if (d.state === "FUNDED") return `funded${d.fundedAt ? ` ${dayWords(d.fundedAt)}` : ""}${d.payout.held ? ` · ${dollars(d.payout.held)} held` : d.payout.releasedRetainage ? ` · ${dollars(d.payout.releasedRetainage)} retainage released` : ""}`;
  if (d.state === "REQUESTED") return `requested${d.requestedAt ? ` ${dayWords(d.requestedAt)}` : ""} · ${dollars(d.payout.released)} to come`;
  if (d.ready) return "ready to request";
  // A phase still under way: the draw comes after it. One done but with an inspection not passed: it waits on that.
  if (d.phase) return d.phase.status === "DONE" && !d.phase.closed && d.phase.waitsOn.length ? `waits on ${d.phase.name} — ${d.phase.waitsOn.join(", ")}` : `after ${d.phase.name}`;
  return "planned";
}

// ── the request's bundle ─────────────────────────────────────────────────────

export type DrawSnapshot = {
  takenAt: string;
  /** 0–100 for the house. */
  done: number;
  phases: Array<{ name: string; status: string; done: number }>;
  inspections: Array<{ name: string; result: string; date: string | null; stage: string | null }>;
  photos: number;
  spent: number;
  committed: number;
  words: string;
};

/** What the lender gets with a request, in one object and one paragraph. */
export function snapshotFrom(input: { takenAt: string; done: number; phases: DrawSnapshot["phases"]; inspections: DrawSnapshot["inspections"]; photos: number; spent: number; committed: number; draw: { number: number; name: string; amount: number } }): DrawSnapshot {
  const passed = input.inspections.filter((i) => i.result === "PASSED");
  const closed = input.phases.filter((p) => p.status === "DONE");
  const words = `Draw ${input.draw.number}, ${input.draw.name} — ${dollars(input.draw.amount)}. The house is ${Math.round(input.done)}% done; ${closed.length} of ${input.phases.length} phases closed${closed.length ? ` (${closed.map((p) => p.name).join(", ")})` : ""}; ${passed.length} inspection${passed.length === 1 ? "" : "s"} passed${passed.length ? ` (${passed.map((i) => i.name).join(", ")})` : ""}; ${input.photos} photo${input.photos === 1 ? "" : "s"} on file; ${dollars(input.spent)} spent and ${dollars(input.committed)} committed so far.`;
  return { takenAt: input.takenAt, done: Math.round(input.done), phases: input.phases, inspections: input.inspections, photos: input.photos, spent: r2(input.spent), committed: r2(input.committed), words };
}

/** A stored snapshot read tolerantly. */
export function parseSnapshot(json: string | null | undefined): DrawSnapshot | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Partial<DrawSnapshot> | null;
    if (!raw || typeof raw !== "object" || typeof raw.takenAt !== "string") return null;
    return { takenAt: raw.takenAt, done: typeof raw.done === "number" ? raw.done : 0, phases: Array.isArray(raw.phases) ? raw.phases : [], inspections: Array.isArray(raw.inspections) ? raw.inspections : [], photos: typeof raw.photos === "number" ? raw.photos : 0, spent: typeof raw.spent === "number" ? raw.spent : 0, committed: typeof raw.committed === "number" ? raw.committed : 0, words: typeof raw.words === "string" ? raw.words : "" };
  } catch {
    return null;
  }
}

// ── words ────────────────────────────────────────────────────────────────────

export const dollars = (n: number) => (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");
export const dayWords = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const r2 = (n: number) => Math.round(n * 100) / 100;
