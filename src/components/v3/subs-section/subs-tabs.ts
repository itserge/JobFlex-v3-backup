// THE SECTION'S TABS (2026-11-08, the subcontractors plan, part 1; Compare and Budget in part 2; Find in part 3;
// Contracts in part 4) — a
// plain module, so the server pages can read `?tab=` with the same words the client component draws.

export type SubsTab = "overview" | "find" | "subs" | "requests" | "quotes" | "compare" | "contracts" | "budget" | "history";

export const SUBS_TABS: ReadonlyArray<{ key: SubsTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "find", label: "Find" },
  { key: "subs", label: "My subs" },
  { key: "requests", label: "Requests" },
  { key: "quotes", label: "Quotes" },
  { key: "compare", label: "Compare" },
  { key: "contracts", label: "Contracts" },
  { key: "budget", label: "Budget" },
  { key: "history", label: "History" },
];

export const tabOf = (s: string | undefined): SubsTab => (SUBS_TABS.some((t) => t.key === s) ? (s as SubsTab) : "overview");
