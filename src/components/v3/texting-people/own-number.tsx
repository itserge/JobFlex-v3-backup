"use client";

// THE COMPANY'S OWN TEXTING NUMBER (2026-10-02) — the inside of the Texting
// page's "Your number" step, on the desk and the phone.
//
// Owner: "contractors can use it for their own SMS … JobFlex will pay it".
// A toll-free number bought on JobFlex's Twilio account and registered with
// the carriers in the company's name (lib/sms/registration). The card walks
// the states: get one (paid plans) → the business form → waiting for Twilio →
// approved, or sent back with Twilio's reasons and the form again.
//
// THE INSIDE, FOR CLARITY (2026-10-18): the number first, as a plate — the
// number, its state, and what it does today (calls, texts) with a square in
// the state's colour; what went wrong in one callout with Twilio's reasons;
// what JobFlex does for you with its one button at its foot; the form in four
// labelled groups with the booking blocker and the consent where you send it;
// releasing the number apart, at the bottom. Styles: ./texting-kit.css.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { checkSmsRegistration, releaseSmsNumber, submitSmsRegistration, type SmsActionResult } from "@/actions/sms";
import {
  assignedLineWords,
  BUSINESS_TYPES,
  EMPTY_DETAILS,
  isFreeMailbox,
  REGISTRATION_COPY as C,
  registrationProblems,
  type SmsBusinessType,
  type SmsRegistrationDetails,
  type SmsRegistrationView,
} from "@/lib/sms/registrationShared";
import "./texting-kit.css";

type FieldKey = Exclude<keyof SmsRegistrationDetails, "businessType" | "showEmail">;
type Span = 1 | 2 | 3 | 4 | 6;
type FieldDef = { key: FieldKey; label: string; span: Span; type?: string; auto?: string; hint?: string };
const FIELDS: Record<FieldKey, FieldDef> = {
  legalName: { key: "legalName", label: "Legal business name", span: 4, auto: "organization" },
  dba: { key: "dba", label: "Name your clients know", span: 4, auto: "organization" },
  ein: { key: "ein", label: "EIN", span: 2, hint: "12-3456789" },
  street: { key: "street", label: "Street address", span: 4, auto: "address-line1" },
  street2: { key: "street2", label: "Suite or unit", span: 2, auto: "address-line2" },
  city: { key: "city", label: "City", span: 3, auto: "address-level2" },
  state: { key: "state", label: "State", span: 1, auto: "address-level1", hint: "WA" },
  zip: { key: "zip", label: "ZIP", span: 2, auto: "postal-code" },
  website: { key: "website", label: "Website", span: 6, type: "url", auto: "url" },
  social: { key: "social", label: "Facebook, Instagram, Google or Yelp page (optional)", span: 6, type: "url" },
  contactFirst: { key: "contactFirst", label: "Contact first name", span: 3, auto: "given-name" },
  contactLast: { key: "contactLast", label: "Contact last name", span: 3, auto: "family-name" },
  contactEmail: { key: "contactEmail", label: "Contact email", span: 3, type: "email", auto: "email" },
  contactPhone: { key: "contactPhone", label: "Contact phone", span: 3, type: "tel", auto: "tel" },
};
/** The form in the order a contractor fills it, in four labelled groups. */
const GROUPS: readonly { title: string; keys: readonly FieldKey[]; kind?: boolean; showEmail?: boolean }[] = [
  { title: "Business", keys: ["legalName", "dba", "ein"], kind: true },
  { title: "Address", keys: ["street", "street2", "city", "state", "zip"] },
  { title: "Contact", keys: ["contactFirst", "contactLast", "contactEmail", "contactPhone"] },
  { title: "Online", keys: ["website", "social"], showEmail: true },
];

const STAGE_TAG: Record<SmsRegistrationView["stage"], string> = {
  none: "",
  pending: "with Twilio",
  approved: "sending",
  rejected: "sent back",
  failed: "not sent",
};
const STAGE_TONE: Record<SmsRegistrationView["stage"], "ok" | "wait" | "bad" | undefined> = {
  none: undefined,
  pending: "wait",
  approved: "ok",
  rejected: "bad",
  failed: "bad",
};

export function OwnNumber({ view, configured }: { view: SmsRegistrationView | null; configured: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<SmsRegistrationDetails>(view?.details ?? EMPTY_DETAILS);
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  if (!view) return null;

  const run = async (label: string, fn: () => Promise<SmsActionResult>, after?: () => void) => {
    setBusy(label);
    setNote("");
    setErr("");
    try {
      const r = await fn();
      if (r.ok) {
        setNote(r.note ?? "Done.");
        after?.();
        router.refresh();
      } else setErr(r.error);
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : "Couldn't reach JobFlex. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const problems = registrationProblems(d);
  const fresh = view.stage === "none" || view.stage === "failed";
  // The line JobFlex lent for calls (2026-10-14): shown as the number until the company registers one.
  const lent = fresh && !view.number && !view.legacy && view.assigned ? assignedLineWords(view.assigned) : null;
  const formOpen = fresh ? open : view.stage === "rejected" && view.canEdit;
  const set = (k: keyof SmsRegistrationDetails, v: string) => setD((x) => ({ ...x, [k]: v }));
  const send = () => {
    setTried(true);
    if (Object.keys(problems).length) {
      setErr("Fix the marked fields first.");
      return;
    }
    void run("submit", () => submitSmsRegistration(d), () => {
      setOpen(false);
      setTried(false);
    });
  };

  const showDone = view.stage === "none" && !open && !view.legacy && !view.assigned?.house;
  const showGet = fresh && !open && !view.legacy;
  const getButton = view.paying ? (
    <button type="button" className="tk-btn tk-btn--primary" disabled={!configured || busy !== null} onClick={() => setOpen(true)} data-get-number data-tour="texting:get-number">
      {view.stage === "failed" ? C.resubmit : lent ? lent.button : C.get}
    </button>
  ) : (
    <p className="tk-note" data-sms-paid-only data-tour="texting:get-number">{C.paidOnly}</p>
  );
  // What went wrong, in one place: the stage's words, Twilio's reasons, the error.
  const trouble = view.stage === "rejected" || view.stage === "failed" || view.legacy;
  const showCheck = view.stage === "pending";
  const showRelease = Boolean(view.number) && (view.stage !== "none" || view.legacy);
  const textsOn = view.stage === "approved" ? "1" : view.stage === "pending" ? "wait" : "0";

  return (
    <div className="jf-tx tk-own" data-own-number data-nest="" data-stage={view.stage} data-assigned={lent ? (view.assigned?.house ? "house" : view.assigned?.jobflexOwn ? "jobflex" : view.assigned?.registrable ? "registrable" : "local") : undefined}>
      {!configured ? (
        <p className="tk-callout" data-tone="wait" data-sms-not-configured>
          {C.notConfigured}
        </p>
      ) : null}

      {lent && view.assigned ? (
        <div className="tk-plate" data-number-plate>
          <div className="tk-plateH">
            <span className="tk-num">{view.assigned.number}</span>
            <span className="tk-tag" data-tone={view.assigned.house ? "ok" : undefined}>{lent.tag}</span>
          </div>
          <ul className="tk-uses" data-number-uses>
            <li data-use="calls" data-on="1">
              <i aria-hidden="true" />
              <b>{C.usesCalls}</b>
              <span>{lent.calls}</span>
            </li>
            <li data-use="texts" data-on={view.assigned.house ? "1" : "0"}>
              <i aria-hidden="true" />
              <b>{C.usesTexts}</b>
              <span>{lent.texts}</span>
            </li>
          </ul>
          <p className="tk-note" data-assigned-keep>{lent.keep}</p>
        </div>
      ) : null}

      {view.number ? (
        <div className="tk-plate" data-number-plate>
          <div className="tk-plateH">
            <span className="tk-num">{view.number}</span>
            {STAGE_TAG[view.stage] ? (
              <span className="tk-tag" data-tone={STAGE_TONE[view.stage]}>
                {STAGE_TAG[view.stage]}
              </span>
            ) : null}
          </div>
          {/* What the number does right now (2026-10-13): calls from the day it is bought, texts once the carriers approve. */}
          <ul className="tk-uses" data-number-uses>
            <li data-use="calls" data-on={view.calls.on && view.calls.go !== "none" ? "1" : "0"}>
              <i aria-hidden="true" />
              <b>{C.usesCalls}</b>
              <span>{!view.calls.on ? C.callsOff : view.calls.go === "assistant" ? C.callsAssistant : view.calls.go === "phone" ? C.callsPhone(view.calls.phone ?? "") : C.callsNone}</span>
            </li>
            <li data-use="texts" data-on={textsOn}>
              <i aria-hidden="true" />
              <b>{C.usesTexts}</b>
              <span>{view.stage === "approved" ? C.textsOn : view.stage === "pending" ? C.textsPending : view.stage === "rejected" ? C.textsRejected : view.legacy ? C.textsLegacy : C.textsFailed}</span>
            </li>
          </ul>
          {/* Pending: the Texts line above already says it (and the page's status line the email alerts) — C.pending is
              said only where no number is shown yet (below). */}
          {view.stage === "approved" ? <p className="tk-note">{C.approved}</p> : null}
          {showCheck ? (
            <div className="tk-acts">
              <button type="button" className="tk-btn" disabled={busy !== null} onClick={() => run("check", checkSmsRegistration)}>
                {busy === "check" ? "Asking Twilio…" : C.check}
              </button>
            </div>
          ) : null}
        </div>
      ) : view.stage === "pending" ? (
        <div className="tk-acts">
          <p className="tk-note">{C.pending}</p>
          <button type="button" className="tk-btn" disabled={busy !== null} onClick={() => run("check", checkSmsRegistration)}>
            {busy === "check" ? "Asking Twilio…" : C.check}
          </button>
        </div>
      ) : null}

      {trouble ? (
        <div className="tk-callout" data-tone="bad" data-sms-trouble>
          {view.stage === "rejected" ? <b>{view.canEdit ? C.rejected : C.rejectedClosed}</b> : null}
          {view.stage === "failed" ? <b>{C.failed}</b> : null}
          {view.legacy ? <span>{C.legacy}</span> : null}
          {view.stage === "rejected" && view.reasons.length ? (
            <ul>
              {view.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          {view.error && (view.stage === "failed" || view.stage === "rejected") ? <span className="tk-callErr">{view.error}</span> : null}
        </div>
      ) : null}

      {showDone ? (
        <div className="tk-done" data-sms-done-for-you>
          <h3>{C.doneTitle}</h3>
          <ul>
            {(lent && view.assigned?.registrable && !view.assigned.jobflexOwn ? [C.doneRegisters(view.assigned.number), ...C.done.slice(1)] : C.done).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <div className="tk-doneF">
            <p className="tk-note">{C.doneYou}</p>
            {showGet ? getButton : null}
          </div>
        </div>
      ) : showGet ? (
        <div className="tk-acts">{getButton}</div>
      ) : null}

      {formOpen ? (
        <form
          className="tk-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          data-sms-form
        >
          <p className="tk-callout">{C.formIntro}</p>
          {GROUPS.map((g) => (
            <fieldset key={g.title} className="tk-fs">
              <legend>{g.title}</legend>
              <div className="tk-grid">
                {g.kind ? (
                  <label className={`tk-field is-s2${problems.businessType && tried ? " is-bad" : ""}`}>
                    <span className="tk-label">Kind of business</span>
                    <select className="tk-input" value={d.businessType} onChange={(e) => setD((x) => ({ ...x, businessType: e.target.value as SmsBusinessType }))}>
                      {BUSINESS_TYPES.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {g.keys.map((k) => {
                  const f = FIELDS[k];
                  return (
                    <label key={f.key} className={`tk-field is-s${f.span}${problems[f.key] && tried ? " is-bad" : ""}`}>
                      <span className="tk-label">
                        {f.label}
                        {f.key === "ein" && d.businessType === "SOLE_PROPRIETOR" ? " (if you have one)" : ""}
                      </span>
                      <input
                        className="tk-input"
                        type={f.type ?? "text"}
                        value={d[f.key]}
                        placeholder={f.hint}
                        autoComplete={f.auto ?? "off"}
                        inputMode={f.key === "zip" || f.key === "ein" ? "numeric" : undefined}
                        onChange={(e) => set(f.key, e.target.value)}
                      />
                      {problems[f.key] && tried ? <span className="tk-why">{problems[f.key]}</span> : null}
                      {f.key === "contactEmail" && isFreeMailbox(d.contactEmail) ? <span className="tk-hint">{C.freeMail}</span> : null}
                      {f.key === "website" ? <span className="tk-hint">{C.website}</span> : null}
                      {f.key === "social" ? <span className="tk-hint">{C.social}</span> : null}
                    </label>
                  );
                })}
                {/* A Gmail or Yahoo address passes only when the business's website lists it (30482, 2026-10-13). */}
                {g.showEmail ? (
                  <label className="tk-check">
                    <input type="checkbox" checked={d.showEmail} onChange={(e) => setD((x) => ({ ...x, showEmail: e.target.checked }))} data-sms-show-email />
                    <span>
                      <b>{C.showEmail}</b>
                      <span className="tk-hint"> — {C.showEmailWhy}</span>
                    </span>
                  </label>
                ) : null}
              </div>
            </fieldset>
          ))}
          <div className="tk-formF">
            <p className="tk-note">{C.consent}</p>
            {/* What Twilio is handed besides this form — each one opens, so the owner sees it as the reviewer will. */}
            <p className="tk-note" data-sms-twilio-sees>
              {C.whatTwilioSees}{" "}
              <a href={view.pages.booking} target="_blank" rel="noreferrer">Booking page</a> ·{" "}
              <a href={view.pages.optInImage} target="_blank" rel="noreferrer">Checkbox picture</a> ·{" "}
              <a href={view.pages.terms} target="_blank" rel="noreferrer">Texting terms</a> ·{" "}
              <a href={view.pages.privacy} target="_blank" rel="noreferrer">Privacy policy</a>
            </p>
            {/* Booking is the opt-in Twilio looks at (2026-10-12): with it off the review fails, so the form waits — said beside the button it holds back. */}
            {!view.bookingOn ? (
              <p className="tk-callout" data-tone="bad" data-sms-booking-off>
                {C.bookingOff}
              </p>
            ) : null}
            <div className="tk-acts">
              <button type="submit" className="tk-btn tk-btn--primary" disabled={busy !== null || !configured || !view.bookingOn} data-tour="texting:register">
                {busy === "submit" ? "Sending to Twilio…" : view.stage === "rejected" ? C.resubmit : C.submit}
              </button>
              {fresh ? (
                <button type="button" className="tk-btn" disabled={busy !== null} onClick={() => setOpen(false)}>
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </form>
      ) : null}

      {showRelease ? (
        <div className="tk-release" data-sms-release>
          {confirming ? (
            <>
              <button type="button" className="tk-btn tk-btn--danger" disabled={busy !== null} onClick={() => run("release", releaseSmsNumber, () => setConfirming(false))}>
                Yes, release it
              </button>
              <button type="button" className="tk-btn" disabled={busy !== null} onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button type="button" className="tk-btn" disabled={busy !== null} onClick={() => setConfirming(true)}>
              {C.release}
            </button>
          )}
        </div>
      ) : null}

      {note ? <p className="tk-msg" role="status">{note}</p> : null}
      {err ? <p className="tk-msg is-err" role="alert">{err}</p> : null}
    </div>
  );
}
