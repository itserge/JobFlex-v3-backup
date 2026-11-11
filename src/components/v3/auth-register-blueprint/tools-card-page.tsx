"use client";

// THE NEW PLANS' CARD PAGE AT SIGN-UP (Base + Tools, part 4 — owner, 2026-11-10). Drawn on the plan step in place of
// the Classic plan cards when the Plans switch is on (actions/signupPaywall answers `tools`):
//
//   · one card: the size with the ad's main tool — "Professional + Deck Studio · 7 days free, then $154/mo" — and its
//     lines, the tool's first; its button starts the trial (the card page Stripe opens bills exactly this);
//   · the smaller switch under it: "Working alone? Basic + Deck Studio, $118.99" (on Basic: "Have a team?");
//   · "Change tool": any of the twelve, or none — the ad wasn't the tool they wanted; the price follows;
//   · the four sizes as one row of small buttons, for a shop that wants Advanced or Complete.
//
// Every number here is lib/toolPlans/cards toolsChoice over the prices in force the server sent (Admin → Plans). It
// is the page's own drawing only: the checkout is handed the plan and the tool, and prices them again itself.
import * as React from "react";
import { PlanDealSlot, PlanPrice } from "@/components/billing/PlanTermSwitch";
import type { BillingTerm } from "@/lib/planDeal";
import { toolsChoice, toolsSizeSwitch } from "@/lib/toolPlans/cards";
import { money, type Catalog, type ToolId, type ToolPlanId } from "@/lib/toolPlans/shared";
import css from "./tools-card-page.module.css";

export function ToolsCardPage({
  catalog,
  plan,
  main,
  term,
  onPlan,
  onMain,
  onStart,
  when,
  codeLine,
  busy,
  disabled,
  startLabel,
}: {
  catalog: Catalog;
  plan: ToolPlanId;
  main: ToolId | null;
  term: BillingTerm;
  onPlan: (plan: ToolPlanId) => void;
  onMain: (tool: ToolId | null) => void;
  onStart: () => void;
  /** "Free until Nov 18, then $154/mo" for these prices (register-content whenLine). */
  when: (monthlyCents: number, yearlyCents: number) => React.ReactNode;
  /** The promo code's effect on this price, when one is applied (register-content). */
  codeLine?: (monthlyCents: number, yearlyCents: number) => React.ReactNode;
  busy: boolean;
  disabled: boolean;
  startLabel: string;
}) {
  const choice = toolsChoice(plan, main, catalog);
  const flip = toolsSizeSwitch(plan, main, catalog);
  const selectId = React.useId();
  return (
    <div className={css.page} data-tools-card-page data-plan={choice.slug} data-main={main ?? ""}>
      <div className={"pw-plan pw-plan--hero on " + css.card} data-plan-card={choice.slug} data-monthly-cents={choice.cents} data-yearly-cents={choice.yearlyCents}>
        <span className="pw-plan-n" data-tools-label>
          {choice.label}
        </span>
        <PlanPrice term={term} monthlyCents={choice.cents} yearlyCents={choice.yearlyCents} figureClassName="pw-price" />
        <PlanDealSlot term={term} monthlyCents={choice.cents} yearlyCents={choice.yearlyCents} />
        {when(choice.cents, choice.yearlyCents)}
        {codeLine ? codeLine(choice.cents, choice.yearlyCents) : null}
        <span className={"pw-feats " + css.feats} data-plan-feats data-cut="0">
          {choice.lines.map((f, i) => (
            <span key={f} className={"pw-f" + (i === 0 && main ? " pw-f--spot" : "")} data-plan-spot-row={i === 0 && main ? "in" : undefined}>
              <svg className="ic" aria-hidden>
                <use href="#i-check" />
              </svg>
              <span className="pw-ft">
                <span className="pw-fn">{f}</span>
              </span>
            </span>
          ))}
        </span>
        <span className="pw-acts">
          <button type="button" className={"btn pw-go" + (busy ? " is-busy" : "")} aria-busy={busy || undefined} onClick={onStart} disabled={disabled} data-tools-start>
            {startLabel}
          </button>
        </span>
      </div>

      <div className={css.side}>
        {flip ? (
          <button type="button" className={css.flip} onClick={() => onPlan(flip.to)} disabled={busy} data-tools-flip={flip.to}>
            <span className={css.flipAsk}>{flip.ask}</span> <b>{flip.label}</b>, {money(flip.cents)}/mo
          </button>
        ) : null}

        <div className={css.field}>
          <label className={css.label} htmlFor={selectId}>
            Change tool
          </label>
          <p className={css.hint}>Not the tool you came for? Pick another — the price changes with it.</p>
          <span className={css.selWrap}>
            <select
              id={selectId}
              className={css.select}
              value={main ?? ""}
              disabled={busy}
              onChange={(e) => onMain((e.target.value || null) as ToolId | null)}
              data-tools-change
            >
              <option value="">No main tool — the plan alone</option>
              {catalog.tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} · {money(t.cents)}/mo
                </option>
              ))}
            </select>
          </span>
        </div>

        <div className={css.field}>
          <span className={css.label} id={`${selectId}-sizes`}>
            Plan
          </span>
          <div className={css.sizes} role="radiogroup" aria-labelledby={`${selectId}-sizes`}>
            {catalog.plans.map((p) => {
              const c = toolsChoice(p.id, main, catalog);
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={p.id === plan}
                  className={css.size}
                  onClick={() => onPlan(p.id)}
                  disabled={busy}
                  data-tools-size={p.id}
                >
                  <span className={css.sizeN}>{p.name}</span>
                  <span className={css.sizeP}>{money(c.cents)}/mo</span>
                  <span className={css.sizeW}>{p.seats === 1 ? "just you" : `up to ${p.seats} people`}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
