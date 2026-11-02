"use client";

// ADMIN · cancel a live Stripe subscription from the organization's card
// (2026-11-01; lib/adminCancel). One strip, on /admin/users (the account
// sheet's Subscription section) and /admin/subscribers (the row's detail):
// the state — "Cancels on <date>", "Cancelled by admin · <name> · <date>" —
// and the one action that fits it, "Cancel subscription" or "Undo
// cancellation", each confirmed in its own window. The strip reads its state
// from the mirror on mount and takes the action's answer after, so the card
// changes without a reload. Nothing renders for a grant (provider MANUAL) or
// an organization without a Stripe subscription.
//
// The owner's own cancel is not this: it stays in Settings → Billing only
// (owner-locked 2026-10-17).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { longDate } from "@/lib/format";
import { ADMIN_NOTE_MAX, ADMIN_NOTE_MIN } from "@/lib/cancelFeedback";
import {
  adminCancelState,
  adminCancelSubscription,
  adminUndoCancellation,
  type AdminCancelMode,
  type AdminCancelState,
} from "@/actions/adminSubscription";
import shared from "./admin-shared.module.css";
import s from "./admin-users.module.css";
import { makeCx, Field, Toggle, Note, Sheet, SheetBody, SheetFoot, useSheet, errorMessage } from "./admin-kit";

const cx = makeCx(s, shared);
const LIVE = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

export function AdminCancelSubscription({
  orgId,
  orgName,
  planName,
  provider,
}: {
  orgId: string;
  orgName: string | null;
  planName: string;
  /** The stored row's provider — a grant (MANUAL) never shows the strip. */
  provider: string | null;
}) {
  const router = useRouter();
  const sheet = useSheet();
  const anchor = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<Element | null>(null);
  const [state, setState] = useState<AdminCancelState | null>(null);
  const [view, setView] = useState<"cancel" | "undo">("cancel");
  const [mode, setMode] = useState<AdminCancelMode>("period_end");
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const stripe = provider === "STRIPE";
  useEffect(() => {
    if (!stripe) return;
    let gone = false;
    adminCancelState(orgId)
      .then((r) => !gone && setState(r))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [orgId, stripe]);

  // The window goes to the page's content box, not inside the account sheet's
  // scrolling body — the house styles are scoped to `.jf-blueprint .content`.
  useEffect(() => {
    setHost(anchor.current?.closest(".jf-blueprint .content") ?? null);
  }, []);

  if (!stripe) return null;
  const live = !!state && LIVE.has(state.status);
  const end = state?.endsAt ? longDate(state.endsAt) : null;
  const reasonLen = reason.trim().length;
  const reasonOk = reasonLen >= ADMIN_NOTE_MIN && reasonLen <= ADMIN_NOTE_MAX;

  function open(which: "cancel" | "undo") {
    setView(which);
    setErr(null);
    sheet.open();
  }
  function close() {
    if (busy) return;
    sheet.close(() => {
      setMode("period_end");
      setReason("");
      setNotify(true);
      setErr(null);
    });
  }

  async function run() {
    if (busy || (view === "cancel" && !reasonOk)) return;
    setBusy(true);
    setErr(null);
    try {
      const r = view === "cancel" ? await adminCancelSubscription(orgId, mode, reason.trim(), notify) : await adminUndoCancellation(orgId);
      if (!r.ok) throw new Error(r.error);
      setState(r.state);
      toast.success(
        view === "undo" ? "Cancellation undone" : mode === "now" ? "Subscription cancelled" : "Subscription set to cancel",
        view === "undo" ? `Renews ${r.state.endsAt ? longDate(r.state.endsAt) : "as before"}.` : notify ? "The owner has been emailed." : undefined,
      );
      setBusy(false);
      sheet.close(() => {
        setMode("period_end");
        setReason("");
        setNotify(true);
      });
      router.refresh();
    } catch (e) {
      setErr(errorMessage(e, view === "cancel" ? "Couldn't cancel the subscription." : "Couldn't undo the cancellation."));
      setBusy(false);
    }
  }

  const by = state?.byAdmin ? `Cancelled by admin · ${state.byAdmin.name} · ${longDate(state.byAdmin.at)}` : null;
  const line = state?.cancelsAtPeriodEnd
    ? [`Cancels on ${end ?? "the period end"}`, by].filter(Boolean).join(" · ")
    : state?.status === "CANCELED"
      ? by ?? null
      : live
        ? `Stripe subscription · ${state.status === "TRIALING" ? "trial ends" : "renews"} ${end ?? "—"}`
        : null;

  const dialog = (
    <Sheet
      handle={sheet}
      kicker={view === "cancel" ? "Cancel subscription" : "Undo cancellation"}
      title={orgName ?? "This organization"}
      onClose={close}
    >
      <SheetBody>
        {err ? <Note tone="danger">{err}</Note> : null}
        <dl className={cx("au-cxl-facts")}>
          <dt>Company</dt>
          <dd>{orgName ?? "—"}</dd>
          <dt>Plan</dt>
          <dd>{planName}</dd>
          <dt>{view === "undo" ? "Cancels on" : "Period ends"}</dt>
          <dd>{end ?? "—"}</dd>
        </dl>
        {view === "cancel" ? (
          <>
            <div className={cx("au-pick")} role="radiogroup" aria-label="When it ends">
              <button type="button" role="radio" aria-checked={mode === "period_end"} className={cx("au-pick-row")} onClick={() => setMode("period_end")}>
                <span className={cx("au-pick-box")} aria-hidden="true" />
                <span className={cx("au-pick-l")}>
                  <b>At the end of the paid period{end ? ` (${end})` : ""}</b>
                  <span>Keeps access until then. Nothing more is billed.</span>
                </span>
              </button>
              <button type="button" role="radio" aria-checked={mode === "now"} className={cx("au-pick-row")} onClick={() => setMode("now")}>
                <span className={cx("au-pick-box")} aria-hidden="true" />
                <span className={cx("au-pick-l")}>
                  <b>Immediately — access ends now</b>
                  <span>On the Free plan from now. Nothing is refunded.</span>
                </span>
              </button>
            </div>
            <Field
              label="Reason (internal)"
              htmlFor="au-cxl-reason"
              hint={`${reasonLen}/${ADMIN_NOTE_MAX} · at least ${ADMIN_NOTE_MIN} characters. Goes on /admin/cancellations and the activity log, never to the owner.`}
            >
              <textarea
                id="au-cxl-reason"
                className={cx("in", "ta")}
                value={reason}
                maxLength={ADMIN_NOTE_MAX}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Asked by phone to stop billing — closing the business"
              />
            </Field>
            <Toggle
              on={notify}
              onChange={setNotify}
              label="Email the owner"
              sub={mode === "now" ? "Sends “Your plan has switched to Free”." : `Sends “Your plan switches to Free on ${end ?? "<date>"}”.`}
            />
            <p className={cx("au-cxl-note")}>Deck Studio and every other line on the subscription end with it.</p>
          </>
        ) : (
          <p className={cx("au-cxl-note")}>
            Stripe renews {planName} on {end ?? "the period end"} as before, and the customer is billed then.
          </p>
        )}
      </SheetBody>
      <SheetFoot>
        <button type="button" className={cx("btn", "btn-ghost")} onClick={close} disabled={busy}>
          Keep
        </button>
        <button
          type="button"
          className={cx("btn", view === "cancel" ? "btn-danger" : "btn-primary")}
          onClick={run}
          disabled={busy || (view === "cancel" && !reasonOk)}
          title={view === "cancel" && !reasonOk ? "Give a reason first" : undefined}
        >
          {busy ? "Working…" : view === "cancel" ? "Cancel subscription" : "Undo cancellation"}
        </button>
      </SheetFoot>
    </Sheet>
  );

  return (
    <div ref={anchor} className={cx("au-cxl")} data-admin-cancel={state?.cancelsAtPeriodEnd ? "booked" : state?.status ?? "loading"}>
      <span className={cx("au-cxl-t")}>{line ?? (state ? "No live Stripe subscription" : "Checking…")}</span>
      {state?.cancelsAtPeriodEnd ? (
        <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} onClick={() => open("undo")}>
          Undo cancellation
        </button>
      ) : live ? (
        <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} onClick={() => open("cancel")}>
          Cancel subscription
        </button>
      ) : null}
      {host ? createPortal(dialog, host) : dialog}
    </div>
  );
}
