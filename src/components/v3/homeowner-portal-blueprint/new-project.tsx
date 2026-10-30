"use client";

// START A PROJECT from the home portal, in Blueprint (2026-10-30) —
// /home/[key]/new. The public intake's walk (describe → a few questions →
// the summary a contractor prices from → contact → sent), on the portal's
// own page: the contact step comes filled from the home, and the request
// joins it (homeKey) and fulfils the plan it came from (planId). Same
// actions as the public wizards (actions/homeowner): the questions and the
// summary are written by the server, `submitHomeownerRequest` writes the
// request, routes it and emails the homeowner; the photos go into the new
// request's folder once it exists (use-request-attachments).

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { submitHomeownerRequest, suggestHomeownerQuestions, suggestHomeownerScope } from "@/actions/homeowner";
import { LEAD_CONSENT_MISSING, LEAD_CONSENT_TEXT, consentPageFromLocation } from "@/lib/leadConsent";
import { browserTimeZone, type WizardPrefill } from "@/lib/home/prefill";
import { needsAddressFor } from "@/lib/leadRules";
import { QUESTIONS, categoryOf, type Question } from "@/components/v3/homeowner-landing/homeowner-data";
import { attachmentsLine, useRequestAttachments } from "@/components/v3/homeowner-landing/wizard/use-request-attachments";
import { WIZARD_MAX_FILES } from "@/lib/home/freshRequest";
import s from "./portal.module.css";

/** How long the questions or the summary may keep the homeowner waiting before the page goes on without them. */
const AI_WAIT_MS = 6500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STEP_NAMES = ["Describe", "Questions", "Summary", "Send"];

function capped<T>(work: Promise<T>): Promise<T | null> {
  return Promise.race([work, new Promise<null>((r) => window.setTimeout(() => r(null), AI_WAIT_MS))]).catch(() => null);
}

/** `projectBase`: /home/<key>/project — the new request's page is that plus its token. */
export function NewProject({ prefill, homePath, projectBase }: { prefill: WizardPrefill; homePath: Route; projectBase: string }) {
  const [step, setStep] = React.useState(0);
  const [busy, setBusy] = React.useState<null | "questions" | "scope" | "send">(null);
  const [desc, setDesc] = React.useState(prefill.description);
  const [questions, setQuestions] = React.useState<Question[]>([]);
  const [answers, setAnswers] = React.useState<string[]>([]);
  const [scope, setScope] = React.useState("");
  const [contact, setContact] = React.useState({ name: prefill.name, phone: prefill.phone, address: prefill.address, zip: prefill.zip });
  const [consent, setConsent] = React.useState(false);
  const [error, setError] = React.useState("");
  const [token, setToken] = React.useState<string | null>(null);
  const [over, setOver] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const headRef = React.useRef<HTMLHeadingElement | null>(null);
  const att = useRequestAttachments();

  // Each step starts at its title, for a screen reader and for a thumb.
  React.useEffect(() => {
    headRef.current?.focus({ preventScroll: true });
    headRef.current?.scrollIntoView({ block: "nearest" });
  }, [step]);

  const fullDescription = () => {
    const extra = questions.map((q, i) => ((answers[i] ?? "").trim() ? `${q.q} ${answers[i].trim()}` : "")).filter(Boolean).join("\n");
    return extra ? `${desc.trim()}\n\n${extra}` : desc.trim();
  };

  async function toQuestions() {
    if (!desc.trim() || busy) return;
    setError("");
    setBusy("questions");
    const res = await capped(suggestHomeownerQuestions({ description: desc.trim(), category: null }));
    const qs = res?.questions?.length ? res.questions : QUESTIONS[categoryOf(desc)] ?? QUESTIONS.default;
    setQuestions(qs);
    setAnswers(qs.map(() => ""));
    setBusy(null);
    setStep(1);
  }

  async function toScope() {
    if (busy) return;
    setBusy("scope");
    const answered = questions.map((q, i) => ({ q: q.q, a: (answers[i] ?? "").trim() })).filter((x) => x.a);
    const res = await capped(suggestHomeownerScope({ description: desc.trim(), answers: answered }));
    setScope(res?.scope ?? fullDescription());
    setBusy(null);
    setStep(2);
  }

  async function send() {
    if (busy) return;
    const description = fullDescription();
    if (!contact.name.trim() || !contact.zip.trim()) return setError("Your name and ZIP code are needed to send this to a contractor.");
    if (!EMAIL_RE.test(prefill.email)) return setError("The email on this home doesn't look right — fix it under Details, then send again.");
    if (needsAddressFor(description) && contact.address.trim().length < 5) return setError("This job is measured at the house — please add the street address.");
    if (!consent) return setError(LEAD_CONSENT_MISSING);
    setError("");
    setBusy("send");
    try {
      const res = await submitHomeownerRequest({
        name: contact.name.trim(),
        email: prefill.email,
        phone: contact.phone.trim() || undefined,
        zip: contact.zip.trim(),
        address: contact.address.trim() || undefined,
        scope: scope.trim() || undefined,
        description,
        testKey: new URLSearchParams(window.location.search).get("test")?.trim() || undefined,
        homeKey: prefill.homeKey,
        planId: prefill.planId ?? undefined,
        consent,
        page: consentPageFromLocation(),
        timezone: browserTimeZone() || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setToken(res.requestToken ?? null);
      setStep(4);
      if (res.requestToken) void att.send(res.requestToken);
    } catch {
      setError("That didn't send — check the connection and try again. Nothing you typed was lost.");
    } finally {
      setBusy(null);
    }
  }

  const files = (removable: boolean) =>
    att.items.length > 0 && (
      <ul className={s.progress} aria-label="Your files">
        {att.items.map((u) => (
          <li key={u.id}>
            <span className={s.tileName}>{u.name}</span>
            {u.state === "sent" ? (
              <span className={s.ok}>In the folder</span>
            ) : u.state === "sending" ? (
              <span className={s.meter}><i style={{ width: `${u.progress}%` }} /></span>
            ) : u.state === "failed" ? (
              <span className={s.err} title={u.error}>Didn&apos;t go</span>
            ) : removable ? (
              <button type="button" className={s.btnText} style={{ minHeight: 32, justifySelf: "end" }} onClick={() => att.remove(u.id)} aria-label={`Remove ${u.file.name}`}>Remove</button>
            ) : null}
          </li>
        ))}
      </ul>
    );

  return (
    <section className={s.card} aria-labelledby="wiz-title" data-new-project data-step={step}>
      {step < 4 && (
        <ol className={s.steps} aria-label="Steps">
          {STEP_NAMES.map((n, i) => (
            <li key={n} data-state={i < step ? "done" : i === step ? "now" : "todo"} aria-current={i === step ? "step" : undefined}>{n}</li>
          ))}
        </ol>
      )}

      {step === 0 && (
        <>
          <h1 id="wiz-title" ref={headRef} tabIndex={-1} className={s.h1}>What do you need done?</h1>
          <label className={s.field}>
            <span>Describe it in your words</span>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={5} maxLength={2000} placeholder="My roof is 15 years old and leaking around the chimney after storms…" name="project-description" />
          </label>
          <div
            className={s.drop}
            data-over={over}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              att.add(e.dataTransfer.files);
            }}
          >
            <input ref={fileRef} type="file" accept="image/*,video/*,application/pdf" multiple hidden onChange={(e) => { if (e.target.files) att.add(e.target.files); e.target.value = ""; }} />
            <button type="button" className={s.btn} onClick={() => fileRef.current?.click()} disabled={att.items.length >= WIZARD_MAX_FILES}>Add photos</button>
            <p className={s.muted}>or drop them here — up to {WIZARD_MAX_FILES}. They go to the contractor with the project.</p>
          </div>
          {files(true)}
          {error && <p className={s.err} role="alert">{error}</p>}
          <div className={s.wizFoot}>
            <Link className={s.btnText} href={homePath}>Cancel</Link>
            <button type="button" className={s.btnPrimary} disabled={!desc.trim() || busy !== null} onClick={() => void toQuestions()}>
              {busy === "questions" ? "Reading your description…" : "Continue"}
            </button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div className={s.stack}>
            <h1 id="wiz-title" ref={headRef} tabIndex={-1} className={s.h1}>A few quick questions</h1>
            <p className={s.muted}>Answer what you can — skip what you don&apos;t know. It helps the contractor price it right.</p>
          </div>
          <div>
            {questions.map((q, i) => (
              <div key={i} className={s.question}>
                <label className={s.field}>
                  <span>{q.q}</span>
                  <input value={answers[i] ?? ""} onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))} placeholder={q.hint || undefined} maxLength={500} name={`q-${i}`} autoComplete="off" />
                </label>
                {q.chips && q.chips.length > 0 && (
                  <div className={s.chipRow}>
                    {q.chips.map((c) => (
                      <button key={c} type="button" className={s.idea} aria-pressed={answers[i] === c} onClick={() => setAnswers((a) => a.map((x, j) => (j === i ? c : x)))}>{c}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className={s.wizFoot}>
            <button type="button" className={s.btnText} onClick={() => setStep(0)} disabled={busy !== null}>Back</button>
            <button type="button" className={s.btnPrimary} disabled={busy !== null} onClick={() => void toScope()}>
              {busy === "scope" ? "Writing your summary…" : "Continue"}
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className={s.stack}>
            <h1 id="wiz-title" ref={headRef} tabIndex={-1} className={s.h1}>Check the summary</h1>
            <p className={s.muted}>This is what the contractor reads. Change anything that isn&apos;t right.</p>
          </div>
          <label className={s.field}>
            <span>Summary for the contractor</span>
            <textarea value={scope} onChange={(e) => setScope(e.target.value)} rows={8} maxLength={3000} name="project-scope" />
          </label>
          <div className={s.wizFoot}>
            <button type="button" className={s.btnText} onClick={() => setStep(1)}>Back</button>
            <button type="button" className={s.btnPrimary} onClick={() => setStep(3)}>Looks right</button>
          </div>
        </>
      )}

      {step === 3 && (
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className={s.stack}>
            <h1 id="wiz-title" ref={headRef} tabIndex={-1} className={s.h1}>Where should the contractor come?</h1>
            <p className={s.muted}>Filled in from your home. Change anything for this project.</p>
          </div>
          <div className={s.formRow}>
            <label className={s.field}><span>Name</span><input value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} autoComplete="name" required maxLength={80} name="contact-name" /></label>
            <label className={s.field}><span>Phone</span><input value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} autoComplete="tel" inputMode="tel" maxLength={40} name="contact-phone" /></label>
          </div>
          <div className={`${s.formRow} ${s.formRow3}`}>
            <label className={s.field}><span>Street address{needsAddressFor(fullDescription()) ? "" : " (optional)"}</span><input value={contact.address} onChange={(e) => setContact((c) => ({ ...c, address: e.target.value }))} autoComplete="street-address" maxLength={160} name="contact-address" /></label>
            <label className={s.field}><span>ZIP</span><input value={contact.zip} onChange={(e) => setContact((c) => ({ ...c, zip: e.target.value }))} autoComplete="postal-code" inputMode="numeric" required maxLength={16} name="contact-zip" /></label>
            <label className={s.field}><span>Email</span><input value={prefill.email} readOnly name="contact-email" aria-describedby="email-note" /></label>
          </div>
          <p id="email-note" className={s.fine}>Updates go to {prefill.email}, and the project joins this home.</p>
          <label className={s.check}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} name="consent" />
            <span>{LEAD_CONSENT_TEXT}</span>
          </label>
          {error && <p className={s.err} role="alert">{error}</p>}
          <div className={s.wizFoot}>
            <button type="button" className={s.btnText} onClick={() => setStep(2)} disabled={busy !== null}>Back</button>
            <button type="submit" className={s.btnPrimary} disabled={busy !== null}>{busy === "send" ? "Sending…" : "Send to a contractor"}</button>
          </div>
        </form>
      )}

      {step === 4 && (
        <>
          <div className={s.stack}>
            <p className={s.kicker}>Sent</p>
            <h1 id="wiz-title" ref={headRef} tabIndex={-1} className={s.h1}>Your project is on its way</h1>
            <p className={s.text}>We&apos;re finding a local contractor for it now. You&apos;ll get an email when one takes it — and it&apos;s already on your home page.</p>
          </div>
          {files(false)}
          {attachmentsLine(att) && <p className={s.muted} role="status">{attachmentsLine(att)}</p>}
          <div className={s.actions}>
            {token ? <Link className={s.btnPrimary} href={`${projectBase}/${encodeURIComponent(token)}` as Route}>Open the project</Link> : null}
            <Link className={token ? s.btn : s.btnPrimary} href={homePath}>Back to your home</Link>
          </div>
        </>
      )}
    </section>
  );
}
