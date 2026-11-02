"use client";

// ADMIN · the subscription editor inside the account sheet (owner, 2026-09-22).
//
// One action, two modes, previewed before it runs:
//   A. Change billed plan — the Stripe subscription itself is updated; the
//      customer pays the new amount under the proration rule picked here and
//      keeps or ends the trial.
//   B. Grant plan (no charge) — a comp with a term, a reason and an author;
//      any live Stripe subscription is cancelled first so nothing bills.
// The "now → becomes" panel is the server's preview (actions/adminSubscription)
// — real figures from Stripe where Stripe can preview them — and Apply is
// refused while it says `blocked`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { longDate } from "@/lib/format";
import {
  applyAdminSubscriptionChange,
  endPlanGrantNow,
  previewAdminSubscriptionChange,
  verifyAdminSubscriptionSync,
  type AdminSubscriptionChangeInput,
  type AdminSubscriptionPreview,
  type SubscriptionFacts,
} from "@/actions/adminSubscription";
import type { AdminUserDTO, PlanOption } from "./admin-users-content";
import shared from "./admin-shared.module.css";
import s from "./admin-users.module.css";
import { makeCx, Field, Select, Toggle, Note, errorMessage, toDay, fromDay } from "./admin-kit";
import { planDisplayName } from "@/lib/planCatalog";
import { AdminCancelSubscription } from "./admin-cancel-subscription";

const cx = makeCx(s, shared);
const usd = (c: number) => "$" + (c / 100).toFixed(2);
const DAY_MS = 24 * 60 * 60 * 1000;

type Mode = "billed" | "grant";

const PRORATION_OPTIONS = [
  { value: "create_prorations", label: "Add the difference to the next invoice (default)" },
  { value: "always_invoice", label: "Charge the difference now" },
  { value: "none", label: "Nothing for this period — new price from the next invoice" },
];
const INTERVAL_OPTIONS = [
  { value: "MONTH", label: "Monthly" },
  { value: "YEAR", label: "Yearly" },
];
const FALLBACK_OPTIONS = [
  { value: "free", label: "Free plan" },
  { value: "expired", label: "No plan — must subscribe" },
];

/** The form's default end for a grant: thirty days out, as YYYY-MM-DD. */
function defaultEndDay(): string {
  return toDay(new Date(Date.now() + 30 * DAY_MS).toISOString());
}

function statusWord(f: SubscriptionFacts): string {
  return f.status.replace(/_/g, " ").toLowerCase();
}

function Facts({ title, f }: { title: string; f: SubscriptionFacts }) {
  return (
    <div className={cx("au-cmp-col")}>
      <div className={cx("au-cmp-h")}>{title}</div>
      <dl>
        <dt>Plan</dt>
        <dd>{f.planName}</dd>
        <dt>Status</dt>
        <dd>{statusWord(f)}</dd>
        <dt>Who pays</dt>
        <dd>{f.payer === "customer" ? "The customer" : "Nobody"}</dd>
        <dt>Price</dt>
        <dd>{f.priceCents === null ? "—" : `${usd(f.priceCents)} / ${f.interval === "YEAR" ? "yr" : "mo"}`}</dd>
        <dt>Next charge</dt>
        <dd>
          {f.nextChargeAt ? `${longDate(f.nextChargeAt)}${f.nextChargeCents !== null ? " · " + usd(f.nextChargeCents) : ""}` : "None"}
        </dd>
        <dt>Ends</dt>
        <dd>{f.endsAt ? longDate(f.endsAt) : f.status === "COMPLIMENTARY" ? "No end date" : "—"}</dd>
      </dl>
      {f.note ? <div className={cx("au-cmp-note")}>{f.note}</div> : null}
    </div>
  );
}

export function SubscriptionEditor({ user, plans }: { user: AdminUserDTO; plans: PlanOption[] }) {
  const router = useRouter();
  const orgId = user.orgId as string;
  const liveStripe = !!user.stripeSubId && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(user.stripeStatus ?? "");
  const liveGrant = user.provider === "MANUAL" && user.recordStatus === "ACTIVE";

  const [mode, setMode] = useState<Mode>(liveStripe ? "billed" : "grant");
  const initialPlan = plans.find((p) => p.slug.toUpperCase() === user.recordPlan.toUpperCase())?.slug ?? plans[0]?.slug ?? "";
  const [planSlug, setPlanSlug] = useState(initialPlan);
  const [interval, setInterval] = useState<"MONTH" | "YEAR">("MONTH");
  const [proration, setProration] = useState("create_prorations");
  const [endTrialNow, setEndTrialNow] = useState(false);
  const [endsAt, setEndsAt] = useState(defaultEndDay);
  const [openEnded, setOpenEnded] = useState(false);
  const [fallback, setFallback] = useState("free");
  const [cancelNow, setCancelNow] = useState(false);
  const [reason, setReason] = useState("");

  const [preview, setPreview] = useState<AdminSubscriptionPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"apply" | "verify" | "end" | null>(null);
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  const input = useMemo<AdminSubscriptionChangeInput | null>(() => {
    if (!planSlug) return null;
    let ends: string | null = null;
    if (mode === "grant" && !openEnded) {
      try {
        ends = fromDay(endsAt, "End date");
      } catch {
        ends = null;
      }
    }
    return {
      organizationId: orgId,
      mode,
      planSlug,
      reason,
      interval,
      proration: proration as AdminSubscriptionChangeInput["proration"],
      endTrialNow,
      endsAt: ends,
      openEnded,
      fallback: fallback as "free" | "expired",
      cancelNow,
      knownSubIds: user.stripeSubId ? [user.stripeSubId] : [],
    };
  }, [orgId, mode, planSlug, reason, interval, proration, endTrialNow, endsAt, openEnded, fallback, cancelNow, user.stripeSubId]);

  // The preview follows the fields, debounced; the reason is not a preview input.
  const previewKey = useMemo(() => (input ? JSON.stringify({ ...input, reason: "" }) : ""), [input]);
  useEffect(() => {
    if (!input) return;
    const mine = ++seq.current;
    const t = window.setTimeout(async () => {
      setArmed(false);
      setLoading(true);
      try {
        const r = await previewAdminSubscriptionChange({ ...input, reason: "" });
        if (mine !== seq.current) return;
        if (r.ok) {
          setPreview(r);
          setPreviewErr(null);
        } else {
          setPreview(null);
          setPreviewErr(r.error);
        }
      } catch (e) {
        if (mine === seq.current) setPreviewErr(errorMessage(e, "Couldn't preview."));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  const reasonOk = reason.trim().length >= 3;
  const canApply = !!preview && !preview.blocked && reasonOk && !loading && busy === null;

  const apply = useCallback(async () => {
    if (!input || !canApply) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy("apply");
    setErr(null);
    try {
      const r = await applyAdminSubscriptionChange(input);
      if (!r.ok) throw new Error(r.error);
      toast.success(mode === "billed" ? "Billed plan changed" : "Complimentary plan granted", r.summary);
      setArmed(false);
      setReason("");
      router.refresh();
    } catch (e) {
      setErr(errorMessage(e, "Couldn't apply the change."));
      setArmed(false);
    } finally {
      setBusy(null);
    }
  }, [input, canApply, armed, mode, router]);

  const verify = useCallback(async () => {
    setBusy("verify");
    setErr(null);
    try {
      const r = await verifyAdminSubscriptionSync(orgId);
      if (!r.ok) throw new Error(r.error);
      if (r.confirmed) toast.success("Stripe confirms the change", r.stripe ? `${r.stripe.status} · ${r.stripe.priceId ?? "—"}` : undefined);
      else toast.error("Stripe does not agree yet", r.stripe ? `Stripe: ${r.stripe.status} on ${r.stripe.priceId ?? "—"}` : undefined);
      router.refresh();
    } catch (e) {
      setErr(errorMessage(e, "Couldn't reach Stripe."));
    } finally {
      setBusy(null);
    }
  }, [orgId, router]);

  const endNow = useCallback(async () => {
    if (!reasonOk) {
      setErr("Give a reason before ending the complimentary plan.");
      return;
    }
    setBusy("end");
    setErr(null);
    try {
      const r = await endPlanGrantNow(orgId, fallback as "free" | "expired", reason);
      if (!r.ok) throw new Error(r.error);
      toast.success("Complimentary plan ended", fallback === "free" ? "The organization is on the Free plan." : "The organization must subscribe.");
      setReason("");
      router.refresh();
    } catch (e) {
      setErr(errorMessage(e, "Couldn't end the plan."));
    } finally {
      setBusy(null);
    }
  }, [orgId, fallback, reason, reasonOk, router]);

  const planOptions = plans.map((p) => ({ value: p.slug, label: p.name }));
  const grant = user.grant;
  const mark = user.syncing;

  return (
    <>
      {err ? <Note tone="danger">{err}</Note> : null}

      <div className={cx("meta")}>
        <span>
          Provider <b>{user.provider ?? "—"}</b>
        </span>
        {user.externalSubId ? (
          <span title={user.externalSubId}>
            Sub <b>{user.externalSubId}</b>
          </span>
        ) : user.stripeSubId ? (
          <span title={user.stripeSubId}>
            Stripe holds <b>{user.stripeSubId}</b> · {user.stripeStatus}
          </span>
        ) : null}
        {user.stripeCustomerId ? (
          <span title={user.stripeCustomerId}>
            Customer <b>{user.stripeCustomerId}</b>
          </span>
        ) : null}
      </div>

      {/* Cancel the live Stripe subscription (lib/adminCancel) — a grant has its own End below. */}
      <AdminCancelSubscription orgId={orgId} orgName={user.orgName} planName={planDisplayName(user.recordPlan, plans)} provider={user.provider} />

      {mark ? (
        <Note>
          Syncing since {new Date(mark.since).toLocaleString("en-US")} — {mark.note} (by {mark.by}). Stripe has not
          reported it back yet; another change waits until it does.{" "}
          <button type="button" className={cx("btn", "btn-sm")} onClick={verify} disabled={busy !== null}>
            {busy === "verify" ? "Checking…" : "Verify with Stripe"}
          </button>
        </Note>
      ) : null}

      {liveGrant ? (
        <Note tone="ok">
          Complimentary <b>{planDisplayName(user.recordPlan, plans)}</b>{" "}
          {grant?.endsAt ? <>until <b>{longDate(grant.endsAt)}</b></> : user.currentPeriodEnd ? <>until <b>{longDate(user.currentPeriodEnd)}</b></> : <b>with no end date</b>}
          {grant ? (
            <>
              {" "}· {grant.reason} · by {grant.actorEmail} · then {grant.fallback === "free" ? "Free plan" : "no plan"}
              {grant.replaced ? (
                <>
                  {" "}· replaced {grant.replaced.subId} ({grant.replaced.action === "canceled_now" ? "cancelled" : grant.replaced.action === "cancel_at_period_end" ? `cancels ${grant.replaced.endsAt ? longDate(grant.replaced.endsAt) : "at the period end"}` : "left alone"})
                </>
              ) : null}
            </>
          ) : (
            <> · written before the editor existed (no term on record)</>
          )}
        </Note>
      ) : null}

      {!liveGrant && user.stripeStatus && (user.stripePlan !== user.recordPlan || user.stripeStatus !== user.recordStatus) ? (
        <Note>
          Stripe says <b>{user.stripePlan ? planDisplayName(user.stripePlan, plans) : "—"}</b> · <b>{user.stripeStatus}</b>; this row says{" "}
          <b>{planDisplayName(user.recordPlan, plans)}</b> ·{" "}
          <b>{user.recordStatus}</b>. Sync from Stripe writes it.
        </Note>
      ) : null}

      <div className={cx("au-seg")} role="radiogroup" aria-label="What kind of change">
        <button type="button" role="radio" aria-checked={mode === "billed"} onClick={() => setMode("billed")}>
          Change billed plan
        </button>
        <button type="button" role="radio" aria-checked={mode === "grant"} onClick={() => setMode("grant")}>
          Grant plan (no charge)
        </button>
      </div>

      <div className={cx("row")}>
        <Field label="Plan" htmlFor="au-plan">
          <Select id="au-plan" value={planSlug} onChange={setPlanSlug} options={planOptions} placeholder={plans.length ? undefined : "No plans in the catalog"} disabled={plans.length === 0} />
        </Field>
        {mode === "billed" ? (
          <Field label="Billing" htmlFor="au-interval">
            <Select id="au-interval" value={interval} onChange={(v) => setInterval(v as "MONTH" | "YEAR")} options={INTERVAL_OPTIONS} />
          </Field>
        ) : (
          <Field label="Ends" htmlFor="au-ends" hint={openEnded ? "No end date — chosen explicitly" : "YYYY-MM-DD"}>
            <input id="au-ends" className={cx("in", "in--mono")} inputMode="numeric" placeholder="YYYY-MM-DD" value={endsAt} disabled={openEnded} onChange={(e) => setEndsAt(e.target.value)} />
          </Field>
        )}
      </div>

      {mode === "billed" ? (
        <>
          <Field label="Proration" htmlFor="au-proration">
            <Select id="au-proration" value={proration} onChange={setProration} options={PRORATION_OPTIONS} />
          </Field>
          {preview?.now.status === "TRIALING" || user.stripeStatus === "TRIALING" ? (
            <Toggle
              on={endTrialNow}
              onChange={setEndTrialNow}
              label="End the trial now"
              sub={
                endTrialNow
                  ? "Starts paying today."
                  : `Keeps the trial — starts paying ${preview?.now.nextChargeAt ? longDate(preview.now.nextChargeAt) : "at its end"}.`
              }
            />
          ) : null}
        </>
      ) : (
        <>
          <div className={cx("row")}>
            <Toggle on={openEnded} onChange={setOpenEnded} label="No end date" sub="An open-ended comp — end it by hand from here." />
            <Field label="After it ends" htmlFor="au-fallback">
              <Select id="au-fallback" value={fallback} onChange={setFallback} options={FALLBACK_OPTIONS} />
            </Field>
          </div>
          {preview?.now.payer === "customer" && preview.now.status !== "TRIALING" ? (
            <Toggle
              on={cancelNow}
              onChange={setCancelNow}
              label="Cancel the paid subscription immediately"
              sub={cancelNow ? "Stops now; nothing is refunded." : `Runs to ${preview.now.nextChargeAt ? longDate(preview.now.nextChargeAt) : "the period end"}, then stops; no further charges.`}
            />
          ) : null}
        </>
      )}

      <Field label="Reason" htmlFor="au-reason" hint="Required — goes on the organization's activity with your email.">
        <textarea id="au-reason" className={cx("in", "ta")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === "billed" ? "e.g. Agreed on the call: moves to the higher plan from today" : "e.g. Partner shop — complimentary until the case study ships"} />
      </Field>

      {previewErr ? <Note tone="danger">{previewErr}</Note> : null}
      {preview ? (
        <div className={cx("au-cmp")} aria-busy={loading}>
          <Facts title="Now" f={preview.now} />
          <div className={cx("au-cmp-arrow")} aria-hidden="true">
            →
          </div>
          <Facts title="Becomes" f={preview.becomes} />
          <div className={cx("au-cmp-foot")}>
            {preview.chargeNowCents !== null ? (
              <div className={cx("au-charge")}>Charged today: {usd(preview.chargeNowCents)}</div>
            ) : mode === "billed" ? (
              <div>Nothing is charged today.</div>
            ) : (
              <div>Nothing is charged — now or later.</div>
            )}
            <div className={cx("au-act")}>
              Stripe: {preview.stripeAction}
              {preview.estimated ? " · figures estimated here, not previewed by Stripe" : ""}
            </div>
            {preview.warnings.map((w) => (
              <div key={w} className={cx("au-warn")}>
                {w}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {preview?.blocked ? <Note tone="danger">{preview.blocked}</Note> : null}

      <div className={cx("au-apply")}>
        {liveGrant ? (
          <button type="button" className={cx("btn", "btn-ghost")} onClick={endNow} disabled={busy !== null || !reasonOk} title={reasonOk ? undefined : "Give a reason first"}>
            {busy === "end" ? "Ending…" : `End complimentary access now → ${fallback === "free" ? "Free plan" : "no plan"}`}
          </button>
        ) : null}
        <button type="button" className={cx("btn", armed ? "btn-danger" : "btn-primary")} onClick={apply} disabled={!canApply} title={!reasonOk ? "Give a reason first" : preview?.blocked ?? undefined}>
          {busy === "apply" ? "Applying…" : armed ? "Confirm — run it on Stripe" : mode === "billed" ? "Change billed plan" : "Grant plan"}
        </button>
      </div>
    </>
  );
}
