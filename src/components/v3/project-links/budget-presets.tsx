"use client";

// START FROM A PRESET (owner, 2026-11-07: "make preset budgets that possible can be … all budgets for each possible
// job and I can use that as well"). Inside the Budget card's editor: pick the job — the project's own template's
// first — or one of the shop's other budgets, give the total to split (the budget there now, or the sold price at
// the job's usual cost share, or typed), see each line's share and dollars, and put them in the editor's fields.
// Nothing is saved until Save budget (lib/projectBudgetPresets).

import { useEffect, useMemo, useState } from "react";
import { budgetStartPoints, type BudgetStart } from "@/actions/projectBudget";
import { categoryLabel } from "@/lib/projectBudget";
import { BUDGET_PRESETS, PRESET_GROUPS, presetByKey, sharesOf, splitTotal } from "@/lib/projectBudgetPresets";
import type { UseRows } from "./budget-import";
import s from "./project-budget-card.module.css";

const whole = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const parseMoney = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function BudgetPresets({
  projectId,
  budgetNow,
  priced,
  pricedWord,
  hasFigures,
  onUse,
  onClose,
}: {
  projectId: string;
  /** The budget in the editor now (without change orders), to split again. */
  budgetNow: number;
  /** The sold price (or the open proposals' when nothing is sold). */
  priced: number;
  pricedWord: "contract" | "price";
  hasFigures: boolean;
  onUse: UseRows;
  onClose: () => void;
}) {
  const [start, setStart] = useState<BudgetStart | null>(null);
  const [choice, setChoice] = useState<string>("");
  const [totalText, setTotalText] = useState("");
  const [typed, setTyped] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    budgetStartPoints(projectId)
      .then((r) => {
        if (!live) return;
        setStart(r);
        setChoice((c) => c || r.suggested || "kitchen");
      })
      .catch(() => {
        if (live) {
          setStart({ suggested: null, projects: [] });
          setChoice((c) => c || "kitchen");
        }
      });
    return () => {
      live = false;
    };
  }, [projectId]);

  const preset = presetByKey(choice);
  const own = choice.startsWith("p:") ? (start?.projects.find((p) => `p:${p.id}` === choice) ?? null) : null;
  const shares = useMemo(() => (own ? sharesOf(own.lines) : (preset?.rows ?? [])), [own, preset]);

  // The total to split: the budget now, else the price at the job's usual cost share, else the other project's own.
  const auto = useMemo(() => {
    if (budgetNow > 0) return { amount: budgetNow, words: "the budget now" };
    if (own) return { amount: own.total, words: `${own.name}'s budget` };
    if (preset?.cost && priced > 0) return { amount: Math.round(priced * preset.cost), words: `${Math.round(preset.cost * 100)}% of the ${whole(priced)} ${pricedWord} — a usual cost share for this job` };
    return null;
  }, [budgetNow, own, preset, priced, pricedWord]);
  const total = typed ? parseMoney(totalText) : (auto?.amount ?? 0);
  const split = useMemo(() => (total > 0 ? splitTotal(shares, total) : []), [shares, total]);

  function use(mode: "replace" | "add") {
    if (!(total > 0)) {
      setError("Type the total to split.");
      return;
    }
    const name = own ? own.name : (preset?.label ?? "the preset");
    onUse(
      split.filter((r) => r.amount > 0).map((r) => ({ kind: r.kind, amount: r.amount })),
      mode,
      `${own ? `${name}'s budget` : `The ${name} preset`} over ${whole(total)} — ${split.length} lines. ${own ? "Its shares, this job's total." : "Usual shares for this kind of job, not a quote:"} change any figure to what you know, then Save budget.`,
    );
  }

  return (
    <div className={s.src} data-budget-presets>
      <div className={s.srcHead}>
        <b>Start from a preset</b>
        <button type="button" className={s.linkBtn} onClick={onClose}>
          Back
        </button>
      </div>
      <div className={s.grid}>
        <label className={`${s.fld} ${s.span2}`}>
          <span className={s.lbl}>The job</span>
          <select value={choice} onChange={(e) => setChoice(e.target.value)} data-preset-pick>
            {start?.suggested && presetByKey(start.suggested) ? (
              <optgroup label="For this project">
                <option value={start.suggested}>{presetByKey(start.suggested)!.label}</option>
              </optgroup>
            ) : null}
            {PRESET_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {BUDGET_PRESETS.filter((p) => p.group === g && p.key !== start?.suggested).map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
            {start?.projects.length ? (
              <optgroup label="Your other projects' budgets">
                {start.projects.map((p) => (
                  <option key={p.id} value={`p:${p.id}`}>
                    {p.name} — {whole(p.total)}, {p.lines.length} lines
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <label className={s.fld}>
          <span className={s.lbl}>Total to split</span>
          <span className={s.moneyIn}>
            <span aria-hidden="true">$</span>
            <input
              inputMode="decimal"
              value={typed ? totalText : auto ? String(auto.amount) : ""}
              placeholder="85000"
              onChange={(e) => {
                setTyped(true);
                setTotalText(e.target.value.replace(/[^\d.,]/g, ""));
              }}
              data-preset-total
            />
          </span>
        </label>
      </div>
      <p className={s.srcHint} data-preset-about>
        {own ? `${own.name}: the same lines at the same shares.` : preset?.about}{" "}
        {!typed && auto ? `The total is ${auto.words}.` : !typed ? "Type the total this job should cost you." : ""}
      </p>
      {split.length ? (
        <ul className={s.prows} aria-label="The preset's lines" data-preset-rows>
          {split.map((r) => (
            <li key={r.name}>
              <span>{own ? categoryLabel(r.name) : r.name}</span>
              <span className={s.ppct}>{Math.round(r.pct * 1000) / 10}%</span>
              <b>{whole(r.amount)}</b>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={s.srcActs}>
        <span className={s.total}>
          {split.length} lines · <b>{whole(total)}</b>
        </span>
        {hasFigures ? (
          <button type="button" className={s.btn} onClick={() => use("add")} data-preset-add>
            Add to the budget
          </button>
        ) : null}
        <button type="button" className={s.btnPrimary} onClick={() => use("replace")} disabled={!split.length} data-preset-use>
          {hasFigures ? "Replace the budget" : "Use this preset"}
        </button>
      </div>
      {error ? (
        <div className={s.err} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
