"use client";

// FINISH SETTING UP YOUR COMPANY (owner, 2026-11-12; lib/phoneSetup). The one screen a shop that signed up by text owes
// before the app is its own: the company email — required, prefilled with the address Stripe's card page took — the
// office phone (the proven number) and the company name (the owner's own name for now). Mounted by the dashboard
// layout outside the shell, so the desk and the handheld trees both carry it, on every page until it is saved.
//
// Hand-rolled like the other in-house dialogs (company-name-gate): a bottom sheet at ≤768px (the --msheet-* geometry),
// a framed panel above it. Nothing closes it but the save: no scrim tap, no Escape, the focus kept inside.
import * as React from "react";
import { useRouter } from "next/navigation";
import { finishPhoneSetup, type PhoneSetupField } from "@/actions/phoneSetup";
import { typingUsPhone } from "@/lib/phoneLoginShared";
import s from "./phone-setup-sheet.module.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PhoneSetupSheet({ view }: { view: { companyName: string; email: string; officePhone: string } }) {
  const router = useRouter();
  const [companyName, setCompanyName] = React.useState(view.companyName);
  const [email, setEmail] = React.useState(view.email);
  const [officePhone, setOfficePhone] = React.useState(typingUsPhone(view.officePhone));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<{ text: string; field?: PhoneSetupField } | null>(null);
  const [on, setOn] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const boxRef = React.useRef<HTMLFormElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const id = requestAnimationFrame(() => {
      setOn(true);
      emailRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, []);

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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const em = email.trim();
    if (!companyName.trim()) return setErr({ text: "Type your company name.", field: "companyName" });
    if (!em) return setErr({ text: "Enter your company email.", field: "email" });
    if (!EMAIL_RE.test(em)) return setErr({ text: "Enter a valid email address.", field: "email" });
    setBusy(true);
    setErr(null);
    const res = await finishPhoneSetup({ companyName, email: em, officePhone }).catch(() => ({ ok: false as const, error: "Couldn't save. Try again in a minute.", field: undefined }));
    if (!res.ok) {
      setBusy(false);
      setErr({ text: res.error, field: res.field });
      if (res.field) document.getElementById(`pss-${res.field}`)?.focus();
      return;
    }
    setOn(false);
    window.setTimeout(() => {
      setDone(true);
      router.refresh();
    }, 220);
  }

  if (done) return null;
  const bad = (f: PhoneSetupField) => (err?.field === f ? true : undefined);

  return (
    <div className={`${s.layer}${on ? ` ${s.on}` : ""}`} data-phone-setup="" onKeyDown={onKeyDown}>
      <div className={s.scrim} aria-hidden="true" />
      <form ref={boxRef} className={s.box} role="dialog" aria-modal="true" aria-labelledby="pssTitle" aria-describedby="pssLede" noValidate onSubmit={(e) => void save(e)}>
        <span className={s.grab} aria-hidden="true" />
        <p className={s.kick}>One last step</p>
        <h2 className={s.h} id="pssTitle">
          Finish setting up your company
        </h2>
        <p className={s.p} id="pssLede">
          Your company email gets receipts and client replies, and you can sign in with it too.
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
        <button type="submit" className={s.go} id="pssSave" disabled={busy}>
          {busy ? "Saving…" : "Save and continue"}
        </button>
      </form>
    </div>
  );
}
