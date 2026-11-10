"use client";

/**
 * THE WAY OUT (owner, 2026-11-09 — CLAUDE.md, Owner-locked decisions): the
 * Subscription page's "Cancel subscription", the one place an owner cancels.
 * It opens ONE window on the house dialog's frame (FrameWindow — the same
 * box, scrim and motion, a bottom sheet under 600px) whose screens follow
 * the question tree in lib/cancelTree:
 *
 *   A   "Before you cancel — what's the main reason?" — three big cards.
 *   A1  B1 what got in the way + what to try first
 *       C1 7 or 14 more trial days (only when lib/trialExtension offers it):
 *          "Request extension" sends the request with B1's answer and closes
 *          the window with the plan untouched (actions/trialExtension).
 *   A2  B2 which tools → C2 what was wrong with each (one open at a time)
 *       → D2 what instead + would you try again.
 *   A3  B3 the reasons, a follow-up under each one picked.
 *   E   "Before you go" (what the plan gives that Free does not), then
 *       "Cancel <plan>?" with one line that sums the answers up and "Edit
 *       answers". Cancel subscription books the switch to Free with the
 *       whole answer (actions/billing cancelSubscription).
 *
 * Back on every screen; the answers stay while the window is open. The
 * cross, the scrim, Esc and every Keep button close it and write nothing but
 * the cancel_flow_abandoned event with the screen it was on
 * (actions/cancelFlow). Each screen shown is a cancel_flow_step.
 *
 * Square corners, hairline (--ink-line) rules, square boxes and radios, no
 * shadow on the choices; every row and button is 44px or more to the touch.
 * cancel-flow.css; the Before you go look is free-switch.css's.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cancelSubscription } from "@/actions/billing";
import { requestTrialExtension } from "@/actions/trialExtension";
import { trackCancelFlow } from "@/actions/cancelFlow";
import { longDate } from "@/lib/format";
import { freeTallyTiles, type FreeLoss } from "@/lib/freePlan";
import { EXTENSION_DAYS, REQUEST_SENT_BODY, REQUEST_SENT_TITLE, type ExtensionDays } from "@/lib/trialExtension";
import {
  AGAIN,
  BLOCKERS,
  CANCEL_PATHS,
  CANCEL_TOOLS,
  FAIR_PRICES,
  INSTEAD,
  LONG_MAX,
  OTHER_REASONS,
  PICKUPS,
  PROBLEMS,
  TEXT_MAX,
  TEXT_MIN,
  TRY_TOOLS,
  answersSummary,
  checkA1,
  checkA2Tools,
  checkA3,
  checkCancelAnswers,
  toolLabel,
  type Again,
  type Blocker,
  type CancelPath,
  type CancelTool,
  type FairPrice,
  type FlowStep,
  type Instead,
  type OtherReason,
  type Pickup,
  type Problem,
} from "@/lib/cancelTree";
import type { CancelOffer } from "@/lib/cancelOfferServer";
import { toast } from "@/components/ui/toast-store";
import { FrameWindow } from "./FreeSwitch";
import "./confirm-plan-change.css";
import "./free-switch.css";
import "./cancel-flow.css";

/* ── the answers while the window is open ─────────────────────────────── */

interface ToolDraft {
  problems: Problem[];
  missing: string;
  fix: string;
}
interface Draft {
  path: CancelPath | null;
  blockers: Blocker[];
  blockerOther: string;
  tryFirst: CancelTool[];
  tools: CancelTool[];
  toolOtherOn: boolean;
  toolOther: string;
  perTool: Partial<Record<CancelTool, ToolDraft>>;
  instead: Instead | null;
  insteadApp: string;
  again: Again | null;
  emailOk: boolean;
  reasons: OtherReason[];
  otherText: string;
  fairPrice: FairPrice | null;
  switchedWhich: string;
  switchedBetter: string;
  pickup: Pickup | null;
  testingHoped: string;
}
const EMPTY: Draft = {
  path: null,
  blockers: [],
  blockerOther: "",
  tryFirst: [],
  tools: [],
  toolOtherOn: false,
  toolOther: "",
  perTool: {},
  instead: null,
  insteadApp: "",
  again: null,
  emailOk: true,
  reasons: [],
  otherText: "",
  fairPrice: null,
  switchedWhich: "",
  switchedBetter: "",
  pickup: null,
  testingHoped: "",
};
const NO_TOOL: ToolDraft = { problems: [], missing: "", fix: "" };

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

const a1Of = (d: Draft) => ({ blockers: d.blockers, blockerOther: d.blockerOther, tryFirst: d.tryFirst });
const a2Of = (d: Draft) => ({
  tools: d.tools,
  toolOtherOn: d.toolOtherOn,
  toolOther: d.toolOtherOn ? d.toolOther : "",
  perTool: d.perTool,
  instead: d.instead ?? undefined,
  insteadApp: d.insteadApp,
  again: d.again ?? undefined,
  emailOk: d.emailOk,
});
const a3Of = (d: Draft) => ({
  reasons: d.reasons,
  otherText: d.otherText,
  fairPrice: d.fairPrice ?? undefined,
  switchedWhich: d.switchedWhich,
  switchedBetter: d.switchedBetter,
  pickup: d.pickup ?? undefined,
  testingHoped: d.testingHoped,
});
/** What the server is sent: the path and that path's part only. */
function payload(d: Draft): unknown {
  if (d.path === "A1") return { path: "A1", a1: a1Of(d) };
  if (d.path === "A2") return { path: "A2", a2: a2Of(d) };
  if (d.path === "A3") return { path: "A3", a3: a3Of(d) };
  return {};
}

/** The screens in order for the path picked. */
function sequence(d: Draft, offer: CancelOffer): FlowStep[] {
  const tail: FlowStep[] = offer.accessAlreadyFree ? ["E_confirm"] : ["E_before", "E_confirm"];
  if (d.path === "A1") return ["A", "B1", ...(offer.extension ? (["C1"] as FlowStep[]) : []), ...tail];
  if (d.path === "A2") return ["A", "B2", ...(d.tools.length ? (["C2"] as FlowStep[]) : []), "D2", ...tail];
  if (d.path === "A3") return ["A", "B3", ...tail];
  return ["A"];
}
/** The first question of the path — where "Edit answers" goes. */
const FIRST_OF: Record<CancelPath, FlowStep> = { A1: "B1", A2: "B2", A3: "B3" };

/** Before you go's line squares wear one estimator colour each (free-switch.css). */
const LOSS_TONE: Record<FreeLoss["icon"], string> = { "i-roof": "smart", "i-file": "roof", "i-target": "video", "i-cal": "deck", "i-msg": "hvac" };
/** The five line icons, drawn here: the handheld page carries no shell sprite. */
const LOSS_ICON: Record<FreeLoss["icon"], ReactNode> = {
  "i-roof": (
    <>
      <path d="m2 11 10-8 10 8" />
      <path d="M5 9v12h14V9" />
    </>
  ),
  "i-file": (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </>
  ),
  "i-target": (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  "i-cal": (
    <>
      <rect x="3" y="4" width="18" height="18" rx="1" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </>
  ),
  "i-msg": <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
};

const TICK = (
  <svg viewBox="0 0 24 24">
    <path d="M5 12.5 10 17.5 19 7" />
  </svg>
);

/* ── the pieces ───────────────────────────────────────────────────────── */

function Check({ on, label, onChange, name, big }: { on: boolean; label: ReactNode; onChange: () => void; name?: string; big?: boolean }) {
  return (
    <label className={"jffs-check" + (big ? " jfcf-tile" : "")}>
      <input type="checkbox" name={name} checked={on} onChange={onChange} />
      <span className="jffs-box" aria-hidden="true">
        {TICK}
      </span>
      <span className="jffs-opt-t">{label}</span>
    </label>
  );
}
function Radio({ on, label, onChange, name, sub }: { on: boolean; label: ReactNode; onChange: () => void; name: string; sub?: string }) {
  return (
    <label className="jffs-radio">
      <input type="radio" name={name} checked={on} onChange={onChange} />
      <span className="jffs-box" aria-hidden="true" />
      <span className="jffs-opt-t">
        {label}
        {sub ? <span className="jfcf-opt-sub">{sub}</span> : null}
      </span>
    </label>
  );
}
function Words({
  id,
  label,
  value,
  onChange,
  max,
  min,
  rows = 2,
  optional,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  min?: number;
  rows?: number;
  optional?: boolean;
  placeholder?: string;
}) {
  const short = min !== undefined && value.trim().length < min;
  return (
    <div className="jfcf-words">
      <label className="jffs-ext-lbl" htmlFor={id}>
        {label}
        {optional ? <span className="jffs-opt-note">Optional</span> : null}
      </label>
      {rows === 1 ? (
        <input id={id} className="jffs-area jfcf-input" type="text" maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <textarea id={id} className="jffs-area jffs-area--short" rows={rows} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {rows === 1 && !short ? null : <span className="jffs-count">{short ? `At least ${min} characters` : `${value.length} / ${max}`}</span>}
    </div>
  );
}

/* ── the window ───────────────────────────────────────────────────────── */

export function CancelFlow({ offer, className }: { offer: CancelOffer; className?: string }) {
  const router = useRouter();
  const plan = offer.planName;
  const free = offer.accessAlreadyFree === true;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<FlowStep>("A");
  const [d, setD] = useState<Draft>(EMPTY);
  const [openTool, setOpenTool] = useState<CancelTool | null>(null);
  const [days, setDays] = useState<ExtensionDays>(7);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // A request sent from here before the page has read it back.
  const [sent, setSent] = useState<{ days: number; at: string } | null>(null);
  const pending = sent ?? offer.extension?.pending ?? null;
  const headRef = useRef<HTMLHeadingElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const set = useCallback((patch: Partial<Draft>) => setD((was) => ({ ...was, ...patch })), []);

  const seq = useMemo(() => sequence(d, offer), [d, offer]);
  const at = Math.max(0, seq.indexOf(step));

  /* Every opening starts fresh on screen A; nothing is kept between openings. */
  const start = () => {
    setD(EMPTY);
    setStep("A");
    setOpenTool(null);
    setDays(7);
    setErr(null);
    setBusy(false);
    setOpen(true);
  };

  // Each screen shown is reported once it is on screen (step + path only).
  useEffect(() => {
    if (!open) return;
    void trackCancelFlow({ kind: "step", step, path: d.path }).catch(() => {});
    // the path is read as it stands when the screen opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  // A new screen starts at its top with its title focused.
  useEffect(() => {
    if (!open) return;
    boxRef.current?.scrollTo({ top: 0 });
    const id = requestAnimationFrame(() => headRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [open, step]);

  /** Closed without cancelling: the one thing written is the event. */
  const leave = useCallback(
    (how: "close" | "keep") => {
      if (busy) return;
      void trackCancelFlow({ kind: "abandoned", step, path: d.path, how }).catch(() => {});
      setOpen(false);
    },
    [busy, step, d.path],
  );
  const close = useCallback(() => leave("close"), [leave]);
  const keep = () => leave("keep");

  const go = (s: FlowStep) => {
    setErr(null);
    setStep(s);
  };
  const next = () => {
    const s = seq[at + 1];
    if (!s) return;
    if (s === "C2" && !openTool) setOpenTool(d.tools[0] ?? null);
    go(s);
  };
  const back = () => {
    const s = seq[at - 1];
    if (s) go(s);
  };

  /* What keeps Continue off on this screen, in words (null = whole). */
  const hint: string | null = (() => {
    if (step === "A") return d.path ? null : "Pick the main reason.";
    if (step === "B1") {
      const c = checkA1(a1Of(d));
      return c.ok ? null : c.error;
    }
    if (step === "B2") {
      const c = checkA2Tools(a2Of(d));
      return c.ok ? null : c.error;
    }
    if (step === "B3") {
      const c = checkA3(a3Of(d));
      return c.ok ? null : c.error;
    }
    if (step === "E_confirm") {
      const c = checkCancelAnswers(payload(d));
      return c.ok ? null : c.error;
    }
    return null;
  })();

  const book = async () => {
    if (busy || hint) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await cancelSubscription(payload(d));
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setOpen(false);
      if (free) toast.success("Billing renewal canceled", "Your account remains on the Free plan.");
      else
        toast.success(
          res.endsAt ? `Your plan switches to Free on ${longDate(res.endsAt)}` : "Your plan switches to Free at the end of this cycle",
          "You won't be billed again. Change your mind any time before then.",
        );
      router.refresh();
    } catch {
      setErr("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const askExtension = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await requestTrialExtension({ days, note: "", answers: a1Of(d) });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      if (res.pending) {
        setSent({ days: res.days, at: res.at });
        return;
      }
      setSent({ days, at: new Date().toISOString() });
      setOpen(false);
      toast.success(REQUEST_SENT_TITLE, REQUEST_SENT_BODY);
      router.refresh();
    } catch {
      setErr("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  /* ── the frame of every screen ── */
  const band = (
    <div className="jffs-band" aria-hidden="true">
      {Object.values(LOSS_TONE).map((t) => (
        <i key={t} data-tone={t} />
      ))}
    </div>
  );
  // "Cancel subscription · 3 of 6"; a phone keeps only "3 of 6" beside Back (cancel-flow.css).
  const kick =
    step === "A" || d.path === null ? (
      "Cancel subscription"
    ) : (
      <>
        <span className="jfcf-kick-long">Cancel subscription · </span>
        {`${at + 1} of ${seq.length}`}
      </>
    );
  const head = (title: string, sub?: ReactNode) => (
    <>
      <div className="jfcf-top">
        {at > 0 ? (
          <button type="button" className="jffs-link jfcf-back" onClick={back} disabled={busy} data-cancel-back="">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M19 12H5" />
              <path d="m11 6-6 6 6 6" />
            </svg>
            Back
          </button>
        ) : null}
        <div className="jf-confirm-kick">{kick}</div>
      </div>
      <h2 className="jf-confirm-h" id="jfcf-title" ref={headRef} tabIndex={-1}>
        {title}
      </h2>
      {sub ? <p className="jffs-lead">{sub}</p> : null}
    </>
  );
  /** The two buttons at the foot: the way back to the plan, and on. */
  /** `pair`: two short labels, side by side on a phone too (the thumb's reach). */
  const foot = (primary: { label: string; onClick: () => void; off?: boolean; attr?: string }, secondary: { label: string; onClick: () => void }, withHint = true, pair = false) => (
    <div className="jfcf-foot">
      {withHint ? (
        <p className="jffs-why-hint" aria-live="polite" data-cancel-hint="">
          {hint ?? ""}
        </p>
      ) : null}
      {err ? (
        <p className="jffs-err" role="alert">
          {err}
        </p>
      ) : null}
      <div className={"jf-confirm-row" + (pair ? " jfcf-pair" : "")}>
        <button type="button" className="jf-confirm-btn" disabled={busy} onClick={secondary.onClick}>
          {secondary.label}
        </button>
        <button type="button" className="jf-confirm-btn primary" disabled={busy || primary.off} onClick={primary.onClick} data-cancel-next={primary.attr ?? ""}>
          {primary.label}
        </button>
      </div>
    </div>
  );
  const keepPlan = { label: "Keep my plan", onClick: keep };
  const cont = { label: "Continue", onClick: next, off: hint !== null };

  /* ── the screens ── */
  let body: ReactNode = null;

  if (step === "A") {
    body = (
      <>
        {head("Before you cancel — what's the main reason?")}
        <fieldset className="jfcf-set" data-cancel-path="">
          <legend className="jfcf-vh">The main reason</legend>
          <div className="jfcf-cards">
            {CANCEL_PATHS.map((p) => (
              <label key={p.key} className="jffs-radio jfcf-card" data-path={p.key}>
                <input type="radio" name="jfcf-path" checked={d.path === p.key} onChange={() => set({ path: p.key })} />
                <span className="jffs-box" aria-hidden="true" />
                <span className="jfcf-card-t">{p.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {foot(cont, keepPlan, true, true)}
      </>
    );
  } else if (step === "B1") {
    body = (
      <>
        {head("What got in the way?")}
        <fieldset className="jfcf-set">
          <legend className="jfcf-vh">What got in the way</legend>
          <p className="jffs-why-sub">Pick all that apply.</p>
          <div className="jffs-why-opts">
            {BLOCKERS.map((b) => (
              <Check key={b.key} on={d.blockers.includes(b.key)} label={b.label} onChange={() => set({ blockers: toggle(d.blockers, b.key) })} />
            ))}
          </div>
          {d.blockers.includes("other") ? (
            <Words id="jfcf-b1-other" label="Tell us what it was" value={d.blockerOther} onChange={(v) => set({ blockerOther: v })} max={LONG_MAX} min={TEXT_MIN} />
          ) : null}
        </fieldset>
        <fieldset className="jfcf-set jfcf-gap">
          <legend className="jffs-ext-lbl">
            What would you try first if you had more time?<span className="jffs-opt-note">Optional</span>
          </legend>
          <div className="jfcf-grid">
            {TRY_TOOLS.map((t) => (
              <Check key={t.key} big on={d.tryFirst.includes(t.key)} label={t.short} onChange={() => set({ tryFirst: toggle(d.tryFirst, t.key) })} />
            ))}
          </div>
        </fieldset>
        {foot(cont, keepPlan, true, true)}
      </>
    );
  } else if (step === "C1") {
    body = pending ? (
      <>
        {head("Request pending")}
        <p className="jffs-keeps" data-trial-ext-pending="">
          {`You asked for ${pending.days} more days on `}
          <b>{longDate(pending.at)}</b>
          {`. ${REQUEST_SENT_BODY} Your ${plan} plan stays as it is meanwhile.`}
        </p>
        {foot({ label: `Keep ${plan}`, onClick: keep }, { label: "No, continue cancelling", onClick: next }, false)}
      </>
    ) : (
      <>
        {head("Want 7 or 14 more days to try it properly?", `We'll set it up for you. Your ${plan} plan stays exactly as it is while we look — ${REQUEST_SENT_BODY.charAt(0).toLowerCase()}${REQUEST_SENT_BODY.slice(1)}`)}
        <fieldset className="jfcf-set jfcf-gap" data-trial-ext-form="">
          <legend className="jfcf-vh">How many more days</legend>
          <div className="jfcf-days">
            {EXTENSION_DAYS.map((n) => (
              <Radio key={n} name="jfcf-days" on={days === n} label={`${n} more days`} onChange={() => setDays(n)} />
            ))}
          </div>
        </fieldset>
        {foot({ label: busy ? "Sending…" : "Request extension", onClick: () => void askExtension(), attr: "extension" }, { label: "No, continue cancelling", onClick: next }, false)}
      </>
    );
  } else if (step === "B2") {
    body = (
      <>
        {head("Which tools didn't work for you?")}
        <fieldset className="jfcf-set">
          <legend className="jfcf-vh">Tools that did not work</legend>
          <p className="jffs-why-sub">Pick all that apply.</p>
          <div className="jfcf-grid">
            {CANCEL_TOOLS.map((t) => (
              <Check
                key={t.key}
                big
                on={d.tools.includes(t.key)}
                label={t.long}
                onChange={() => {
                  const tools = toggle(d.tools, t.key);
                  set({ tools });
                  if (openTool && !tools.includes(openTool)) setOpenTool(null);
                }}
              />
            ))}
            <Check big on={d.toolOtherOn} label="Other" onChange={() => set({ toolOtherOn: !d.toolOtherOn })} />
          </div>
          {d.toolOtherOn ? <Words id="jfcf-b2-other" label="Which one?" value={d.toolOther} onChange={(v) => set({ toolOther: v })} max={LONG_MAX} min={TEXT_MIN} /> : null}
        </fieldset>
        {foot(cont, keepPlan, true, true)}
      </>
    );
  } else if (step === "C2") {
    body = (
      <>
        {head("What went wrong?", "One tool at a time — all optional.")}
        <div className="jfcf-acc" data-cancel-acc="">
          {d.tools.map((t) => {
            const x = d.perTool[t] ?? NO_TOOL;
            const isOpen = openTool === t;
            const put = (patch: Partial<ToolDraft>) => set({ perTool: { ...d.perTool, [t]: { ...x, ...patch } } });
            return (
              <section key={t} className="jfcf-acc-i" data-open={isOpen ? "1" : "0"} data-tool={t}>
                <button type="button" className="jfcf-acc-h" aria-expanded={isOpen} aria-controls={`jfcf-acc-${t}`} onClick={() => setOpenTool(isOpen ? null : t)}>
                  <span className="jfcf-acc-t">{`What was wrong with ${toolLabel(t)}?`}</span>
                  <span className="jfcf-acc-n">{x.problems.length ? `${x.problems.length} picked` : ""}</span>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {isOpen ? (
                  <div className="jfcf-acc-b" id={`jfcf-acc-${t}`}>
                    <fieldset className="jfcf-set">
                      <legend className="jfcf-vh">{`What was wrong with ${toolLabel(t)}`}</legend>
                      <div className="jffs-why-opts">
                        {PROBLEMS.map((p) => (
                          <Check key={p.key} on={x.problems.includes(p.key)} label={p.label} onChange={() => put({ problems: toggle(x.problems, p.key) })} />
                        ))}
                      </div>
                    </fieldset>
                    {x.problems.includes("missing") ? (
                      <Words id={`jfcf-c2-miss-${t}`} label="What's missing?" rows={1} value={x.missing} onChange={(v) => put({ missing: v })} max={TEXT_MAX} optional />
                    ) : null}
                    <Words id={`jfcf-c2-fix-${t}`} label="What would have made it work?" value={x.fix} onChange={(v) => put({ fix: v })} max={LONG_MAX} optional />
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
        {foot(cont, keepPlan, true, true)}
      </>
    );
  } else if (step === "D2") {
    body = (
      <>
        {head("What are you using instead?")}
        <fieldset className="jfcf-set">
          <legend className="jfcf-vh">What you are using instead</legend>
          <div className="jffs-why-opts">
            {INSTEAD.map((o) => (
              <Radio key={o.key} name="jfcf-instead" on={d.instead === o.key} label={o.label} onChange={() => set({ instead: o.key })} />
            ))}
          </div>
          {d.instead === "other_app" ? <Words id="jfcf-d2-app" label="Which app?" rows={1} value={d.insteadApp} onChange={(v) => set({ insteadApp: v })} max={TEXT_MAX} optional /> : null}
        </fieldset>
        <fieldset className="jfcf-set jfcf-gap">
          <legend className="jffs-ext-lbl">If we fixed this, would you give JobFlex another try?</legend>
          <div className="jffs-why-opts">
            {AGAIN.map((o) => (
              <Radio key={o.key} name="jfcf-again" on={d.again === o.key} label={o.label} onChange={() => set({ again: o.key })} />
            ))}
          </div>
          {d.again === "yes" ? (
            <div className="jfcf-follow">
              <Check on={d.emailOk} label="Yes, email me when it's fixed" onChange={() => set({ emailOk: !d.emailOk })} />
            </div>
          ) : null}
        </fieldset>
        {foot(cont, keepPlan, true, true)}
      </>
    );
  } else if (step === "B3") {
    const follow = (k: OtherReason): ReactNode => {
      if (!d.reasons.includes(k)) return null;
      if (k === "too_expensive")
        return (
          <fieldset className="jfcf-set jfcf-follow">
            <legend className="jffs-ext-lbl">
              What would feel fair for what you use?<span className="jffs-opt-note">Per month · optional</span>
            </legend>
            <div className="jfcf-chips">
              {FAIR_PRICES.map((p) => (
                <Radio key={p.key} name="jfcf-fair" on={d.fairPrice === p.key} label={p.label} onChange={() => set({ fairPrice: p.key })} />
              ))}
            </div>
          </fieldset>
        );
      if (k === "not_enough_jobs")
        return (
          <fieldset className="jfcf-set jfcf-follow">
            <legend className="jffs-ext-lbl">
              When do you expect work to pick up?<span className="jffs-opt-note">Optional</span>
            </legend>
            <div className="jfcf-chips">
              {PICKUPS.map((p) => (
                <Radio key={p.key} name="jfcf-pickup" on={d.pickup === p.key} label={p.label} onChange={() => set({ pickup: p.key })} />
              ))}
            </div>
          </fieldset>
        );
      if (k === "switched_tool")
        return (
          <div className="jfcf-follow">
            <Words id="jfcf-b3-which" label="Which one?" rows={1} value={d.switchedWhich} onChange={(v) => set({ switchedWhich: v })} max={TEXT_MAX} optional />
            <Words id="jfcf-b3-better" label="What does it do better?" value={d.switchedBetter} onChange={(v) => set({ switchedBetter: v })} max={LONG_MAX} optional />
          </div>
        );
      if (k === "just_testing")
        return (
          <div className="jfcf-follow">
            <Words id="jfcf-b3-hoped" label="What were you hoping to see?" value={d.testingHoped} onChange={(v) => set({ testingHoped: v })} max={LONG_MAX} optional />
          </div>
        );
      if (k === "other")
        return (
          <div className="jfcf-follow">
            <Words id="jfcf-b3-other" label="Tell us what it was" value={d.otherText} onChange={(v) => set({ otherText: v })} max={LONG_MAX} min={TEXT_MIN} />
          </div>
        );
      return null;
    };
    body = (
      <>
        {head("What's behind it?")}
        <fieldset className="jfcf-set" data-cancel-reasons="">
          <legend className="jfcf-vh">The reasons</legend>
          <p className="jffs-why-sub">Pick all that apply.</p>
          <div className="jffs-why-opts jfcf-reasons">
            {OTHER_REASONS.map((r) => (
              <div key={r.key} className="jfcf-reason" data-on={d.reasons.includes(r.key) ? "1" : "0"}>
                <Check on={d.reasons.includes(r.key)} label={r.label} onChange={() => set({ reasons: toggle(d.reasons, r.key) })} />
                {follow(r.key)}
              </div>
            ))}
          </div>
        </fieldset>
        {foot(cont, keepPlan, true, true)}
      </>
    );
  } else if (step === "E_before") {
    const tiles = freeTallyTiles(offer.tally);
    body = (
      <>
        {head("Before you go")}
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
                <svg viewBox="0 0 24 24">{LOSS_ICON[l.icon]}</svg>
              </span>
              <span className="jffs-li-t">{l.text}</span>
            </li>
          ))}
        </ul>
        <p className="jffs-keeps">
          {`You keep ${plan} until `}
          {offer.keepsUntil ? <b>{longDate(offer.keepsUntil)}</b> : "the end of the cycle you've already paid for"}
          {". After that your account moves to the Free plan — your data stays."}
        </p>
        <div className="jffs-acts">
          <button type="button" className="jf-confirm-btn primary jffs-keepbig" onClick={keep}>
            {`Keep ${plan}`}
          </button>
          <button type="button" className="jffs-link jffs-go" onClick={next} data-cancel-next="go">
            Continue to cancel
          </button>
        </div>
      </>
    );
  } else if (step === "E_confirm") {
    const c = checkCancelAnswers(payload(d));
    body = (
      <>
        {head(free ? "Cancel billing subscription?" : `Cancel ${plan}?`)}
        <p className="jffs-keeps">
          {free ? (
            "Your access is already on the Free plan. Canceling this billing subscription stops future renewal. Your access remains Free."
          ) : (
            <>
              {`You keep ${plan} until `}
              {offer.keepsUntil ? <b>{longDate(offer.keepsUntil)}</b> : "the end of the cycle you've already paid for"}
              {" — the cycle you've already paid for — and you won't be billed again. Then your account moves to the Free plan. Nothing is refunded for the days you don't use."}
            </>
          )}
        </p>
        <p className="jfcf-sum" data-cancel-summary="">
          <span className="jfcf-sum-t">
            <span className="jfcf-sum-k">Reason</span>
            {c.ok ? answersSummary(c.value) : "—"}
          </span>
          {d.path ? (
            <button type="button" className="jffs-link jfcf-edit" disabled={busy} onClick={() => go(FIRST_OF[d.path as CancelPath])}>
              Edit answers
            </button>
          ) : null}
        </p>
        {foot(
          { label: busy ? "Working…" : free ? "Cancel billing subscription" : "Cancel subscription", onClick: () => void book(), off: hint !== null, attr: "book" },
          { label: free ? "Go back" : `Keep ${plan}`, onClick: free ? back : keep },
        )}
      </>
    );
  }

  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" data-cancel-open="" onClick={start}>
        {free ? "Cancel billing subscription" : "Cancel subscription"}
      </button>
      <FrameWindow open={open} onClose={close} labelledBy="jfcf-title" focusRef={headRef} boxRef={boxRef} extraClass="jffs-go-dlg jfcf" >
        {band}
        <div className="jfcf-screen" data-step={step} data-path={d.path ?? ""}>
          {body}
        </div>
      </FrameWindow>
    </>
  );
}
