"use client";
// THE MONEY (2026-11-07, part 5 of the plan "Projects: Remodel and New construction"). On the desk and the handheld
// project page, before the Budget card: who the build is for and how the money is made (a tap edits it); the
// headline — on budget, or over by how much and where; the figures — budget, spent, committed, left, heading for —
// and the margin at this pace against the contract (or the price the budget implies), or a spec house's profit
// against its sale price; each phase's line with the same figures and a bar (spent, committed, and where it is
// heading against the budget); what is on no phase; "Lay out the budget" when the phases have none; and the
// advisor's list — where to save, where to squeeze — with one tap where one applies. Every write is
// actions/projectMoney (estimators and managers); everyone else reads the card.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyProjectAdvice, layoutProjectBudget, setProjectMoney, setProjectPhaseBudget } from "@/actions/projectMoney";
import { addProjectExpense } from "@/actions/projectBudget";
import { BUDGET_CATEGORIES, CATEGORY_LABEL } from "@/lib/projectBudget";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdMoneyPlan } from "@/components/v3/project-detail-blueprint/project-detail-data";
import { FOR_WHOM, FOR_WHOM_HINT, FOR_WHOM_LABEL, MONEY_MODES, MONEY_MODE_HINT, MONEY_MODE_LABEL, defaultMode, dollars, headlineWords, type ForWhom, type MoneyMode } from "@/lib/projectMoneyPlan/shared";
import s from "./project-hub.module.css";

type Settings = { forWhom: ForWhom; moneyMode: MoneyMode; marginPct: string; feeAmount: string; salePrice: string };
const num = (v: string): number | null => {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return v.trim() && Number.isFinite(n) ? n : null;
};

export function ProjectMoneyCard({ projectId, money, canManage }: { projectId: string; money: PdMoneyPlan; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [layout, setLayout] = useState<string | null>(null);
  const [phaseEdit, setPhaseEdit] = useState<{ id: string; name: string; budget: string } | null>(null);
  const [cost, setCost] = useState<{ phaseId: string; phaseName: string; category: string; amount: string; vendor: string; note: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function run(key: string, fn: () => Promise<string | null | void>) {
    setBusy(key);
    setNote(null);
    try {
      const words = await fn();
      if (typeof words === "string") setNote(words);
      startTransition(() => router.refresh());
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  const t = money.totals;
  const headline = headlineWords(t, money.phases);
  const overTone = t.over > 0 ? s.tagLate : t.budget > 0 && t.headingFor >= t.budget * 0.9 ? s.tagOrdered : s.tagIn;
  const advice = showAll ? money.advice : money.advice.slice(0, 4);

  function openSettings() {
    setSettings({ forWhom: money.settings.forWhom, moneyMode: money.settings.moneyMode === "NONE" && money.settings.forWhom === "CLIENT" ? "PROJECT_MARGIN" : money.settings.moneyMode, marginPct: money.settings.marginPct != null ? String(money.settings.marginPct) : "", feeAmount: money.settings.feeAmount != null ? String(money.settings.feeAmount) : "", salePrice: money.settings.salePrice != null ? String(money.settings.salePrice) : "" });
  }
  async function saveSettings() {
    if (!settings) return;
    const d = settings;
    setSettings(null);
    await run("settings", async () => {
      await setProjectMoney(projectId, { forWhom: d.forWhom, moneyMode: d.forWhom === "SELF" ? "NONE" : d.moneyMode, marginPct: num(d.marginPct), feeAmount: num(d.feeAmount), salePrice: num(d.salePrice) });
      return null;
    });
  }

  const bar = (p: PdMoneyPlan["phases"][number]) => {
    const base = Math.max(p.budget, p.headingFor, 1);
    const spent = Math.min(100, (p.spent / base) * 100);
    const committed = Math.min(100 - spent, (p.committed / base) * 100);
    const heading = Math.min(100, (p.headingFor / base) * 100);
    const budgetAt = Math.min(100, (p.budget / base) * 100);
    return { spent, committed, heading, budgetAt };
  };

  return (
    <div className={s.w}>
      <section className={s.card} aria-label="Money" data-project-money>
        <div className={s.head}>
          <h3 className={s.title}>Money</h3>
          <span className={s.headSub} data-money-who>
            {money.words}
            {canManage ? (
              <>
                {" "}
                <button type="button" className={s.lineBtn} disabled={busy !== null} onClick={openSettings} data-money-settings>
                  change
                </button>
              </>
            ) : null}
          </span>
          {canManage && money.phases.length ? (
            <div className={s.acts}>
              <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setLayout(money.costBudget ? String(Math.round(money.costBudget)) : "")} data-money-layout>
                {money.laidOut ? "Lay it out again" : "Lay out the budget"}
              </button>
            </div>
          ) : null}
        </div>
        {note ? (
          <p className={s.note} role="status" data-money-note>
            {note}
          </p>
        ) : null}

        <div style={{ marginTop: 14 }}>
          <span className={s.factLbl}>At this pace</span>
          <div style={{ marginTop: 4 }}>
            <span className={`${s.tag} ${overTone}`} style={{ whiteSpace: "normal", lineHeight: 1.4 }} data-money-headline>
              {headline}
            </span>
          </div>
        </div>
        <div className={s.facts} style={{ marginTop: 12 }} data-money-figures>
          {(
            [
              ["Budget", t.budget],
              ["Spent", t.spent],
              ["Committed", t.committed],
              ["Left", t.left],
              ["Heading for", t.headingFor],
            ] as const
          ).map(([lbl, v]) => (
            <div key={lbl} className={s.fact}>
              <span className={s.factLbl}>{lbl}</span>
              <span className={s.factVal} data-money-fig={lbl.toLowerCase().replace(/\s/g, "-")}>
                {dollars(v)}
              </span>
            </div>
          ))}
          {money.settings.forWhom === "CLIENT" ? (
            <>
              <div className={s.fact}>
                <span className={s.factLbl}>{money.contract != null ? "Contract" : "Implied price"}</span>
                <span className={s.factVal}>{money.contract != null ? dollars(money.contract) : money.impliedPrice != null ? dollars(money.impliedPrice) : "—"}</span>
              </div>
              <div className={s.fact}>
                <span className={s.factLbl}>Margin at this pace</span>
                <span className={`${s.factVal} ${money.margin && money.margin.amount < 0 ? s.tagLate : ""}`} data-money-margin>
                  {money.margin ? `${dollars(money.margin.amount)} · ${money.margin.pct}%` : "—"}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className={s.fact}>
                <span className={s.factLbl}>Sale price</span>
                <span className={s.factVal}>{money.settings.salePrice != null ? dollars(money.settings.salePrice) : "not set"}</span>
              </div>
              <div className={s.fact}>
                <span className={s.factLbl}>Profit at this pace</span>
                <span className={s.factVal} data-money-margin>
                  {money.profit ? `${dollars(money.profit.amount)} · ${money.profit.pct}%` : "—"}
                </span>
              </div>
            </>
          )}
        </div>

        {money.phases.length ? (
          <div className={s.group} data-money-phases>
            <div className={s.groupHead}>
              <span>By phase</span>
              <span>{money.laidOut ? "budget · spent · committed · heading for" : "no budgets yet — lay out the cost budget over the phases"}</span>
            </div>
            {money.phases.map((p) => {
              const b = bar(p);
              return (
                <div key={p.id} className={s.line} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }} data-money-phase data-money-phase-key={p.key} data-money-phase-status={p.status}>
                  <div>
                    <div className={s.lineName} style={{ fontWeight: 600 }}>
                      {p.name}
                      {p.lane ? <span className={s.qty}> · {p.lane} lane</span> : null}
                      {p.over > 0 ? (
                        <span className={`${s.tag} ${s.tagLate}`} style={{ marginLeft: 8 }} data-money-phase-over>
                          {dollars(p.over)} over at this pace
                        </span>
                      ) : p.status === "DONE" && p.left > 0 ? (
                        <span className={`${s.tag} ${s.tagIn}`} style={{ marginLeft: 8 }}>
                          {dollars(p.left)} under
                        </span>
                      ) : null}
                    </div>
                    <div className={s.bar} style={{ marginTop: 8, position: "relative" }} aria-hidden="true">
                      <i style={{ width: `${b.spent}%`, background: "var(--ink)" }} />
                      <i style={{ left: `${b.spent}%`, width: `${b.committed}%`, background: "var(--amber)" }} />
                      <i style={{ left: `${Math.min(99, b.heading)}%`, width: 2, background: p.over > 0 ? "var(--rose)" : "var(--ink-muted)" }} />
                      <i style={{ left: `${Math.min(99, b.budgetAt)}%`, width: 2, background: "var(--emerald)" }} />
                    </div>
                    <div className={s.lineSub} data-money-phase-figs>
                      {`budget ${dollars(p.budget)} · spent ${dollars(p.spent)} · committed ${dollars(p.committed)} · heading for ${dollars(p.headingFor)}`}
                      {p.status !== "DONE" ? ` · ${Math.round(p.done * 100)}% done` : ""}
                    </div>
                  </div>
                  <span className={s.rowActs}>
                    {canManage ? (
                      <>
                        <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setCost({ phaseId: p.id, phaseName: p.name, category: "MATERIALS", amount: "", vendor: "", note: "" })} aria-label={`Log a cost on ${p.name}`} data-money-phase-cost>
                          + Cost
                        </button>
                        <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setPhaseEdit({ id: p.id, name: p.name, budget: String(Math.round(p.budget)) })} aria-label={`Budget for ${p.name}`} data-money-phase-edit>
                          {p.laidOut ? "Edit" : "Set"}
                        </button>
                      </>
                    ) : null}
                  </span>
                </div>
              );
            })}
            {money.loose.spent > 0 || money.loose.committed > 0 ? (
              <div className={s.line} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }} data-money-loose>
                <div>
                  <div className={s.lineName}>Not on a phase</div>
                  <div className={s.lineSub}>{`spent ${dollars(money.loose.spent)} · committed ${dollars(money.loose.committed)} — the crew's pay, stock, receipts and costs logged without a phase`}</div>
                </div>
                <span />
              </div>
            ) : null}
          </div>
        ) : null}

        {money.advice.length ? (
          <div className={s.group} data-money-advice>
            <div className={s.groupHead}>
              <span>Where to save, where to squeeze</span>
              <span>· {money.advice.length} suggestion{money.advice.length === 1 ? "" : "s"} by dollars</span>
            </div>
            {advice.map((a, i) => (
              <div key={`${a.kind}:${i}`} className={s.line} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }} data-money-tip data-money-tip-kind={a.kind}>
                <div>
                  <div className={s.lineName} style={{ fontWeight: 600 }}>
                    {a.title}
                    <span className={`${s.tag} ${a.kind === "change_order" ? s.tagIn : ""}`} style={{ marginLeft: 8 }}>
                      {a.kind === "change_order" ? `${dollars(a.saves)} the client's` : `saves ${dollars(a.saves)}`}
                    </span>
                  </div>
                  <div className={s.lineSub}>
                    {a.words}
                    {a.costs !== "nothing" ? ` Costs ${a.costs}.` : ""}
                  </div>
                </div>
                <span className={s.rowActs}>
                  {canManage && a.tap ? (
                    <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => void run(`tip:${i}`, async () => (await applyProjectAdvice(projectId, { kind: a.kind, ref: a.ref })).words)} data-money-tip-apply>
                      Apply
                    </button>
                  ) : null}
                </span>
              </div>
            ))}
            {money.advice.length > 4 ? (
              <button type="button" className={s.lineBtn} onClick={() => setShowAll((v) => !v)} data-money-tip-more>
                {showAll ? "fewer" : `all ${money.advice.length}`}
              </button>
            ) : null}
          </div>
        ) : null}
        {!money.phases.length && money.totals.budget <= 0 ? <p className={s.empty}>Set the cost budget on the Budget card; the money reads from it — spent, committed, left and where it is heading.</p> : null}
      </section>

      {/* WHO IT IS FOR, AND HOW THE MONEY IS MADE */}
      <BlueprintSheet
        open={settings !== null}
        onClose={() => setSettings(null)}
        title="Who it is for, and the money"
        description="For a client you earn a margin or a fee on the work; for yourself the project is a cost tracker and profit shows against a sale price."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setSettings(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null} onClick={() => void saveSettings()} data-money-settings-save>
              Save
            </button>
          </>
        }
      >
        {settings ? (
          <div className="bps-form" data-money-settings-sheet>
            <div className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Who is it for?</span>
              <div className="bps-seg">
                {FOR_WHOM.map((w) => (
                  <button key={w} type="button" className={`bps-btn ${settings.forWhom === w ? "bps-btn--primary" : "bps-btn--ghost"}`} aria-pressed={settings.forWhom === w} onClick={() => setSettings({ ...settings, forWhom: w, moneyMode: w === "SELF" ? "NONE" : settings.moneyMode === "NONE" ? defaultMode("CLIENT") : settings.moneyMode })} data-money-for={w}>
                    {FOR_WHOM_LABEL[w]}
                  </button>
                ))}
              </div>
              <p className="bps-hint">{FOR_WHOM_HINT[settings.forWhom]}</p>
            </div>
            {settings.forWhom === "CLIENT" ? (
              <>
                <div className="bps-fld bps-fld--wide">
                  <span className="bps-lbl">How you earn</span>
                  <div className="bps-seg">
                    {MONEY_MODES.filter((m) => m !== "NONE").map((m) => (
                      <button key={m} type="button" className={`bps-btn ${settings.moneyMode === m ? "bps-btn--primary" : "bps-btn--ghost"}`} aria-pressed={settings.moneyMode === m} onClick={() => setSettings({ ...settings, moneyMode: m })} data-money-mode={m}>
                        {MONEY_MODE_LABEL[m]}
                      </button>
                    ))}
                  </div>
                  <p className="bps-hint">{MONEY_MODE_HINT[settings.moneyMode]}</p>
                </div>
                <label className="bps-fld">
                  <span className="bps-lbl">{settings.moneyMode === "COST_PLUS" ? "Fee, percent of cost" : "Margin, percent of cost"}</span>
                  <input className="bps-in" inputMode="decimal" value={settings.marginPct} onChange={(e) => setSettings({ ...settings, marginPct: e.target.value })} placeholder="18" data-money-margin-pct />
                </label>
                {settings.moneyMode === "COST_PLUS" ? (
                  <label className="bps-fld">
                    <span className="bps-lbl">Or a fixed fee ($)</span>
                    <input className="bps-in" inputMode="decimal" value={settings.feeAmount} onChange={(e) => setSettings({ ...settings, feeAmount: e.target.value })} placeholder="45000" data-money-fee />
                  </label>
                ) : null}
              </>
            ) : (
              <label className="bps-fld">
                <span className="bps-lbl">Sale price ($, optional)</span>
                <input className="bps-in" inputMode="decimal" value={settings.salePrice} onChange={(e) => setSettings({ ...settings, salePrice: e.target.value })} placeholder="780000" data-money-sale />
              </label>
            )}
          </div>
        ) : null}
      </BlueprintSheet>

      {/* LAY OUT THE BUDGET over the phases */}
      <BlueprintSheet
        open={layout !== null}
        onClose={() => setLayout(null)}
        title="Lay out the budget"
        description="The cost budget split over the phases by their shares, to the dollar — the land's, the design's, the permits', the site work's… Move money between phases after with Edit."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setLayout(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null || !layout || !(num(layout) ?? 0)} onClick={() => { const total = num(layout ?? ""); setLayout(null); void run("layout", async () => { const r = await layoutProjectBudget(projectId, total); return `${dollars(r.total)} laid out over ${r.phases.length} phases.`; }); }} data-money-layout-go>
              Lay it out
            </button>
          </>
        }
      >
        {layout !== null ? (
          <div className="bps-form" data-money-layout-sheet>
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Cost budget ($)</span>
              <input className="bps-in" inputMode="numeric" value={layout} onChange={(e) => setLayout(e.target.value)} placeholder="420000" autoFocus data-money-layout-total />
            </label>
            <p className="bps-hint bps-fld--wide">{money.laidOut ? "Every phase's budget is replaced by its share of this total." : "Each phase takes its share of this total; the Budget card's figure follows it."}</p>
          </div>
        ) : null}
      </BlueprintSheet>

      {/* A COST ON A PHASE — the Budget card's Log expense, with the phase set. */}
      <BlueprintSheet
        open={cost !== null}
        onClose={() => setCost(null)}
        title={cost ? `A cost on ${cost.phaseName}` : "A cost"}
        description="Logged on the project under its kind, dated today, and counted against this phase."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setCost(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null || !cost || !(num(cost.amount) ?? 0)} onClick={() => { if (!cost) return; const d = cost; setCost(null); void run(`cost:${d.phaseId}`, async () => { await addProjectExpense({ projectId, category: d.category, amount: num(d.amount) ?? 0, vendor: d.vendor.trim() || null, note: d.note.trim() || null, phaseId: d.phaseId }); return `${dollars(num(d.amount) ?? 0)} logged on ${d.phaseName}.`; }); }} data-money-cost-save>
              Log it
            </button>
          </>
        }
      >
        {cost ? (
          <div className="bps-form" data-money-cost-sheet>
            <label className="bps-fld">
              <span className="bps-lbl">Kind</span>
              <select className="bps-in" value={cost.category} onChange={(e) => setCost({ ...cost, category: e.target.value })} data-money-cost-kind>
                {BUDGET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Amount ($)</span>
              <input className="bps-in" inputMode="decimal" value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })} placeholder="12500" autoFocus data-money-cost-amount />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Vendor</span>
              <input className="bps-in" value={cost.vendor} onChange={(e) => setCost({ ...cost, vendor: e.target.value })} placeholder="Cascade Concrete" maxLength={120} data-money-cost-vendor />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Note</span>
              <input className="bps-in" value={cost.note} onChange={(e) => setCost({ ...cost, note: e.target.value })} placeholder="Footings and stem walls" maxLength={500} data-money-cost-note />
            </label>
          </div>
        ) : null}
      </BlueprintSheet>

      {/* ONE PHASE'S BUDGET */}
      <BlueprintSheet
        open={phaseEdit !== null}
        onClose={() => setPhaseEdit(null)}
        title={phaseEdit ? `${phaseEdit.name} — budget` : "Budget"}
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setPhaseEdit(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null || !phaseEdit} onClick={() => { if (!phaseEdit) return; const d = phaseEdit; setPhaseEdit(null); void run(`phase:${d.id}`, async () => { await setProjectPhaseBudget(projectId, d.id, num(d.budget) ?? 0); return null; }); }} data-money-phase-save>
              Save
            </button>
          </>
        }
      >
        {phaseEdit ? (
          <div className="bps-form">
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Budget ($)</span>
              <input className="bps-in" inputMode="numeric" value={phaseEdit.budget} onChange={(e) => setPhaseEdit({ ...phaseEdit, budget: e.target.value })} autoFocus data-money-phase-budget />
            </label>
          </div>
        ) : null}
      </BlueprintSheet>
    </div>
  );
}
