"use client";

// PLANS & UPGRADE — the client half of /dashboard/upgrade. See the page for
// what this surface is; see upgrade.css for why the styling is a plain,
// self-scoped stylesheet.
//
// 2026-09-02 REWORK (owner's calls):
//   · A plan change is made IN PLACE on the existing Stripe subscription
//     (actions/billing.changePlan → lib/planChangeRoute): up by tier or term
//     charges the difference now with the unused days credited (a tier up on
//     the same term went through Stripe's page with no credit from 2026-09-02
//     to 2026-10-26), down is free, year → month waits for the paid year's
//     end. Stripe's page only when there is no subscription yet, or for a
//     Custom plan's several lines moving up.
//   · Cards are one row's height (a subgrid since 2026-10-12: prices and
//     first rows on one line); every benefit is listed, nothing scrolls or
//     folds inside a card, and the button sits at the foot of every card,
//     full width, blueprint blue.
//   · MONTHLY | ANNUAL (owner, 2026-10-12): one switch over the row
//     (components/billing/PlanTermSwitch). A plan with no yearly price is
//     shown and bought monthly whatever the switch says (lib/planDeal).
//   · Only the clicked button goes busy. `disabled={Boolean(busy)}` used to
//     dim all three the moment one was pressed.
//   · A downgrade asks first ("Are you sure…?").
//   · After a change the router is refreshed, so the sidebar's locks and
//     quota pills redraw without a manual reload — including on the return
//     leg from Stripe, where the page is reached with ?session_id.
//   · CUSTOM PLAN: an org already on it can ADD PAGES here. The page is
//     charged once now ($10 each), the subscription price steps up, and the
//     next cycle bills the new total — no second charge for the base.

import { FreeSwitchNotice } from "@/components/billing/FreeSwitch";
import type { PlanLimits } from "@/lib/planLimits";
import { PlanConfetti } from "@/components/billing/PlanConfetti";
import { annualDeal, dealDollars, offersYearly, planTerm, sharedDealWords, type BillingTerm } from "@/lib/planDeal";
import { PlanCardHead, PlanDealSlot, PlanPrice, PlanTermSwitch } from "@/components/billing/PlanTermSwitch";
import { DEV_EVENT, type DevUpgradeEvent } from "@/lib/devSimulation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { expandPlanFeatures } from "@/lib/planCatalog";
import { SPOTLIGHT, SPOTLIGHT_MISSING, SPOTLIGHT_TAG, planCardRows, spotlightBanner, spotlightInPlan, type SpotlightTool } from "@/lib/planSpotlight";
import { changePlan, previewPlanChange, updateCustomPages, type PlanChangePreviewResult } from "@/actions/billing";
import { CardDeclinedNote, PlanChangeMoney, ScheduledSwitchNote, longDay, money } from "@/components/billing/PlanChangeNotes";
import { CustomChangeNote } from "./custom-change-note";
import { ConfirmPlanChange } from "@/components/billing/ConfirmPlanChange";
import { DeckAddonPickBox } from "@/components/v3/deck-addon/deck-addon-pick";
import { getDeckAddonPick } from "@/actions/deckAddon";
import type { DeckAddonPick } from "@/lib/deckAddon";
import { toast } from "@/components/ui/Toast";
import {
  CUSTOM_BASE_CENTS,
  CUSTOM_PAGES,
  CUSTOM_PAGE_CENTS,
  CUSTOM_PLAN_SLUG,
  customPriceCents,
} from "@/lib/customPlan";
import "./upgrade.css";

export type UpgradePlan = {
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  yearlyPriceCents: number | null;
  trialDays: number;
  features: string[];
  /** The plan's caps (lib/planLimits). The cards print no cap before a row (owner, 2026-11-04) — the tool alone. */
  limits: PlanLimits;
  highlight: boolean;
};

/** A card's feature list (owner, 2026-11-09): every row in view on every surface — no fold, no "View all features".
 *  The list is a subgrid of the row's feature tracks (upgrade.css), so row N stands at one height in every card and a
 *  line that wraps in one card makes that row taller in all of them. */
function PlanFeatures({ children }: { children: React.ReactNode }) {
  return <span className="jf-up-feats" data-plan-feats>{children}</span>;
}

/** Whole dollars when round, cents otherwise — a prorated charge rarely is. */
function dollarsOf(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

export function UpgradeContent({
  spotlight = null,
  plans,
  currentPlan,
  customPages,
  isOwner,
  checkoutReady,
  sandbox,
  upgradedTo,
  upgradedDirection = "up",
  cancelled,
  embedded = false,
  compactFeatures = false,
  devTools,
  customOffered = false,
  focusSlug = null,
  focusWords = null,
  currentInterval = null,
  scheduledSwitch = null,
  freeSwitch = null,
}: {
  /** The switch to Free is booked (lib/freePlan): the date and "Keep <plan>". */
  freeSwitch?: { at: string | null; planName: string } | null;
  /** The term the live subscription bills on (lib/trialPlan priceInterval); null when unknown or none. */
  currentInterval?: "MONTH" | "YEAR" | null;
  /** A booked YEAR → MONTH switch (lib/planChange), drawn with its undo. */
  scheduledSwitch?: { at: string; planName: string; interval: "MONTH" | "YEAR" } | null;
  /** THE PLAN TO POINT AT (2026-10-11, lib/editions): the one that carries the edition an existing customer came to add (?edition=deck), and the line that says so. */
  focusSlug?: string | null;
  focusWords?: string | null;
  /** THE TOOL THE SIGNUP CAME FOR (lib/planSpotlight, owner 2026-10-14): its
   *  feature line is pinned first and marked on every card; a card that lacks
   *  it says so. */
  spotlight?: SpotlightTool | null;
  /** CUSTOM_PLAN_ENABLED (lib/customPlanFlag): off, a shop not already on the
   *  custom plan is not offered it. One on it always manages its pages. */
  customOffered?: boolean;
  plans: UpgradePlan[];
  /** Subscription.plan as stored ("PROFESSIONAL", "CUSTOM", …), or null. */
  currentPlan: string | null;
  /** Pages a CUSTOM-plan org owns (ids from lib/customPlan), else []. */
  customPages: string[];
  isOwner: boolean;
  checkoutReady: boolean;
  /** The admin's payments switch is on the sandbox — say so on the page, so a
   *  test charge is never mistaken for a real one. */
  sandbox: boolean;
  /** Slug just purchased on this request's ?session_id return, if any. */
  upgradedTo: string | null;
  /** Which way that return went; a downgrade gets the banner, not the confetti. */
  upgradedDirection?: "up" | "down";
  cancelled: boolean;
  /** Rendered inside another page (the subscription page's plan section):
   *  no page head, no return-leg banners — just the cards and their dialogs. */
  embedded?: boolean;
  /** Subscription overview: the quieter variant (no "Build your plan" note under the row). Every list is open. */
  compactFeatures?: boolean;
  /** TEMP (2026-09-19): the DEV ONLY block, handed in by the page behind the
   *  server gate; undefined everywhere else. */
  devTools?: React.ReactNode;
}) {
  const router = useRouter();
  // False on the server render and the hydration pass, true after: the portal
  // below must not exist on the first client render or React reports a
  // hydration mismatch on ?custom=1 (agent's finding, 2026-09-02).
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  /* MONTHLY ONLY for now (owner, 2026-09-04): the yearly tier is unreviewed,
     so the billing switch is gone from every plan surface. The type is kept
     wide so the price math below stays ready for the day it comes back. */
  /* ANNUAL IS BACK (owner, 2026-10-11), as one switch over the row (2026-10-12): "2 months free" in words,
     never a percentage (lib/planDeal). Monthly until it is flipped. */
  const [interval, setInterval] = useState<BillingTerm>(currentInterval ?? "MONTH");
  /** The term a card is billed on: the switch's, or the month for a plan with no yearly price. */
  const termFor = useCallback(
    (slug: string): BillingTerm =>
      slug === CUSTOM_PLAN_SLUG ? interval : planTerm(interval, plans.find((p) => p.slug === slug)?.yearlyPriceCents),
    [interval, plans],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** "Card declined — update your card" after a change the card did not pay for. */
  const [declined, setDeclined] = useState<string | null>(null);
  // The current plan as the page knows it; moved locally after an in-place
  // switch so the labels flip before the refresh lands.
  // Overrides win until the refreshed props catch up (they then agree).
  const [curOverride, setCur] = useState<string | null>(null);
  const cur = curOverride ?? (currentPlan ?? "").toLowerCase();
  const [ownedOverride, setOwned] = useState<string[] | null>(null);
  const owned = ownedOverride ?? customPages;

  /* "ADD DECK STUDIO" (owner, 2026-10-26): one box over the cards, off until ticked; ticked, the plan picked goes on
     with the add-on (lib/planChange) or to Stripe with it on the order. Read for the owner only — billing is theirs. */
  const [deckPick, setDeckPick] = useState<DeckAddonPick | null>(null);
  const [withDeck, setWithDeck] = useState(false);
  useEffect(() => {
    if (!isOwner || !checkoutReady) return;
    let live = true;
    void getDeckAddonPick()
      .then((res) => {
        if (live && res.ok) setDeckPick(res.pick);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isOwner, checkoutReady, upgradedTo]);
  /** The box is ticked and means something on this term (held on it already, or included: nothing to add). */
  const deckFor = useCallback(
    (term: BillingTerm) => withDeck && !!deckPick && !deckPick.included && !(deckPick.held && deckPick.held.interval === term),
    [withDeck, deckPick],
  );

  /* THE RETURN FROM STRIPE (and the dev simulator's ?simulated= twin). The
     layout that draws the sidebar rendered BEFORE verifyReturn wrote the new
     plan, so locks and quota pills were stale until a manual reload: refresh
     at once, and drop the query so a reload cannot re-verify. The banner and
     the confetti key off state derived from the prop DURING RENDER, not a
     useState initialiser — the simulator's router.push lands on this same
     mounted component with a new prop, and an initialiser would never see it
     (the old stamp never played for that reason). */
  const [seenReturn, setSeenReturn] = useState<string | null>(null);
  const [done, setDone] = useState<{ slug: string; dir: "up" | "down"; key: number } | null>(null);
  if (upgradedTo !== seenReturn) {
    setSeenReturn(upgradedTo);
    if (upgradedTo) {
      const slug = upgradedTo;
      setDone((prev) => ({ slug, dir: upgradedDirection, key: (prev?.key ?? 0) + 1 }));
    }
  }
  useEffect(() => {
    if (!upgradedTo) return;
    router.replace("/dashboard/upgrade");
    router.refresh();
  }, [upgradedTo, router]);
  const doneName = done
    ? done.slug === CUSTOM_PLAN_SLUG
      ? "Custom plan"
      : (plans.find((p) => p.slug === done.slug)?.name ?? done.slug)
    : null;

  // The feature comparison, with "Everything in <plan>" expanded so a dearer
  // plan never reads as missing the cheaper plan's basics — the same rule the
  // signup step applies (lib/planCatalog.expandPlanFeatures).
  const expanded = useMemo(() => expandPlanFeatures(plans), [plans]);
  // The spotlighted tool's row is always drawn and pinned, marked by its gate — the public cards' rule
  // (lib/planSpotlight planCardRows, owner 2026-11-07) — but nothing is hidden here: a signed-up company sees every row.
  const featureCard = useMemo(() => planCardRows(expanded.rows, spotlight, false), [expanded.rows, spotlight]);
  const spotRow = featureCard.spot;
  const featureRows = featureCard.rows;
  const included = expanded.included;


  /* The row's feature tracks: as many as the longest list — the plans' shared rows, or the Custom card's base line and
     its pages (only the held ones on the plan, or "No add-on pages yet"). */
  const customOnShow = cur === CUSTOM_PLAN_SLUG || customOffered;
  const featTracks = Math.max(
    featureRows.length,
    customOnShow ? 1 + (cur === CUSTOM_PLAN_SLUG ? Math.max(1, CUSTOM_PAGES.filter((pg) => owned.includes(pg.id)).length) : CUSTOM_PAGES.length) : 0,
    1,
  );

  const curCents = useMemo(() => {
    if (cur === CUSTOM_PLAN_SLUG) return customPriceCents(owned);
    return plans.find((p) => p.slug === cur)?.priceCents ?? -1;
  }, [cur, owned, plans]);
  /* UP OR DOWN — by tier, not by price (owner, 2026-09-04). The catalog's
     own order is the ladder (Starter < Professional < Enterprise, as
     /admin/plans sorts them) and the Custom plan is the rung below Starter
     whatever its page count adds up to. So from Custom every catalog plan is
     an upgrade, and from any catalog plan Custom is a downgrade. No plan at
     all ranks below everything. */
  // The Free plan (lib/freePlan) is "no plan" here: every card is an upgrade.
  const rankOf = (slug: string): number =>
    slug === CUSTOM_PLAN_SLUG ? -1 : slug && slug !== "free" ? plans.findIndex((p) => p.slug === slug) : -2;
  const direction = (p: UpgradePlan): "up" | "down" => (rankOf(p.slug) > rankOf(cur) ? "up" : "down");

  /* What is being asked. "up" and "custom" go to Stripe to be paid for (the
     owner's rule: an upgrade is confirmed, then paid on Stripe's page, and it
     replaces the current subscription on the return); "down" is switched in
     place, free. */
  const [confirm, setConfirm] = useState<
    | { kind: "up"; plan: UpgradePlan; from?: UpgradePlan }
    | { kind: "down"; plan: UpgradePlan; from?: UpgradePlan }
    | { kind: "custom"; pages: string[] }
    | { kind: "pages"; pages: string[]; removing: string[]; adding: string[] }
    | { kind: "change"; plan: UpgradePlan; preview: Extract<PlanChangePreviewResult, { ok: true }> }
    | null
  >(null);

  const checkout = useCallback(
    async (slug: string, customPagesToBuy?: string[]) => {
      const res = await fetch("/api/checkout/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSlug: slug, interval: termFor(slug), customPages: customPagesToBuy, deckAddon: deckFor(termFor(slug)) }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ?? "Couldn't open checkout.");
      window.location.assign(body.url);
    },
    [termFor, deckFor],
  );

  /* An upgrade (or a custom plan) is PAID on Stripe: confirm, then checkout.
     The return leg cancels the subscription it replaces. */
  const payFor = useCallback(
    async (slug: string, pages?: string[]) => {
      if (busy) return;
      setErr(null);
      setBusy(slug);
      try {
        await checkout(slug, pages); // navigates away on success
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't open checkout.");
        setBusy(null);
        setConfirm(null);
      }
    },
    [busy, checkout],
  );

  /* A CHANGE ON THE SUBSCRIPTION THE SHOP HAS (lib/planChange, owner
     2026-10-12): the dialog showed Stripe's preview; the change is made on
     the same proration, and the toast says what was really charged — never
     "Nothing was charged" after a charge. A declined card changes nothing
     and leaves the way to a new card on the page. */
  const applyChange = useCallback(
    async (p: UpgradePlan, preview: Extract<PlanChangePreviewResult, { ok: true }>) => {
      if (busy) return;
      setErr(null);
      setDeclined(null);
      setBusy(p.slug);
      try {
        const res = await changePlan(p.slug, preview.interval, preview.prorationDate, preview.addon !== null);
        if (!res.ok) {
          if (res.code === "card_declined" || res.code === "past_due") setDeclined(res.error);
          else setErr(res.error);
          return;
        }
        if (res.mode === "checkout") {
          await checkout(p.slug);
          return; // navigating away
        }
        if (res.mode === "scheduled") {
          toast.success("Switch booked", `Switches to ${res.interval === "MONTH" ? "monthly" : "annual"} on ${longDay(res.switchAt)}. Nothing was charged.`);
        } else {
          setCur(p.slug);
          toast.success(
            `Moved to ${res.planName}`,
            res.chargedCents > 0
              ? `${money(res.chargedCents)} charged today.`
              : res.route === "trial"
                ? "Nothing was charged. Your trial runs on."
                : "Nothing was charged.",
          );
          if (res.addonError) toast.error("Deck Studio wasn't added", res.addonError);
        }
        if (preview.addon) setWithDeck(false);
        // The layout re-renders with the new plan's locks and quota pills.
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't change the plan.");
      } finally {
        setBusy(null);
        setConfirm(null);
      }
    },
    [busy, checkout, router],
  );

  /* A card asks first what the change would do — Stripe's preview: an
     upgrade on the same term by tier, or a shop with no live subscription,
     goes to Stripe's page; everything else is confirmed with the money
     Stripe quoted (lib/planChange). */
  async function onPick(p: UpgradePlan) {
    if (busy) return;
    setErr(null);
    setDeclined(null);
    setBusy(p.slug);
    try {
      const preview = await previewPlanChange(p.slug, termFor(p.slug), deckFor(termFor(p.slug)));
      if (!preview.ok) {
        if (preview.code === "past_due") setDeclined(preview.error);
        else setErr(preview.error);
        return;
      }
      if (preview.route === "checkout") setConfirm({ kind: "up", plan: p });
      else setConfirm({ kind: "change", plan: p, preview });
    } catch {
      setErr("Couldn't price the change. Try again.");
    } finally {
      setBusy(null);
    }
  }

  /* The "Now" tile: the plan the shop is on, at the term it pays. */
  const curPlan = plans.find((p) => p.slug === cur);
  const curTile = curPlan
    ? currentInterval === "YEAR"
      ? { ...curPlan, priceCents: curPlan.yearlyPriceCents ?? curPlan.priceCents }
      : curPlan
    : cur === CUSTOM_PLAN_SLUG
      ? { slug: cur, name: "Custom plan", priceCents: customPriceCents(owned, currentInterval === "YEAR" ? "YEAR" : "MONTH"), features: [] as string[] }
      : null;
  const changeTitle = (p: UpgradePlan, v: Extract<PlanChangePreviewResult, { ok: true }>) =>
    p.slug === cur
      ? `Switch ${p.name} to ${v.interval === "YEAR" ? "annual" : "monthly"}?`
      : v.fromInterval && v.fromInterval !== v.interval
        ? `Switch to ${p.name} ${v.interval === "YEAR" ? "annual" : "monthly"}?`
        : direction(p) === "down"
          ? `Downgrade to ${p.name}?`
          : `Switch to ${p.name}?`;
  const changeLabel = (p: UpgradePlan, v: Extract<PlanChangePreviewResult, { ok: true }>) =>
    v.route === "charge" || (v.addon && (v.dueNowCents ?? 0) > 0)
      ? `Pay ${money(v.dueNowCents ?? 0)} and switch`
      : v.route === "schedule"
        ? `Switch on ${longDay(v.switchAt)}`
        : direction(p) === "down" && p.slug !== cur
          ? `Downgrade to ${p.name}`
          : `Switch to ${p.name}`;

  /* ── CUSTOM PLAN ─────────────────────────────────────────────────────
     On it already: add pages (paid once now, price steps up). Not on it:
     build one — pick pages, confirm, pay on Stripe like any other plan. */
  const onCustom = cur === CUSTOM_PLAN_SLUG;
  const searchParams = useSearchParams();
  // /dashboard/upgrade?custom=1 (the subscription page's "Build it") lands
  // straight in the page picker.
  const [pickerOpen, setPickerOpen] = useState(
    () => searchParams?.get("custom") === "1" && (onCustom || customOffered),
  );
  // The same two-flag entrance as the signup step's picker: mounted first,
  // `is-on` a frame later so the box has a start state to leave from.
  const [pickerOn, setPickerOn] = useState(false);
  useEffect(() => {
    if (!pickerOpen) return;
    const id = requestAnimationFrame(() => setPickerOn(true));
    return () => cancelAnimationFrame(id);
  }, [pickerOpen]);
  const closePicker = useCallback(() => {
    setPickerOn(false);
    window.setTimeout(() => setPickerOpen(false), 220);
  }, []);
  /* The picker is the whole selection (owner, 2026-09-04: "add or remove").
     On the plan it opens with the owned pages ticked; what is ticked when
     the user is done is the plan they want. Ticking a new page is PAID —
     the new selection replaces the subscription on Stripe's page, like any
     upgrade. Un-ticking only is free: the pages close now and the price
     steps down from the next bill (actions/billing.removeCustomPages). */
  const [picked, setPicked] = useState<string[]>([]);
  const openPicker = useCallback(() => {
    setPicked(onCustom ? owned : []);
    setPickerOpen(true);
  }, [onCustom, owned]);
  const adds = picked.filter((id) => !owned.includes(id));
  const removes = onCustom ? owned.filter((id) => !picked.includes(id)) : [];
  /* What a Custom plan the shop is ON comes to after the change, on the term it
     is billed on — a yearly custom plan is priced by the year (2026-10-12). */
  const ownTerm: BillingTerm = currentInterval === "YEAR" ? "YEAR" : "MONTH";
  const nextOwnCents = customPriceCents(picked, ownTerm);
  const ownPer = ownTerm === "YEAR" ? "per year" : "per month";
  /* What a new Custom plan costs on the switch's term (an existing one is
     managed page by page, monthly, below). */
  const pickedTermCents = customPriceCents(picked, interval);
  const termPer = interval === "YEAR" ? "/yr" : "/mo";
  /* The switch: drawn when a card has a year to show; its "N months free"
     tag only when every yearly card gives the same whole months. */
  const showTerms = offersYearly(plans) || onCustom || customOffered;
  const termTag = sharedDealWords([
    ...plans.filter((p) => p.yearlyPriceCents).map((p) => annualDeal(p.priceCents, p.yearlyPriceCents)),
    ...(onCustom || customOffered ? [annualDeal(customPriceCents(onCustom ? owned : picked), customPriceCents(onCustom ? owned : picked, "YEAR"))] : []),
  ]);
  /* A change to the pages of a Custom plan — added, removed or both — is made
     on the subscription the shop already has (actions/billing.updateCustomPages,
     lib/customBilling): added pages are charged now, prorated (nothing in a
     trial); removed pages close now and the price drops from the next bill. */
  async function changePages(pages: string[]) {
    if (busy) return;
    setErr(null);
    setBusy("custom-remove");
    try {
      const res = await updateCustomPages(pages);
      if (!res.ok) throw new Error(res.error);
      setOwned(res.pages);
      setConfirm(null);
      const what = [
        res.added.length ? `${res.added.length} page${res.added.length === 1 ? "" : "s"} added` : "",
        res.removed.length ? `${res.removed.length} removed` : "",
      ]
        .filter(Boolean)
        .join(", ");
      toast.success(
        what || "Plan updated",
        res.chargedCents > 0
          ? `${dollarsOf(res.chargedCents)} charged today. Your plan is ${dollarsOf(res.termCents)}${res.interval === "YEAR" ? "/yr" : "/mo"} from the next bill.`
          : `Nothing was charged. Your plan is ${dollarsOf(res.termCents)}${res.interval === "YEAR" ? "/yr" : "/mo"} from the next bill.`,
      );
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't change the pages.");
      setConfirm(null);
    } finally {
      setBusy(null);
    }
  }

  const cannot = !isOwner
    ? "Only the account owner can change the plan"
    : !checkoutReady
      ? "Checkout is not configured"
      : null;

  /* TEMP (2026-09-19): the DEV ONLY block's "Preview dialog" — one rung up
     or down from here, without changing anything; at the top (or bottom) of
     the ladder the pair is taken from one rung below (above) so the dialog
     never shows a $0 move. Heard only when the page handed us devTools. */
  useEffect(() => {
    if (!devTools) return;
    const onDev = (e: Event) => {
      const d = (e as CustomEvent<DevUpgradeEvent>).detail;
      if (d?.type !== "preview-dialog") return;
      const at = plans.findIndex((p) => p.slug === cur);
      if (d.direction === "up") {
        const to = plans[at + 1] ?? plans[plans.length - 1];
        const from = plans[at + 1] ? undefined : plans[plans.length - 2];
        if (to) setConfirm({ kind: "up", plan: to, from });
      } else {
        const to = at > 0 ? plans[at - 1] : plans[0];
        const from = at > 0 ? undefined : plans[1];
        if (to) setConfirm({ kind: "down", plan: to, from });
      }
    };
    window.addEventListener(DEV_EVENT, onDev);
    return () => window.removeEventListener(DEV_EVENT, onDev);
  }, [devTools, plans, cur]);

  return (
    <div className={"jf-upgrade" + (embedded ? " jf-up-embed" : "") + (compactFeatures ? " jf-up-compact" : "")}>
      <div className={"jf-up-head" + (embedded ? " jf-up-head--embed" : "")}>
        {embedded ? (
          <div className="jf-up-embed-lbl">Plans</div>
        ) : (
        <div>
          <div className="jf-up-kick">Billing · plans</div>
          <h1 className="jf-up-h1">Plans &amp; upgrade.</h1>
          {cur ? (
            <p className="jf-up-cur">
              You&apos;re on{" "}
              <b>
                {onCustom
                  ? `the Custom plan · $${(curCents / 100).toFixed(0)}/mo`
                  : (plans.find((p) => p.slug === cur)?.name ?? currentPlan)}
              </b>
              {onCustom
                ? " — add a page below, or switch to a full plan to open everything."
                : "."}
            </p>
          ) : null}
        </div>
        )}
      </div>

      {devTools && !embedded ? devTools : null}
      {sandbox ? (
        <div className="jf-up-sand" role="status">
          Sandbox mode — payments here are Stripe TEST charges. Card 4242 4242 4242 4242 works.
        </div>
      ) : null}
      {done && !embedded ? (
        <div className="jf-up-ok" role="status">
          <span className="jf-up-ok-k">{done.dir === "down" ? "Plan changed" : "Plan activated"}</span>
          <b>{doneName}</b>
        </div>
      ) : null}
      {/* The one moment the plan actually turns on: confetti from both side
          edges, blocking nothing. A downgrade gets the banner only. */}
      {!embedded ? (
        <PlanConfetti
          active={done?.dir === "up"}
          token={done?.key ?? 0}
          once={!devTools}
          devReplay={Boolean(devTools)}
        />
      ) : null}
      {cancelled && !embedded ? (
        <div className="jf-up-err" role="alert">
          Checkout was cancelled — nothing changed.
        </div>
      ) : null}
      {err ? (
        <div className="jf-up-err" role="alert">
          {err}
        </div>
      ) : null}

      {declined ? <CardDeclinedNote message={declined} /> : null}
      {freeSwitch && !embedded ? (
        <FreeSwitchNotice className="jf-up-free" planName={freeSwitch.planName} at={freeSwitch.at} canKeep={isOwner} />
      ) : null}
      {scheduledSwitch ? (
        <ScheduledSwitchNote at={scheduledSwitch.at} planName={scheduledSwitch.planName} interval={scheduledSwitch.interval} />
      ) : null}
      {focusWords ? <p className="jf-up-focus" data-upgrade-focus-words>{focusWords}</p> : null}
      {/* The switch and "Add Deck Studio" share one line over the cards (2026-11-09), so the head and four full
          cards fit a 1440×900 window; on a narrow desk the box wraps under the switch. */}
      {showTerms || (isOwner && checkoutReady) ? (
        <div className="jf-up-ctl">
          {showTerms ? (
            <PlanTermSwitch className="jf-up-termsw" value={interval} onChange={setInterval} tag={termTag} />
          ) : null}
          {isOwner && checkoutReady ? (
            <DeckAddonPickBox className="jf-up-deckpick" checked={withDeck} onChange={setWithDeck} pick={deckPick} interval={interval} disabled={busy !== null} />
          ) : null}
        </div>
      ) : null}
      {spotlight ? (
        <p className="jf-up-spot" data-plan-spotlight={spotlight} data-plan-spotlight-row={spotRow ?? ""}>
          <span className="jf-up-spot-k">{SPOTLIGHT[spotlight].label}</span>
          {spotlightBanner(spotlight, plans)}
        </p>
      ) : null}
      {/* One track per feature row (upgrade.css): the deepest list sets the count, every card spans it. */}
      <div className="jf-up-plans has-custom" style={{ "--up-rows": featTracks, "--up-span": featTracks + 4 } as React.CSSProperties}>
        {plans.map((p) => {
          const term = planTerm(interval, p.yearlyPriceCents);
          const isCur = cur === p.slug && (!currentInterval || currentInterval === term);
          // The plan the shop is on, on the other term: "Switch to annual / monthly".
          const otherTerm = cur === p.slug && !isCur;
          const dir = direction(p);
          return (
            <div
              key={p.slug}
              className={"jf-up-plan" + (p.highlight ? " hero" : "") + (isCur ? " cur" : "") + (focusSlug === p.slug ? " focus" : "")}
              data-upgrade-focus={focusSlug === p.slug ? "" : undefined}
              data-plan-card={p.slug}
              data-monthly-cents={p.priceCents}
              data-yearly-cents={p.yearlyPriceCents ?? undefined}
            >
              {focusSlug === p.slug ? <span className="jf-up-tag">Includes Deck Studio</span> : p.highlight ? <span className="jf-up-tag">Most picked</span> : null}
              <PlanCardHead
                term={interval}
                monthlyCents={p.priceCents}
                yearlyCents={p.yearlyPriceCents}
                name={<span className="jf-up-n">{p.name}</span>}
              />
              <PlanPrice term={interval} monthlyCents={p.priceCents} yearlyCents={p.yearlyPriceCents} figureClassName="jf-up-price" />
              <PlanDealSlot term={interval} monthlyCents={p.priceCents} yearlyCents={p.yearlyPriceCents} />
              <PlanFeatures>
                {featureRows.map((f) => {
                  const lit = spotRow !== null && f === spotRow;
                  // The tool the visitor came for is in the plan when its gate says so, whatever the line reads (lib/planSpotlight).
                  const has = lit && spotlight ? spotlightInPlan(spotlight, p) : (included.get(p.slug)?.has(f.toLowerCase()) ?? false);
                  return (
                    <span key={f} className={"jf-up-f" + (has ? "" : " no") + (lit ? " spot" : "")} data-plan-spot-row={lit ? (has ? "in" : "out") : undefined}>
                      <svg viewBox="0 0 24 24" className="jf-up-fic" aria-hidden="true">
                        {has ? <path d="M20 6 9 17l-5-5" /> : <path d="M5 12h14" />}
                      </svg>
                      {/* The name and its tag (upgrade.css, .jf-up-ft): the tag drops
                          under the name when the line cannot hold both, and the name
                          never breaks inside a word. */}
                      <span className="jf-up-ft">
                        <span className="jf-up-fn">{f}</span>
                        {lit ? <span className="jf-up-spot-tag">{has ? SPOTLIGHT_TAG : SPOTLIGHT_MISSING}</span> : null}
                      </span>
                    </span>
                  );
                })}
              </PlanFeatures>
              {isCur ? (
                <span className="jf-up-curlbl">Current plan</span>
              ) : (
                <button
                  className={"jf-up-go" + (dir === "down" && !otherTerm ? " down" : "")}
                  type="button"
                  disabled={Boolean(cannot) || busy !== null}
                  aria-busy={busy === p.slug}
                  title={cannot ?? undefined}
                  onClick={() => void onPick(p)}
                >
                  {busy === p.slug
                    ? "Working…"
                    : otherTerm
                      ? term === "YEAR"
                        ? "Switch to annual"
                        : "Switch to monthly"
                      : dir === "down" && cur
                        ? "Downgrade"
                        : "Upgrade"}
                </button>
              )}
            </div>
          );
        })}

        {onCustom || customOffered ? (
          <div
            className={"jf-up-plan custom" + (onCustom ? " cur" : "")}
            data-plan-card={CUSTOM_PLAN_SLUG}
            data-monthly-cents={onCustom ? curCents : customPriceCents(picked)}
            data-yearly-cents={customPriceCents(onCustom ? owned : picked, "YEAR")}
          >
            <PlanCardHead
              term={interval}
              monthlyCents={customPriceCents(onCustom ? owned : picked)}
              yearlyCents={customPriceCents(onCustom ? owned : picked, "YEAR")}
              name={<span className="jf-up-n">{onCustom ? "Custom" : "Build your plan"}</span>}
            />
            <PlanPrice
              term={interval}
              monthlyCents={customPriceCents(onCustom ? owned : picked)}
              yearlyCents={customPriceCents(onCustom ? owned : picked, "YEAR")}
              figureClassName="jf-up-price"
            />
            <PlanDealSlot
              term={interval}
              monthlyCents={customPriceCents(onCustom ? owned : picked)}
              yearlyCents={customPriceCents(onCustom ? owned : picked, "YEAR")}
            />
            {/* ON THE PLAN: only the pages it holds — nothing when it holds
                none (owner, 2026-09-04). OFF it: every page, ticked as picked.
                The base and the page price head the list. */}
            <PlanFeatures>
              <span className="jf-up-f jf-up-f--base">
                ${(CUSTOM_BASE_CENTS / 100).toFixed(0)} base · ${(CUSTOM_PAGE_CENTS / 100).toFixed(0)} per page a month
              </span>
              {onCustom
                ? CUSTOM_PAGES.filter((pg) => owned.includes(pg.id)).map((pg) => (
                    <span key={pg.id} className="jf-up-f">
                      <svg viewBox="0 0 24 24" className="jf-up-fic" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      {pg.label}
                    </span>
                  ))
                : CUSTOM_PAGES.map((pg) => {
                    const has = picked.includes(pg.id);
                    return (
                      <span key={pg.id} className={"jf-up-f" + (has ? "" : " no")}>
                        <svg viewBox="0 0 24 24" className="jf-up-fic" aria-hidden="true">
                          {has ? <path d="M20 6 9 17l-5-5" /> : <path d="M12 5v14M5 12h14" />}
                        </svg>
                        {pg.label}
                      </span>
                    );
                  })}
              {onCustom && owned.length === 0 ? (
                <span className="jf-up-f no jf-up-f--none">No add-on pages yet</span>
              ) : null}
            </PlanFeatures>
            <button
              className="jf-up-go"
              type="button"
              disabled={Boolean(cannot) || busy !== null}
              title={cannot ?? undefined}
              onClick={openPicker}
            >
              {onCustom
                ? "Add or remove pages"
                : busy === CUSTOM_PLAN_SLUG
                  ? "Opening Stripe…"
                  : "Choose pages"}
            </button>
          </div>
        ) : null}
      </div>

      {!isOwner ? (
        <p className="jf-up-note">Plan changes are owner-only — ask the account owner.</p>
      ) : null}
      {!compactFeatures && !onCustom && customOffered ? (
        <p className="jf-up-note">
          Build your plan: ${(CUSTOM_BASE_CENTS / 100).toFixed(0)} base covers proposals, clients,
          projects, jobs, invoices and financials; each extra page is $
          {(CUSTOM_PAGE_CENTS / 100).toFixed(0)}/mo.
        </p>
      ) : null}

      <ConfirmPlanChange
        open={confirm !== null}
        compare={
          confirm?.kind === "change"
            ? {
                plans,
                from: curTile,
                fromPer: currentInterval === "YEAR" ? "/yr" : "/mo",
                to:
                  confirm.preview.interval === "YEAR"
                    ? { ...confirm.plan, priceCents: confirm.plan.yearlyPriceCents ?? confirm.plan.priceCents }
                    : confirm.plan,
                toPer: confirm.preview.interval === "YEAR" ? "/yr" : "/mo",
                direction: direction(confirm.plan) === "up" ? "up" : "down",
                how: "switch",
                payLine: <PlanChangeMoney preview={confirm.preview} />,
              }
            : confirm && (confirm.kind === "up" || confirm.kind === "down")
            ? {
                plans,
                from:
                  confirm.from ??
                  plans.find((p) => p.slug === cur) ??
                  (onCustom ? { slug: cur, name: "Custom plan", priceCents: customPriceCents(owned), features: [] } : null),
                to:
                  termFor(confirm.plan.slug) === "YEAR"
                    ? { ...confirm.plan, priceCents: confirm.plan.yearlyPriceCents ?? confirm.plan.priceCents }
                    : confirm.plan,
                toPer: termFor(confirm.plan.slug) === "YEAR" ? "/yr" : "/mo",
                direction: confirm.kind,
                how: confirm.kind === "up" ? "checkout" : "switch",
              }
            : undefined
        }
        kicker={
          confirm?.kind === "change"
            ? "Change plan"
            : confirm?.kind === "down"
            ? "Downgrade"
            : confirm?.kind === "pages"
              ? "Custom plan"
              : "Upgrade"
        }
        title={
          confirm?.kind === "change"
            ? changeTitle(confirm.plan, confirm.preview)
            : confirm?.kind === "down"
            ? `Downgrade to ${confirm.plan.name}?`
            : confirm?.kind === "up"
              ? `Upgrade to ${confirm.plan.name}?`
              : confirm?.kind === "pages"
                ? confirm.adding.length && confirm.removing.length
                  ? "Change your pages?"
                  : confirm.adding.length
                    ? `Add ${confirm.adding.length} page${confirm.adding.length === 1 ? "" : "s"}?`
                    : `Remove ${confirm.removing.length} page${confirm.removing.length === 1 ? "" : "s"}?`
                : onCustom
                  ? "Change your Custom plan?"
                  : "Switch to a Custom plan?"
        }
        body={
          confirm?.kind === "down" ? (
            <>
              You&rsquo;ll move to <b>{confirm.plan.name}</b> at{" "}
              <b>
                {termFor(confirm.plan.slug) === "YEAR"
                  ? `${dealDollars(confirm.plan.yearlyPriceCents ?? 0)}/yr`
                  : `${dealDollars(confirm.plan.priceCents)}/mo`}
              </b>{" "}
              right away. Nothing is
              charged today; pages and limits that plan does not include close as soon as you
              confirm.
            </>
          ) : confirm?.kind === "up" ? (
            <>
              You&rsquo;ll be taken to Stripe to pay{" "}
              <b>
                {termFor(confirm.plan.slug) === "YEAR"
                  ? `${dealDollars(confirm.plan.yearlyPriceCents ?? 0)}/yr`
                  : `${dealDollars(confirm.plan.priceCents)}/mo`}
              </b>{" "}
              for <b>{confirm.plan.name}</b>. Your current plan is replaced the moment the payment
              goes through.
            </>
          ) : confirm?.kind === "custom" ? (
            <>
              You&rsquo;ll be taken to Stripe to pay{" "}
              <b>
                ${(customPriceCents(confirm.pages, interval) / 100).toFixed(0)}
                {interval === "YEAR" ? "/yr" : "/mo"}
              </b>{" "}
              for the base plus {confirm.pages.length} page{confirm.pages.length === 1 ? "" : "s"}.
              {cur ? " Your current plan is replaced the moment the payment goes through." : ""}
            </>
          ) : confirm?.kind === "pages" ? (
            <CustomChangeNote pages={confirm.pages} adding={confirm.adding} removing={confirm.removing} />
          ) : null
        }
        confirmLabel={
          confirm?.kind === "change"
            ? changeLabel(confirm.plan, confirm.preview)
            : confirm?.kind === "down"
            ? `Downgrade to ${confirm.plan.name}`
            : confirm?.kind === "pages"
              ? confirm.adding.length
                ? confirm.removing.length
                  ? "Confirm change"
                  : `Add ${confirm.adding.length} page${confirm.adding.length === 1 ? "" : "s"}`
                : "Remove pages"
              : "Continue to payment"
        }
        busy={busy !== null}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === "change") void applyChange(confirm.plan, confirm.preview);
          else if (confirm.kind === "down") void onPick(confirm.plan);
          else if (confirm.kind === "up") void payFor(confirm.plan.slug);
          else if (confirm.kind === "pages") void changePages(confirm.pages);
          else void payFor(CUSTOM_PLAN_SLUG, confirm.pages);
        }}
        onCancel={() => setConfirm(null)}
      />

      {/* THE PAGE PICKER for a custom plan — the signup step's dialog, re-cut
          for "add", with the two numbers that matter: what is charged now and
          what the plan costs from the next bill. */}
      {pickerOpen && isClient ? createPortal(
        /* The scope class sits on a WRAPPER: `.jf-upgrade .jf-up-pick` needs
           an ancestor, and a root that carried both classes matched only the
           page-level flex rule — the picker laid out inline at the foot of
           <body>, invisible, and "Choose pages" read as dead (owner). */
        <div className="jf-upgrade jf-up-portal">
        <div className={"jf-up-pick" + (pickerOn ? " is-on" : "")} role="dialog" aria-modal="true" aria-label="Add pages to your plan">
          <div className="jf-up-pick-scrim" onClick={() => busy !== "custom-remove" && closePicker()} />
          <div className="jf-up-pick-box">
            <div className="jf-up-pick-head">
              <div>
                <div className="jf-up-kick">Custom plan</div>
                <h2 className="jf-up-pick-h">{onCustom ? "Your pages." : "Pick your pages."}</h2>
              </div>
              <button
                type="button"
                className="jf-up-pick-x"
                aria-label="Close"
                onClick={() => closePicker()}
              >
                ×
              </button>
            </div>
            <p className="jf-up-pick-lede">
              {onCustom
                ? `Tick what you want in the plan — $${(CUSTOM_PAGE_CENTS / 100).toFixed(0)}/mo each. Adding a page is paid on Stripe and replaces your plan; removing one is free and the lower price starts on the next bill.`
                : `$${(CUSTOM_BASE_CENTS / 100).toFixed(0)}/mo covers the everyday workspace — proposals, clients, projects, jobs, invoices. Everything below is $${(CUSTOM_PAGE_CENTS / 100).toFixed(0)}/mo each.`}
            </p>
            <div className="jf-up-pick-list">
              {CUSTOM_PAGES.map((pg) => {
                const on = picked.includes(pg.id);
                const had = owned.includes(pg.id);
                return (
                  <button
                    key={pg.id}
                    type="button"
                    className={
                      "jf-up-pick-row" +
                      (on ? " on" : "") +
                      (onCustom && had && !on ? " drop" : "") +
                      (onCustom && !had && on ? " add" : "")
                    }
                    aria-pressed={on}
                    onClick={() =>
                      setPicked((cur) =>
                        cur.includes(pg.id) ? cur.filter((x) => x !== pg.id) : [...cur, pg.id],
                      )
                    }
                  >
                    <span className="jf-up-pick-box-t" aria-hidden="true">
                      {on ? (
                        <svg viewBox="0 0 24 24">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="jf-up-pick-txt">
                      <span className="jf-up-pick-n">{pg.label}</span>
                      <span className="jf-up-pick-note">{pg.note}</span>
                    </span>
                    <span className="jf-up-pick-p">
                      {onCustom && had ? (on ? "Yours" : "Removing") : `+$${(CUSTOM_PAGE_CENTS / 100).toFixed(0)}`}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="jf-up-pick-foot">
              <span className="jf-up-pick-total">
                <b>{dealDollars(onCustom ? nextOwnCents : pickedTermCents)}</b>
                <i>
                  {onCustom
                    ? adds.length > 0
                      ? `${ownPer} · added pages prorated today`
                      : removes.length > 0
                        ? `${ownPer} from the next bill`
                        : `${ownPer} · your plan today`
                    : interval === "YEAR"
                      ? "per year · paid on Stripe"
                      : "per month · paid on Stripe"}
                </i>
              </span>
              {onCustom ? (
                <button
                  type="button"
                  className={"jf-up-go" + (adds.length === 0 && removes.length > 0 ? " down" : "")}
                  disabled={(adds.length === 0 && removes.length === 0) || busy !== null}
                  onClick={() => {
                    closePicker();
                    setConfirm({ kind: "pages", pages: picked, removing: removes, adding: adds });
                  }}
                >
                  {adds.length > 0
                    ? `Review · ${dealDollars(nextOwnCents)}${ownTerm === "YEAR" ? "/yr" : "/mo"}`
                    : removes.length > 0
                      ? `Remove ${removes.length} page${removes.length === 1 ? "" : "s"}`
                      : "No changes"}
                </button>
              ) : (
                <button
                  type="button"
                  className="jf-up-go"
                  disabled={busy !== null}
                  onClick={() => {
                    closePicker();
                    setConfirm({ kind: "custom", pages: picked });
                  }}
                >
                  {`Switch to Custom · ${dealDollars(pickedTermCents)}${termPer}`}
                </button>
              )}
            </div>
          </div>
        </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
