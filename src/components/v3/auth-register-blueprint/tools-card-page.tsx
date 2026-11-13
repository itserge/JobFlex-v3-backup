"use client";

// THE NEW PLANS' PLAN STEP AT SIGN-UP (Base + Tools, part 4 — owner, 2026-11-10; the builder 2026-11-12). Drawn on
// the plan step in place of the Classic plan cards when the Plans switch is on (actions/signupPaywall answers
// `tools`). It is the same builder the landing shows (components/v3/tools-plan/tools-builder), opened on what the
// visitor built there — the size, the tools ticked — so nothing has to be picked twice, and everything can still be
// changed: another size, a tool added or taken off, the price following each tick.
//
// The button starts the trial; the card page Stripe opens bills exactly this. Every number is lib/toolPlans/cards
// toolsBuild over the prices in force the server sent (Admin → Plans); the checkout is handed the size and the tools'
// ids, and prices them again itself.
import * as React from "react";
import type { BillingTerm } from "@/lib/planDeal";
import { ToolsBuilder } from "@/components/v3/tools-plan/tools-builder";
import type { Catalog, ToolId, ToolPlanId } from "@/lib/toolPlans/shared";
import css from "./tools-card-page.module.css";

export function ToolsCardPage({
  catalog,
  plan,
  picks,
  adTool = null,
  term,
  trialDays,
  onPlan,
  onPicks,
  onStart,
  when,
  codeLine,
  busy,
  disabled,
  startLabel,
}: {
  catalog: Catalog;
  plan: ToolPlanId;
  /** The tools ticked, the first the main tool. */
  picks: ToolId[];
  /** The ad's tool, marked "The tool you came for". */
  adTool?: ToolId | null;
  term: BillingTerm;
  trialDays: number;
  onPlan: (plan: ToolPlanId) => void;
  onPicks: (picks: ToolId[]) => void;
  onStart: () => void;
  /** "Free until Nov 18, then $154/mo" for these prices (register-content whenLine). */
  when: (monthlyCents: number, yearlyCents: number) => React.ReactNode;
  /** The promo code's effect on this price, when one is applied (register-content). */
  codeLine?: (monthlyCents: number, yearlyCents: number) => React.ReactNode;
  busy: boolean;
  disabled: boolean;
  startLabel: string;
}) {
  return (
    <div className={css.page} data-tools-card-page data-plan={`tools-${plan}`} data-main={picks[0] ?? ""}>
      <ToolsBuilder
        catalog={catalog}
        plan={plan}
        picks={picks}
        onPlan={onPlan}
        onPicks={onPicks}
        term={term}
        trialDays={trialDays}
        adTool={adTool}
        busy={busy}
        below={(build) => (
          <div className={css.when}>
            {when(build.cents, build.yearlyCents)}
            {codeLine ? codeLine(build.cents, build.yearlyCents) : null}
          </div>
        )}
        action={() => (
          <button type="button" className={"btn pw-go" + (busy ? " is-busy" : "")} aria-busy={busy || undefined} onClick={onStart} disabled={disabled} data-tools-start>
            {startLabel}
          </button>
        )}
      />
    </div>
  );
}
