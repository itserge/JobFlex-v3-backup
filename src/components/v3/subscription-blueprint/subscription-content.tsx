"use client";

// Subscription overview shares the live loader and plan actions with the
// dedicated mobile composition. Cancelling lives here, at the foot of the plan
// card (owner, 2026-11-09 — components/billing/CancelFlow, the one place an
// owner cancels). Secondary details use native disclosures.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { UpgradeContent, type UpgradePlan } from "@/components/v3/upgrade-blueprint/upgrade-content";
import { longDate } from "@/lib/format";
import { useBlueprintContent } from "@/components/v3/blueprint-shell/use-blueprint-content";
import { initSubscriptionContent } from "./subscription-behavior";
import { SubscriptionSprite } from "./subscription-sprite";
// Type-only: erased at compile, so the loader's server imports never reach
// this client bundle.
import { BillingRecovery } from "../payment-ribbon/billing-recovery";
import type { SubscriptionViewProps } from "@/app/(dashboard)/dashboard/subscription/subscription-load";
import { FreeSwitchNotice } from "@/components/billing/FreeSwitch";
import { CancelFlow } from "@/components/billing/CancelFlow";
import { useUpdateCard } from "@/components/v3/payment-ribbon/payment-ribbon";
import { nextChargeLines, usd } from "@/app/(dashboard)/dashboard/subscription/next-charge-lines";
import styles from "./subscription.module.css";
import { DeckAddonCard } from "@/components/v3/deck-addon/deck-addon";
import { WebAddonCard } from "@/components/v3/web-estimator/web-addon-card";

const UPGRADE = "/dashboard/upgrade" as Route;
/** Usage rows in view before "View all usage". */
const USAGE_IN_VIEW = 3;

/** Epoch seconds → the fixture's date voice ("Jul 1, 2026"). */
function fmtDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Class list by the SOURCE's literal names, so the JSX below reads as the
 * mockup's markup does and the stylesheet stays diffable against it.
 *
 * The fallback matters: four class names in the source's markup — `sub-hero-l`,
 * `us-list`, `inv-list`, `ref-l` — have no rule anywhere in its stylesheet, so
 * the module exports nothing for them. They are emitted literally rather than
 * dropped, to keep the markup faithful; each was checked against the shell's
 * always-on modules first and none is claimed there, so they style nothing and
 * can collide with nothing.
 */
function cx(...names: Array<string | false | null | undefined>): string {
  return names
    .filter(Boolean)
    .map((n) => styles[n as string] ?? (n as string))
    .join(" ");
}

/** `rv` stays LITERAL: the entrance cascade is published once, globally, by the
 *  always-on dashboard module (`.bp :global(.rv)`), with the same values the
 *  source declares. Porting a second hashed copy would be two definitions of
 *  one thing. */
const RV = "rv";

/** Billing information's two buttons (owner, 2026-10-17): one row of equal
 *  ghost buttons, the card note one line under the row — never under one
 *  button, so the two stay level. The card form is the existing one
 *  (useUpdateCard → /api/billing/update-card). */
function BillingActions({ canUpdateCard }: { canUpdateCard: boolean }) {
  const card = useUpdateCard();
  return (
    <div className={cx("billing-actions")}>
      <div className={cx("billing-btns")}>
        <Link className={cx("btn", "btn-ghost")} href={"/dashboard/settings?tab=billing" as Route}>Edit billing email</Link>
        {canUpdateCard ? (
          <button
            type="button"
            className={cx("btn", "btn-ghost")}
            disabled={card.busy}
            aria-busy={card.busy}
            aria-describedby="billingCardHelp"
            onClick={() => void card.go()}
          >
            {card.busy ? "Opening…" : "Update payment card"}
          </button>
        ) : null}
      </div>
      {canUpdateCard ? (
        <p className={cx("billing-help")} id="billingCardHelp">A new card will also be used to pay any outstanding invoices.</p>
      ) : null}
      {card.error ? <p className={cx("billing-err")} role="alert">{card.error}</p> : null}
    </div>
  );
}

export function SubscriptionContent(props: SubscriptionViewProps) {
  const [copyLabel, setCopyLabel] = useState("Copy");
  const copyTimer = useRef(0);

  useBlueprintContent(initSubscriptionContent);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  /* THE PLAN BUTTONS DO THE THING (owner, 2026-09-02). A shop with a Stripe
     subscription is switched in place — up charges the difference, down is
     free — and one without is sent through checkout. */
  /* THE CARDS are the upgrade page's own (owner, 2026-09-04: one set of
     plan cards everywhere): same labels, same confirm dialogs, same custom
     picker, embedded here without its page head. */
  const upgradePlans = useMemo<UpgradePlan[]>(
    () =>
      props.plans
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
    [props.plans],
  );

  const spotlight = props.spotlight ?? null;

  const comp = props.complimentary;
  const ended = props.cancellation;
  // The Free plan (lib/freePlan): booked, or the company is on it.
  const freeSwitch = props.freeSwitch ?? null;
  const freePlan = props.freePlan ?? null;
  const statusLabel = comp
    ? "Complimentary"
    : freePlan
      ? "Free"
      : ended
      ? "Ended"
      : freeSwitch
      ? "Switching to Free"
      : props.status
        ? props.status.charAt(0).toUpperCase() + props.status.slice(1).toLowerCase().replace(/_/g, " ")
        : "—";
  const isTrial = props.status === "TRIALING" && !comp;
  const nextCharge = props.nextCharge;
  const nextChargeItems = useMemo(() => (nextCharge ? nextChargeLines(nextCharge) : []), [nextCharge]);

  const [usageOpen, setUsageOpen] = useState(false);
  // Only what the plan caps; a resource with no cap is left out (owner, 2026-10-17).
  const usageRows = [
    ...props.usage.map((u) => {
      const pct = u.limit > 0 ? Math.min(100, (u.used / u.limit) * 100) : 0;
      const cls = u.informational ? "" : pct >= 90 ? "hot" : pct >= 60 ? "warn" : "";
      return (
        <div key={u.label} className={cx("us-row")}>
          <div className={cx("us-top")}>
            <span className={cx("us-lbl")}>{u.label}</span>
            <span className={cx("us-num")}>{u.used + " / " + u.limit}</span>
          </div>
          <div className={cx("us-bar")}>
            {/* width is written by the behavior module from data-w,
                never by React — see its "USAGE BARS" note. */}
            <span className={cx("us-fill", cls)} data-w={pct.toFixed(1)}></span>
          </div>
          {u.hint ? <p className={cx("us-hint")}>{u.hint}</p> : null}
        </div>
      );
    }),
    ...(props.usageUnavailable ?? []).map((u) => (
      <div key={u.resource} className={cx("us-row")}>
        <div className={cx("us-top")}><span className={cx("us-lbl")}>{u.label}</span><span className={cx("us-num")}>Unavailable</span></div>
        <p className={cx("us-hint")}>{u.hint}</p>
      </div>
    )),
  ];

  const copyCode = useCallback(() => {
    const code = props.referral.code;
    const done = () => {
      setCopyLabel("Copied");
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopyLabel("Copy"), 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, done);
    } else {
      done();
    }
  }, [props.referral.code]);

  return (
    <>
      {/* PAGE HEAD */}
      <div className={cx("page-head", RV)}>
        <div>
          <div className={cx("kicker")}>Account</div>
          <h1 className={cx("page-title")}>Subscription</h1>
        </div>
        <div className={cx("page-actions")}>
          <Link className={cx("btn", "btn-primary")} href={UPGRADE}>
            <svg className={cx("ic")}>
              <use href="#i-arrow" />
            </svg>
            Upgrade plan
          </Link>
        </div>
      </div>

      <BillingRecovery isOwner status={props.status} blocked={props.accessBlocked} />

      {/* CURRENT PLAN HERO */}
      <section className={cx("sub-hero", props.cancel && "sub-hero--foot", RV)}>
        <div className={cx("sub-hero-l")}>
          <div className={cx("sub-hero-meta")}>Your plan</div>
          <div className={cx("sub-hero-name")}>{props.planName}</div>
          <div className={cx("sub-hero-row")}>
            <span className={cx("sub-hero-price")}>
              {comp ? (
                <>
                  {"$0"}
                  <i>/ mo · free of charge</i>
                </>
              ) : props.priceCents === null ? (
                "—"
              ) : (
                <>
                  {"$" + Math.round(props.priceCents / 100)}
                  <i>{props.interval === "YEAR" ? "/ yr" : "/ mo"}</i>
                </>
              )}
            </span>
          </div>
        </div>
        <div className={cx("sub-hero-r")}>
          <div className={cx("sub-stamp-zone")}>
            <span className={cx("sub-stamp")}>{statusLabel}</span>
          </div>
          {/* The stamp already says the status; the facts are the two dates,
              as dates — "Sep 16, 2026", not an ISO timestamp (owner). A trial
              shows its end; an active plan shows its next bill. */}
          <div className={cx("sub-hero-facts")}>
            {comp ? (
              /* A grant: when it ends and what follows — never a "next bill",
                 because nothing is billed (owner, 2026-09-22). */
              <>
                <div>
                  <span>Complimentary until</span>
                  <b>{comp.endsAt ? longDate(comp.endsAt) : "No end date"}</b>
                </div>
                <div>
                  <span>Then</span>
                  <b>{comp.after === "free" ? "Free plan" : "Choose a plan"}</b>
                </div>
              </>
            ) : freePlan ? (
              /* On the Free plan (owner, 2026-10-13): since when, and the
                 plan it had — nothing is billed. */
              <>
                {freePlan.since ? (
                  <div>
                    <span>On Free since</span>
                    <b>{longDate(freePlan.since)}</b>
                  </div>
                ) : null}
                <div>
                  <span>{freePlan.wasName ? "Was" : "Billed"}</span>
                  <b>{freePlan.wasName || "Nothing"}</b>
                </div>
              </>
            ) : freeSwitch ? (
              /* Booked: the plan runs to the end of the cycle, then Free —
                 never a next bill, nothing more is charged. */
              <div>
                <span>Switches to Free</span>
                <b>{freeSwitch.at ? longDate(freeSwitch.at) : "End of cycle"}</b>
              </div>
            ) : ended ? (
              /* A grant that expired: when access ended. */
              <div>
                <span>{ended.ended ? "Access ended" : "Access until"}</span>
                <b>{ended.accessUntil ? longDate(ended.accessUntil) : "—"}</b>
              </div>
            ) : (
              <>
                {isTrial && props.trialEndsAt ? (
                  <div>
                    <span>Trial ends</span>
                    <b>{longDate(props.trialEndsAt)}</b>
                  </div>
                ) : null}
                <div>
                  <span>{isTrial ? "First bill" : "Next bill"}</span>
                  <b>{longDate(props.nextBill ?? props.trialEndsAt)}</b>
                </div>
              </>
            )}
            {/* A card-less trial's card (lib/trialCardLine, 2026-10-09): the
                place the welcome email points to. Nobody else gets the line. */}
            {props.trialCard ? (
              <div data-trial-card>
                <span>Card</span>
                <b>{props.trialCard.value}</b>
                {props.trialCard.addHref ? (
                  <Link className={cx("sub-hero-link")} href={props.trialCard.addHref as Route}>
                    Add a card
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        {/* THE WAY OUT (owner, 2026-11-09): a quiet secondary button at the
            card's foot, the one place an owner cancels (lib/cancelOfferServer
            says when there is one). */}
        {props.cancel ? (
          <div className={cx("sub-hero-foot")}>
            <CancelFlow offer={props.cancel} className={cx("sub-cancel")} />
          </div>
        ) : null}
      </section>

      {/* THE DECK STUDIO ADD-ON (owner, 2026-10-19): on the plan with Remove, or the way to add it — reads its own state. */}
      <div className={cx(RV)}>
        <DeckAddonCard />
        <WebAddonCard />
      </div>

      {/* THE SWITCH TO FREE, BOOKED (owner, 2026-10-13): the date and the
          way back. Cancelling itself is the plan card's foot button. */}
      {freeSwitch && !comp ? (
        <FreeSwitchNotice className={cx(RV)} planName={props.planName} at={freeSwitch.at} canKeep />
      ) : null}

      {/* PLANS — the upgrade page's cards, embedded */}
      <section className={cx("plans-embed", RV)} id="plans">
        <UpgradeContent
          embedded
          compactFeatures
          spotlight={spotlight}
          plans={upgradePlans}
          currentPlan={props.currentSlug}
          currentInterval={props.interval ?? null}
          scheduledSwitch={props.scheduledSwitch ?? null}
          customPages={props.customPages ?? []}
          isOwner
          checkoutReady={props.checkoutReady}
          customOffered={props.customOffered}
          sandbox={props.sandbox}
          upgradedTo={null}
          cancelled={false}
        />
      </section>

      {/* USAGE + BILLING */}
      <div className={cx("row-ub", RV)}>
        <div className={cx("card")} id="usageCard">
          <div className={cx("card-head")}>
            <h2>Usage</h2>
          </div>
          {/* USAGE (owner, 2026-10-17): what the plan caps, the first rows in
              view and the rest behind one smooth fold; a resource with no cap
              is not listed. */}
          {props.usageExempt ? (
            <div className={cx("us-note")}>Unlimited · platform admin</div>
          ) : usageRows.length === 0 ? (
            <div className={cx("us-note")}>Nothing on your plan has a cap.</div>
          ) : (
            <div className={cx("usage-fold")} data-open={usageOpen ? "1" : "0"}>
              <div className={cx("us-list")} id="usList">
                {usageRows.slice(0, USAGE_IN_VIEW)}
                {usageRows.length > USAGE_IN_VIEW ? (
                  <div className={cx("us-more")} id="usMore" inert={!usageOpen}>
                    <div className={cx("us-more-in")}>{usageRows.slice(USAGE_IN_VIEW)}</div>
                  </div>
                ) : null}
              </div>
              {usageRows.length > USAGE_IN_VIEW ? (
                <button
                  type="button"
                  className={cx("us-toggle")}
                  aria-expanded={usageOpen}
                  aria-controls="usMore"
                  onClick={() => setUsageOpen((o) => !o)}
                >
                  <span>{usageOpen ? "Show less" : `View all usage · ${usageRows.length - USAGE_IN_VIEW} more`}</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
              ) : null}
            </div>
          )}
        </div>
        <div className={cx("card", "bill-card")} id="billCard">
          <div className={cx("card-head")}>
            <h2>Billing history</h2>
          </div>
          <p className={cx("bill-description")}>
            {!props.invoices.available
              ? "Invoices appear here once Stripe billing is active for your account."
              : "View your invoices and payment receipts."}
          </p>
          <p className={cx("bill-count")}>
              {props.invoices.invoices.length === 0
                ? "No invoices yet"
                : `${props.invoices.invoices.length} invoice${props.invoices.invoices.length === 1 ? "" : "s"}`}
          </p>

          {/* THE NEXT BILL, as Stripe will charge it — one framed block, the
              amount first, every coupon and referral credit itemised under
              it (owner, 2026-09-02; redrawn 2026-09-04 after the critique:
              the old row crammed three lines into a ledger cell). */}
          {nextCharge ? (
            <div className={cx("bill-next")}>
              <div className={cx("bill-next-l")}>
                <span className={cx("bill-next-k")}>{nextCharge.estimated ? "Next bill · estimate" : "Next bill"}</span>
                <span className={cx("bill-next-d")}>
                  {nextCharge.dueAt ? longDate(nextCharge.dueAt) : "Date pending"}
                </span>
              </div>
              <div className={cx("bill-next-r")}>
                {nextCharge.amountDueCents < nextCharge.subtotalCents ? (
                  <s className={cx("bill-next-was")}>{usd(nextCharge.subtotalCents)}</s>
                ) : null}
                <span className={cx("bill-next-amt")}>{usd(nextCharge.amountDueCents)}</span>
              </div>
              {nextChargeItems.length ? (
                <ul className={cx("bill-lines")}>
                  {nextChargeItems.map((l) => (
                    <li key={l.label} className={cx(l.tone === "note" && "bill-line-note")}>
                      <span>{l.label}</span>
                      {l.amount ? <b className={cx("bill-line-amt")}>{l.amount}</b> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {props.invoices.available && props.invoices.invoices.length > 0 ? (
            <>
              <div className={cx("inv-head")}>
                <span>Invoice</span>
                <span>Date</span>
                <span>Status</span>
                <span className={cx("ta-r")}>Amount</span>
              </div>
              <div className={cx("inv-list")} id="invList">
                {props.invoices.invoices.map((v) => (
                  <div key={v.id} className={cx("inv-row")}>
                    <span className={cx("inv-no")}>
                      {v.hostedInvoiceUrl ? (
                        <a href={v.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                          {v.number ?? v.id.slice(0, 12)}
                        </a>
                      ) : (
                        (v.number ?? v.id.slice(0, 12))
                      )}
                    </span>
                    <span className={cx("inv-date")}>{fmtDate(v.created)}</span>
                    <span>
                      <span className={cx("st-badge", v.status === "paid" ? "" : "warn")}>
                        {v.status ?? "—"}
                      </span>
                    </span>
                    <span className={cx("inv-amt")}>{"$" + ((v.status === "open" ? v.amountDueCents : v.amountPaidCents) / 100).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className={cx("bill-foot")}>Receipts open on Stripe · amounts in USD</div>
            </>
          ) : null}
        </div>
      </div>

      <section className={cx("card", "billing-information", RV)}>
        <div className={cx("card-head")}><h2>Billing information</h2></div>
        <div className={cx("billing-information-body")}>
          {props.billingInformation ? (
            <dl className={cx("billing-fields")}>
              {props.billingInformation.name ? <div><dt>Business name</dt><dd>{props.billingInformation.name}</dd></div> : null}
              <div><dt>Billing email</dt><dd>{props.billingInformation.billingEmail || "Not added"}</dd></div>
            </dl>
          ) : null}
          <BillingActions canUpdateCard={props.canUpdatePaymentCard === true} />
        </div>
      </section>

      {/* REFER & EARN */}
      <section className={cx("card", RV)}>
        <div className={cx("card-head")}>
          <h2>Refer &amp; earn</h2>
          <svg className={cx("ic", "card-head-ic")}>
            <use href="#i-gift" />
          </svg>
        </div>
        <div className={cx("ref-grid")}>
          <div className={cx("ref-l")}>
            <div className={cx("ref-code-row")}>
              <span className={cx("ref-code")} id="refCode">
                {props.referral.code}
              </span>
              <button
                className={cx("btn", "btn-ghost", "ref-copy")}
                type="button"
                id="refCopy"
                onClick={copyCode}
              >
                <svg className={cx("ic")}>
                  <use href="#i-copy" />
                </svg>
                <span id="refCopyLbl">{copyLabel}</span>
              </button>
            </div>
            <div className={cx("ref-reward")}>{props.referral.rewardSummary}</div>
          </div>
          <div className={cx("kpi-grid", "kpi-grid--3")}>
            <div className={cx("kpi")}>
              <div className={cx("kpi-lbl")}>Code uses</div>
              <div className={cx("kpi-val")}>{props.referral.uses}</div>
            </div>
            <div className={cx("kpi")}>
              <div className={cx("kpi-lbl")}>Converted</div>
              <div className={cx("kpi-val")}>{props.referral.converted}</div>
            </div>
            <div className={cx("kpi")}>
              <div className={cx("kpi-lbl")}>Pending</div>
              <div className={cx("kpi-val")}>{props.referral.pending}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Out of flow, so it is not a flex item and adds no gap. Last, so it
          cannot shift the reveal cascade's stagger indices. */}
      <SubscriptionSprite />

      {/* The source's second <style> block, verbatim. Without JS the reveal
          cascade never runs, and the `rv` class the markup carries would leave
          every block parked at opacity 0 — this is the escape hatch that keeps
          the page readable. suppressHydrationWarning because the HTML parser
          hands a scripting-enabled browser the noscript's contents as raw text,
          which never matches the element React expects; the markup React ships
          is correct either way. */}
      <noscript suppressHydrationWarning>
        <style>{`.rv{opacity:1!important;transform:none!important}`}</style>
      </noscript>
    </>
  );
}
