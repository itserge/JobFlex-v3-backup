"use client";

/**
 * THE MOVE TO FREE — the owner's way out, and the way back (owner,
 * 2026-10-13; lib/freePlan). The notice is shared by Settings → Billing
 * (desktop and handheld) and the plan pages; the way out lives only in
 * Settings → Billing, so the words and the money rule cannot drift.
 *
 *   · ManageSubscription — Settings → Billing's "Manage subscription"
 *     (owner, 2026-10-17: the ONE place a plan is cancelled — CLAUDE.md,
 *     Owner-locked decisions). It opens the manage window over the pane:
 *     the plan and its status, price and term, the next date, the card with
 *     "Update card", the way to /dashboard/subscription for plans and
 *     invoices, and at its foot "Cancel subscription", which REPLACES the
 *     window with two more in turn:
 *       1 "Before you go": a band of the estimators' colours over the box,
 *         the company's own numbers as tiles (lib/freePlan freeTallyTiles —
 *         none when it has none), what the plan gives that Free does not
 *         (read from the company's own plan — freePlanLosses), each line on
 *         a square in its own tool colour, and the date it keeps the plan
 *         until, in bold. "Keep <plan>" is the box's one big button and
 *         closes it; "Continue to cancel" is a plain, full-size link under
 *         it and goes on at the first press (owner, 2026-10-18).
 *         When the plan is on its trial, or the trial ended at most 14 days
 *         ago (lib/trialExtension), a framed "Request a trial extension"
 *         sits between the two (owner, 2026-10-20): it turns the window into
 *         a small form — 7 or 14 days, what they still want to try — and
 *         "Send request" (actions/trialExtension) closes the window with the
 *         plan untouched. With a request already open it reads "Request
 *         pending" instead.
 *       2 the confirmation: "Cancel <plan>?", "Why are you cancelling?" — one
 *         or more reasons, Other with its own words (lib/cancelFeedback) — and
 *         two buttons of one size. The second stays off, with a line saying
 *         why, until the answer is whole; then it books the switch with the
 *         answer (actions/billing cancelSubscription); an error stays in the
 *         window.
 *     The cross, the scrim and Esc close either window and change nothing.
 *   · FreeSwitchNotice — once booked: "Your plan switches to Free on <date>"
 *     and "Keep <plan>", which lifts the booking after one confirmation.
 *
 * The manage window and window 1 are drawn on the house dialog's frame
 * (confirm-plan-change.css — the same box, scrim and motion, a bottom sheet
 * under 600px); window 2 IS the house dialog. Icons come from the shell's
 * sprite.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cancelSubscription, resumeSubscription } from "@/actions/billing";
import { requestTrialExtension } from "@/actions/trialExtension";
import { longDate } from "@/lib/format";
import { CANCEL_REASONS, OTHER_MAX, OTHER_MIN, checkCancelFeedback, type CancelReason } from "@/lib/cancelFeedback";
import { EXTENSION_DAYS, NOTE_MAX, REQUEST_SENT_BODY, REQUEST_SENT_TITLE, type ExtensionDays, type TrialExtensionOffer } from "@/lib/trialExtension";
import { freeTallyTiles, type FreeLoss, type FreeTally } from "@/lib/freePlan";
import { toast } from "@/components/ui/toast-store";
import { ConfirmPlanChange } from "./ConfirmPlanChange";
import { useUpdateCard } from "@/components/v3/payment-ribbon/payment-ribbon";
import "./confirm-plan-change.css";
import "./free-switch.css";
import ribbon from "@/components/v3/trial-card/trial-card.module.css";

/** "until Nov 12, 2026", or the cycle in words when the date is not known. */
const untilWords = (iso: string | null) => (iso ? longDate(iso) : "the end of the cycle you've already paid for");

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

/* ── The way out ──────────────────────────────────────────────────────── */

export interface CancelOffer {
  planName: string;
  keepsUntil: string | null;
  losses: FreeLoss[];
  tally: FreeTally;
  /** Access already lapsed to Free while an external billing subscription remains. */
  accessAlreadyFree?: boolean;
  /** "Request a trial extension": only on the trial or within 14 days after it. */
  extension?: TrialExtensionOffer | null;
}

/** What the manage window shows besides the plan's name (lib/settings/loadSettingsData). */
export interface ManageView {
  /** Stripe was asked for this page load (it opened on Billing). */
  live: boolean;
  price: string | null;
  date: { label: string; value: string } | null;
  card: { value: string; addHref: string | null } | null;
  canUpdateCard: boolean;
  noCancel: string | null;
}

type Step = "closed" | "manage" | "go" | "confirm";

export function ManageSubscription({
  planName,
  status,
  view,
  offer,
  freeSwitch,
  changeHref,
  shown,
  className,
  children,
}: {
  planName: string;
  status: { label: string; tone: string } | null;
  view: ManageView;
  /** Null when there is nothing to cancel (then `view.noCancel` says why). */
  offer: CancelOffer | null;
  /** Booked: the window shows the notice and "Keep <plan>" instead. */
  freeSwitch: { at: string | null; planName: string } | null;
  changeHref: string;
  /** False while its pane sits mounted but hidden (both Settings layouts keep every pane mounted). */
  shown: boolean;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("closed");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const plan = offer?.planName ?? planName;
  const until = untilWords(offer?.keepsUntil ?? null);
  const accessAlreadyFree = offer?.accessAlreadyFree === true;
  const close = useCallback(() => setStep("closed"), []);
  // Why (lib/cancelFeedback): asked fresh each time the confirmation opens.
  const [reasons, setReasons] = useState<ReadonlySet<CancelReason>>(new Set());
  const [other, setOther] = useState("");
  const why = checkCancelFeedback({ reasons: [...reasons], otherText: other });
  const toConfirm = useCallback(() => {
    setReasons(new Set());
    setOther("");
    setErr(null);
    setStep("confirm");
  }, []);

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

  const book = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (!why.ok) return;
      const res = await cancelSubscription({ reasons: why.reasons, otherText: why.otherText });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setStep("closed");
      if (accessAlreadyFree) {
        toast.success("Billing renewal canceled", "Your account remains on the Free plan.");
      } else {
        toast.success(
          res.endsAt ? `Your plan switches to Free on ${longDate(res.endsAt)}` : "Your plan switches to Free at the end of this cycle",
          "You won't be billed again. Change your mind any time before then.",
        );
      }
      router.refresh();
    } catch {
      setErr("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }, [accessAlreadyFree, busy, router, why]);

  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" onClick={() => setStep("manage")}>
        {children}
      </button>

      {/* One window at a time: "Cancel subscription" replaces this one with
          window 1 (or, for a renewal only, straight with the confirmation). */}
      <ManageWindow
        open={step === "manage"}
        planName={planName}
        status={freeSwitch ? { label: "Switching to Free", tone: "warn" } : status}
        view={view}
        offer={offer}
        freeSwitch={freeSwitch}
        changeHref={changeHref}
        onClose={close}
        onCancel={() => {
          setErr(null);
          if (accessAlreadyFree) toConfirm();
          else setStep("go");
        }}
      />

      {offer && !accessAlreadyFree ? (
        <BeforeYouGo open={step === "go"} offer={offer} onKeep={close} onContinue={toConfirm} />
      ) : null}

      <ConfirmPlanChange
        open={step === "confirm"}
        kicker="Cancel subscription"
        title={accessAlreadyFree ? "Cancel billing subscription?" : `Cancel ${plan}?`}
        confirmLabel={accessAlreadyFree ? "Cancel billing subscription" : "Cancel subscription"}
        cancelLabel={accessAlreadyFree ? "Go back" : `Keep ${plan}`}
        busy={busy}
        confirmDisabled={!why.ok}
        onConfirm={() => void book()}
        onCancel={() => {
          if (!busy) setStep("closed");
        }}
        body={
          <>
            <p>
              {accessAlreadyFree
                ? "Your access is already on the Free plan. Canceling this billing subscription stops future renewal. Your access remains Free."
                : `You keep ${plan} until ${until} — the cycle you've already paid for — and you won't be billed again. Then your account moves to the Free plan. Nothing is refunded for the days you don't use.`}
            </p>
            <CancelReasons
              picked={reasons}
              other={other}
              disabled={busy}
              hint={why.ok ? null : why.error}
              onToggle={(key) =>
                setReasons((was) => {
                  const next = new Set(was);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
              onOther={setOther}
            />
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

/** The house dialog's frame with a cross: mounts with `open`, animates in and
 *  out, and the cross, the scrim and Esc close it. */
function FrameWindow({
  open,
  onClose,
  labelledBy,
  focusRef,
  extraClass,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  /** Where the focus lands once the box is in; the cross by default. */
  focusRef?: RefObject<HTMLElement | null>;
  extraClass?: string;
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
      <div className="jf-confirm-box">
        <button ref={xRef} type="button" className="jffs-x" aria-label="Close" onClick={onClose}>
          <svg aria-hidden="true">
            <use href="#i-x" />
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

/** The manage window: the plan as it stands, and at its foot the way out. */
function ManageWindow({
  open,
  planName,
  status,
  view,
  offer,
  freeSwitch,
  changeHref,
  onClose,
  onCancel,
}: {
  open: boolean;
  planName: string;
  status: { label: string; tone: string } | null;
  view: ManageView;
  offer: CancelOffer | null;
  freeSwitch: { at: string | null; planName: string } | null;
  changeHref: string;
  onClose: () => void;
  onCancel: () => void;
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
      <div className="jffs-mng-foot">
        {freeSwitch ? (
          <FreeSwitchNotice planName={freeSwitch.planName} at={freeSwitch.at} canKeep />
        ) : offer ? (
          <button type="button" className="jf-confirm-btn jffs-danger" onClick={onCancel}>
            {offer.accessAlreadyFree ? "Cancel billing subscription" : "Cancel subscription"}
          </button>
        ) : view.noCancel ? (
          <p className="jffs-why">{view.noCancel}</p>
        ) : null}
      </div>
    </FrameWindow>
  );
}

/** Each line's square wears one estimator colour (globals.css --tool-*,
 *  the sidebar's tool squares): free-switch.css maps the tone to the token. */
const LOSS_TONE: Record<FreeLoss["icon"], string> = {
  "i-roof": "smart",
  "i-file": "roof",
  "i-target": "video",
  "i-cal": "deck",
  "i-msg": "hvac",
};

/** Window 1. The house dialog's frame with a cross: the band, the company's
 *  numbers, the list, the date, the big button and the link — or, from the
 *  framed "Request a trial extension", the small form in its place. */
function BeforeYouGo({
  open,
  offer,
  onKeep,
  onContinue,
}: {
  open: boolean;
  offer: CancelOffer;
  onKeep: () => void;
  onContinue: () => void;
}) {
  // The way back first: the focus lands on "Keep <plan>" once the box is in.
  const keepRef = useRef<HTMLButtonElement>(null);
  const plan = offer.planName;
  const tiles = freeTallyTiles(offer.tally);
  const router = useRouter();
  const [view, setView] = useState<"main" | "ask" | "pending">("main");
  const [days, setDays] = useState<ExtensionDays>(7);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // A request sent from this window before the page has read it back.
  const [sent, setSent] = useState<{ days: number; at: string } | null>(null);
  const pending = sent ?? offer.extension?.pending ?? null;
  const firstRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- every opening starts on
     the window itself, never on a form left half-filled */
  useEffect(() => {
    if (!open) return;
    setView("main");
    setErr(null);
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (view === "ask") firstRef.current?.focus();
    else if (view === "pending") backRef.current?.focus();
  }, [view]);

  const ask = () => {
    setErr(null);
    if (pending) {
      setView("pending");
      return;
    }
    setDays(7);
    setNote("");
    setView("ask");
  };

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await requestTrialExtension({ days, note: note.trim() });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      if (res.pending) {
        setSent({ days: res.days, at: res.at });
        setView("pending");
        return;
      }
      setSent({ days, at: new Date().toISOString() });
      toast.success(REQUEST_SENT_TITLE, REQUEST_SENT_BODY);
      onKeep();
      router.refresh();
    } catch {
      setErr("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const band = (
    <div className="jffs-band" aria-hidden="true">
      {Object.values(LOSS_TONE).map((t) => (
        <i key={t} data-tone={t} />
      ))}
    </div>
  );

  if (view === "ask") {
    return (
      <FrameWindow open={open} onClose={onKeep} labelledBy="jffs-go-title" extraClass="jffs-go-dlg">
        {band}
        <div className="jf-confirm-kick">Trial extension</div>
        <h2 className="jf-confirm-h" id="jffs-go-title">
          Ask for more trial days
        </h2>
        <p className="jffs-lead">{`Your ${plan} plan stays exactly as it is while we look. ${REQUEST_SENT_BODY}`}</p>
        <form
          className="jffs-ext"
          data-trial-ext-form=""
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <fieldset className="jffs-ext-days" disabled={busy}>
            <legend className="jffs-ext-lbl">How many more days would help?</legend>
            <div className="jffs-ext-opts">
              {EXTENSION_DAYS.map((d, i) => (
                <label key={d} className="jffs-radio">
                  <input
                    ref={i === 0 ? firstRef : undefined}
                    type="radio"
                    name="jffs-ext-days"
                    value={d}
                    checked={days === d}
                    onChange={() => setDays(d)}
                  />
                  <span className="jffs-box" aria-hidden="true" />
                  <span className="jffs-opt-t">{`${d} days`}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="jffs-ext-lbl" htmlFor="jffs-ext-note">
            What do you still want to try? <span className="jffs-opt-note">Optional</span>
          </label>
          <textarea
            id="jffs-ext-note"
            className="jffs-area"
            rows={3}
            maxLength={NOTE_MAX}
            value={note}
            disabled={busy}
            placeholder="Send a roof estimate to a real client, set up texting…"
            onChange={(e) => setNote(e.target.value)}
          />
          {err ? (
            <p className="jffs-err" role="alert">
              {err}
            </p>
          ) : null}
          <div className="jffs-acts">
            <button type="submit" className="jf-confirm-btn primary jffs-keepbig" disabled={busy}>
              {busy ? "Sending…" : "Send request"}
            </button>
            <button type="button" className="jffs-link jffs-go" disabled={busy} onClick={() => setView("main")}>
              Back
            </button>
          </div>
        </form>
      </FrameWindow>
    );
  }

  if (view === "pending" && pending) {
    return (
      <FrameWindow open={open} onClose={onKeep} labelledBy="jffs-go-title" extraClass="jffs-go-dlg">
        {band}
        <div className="jf-confirm-kick">Trial extension</div>
        <h2 className="jf-confirm-h" id="jffs-go-title" data-trial-ext-pending="">
          Request pending
        </h2>
        <p className="jffs-keeps">
          {`You asked for ${pending.days} more days on `}
          <b>{longDate(pending.at)}</b>
          {`. ${REQUEST_SENT_BODY} Your ${plan} plan stays as it is meanwhile.`}
        </p>
        <div className="jffs-acts">
          <button type="button" className="jf-confirm-btn primary jffs-keepbig" onClick={onKeep}>
            {`Keep ${plan}`}
          </button>
          <button ref={backRef} type="button" className="jffs-link jffs-go" onClick={() => setView("main")}>
            Back
          </button>
        </div>
      </FrameWindow>
    );
  }

  return (
    <FrameWindow open={open} onClose={onKeep} labelledBy="jffs-go-title" focusRef={keepRef} extraClass="jffs-go-dlg">
      {band}
      <div className="jf-confirm-kick">Cancel subscription</div>
      <h2 className="jf-confirm-h" id="jffs-go-title">
        Before you go
      </h2>
      {tiles.length ? (
        <div className="jffs-tally" data-n={tiles.length}>
          <p className="jffs-tally-k">Your work on JobFlex</p>
          <dl className="jffs-tiles">
            {tiles.map((t) => (
              <div key={t.key} className="jffs-tile" data-key={t.key}>
                <dt>{t.label}</dt>
                <dd>{t.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <p className="jffs-lead">{`What ${plan} gives you that the Free plan doesn't:`}</p>
      <ul className="jffs-list">
        {offer.losses.map((l) => (
          <li key={l.text}>
            <span className="jffs-ic" data-tone={l.tone ?? LOSS_TONE[l.icon]} aria-hidden="true">
              <svg>
                <use href={`#${l.icon}`} />
              </svg>
            </span>
            <span className="jffs-li-t">{l.text}</span>
          </li>
        ))}
      </ul>
      <p className="jffs-keeps">
        {`You keep ${plan} until `}
        {offer.keepsUntil ? <b>{longDate(offer.keepsUntil)}</b> : untilWords(null)}
        {". After that your account moves to the Free plan — your data stays."}
      </p>
      <div className="jffs-acts">
        <button ref={keepRef} type="button" className="jf-confirm-btn primary jffs-keepbig" onClick={onKeep}>
          {`Keep ${plan}`}
        </button>
        {offer.extension ? (
          <button type="button" className="jf-confirm-btn jffs-extbtn" data-trial-ext="" onClick={ask}>
            Request a trial extension
          </button>
        ) : null}
        <button type="button" className="jffs-link jffs-go" onClick={onContinue}>
          Continue to cancel
        </button>
      </div>
    </FrameWindow>
  );
}

/** Window 2's question (lib/cancelFeedback): square boxes, one per reason,
 *  Other opening its own box for words. The hint says what is missing while
 *  the confirm button is off. */
function CancelReasons({
  picked,
  other,
  disabled,
  hint,
  onToggle,
  onOther,
}: {
  picked: ReadonlySet<CancelReason>;
  other: string;
  disabled: boolean;
  hint: string | null;
  onToggle: (key: CancelReason) => void;
  onOther: (text: string) => void;
}) {
  const otherRef = useRef<HTMLTextAreaElement>(null);
  const otherOn = picked.has("other");
  useEffect(() => {
    if (otherOn) otherRef.current?.focus();
  }, [otherOn]);
  return (
    <fieldset className="jffs-why" data-cancel-reasons="" disabled={disabled}>
      <legend className="jffs-ext-lbl">Why are you cancelling?</legend>
      <p className="jffs-why-sub">Pick all that apply — it helps us fix what got in the way.</p>
      <div className="jffs-why-opts">
        {CANCEL_REASONS.map((r) => (
          <label key={r.key} className="jffs-check">
            <input type="checkbox" value={r.key} checked={picked.has(r.key)} onChange={() => onToggle(r.key)} />
            <span className="jffs-box" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M5 12.5 10 17.5 19 7" />
              </svg>
            </span>
            <span className="jffs-opt-t">{r.label}</span>
          </label>
        ))}
      </div>
      {otherOn ? (
        <div className="jffs-why-other">
          <label className="jffs-ext-lbl" htmlFor="jffs-why-other">
            Tell us what it was
          </label>
          <textarea
            ref={otherRef}
            id="jffs-why-other"
            className="jffs-area jffs-area--short"
            rows={2}
            maxLength={OTHER_MAX}
            value={other}
            aria-describedby="jffs-why-count"
            onChange={(e) => onOther(e.target.value)}
          />
          <span className="jffs-count" id="jffs-why-count">
            {other.trim().length < OTHER_MIN ? `At least ${OTHER_MIN} characters` : `${other.length} / ${OTHER_MAX}`}
          </span>
        </div>
      ) : null}
      <p className="jffs-why-hint" aria-live="polite" data-cancel-hint="">
        {hint ?? ""}
      </p>
    </fieldset>
  );
}
