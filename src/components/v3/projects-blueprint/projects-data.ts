// Projects blueprint — the page's row shape and its status vocabulary.
//
// The donor (jobflex-projects-blueprint_2.html) shipped an eight-record demo
// fixture here. It is GONE: the grid is read from the database in the page's
// server component (src/app/dashboard/projects/page.tsx) and handed in as
// props, so a fixture could only ever be a fallback that quietly showed one
// org another org's book. Nothing below is record-shaped.
//
// Shape mirrors the server component's mapping: name, description, status,
// startsAt, endsAt (short "Jul 08" plates), budget, jobCount, completedJobs.
// It is `ProjectBookRow` in @/actions/projects, re-declared here only so the
// blueprint modules do not import a server-action module into the client
// bundle for a type.

export type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  /** REMODEL or NEW_BUILD (2026-11-07). */
  kind?: string;
  startsAt: string | null;
  endsAt: string | null;
  budget: number;
  jobCount: number;
  completedJobs: number;
  /** Whose project it is (2026-09-18), or null. */
  clientName?: string | null;
  // ── The ledger's facts (2026-09-20). Every figure is what the project page
  //    itself shows, so the list never disagrees with the record. ──
  /** Proposals filed under the project (not archived). */
  proposalCount?: number;
  /** Sold: accepted, completed and paid proposals, with approved change orders. */
  sold?: number;
  /** Still to win: draft, sent and viewed proposals, before tax, and how many (the project page counts the same). */
  open?: number;
  openCount?: number;
  /** Spent: costs logged on the project plus its jobs' receipts, crew pay and stock (lib/projectMoney). */
  spent?: number;
  /** Before sales tax, as the project page shows it (2026-11-04). */
  margin?: number | null;
  marginState?: "none" | "short" | "projected" | "sold";
  /** Categories over their budget, by name ("Subcontractors"). */
  overCategories?: string[];
  /** Billed and not yet paid by the client. */
  owed?: number;
  inProgressJobs?: number;
  /** "2h ago" — when anything on the project last moved. */
  updatedAgo?: string;
  // ── The stages (2026-11-05). ──
  /** "#1042", or null on a project not numbered yet. */
  number?: number | null;
  /** % done from the stages (lib/projectStages percentDone), or null with none — the jobs-closed count then. */
  done?: number | null;
  /** The stage the project is on ("Framing"), or null. */
  stageNow?: string | null;
  stageCount?: number;
  /** What the stages and the buying flag: a late stage, no stages on sold work, an AI draft to keep, materials
   *  not ordered by their day, a delivery past its day; an inspection due, punch items open, the finish line's
   *  next step (2026-11-06). */
  attention?: Array<{ kind: "late" | "nostages" | "drafted" | "order-by" | "late-delivery" | "problem" | "inspection" | "punch" | "finish" | "quote-overdue" | "quote-in" | "invoice-in" | "selection-late" | "selection-due"; text: string }>;
};

/** What a row is flagged for, most urgent first. */
export type ProjectFlag = { kind: "over" | "warn" | "loss" | "waiting" | "unbudgeted" | "late" | "nostages" | "drafted" | "order-by" | "late-delivery" | "problem" | "inspection" | "punch" | "finish" | "quote-overdue" | "quote-in" | "invoice-in" | "selection-late" | "selection-due"; text: string };

/** The row's progress, 0–100: the stages' % done when it has stages, else the jobs closed out. */
export function progressOf(p: Project): number {
  if (p.done != null) return p.done;
  return p.jobCount > 0 ? Math.round((p.completedJobs / p.jobCount) * 100) : 0;
}

/** "$3,860" — whole dollars. */
export function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}
/** "$18k" / "$1.2M" past ten thousand, whole dollars below — the compact
 *  figure the masthead sub-lines, the budget cell and the flags print. */
export function moneyShort(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n < 0 ? "−" : "") + "$" + (a / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 10_000) return (n < 0 ? "−" : "") + "$" + Math.round(a / 1000) + "k";
  return money(n);
}

/** The attention flags for a row — an overrun, a category near the line, a
 *  client still to answer, sold work with no budget behind it. */
export function projectFlags(p: Project): ProjectFlag[] {
  const flags: ProjectFlag[] = [];
  const spent = p.spent ?? 0;
  const sold = p.sold ?? 0;
  if (p.budget > 0 && spent > p.budget) flags.push({ kind: "over", text: `${moneyShort(spent - p.budget)} over budget` });
  // One category over is an overrun even while the whole budget has room (owner walk 2026-11-04: Subcontractors $3,000
  // over read "all clear" on the list).
  else if (p.overCategories?.length) flags.push({ kind: "over", text: `${p.overCategories.join(", ")} over budget` });
  else if (p.budget > 0 && spent >= p.budget * 0.8) flags.push({ kind: "warn", text: `${Math.round((spent / p.budget) * 100)}% of budget spent` });
  if (p.marginState === "sold" && p.margin != null && p.margin < 0 && p.status !== "COMPLETED") flags.push({ kind: "loss", text: `Losing ${moneyShort(-p.margin)}` });
  else if (p.budget <= 0 && (sold > 0 || spent > 0) && p.status !== "COMPLETED") flags.push({ kind: "unbudgeted", text: "No budget set" });
  if ((p.openCount ?? 0) > 0 && p.status !== "COMPLETED") flags.push({ kind: "waiting", text: `${p.openCount} waiting on client` });
  // A late stage, a late delivery and materials not ordered lead (2026-11-05); the rest follow the money's.
  const urgent = (p.attention ?? []).filter((f) => f.kind === "problem" || f.kind === "inspection" || f.kind === "late" || f.kind === "late-delivery" || f.kind === "order-by" || f.kind === "selection-late");
  const rest = (p.attention ?? []).filter((f) => !urgent.includes(f));
  return [...urgent, ...flags, ...rest];
}

/** A client the New Project dialog can file the project for. */
export type ProjectClientChoice = { id: string; name: string; street: string };

/** The three statuses the filter rail and the create dialog offer. ARCHIVED is
 *  deliberately absent: the page's query hides archived projects. */
export const STATUSES = ['ACTIVE', 'ON_HOLD', 'COMPLETED'];
