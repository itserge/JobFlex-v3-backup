"use client";

// PROJECT BUDGET CARD (owner, 2026-09-18: "offer me the budgeting budgets and
// track that budgets within the project … smart and professional, and easy to
// use"). One component for the desktop and the handheld project page.
//
// Reads top to bottom the way a contractor checks a job:
//   1. the four numbers — sold, budgeted cost, spent, where the margin lands;
//   2. what needs attention — a category past 80%, one over budget;
//   3. each category's bar — spent against budgeted, what is left;
//   4. the spending itself — logged here or on the project's jobs.
// Setting the budget and logging a cost open in place, above the numbers they
// change; every write refreshes the page's data.
//
// 2026-11-06 (owner: "make option to add more kind of budgets … make it smart"): under the six, the project's own
// kinds — Tile, Cabinets, Dumpster — each tracked like the six (an expense logged under that name counts against
// it); and "Fill it in for me" reads the budget off the sold estimate's costs, or a rule of thumb for the trade,
// plainly labelled (lib/projectBudgetSuggest).
//
// 2026-11-07 (owner: "someone has already preliminary budget like in a text message or in a notes or in a file, or
// it's was from the bank … make preset budgets … for each possible job"): the editor opens three ways to start —
// paste or upload the budget the office already has (budget-import), a preset for the job or one of the shop's other
// budgets (budget-presets), or the estimate's own costs. All three only fill the fields; Save budget saves.
//
// Styles live in the module under `.w.w` so they outrank the desktop page's
// blanket `.content *` / `.content button` resets, and read only the global
// tokens so the handheld page (which has no blueprint module) draws the same.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addChangeOrderCost, addProjectExpense, deleteProjectExpense, removeBudgetLine, setProjectBudget, suggestProjectBudget } from "@/actions/projectBudget";
import { BUDGET_CATEGORIES, CATEGORY_LABEL, MAX_KINDS, WARN_AT, categoryLabel, customKinds, isBudgetCategory, type BudgetCategory, type BudgetTone } from "@/lib/projectBudget";
import { BudgetImport } from "./budget-import";
import { BudgetPresets } from "./budget-presets";
import type { PdBudget } from "@/components/v3/project-detail-blueprint/project-detail-data";
import s from "./project-budget-card.module.css";

const whole = (n: number) => (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");
const exact = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
const pctText = (p: number | null) => (p == null ? "—" : `${Math.round(p * 100)}%`);
const today = () => new Date().toISOString().slice(0, 10);
const dateText = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const toneCls = (t: BudgetTone) => (t === "over" ? s.over : t === "warn" ? s.warn : t === "ok" ? s.ok : "");
const parseMoney = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const moneyText = (n: number) => (n > 0 ? String(Math.round(n * 100) / 100) : "");

type Panel = null | "budget" | "expense";
/** Where the budget editor starts from, when not from its own fields. */
type Source = null | "import" | "preset";
type Kind = { name: string; amount: string };

export function ProjectBudgetCard({ projectId, budget }: { projectId: string; budget: PdBudget }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sum = budget.summary;

  // ── budget editor ──
  // Category lines only — a change order's cost line (labelled) is listed apart and never retyped. A one-figure budget
  // opens as that figure (2026-11-04: it opened blank, and saving it blank set the budget to $0).
  const extras = useMemo(() => budget.lines.filter((l) => l.label), [budget.lines]);
  const extrasTotal = extras.reduce((n, l) => n + l.amount, 0);
  const initialDraft = useMemo(() => {
    const d: Record<BudgetCategory, string> = { MATERIALS: "", LABOR: "", SUBCONTRACTORS: "", PERMITS: "", EQUIPMENT: "", OTHER: "" };
    for (const l of budget.lines) if (!l.label && isBudgetCategory(l.category)) d[l.category] = moneyText(l.amount);
    return d;
  }, [budget.lines]);
  // The project's own kinds, as lines under their names.
  const kindNames = useMemo(() => customKinds(budget.lines), [budget.lines]);
  const initialKinds = useMemo<Kind[]>(() => kindNames.map((name) => ({ name, amount: moneyText(budget.lines.find((l) => !l.label && l.category === name)?.amount ?? 0) })), [budget.lines, kindNames]);
  const [draft, setDraft] = useState(initialDraft);
  const [kinds, setKinds] = useState<Kind[]>(initialKinds);
  const [split, setSplit] = useState(!sum.unsplit && budget.lines.some((l) => !l.label));
  const baseFigure = Math.max(0, sum.budget - extrasTotal);
  const [oneFigure, setOneFigure] = useState(baseFigure > 0 ? String(Math.round(baseFigure * 100) / 100) : "");
  const [suggestion, setSuggestion] = useState<{ words: string; rule: boolean } | null>(null);
  const [source, setSource] = useState<Source>(null);
  const kindsTotal = kinds.reduce((n, k) => n + (k.name.trim() ? parseMoney(k.amount) : 0), 0);
  const draftTotal = (split ? BUDGET_CATEGORIES.reduce((n, c) => n + parseMoney(draft[c]), 0) + kindsTotal : parseMoney(oneFigure)) + extrasTotal;
  // An approved change order's cost, typed in: prefilled at the project's planned cost share.
  const [coCost, setCoCost] = useState<Record<string, { amount: string; category: BudgetCategory }>>({});

  // ── expense form ──
  const [exp, setExp] = useState({ category: "MATERIALS" as string, amount: "", vendor: "", note: "", date: today() });

  const open = (p: Panel, from: Source = null) => {
    setError(null);
    if (p === "budget") {
      setDraft(initialDraft);
      setKinds(initialKinds);
      setSuggestion(null);
      setSource(from);
      setSplit(!sum.unsplit && budget.lines.some((l) => !l.label));
      setOneFigure(baseFigure > 0 ? String(Math.round(baseFigure * 100) / 100) : "");
    }
    if (p === "expense") setExp({ category: "MATERIALS", amount: "", vendor: "", note: "", date: today() });
    setPanel((cur) => (cur === p && !from ? null : p));
  };
  const done = () => {
    setPanel(null);
    startTransition(() => router.refresh());
  };

  // One figure → categories: the figure goes under Other until it is moved (2026-11-06: the split opened at six $0
  // boxes, "Budgeted cost $0", and saving it would have dropped the budget). Categories → one figure: their sum,
  // the shop's own kinds included.
  function splitOrJoin() {
    if (!split && BUDGET_CATEGORIES.every((c) => !parseMoney(draft[c])) && parseMoney(oneFigure) > 0) {
      setDraft((d) => ({ ...d, OTHER: oneFigure }));
    }
    if (split) {
      const total = BUDGET_CATEGORIES.reduce((n, c) => n + parseMoney(draft[c]), 0) + kinds.reduce((n, k) => n + parseMoney(k.amount), 0);
      if (total > 0) setOneFigure(String(Math.round(total * 100) / 100));
    }
    setSplit((v) => !v);
  }

  /** Rows into the fields — the six's under the six, every other kind as a line of its own. "replace" clears the fields
   *  first, "add" adds to what is there (the same kind's figures summed), "fill" replaces the six and sets the kinds it
   *  names, keeping the shop's other kinds (the estimate's read). Nothing is saved. */
  function applyRows(rows: ReadonlyArray<{ kind: string; amount: number }>, mode: "replace" | "add" | "fill") {
    const keep = mode === "add";
    const six: Record<BudgetCategory, string> = { MATERIALS: "", LABOR: "", SUBCONTRACTORS: "", PERMITS: "", EQUIPMENT: "", OTHER: "" };
    if (keep) for (const c of BUDGET_CATEGORIES) six[c] = split ? draft[c] : "";
    // "Add" to a one-figure budget: the figure stays, under Other, as the split does.
    if (keep && !split && parseMoney(oneFigure) > 0) six.OTHER = oneFigure;
    const own: Kind[] = mode === "replace" ? [] : kinds.filter((k) => k.name.trim()).map((k) => ({ ...k }));
    for (const r of rows) {
      if (!(r.amount > 0)) continue;
      if (isBudgetCategory(r.kind)) {
        six[r.kind] = moneyText(parseMoney(six[r.kind]) + r.amount);
        continue;
      }
      const at = own.findIndex((k) => k.name.trim().toLowerCase() === r.kind.trim().toLowerCase());
      if (at >= 0) own[at] = { ...own[at], amount: moneyText((mode === "add" ? parseMoney(own[at].amount) : 0) + r.amount) };
      else if (own.length < MAX_KINDS) own.push({ name: r.kind.trim().slice(0, 40), amount: moneyText(r.amount) });
      else six.OTHER = moneyText(parseMoney(six.OTHER) + r.amount);
    }
    setDraft(six);
    setKinds(own);
    setSplit(true);
  }

  async function saveBudget() {
    const base = draftTotal - extrasTotal;
    if (base <= 0 && sum.budget - extrasTotal > 0 && !window.confirm("Remove this project's cost budget? Nothing will be tracked against it.")) return;
    const named = kinds.filter((k) => k.name.trim());
    if (split && named.some((k) => BUDGET_CATEGORIES.some((c) => CATEGORY_LABEL[c].toLowerCase() === k.name.trim().toLowerCase()))) {
      setError("That kind is one of the six above — type its figure there.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setProjectBudget(
        split
          ? { projectId, lines: [...BUDGET_CATEGORIES.map((c) => ({ category: c, amount: parseMoney(draft[c]) })), ...named.map((k) => ({ category: k.name.trim(), amount: parseMoney(k.amount) }))] }
          : { projectId, total: parseMoney(oneFigure) },
      );
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the budget.");
    } finally {
      setBusy(false);
    }
  }

  /** The budget read off the estimate, or a rule of thumb for the trade — into the fields, not saved. */
  async function fillIn() {
    setBusy(true);
    setError(null);
    try {
      const r = await suggestProjectBudget(projectId);
      if (r.source === "none") {
        setSuggestion(null);
        setError(r.words);
        return;
      }
      // The six from the estimate, and its Contingency line as a kind of its own (it was dropped here before 2026-11-07).
      applyRows(r.lines.map((l) => ({ kind: l.category, amount: l.amount })), "fill");
      setSuggestion({ words: r.words, rule: r.source === "rule" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read the estimate.");
    } finally {
      setBusy(false);
    }
  }

  async function saveExpense() {
    const amount = parseMoney(exp.amount);
    if (!(amount > 0)) {
      setError("Enter what it cost.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addProjectExpense({ projectId, category: exp.category, amount, vendor: exp.vendor, note: exp.note, spentAt: exp.date || null });
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log the expense.");
    } finally {
      setBusy(false);
    }
  }

  async function saveChangeCost(changeOrderId: string, fallback: number) {
    const v = coCost[changeOrderId] ?? { amount: String(Math.round(fallback)), category: "OTHER" as BudgetCategory };
    const amount = parseMoney(v.amount);
    if (!(amount > 0)) {
      setError("Enter what the change costs you.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addChangeOrderCost({ projectId, changeOrderId, category: v.category, amount });
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add it to the budget.");
    } finally {
      setBusy(false);
    }
  }

  async function removeExtra(lineId: string) {
    if (!window.confirm("Take this change order's cost out of the budget?")) return;
    try {
      await removeBudgetLine({ projectId, lineId });
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't take it out.");
    }
  }

  async function removeExpense(id: string) {
    if (!window.confirm("Delete this expense from the project?")) return;
    try {
      await deleteProjectExpense(id);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete it.");
    }
  }

  // What needs attention, most urgent first.
  const alerts = sum.rows
    .filter((r) => r.tone === "over" || r.tone === "warn")
    .sort((a, b) => (b.pct ?? 99) - (a.pct ?? 99))
    .map((r) =>
      r.tone === "over"
        ? r.budget > 0
          ? { tone: "over" as const, text: `${r.label} is over budget by ${whole(r.spent - r.budget)}` }
          : { tone: "over" as const, text: `${r.label} has ${whole(r.spent)} spent with nothing budgeted` }
        : { tone: "warn" as const, text: `${r.label} is at ${pctText(r.pct)} of budget — ${whole(r.remaining)} left` },
    );
  const empty = sum.budget <= 0 && sum.spent <= 0;
  const expenseKinds: string[] = [...BUDGET_CATEGORIES, ...kindNames];

  return (
    <div className={s.w}>
      <section className={s.card} aria-label="Budget">
        <div className={s.head}>
          <h2 className={s.title}>Budget</h2>
          {!empty ? (
            <span className={`${s.headTone} ${toneCls(sum.tone)}`}>
              {sum.budget > 0 ? `${pctText(sum.pct)} spent` : "No budget set"}
            </span>
          ) : null}
          <div className={s.acts}>
            <button type="button" className={panel === "budget" ? s.btnOn : s.btn} onClick={() => open("budget")} aria-expanded={panel === "budget"}>
              {sum.budget > 0 ? "Edit budget" : "Set budget"}
            </button>
            <button type="button" className={panel === "expense" ? s.btnOn : s.btnPrimary} onClick={() => open("expense")} aria-expanded={panel === "expense"}>
              + Log expense
            </button>
          </div>
        </div>

        {/* ── the editors open here, above what they change ── */}
        {panel === "budget" ? (
          <div className={s.panel} data-budget-panel>
            <div className={s.panelHint}>
              What this project should <b>cost you</b> — materials, labor, subs, permits, and any kind of your own. The price comes from the proposals
              you sell; the margin is the difference. Spending on the project and on its jobs (receipts, crew pay, stock) is tracked against it.
            </div>
            {source === null ? (
              <div className={s.sources} data-budget-sources>
                <button type="button" className={s.source} onClick={() => setSource("import")} data-budget-source="import">
                  <b>Paste or upload a budget</b>
                  <span>A text, your notes, a spreadsheet, the bank&apos;s budget — made into lines</span>
                </button>
                <button type="button" className={s.source} onClick={() => setSource("preset")} data-budget-source="preset">
                  <b>Start from a preset</b>
                  <span>The usual lines for the job, or one of your other projects&apos; budgets</span>
                </button>
                <button type="button" className={s.source} disabled={busy} onClick={() => void fillIn()} data-budget-fill>
                  <b>{busy ? "Reading…" : "Fill it in for me"}</b>
                  <span>From the estimate&apos;s own costs, or a rule of thumb for the trade</span>
                </button>
              </div>
            ) : source === "import" ? (
              <BudgetImport
                projectId={projectId}
                hasFigures={draftTotal - extrasTotal > 0}
                onClose={() => setSource(null)}
                onUse={(rows, mode, words) => {
                  applyRows(rows, mode);
                  setSuggestion({ words, rule: false });
                  setSource(null);
                }}
              />
            ) : (
              <BudgetPresets
                projectId={projectId}
                budgetNow={Math.max(0, draftTotal - extrasTotal)}
                priced={sum.contract > 0 ? sum.contract : sum.pipeline}
                pricedWord={sum.contract > 0 ? "contract" : "price"}
                hasFigures={draftTotal - extrasTotal > 0}
                onClose={() => setSource(null)}
                onUse={(rows, mode, words) => {
                  applyRows(rows, mode);
                  setSuggestion({ words, rule: true });
                  setSource(null);
                }}
              />
            )}
            {source !== null ? null : split ? (
              <>
                <div className={s.grid}>
                  {BUDGET_CATEGORIES.map((c) => (
                    <label key={c} className={s.fld}>
                      <span className={s.lbl}>{CATEGORY_LABEL[c]}</span>
                      <span className={s.moneyIn}>
                        <span aria-hidden="true">$</span>
                        <input
                          inputMode="decimal"
                          value={draft[c]}
                          placeholder="0"
                          onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.value.replace(/[^\d.,]/g, "") }))}
                        />
                      </span>
                    </label>
                  ))}
                </div>
                {kinds.length ? (
                  <div className={s.kinds} data-budget-kinds>
                    {kinds.map((k, i) => (
                      <div key={i} className={s.kind} data-budget-kind>
                        <input value={k.name} maxLength={40} placeholder="Tile, cabinets, dumpster…" aria-label="Kind of cost" onChange={(e) => setKinds((cur) => cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} data-kind-name />
                        <span className={s.moneyIn}>
                          <span aria-hidden="true">$</span>
                          <input inputMode="decimal" value={k.amount} placeholder="0" aria-label={`${k.name || "This kind"} budget`} onChange={(e) => setKinds((cur) => cur.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^\d.,]/g, "") } : x)))} data-kind-amount />
                        </span>
                        <button type="button" className={s.expX} aria-label={`Take ${k.name || "this kind"} out`} onClick={() => setKinds((cur) => cur.filter((_, j) => j !== i))}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className={s.kindActs}>
                  <button type="button" className={s.linkBtn} onClick={() => setKinds((cur) => [...cur, { name: "", amount: "" }])} data-budget-add-kind>
                    + Another kind of cost
                  </button>
                  <button type="button" className={s.linkBtn} onClick={splitOrJoin} data-budget-mode>
                    Use one figure instead
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={s.grid}>
                  <label className={s.fld}>
                    <span className={s.lbl}>Total cost budget</span>
                    <span className={s.moneyIn}>
                      <span aria-hidden="true">$</span>
                      <input inputMode="decimal" autoFocus value={oneFigure} placeholder="0" onChange={(e) => setOneFigure(e.target.value.replace(/[^\d.,]/g, ""))} />
                    </span>
                  </label>
                </div>
                <div className={s.kindActs}>
                  <button type="button" className={s.linkBtn} onClick={splitOrJoin} data-budget-mode>
                    Split it by kind — materials, labor, subs…
                  </button>
                </div>
              </>
            )}
            {suggestion && source === null ? (
              <div className={`${s.suggest} ${suggestion.rule ? s.rule : ""}`} data-budget-suggested>
                {suggestion.words}
              </div>
            ) : null}
            {extras.length && source === null ? (
              <ul className={s.extras} aria-label="Change orders in the budget">
                {extras.map((l) => (
                  <li key={l.id ?? l.label}>
                    <span>{l.label}</span>
                    <span>{categoryLabel(l.category)}</span>
                    <b>{whole(l.amount)}</b>
                    {l.id ? (
                      <button type="button" className={s.expX} aria-label={`Take ${l.label} out of the budget`} onClick={() => void removeExtra(l.id!)}>
                        ×
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={s.panelFoot} hidden={source !== null}>
              <span className={s.total}>
                Budgeted cost <b>{whole(draftTotal)}</b>
                {sum.contract + sum.pipeline > 0 ? (
                  <>
                    {" "}
                    · margin at this budget <b className={sum.contract + sum.pipeline - draftTotal < 0 ? s.overText : ""}>{whole(sum.contract + sum.pipeline - draftTotal)}</b>
                  </>
                ) : null}
              </span>
              <button type="button" className={s.btn} onClick={() => setPanel(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className={s.btnPrimary} onClick={() => void saveBudget()} disabled={busy} data-budget-save>
                {busy ? "Saving…" : "Save budget"}
              </button>
            </div>
          </div>
        ) : null}

        {panel === "expense" ? (
          <div className={s.panel}>
            <div className={s.grid}>
              <label className={s.fld}>
                <span className={s.lbl}>Kind</span>
                <select value={exp.category} onChange={(e) => setExp((x) => ({ ...x, category: e.target.value }))}>
                  {expenseKinds.map((c) => (
                    <option key={c} value={c}>
                      {categoryLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={s.fld}>
                <span className={s.lbl}>Amount</span>
                <span className={s.moneyIn}>
                  <span aria-hidden="true">$</span>
                  <input
                    inputMode="decimal"
                    autoFocus
                    value={exp.amount}
                    placeholder="0.00"
                    onChange={(e) => setExp((x) => ({ ...x, amount: e.target.value.replace(/[^\d.,]/g, "") }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveExpense();
                    }}
                  />
                </span>
              </label>
              <label className={s.fld}>
                <span className={s.lbl}>Vendor</span>
                <input value={exp.vendor} maxLength={120} placeholder="Home Depot" onChange={(e) => setExp((x) => ({ ...x, vendor: e.target.value }))} />
              </label>
              <label className={s.fld}>
                <span className={s.lbl}>Date</span>
                <input type="date" value={exp.date} onChange={(e) => setExp((x) => ({ ...x, date: e.target.value }))} />
              </label>
              <label className={`${s.fld} ${s.wide}`}>
                <span className={s.lbl}>Note</span>
                <input value={exp.note} maxLength={500} placeholder="What it was for" onChange={(e) => setExp((x) => ({ ...x, note: e.target.value }))} />
              </label>
            </div>
            <div className={s.panelFoot}>
              <span className={s.total}>
                {(() => {
                  const row = sum.rows.find((r) => r.category === exp.category);
                  const after = (row?.spent ?? 0) + parseMoney(exp.amount);
                  const b = row?.budget ?? 0;
                  return b > 0 ? (
                    <>
                      {categoryLabel(exp.category)} after this: <b className={after > b ? s.overText : after >= b * WARN_AT ? s.warnText : ""}>{whole(after)}</b> of {whole(b)}
                    </>
                  ) : (
                    <>{categoryLabel(exp.category)} has no budget set</>
                  );
                })()}
              </span>
              <button type="button" className={s.btn} onClick={() => setPanel(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className={s.btnPrimary} onClick={() => void saveExpense()} disabled={busy}>
                {busy ? "Saving…" : "Log expense"}
              </button>
            </div>
          </div>
        ) : null}
        {error ? (
          <div className={s.err} role="alert">
            {error}
          </div>
        ) : null}

        {empty && panel === null ? (
          <div className={s.empty}>
            <span>
              <b>No budget yet.</b> Set what this project should cost by kind — materials, labor, subs, permits,
              equipment, or any of your own. Already have one — a text, notes, a spreadsheet, the bank&apos;s? Paste or upload it. Every cost logged here or on its
              jobs is tracked against it, with a warning at 80% and when a kind runs over.
            </span>
            <span className={s.emptyActs}>
              <button type="button" className={s.btnPrimary} onClick={() => open("budget")}>
                Set budget
              </button>
              <button type="button" className={s.btn} onClick={() => open("budget", "import")} data-empty-import>
                Paste or upload
              </button>
              <button type="button" className={s.btn} onClick={() => open("budget", "preset")} data-empty-preset>
                Use a preset
              </button>
            </span>
          </div>
        ) : null}

        {!empty ? (
          <>
            {/* 1 — the four numbers */}
            <div className={s.nums}>
              <div className={s.num}>
                <span className={s.numL}>Contract · before tax</span>
                <span className={s.numV}>{sum.contract > 0 ? whole(sum.contract) : "—"}</span>
                <span className={s.numS}>
                  {sum.contract > 0
                    ? sum.salesTax > 0
                      ? `sold, with approved changes · +${whole(sum.salesTax)} sales tax, not profit`
                      : "sold, with approved changes"
                    : "nothing sold yet"}
                  {sum.pipeline > 0 ? ` · ${whole(sum.pipeline)} open` : ""}
                </span>
              </div>
              <div className={s.num}>
                <span className={s.numL}>Budgeted cost</span>
                <span className={s.numV}>{sum.budget > 0 ? whole(sum.budget) : "—"}</span>
                <span className={s.numS}>{sum.unsplit ? "one figure — not split" : `${sum.rows.filter((r) => r.budget > 0).length} kinds`}</span>
              </div>
              <div className={s.num}>
                <span className={s.numL}>Spent</span>
                <span className={`${s.numV} ${toneCls(sum.tone)}`}>{whole(sum.spent)}</span>
                <span className={s.numS}>
                  {sum.budget > 0 ? (sum.remaining >= 0 ? `${whole(sum.remaining)} left` : `${whole(-sum.remaining)} over`) : "no budget to track"}
                </span>
              </div>
              <div className={s.num} data-margin-state={sum.marginState}>
                <span className={s.numL}>Projected margin</span>
                {/* While the proposals cover less than the cost budget it is not a loss yet — it is what is left to price
                    (owner walk 2026-11-04: the kitchen alone read −74% against the whole remodel's cost). */}
                <span className={`${s.numV} ${sum.marginState === "short" ? s.warnText : sum.margin != null && sum.margin < 0 ? s.overText : sum.margin != null ? s.okText : ""}`}>
                  {sum.marginState === "short" ? `${whole(sum.uncovered)} to price` : sum.margin != null ? whole(sum.margin) : "—"}
                </span>
                <span className={s.numS}>
                  {sum.marginState === "none"
                    ? "once a proposal is in"
                    : sum.marginState === "short"
                      ? `proposals cover ${whole(sum.contract + sum.pipeline)} of ${whole(sum.projectedCost)} cost — if that's everything, it loses ${whole(sum.uncovered)}`
                      : `${pctText(sum.marginPct)} · cost ${whole(sum.projectedCost)}${sum.marginState === "projected" ? " · if the open proposals sell" : ""}`}
                </span>
              </div>
            </div>

            {/* the whole budget as one bar, the 80% line drawn on it */}
            {sum.budget > 0 ? (
              <div className={s.bar} aria-hidden="true">
                <i className={toneCls(sum.tone)} style={{ width: `${Math.min(100, (sum.pct ?? 0) * 100)}%` }} />
                <b style={{ left: `${WARN_AT * 100}%` }} />
              </div>
            ) : null}

            {/* what the client has paid and still owes (2026-11-04) */}
            {sum.contract > 0 ? (
              <div className={s.paid} data-project-paid>
                <span>
                  Client paid <b>{whole(budget.collected)}</b> of {whole(sum.billed)}
                </span>
                <span className={budget.owed > 0 ? s.warnText : s.okText}>{budget.owed > 0 ? `${whole(budget.owed)} still owed` : "paid in full"}</span>
              </div>
            ) : null}

            {/* approved change orders whose cost is not in the budget yet */}
            {sum.uncosted.length ? (
              <ul className={s.cos} aria-label="Change orders to cost">
                {sum.uncosted.map((c) => {
                  const est = c.amount * (sum.costShare ?? 1);
                  const v = coCost[c.id] ?? { amount: String(Math.round(est)), category: "OTHER" as BudgetCategory };
                  return (
                    <li key={c.id} data-co-uncosted>
                      <span className={s.coText}>
                        <b>{c.label}</b> adds {whole(c.amount)} of work. Its cost isn&apos;t in the budget — counted at{" "}
                        {sum.costShare != null ? `${Math.round(sum.costShare * 100)}%, the project's planned cost share` : "its full price"} ({whole(est)}) until you add it.
                      </span>
                      <span className={s.coForm}>
                        <span className={s.moneyIn}>
                          <span aria-hidden="true">$</span>
                          <input
                            inputMode="decimal"
                            aria-label={`What ${c.label} costs you`}
                            value={v.amount}
                            onChange={(e) => setCoCost((m) => ({ ...m, [c.id]: { ...v, amount: e.target.value.replace(/[^\d.,]/g, "") } }))}
                          />
                        </span>
                        <select aria-label="Category" value={v.category} onChange={(e) => setCoCost((m) => ({ ...m, [c.id]: { ...v, category: e.target.value as BudgetCategory } }))}>
                          {BUDGET_CATEGORIES.map((k) => (
                            <option key={k} value={k}>
                              {CATEGORY_LABEL[k]}
                            </option>
                          ))}
                        </select>
                        <button type="button" className={s.btn} disabled={busy} onClick={() => void saveChangeCost(c.id, est)} data-co-add-cost>
                          Add its cost
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {/* 2 — what needs attention */}
            {alerts.length ? (
              <ul className={s.alerts}>
                {alerts.map((a) => (
                  <li key={a.text} className={a.tone === "over" ? s.alertOver : s.alertWarn}>
                    {a.text}
                  </li>
                ))}
              </ul>
            ) : null}

            {/* 3 — by category */}
            {sum.rows.length ? (
              <div className={s.rows} role="table" aria-label="Budget by kind">
                {sum.rows.map((r) => (
                  <div key={r.category} className={s.row} role="row" data-budget-row={r.category}>
                    <span className={s.rowL} role="cell">
                      {r.label}
                    </span>
                    <span className={s.rowBar} role="cell" aria-label={`${pctText(r.pct)} of budget`}>
                      <i className={toneCls(r.tone)} style={{ width: `${r.budget > 0 ? Math.min(100, (r.pct ?? 0) * 100) : r.spent > 0 ? 100 : 0}%` }} />
                    </span>
                    <span className={s.rowV} role="cell">
                      <b className={toneCls(r.tone)}>{whole(r.spent)}</b> of {r.budget > 0 ? whole(r.budget) : "—"}
                    </span>
                    <span className={`${s.rowR} ${r.remaining < 0 ? s.overText : ""}`} role="cell">
                      {r.budget > 0 ? (r.remaining >= 0 ? `${whole(r.remaining)} left` : `${whole(-r.remaining)} over`) : "not budgeted"}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {/* 4 — the spending */}
            <div className={s.secL}>
              Spending
              <span>{budget.expenses.length ? `${budget.expenses.length}${budget.expenses.length >= 60 ? "+" : ""} ${budget.expenses.length === 1 ? "entry" : "entries"}` : "nothing logged yet"}</span>
            </div>
            {budget.expenses.length ? (
              <ul className={s.exps}>
                {budget.expenses.slice(0, 12).map((e) => (
                  <li key={e.source + e.id} className={s.exp}>
                    <span className={s.expDate}>{dateText(e.at)}</span>
                    <span className={s.expMain}>
                      <span className={s.expT}>{e.source === "project" ? e.vendor || categoryLabel(e.category) : e.jobTitle}</span>
                      <span className={s.expS}>
                        {categoryLabel(e.category)}
                        {e.source === "job" ? " · logged on the job" : ""}
                        {e.note ? ` · ${e.note}` : ""}
                      </span>
                    </span>
                    <span className={s.expAmt}>{exact(e.amount)}</span>
                    {e.source === "project" ? (
                      <button type="button" className={s.expX} aria-label="Delete this expense" title="Delete" onClick={() => void removeExpense(e.id)}>
                        ×
                      </button>
                    ) : (
                      <span className={s.expX} aria-hidden="true" />
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
