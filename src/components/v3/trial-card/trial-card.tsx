"use client";

// THE CARD-LESS TRIAL'S TWO SURFACES (owner, 2026-10-01; lib/cardlessTrial):
//   · TrialRibbon — over every dashboard page. Early in the trial a calm
//     "N days free · No card needed" with a quiet "Add a card early" link; in
//     the last days "N days left · Add a card to keep access" with the button;
//     "Trial ended · you're on Free" with the way back (owner, 2026-10-14:
//     a trial that ran out is the Free plan, no longer read-only). A card already on file
//     turns it quiet. Every way to a card leads to /dashboard/trial first.
//   · TrialSheet — /dashboard/trial: when the trial ends, the plan and its
//     price, that nothing is charged before then, and the one action. Only
//     this page asks /api/billing/trial-card for Stripe Checkout (ticket
//     HQFESV, 2026-10-09: an "Add card" that left for Stripe from the ribbon
//     read as "the app wants a card" a minute after signing up).
// Only the owner adds the card; everyone else is told who can.
// While the trial runs the ribbon can be dismissed, one step at a time
// (lib/trialNotice); once it has ended it stays.
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import type { TrialView } from "@/lib/cardlessTrial";
import { TRIAL_CAP_NOUN, TRIAL_CAP_TITLE, trialCapAllowance, type TrialCapKey } from "@/lib/trialCaps";
import { TRIAL_NOTICE_DAYS, trialDismissCookie, trialNoticeDismissed, trialNoticeStep } from "@/lib/trialNotice";
import s from "./trial-card.module.css";
import { FreeSwitchNotice } from "@/components/billing/FreeSwitch";

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function useAddCard() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const leaving = React.useRef(false);
  React.useEffect(() => {
    // Back from Stripe through the back/forward cache: idle again.
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted && leaving.current) {
        leaving.current = false;
        setBusy(false);
      }
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  const go = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/trial-card", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string; purpose?: string };
      if (res.ok && body.url) {
        leaving.current = true;
        window.location.href = body.url;
        return;
      }
      setError(body.error || "Couldn't open the card form. Try again.");
    } catch {
      setError("Couldn't reach billing. Try again.");
    }
    setBusy(false);
  }, [busy]);
  return { go, busy, error };
}

/* THE DISMISSAL, SHARED. The layout leaves a dismissed ribbon out on the
   server; this covers the rest. The dock and the ribbon can be two mounts at
   once (the shell's handheldBanner beside the layout's children), and a
   layout is not re-rendered on a client-side navigation, so a mount that
   arrives later reads the cookie itself instead of trusting the layout's
   first answer. */
const dismissListeners = new Set<() => void>();
function subscribeDismiss(cb: () => void) {
  dismissListeners.add(cb);
  return () => {
    dismissListeners.delete(cb);
  };
}
function readCookie(name: string): string | null {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

function useDismiss(view: TrialView, orgId: string) {
  const name = trialDismissCookie(orgId);
  const dismissed = React.useSyncExternalStore(
    subscribeDismiss,
    () => trialNoticeDismissed(view, readCookie(name)),
    // The layout renders the ribbon only while it is not dismissed.
    () => false,
  );
  const dismiss = React.useCallback(() => {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${name}=${trialNoticeStep(view.daysLeft)}; path=/; expires=${new Date(view.endsAt).toUTCString()}; samesite=lax${secure}`;
    dismissListeners.forEach((cb) => cb());
  }, [name, view.daysLeft, view.endsAt]);
  return { dismissed, dismiss };
}

function DismissButton({ onClick }: { onClick: () => void }) {
  // The icon is the shell sprite's (every dashboard shell mounts one; the
  // classic layout mounts it beside this ribbon).
  return (
    <button type="button" className={s.dismiss} aria-label="Dismiss" onClick={onClick}>
      <svg className={s.dismissIcon} aria-hidden="true" focusable="false">
        <use href="#i-x" />
      </svg>
    </button>
  );
}

function daysText(n: number): string {
  if (n <= 0) return "Ends today";
  return n === 1 ? "1 day left" : `${n} days left`;
}

/** The early step's stamp: the days still free, said as a fact. */
function freeText(n: number): string {
  return n === 1 ? "1 day free" : `${n} days free`;
}

/* TWO PLACEMENTS, ONE COMPONENT. Above 768px the ribbon sits at the top of
   the page's column. At 768px and under the handheld pages are full-screen
   compositions of their own (some fixed to the viewport), so the same ribbon
   docks as a compact bar just above the bottom navigation instead — CSS
   chooses which of the two shows (trial-card.module.css). The mapped handheld
   surfaces, which replace the layout's children, get the dock alone
   (only="dock", via the shell's handheldBanner).
   DISMISSABLE while the trial runs (lib/trialNotice): the dock then runs the
   full width of the screen, over the support button, with the cross where
   that button stands — the button is hidden under it (trial-card.module.css)
   and back as soon as the dock goes. Ended, the dock keeps clear of it. */
export function TrialRibbon({ view, isOwner, orgId, only }: { view: TrialView; isOwner: boolean; orgId: string; only?: "dock" }) {
  const { dismissed, dismiss } = useDismiss(view, orgId);
  // Not over the trial's own page, which says the same at full size. Read in
  // the browser too: a layout is not re-rendered on a client-side navigation
  // (a refused write redirects there), so the server's check alone left it up.
  const pathname = usePathname();
  const ended = view.kind === "ended";
  // Cancelled during the trial (lib/freePlan): it ends on the Free plan, so
  // nothing asks for a card — the ribbon says the date and the way back.
  const toFree = !ended && view.toFree;
  // The early step (lib/trialNotice): nothing is due, so nothing is asked.
  const early = !ended && !toFree && !view.hasCard && view.daysLeft > TRIAL_NOTICE_DAYS;
  const tone = ended ? s.isEnded : toFree || view.hasCard ? s.isCard : early ? s.isEarly : s.isSoon;
  const stamp = ended ? "On Free" : toFree ? "Switching to Free" : view.hasCard ? "Card on file" : early ? freeText(view.daysLeft) : daysText(view.daysLeft);
  const switchDay = DATE.format(new Date(view.endsAt));
  const action =
    toFree ? (
      isOwner ? (
        <Link className={s.early} href={"/dashboard/subscription" as Route}>
          {`Keep ${view.planName}`}
        </Link>
      ) : null
    ) : view.hasCard && !ended ? null : !isOwner ? null : early ? (
      <Link className={s.early} href={"/dashboard/trial" as Route}>
        Add a card early
      </Link>
    ) : (
      <Link className={s.button} href={"/dashboard/trial" as Route}>
        {ended ? "Pick a plan" : "Add card"}
      </Link>
    );
  const dock = (
    <div className={`${s.dock} ${tone} ${ended ? "" : s.dockWide}`} role="status">
      <div className={s.dockLead}>
        <span className={s.stamp}>{stamp}</span>
        <p className={s.dockText}>
          {ended
            ? "Your trial ended — you're on Free"
            : toFree
              ? `Switches to Free on ${switchDay}`
              : view.hasCard
              ? `${view.planName} starts ${DATE.format(new Date(view.endsAt))}`
              : early
                ? "No card needed"
                : isOwner
                  ? "Add a card to keep access"
                  : "Ask the owner to add a card"}
        </p>
      </div>
      {action}
      {ended ? null : <DismissButton onClick={dismiss} />}
    </div>
  );
  if (pathname?.startsWith("/dashboard/trial") || dismissed) return null;
  if (only === "dock") return dock;
  // Cancelled during the trial: the switch to Free's own plate, the one every
  // page that shows the plan draws (components/billing/FreeSwitch).
  if (toFree) {
    return (
      <>
        {dock}
        <FreeSwitchNotice className={s.freeRibbon} planName={view.planName} at={view.endsAt} canKeep={isOwner} />
      </>
    );
  }
  return (
    <>
    {dock}
    <div className={`${s.ribbon} ${tone}`} role="status">
      <span className={s.stamp}>{stamp}</span>
      <p className={s.ribbonText}>
        {ended ? (
          <>
            <b>Your trial ended — you&rsquo;re on Free.</b> <span>Pick a plan to get {view.planName} back.</span>
          </>
        ) : view.hasCard ? (
          <>
            <b>You&rsquo;re set.</b> <span>{view.planName} starts on {DATE.format(new Date(view.endsAt))} at {view.price}.</span>
          </>
        ) : early ? (
          <>
            <b>No card needed.</b> <span>Free until {DATE.format(new Date(view.endsAt))}.</span>
          </>
        ) : (
          <>
            <b>Add a card to keep access.</b> <span>Free until {DATE.format(new Date(view.endsAt))}, then {view.planName} at {view.price}.</span>
          </>
        )}
      </p>
      {view.hasCard && !ended ? null : isOwner ? (
        action
      ) : early ? null : (
        <span className={s.ribbonText}>
          <span>Ask the owner to add a card.</span>
        </span>
      )}
      {ended ? null : <DismissButton onClick={dismiss} />}
    </div>
    </>
  );
}

/** A ceiling as the sheet lists it (lib/trialMeter.trialCapUsage). */
export type TrialCapRow = { key: TrialCapKey; used: number; cap: number };

export function TrialSheet({
  view,
  isOwner,
  notice,
  caps = null,
  capHit = null,
}: {
  view: TrialView;
  isOwner: boolean;
  /** The return from Stripe: "added" / "cancelled" / an error line. */
  notice: { tone: "ok" | "error" | "plain"; text: string } | null;
  /** The card-less trial's ceilings and their uses — null once a card is on
   *  file (the plan's limits apply) or the trial has ended. */
  caps?: TrialCapRow[] | null;
  /** The ceiling a refused action sent the browser here for (?cap=). */
  capHit?: TrialCapKey | null;
}) {
  const { go, busy, error } = useAddCard();
  const ended = view.kind === "ended";
  const tone = ended ? s.isEnded : view.hasCard ? s.isCard : view.daysLeft <= TRIAL_NOTICE_DAYS ? s.isSoon : "";
  const when = DATE.format(new Date(view.endsAt));
  // A ceiling was reached: the sheet leads with it (owner, 2026-10-02).
  const hit = !ended && !view.hasCard && caps ? capHit : null;
  const toFree = !ended && view.toFree;
  const title = ended ? "Your trial ended — you're on Free" : toFree ? "Your plan switches to Free" : view.hasCard ? "Your card is on file" : hit ? TRIAL_CAP_TITLE : "Add a card to keep access";
  const lede = toFree
    ? `You cancelled during the trial. On ${when} your account moves to the Free plan and nothing is charged — your work stays. Changed your mind? Keep ${view.planName} on the Subscription page.`
    : ended
    ? `Your trial ended on ${when} and your account moved to the Free plan: everything you made is still here, and you keep working within the Free plan's limits. Add a card and ${view.planName} is back today — no new trial — or pick another plan.`
    : view.hasCard
      ? `Nothing to do. The trial runs until ${when}, then ${view.planName} begins and the card is charged.`
      : hit
        ? `The free trial without a card includes ${trialCapAllowance(hit)}. Add a card and ${view.planName}'s full limits apply at once — nothing is charged until ${when}.`
        : `The trial is free until ${when}. Add a card and nothing is charged before then — on ${when} ${view.planName} carries on at ${view.price} without a gap. Without one, the workspace turns read-only on ${when}.`;
  return (
    <div className={s.page}>
      {notice ? (
        <p className={`${s.note} ${notice.tone === "ok" ? s.ok : notice.tone === "error" ? s.error : ""}`} role="status">
          {notice.text}
        </p>
      ) : null}
      <section className={`${s.sheet} ${tone}`} aria-labelledby="trial-title">
        <header className={s.sheetHead}>
          <span className={s.kicker}>Free trial · no card</span>
          <span className={s.stamp}>
            {ended ? "Ended" : view.hasCard ? "Card on file" : daysText(view.daysLeft)}
          </span>
        </header>
        <div className={s.sheetBody}>
          <h1 id="trial-title" className={s.title}>
            {title}
          </h1>
          <p className={s.lede}>{lede}</p>
          <div className={s.plan}>
            <span className={s.planName}>{view.planName}</span>
            <span className={s.planPrice}>
              {view.price.replace(/\/(mo|yr)$/, "")}
              <i>/{view.price.endsWith("/yr") ? "yr" : "mo"}</i>
            </span>
            <span className={s.planNote}>
              {view.toFree && !ended
                ? `Switches to Free on ${when} — nothing is charged.`
                : ended
                  ? "Charged today, then monthly. Cancel any time from the Subscription page."
                  : `First charge ${when}, then monthly. Cancel any time from the Subscription page.`}
            </span>
          </div>
          {caps && !ended && !view.hasCard ? (
            <section className={s.caps} aria-labelledby="trial-caps">
              <h2 id="trial-caps" className={s.capsHead}>
                Included without a card
              </h2>
              <ul className={s.capList}>
                {caps.map((c) => {
                  const [, many] = TRIAL_CAP_NOUN[c.key];
                  const full = c.used >= c.cap;
                  return (
                    <li key={c.key} className={`${s.capRow} ${c.key === hit ? s.capHit : ""}`} data-cap={c.key} data-full={full || undefined}>
                      <span className={s.capName}>{many.charAt(0).toUpperCase() + many.slice(1)}</span>
                      <span className={s.capUse}>{c.cap === 0 ? "Needs a card" : `${Math.min(c.used, c.cap)} of ${c.cap} used`}</span>
                    </li>
                  );
                })}
              </ul>
              <p className={s.capsNote}>With a card on file the plan&rsquo;s own limits apply instead.</p>
            </section>
          ) : null}
          {view.hasCard && !ended ? (
            <div className={s.actions}>
              <Link className={s.quiet} href={"/dashboard" as Route}>
                Back to the dashboard
              </Link>
            </div>
          ) : toFree ? (
            <div className={s.actions}>
              {isOwner ? (
                <Link className={s.button} href={"/dashboard/settings?tab=billing" as Route}>
                  {`Keep ${view.planName}`}
                </Link>
              ) : null}
              <Link className={s.quiet} href={"/dashboard" as Route}>
                Back to the dashboard
              </Link>
            </div>
          ) : isOwner ? (
            <div className={s.actions}>
              {ended && view.offer ? (
                <p className={s.offer} data-winback-offer>
                  <b>{view.offer.pct}% off for {view.offer.months} months</b> — applied by itself at the card step, until {DATE.format(new Date(view.offer.until))}.
                </p>
              ) : null}
              <button type="button" className={s.button} onClick={() => void go()} disabled={busy} aria-busy={busy || undefined}>
                {busy ? "Opening…" : ended && view.offer ? `Get ${view.planName} back — ${view.offer.pct}% off` : ended ? `Get ${view.planName} back` : "Add a card"}
              </button>
              {ended ? (
                <Link className={s.quiet} href={"/dashboard/upgrade" as Route}>
                  See every plan
                </Link>
              ) : null}
              <Link className={s.quiet} href={"/dashboard" as Route}>
                {ended ? "Stay on Free" : "Later"}
              </Link>
            </div>
          ) : (
            <p className={s.note}>Only the owner of this workspace can add the card.</p>
          )}
          {error ? (
            <p className={`${s.note} ${s.error}`} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
