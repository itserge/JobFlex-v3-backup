"use client";

/**
 * THE MOVE TO FREE — the way back, and the manage window (owner,
 * 2026-10-13; lib/freePlan). The notice is shared by Settings → Billing
 * (desktop and handheld) and the plan pages.
 *
 *   · FreeSwitchNotice — once booked: "Your plan switches to Free on <date>"
 *     and "Keep <plan>", which lifts the booking after one confirmation.
 *   · ManageSubscription — Settings → Billing's "Manage subscription"
 *     (owner, 2026-10-17): the plan and its status, price and term, the next
 *     date, the card with "Update card", and the way to
 *     /dashboard/subscription for plans and invoices. Since 2026-11-09 it has
 *     no way out: "Cancel subscription" is on the Subscription page only
 *     (components/billing/CancelFlow — CLAUDE.md, Owner-locked decisions).
 *   · FrameWindow — the house dialog's frame with a cross (confirm-plan-
 *     change.css — the same box, scrim and motion, a bottom sheet under
 *     600px), shared with CancelFlow. Icons come from the shell's sprite.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { resumeSubscription } from "@/actions/billing";
import { longDate } from "@/lib/format";
import { toast } from "@/components/ui/toast-store";
import { ConfirmPlanChange } from "./ConfirmPlanChange";
import { useUpdateCard } from "@/components/v3/payment-ribbon/payment-ribbon";
import "./confirm-plan-change.css";
import "./free-switch.css";
import ribbon from "@/components/v3/trial-card/trial-card.module.css";

/* ── The way back ─────────────────────────────────────────────────────── */

export function FreeSwitchNotice({
  planName,
  at,
  canKeep,
  className,
}: {
  planName: string;
  /** ISO day the plan switches to Free. */
  at: string | null;
  /** The owner; anyone else reads the line without the button. */
  canKeep: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const keep = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await resumeSubscription();
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setAsk(false);
      toast.success(`${planName} kept`, res.endsAt ? `Billing goes on as normal · next bill ${longDate(res.endsAt)}.` : "Billing goes on as normal.");
      router.refresh();
    } catch {
      setErr("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, planName, router]);

  return (
    <>
      {/* The dashboard's plate (owner, 2026-10-14): the ribbons' own text and
          blue button (trial-card.module.css — PaymentRibbon, TrialRibbon). */}
      {/* data-nest: the pages' root resets step around it (DESIGN.md, mobile notes). */}
      <div className={"jffs" + (className ? ` ${className}` : "")} data-free-switch="" data-nest="">
        <p className={`jffs-t ${ribbon.ribbonText}`}>
          {at ? (
            <>
              Your plan switches to Free on <b>{longDate(at)}</b>
            </>
          ) : (
            "Your plan switches to Free at the end of this cycle"
          )}
        </p>
        {canKeep ? (
          <button type="button" className={`jffs-keep ${ribbon.button}`} disabled={busy} onClick={() => { setErr(null); setAsk(true); }}>
            {`Keep ${planName}`}
          </button>
        ) : null}
      </div>
      <ConfirmPlanChange
        open={ask}
        kicker="Keep subscription"
        title={`Keep ${planName}?`}
        confirmLabel={`Keep ${planName}`}
        cancelLabel="Not now"
        busy={busy}
        onConfirm={() => void keep()}
        onCancel={() => {
          if (!busy) setAsk(false);
        }}
        body={
          <>
            <p>
              Billing goes back to normal{at ? `, starting with your next bill on ${longDate(at)}` : ""}. Your plan and everything on it
              stay exactly as they are.
            </p>
            {err ? (
              <p className="jffs-err" role="alert">
                {err}
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}

/* ── The manage window ──────────────────────────────────────────────── */

/** What the manage window shows besides the plan's name (lib/settings/loadSettingsData). */
export interface ManageView {
  /** Stripe was asked for this page load (it opened on Billing). */
  live: boolean;
  price: string | null;
  date: { label: string; value: string } | null;
  card: { value: string; addHref: string | null } | null;
  canUpdateCard: boolean;
}

export function ManageSubscription({
  planName,
  status,
  view,
  freeSwitch,
  changeHref,
  shown,
  className,
  children,
}: {
  planName: string;
  status: { label: string; tone: string } | null;
  view: ManageView;
  /** Booked: the window shows the notice and "Keep <plan>" at its foot. */
  freeSwitch: { at: string | null; planName: string } | null;
  changeHref: string;
  /** False while its pane sits mounted but hidden (both Settings layouts keep every pane mounted). */
  shown: boolean;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  /* Settings reads Stripe (the card) only for a page opened on Billing.
     Reached from another pane, the window would show the database alone —
     so the pane asks the server again, as ?tab=billing. Only once Billing is
     on screen: a hidden pane asking moved every Settings link there. */
  const pathname = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    if (view.live || !shown) return;
    const q = new URLSearchParams(params.toString());
    q.delete("pane");
    q.set("tab", "billing");
    router.replace(`${pathname}?${q.toString()}` as Route, { scroll: false });
  }, [view.live, shown, pathname, params, router]);

  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {children}
      </button>
      <ManageWindow
        open={open}
        planName={planName}
        status={freeSwitch ? { label: "Switching to Free", tone: "warn" } : status}
        view={view}
        freeSwitch={freeSwitch}
        changeHref={changeHref}
        onClose={close}
      />
    </>
  );
}

/** The house dialog's frame with a cross: mounts with `open`, animates in and
 *  out, and the cross, the scrim and Esc close it. */
export function FrameWindow({
  open,
  onClose,
  labelledBy,
  focusRef,
  extraClass,
  boxRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  /** Where the focus lands once the box is in; the cross by default. */
  focusRef?: RefObject<HTMLElement | null>;
  extraClass?: string;
  /** The box itself, for the caller to scroll back to the top. */
  boxRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [on, setOn] = useState(false);
  const xRef = useRef<HTMLButtonElement>(null);
  const exit = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- mount/unmount follows
     `open`; the second flag lands a frame later so the box has a start state
     (the house dialog's own pattern, ConfirmPlanChange) */
  useEffect(() => {
    if (open) {
      if (exit.current) {
        clearTimeout(exit.current);
        exit.current = null;
      }
      setMounted(true);
      const id = requestAnimationFrame(() => setOn(true));
      return () => cancelAnimationFrame(id);
    }
    setOn(false);
    exit.current = setTimeout(() => {
      setMounted(false);
      exit.current = null;
    }, 220);
    return () => {
      if (exit.current) clearTimeout(exit.current);
    };
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (on) (focusRef?.current ?? xRef.current)?.focus();
  }, [on, focusRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={"jf-confirm jffs-dlg" + (extraClass ? ` ${extraClass}` : "") + (on ? " is-on" : "")}
      data-nest=""
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div className="jf-confirm-scrim" onClick={onClose} />
      <div ref={boxRef} className="jf-confirm-box">
        <button ref={xRef} type="button" className="jffs-x" aria-label="Close" onClick={onClose}>
          {/* Drawn here, not from a page sprite: the window opens on pages
              (the handheld Subscription build) that carry no shell sprite. */}
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Settings' badge tones → the window's. */
const TONE: Record<string, string> = { "bg-ok": "ok", "bg-bad": "bad", warn: "warn" };

/** The manage window: the plan as it stands; once booked, the way back at its foot. */
function ManageWindow({
  open,
  planName,
  status,
  view,
  freeSwitch,
  changeHref,
  onClose,
}: {
  open: boolean;
  planName: string;
  status: { label: string; tone: string } | null;
  view: ManageView;
  freeSwitch: { at: string | null; planName: string } | null;
  changeHref: string;
  onClose: () => void;
}) {
  const card = useUpdateCard();
  const label = status?.label === "Trialing" ? "Trial" : status?.label;
  return (
    <FrameWindow open={open} onClose={onClose} labelledBy="jffs-mng-title" extraClass="jffs-mng">
      <div className="jf-confirm-kick">Manage subscription</div>
      <div className="jffs-mng-head">
        <h2 className="jf-confirm-h" id="jffs-mng-title">
          {planName}
        </h2>
        {label ? (
          <span className="jffs-badge" data-tone={TONE[status?.tone ?? ""] ?? "off"}>
            {label}
          </span>
        ) : null}
      </div>
      <dl className="jffs-facts">
        {view.price ? (
          <div>
            <dt>Price</dt>
            <dd>{view.price}</dd>
          </div>
        ) : null}
        {view.date ? (
          <div>
            <dt>{view.date.label}</dt>
            <dd>{view.date.value}</dd>
          </div>
        ) : null}
        {view.card ? (
          <div>
            <dt>Card</dt>
            <dd>
              <span>{view.card.value}</span>
              {view.card.addHref ? (
                <Link className="jffs-link" href={view.card.addHref as Route}>
                  Add a card
                </Link>
              ) : view.canUpdateCard ? (
                <button type="button" className="jffs-link" disabled={card.busy} onClick={() => void card.go()}>
                  {card.busy ? "Opening…" : "Update card"}
                </button>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
      {card.error ? (
        <p className="jffs-err" role="alert">
          {card.error}
        </p>
      ) : null}
      <Link className="jffs-link jffs-change" href={changeHref as Route}>
        Change plan / invoices
        <svg aria-hidden="true">
          <use href="#i-arrow" />
        </svg>
      </Link>
      {freeSwitch ? (
        <div className="jffs-mng-foot">
          <FreeSwitchNotice planName={freeSwitch.planName} at={freeSwitch.at} canKeep />
        </div>
      ) : null}
    </FrameWindow>
  );
}
