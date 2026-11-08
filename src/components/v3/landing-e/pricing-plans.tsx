"use client";

import { useTrialOffer } from "@/components/providers/trial-offer";
import { useEffect, useRef, useState } from "react";
import { expandPlanFeatures, type PlanDTO } from "@/lib/planCatalog";
import { annualDeal, offersYearly, sharedDealWords, withBillingTerm, type BillingTerm } from "@/lib/planDeal";
import { PlanCardHead, PlanDealSlot, PlanPrice, PlanTermSwitch } from "@/components/billing/PlanTermSwitch";
import { SPOTLIGHT, SPOTLIGHT_MISSING, SPOTLIGHT_TAG, planCardRows, rememberSpotlightVisit, showsTool, spotlightBanner, spotlightInPlan, type SpotlightTool } from "@/lib/planSpotlight";
import { deckAddonShortWords } from "@/lib/deckAddon";
import "./pricing-faq.css";

/* THE REGISTER'S PLAN CARDS ON THE LANDING (owner, 2026-09-26). A port of
   step 3 of signup ("Pick a plan.", auth-register-blueprint/register-content
   + auth-register.module.css `.pw-*`) as `lp-pw-*` in pricing-faq.css: mono
   plan name, 44px price, ONE shared feature list — ink tick where the plan
   has it, grey dash where it does not — and the card's own full-width start
   button. Everything is read from the live catalogue (getPlanCatalog on the
   server): expandPlanFeatures gives the shared rows and what each plan
   includes, formatPlanPrice the price. Every button starts the visitor’s assigned
   trial (lib/trialOffer), whatever the catalogue row's own days.
   The register reads no `plan` param, so every button is the register link.

   On a phone (≤768px) the row is the register's swipe carousel: cards
   min(84vw, 340px), snap centre, the MOST-PICKED card centred on arrival,
   and square dots under it.

   MONTHLY | ANNUAL (owner, 2026-10-12): one switch over the row
   (components/billing/PlanTermSwitch), Monthly first. Annual prints the
   year's price, its "N months free" stamp when the saving is whole months
   and "You save $N" in green (lib/planDeal); a plan with no yearly price
   keeps its month and says "Billed monthly". The choice rides the start
   link as ?billing=annual, so the signup plan step opens on it. Every card
   lists every row — nothing folds — and the cards are one subgrid, so the
   prices and the first rows stand on one line across the row. The custom
   plan is not a card here: it is the wide "Build your plan" plate under the
   row (pricing-d/custom-plan-block, owner 2026-10-12). */
const PHONE = "(max-width: 768px)";

function Check() {
  return (
    <svg className="lp-pw-ic" viewBox="0 0 24 24" aria-hidden>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}
/** The add-on's row: a plus, on every plan alike. */
function Plus() {
  return (
    <svg className="lp-pw-ic" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function Minus() {
  return (
    <svg className="lp-pw-ic" viewBox="0 0 24 24" aria-hidden>
      <path d="M6 12h12" />
    </svg>
  );
}

export function PricingPlans({
  plans,
  registerHref,
  tone = "paper",
  spotlight = null,
  narrow = false,
  fromUrl = null,
}: {
  plans: PlanDTO[];
  registerHref: string;
  /** THE TOOL THE VISITOR CAME FOR (lib/planSpotlight, owner 2026-10-14): its
   *  feature line is pinned first and marked on every card, and a card that
   *  lacks it says so — a roofer off the roofing ad sees the Roof estimator
   *  without reading the whole list. */
  spotlight?: SpotlightTool | null;
  /** Hide the other trade estimators (lib/planSpotlight spotlightNarrows): only while the ad visit lasts. */
  narrow?: boolean;
  /** The spotlight this page's own URL carried: remembered for the browser session (SPOTLIGHT_VISIT_COOKIE). */
  fromUrl?: SpotlightTool | null;
  /** "ink" on the landing's dark pricing band — the switch's colours. */
  tone?: "paper" | "ink";
}) {
  const { days } = useTrialOffer();
  const expanded = expandPlanFeatures(plans);
  /* The spotlighted tool's row, always drawn and pinned, marked by its gate; during the ad visit a roofer, fencer or
     HVAC visitor sees only their own estimator among the trade rows (lib/planSpotlight planCardRows, owner
     2026-11-07). The in-app Subscription and Upgrade pages keep every row. */
  const { rows, spot } = planCardRows(expanded.rows, spotlight, narrow);
  const deckLine = showsTool("deck", narrow ? spotlight : null);
  const deckSpot = spotlight === "deck";
  useEffect(() => rememberSpotlightVisit(fromUrl), [fromUrl]);
  const included = expanded.included;
  const heroIndex = Math.max(0, plans.findIndex((p) => p.highlight));
  const railRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const [active, setActive] = useState(heroIndex);
  const [term, setTerm] = useState<BillingTerm>("MONTH");
  const yearly = offersYearly(plans);
  const tag = sharedDealWords(plans.filter((p) => p.yearlyPriceCents).map((p) => annualDeal(p.priceCents, p.yearlyPriceCents)));
  const startHref = withBillingTerm(registerHref, yearly ? term : "MONTH");

  /* The rail is `position: relative` (pricing-faq.css), so a card's
     offsetLeft is measured from the rail itself, in its scroll space. */
  const cardLeft = (rail: HTMLElement, i: number) => {
    const card = rail.children[i] as HTMLElement | undefined;
    if (!card) return 0;
    return Math.max(0, card.offsetLeft - (rail.clientWidth - card.offsetWidth) / 2);
  };

  /* ARRIVE ON THE MOST-PICKED CARD, CENTRED (owner, 2026-09-26) — the
     register does the same. One pass on mount was not enough: the section
     sits under content-visibility:auto and fades in, and a page first laid
     out wide (a desk window narrowed to phone size, a turned tablet) had
     already spent its one pass, so the rail opened on the first card. It is
     set again whenever the rail gets a size, comes into view or turns into
     a carousel, each time with two follow-ups while the fade settles (the
     register's 120/520 ms), until the visitor touches, scrolls or tabs into
     it — after that it is theirs. */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const phone = window.matchMedia(PHONE);
    const timers: number[] = [];
    const settle = () => {
      if (touched.current || !phone.matches || !rail.clientWidth) return;
      const left = cardLeft(rail, heroIndex);
      if (Math.abs(rail.scrollLeft - left) > 1) rail.scrollLeft = left;
    };
    const settleSoon = () => {
      settle();
      timers.push(window.setTimeout(settle, 120), window.setTimeout(settle, 520));
    };
    /* Only a hand on the carousel counts: not a click on the desk grid, and
       not a vertical wheel that is scrolling the page past it. */
    const mark = (e: Event) => {
      if (!phone.matches) return;
      if (e instanceof WheelEvent && !e.shiftKey && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      touched.current = true;
    };
    settleSoon();
    const ro = new ResizeObserver(() => settle());
    ro.observe(rail);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) settleSoon();
      },
      { rootMargin: "0px 0px 400px 0px" },
    );
    io.observe(rail);
    phone.addEventListener("change", settleSoon);
    const MARKS = ["pointerdown", "touchstart", "wheel", "keydown", "focusin"] as const;
    for (const ev of MARKS) rail.addEventListener(ev, mark, { passive: true });
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const mid = rail.scrollLeft + rail.clientWidth / 2;
        let best = 0;
        let bestD = Infinity;
        Array.from(rail.children).forEach((el, i) => {
          const c = el as HTMLElement;
          const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        setActive(best);
      });
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      ro.disconnect();
      timers.forEach(clearTimeout);
      cancelAnimationFrame(frame);
      phone.removeEventListener("change", settleSoon);
      for (const ev of MARKS) rail.removeEventListener(ev, mark);
      rail.removeEventListener("scroll", onScroll);
    };
  }, [heroIndex]);

  const goTo = (i: number) => {
    const rail = railRef.current;
    if (!rail) return;
    touched.current = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({ left: cardLeft(rail, i), behavior: reduce ? "auto" : "smooth" });
  };

  const deckRow = (p: PlanDTO) => (
    <li className={"lp-pw-f lp-pw-f--addon" + (deckSpot ? " lp-pw-f--spot" : "")} data-plan-addon="deck" data-plan-spot-row={deckSpot ? "addon" : undefined}>
      <Plus />
      <span className="sr-only">Add-on: </span>
      <span className="lp-pw-ft">
        <span className="lp-pw-fn">Deck Studio</span>
        <b className="lp-pw-addon">Add-on {deckAddonShortWords(term === "YEAR" && p.yearlyPriceCents ? "YEAR" : "MONTH")}</b>
        {deckSpot ? <span className="lp-pw-spot-tag">{SPOTLIGHT_TAG}</span> : null}
      </span>
    </li>
  );

  return (
    <>
      {spotlight ? (
        <p className={"lp-pw-spot" + (tone === "ink" ? " lp-pw-spot--ink" : "")} data-plan-spotlight={spotlight} data-plan-spotlight-row={spot ?? ""}>
          <span className="lp-pw-spot-k">{SPOTLIGHT[spotlight].label}</span>
          {spotlightBanner(spotlight, plans)}
        </p>
      ) : null}
      {yearly ? (
        <div className="lp-pw-termrow">
          <PlanTermSwitch value={term} onChange={setTerm} tag={tag} tone={tone} />
        </div>
      ) : null}
      <div className="lp-pw-plans" ref={railRef}>
        {plans.map((p) => {
          const has = included.get(p.slug) ?? new Set<string>();
          return (
            <article
              key={p.slug}
              className={"lp-pw-plan" + (p.highlight ? " lp-pw-plan--hero" : "")}
              data-plan-card={p.slug}
              data-monthly-cents={p.priceCents}
              data-yearly-cents={p.yearlyPriceCents ?? undefined}
            >
              {p.highlight ? <span className="lp-pw-tag">Most picked</span> : null}
              {/* The name, and at the card's right edge the "N MONTHS FREE" stamp on a year (PlanCardHead). */}
              <PlanCardHead
                term={term}
                monthlyCents={p.priceCents}
                yearlyCents={p.yearlyPriceCents}
                name={<h3 className="lp-pw-plan-n">{p.name}</h3>}
              />
              <PlanPrice term={term} monthlyCents={p.priceCents} yearlyCents={p.yearlyPriceCents} figureClassName="lp-pw-price" />
              <PlanDealSlot term={term} monthlyCents={p.priceCents} yearlyCents={p.yearlyPriceCents} />
              <ul className="lp-pw-feats" data-plan-feats>
                {deckSpot ? deckRow(p) : null}
                {rows.map((f) => {
                  const lit = spot !== null && f === spot;
                  // The tool the visitor came for is in the plan when its gate says so, whatever the line reads (lib/planSpotlight).
                  const on = lit && spotlight ? spotlightInPlan(spotlight, p) : has.has(f.toLowerCase());
                  return (
                    <li key={f} className={(on ? "lp-pw-f" : "lp-pw-f lp-pw-f--no") + (lit ? " lp-pw-f--spot" : "")} data-plan-spot-row={lit ? (on ? "in" : "out") : undefined}>
                      {on ? <Check /> : <Minus />}
                      <span className="sr-only">{on ? "Included: " : "Not included: "}</span>
                      {/* The name and its tag (pricing-faq.css, .lp-pw-ft): the tag drops
                          under the name when the line cannot hold both, and the name
                          never breaks inside a word. */}
                      <span className="lp-pw-ft">
                        {/* No cap before the name (owner, 2026-10-28; on every plan card since 2026-11-04):
                            the tool alone. */}
                        <span className="lp-pw-fn">{f}</span>
                        {lit ? <span className="lp-pw-spot-tag">{on ? SPOTLIGHT_TAG : SPOTLIGHT_MISSING}</span> : null}
                      </span>
                    </li>
                  );
                })}
                {/* DECK STUDIO (owner, 2026-10-26): on no plan — the same add-on on every one (lib/deckAddon).
                    A trade estimator, so hidden during a roofer/fencer/HVAC ad visit; pinned first for a deck visitor
                    (owner, 2026-11-07). */}
                {deckLine && !deckSpot ? deckRow(p) : null}
              </ul>
              <a href={startHref} className="lp-pw-go" data-cta="pricing" data-cta-button={`plan-${p.slug}`}>
                Start {days}-day free trial
                <span className="sr-only"> on {p.name}</span>
              </a>
            </article>
          );
        })}
      </div>
      {plans.length > 1 ? (
        <div className="lp-pw-dots">
          {plans.map((p, i) => (
            <button
              key={p.slug}
              type="button"
              className="lp-pw-dot"
              aria-label={`Show the ${p.name} plan`}
              aria-current={i === active ? "true" : undefined}
              onClick={() => goTo(i)}
            >
              <span aria-hidden />
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
