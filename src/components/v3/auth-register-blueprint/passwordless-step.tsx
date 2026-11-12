"use client";

// STEP 1 OF THE PASSWORDLESS SIGN-UP (owner, 2026-10-10; lib/signupOtp).
//
//   form  — "7-DAY FREE TRIAL": Google on top, then name and email; the
//           trial's terms under Continue, in the words of signupTrialMode and
//           the trial offer this visitor was assigned.
//   code  — "We sent a 6-digit code to your email" (owner, 2026-10-12): the
//           address and Use a different email, six squares that are one
//           field (OtpCodeField: numeric keypad, the phone's one-time-code
//           fill, paste), sent by itself on the sixth digit, Continue; a line
//           under the squares only for an error; at the foot Resend after
//           30 s and "Check spam". Top-anchored under the stepper, so the
//           heading, squares and Continue clear a phone's keyboard.
//   google— back from Google: nothing left to ask, the plan step follows.
//
// NOTHING IS LOST on the way to the mail app and back (Meta's in-app browser
// throws pages away): the draft lives on the server, its token in a cookie
// and in the address (?d=), the name, email and screen in session- and
// localStorage; the page reopens on the screen it was left on. The code is
// never kept on this side. While the code screen waits it asks the server how
// the draft stands — the email's button may have been pressed in another
// browser — on a timer, on coming back to the tab and on a bfcache restore.
//
// IN AN IN-APP BROWSER Google refuses to sign in ("403 disallowed_useragent"),
// so its button hands the page to Safari / Chrome with the progress in the
// address and `google=1`, where Google starts at once. When the hand-off does
// not happen, the app-menu help and Copy link show, and email stays below.
//
// The markup wears register-content's classes (`.bp` scope); this file's
// stylesheet only restyles the fields (white inputs, larger labels — owner's
// brief, section H) inside `.otp`, so the password sign-up is untouched.
import * as React from "react";
import type { AdTool } from "@/lib/planSpotlight";
import Link from "next/link";
import type { Route } from "next";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import type { InAppBrowser } from "@/lib/inAppBrowser";
import type { TradeType } from "@/lib/tradeTypes";
import type { UtmParams } from "@/components/v3/landing-e/landing-variants";
import type { OtpRestore } from "@/lib/signupOtp";
import { rememberOtpDraft, rememberSignupMode } from "@/lib/signupMode";
import { trackTraffic } from "@/lib/traffic-client";
import { setSignupPosition, signupProblem } from "@/lib/signup-watch";
import { reasonOfMessage } from "@/lib/signup-watch-shared";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import {
  forgetOtpDraft,
  otpDraftStatus,
  resendOtpCode,
  startOtpGoogleSignup,
  startOtpSignup,
  startQuickSignup,
  verifyOtpCode,
} from "@/actions/signupOtp";
import { KeyboardBridge, OtpCodeField, useKeepInView } from "@/components/auth/otp-code-field";
import css from "./passwordless.module.css";
import { markQaVisitor } from "@/lib/qaEmail";
import { trackMetaLeadOnce } from "@/lib/metaLead";
import { autoPlanAmount, type AutoPlanOffer } from "@/lib/signupAutoPlan";
import { CARD_HOLD_NOTICE } from "@/lib/signupCardHoldWords";

type Screen = "form" | "code" | "google" | "done";
const STORE_KEY = "jf_otp_signup";
const STORE_TTL_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 4000;
const SERVER_TROUBLE = "Something went wrong on our side. Try again in a minute.";

interface Stored {
  v: 1;
  at: number;
  name: string;
  email: string;
  screen: "form" | "code";
  draft: string | null;
}
function readStored(): Stored | null {
  for (const store of ["localStorage", "sessionStorage"] as const) {
    try {
      const raw = window[store].getItem(STORE_KEY);
      if (!raw) continue;
      const v = JSON.parse(raw) as Stored;
      if (v?.v === 1 && Date.now() - v.at < STORE_TTL_MS) return v;
    } catch {
      /* storage blocked or garbled */
    }
  }
  return null;
}
function writeStored(v: Omit<Stored, "v" | "at"> | null) {
  for (const store of ["localStorage", "sessionStorage"] as const) {
    try {
      if (v) window[store].setItem(STORE_KEY, JSON.stringify({ v: 1, at: Date.now(), ...v }));
      else window[store].removeItem(STORE_KEY);
    } catch {
      /* storage blocked: the server's draft still holds */
    }
  }
}
/** The address bar, with `d` set or removed — the rest of the query (trade,
 *  utm_*, fbclid, ref, flow) stays as it came. */
function setDraftInUrl(draft: string | null) {
  try {
    const url = new URL(window.location.href);
    if (draft) url.searchParams.set("d", draft);
    else url.searchParams.delete("d");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  } catch {
    /* the cookie still names the draft */
  }
}

export function PasswordlessStep({
  name,
  setName,
  email,
  setEmail,
  restore,
  google,
  inApp,
  requiresCard,
  auto = null,
  quick = false,
  planMode = "pick",
  trialDays,
  industry,
  tool = null,
  utm,
  attribution,
  analytics,
  fbclid,
  initialError,
  onGoogle,
  onVerified,
}: {
  name: string;
  setName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  restore: OtpRestore | null;
  /** A Google identity parked by the auth callback (?gsu=). */
  google: { handle: string; email: string } | null;
  inApp: InAppBrowser | null;
  requiresCard: boolean;
  /** Straight to Professional (lib/signupAutoPlan): the plan step 1 names, then the card page for it. */
  auto?: AutoPlanOffer | null;
  /** …with a card: no code — Continue goes on to the card page (startQuickSignup). */
  quick?: boolean;
  planMode?: "auto" | "pick";
  trialDays: number;
  industry: TradeType | null;
  /** The tool the visitor came for (lib/planSpotlight) — rides the draft so the return link keeps marking it. */
  tool?: AdTool | null;
  utm: UtmParams | null;
  attribution: { kind: "promo" | "ref"; code: string } | null;
  analytics: () => unknown;
  /** The ad's click id from the page address, for the emailed button's return. */
  fbclid?: string;
  initialError: string | null;
  onGoogle: () => void;
  /** The address is proven and the pending signup exists: the plan step — or, straight to Professional with a card,
   *  the server's hand-off to Stripe (register-content leaveForCheckout). `via` names the door for the analyst. */
  onVerified: (signupToken: string, via: "email" | "google") => void;
}) {
  const [screen, setScreen] = React.useState<Screen>(google ? "google" : restore?.stage === "code" ? "code" : "form");
  const [draft, setDraft] = React.useState<string | null>(restore && restore.stage !== "expired" ? restore.draft : null);
  const [sentTo, setSentTo] = React.useState(restore?.email ?? "");
  const [resendAt, setResendAt] = React.useState(restore?.resendAt ?? 0);
  const [burned, setBurned] = React.useState(restore?.burned ?? false);
  const [err, setErr] = React.useState<string | null>(initialError);
  const [codeErr, setCodeErr] = React.useState<string | null>(restore?.burned ? "That code can't be used any more. Send a new code." : null);
  const [note, setNote] = React.useState<string | null>(null);
  /* Read out, not shown: a new code went out (the countdown starting again is the visible sign). */
  const [said, setSaid] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [code, setCode] = React.useState("");
  // Seeded from the server's clock (restore.now), never this render's
  // Date.now(): the SSR'd countdown and the hydrating one must print the same
  // second. A fresh visit has no countdown (resendAt 0), so any seed reads 0 s.
  const [now, setNow] = React.useState(() => restore?.now ?? 0);
  const codeRef = React.useRef<HTMLInputElement>(null);
  const bridgeRef = React.useRef<HTMLInputElement>(null);
  const headRef = React.useRef<HTMLHeadingElement>(null);
  const goRef = React.useRef<HTMLButtonElement>(null);
  useKeepInView(headRef, goRef, screen === "code");
  const verifying = React.useRef(false);
  // A plan or an edition named by the link rides the form sent without JavaScript (./checkout picks the plan by it).
  const params = useSearchParams();
  const plan = params?.get("plan") ?? null;
  const edition = params?.get("edition") === "deck" ? "deck" : null;
  const track = (outcome: string, reason = "", message = "") => {
    trackTraffic(TRAFFIC_EVENTS.signupStep1, { outcome, reason, variant: "e", steps: 2, mode: "otp", plan_mode: planMode, ...(quick ? { quick: true } : {}) });
    // The watcher's own reasons: a refusal the server answered in words is read from them (start_rejected).
    if (outcome === "error" || outcome === "code_error") signupProblem(reason === "start_rejected" ? reasonOfMessage(message) : reason, { message });
  };
  // Which screen of the code flow the visitor is on, for the watcher.
  // Straight to Professional with a card, the "done" screen is the hand-off to Stripe's card page — not a finish:
  // the account is made only when the card goes through (2026-10-28).
  React.useEffect(() => {
    setSignupPosition({ screen: screen === "form" ? "account" : screen === "done" && auto && requiresCard ? "checkout" : screen });
  }, [screen, auto, requiresCard]);

  /* This browser's copy of the fields and the screen (never the code). */
  React.useEffect(() => {
    if (screen === "google" || screen === "done") return;
    writeStored({ name, email, screen: screen === "code" ? "code" : "form", draft: screen === "code" ? draft : null });
  }, [name, email, screen, draft]);

  /* Each screen once for the analyst: step 1 is register-content's event; the code screen is its own. */
  const codeSeen = React.useRef(false);
  React.useEffect(() => {
    if (screen !== "code" || codeSeen.current) return;
    codeSeen.current = true;
    trackTraffic(TRAFFIC_EVENTS.step, { step: "code", flow: "otp", variant: "e", steps: 2, mode: "otp", plan_mode: planMode });
  }, [screen, planMode]);

  /* The resend countdown — on this browser's clock from the first effect on. */
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser's clock, read once after hydration
  React.useEffect(() => setNow(Date.now()), []);
  React.useEffect(() => {
    if (screen !== "code" || resendAt <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [screen, resendAt, now]);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  /* Proven: the plan step takes over, once — the code screen stops asking. */
  const proceeded = React.useRef(false);
  function proceed(signupToken: string, via: "email" | "google" = "email") {
    if (proceeded.current) return;
    proceeded.current = true;
    setScreen("done");
    writeStored(null);
    onVerified(signupToken, via);
  }

  /* Where the draft stands on the server: moved on in another browser, gone, still waiting. */
  async function refresh(token: string) {
    const st = await otpDraftStatus(token).catch(() => null);
    if (!st) return;
    if (st.stage === "gone") {
      if (screen === "code") {
        setScreen("form");
        setDraft(null);
        setDraftInUrl(null);
        setErr("This sign-up timed out. Start again with your email.");
        signupProblem("gone");
      }
      return;
    }
    if (st.stage === "code") {
      setDraft(token);
      setSentTo(st.email);
      if (st.name && !name) setName(st.name);
      setResendAt(st.resendAt);
      setBurned(st.burned);
      setScreen("code");
      setDraftInUrl(token);
      return;
    }
    if (st.signupToken) {
      writeStored(null);
      proceed(st.signupToken);
      return;
    }
    if (st.ticket) {
      await signInAndGo(st.ticket, st.next ?? "/dashboard");
      return;
    }
    setNote(`${st.email} is confirmed in another browser — carry on there, or ask for a new code here.`);
  }

  React.useEffect(() => {
    if (screen !== "code" || !draft) return;
    const tick = () => {
      if (document.visibilityState === "visible" && !verifying.current && !proceeded.current) void refresh(draft);
    };
    const t = window.setInterval(tick, POLL_MS);
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) tick();
    };
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("pageshow", onShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh reads the latest state on each tick
  }, [screen, draft]);

  /* The fields the server restored win; otherwise what this browser kept. */
  React.useEffect(() => {
    if (restore) {
      if (restore.name) setName(restore.name);
      if (restore.email) setEmail(restore.email);
      if (restore.stage === "code") setDraftInUrl(restore.draft);
      // Its pending signup ran out (lib/signupOtp draftRestore deleted the
      // draft): step 1 as ever, the fields filled, the cookie and ?d= gone.
      if (restore.stage === "expired") {
        rememberOtpDraft(null);
        setDraftInUrl(null);
      }
      return;
    }
    if (google) return;
    const kept = readStored();
    if (!kept) return;
    if (kept.name && !name) setName(kept.name);
    if (kept.email && !email) setEmail(kept.email);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh sets state after the server answers, not synchronously
    if (kept.screen === "code" && kept.draft) void refresh(kept.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the page opens
  }, []);

  /* Back from Google: Google proved the address and named the person. */
  const googleRan = React.useRef(false);
  React.useEffect(() => {
    if (!google || googleRan.current) return;
    googleRan.current = true;
    setScreen("google");
    void startOtpGoogleSignup({
      handle: google.handle,
      name,
      analytics: analytics(),
      displayedTrialDays: trialDays === 3 || trialDays === 7 ? trialDays : undefined,
      industry: industry ?? undefined,
      tool: tool ?? undefined,
      utm: utm ?? undefined,
      attribution,
      fbclid,
    })
      .then((res) => {
        if (res.ok) {
          track("continue", "google");
          proceed(res.signupToken, "google");
          return;
        }
        setScreen("form");
        setErr(res.error);
        track("error", res.taken ? "email_taken_google" : /expired/i.test(res.error) ? "google_expired" : "google_rejected", res.error);
      })
      .catch(() => {
        setScreen("form");
        setErr(SERVER_TROUBLE);
        signupProblem("google_failed", { message: SERVER_TROUBLE });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per Google identity
  }, [google]);

  /* Opened in the system browser by the in-app hand-off with `google=1`:
     Google starts at once. The mark is taken off the address first, so Back
     from Google does not start it again. */
  React.useEffect(() => {
    if (inApp || google) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("google") !== "1") return;
    url.searchParams.delete("google");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    rememberSignupMode(url.searchParams.get("flow"));
    onGoogle();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the page opens
  }, []);

  // Facebook's and Instagram's browsers draw no Google button (below): there is no hand-off to make from here.
  function googleTap() {
    onGoogle();
  }

  async function onContinue(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const n = name.trim();
    const em = email.trim();
    if (!n || !em) {
      setErr("Enter your name and email.");
      track("error", "missing");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setErr("Enter a valid email address.");
      track("error", "email_invalid");
      return;
    }
    setErr(null);
    setBusy(true);
    // In the tap, so the phone's keyboard is up (numeric) when the code field takes over.
    bridgeRef.current?.focus({ preventScroll: true });
    const backToEmail = () => document.getElementById("email")?.focus({ preventScroll: true });
    try {
      markQaVisitor(em); // a QA Lab address: no analytics from this browser (lib/qaEmail)
      if (quick) {
        /* No code with a card (lib/signupAutoPlan): straight on to the card page. The server says so itself; if the
           rule changed meanwhile it answers needsCode and the code goes out as before. */
        const q = await startQuickSignup({
          name: n,
          email: em,
          analytics: analytics(),
          displayedTrialDays: trialDays === 3 || trialDays === 7 ? trialDays : undefined,
          industry: industry ?? undefined,
          tool: tool ?? undefined,
          utm: utm ?? undefined,
          attribution,
          fbclid,
        });
        if (q.ok) {
          track("continue", "quick");
          trackMetaLeadOnce(); // Meta Lead: the email step passed (lib/metaLead)
          proceed(q.signupToken);
          return;
        }
        if (!q.needsCode) {
          setErr(q.error);
          backToEmail();
          track("error", q.taken ? "email_taken" : /temporary|throwaway|disposable/i.test(q.error) ? "email_disposable" : /Too many/.test(q.error) ? "rate_limited" : "quick_rejected", q.error);
          return;
        }
      }
      const res = await startOtpSignup({
        name: n,
        email: em,
        analytics: analytics(),
        displayedTrialDays: trialDays === 3 || trialDays === 7 ? trialDays : undefined,
        industry: industry ?? undefined,
        tool: tool ?? undefined,
        utm: utm ?? undefined,
        attribution,
        fbclid,
      });
      if (!res.ok) {
        setErr(res.error);
        backToEmail();
        track("error", /temporary|throwaway|disposable/i.test(res.error) ? "email_disposable" : /Too many/.test(res.error) ? "rate_limited" : /valid email/.test(res.error) ? "email_invalid" : "start_rejected", res.error);
        return;
      }
      track("continue");
      trackMetaLeadOnce(); // Meta Lead: the email step passed (lib/metaLead)
      rememberOtpDraft(res.draft);
      setDraft(res.draft);
      setSentTo(res.email);
      setResendAt(res.resendAt);
      setNow(Date.now());
      setBurned(false);
      setCode("");
      setCodeErr(null);
      setNote(null);
      setSaid("");
      setScreen("code");
      setDraftInUrl(res.draft);
      window.setTimeout(() => codeRef.current?.focus(), 60);
    } catch {
      setErr(SERVER_TROUBLE);
      backToEmail();
      track("error", "start_failed");
    } finally {
      setBusy(false);
    }
  }

  async function signInAndGo(ticket: string, next: string) {
    const auth = await signIn("signup-ticket", { ticket, redirect: false }).catch(() => null);
    writeStored(null);
    window.location.assign(auth && !auth.error ? next : `/auth/login?next=${encodeURIComponent(next)}`);
  }

  async function submitCode(value: string) {
    if (!draft || verifying.current || value.length !== 6) return;
    verifying.current = true;
    setBusy(true);
    setCodeErr(null);
    try {
      const res = await verifyOtpCode(draft, value);
      if (!res.ok) {
        setCodeErr(res.error);
        if (res.burned || res.expired) setBurned(true);
        if (res.gone) {
          setScreen("form");
          setDraft(null);
          setDraftInUrl(null);
          setErr(res.error);
        }
        setCode("");
        track("code_error", /on our side/i.test(res.error) ? "server_error" : res.burned ? "burned" : res.expired ? "expired" : res.gone ? "gone" : /Too many/.test(res.error) ? "rate_limited" : "wrong", res.error);
        window.setTimeout(() => codeRef.current?.focus(), 30);
        return;
      }
      track("code_ok", res.kind);
      if (res.kind === "signin") {
        await signInAndGo(res.ticket, res.next);
        return;
      }
      writeStored(null);
      proceed(res.signupToken);
    } catch {
      setCodeErr(SERVER_TROUBLE);
      signupProblem("network", { message: SERVER_TROUBLE });
    } finally {
      verifying.current = false;
      setBusy(false);
    }
  }

  function onCodeChange(digits: string) {
    setCode(digits);
    if (codeErr && digits.length) setCodeErr(null);
    if (digits.length === 6) void submitCode(digits);
  }

  async function onResend() {
    if (!draft || busy || resendIn > 0) return;
    setBusy(true);
    setCodeErr(null);
    setNote(null);
    setSaid("");
    try {
      const res = await resendOtpCode(draft);
      if (!res.ok) {
        if (res.resendAt) setResendAt(res.resendAt);
        setCodeErr(res.error);
        track("code_error", /Too many/.test(res.error) ? "resend_limited" : "resend_rejected", res.error);
        return;
      }
      setResendAt(res.resendAt);
      setNow(Date.now());
      setBurned(false);
      setCode("");
      setSaid(`A new code is on its way to ${sentTo}. The one before it no longer works.`);
      track("code_resent");
      window.setTimeout(() => codeRef.current?.focus(), 30);
    } catch {
      setCodeErr(SERVER_TROUBLE);
      signupProblem("network", { message: SERVER_TROUBLE });
    } finally {
      setBusy(false);
    }
  }

  function onDifferentEmail() {
    void forgetOtpDraft(draft).finally(() => rememberOtpDraft(null));
    setDraft(null);
    setDraftInUrl(null);
    setCode("");
    setCodeErr(null);
    setNote(null);
    setSaid("");
    setScreen("form");
    track("change_email");
    window.setTimeout(() => document.getElementById("email")?.focus(), 30);
  }

  const gmailTyped = /@(gmail|googlemail)\.com\s*$/i.test(email.trim());
  // Straight to a plan with a card (owner, 2026-10-18): "$0 today" marked, then that plan's own price.
  const trialText =
    auto && requiresCard ? (
      <>
        <b className={css.today}>$0 today</b>, then <span className={css.nowrap}>{autoPlanAmount(auto)} (with this plan)</span> after your free trial.
      </>
    ) : (
      `${trialDays}-day free trial · ${requiresCard ? "Card required" : "No card needed"} · Cancel anytime`
    );

  // The keyboard bridge stays put across the screens: the form hands the focus to it, the code field takes it.
  const view = (() => {
    /* Proven. Straight to Professional with a card: the server is opening Stripe's card page (./checkout) — said in
       one line while the browser waits for it, nothing to press. Otherwise the plan step slides in over this. */
    if (screen === "done")
      return (
        <div className={css.otp} data-otp-screen="done">
          {auto && requiresCard ? (
            <p className="auth-lede" role="status" id="otpLeaving">
              Opening Stripe&apos;s secure checkout…
            </p>
          ) : null}
        </div>
      );

    if (screen === "google") {
      return (
        <div className={css.otp} data-otp-screen="google">
          <h1 className="auth-h1">Start Your Free Trial</h1>
          <p className="auth-lede" role="status">
            Signed in with Google as <b>{google?.email}</b>. {auto ? (requiresCard ? `Opening the card page for ${auto.name}…` : `Starting your ${auto.name} trial…`) : "Setting up your plan…"}
          </p>
        </div>
      );
    }

    if (screen === "code") {
      const checking = busy && code.length === 6;
      return (
        <div className={css.otp} data-otp-screen="code">
          <h1 className="auth-h1" ref={headRef}>
            We sent a 6-digit code to your email
          </h1>
          <p className={`auth-lede ${css.sentTo}`}>
            <b className={css.addr} id="otpAddr">
              {sentTo}
            </b>
            <button type="button" className={css.change} id="otpChange" onClick={onDifferentEmail} disabled={checking}>
              Use a different email
            </button>
          </p>
          <form
            id="otpForm"
            className={css.codeForm}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submitCode(code);
            }}
          >
            <OtpCodeField
              id="otpCode"
              ref={codeRef}
              labelClassName="fld-lbl"
              messageId="otpNote"
              value={code}
              onChange={onCodeChange}
              message={codeErr ?? (burned ? "Send a new code to carry on." : note)}
              invalid={Boolean(codeErr) || burned}
              disabled={checking}
              autoFocus
            />
            <button className="btn" type="submit" id="otpBtn" ref={goRef} disabled={busy || code.length !== 6}>
              {checking ? "Checking…" : "Continue"}
              <svg className="ic" aria-hidden="true">
                <use href="#i-arrow-r" />
              </svg>
            </button>
          </form>
          <div className={css.codeRow}>
            <button type="button" className={css.quiet} id="otpResend" onClick={() => void onResend()} disabled={busy || resendIn > 0} data-armed={burned || undefined}>
              {resendIn > 0 ? `Resend code in ${resendIn} s` : "Resend code"}
            </button>
            <span className={css.spam} id="otpSpam">
              Didn&apos;t get it? Check spam.
            </span>
          </div>
          <p className={css.srOnly} role="status">
            {said}
          </p>
        </div>
      );
    }

    return (
      <div className={css.otp} data-otp-screen="form">
        <h1 className="auth-h1">{trialDays}-DAY FREE TRIAL</h1>
        {auto ? (
          <div className={css.priceCard} data-auto-plan-lede>
            <span className={css.priceIcon} aria-hidden="true">
              <svg className="ic">
                <use href="#i-tag" />
              </svg>
            </span>
            <div className={css.priceBody}>
              {/* Starter's price, typed in (owner, 2026-10-18) — when Starter's price changes, change it here. The new
                  plans (Plans switch on) say their own smallest card, priced with the ad's tool (lib/signupAutoPlan). */}
              <p className={css.priceHead}>
                Plans start at <b>{auto.tools ? `${autoPlanAmount({ priceCents: auto.tools.fromCents })}/month` : "$45/month"}</b>
              </p>
              <ul className={css.perks}>
                <li>
                  <span className={css.tick} aria-hidden="true">
                    <svg className="ic">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  One flat monthly price
                </li>
                <li>
                  <span className={css.tick} aria-hidden="true">
                    <svg className="ic">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  No pay-per-report fees
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <p className="auth-lede">Create your account in seconds. No password needed.</p>
        )}

        {/* NO GOOGLE IN FACEBOOK'S OR INSTAGRAM'S BROWSER (2026-10-23): Google does not sign in inside them
            (lib/inAppBrowser), so the email is the one way in there — no button, no divider. */}
        {inApp ? null : (
          <>
            <button className={`btn btn--ghost ${css.google}`} type="button" id="googleBtn" onClick={googleTap}>
              <svg className="ic ic--brand" aria-hidden="true">
                <use href="#i-google" />
              </svg>
              Sign up with Google
            </button>
            {/* The lines naming the email providers under the Google button and the divider are gone (owner, 2026-10-21). */}
            <div className="divider">
              <span className="kpi-lbl">No Google? Use any email</span>
            </div>
          </>
        )}

        {/* WITHOUT JAVASCRIPT (2026-10-19) the short sign-up still works: the form posts to ./checkout, whose answer is
            Stripe's card page (or step 1 again with the reason). With it, onContinue takes over and the same server
            answer is reached by address (register-content leaveForCheckout). The code path needs the script. */}
        <form
          id="step1Form"
          className={css.form}
          noValidate
          onSubmit={(e) => void onContinue(e)}
          {...(quick ? { method: "post", action: "/auth/register/checkout" } : {})}
        >
          {quick ? (
            <>
              <input type="hidden" name="trialDays" value={trialDays} />
              {industry ? <input type="hidden" name="industry" value={industry} /> : null}
              {tool ? <input type="hidden" name="tool" value={tool} /> : null}
              {fbclid ? <input type="hidden" name="fbclid" value={fbclid} /> : null}
              {plan ? <input type="hidden" name="plan" value={plan} /> : null}
              {edition ? <input type="hidden" name="edition" value={edition} /> : null}
              {Object.entries(utm ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            </>
          ) : null}
          <label className="fld">
            <span className="fld-lbl">Your name</span>
            <input className="fld-in" id="name" name="name" placeholder="First and last" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="fld">
            <span className="fld-lbl">Email</span>
            <input className="fld-in" type="email" id="email" name="email" placeholder="you@yourshop.com" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {/* A Gmail address typed in: the Google button would have done it in one tap. Offered, never forced. Not in an
              in-app browser — Google refuses to sign in there. */}
          {gmailTyped && !inApp && !busy ? (
            <p className={css.gmailHint} id="gmailHint" role="status">
              That&apos;s a Gmail address —{" "}
              <button
                type="button"
                className={css.gmailHintBtn}
                onClick={() => {
                  track("google_hint");
                  googleTap();
                }}
              >
                sign up with Google
              </button>{" "}
              in one tap instead, nothing else to type. Or just carry on below.
            </p>
          ) : null}
          <button className="btn" type="submit" id="nextBtn" disabled={busy}>
            {busy ? (quick ? "One moment…" : "Sending code…") : quick ? `Start Your ${trialDays}-Day Free Trial` : "Continue"}
            <svg className="ic" aria-hidden="true">
              <use href="#i-arrow-r" />
            </svg>
          </button>
          <p className={css.trial} id="otpTrial">{trialText}</p>
          {auto && requiresCard ? (
            <p className={css.anytime} id="otpAnytime">
              Upgrade / downgrade or cancel anytime
            </p>
          ) : null}
          {/* The $1 card check on the return from Stripe (lib/signupCardHold) — this step hands straight to Stripe. */}
          {quick ? (
            <p className={css.hold} id="cardHoldNotice">
              {CARD_HOLD_NOTICE}
            </p>
          ) : null}
          <div className={err ? "err" : "err is-hidden"} id="err1" role="alert">
            {err}
          </div>
        </form>

        <div className="foot">
          Already have an account?{" "}
          <Link className="link-ink" href={"/auth/login" as Route}>
            Sign in
          </Link>
        </div>
      </div>
    );
  })();

  return (
    <>
      {view}
      <KeyboardBridge ref={bridgeRef} />
    </>
  );
}
