"use client";

// PLANS & UPGRADE · HANDHELD — the phone build of /dashboard/upgrade.
//
// Stands beside the desktop build (components/v3/upgrade-blueprint/*, which is
// untouched) and shares its whole data layer verbatim: the same catalog props
// the server page loads, the same `expandPlanFeatures` fold, the same
// /api/checkout/subscription POST and the same two server actions
// (billing.changePlan, billing.addCustomPages). Nothing here is a fixture and
// nothing here is a second endpoint — the props type is IMPORTED from the
// desktop module so the two surfaces cannot drift apart.
//
// WHAT CHANGES IS THE COMPOSITION, not the behaviour:
//   · The desktop's four side-by-side columns restack into one scrolling
//     column of full-width cards. A card is a decision, and on a phone a
//     decision gets the whole width.
//   · The feature list does not scroll inside a fixed-height card — it cannot,
//     at 390px — and since 2026-10-12 it does not fold either: every row is
//     listed, ticked or dashed in the catalog's order, as on the desk. The
//     cards are one swiped row (a subgrid: the prices and first rows stand on
//     one line, every card is the row's height).
//   · The confirmation and the page picker are BOTTOM SHEETS, hand-rolled and
//     portalled to <body>. Portalled because this page renders inside the desk
//     shell's content column on /dashboard/upgrade, which is a stacking
//     context under the shared handheld topbar — a fixed overlay declared in
//     here would slide under the bar it is supposed to cover.
//   · Every control clears the 44px touch floor and the primary action of each
//     card sits at its foot, where the thumb already is.
//
// Behaviour kept, one for one, from the desktop build: the Monthly | Annual
// switch over the cards (components/billing/PlanTermSwitch, "N months free",
// never a percentage — 2026-10-12); up = confirm then Stripe Checkout; down = confirm
// then the in-place `changePlan` (falling back to checkout when the org has no
// subscription yet); only the PRESSED button goes busy; the custom-plan picker,
// including the `?custom=1` deep link and the "add pages" variant for an org
// already on Custom; and the one-shot refresh on the ?session_id return leg so
// the sidebar's locks and quota pills redraw.

import { FreeSwitchNotice } from "@/components/billing/FreeSwitch";
import { PlanConfetti } from "@/components/billing/PlanConfetti";
import { DEV_EVENT, type DevUpgradeEvent } from "@/lib/devSimulation";
import { ConfirmPlanChange } from "@/components/billing/ConfirmPlanChange";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { expandPlanFeatures } from "@/lib/planCatalog";
import type { SpotlightTool } from "@/lib/planSpotlight";
import { changePlan, previewPlanChange, updateCustomPages, type PlanChangePreviewResult } from "@/actions/billing";
import { CardDeclinedNote, PlanChangeMoney, ScheduledSwitchNote, longDay, money } from "@/components/billing/PlanChangeNotes";
import { CustomChangeNote } from "@/components/v3/upgrade-blueprint/custom-change-note";
import { toast } from "@/components/ui/Toast";
import {
  CUSTOM_BASE_CENTS,
  CUSTOM_PAGES,
  CUSTOM_PAGE_CENTS,
  CUSTOM_PLAN_SLUG,
  customPriceCents,
} from "@/lib/customPlan";
import type { UpgradePlan } from "@/components/v3/upgrade-blueprint/upgrade-content";
import { dealDollars, offersYearly, planTerm, sharedDealWords, annualDeal, type BillingTerm } from "@/lib/planDeal";
import { PlanCardHead, PlanDealSlot, PlanPrice, PlanTermSwitch } from "@/components/billing/PlanTermSwitch";
import { DeckAddonPickBox } from "@/components/v3/deck-addon/deck-addon-pick";
import { getDeckAddonPick } from "@/actions/deckAddon";
import type { DeckAddonPick } from "@/lib/deckAddon";
import "./mobile-upgrade.css";

/** How long the sheets take to leave. Must match the transition in the CSS. */
const SHEET_EXIT_MS = 220;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const dollars = (cents: number) => `$${(cents / 100).toFixed(0)}`;

type Confirm =
  | { kind: "up"; plan: UpgradePlan; from?: UpgradePlan }
  | { kind: "down"; plan: UpgradePlan; from?: UpgradePlan }
  | { kind: "custom"; pages: string[] }
  | { kind: "pages"; pages: string[]; removing: string[]; adding: string[] }
  | { kind: "change"; plan: UpgradePlan; preview: Extract<PlanChangePreviewResult, { ok: true }> };

export type MobileUpgradeProps = {
  /** The plan an edition's upgrade points at (lib/editions), and the line that says so — drawn by the desk page. */
  focusSlug?: string | null;
  focusWords?: string | null;
  /** The tool the signup came for (lib/planSpotlight); the desk page marks it, the phone carries it along. */
  spotlight?: SpotlightTool | null;
  plans: UpgradePlan[];
  /** Subscription.plan as stored ("PROFESSIONAL", "CUSTOM", …), or null. */
  currentPlan: string | null;
  /** Pages a CUSTOM-plan org owns (ids from lib/customPlan), else []. */
  customPages: string[];
  isOwner: boolean;
  checkoutReady: boolean;
  /** The admin's payments switch is on the sandbox — say so, so a test charge
   *  is never mistaken for a real one. */
  sandbox: boolean;
  /** Slug just purchased on this request's ?session_id return, if any. */
  upgradedTo: string | null;
  /** Which way that return went; a downgrade gets the banner, not the confetti. */
  upgradedDirection?: "up" | "down";
  cancelled: boolean;
  /** Rendered inside the subscription page: no shell, no head, no return-leg
   *  banners — the cards as a swipe carousel plus their sheets. */
  embedded?: boolean;
  /** The subscription page's quieter cards (no description line on Build your plan, no note under the rail); every list is open. */
  compactFeatures?: boolean;
  /** TEMP (2026-09-19): the DEV ONLY block, handed in by the page behind the
   *  server gate; undefined everywhere else. */
  devTools?: React.ReactNode;
  /** CUSTOM_PLAN_ENABLED (lib/customPlanFlag): off, a shop not already on the
   *  custom plan is not offered it. One on it always manages its pages. */
  customOffered?: boolean;
  /** The term the live subscription bills on; null when unknown or none. */
  currentInterval?: "MONTH" | "YEAR" | null;
  /** A booked YEAR → MONTH switch (lib/planChange), drawn with its undo. */
  scheduledSwitch?: { at: string; planName: string; interval: "MONTH" | "YEAR" } | null;
  /** The switch to Free is booked (lib/freePlan): the date and "Keep <plan>". */
  freeSwitch?: { at: string | null; planName: string } | null;
};

function Tick({ on }: { on: boolean }) {
  return (
    <svg className="mu-fic" viewBox="0 0 24 24" aria-hidden="true">
      {on ? <path d="M20 6 9 17l-5-5" /> : <path d="M5 12h14" />}
    </svg>
  );
}

export function MobileUpgradeContent({
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
  currentInterval = null,
  scheduledSwitch = null,
  freeSwitch = null,
}: MobileUpgradeProps) {
  const router = useRouter();
  /* MONTHLY | ANNUAL (owner, 2026-10-12): the desk build's switch, over the
     rail. A plan with no yearly price is shown and bought monthly. */
  const [interval, setInterval] = useState<BillingTerm>(currentInterval ?? "MONTH");
  const termFor = useCallback(
    (slug: string): BillingTerm =>
      slug === CUSTOM_PLAN_SLUG ? interval : planTerm(interval, plans.find((p) => p.slug === slug)?.yearlyPriceCents),
    [interval, plans],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** "Card declined — update your card" after a change the card did not pay for. */
  const [declined, setDeclined] = useState<string | null>(null);
  /* "ADD DECK STUDIO" (owner, 2026-10-26) — the desk build's box (upgrade-content), under the switch. */
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
  const deckFor = useCallback(
    (term: BillingTerm) => withDeck && !!deckPick && !deckPick.included && !(deckPick.held && deckPick.held.interval === term),
    [withDeck, deckPick],
  );

  // The current plan as the page knows it; moved locally after an in-place
  // switch so the labels flip before the refresh lands. Overrides win until the
  // refreshed props catch up (they then agree).
  const [curOverride, setCur] = useState<string | null>(null);
  const cur = curOverride ?? (currentPlan ?? "").toLowerCase();
  const [ownedOverride, setOwned] = useState<string[] | null>(null);
  const owned = ownedOverride ?? customPages;

  const scrollRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  /* THE RETURN FROM STRIPE (and the dev simulator's ?simulated= twin). The
     layout that draws the nav rendered BEFORE verifyReturn wrote the new
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
  // plan never reads as missing the cheaper plan's basics — the same fold the
  // desktop build and the signup step apply.
  const { rows: featureRows, included } = useMemo(() => expandPlanFeatures(plans), [plans]);


  /* Up or down, by price against the current plan. A custom plan (base plus
     pages) sits below every catalog tier. */
  const curCents = useMemo(() => {
    if (cur === CUSTOM_PLAN_SLUG) return customPriceCents(owned);
    return plans.find((p) => p.slug === cur)?.priceCents ?? -1;
  }, [cur, owned, plans]);
  /* UP OR DOWN — by tier, not by price (owner, 2026-09-04): the catalog's
     own order is the ladder and Custom is the rung below Starter whatever
     its pages add up to. */
  // The Free plan (lib/freePlan) is "no plan" here: every card is an upgrade.
  const rankOf = (slug: string): number =>
    slug === CUSTOM_PLAN_SLUG ? -1 : slug && slug !== "free" ? plans.findIndex((p) => p.slug === slug) : -2;
  const direction = (p: UpgradePlan): "up" | "down" => (rankOf(p.slug) > rankOf(cur) ? "up" : "down");

  const onCustom = cur === CUSTOM_PLAN_SLUG;


  /* ── SHEETS ────────────────────────────────────────────────────────────
     Both are mounted first and given `is-on` a frame later, so the box has a
     start state to slide out of; leaving removes the class and unmounts
     SHEET_EXIT_MS later. Same two-flag entrance as the desktop picker. */
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmOn, setConfirmOn] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const id = requestAnimationFrame(() => setConfirmOn(true));
    return () => cancelAnimationFrame(id);
  }, [confirm]);
  const closeConfirm = useCallback(() => {
    setConfirmOn(false);
    window.setTimeout(() => setConfirm(null), SHEET_EXIT_MS);
  }, []);

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


  const searchParams = useSearchParams();
  // /dashboard/upgrade?custom=1 (the subscription page's "Build it", and the
  // custom-plan gate) lands straight in the page picker.
  const [pickerOpen, setPickerOpen] = useState(
    () => searchParams?.get("custom") === "1" && (onCustom || customOffered),
  );
  const [pickerOn, setPickerOn] = useState(false);
  useEffect(() => {
    if (!pickerOpen) return;
    const id = requestAnimationFrame(() => setPickerOn(true));
    return () => cancelAnimationFrame(id);
  }, [pickerOpen]);
  const closePicker = useCallback(() => {
    setPickerOn(false);
    window.setTimeout(() => setPickerOpen(false), SHEET_EXIT_MS);
  }, []);

  /* The picker is the whole selection (owner, 2026-09-04: "add or remove").
     Ticking a new page is PAID — the selection replaces the subscription on
     Stripe's page; un-ticking only is free, the price steps down from the
     next bill (actions/billing.removeCustomPages). */
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
  /* A new Custom plan on the switch's term (an existing one is managed page
     by page, monthly). */
  const pickedTermCents = customPriceCents(picked, interval);
  const termPer = interval === "YEAR" ? "/yr" : "/mo";
  const showTerms = offersYearly(plans) || onCustom || customOffered;
  const termTag = sharedDealWords([
    ...plans.filter((p) => p.yearlyPriceCents).map((p) => annualDeal(p.priceCents, p.yearlyPriceCents)),
    ...(onCustom || customOffered ? [annualDeal(customPriceCents(onCustom ? owned : picked), customPriceCents(onCustom ? owned : picked, "YEAR"))] : []),
  ]);
  const termSwitch = showTerms ? (
    <PlanTermSwitch className="mu-termsw" value={interval} onChange={setInterval} tag={termTag} />
  ) : null;
  const deckBox =
    isOwner && checkoutReady ? (
      <DeckAddonPickBox className="mu-deckpick" checked={withDeck} onChange={setWithDeck} pick={deckPick} interval={interval} disabled={busy !== null} />
    ) : null;
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
      closeConfirm();
      const what = [
        res.added.length ? `${res.added.length} page${res.added.length === 1 ? "" : "s"} added` : "",
        res.removed.length ? `${res.removed.length} removed` : "",
      ]
        .filter(Boolean)
        .join(", ");
      toast.success(
        what || "Plan updated",
        res.chargedCents > 0
          ? `${dollars(res.chargedCents)} charged today. Your plan is ${dollars(res.termCents)}${res.interval === "YEAR" ? "/yr" : "/mo"} from the next bill.`
          : `Nothing was charged. Your plan is ${dollars(res.termCents)}${res.interval === "YEAR" ? "/yr" : "/mo"} from the next bill.`,
      );
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't change the pages.");
      closeConfirm();
    } finally {
      setBusy(null);
    }
  }

  async function checkout(slug: string, customPagesToBuy?: string[]) {
    const res = await fetch("/api/checkout/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planSlug: slug, interval: termFor(slug), customPages: customPagesToBuy, deckAddon: deckFor(termFor(slug)) }),
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error ?? "Couldn't open checkout.");
    window.location.assign(body.url);
  }

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
        closeConfirm();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, termFor, closeConfirm],
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
        closeConfirm();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, router, closeConfirm],
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

  const cannot = !isOwner
    ? "Only the account owner can change the plan"
    : !checkoutReady
      ? "Checkout is not configured"
      : null;

  /* ── MOTION: reveal on mount ───────────────────────────────────────────
     Applied ONCE, to the blocks that exist then, by the component. Never via a
     MutationObserver — this tree re-renders on every toggle, and an observer
     would replay the whole entrance each time a card was opened. */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const content = contentRef.current;
    if (!content) return;
    const blocks = Array.from(content.children) as HTMLElement[];
    blocks.forEach((el, i) => {
      el.classList.add("mu-rv");
      el.style.transitionDelay = `${i * 55}ms`;
    });
    const raf = requestAnimationFrame(() => {
      blocks.forEach((el) => el.classList.add("mu-rv-in"));
    });
    const done = window.setTimeout(
      () => blocks.forEach((el) => { el.style.transitionDelay = ""; }),
      55 * blocks.length + 460,
    );
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(done);
    };
  }, []);

  /* ── MOTION: graph-paper parallax ──────────────────────────────────────── */
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

  /* ── MOTION: press stamp, delegated from the root ──────────────────────── */
  const onRootClick = useCallback((e: React.MouseEvent) => {
    if (prefersReducedMotion()) return;
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".mu-cta, .mu-row",
    );
    if (!el) return;
    el.classList.remove("mu-pressed");
    void el.offsetWidth;
    el.classList.add("mu-pressed");
  }, []);
  const onRootAnimEnd = useCallback((e: React.AnimationEvent) => {
    const el = e.target as HTMLElement;
    if (el.classList?.contains("mu-pressed")) el.classList.remove("mu-pressed");
  }, []);

  /* Escape closes whichever sheet is up — the keyboard equivalent of the
     scrim tap, and the only way off a sheet with a hardware keyboard. */
  const sheetUp = confirm !== null || pickerOpen;
  useEffect(() => {
    if (!sheetUp) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      if (confirm) closeConfirm();
      else closePicker();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetUp, busy, confirm, closeConfirm, closePicker]);

  /* ── CARD ──────────────────────────────────────────────────────────────── */

  const planCard = (p: UpgradePlan) => {
    const term = planTerm(interval, p.yearlyPriceCents);
    const isCur = cur === p.slug && (!currentInterval || currentInterval === term);
    // The plan the shop is on, on the other term: "Switch to annual / monthly".
    const otherTerm = cur === p.slug && !isCur;
    const dir = direction(p);
    const has = included.get(p.slug);

    return (
      <section
        key={p.slug}
        className={`mu-card${p.highlight ? " is-hero" : ""}${isCur ? " is-cur" : ""}`}
        aria-label={p.name}
        data-plan-card={p.slug}
        data-monthly-cents={p.priceCents}
        data-yearly-cents={p.yearlyPriceCents ?? undefined}
      >
        {/* Badges stack in a column beside the name (owner, 2026-09-04):
            side by side they squeezed "Professional" into a two-line break.
            The year's "N MONTHS FREE" stamp heads that column (PlanCardHead). */}
        <PlanCardHead
          className="mu-card-top"
          term={interval}
          monthlyCents={p.priceCents}
          yearlyCents={p.yearlyPriceCents}
          name={
            <div className="mu-card-id">
              <span className="mu-name">{p.name}</span>
              {p.description ? <span className="mu-desc">{p.description}</span> : null}
            </div>
          }
          aside={
            p.highlight || isCur ? (
              <>
                {p.highlight ? <span className="mu-tag">Most picked</span> : null}
                {isCur ? <span className="mu-tag is-cur">Current</span> : null}
              </>
            ) : null
          }
        />

        <div className="mu-price">
          <PlanPrice
            term={interval}
            monthlyCents={p.priceCents}
            yearlyCents={p.yearlyPriceCents}
            figureClassName="mu-price-row"
            figure={(num, per) => (
              <>
                <b>{num}</b>
                <i>{per}</i>
              </>
            )}
          />
          <PlanDealSlot term={interval} monthlyCents={p.priceCents} yearlyCents={p.yearlyPriceCents} />
        </div>

        <PlanFeatures>
        <ul className="mu-feats" data-plan-feats>
          {featureRows.map((f) => {
            const on = has?.has(f.toLowerCase()) ?? false;
            return (
              <li key={f} className={`mu-f${on ? "" : " is-no"}`}>
                <Tick on={on} />
                <span>
                  {f}
                </span>
              </li>
            );
          })}
        </ul>
        </PlanFeatures>

        <div className="mu-foot">
          {isCur ? (
            <span className="mu-cur-lbl">Current plan</span>
          ) : (
            <button
              type="button"
              className={`mu-cta${dir === "down" && cur && !otherTerm ? " is-ghost" : " is-primary"}`}
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
      </section>
    );
  };

  /* ── SHEET BODIES ──────────────────────────────────────────────────────── */

  const confirmTitle =
    confirm?.kind === "down"
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
            : "Switch to a Custom plan?";

  const confirmLabel =
    confirm?.kind === "down"
      ? `Downgrade to ${confirm.plan.name}`
      : confirm?.kind === "pages"
        ? confirm.adding.length
          ? confirm.removing.length
            ? "Confirm change"
            : `Add ${confirm.adding.length} page${confirm.adding.length === 1 ? "" : "s"}`
          : "Remove pages"
        : "Continue to payment";

  const confirmSheet =
    confirm && typeof document !== "undefined"
      ? createPortal(
          /* The scope class sits on a WRAPPER, never on the sheet itself: the
             root class also carries this page's fixed full-screen shell rules
             (see .mu-shell in the stylesheet), and a node holding both would
             lay the sheet out as a second copy of the page. */
          <div className="jf-mobile-upgrade mu-portal">
            <div
              className={`mu-sheet${confirmOn ? " is-on" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={confirmTitle}
            >
              <div
                className="mu-scrim"
                onClick={() => {
                  if (!busy) closeConfirm();
                }}
              />
              <div className="mu-box">
                <span className="mu-grab" aria-hidden="true" />
                <div className="mu-box-head">
                  <div className="mu-kick">
                    {confirm.kind === "down"
                      ? "Downgrade"
                      : confirm.kind === "pages"
                        ? "Custom plan"
                        : "Upgrade"}
                  </div>
                  <h2 className="mu-box-h">{confirmTitle}</h2>
                </div>
                <p className="mu-box-body">
                  {confirm.kind === "down" ? (
                    <>
                      You&rsquo;ll move to <b>{confirm.plan.name}</b> at{" "}
                      <b>
                        {termFor(confirm.plan.slug) === "YEAR"
                          ? `${dealDollars(confirm.plan.yearlyPriceCents ?? 0)}/yr`
                          : `${dealDollars(confirm.plan.priceCents)}/mo`}
                      </b>{" "}
                      right away. Nothing is charged
                      today; pages and limits that plan does not include close as soon as you
                      confirm.
                    </>
                  ) : confirm.kind === "up" ? (
                    <>
                      You&rsquo;ll be taken to Stripe to pay{" "}
                      <b>
                        {termFor(confirm.plan.slug) === "YEAR"
                          ? `${dealDollars(confirm.plan.yearlyPriceCents ?? 0)}/yr`
                          : `${dealDollars(confirm.plan.priceCents)}/mo`}
                      </b>{" "}
                      for <b>{confirm.plan.name}</b>. Your current plan is replaced the moment the
                      payment goes through.
                    </>
                  ) : confirm.kind === "pages" ? (
                    <CustomChangeNote pages={confirm.pages} adding={confirm.adding} removing={confirm.removing} />
                  ) : confirm.kind === "custom" ? (
                    <>
                      You&rsquo;ll be taken to Stripe to pay{" "}
                      <b>
                        {dollars(customPriceCents(confirm.pages, interval))}
                        {interval === "YEAR" ? "/yr" : "/mo"}
                      </b>{" "}
                      for the base plus {confirm.pages.length} page
                      {confirm.pages.length === 1 ? "" : "s"}.
                      {cur ? " Your current plan is replaced the moment the payment goes through." : ""}
                    </>
                  ) : null}
                </p>
                <div className="mu-box-foot">
                  <button
                    type="button"
                    className="mu-cta is-ghost"
                    disabled={Boolean(busy)}
                    onClick={() => closeConfirm()}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="mu-cta is-primary"
                    disabled={Boolean(busy)}
                    aria-busy={Boolean(busy)}
                    onClick={() => {
                      if (confirm.kind === "down" || confirm.kind === "change") void onPick(confirm.plan);
                      else if (confirm.kind === "up") void payFor(confirm.plan.slug);
                      else if (confirm.kind === "pages") void changePages(confirm.pages);
                      else void payFor(CUSTOM_PLAN_SLUG, confirm.pages);
                    }}
                  >
                    {busy ? "Working…" : confirmLabel}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  /* Up and down go through the one plan dialog the desktop build uses (the
     comparison is read from the catalog there); the custom-plan sheets stay. */
  const planDialog = (
    <ConfirmPlanChange
      open={confirm?.kind === "up" || confirm?.kind === "down" || confirm?.kind === "change"}
      kicker={confirm?.kind === "change" ? "Change plan" : confirm?.kind === "down" ? "Downgrade" : "Upgrade"}
      title={
        confirm?.kind === "change"
          ? changeTitle(confirm.plan, confirm.preview)
          : confirm?.kind === "down"
          ? `Downgrade to ${confirm.plan.name}?`
          : confirm?.kind === "up"
            ? `Upgrade to ${confirm.plan.name}?`
            : ""
      }
      confirmLabel={
        confirm?.kind === "change"
          ? changeLabel(confirm.plan, confirm.preview)
          : confirm?.kind === "down"
            ? `Downgrade to ${confirm.plan.name}`
            : "Continue to payment"
      }
      busy={Boolean(busy)}
      onCancel={() => closeConfirm()}
      onConfirm={() => {
        if (confirm?.kind === "change") void applyChange(confirm.plan, confirm.preview);
        else if (confirm?.kind === "down") void onPick(confirm.plan);
        else if (confirm?.kind === "up") void payFor(confirm.plan.slug);
      }}
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
    />
  );

  const pickerSheet =
    pickerOpen && typeof document !== "undefined"
      ? createPortal(
          <div className="jf-mobile-upgrade mu-portal">
            <div
              className={`mu-sheet is-tall${pickerOn ? " is-on" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={onCustom ? "Add or remove pages" : "Pick your pages"}
            >
              <div
                className="mu-scrim"
                onClick={() => {
                  if (busy !== "custom-remove") closePicker();
                }}
              />
              <div className="mu-box">
                <span className="mu-grab" aria-hidden="true" />
                <div className="mu-box-head">
                  <div className="mu-kick">Custom plan</div>
                  <h2 className="mu-box-h">{onCustom ? "Your pages." : "Pick your pages."}</h2>
                  <button
                    type="button"
                    className="mu-x"
                    aria-label="Close"
                    onClick={() => closePicker()}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="mu-box-body">
                  {onCustom
                    ? `Tick what you want in the plan — ${dollars(CUSTOM_PAGE_CENTS)}/mo each. Adding a page is paid on Stripe and replaces your plan; removing one is free and the lower price starts on the next bill.`
                    : `${dollars(CUSTOM_BASE_CENTS)}/mo covers the everyday workspace — proposals, clients, projects, jobs, invoices. Everything below is ${dollars(CUSTOM_PAGE_CENTS)}/mo each.`}
                </p>
                <div className="mu-list">
                  {CUSTOM_PAGES.map((pg) => {
                    const on = picked.includes(pg.id);
                    const had = owned.includes(pg.id);
                    return (
                      <button
                        key={pg.id}
                        type="button"
                        className={`mu-row${on ? " is-on" : ""}${onCustom && had && !on ? " is-drop" : ""}${onCustom && !had && on ? " is-add" : ""}`}
                        aria-pressed={on}
                        onClick={() =>
                          setPicked((prev) =>
                            prev.includes(pg.id)
                              ? prev.filter((x) => x !== pg.id)
                              : [...prev, pg.id],
                          )
                        }
                      >
                        <span className="mu-check" aria-hidden="true">
                          {on ? (
                            <svg viewBox="0 0 24 24">
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          ) : null}
                        </span>
                        <span className="mu-row-txt">
                          <span className="mu-row-n">{pg.label}</span>
                          <span className="mu-row-note">{pg.note}</span>
                        </span>
                        <span className="mu-row-p">
                          {onCustom && had ? (on ? "Yours" : "Removing") : `+${dollars(CUSTOM_PAGE_CENTS)}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mu-list-foot">
                  <span className="mu-total">
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
                      className={`mu-cta${adds.length === 0 && removes.length > 0 ? " is-ghost" : " is-primary"}`}
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
                      className="mu-cta is-primary"
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
        )
      : null;

  /* ── PAGE ──────────────────────────────────────────────────────────────── */

  /* THE CUSTOM CARD. On the plan already: add or remove pages. Not on it:
     build one — pick pages, confirm, pay on Stripe like any other plan. Its
     year is CUSTOM_YEAR_MULTIPLIER months (lib/customPlan), read like any
     other plan's deal; its list is open like every other card's. */
  const customPagesNow = onCustom ? owned : picked;
  const customCard = (
          <section
            className={`mu-card is-custom${onCustom ? " is-cur" : ""}`}
            aria-label={onCustom ? "Custom plan" : "Build your plan"}
            data-plan-card={CUSTOM_PLAN_SLUG}
            data-monthly-cents={customPriceCents(customPagesNow)}
            data-yearly-cents={customPriceCents(customPagesNow, "YEAR")}
          >

            <PlanCardHead
              className="mu-card-top"
              term={interval}
              monthlyCents={customPriceCents(customPagesNow)}
              yearlyCents={customPriceCents(customPagesNow, "YEAR")}
              name={
                <div className="mu-card-id">
                  <span className="mu-name">{onCustom ? "Custom" : "Build your plan"}</span>
                  {!compactFeatures ? <span className="mu-desc">
                    {dollars(CUSTOM_BASE_CENTS)} base · {dollars(CUSTOM_PAGE_CENTS)} per page
                  </span> : null}
                </div>
              }
              aside={onCustom ? <span className="mu-tag is-cur">Current</span> : null}
            />

            <div className="mu-price">
              <PlanPrice
                term={interval}
                monthlyCents={customPriceCents(customPagesNow)}
                yearlyCents={customPriceCents(customPagesNow, "YEAR")}
                figureClassName="mu-price-row"
                figure={(num, per) => (
              <>
                <b>{num}</b>
                <i>{per}</i>
              </>
            )}
              />
              <PlanDealSlot
                term={interval}
                monthlyCents={customPriceCents(customPagesNow)}
                yearlyCents={customPriceCents(customPagesNow, "YEAR")}
              />
            </div>

            {/* ON THE PLAN: only the pages it holds, nothing when none
                (owner, 2026-09-04). OFF it: the add-on list, ticked as picked. */}
            <PlanFeatures>
            <ul className="mu-feats" data-plan-feats>
              {onCustom
                ? CUSTOM_PAGES.filter((pg) => owned.includes(pg.id)).map((pg) => (
                    <li key={pg.id} className="mu-f">
                      <Tick on />
                      <span>{pg.label}</span>
                    </li>
                  ))
                : CUSTOM_PAGES.map((pg) => {
                    const has = picked.includes(pg.id);
                    return (
                      <li key={pg.id} className={`mu-f${has ? "" : " is-no"}`}>
                        <Tick on={has} />
                        <span>{pg.label}</span>
                      </li>
                    );
                  })}
              {onCustom && owned.length === 0 ? (
                <li className="mu-f is-no mu-f--none">No add-on pages yet</li>
              ) : null}
            </ul>
            </PlanFeatures>

            <div className="mu-foot">
              <button
                type="button"
                className="mu-cta is-primary"
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
          </section>
  );

  /* EMBEDDED (the subscription page): the same cards as a swipe carousel,
     the interval switch above it, no shell chrome and no page head. The
     sheets still portal to <body>, so they work the same either way. */
  if (embedded) {
    return (
      <div className={`jf-mobile-upgrade mu-embed${compactFeatures ? " mu-compact" : ""}`} data-nest="" onClick={onRootClick} onAnimationEnd={onRootAnimEnd}>
        <div className="mu-embed-head">
          <div className="mu-embed-lbl">Plans</div>
          {termSwitch}
        </div>
        {deckBox}
        {declined ? <CardDeclinedNote className="mu-pcn" message={declined} /> : null}
        {scheduledSwitch ? (
          <ScheduledSwitchNote className="mu-pcn" at={scheduledSwitch.at} planName={scheduledSwitch.planName} interval={scheduledSwitch.interval} />
        ) : null}
        {err ? (
          <div className="mu-note is-bad" role="alert">
            <b>That didn&rsquo;t go through</b>
            <span>{err}</span>
          </div>
        ) : null}
        <div className="mu-rail" ref={contentRef}>
          {plans.map(planCard)}
          {onCustom || customOffered ? customCard : null}
        </div>
        {!isOwner ? (
          <p className="mu-fine">Plan changes are owner-only — ask the account owner.</p>
        ) : null}
        {confirm?.kind === "custom" || confirm?.kind === "pages" ? confirmSheet : planDialog}
        {pickerSheet}
      </div>
    );
  }

  return (
    <div
      className={`jf-mobile-upgrade mu-shell${sheetUp ? " is-locked" : ""}${compactFeatures ? " mu-compact" : ""}`}
      onClick={onRootClick}
      onAnimationEnd={onRootAnimEnd}
    >
      {/* Shared handheld chrome: dark topbar + slide-out drawer + icon sprite.
          It owns its own state and reads its token contract off this root. */}
      <MobileNav />

      <main className="mu-scroll" ref={scrollRef}>
        <div className="mu-content" ref={contentRef}>
          <div className="mu-head">
            <div className="mu-kick">Billing · plans</div>
            <h1 className="mu-title">Plans &amp; upgrade</h1>
            {cur ? (
              <p className="mu-lede">
                You&rsquo;re on{" "}
                <b>
                  {onCustom
                    ? `the Custom plan · ${dollars(curCents)}/mo`
                    : (plans.find((p) => p.slug === cur)?.name ?? currentPlan)}
                </b>
                {onCustom
                  ? " — add a page below, or switch to a full plan to open everything."
                  : "."}
              </p>
            ) : null}
          </div>


          {devTools}
          {sandbox ? (
            <div className="mu-note is-warn" role="status">
              <b>Sandbox mode</b>
              <span>Payments here are Stripe TEST charges. Card 4242 4242 4242 4242 works.</span>
            </div>
          ) : null}
          {/* The plan turning on: confetti from both side edges, the same
              effect as the desktop build's. A downgrade gets the banner only. */}
          <PlanConfetti
            active={done?.dir === "up"}
            token={done?.key ?? 0}
            once={!devTools}
            devReplay={Boolean(devTools)}
          />
          {done ? (
            <div className="mu-done" role="status">
              <span className="mu-done-k">{done.dir === "down" ? "Plan changed" : "Plan activated"}</span>
              <b>{doneName}</b>
            </div>
          ) : null}
          {cancelled ? (
            <div className="mu-note is-bad" role="alert">
              <b>Checkout was cancelled</b>
              <span>Nothing changed.</span>
            </div>
          ) : null}
          {declined ? <CardDeclinedNote className="mu-pcn" message={declined} /> : null}
          {freeSwitch ? <FreeSwitchNotice className="mu-pcn" planName={freeSwitch.planName} at={freeSwitch.at} canKeep={isOwner} /> : null}
          {scheduledSwitch ? (
            <ScheduledSwitchNote className="mu-pcn" at={scheduledSwitch.at} planName={scheduledSwitch.planName} interval={scheduledSwitch.interval} />
          ) : null}
          {err ? (
            <div className="mu-note is-bad" role="alert">
              <b>That didn&rsquo;t go through</b>
              <span>{err}</span>
            </div>
          ) : null}

          {/* ONE ROW, swiped (owner, 2026-09-04) — the same rail the
              subscription page embeds, instead of a tall stack of cards —
              under the one Monthly | Annual switch (2026-10-12). */}
          {termSwitch}
          {deckBox}
          <div className="mu-rail">
            {plans.map(planCard)}
            {onCustom || customOffered ? customCard : null}
          </div>

          {!isOwner ? (
            <p className="mu-fine">Plan changes are owner-only — ask the account owner.</p>
          ) : null}
          {!checkoutReady ? (
            <p className="mu-fine">Checkout is not configured on this deployment yet.</p>
          ) : null}
          {!compactFeatures && !onCustom && customOffered ? (
            <p className="mu-fine">
              Build your plan: {dollars(CUSTOM_BASE_CENTS)} base covers proposals, clients,
              projects, jobs, invoices and financials; each extra page is{" "}
              {dollars(CUSTOM_PAGE_CENTS)}/mo.
            </p>
          ) : null}
        </div>
      </main>

      {confirm?.kind === "custom" || confirm?.kind === "pages" ? confirmSheet : planDialog}
      {pickerSheet}
    </div>
  );
}

/** A card's feature list (owner, 2026-11-09): open on every surface — the subscription page's "View features" fold is gone. */
function PlanFeatures({ children }: { children: React.ReactNode }) {
  return children;
}
