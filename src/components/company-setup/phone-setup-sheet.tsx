"use client";

// FINISH SETTING UP YOUR COMPANY (owner, 2026-11-12; lib/phoneSetup). The one screen a shop that signed up by text owes
// before the app is its own: the company email — required, prefilled with the address Stripe's card page took — the
// office phone (the proven number) and the company name (the owner's own name for now). The email is proven before
// the screen saves: "Send code" mails six digits to it (the sign-up's own letter and brakes), the code screen takes
// them, "Use a different email" goes back to the form, "Resend code" after 30 s (actions/phoneSetup, lib/emailProof).
// Mounted by the dashboard layout outside the shell, so the desk and the handheld trees both carry it, on every page
// until it is saved.
//
// Hand-rolled like the other in-house dialogs (company-name-gate): a bottom sheet at ≤768px (the --msheet-* geometry),
// a framed panel above it. Nothing closes it but the save: no scrim tap, no Escape, the focus kept inside.
import * as React from "react";
import { useRouter } from "next/navigation";
import { confirmPhoneSetup, resendPhoneSetupCode, sendPhoneSetupCode, type PhoneSetupField } from "@/actions/phoneSetup";
import { typingUsPhone } from "@/lib/phoneLoginShared";
import { OtpCodeField } from "@/components/auth/otp-code-field";
import s from "./phone-setup-sheet.module.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TROUBLE = "Couldn't save. Try again in a minute.";
/** The browser's clock, read in the handlers (the resend countdown). */
const clock = () => Date.now();

export function PhoneSetupSheet({ view }: { view: { companyName: string; email: string; officePhone: string; released?: boolean } }) {
  const router = useRouter();
  const [companyName, setCompanyName] = React.useState(view.companyName);
  const [email, setEmail] = React.useState(view.email);
  const [officePhone, setOfficePhone] = React.useState(typingUsPhone(view.officePhone));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<{ text: string; field?: PhoneSetupField } | null>(null);
  const [on, setOn] = React.useState(false);
  const [done, setDone] = React.useState(false);
  /* The code step: the draft the server keeps, where it went, and the resend clock. */
  const [sent, setSent] = React.useState<{ draft: string; email: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [resendAt, setResendAt] = React.useState(0);
  const [now, setNow] = React.useState(0);
  const [note, setNote] = React.useState<string | null>(null);
  const boxRef = React.useRef<HTMLFormElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const codeRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const id = requestAnimationFrame(() => {
      setOn(true);
      emailRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, []);
  React.useEffect(() => {
    if (!sent || resendAt <= clock()) return;
    const t = window.setInterval(() => setNow(clock()), 1000);
    return () => window.clearInterval(t);
  }, [sent, resendAt, now]);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  /* The focus stays in the sheet: Tab past the last control comes back to the first. */
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      return;
    }
    if (e.key !== "Tab" || !boxRef.current) return;
    const items = Array.from(boxRef.current.querySelectorAll<HTMLElement>("input, button:not([disabled])"));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const form = () => ({ companyName, email: email.trim(), officePhone });
  function refuse(res: { error: string; field?: PhoneSetupField }) {
    setErr({ text: res.error, field: res.field });
    if (res.field && res.field !== "code") document.getElementById(`pss-${res.field}`)?.focus();
    if (res.field === "code") window.setTimeout(() => codeRef.current?.focus(), 30);
  }

  /* Step one: the form checked here and on the server, then the code goes out. */
  async function sendCodeNow() {
    const em = email.trim();
    if (!companyName.trim()) return refuse({ error: "Type your company name.", field: "companyName" });
    if (!em) return refuse({ error: "Enter your company email.", field: "email" });
    if (!EMAIL_RE.test(em)) return refuse({ error: "Enter a valid email address.", field: "email" });
    setBusy(true);
    setErr(null);
    const res = await sendPhoneSetupCode(form()).catch(() => ({ ok: false as const, error: TROUBLE, field: undefined }));
    setBusy(false);
    if (!res.ok) return refuse(res);
    if ("done" in res) return finish();
    setSent({ draft: res.draft, email: res.email });
    setResendAt(res.resendAt);
    setNow(clock());
    setCode("");
    setNote(null);
    window.setTimeout(() => codeRef.current?.focus(), 60);
  }

  /* Step two: the six digits — sent by themselves on the sixth, or with the button. */
  async function confirm(value: string) {
    if (!sent || busy || value.length !== 6) return;
    setBusy(true);
    setErr(null);
    const res = await confirmPhoneSetup({ ...form(), draft: sent.draft, code: value }).catch(() => ({ ok: false as const, error: TROUBLE, field: undefined }));
    if (!res.ok) {
      setBusy(false);
      setCode("");
      if (res.field === "email") setSent(null);
      return refuse(res);
    }
    finish();
  }

  function finish() {
    setOn(false);
    window.setTimeout(() => {
      setDone(true);
      router.refresh();
    }, 220);
  }

  async function resend() {
    if (!sent || busy || resendIn > 0) return;
    setBusy(true);
    setErr(null);
    const res = await resendPhoneSetupCode(sent.draft).catch(() => ({ ok: false as const, error: TROUBLE, field: undefined, resendAt: undefined }));
    setBusy(false);
    if (!res.ok) {
      if (res.resendAt) setResendAt(res.resendAt);
      return refuse({ error: res.error, field: "code" });
    }
    setResendAt(res.resendAt);
    setNow(clock());
    setCode("");
    setNote(`A new code is on its way to ${sent.email}. The one before it no longer works.`);
    window.setTimeout(() => codeRef.current?.focus(), 30);
  }

  function differentEmail() {
    setSent(null);
    setCode("");
    setErr(null);
    setNote(null);
    window.setTimeout(() => {
      emailRef.current?.focus();
      emailRef.current?.select();
    }, 30);
  }

  if (done) return null;
  const bad = (f: PhoneSetupField) => (err?.field === f ? true : undefined);

  return (
    <div className={`${s.layer}${on ? ` ${s.on}` : ""}`} data-phone-setup={sent ? "code" : "form"} onKeyDown={onKeyDown}>
      <div className={s.scrim} aria-hidden="true" />
      <form
        ref={boxRef}
        className={s.box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pssTitle"
        aria-describedby="pssLede"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (sent) void confirm(code);
          else void sendCodeNow();
        }}
      >
        <span className={s.grab} aria-hidden="true" />
        <p className={s.kick}>One last step</p>
        <h2 className={s.h} id="pssTitle">
          {sent ? "Confirm your company email" : "Finish setting up your company"}
        </h2>

        {sent ? (
          <>
            <p className={s.p} id="pssLede">
              We sent a 6-digit code to <b className={s.addr} id="pssSentTo">{sent.email}</b>.
            </p>
            <div className={s.codeWrap}>
              <OtpCodeField
                id="pssCode"
                ref={codeRef}
                labelClassName={s.lbl}
                messageId="pssCodeNote"
                value={code}
                onChange={(digits) => {
                  setCode(digits);
                  if (err && digits.length) setErr(null);
                  if (digits.length === 6) void confirm(digits);
                }}
                message={err?.text ?? note}
                invalid={Boolean(err)}
                disabled={busy && code.length === 6}
              />
            </div>
            <button type="submit" className={s.go} id="pssSave" disabled={busy || code.length !== 6}>
              {busy && code.length === 6 ? "Checking…" : "Confirm and save"}
            </button>
            <div className={s.links}>
              <button type="button" className={s.quiet} id="pssResend" onClick={() => void resend()} disabled={busy || resendIn > 0}>
                {resendIn > 0 ? `Resend code in ${resendIn} s` : "Resend code"}
              </button>
              <button type="button" className={s.quiet} id="pssOther" onClick={differentEmail} disabled={busy && code.length === 6}>
                Use a different email
              </button>
            </div>
            <p className={s.hint}>Didn&apos;t get it? Check spam, or use a different email.</p>
          </>
        ) : (
          <>
            <p className={s.p} id="pssLede">
              {view.released
                ? "The email you gave at checkout was confirmed by its owner on another account. Enter your own — we'll send it a code."
                : "Your company email gets receipts and client replies, and you'll sign in with it too. We'll send it a code to confirm it."}
            </p>
            <label className={s.fld}>
              <span className={s.lbl}>
                Company email <span className={s.req}>Required</span>
              </span>
              <input
                ref={emailRef}
                className={s.in}
                id="pss-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@yourshop.com"
                value={email}
                maxLength={200}
                required
                aria-invalid={bad("email")}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className={s.fld}>
              <span className={s.lbl}>Company name</span>
              <input
                className={s.in}
                id="pss-companyName"
                autoComplete="organization"
                value={companyName}
                maxLength={120}
                aria-invalid={bad("companyName")}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </label>
            <label className={s.fld}>
              <span className={s.lbl}>Office phone</span>
              <input
                className={s.in}
                id="pss-officePhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="(555) 123-4567"
                value={officePhone}
                aria-invalid={bad("officePhone")}
                onChange={(e) => setOfficePhone(typingUsPhone(e.target.value))}
              />
            </label>
            <p className={err ? s.err : s.errHidden} role="alert" id="pssErr">
              {err?.text}
            </p>
            <button type="submit" className={s.go} id="pssSend" disabled={busy}>
              {busy ? "Sending code…" : "Send code"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
