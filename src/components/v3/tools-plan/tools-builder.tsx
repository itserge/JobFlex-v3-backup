"use client";

// BUILD YOUR PLAN (owner, 2026-11-12) — the new plans' one plan picker: the landing's pricing section, /pricing and
// the sign-up's plan step. "The user will come and see the basic cost, professional, and then they can add what they
// want to test … during the trial they can remove and leave what they needed — and it should clearly say it."
//
//   1. the size: Basic, Professional, Advanced, Complete — each at its own price with its own lines;
//   2. the tools to try: every tool with its price; the ad's tool comes ticked and marked "The tool you came for";
//      a tool the size includes says so (Advanced: the office tools and the 2 dearest trade tools ticked);
//   3. the plan as built: each line, the month (or the year), what the free days allow, a bigger size when it costs
//      less for the same tools — and the start button the page hands in.
//
// Every number is lib/toolPlans/cards toolsBuild over the prices in force (Admin → Plans) the server sent; the
// checkout prices the same pick again itself (lib/signupPricing). An ad visit that narrows the trades (a roofer off
// the roofing ad, lib/planSpotlight spotlightNarrows) folds the other trade tools under one button.
import * as React from "react";
import { PlanPrice, PlanTermSwitch } from "@/components/billing/PlanTermSwitch";
import type { BillingTerm } from "@/lib/planDeal";
import { SPOTLIGHT_TAG } from "@/lib/planSpotlight";
import { useTrialOffer } from "@/components/providers/trial-offer";
import { withBillingTerm } from "@/lib/planDeal";
import { TOOLS_DEFAULT_PLAN, toolsBuild, withPlanQuery, type ToolsBuild, type ToolsBuildTool } from "@/lib/toolPlans/cards";
import { money, YEAR_MONTHS, type Catalog, type ToolId, type ToolPlanId } from "@/lib/toolPlans/shared";
import s from "./tools-builder.module.css";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

function Tick() {
  return (
    <svg className={s.tick} viewBox="0 0 24 24" aria-hidden>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

/** "Just you" · "Up to 5 people" · "Up to 10 people · AI desk, texting, CRM + 2 trade tools" · "… · every tool". */
function sizeWho(p: Catalog["plans"][number]): string {
  const people = p.seats === 1 ? "Just you" : `Up to ${p.seats} people`;
  if (p.includedTrade === "all") return `${people} · every tool`;
  if (p.officeIncluded) return `${people} · office tools + ${p.includedTrade} trade tools`;
  return people;
}

export interface ToolsBuilderProps {
  catalog: Catalog;
  plan: ToolPlanId;
  picks: ToolId[];
  onPlan: (plan: ToolPlanId) => void;
  onPicks: (picks: ToolId[]) => void;
  term: BillingTerm;
  /** Draw the Monthly | Annual switch over the sizes (the landing and /pricing); absent: the page has its own. */
  onTerm?: (term: BillingTerm) => void;
  trialDays: number;
  /** The ad's tool: marked "The tool you came for". */
  adTool?: ToolId | null;
  /** An ad visit that narrows the trades: the other trade tools wait behind "Show every tool". */
  narrow?: boolean;
  /** "ink" on the landing's dark band: the words between the white panels turn light. */
  tone?: "paper" | "ink";
  /** The start button (a link on the landing, a button on the sign-up), drawn under the plan as built. */
  action: (build: ToolsBuild) => React.ReactNode;
  /** Lines under the total (the sign-up's "free until" and a promo code's price). */
  below?: (build: ToolsBuild) => React.ReactNode;
  busy?: boolean;
}

export function ToolsBuilder({ catalog, plan, picks, onPlan, onPicks, term, onTerm, trialDays, adTool = null, narrow = false, tone = "paper", action, below, busy = false }: ToolsBuilderProps) {
  const build = toolsBuild(plan, picks, catalog);
  const [allTrades, setAllTrades] = React.useState(false);
  const year = term === "YEAR";
  const groupId = React.useId();
  const size = catalog.plans.find((p) => p.id === plan)!;
  const everything = size.includedTrade === "all";

  const toggle = (id: ToolId) => {
    if (busy) return;
    onPicks(build.picks.includes(id) ? build.picks.filter((x) => x !== id) : [...build.picks, id]);
  };
  // What ticking a tool would cost on this size: free when the size would hold it (Advanced's second trade tool).
  const wouldCost = (t: ToolsBuildTool) => (t.picked ? !t.included : !toolsBuild(plan, [...build.picks, t.id], catalog).tools.find((x) => x.id === t.id)!.included);

  const trades = build.tools.filter((t) => t.kind === "trade");
  const office = build.tools.filter((t) => t.kind === "office");
  const folded = narrow && !!adTool && !allTrades && !everything;
  const shownTrades = folded ? trades.filter((t) => t.id === adTool || t.picked) : trades;
  const hidden = trades.length - shownTrades.length;

  const tile = (t: ToolsBuildTool) => {
    // The size holds it whether ticked or not (the office set on Advanced, everything on Complete): drawn ticked, fixed.
    const fixed = t.included && !build.chosenTrade.includes(t.id);
    const on = t.picked || fixed;
    const free = on ? t.included : !wouldCost(t);
    return (
      <button
        key={t.id}
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-disabled={fixed || busy || undefined}
        className={cx(s.tile, on && s.tileOn, fixed && s.tileFixed)}
        onClick={() => (fixed ? undefined : toggle(t.id))}
        data-tools-tile={t.id}
        data-tools-tile-state={fixed ? "included" : t.picked ? (t.included ? "picked-included" : "picked") : "off"}
      >
        <span className={s.box} aria-hidden>
          {on ? <Tick /> : null}
        </span>
        <span className={s.tileText}>
          <span className={s.tileName}>
            {t.label}
            {t.id === adTool ? <span className={s.came}>{SPOTLIGHT_TAG}</span> : null}
          </span>
          <span className={s.tileNote}>{t.note}</span>
        </span>
        <span className={cx(s.tilePrice, free && s.tileFree)}>{free ? (on ? "Included" : `Free on ${size.name}`) : `${money(t.cents)}/mo`}</span>
      </button>
    );
  };

  const totalYear = build.cents * YEAR_MONTHS;
  return (
    <div className={cx(s.b, tone === "ink" && s.ink)} data-tools-builder="" data-plan={build.slug} data-picks={build.picks.join(",")} data-monthly-cents={build.cents}>
      {onTerm ? (
        <div className={s.termRow}>
          <PlanTermSwitch value={term} onChange={onTerm} tag="2 months free" tone={tone} />
        </div>
      ) : null}

      <p className={s.step} id={`${groupId}-sizes`}>
        <b>1</b> Pick your plan
      </p>
      <div className={s.sizes} role="radiogroup" aria-labelledby={`${groupId}-sizes`}>
        {catalog.plans.map((p) => {
          const on = p.id === plan;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={cx(s.size, on && s.sizeOn)}
              onClick={() => !busy && onPlan(p.id)}
              data-tools-size={p.id}
            >
              {p.id === "professional" ? <span className={s.sizeTag}>Most picked</span> : null}
              <span className={s.sizeHead}>
                <span className={s.radio} aria-hidden />
                <span className={s.sizeName}>{p.name}</span>
              </span>
              <PlanPrice term={term} monthlyCents={p.cents} yearlyCents={p.cents * YEAR_MONTHS} figureClassName={s.sizePrice} />
              <span className={s.sizeWho}>{sizeWho(p)}</span>
              <span className={s.sizeLines}>
                {catalogLines(catalog, p.id).map((l) => (
                  <span key={l} className={s.line}>
                    <Tick />
                    {l}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      {/* On a phone the four sizes are small buttons: the chosen one's lines are said once, under them. */}
      <div className={s.pickedLines} data-tools-size-lines="">
        <span className={s.pickedLinesH}>{`In ${size.name}`}</span>
        {build.lines.map((l) => (
          <span key={l} className={s.line}>
            <Tick />
            {l}
          </span>
        ))}
      </div>

      <div className={s.body}>
        <div className={s.toolsCol}>
          <p className={s.step}>
            <b>2</b> {everything ? "Every tool is included" : "Add the tools you want to try"}
          </p>
          <p className={s.stepSub}>
            {everything
              ? `${size.name} opens all of them. Nothing to tick.`
              : `Ticked tools are free for your ${trialDays} days, like the plan. Keep what you use, remove the rest before the trial ends.`}
          </p>
          <div className={s.panel}>
            <p className={s.groupH}>Estimators and project tools</p>
            <div className={s.tiles}>{shownTrades.map(tile)}</div>
            {hidden > 0 ? (
              <button type="button" className={s.more} onClick={() => setAllTrades(true)} data-tools-more="">
                {`Show the other ${hidden} tools`}
              </button>
            ) : null}
            <p className={s.groupH}>Office tools</p>
            <div className={s.tiles}>{office.map(tile)}</div>
          </div>
        </div>

        <div className={s.sumCol}>
          <p className={s.step}>
            <b>3</b> Your plan
          </p>
          <div className={cx(s.panel, s.sum)} data-tools-summary="">
            <ul className={s.rows}>
              <li className={s.row}>
                <span>{size.name}</span>
                <span>{money(size.cents)}/mo</span>
              </li>
              {build.picks.map((id) => {
                const t = build.tools.find((x) => x.id === id)!;
                return (
                  <li key={id} className={s.row} data-tools-sum-row={id}>
                    <span>{`+ ${t.label}`}</span>
                    <span className={t.included ? s.rowFree : undefined}>{t.included ? "Included" : `${money(t.cents)}/mo`}</span>
                  </li>
                );
              })}
              {!build.picks.length && !everything ? <li className={cx(s.row, s.rowNone)}>No tools ticked. You can try any of them later.</li> : null}
            </ul>
            <div className={s.total} data-tools-total={year ? totalYear : build.cents}>
              <span>{year ? "Each year" : "Each month"}</span>
              <b>{year ? `${money(totalYear)}/yr` : `${money(build.cents)}/mo`}</b>
            </div>
            {year ? <p className={s.fine}>A year is 10 months: 2 months free.</p> : null}
            {below ? below(build) : null}
            <ul className={s.trial} data-tools-trial="">
              <li>
                <Tick />
                <span>
                  <b>{`Free for ${trialDays} days.`}</b> Nothing to pay today.
                </span>
              </li>
              <li>
                <Tick />
                <span>{`In your ${trialDays} free days you can remove any tool, try another one or change your plan, any time, from Subscription in the app.`}</span>
              </li>
              <li>
                <Tick />
                <span>When the trial ends you pay only for what’s still on your plan. Cancel any time.</span>
              </li>
            </ul>
            {build.better ? (
              <div className={s.better} data-tools-better={build.better.plan}>
                <p>
                  <b>{build.better.words.lead}</b> {build.better.words.rest}
                </p>
                <button type="button" className={s.betterBtn} onClick={() => !busy && onPlan(build.better!.plan)} data-tools-better-go="">
                  {`Switch to ${build.better.name}`}
                </button>
              </div>
            ) : null}
            <div className={s.act}>{action(build)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * THE BUILDER FOR A VISITOR — the landing's pricing section and /pricing. It opens on Professional with the ad's tool
 * ticked (a Deck Studio ad: Professional + Deck Studio; no ad: nothing ticked), and its start button is the register
 * link carrying the size, the tools ticked and the term: the sign-up's own builder opens on exactly that.
 */
export function VisitorToolsBuilder({
  catalog,
  adTool = null,
  registerHref,
  narrow = false,
  tone = "paper",
}: {
  catalog: Catalog;
  adTool?: ToolId | null;
  /** The register link with the visit's trade, campaign and ad key already on it. */
  registerHref: string;
  narrow?: boolean;
  tone?: "paper" | "ink";
}) {
  const { days } = useTrialOffer();
  const [plan, setPlan] = React.useState<ToolPlanId>(TOOLS_DEFAULT_PLAN);
  const [picks, setPicks] = React.useState<ToolId[]>(adTool ? [adTool] : []);
  const [term, setTerm] = React.useState<BillingTerm>("MONTH");
  const adLabel = adTool ? (catalog.tools.find((t) => t.id === adTool)?.label ?? null) : null;
  return (
    <>
      {adLabel ? (
        <p className={cx(s.adLine, tone === "ink" && s.adLineInk)} data-tools-banner="" data-plan-spotlight={adTool ?? undefined}>
          <b>{adLabel}</b>
          {`You came for ${adLabel}, so it's ticked for you. Add anything else you want to try, or take it off.`}
        </p>
      ) : null}
      <ToolsBuilder
        catalog={catalog}
        plan={plan}
        picks={picks}
        onPlan={setPlan}
        onPicks={setPicks}
        term={term}
        onTerm={setTerm}
        trialDays={days}
        adTool={adTool}
        narrow={narrow}
        tone={tone}
        action={(build) => (
          <a
            href={withBillingTerm(withPlanQuery(registerHref, build.slug, build.picks), term)}
            className={s.go}
            data-cta="pricing"
            data-cta-button={`plan-${build.slug}`}
            data-tools-start=""
            onClick={() => rememberToolsPick(build.plan, build.picks, adTool)}
          >
            {`Start ${days}-day free trial`}
          </a>
        )}
      />
    </>
  );
}

/** A size's own lines (the extra-person price last), as its card lists them. */
function catalogLines(catalog: Catalog, plan: ToolPlanId): string[] {
  return toolsBuild(plan, [], catalog).lines;
}

/** THE PICK A VISITOR STARTED WITH, kept for the sign-up (owner, 2026-11-12): written when the builder's start button
 *  is pressed (and as the sign-up's own builder changes), read once by the sign-up when its link carries no `?tools=`
 *  (a Google round trip, the emailed code's button in a new tab). Two hours, this browser only, and only for a visit
 *  under the same ad it was built under — a later visit from another ad opens on that ad's tool, not on an old pick.
 *  Storage that throws is simply no memory. */
const PICK_KEY = "jf.toolsPick";
const PICK_MS = 2 * 60 * 60 * 1000;

export function rememberToolsPick(plan: ToolPlanId, picks: readonly ToolId[], adTool: ToolId | null = null): void {
  try {
    window.localStorage.setItem(PICK_KEY, JSON.stringify({ plan, picks, ad: adTool, at: Date.now() }));
  } catch {
    /* no storage: no memory */
  }
}

export function recalledToolsPick(adTool: ToolId | null = null): { plan: string; picks: string[] } | null {
  try {
    const raw = window.localStorage.getItem(PICK_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as { plan?: unknown; picks?: unknown; ad?: unknown; at?: unknown };
    if (typeof r.at !== "number" || Date.now() - r.at > PICK_MS || typeof r.plan !== "string" || !Array.isArray(r.picks)) return null;
    if ((r.ad ?? null) !== adTool) return null;
    return { plan: r.plan, picks: r.picks.filter((x): x is string => typeof x === "string") };
  } catch {
    return null;
  }
}
