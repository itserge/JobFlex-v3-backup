"use client";

// MOBILE SUBSCRIPTION — Blueprint system, handheld build (320–768px).
//
// ONE implementation, TWO entry points:
//   · /mobile-subscription-v2                — the direct preview route
//   · /dashboard/subscription at ≤768px      — the live URL, through the
//     media-query switch in ./subscription-responsive.tsx
// Both are server components that run the SAME fetch and the SAME owner-only
// guard and hand the result down as props, so the two cannot drift and the
// data never moves to the client.
//
// WHAT THIS IS A MERGE OF
//   · DESIGN comes from components/v3/subscription-blueprint (the approved
//     mockup port): the ink hero with its drawing grid and rotated status
//     stamp, the tier treatment, the usage meters, the invoice ledger, the
//     refer & earn block, the 3-cell KPI strip, Motion System "Balanced".
//   · DATA and BEHAVIOUR come from the live (dashboard)/dashboard/subscription
//     view: the admin-managed plan catalog, the limits engine's enforced caps,
//     real Stripe invoices, the org's referral code, and the real checkout
//     (usePlanCheckout → /api/checkout/subscription). Where the mockup's
//     control wrote nothing and the live control does something real, the live
//     behaviour wins. NOTHING here is a fixture.
//
// FIGURES THE MOCKUP SHOWS THAT THE LIVE DATA CANNOT SUPPLY are OMITTED, not
// invented — on a billing surface a fabricated number is the worst possible
// defect. Dropped, with the reason:
//   · "Acct № 2847"          — no account-number field exists.
//   · "Member since Mar 2026"— not read by this page's queries.
//   · "Seats 1 of 1"         — the limits engine exposes teamSeats/workers as
//                              usage rows, which is where they render instead.
//   · the 11-row feature MATRIX with per-tier columns — the catalog stores a
//     flat `features: string[]` per plan, not a feature × tier grid, so each
//     plan card lists its own real features (see "PLAN COMPARISON" below).
//   · "Build your plan" / "Custom" — not a row in /admin/plans, but since
//     2026-09-03 (owner's call) it renders the way the DESKTOP page renders
//     it: a synthetic card, marked current when Subscription.plan says
//     "custom", otherwise closing the list with the same Get started → the
//     upgrade flow. Same rule, both form factors.
//
// THE THREE HANDHELD PROBLEMS, and how they are solved:
//
// 1. PLAN COMPARISON. A multi-column pricing table is unreadable at 320px.
//    CHOSEN: full-width stacked plan cards, the org's current plan pinned
//    first, each card carrying its own real feature list, so comparison is
//    reading two adjacent cards rather than tracking a row across columns.
//    Every plan stays on the page — nothing is behind a gesture.
//    REJECTED: (a) a horizontally-snapping card rail — it hides plans
//    off-screen and turns "is Professional worth $50 more" into a
//    remember-and-swipe task; (b) a segmented tier switcher — same defect,
//    plus the switcher itself cannot hold five labels at 320px; (c) the
//    desktop feature matrix with a horizontal scroller — a 1000px-min table
//    panned sideways on a phone is exactly the surface the mobile rule exists
//    to prevent.
//
// 2. THE INVOICE TABLE. Four columns (number / date / status / amount) plus a
//    link cannot hold 320px. CHOSEN: each invoice becomes a two-line row —
//    number + status badge above, date + amount below — and the WHOLE row is
//    the anchor to Stripe's hosted invoice or PDF when one exists, at 64px
//    tall. Nothing is dropped: the link, the status tone and the amount all
//    survive. REJECTED: an overflow-x table (loses the tap affordance and
//    makes the amount the thing you have to pan to see) and hiding the
//    status column (it is the one column that changes what you do next).
//
// 3. USAGE METERS. The limits engine returns up to fifteen caps. CHOSEN: keep
//    every finite cap, keep the mono tabular `used / limit`, and sort by
//    PRESSURE (percentage used, descending; ties fall back to the engine's own
//    order) so the cap about to stop you is the one at the top of the card
//    rather than the one alphabetically first. The desktop's static order is a
//    deliberate change, noted here because it is the one place this build
//    reorders live data.
//
// Light mode only, no .dark, no Radix — the change-plan sheet is hand-rolled
// in the house style, with the shared swipe-to-dismiss hook.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { money, longDate } from "@/lib/format";
import {
  formatPlanPrice,
  priceCadence,
  type PlanDTO,
} from "@/lib/planCatalog";
import type { SubscriptionInvoice } from "@/actions/billing";
import { BillingRecovery } from "../payment-ribbon/billing-recovery";
import type { SubscriptionViewProps } from "@/app/(dashboard)/dashboard/subscription/subscription-load";
import { nextChargeLines, usd } from "@/app/(dashboard)/dashboard/subscription/next-charge-lines";
import { FreeSwitchNotice } from "@/components/billing/FreeSwitch";
import { CancelFlow } from "@/components/billing/CancelFlow";
import { UpdatePaymentCardButton } from "@/components/billing/PlanChangeNotes";
import { MobileUpgradeContent } from "@/components/v3/mobile-upgrade/mobile-upgrade";
import type { UpgradePlan } from "@/components/v3/upgrade-blueprint/upgrade-content";
import "./mobile-subscription.css";
import { DeckAddonCard } from "@/components/v3/deck-addon/deck-addon";
import { WebAddonCard } from "@/components/v3/web-estimator/web-addon-card";

/** One enforced-limit row from the limits engine (finite caps only). */
export interface MobileUsageRow {
  resource: string;
  label: string;
  used: number;
  limit: number;
}

/** The page's server props — one shape for both editions (subscription-load). */
export type MobileSubscriptionProps = SubscriptionViewProps;

const PROBLEM_STATUSES = ["PAST_DUE", "UNPAID", "CANCELED", "EXPIRED"];
/** A cap at or past this share of its limit raises the banner. */
const PRESSURE_ALERT = 90;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fire-and-forget: the clipboard is unavailable in insecure contexts and in
 *  some in-app browsers. The confirmation state is driven by the tap either
 *  way, exactly as the live view's copy control is. */
function copyText(text: string) {
  if (typeof navigator === "undefined") return;
  navigator.clipboard?.writeText(text).catch(() => undefined);
}

function Icon({ id, className }: { id: string; className?: string }) {
  return (
    <svg className={className ?? "jfms-ic"} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/** Same mapping the live view uses for a Stripe invoice status. */
function invoiceBadge(s: string | null): string {
  switch (s) {
    case "paid":
      return "jfms-ok";
    case "open":
      return "jfms-warn";
    case "void":
    case "uncollectible":
      return "jfms-bad";
    default:
      return "";
  }
}

function stampTone(status: string): string {
  if (status === "ACTIVE") return "jfms-stOk";
  if (status === "TRIALING") return "jfms-stWarn";
  if (PROBLEM_STATUSES.includes(status)) return "jfms-stBad";
  return "jfms-stNeutral";
}




/** Tier tone, positional exactly as the live view's is: plans cycle by catalog
 *  order; a slug outside the catalog takes the neutral graphite. See the CSS
 *  note on why the cycle is blueprint → sky → deep blueprint and not a status
 *  hue. */
function toneClass(plans: PlanDTO[], slug: string): string {
  const idx = plans.findIndex((p) => p.slug === slug);
  if (idx < 0) return "jfms-toneFree";
  return ["jfms-toneA", "jfms-toneB", "jfms-toneC"][idx % 3];
}

export function MobileSubscription({
  planName,
  priceCents,
  currentSlug,
  plans,
  status,
  accessBlocked,
  nextBill,
  trialEndsAt,
  cancellation,
  freeSwitch,
  freePlan,
  complimentary,
  usage,
  usageUnlimited = [],
  usageUnavailable = [],
  usageExempt,
  billingInformation,
  canUpdatePaymentCard,
  invoices,
  nextCharge,
  referral,
  customPages,
  trialCard,
  checkoutReady,
  customOffered,
  sandbox,
  interval,
  scheduledSwitch,
  cancel = null,
}: MobileSubscriptionProps) {

  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const plansRef = useRef<HTMLDivElement>(null);

  const [copied, setCopied] = useState<"code" | null>(null);
  const copyTimer = useRef(0);
  const [bannerOpen, setBannerOpen] = useState(true);

  /* ---------- Derived, all from the server props ---------------------- */

  const isTrial = status === "TRIALING" && !complimentary;

  // Pressure order. `slice()` first: the prop array is the server's and must
  // not be sorted in place.
  const usageSorted = useMemo(() => {
    return usage
      .map((u, i) => ({ ...u, i, pct: Math.min(100, (u.used / Math.max(1, u.limit)) * 100) }))
      .sort((a, b) => b.pct - a.pct || a.i - b.i);
  }, [usage]);

  const tightest = usageSorted.find((u) => !u.informational);
  const showBanner = bannerOpen && !!tightest && tightest.pct >= PRESSURE_ALERT;

  /* THE CARDS are the upgrade page's own (owner, 2026-09-04: one set of
     plan cards everywhere), embedded as a carousel below. */
  const upgradePlans = useMemo<UpgradePlan[]>(
    () =>
      plans
        .filter((p) => !p.isFree)
        .map((p) => ({
          slug: p.slug,
          name: p.name,
          description: p.description,
          priceCents: p.priceCents,
          yearlyPriceCents: p.yearlyPriceCents,
          trialDays: p.trialDays,
          features: p.features,
          limits: p.limits,
          highlight: p.highlight,
        })),
    [plans],
  );

  const nextChargeItems = useMemo(() => (nextCharge ? nextChargeLines(nextCharge) : []), [nextCharge]);

  /* ---------- Interactions -------------------------------------------- */

  const flash = useCallback((what: "code") => {
    setCopied(what);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1600);
  }, []);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const goToPlans = useCallback(() => {
    plansRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  /* ---------- Motion: usage bars draw to their real value -------------- */
  // Width is written here rather than in JSX so the bars animate from 0 on
  // first paint (the design's authored intent) and the markup stays free of
  // inline styles.
  useEffect(() => {
    const host = contentRef.current;
    if (!host) return;
    const bars = host.querySelectorAll<HTMLElement>("[data-w]");
    const paint = () => bars.forEach((b) => b.style.setProperty("--w", `${b.dataset.w}%`));
    if (prefersReducedMotion()) {
      paint();
      return;
    }
    const raf = requestAnimationFrame(() => requestAnimationFrame(paint));
    return () => cancelAnimationFrame(raf);
  }, [usageSorted]);

  /* ---------- Motion: graph-paper parallax ----------------------------- */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const host = scrollRef.current;
    if (!host) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        host.style.setProperty("--gy", `${(-(host.scrollTop * 0.06)).toFixed(1)}px`);
        ticking = false;
      });
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    return () => host.removeEventListener("scroll", onScroll);
  }, []);

  /* ---------- Motion: press stamp (delegated) --------------------------- */
  const onRootClick = useCallback((e: React.MouseEvent) => {
    if (prefersReducedMotion()) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("button, a");
    if (!el) return;
    el.classList.remove("jfms-pressed");
    void el.offsetWidth;
    el.classList.add("jfms-pressed");
    window.setTimeout(() => el.classList.remove("jfms-pressed"), 200);
  }, []);

  /* ---------- Render ---------------------------------------------------- */

  /* A complimentary plan (lib/planGrant) shows when it ends, never a next
     bill — nothing is billed (owner, 2026-09-22). */
  /* The Free plan (owner, 2026-10-13; lib/freePlan): on it since a date, or
     switching on one — never a next bill. A grant that expired: when access
     ended. */
  const billLabel = complimentary
    ? "Complimentary until"
    : freePlan
      ? "On Free since"
      : freeSwitch
        ? "Switches to Free"
        : cancellation
      ? cancellation.ended
        ? "Access ended"
        : "Access until"
      : isTrial
        ? "Trial ends"
        : "Next bill";
  const billValue = complimentary
    ? complimentary.endsAt
      ? longDate(complimentary.endsAt)
      : "No end date"
    : freePlan
      ? freePlan.since
        ? longDate(freePlan.since)
        : "—"
      : freeSwitch
        ? freeSwitch.at
          ? longDate(freeSwitch.at)
          : "End of cycle"
        : cancellation
      ? cancellation.accessUntil
        ? longDate(cancellation.accessUntil)
        : "—"
      : isTrial
      ? trialEndsAt
        ? longDate(trialEndsAt)
        : "On trial"
      : nextBill
        ? longDate(nextBill)
        : "—";

  return (
    <div className="jf-mobile-subscription" onClick={onRootClick}>
      {/* Shared handheld chrome: dark topbar, drawer with the full nav map,
          and the icon sprite every <use href="#i-…"> below resolves against.
          Owns its own open state, so this page holds none. */}
      <MobileNav />

      <main className="jfms-scroll" ref={scrollRef}>
        <div className="jfms-content" ref={contentRef}>
          {/* ============ PAGE HEAD ============ */}
          <div className="jfms-pageHead">
            <div className="jfms-kicker">Account</div>
            <h1 className="jfms-pageTitle">Subscription</h1>
            <p className="jfms-pageSub">Your plan, what it bills, and what it has cost.</p>
          </div>

          <BillingRecovery isOwner status={status} blocked={accessBlocked} />

          {/* ============ PLAN LIMIT BANNER ============
              Raised only by a real cap at ≥90%, and it names that cap. */}
          {showBanner && tightest ? (
            <div className="jfms-banner">
              <Icon id="i-bulb" className="jfms-ic jfms-bannerPin" />
              <div className="jfms-bannerBody">
                <div className="jfms-bannerKicker">Plan limit</div>
                <div className="jfms-bannerTxt">
                  {`${tightest.label}: ${tightest.used.toLocaleString()} of ${tightest.limit.toLocaleString()} used this cycle.`}
                </div>
                <button type="button" className="jfms-bannerCta" onClick={goToPlans}>
                  See plans
                </button>
              </div>
              <button
                type="button"
                className="jfms-bannerClose"
                aria-label="Dismiss plan limit notice"
                onClick={() => setBannerOpen(false)}
              >
                <Icon id="i-x" />
              </button>
            </div>
          ) : null}

          {/* ============ CURRENT PLAN HERO ============ */}
          <section className={`jfms-hero ${toneClass(plans, currentSlug)}`} aria-label="Current plan">
            <span className="jfms-heroEdge" aria-hidden="true" />
            <div className="jfms-heroTop">
              {/* The status stamp rides the TOP-RIGHT corner (owner's call,
                  2026-08-12), paired with the "Your plan" kicker rather than
                  hanging under the price. In the head row, not absolutely
                  positioned: a long status ("PAST DUE") over a long plan name
                  would collide, and here the row simply lays them out. */}
              <div className="jfms-heroHead">
                <div className="jfms-heroMeta">Your plan</div>
                <div className={`jfms-stamp ${complimentary ? "jfms-stOk" : freePlan ? "jfms-stNeutral" : freeSwitch ? "jfms-stWarn" : stampTone(cancellation ? "EXPIRED" : status)}`}>
                  {complimentary ? "complimentary" : freePlan ? "free" : freeSwitch ? "switching to free" : cancellation ? "ended" : status.replace(/_/g, " ").toLowerCase()}
                </div>
              </div>
              <h2 className="jfms-heroName">{planName}</h2>
              <div className="jfms-heroRow">
                <span className="jfms-heroPrice">
                  {complimentary ? "$0" : priceCents !== null ? formatPlanPrice(priceCents) : "—"}
                  {complimentary ? <i>free of charge</i> : priceCents !== null ? <i>{interval === "YEAR" ? "/yr" : priceCadence(true)}</i> : null}
                </span>
              </div>
            </div>
            <div className="jfms-heroFacts">
              <div className="jfms-heroFact">
                <span className="jfms-heroFactL">{billLabel}</span>
                <span className="jfms-heroFactV">{billValue}</span>
              </div>
              <div className="jfms-heroFact">
                <span className="jfms-heroFactL">{complimentary ? "Then" : freePlan?.wasName ? "Was" : "Billing"}</span>
                <span className="jfms-heroFactV">
                  {complimentary ? (complimentary.after === "free" ? "Free plan" : "Choose a plan") : freePlan ? freePlan.wasName || "Nothing billed" : freeSwitch ? "Nothing more" : priceCents === null ? "—" : interval === "YEAR" ? "Per year" : "Per month"}
                </span>
              </div>
            </div>
            {/* A card-less trial's card (lib/trialCardLine, 2026-10-09): one
                more pressed band, the way to add one at its right. */}
            {trialCard ? (
              <div className="jfms-heroFacts jfms-heroCard" data-trial-card>
                <div className="jfms-heroFact">
                  <span className="jfms-heroFactL">Card</span>
                  <span className="jfms-heroFactV">{trialCard.value}</span>
                </div>
                {trialCard.addHref ? (
                  <Link className="jfms-heroCardLink" href={trialCard.addHref as Route}>
                    Add a card
                  </Link>
                ) : null}
              </div>
            ) : null}
            {/* The way out (owner, 2026-11-09): the plan card's foot, a quiet
                full-width outline — the one place an owner cancels. */}
            {cancel ? (
              <div className="jfms-heroFoot">
                <CancelFlow offer={cancel} className="jfms-heroCancel" />
              </div>
            ) : null}
          </section>

          {/* The Deck Studio add-on (2026-10-19) — reads its own state. */}
          <DeckAddonCard />
          <WebAddonCard />

          <section className="jfms-card" aria-labelledby="jfmsBillingInfoT">
            <div className="jfms-cardHead">
              <h2 className="jfms-cardTitle" id="jfmsBillingInfoT">Billing information</h2>
            </div>
            <div className="jfms-cardBody">
              <dl className="jfms-billingInfo">
                <div><dt>Business</dt><dd>{billingInformation?.name || "Not set"}</dd></div>
                <div><dt>Billing email</dt><dd>{billingInformation?.billingEmail || "Not set"}</dd></div>
              </dl>
              <Link className="jfms-btn jfms-billingEdit" href={"/dashboard/settings?tab=billing" as Route}>Edit billing email</Link>
              {canUpdatePaymentCard ? <UpdatePaymentCardButton className="jfms-btn jfms-billingEdit" /> : null}
            </div>
          </section>

          {/* ============ THE SWITCH TO FREE, BOOKED ============
              The date and the way back (lib/freePlan). Cancelling itself is
              the plan card's foot button. */}
          {freeSwitch && !complimentary ? (
            <FreeSwitchNotice planName={planName} at={freeSwitch.at} canKeep />
          ) : null}

          {/* ============ USAGE ============ */}
          <details className="jfms-card jfms-usage" aria-labelledby="jfmsUsageT">
            <summary className="jfms-cardHead jfms-disclosureHead">
              <h2 className="jfms-cardTitle" id="jfmsUsageT">
                Usage
              </h2>
              <span className="jfms-usageCount">{usageSorted.length + usageUnlimited.length + usageUnavailable.length} quotas</span>
              <svg className="jfms-disclosureArrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </summary>
            <div className="jfms-cardBody">
              {usageSorted.length === 0 && usageUnlimited.length === 0 && usageUnavailable.length === 0 ? (
                <div className="jfms-empty">
                  <div className="jfms-emptyT">{usageExempt ? "Unlimited · platform admin" : "No caps on this plan"}</div>
                  <div className="jfms-emptyS">
                    {usageExempt ? "The plan's caps do not apply to a platform admin in their own organization." : "Everything on your plan is unlimited."}
                  </div>
                </div>
              ) : (
                usageSorted.map((u) => {
                  const tone = u.informational ? "" : u.pct >= 90 ? "jfms-hot" : u.pct >= 60 ? "jfms-warn" : "";
                  return (
                    <div key={u.resource} className={`jfms-usRow ${tone}`}>
                      <div className="jfms-usTop">
                        <span className="jfms-usLbl">{u.label}</span>
                        <span className="jfms-usNum">
                          {`${u.used.toLocaleString()} / ${u.limit.toLocaleString()}`}
                        </span>
                      </div>
                      <div className="jfms-usBar">
                        <span
                          className={`jfms-usFill ${tone}`}
                          data-w={u.pct.toFixed(1)}
                          role="progressbar"
                          aria-label={u.label}
                          aria-valuenow={u.used}
                          aria-valuemin={0}
                          aria-valuemax={u.limit}
                          style={{ "--w": `${u.pct.toFixed(1)}%` } as React.CSSProperties}
                        />
                      </div>
                      {u.hint ? <p className="jfms-usHint">{u.hint}</p> : null}
                    </div>
                  );
                })
              )}
              {usageUnlimited.map((u) => (
                <div key={u.resource} className="jfms-usRow">
                  <div className="jfms-usTop">
                    <span className="jfms-usLbl">{u.label}</span>
                    <span className="jfms-usNum">{u.used.toLocaleString()} / Unlimited</span>
                  </div>
                  {u.hint ? <p className="jfms-usHint">{u.hint}</p> : null}
                </div>
              ))}
              {usageUnavailable.map((u) => (
                <div key={u.resource} className="jfms-usRow">
                  <div className="jfms-usTop">
                    <span className="jfms-usLbl">{u.label}</span>
                    <span className="jfms-usNum">Unavailable / {u.limit === null ? "Unlimited" : u.limit.toLocaleString()}</span>
                  </div>
                  <p className="jfms-usHint">{u.hint}</p>
                </div>
              ))}
              {usageExempt ? <p className="jfms-usHint">Plan limits do not apply to a platform admin in their own organization.</p> : null}
            </div>
          </details>

          {/* ============ PLANS — the upgrade page's cards, as a carousel ============ */}
          <div className="jfms-plansEmbed" ref={plansRef}>
            <MobileUpgradeContent
              embedded
              compactFeatures
              plans={upgradePlans}
              currentPlan={currentSlug}
              currentInterval={interval ?? null}
              scheduledSwitch={scheduledSwitch ?? null}
              customPages={customPages ?? []}
              isOwner
              checkoutReady={checkoutReady}
              customOffered={customOffered}
              sandbox={sandbox}
              upgradedTo={null}
              cancelled={false}
            />
          </div>

          {/* ============ BILLING HISTORY ============ */}
          <section className="jfms-card" aria-labelledby="jfmsBillT">
            <div className="jfms-cardHead">
              <h2 className="jfms-cardTitle" id="jfmsBillT">
                Billing history
              </h2>
              <Icon id="i-file" className="jfms-ic jfms-cardHeadIc" />
            </div>
            <div className="jfms-cardBody">
              <p className="jfms-billingNote">Your invoices and payment history appear here.</p>
              {/* THE NEXT BILL (owner, 2026-09-14): date, amount, and what the
                  people who used the referral code take off it. */}
              {nextCharge ? (
                <div className="jfms-next">
                  <div className="jfms-nextTop">
                    <div className="jfms-nextL">
                      <span className="jfms-nextK">
                        {nextCharge.estimated ? "Next bill · estimate" : "Next bill"}
                      </span>
                      <span className="jfms-nextD">
                        {nextCharge.dueAt ? longDate(nextCharge.dueAt) : "Date pending"}
                      </span>
                    </div>
                    <div className="jfms-nextR">
                      {nextCharge.amountDueCents < nextCharge.subtotalCents ? (
                        <s className="jfms-nextWas">{usd(nextCharge.subtotalCents)}</s>
                      ) : null}
                      <span className="jfms-nextAmt">{usd(nextCharge.amountDueCents)}</span>
                    </div>
                  </div>
                  {nextChargeItems.length ? (
                    <ul className="jfms-nextLines">
                      {nextChargeItems.map((l) => (
                        <li key={l.label} className={l.tone === "note" ? "jfms-nextNote" : ""}>
                          <span>{l.label}</span>
                          {l.amount ? <b>{l.amount}</b> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <InvoiceRows data={invoices} />
            </div>
          </section>

          {/* ============ REFER & EARN ============ */}
          <section className="jfms-card" aria-labelledby="jfmsRefT">
            <div className="jfms-cardHead">
              <h2 className="jfms-cardTitle" id="jfmsRefT">
                Refer &amp; earn
              </h2>
              <Icon id="i-gift" className="jfms-ic jfms-cardHeadIc" />
            </div>
            <div className="jfms-cardBody">
              <div className="jfms-refRow">
                <button
                  type="button"
                  className="jfms-refCode"
                  onClick={() => {
                    copyText(referral.code);
                    flash("code");
                  }}
                >
                  {referral.code}
                </button>
                <button
                  type="button"
                  className={`jfms-refCopy ${copied === "code" ? "jfms-isDone" : ""}`}
                  aria-label="Copy referral code"
                  onClick={() => {
                    copyText(referral.code);
                    flash("code");
                  }}
                >
                  <Icon id={copied === "code" ? "i-check" : "i-copy"} />
                </button>
              </div>
              <p className="jfms-refReward">{referral.rewardSummary}</p>
            </div>
            <div className="jfms-kpiGrid">
              <div className="jfms-kpi">
                <div className="jfms-kpiLbl">Code uses</div>
                <div className="jfms-kpiVal">{referral.uses}</div>
              </div>
              <div className="jfms-kpi">
                <div className="jfms-kpiLbl">Converted</div>
                <div className="jfms-kpiVal">{referral.converted}</div>
              </div>
              <div className="jfms-kpi">
                <div className="jfms-kpiLbl">Pending</div>
                <div className="jfms-kpiVal">{referral.pending}</div>
              </div>
            </div>
          </section>
        </div>
      </main>

    </div>
  );
}

function InvoiceRows({ data }: { data: { available: boolean; invoices: SubscriptionInvoice[] } }) {
  if (!data.available) {
    return (
      <div className="jfms-empty">
        <Icon id="i-card" className="jfms-ic jfms-emptyIc" />
        <div className="jfms-emptyS">
          Invoices appear here once Stripe subscription billing is active for your account.
        </div>
        <div className="jfms-emptyT">No invoices yet</div>
      </div>
    );
  }
  if (data.invoices.length === 0) {
    return (
      <div className="jfms-empty">
        <Icon id="i-card" className="jfms-ic jfms-emptyIc" />
        <div className="jfms-emptyS">Your first invoice will show up here after it is issued.</div>
        <div className="jfms-emptyT">No invoices yet</div>
      </div>
    );
  }

  return (
    <div className="jfms-invList">
      {data.invoices.map((inv) => {
        const link = inv.hostedInvoiceUrl ?? inv.invoicePdf;
        const body = (
          <>
            <span className="jfms-invTop">
              <span className="jfms-invNo">{inv.number ?? "Invoice"}</span>
              <span className={`jfms-badge ${invoiceBadge(inv.status)}`}>{inv.status ?? "—"}</span>
              {link ? (
                <span className="jfms-invGo" aria-hidden="true">
                  <Icon id="i-arrow" />
                </span>
              ) : null}
            </span>
            <span className="jfms-invBot">
              <span className="jfms-invDate">{longDate(new Date(inv.created * 1000))}</span>
              <span className="jfms-invAmt">
                {money((inv.status === "open" ? inv.amountDueCents : inv.amountPaidCents) / 100, inv.currency)}
              </span>
            </span>
          </>
        );
        return link ? (
          <a
            key={inv.id}
            className="jfms-invRow"
            href={link}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open invoice ${inv.number ?? ""}`.trim()}
          >
            {body}
          </a>
        ) : (
          <div key={inv.id} className="jfms-invRow">
            {body}
          </div>
        );
      })}
    </div>
  );
}
