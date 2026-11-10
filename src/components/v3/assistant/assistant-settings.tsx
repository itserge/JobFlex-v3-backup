"use client";
// SETTINGS → ASSISTANT (2026-11-04) — the phone that texts the JobFlex Assistant.
// One card in SmartBook's treatment (DESIGN.md): a white sheet in a 2px ink frame,
// a `--paper` head with the blue mark, an 18px 900 caps title and a square status
// stamp. It loads and saves itself (actions/assistant); the desk pane and the
// phone Settings mount the same piece.
//
// LINKING: "Link my phone" makes a six-digit code; the person texts it FROM the
// phone to the Assistant's number — on a phone one tap opens Messages with the
// code typed in. The card asks every few seconds until the text has come in.
// The consent words stand under the code: texting it is the yes.

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Copy, MessageSquareText, Phone } from "lucide-react";
import { clearAssistantPin, loadAssistantPhone, setAssistantOpen, setAssistantPhoneOn, setAssistantPin, setAssistantPrefs, startAssistantLink, unlinkAssistantPhone, type AssistantPhoneView } from "@/actions/assistant";
import type { AssistantPrefs } from "@/lib/assistant/prefs";
import { BRIEFING_TIMES, SPEECH_LANGS, clock12, type SpeechLang } from "@/lib/assistant/shared";
import { openAssistant } from "./events";
import s from "./assistant-settings.module.css";

const EXAMPLES = ["What's on tomorrow?", "Build a 12 by 12 deck with a roof for Sarah", "Price a roof replacement for the Lee house, 2,200 sq ft", "Send the Smith roof proposal", "Put the Lee fence on Thursday with Mike", "Tell everybody: start at 7 tomorrow"];

function since(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

export function AssistantSettings({ mobile = false }: { mobile?: boolean }) {
  const [view, setView] = useState<AssistantPhoneView | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The PIN for money (2026-11-05): typed once here, hashed on the server, never shown again.
  const [pinDraft, setPinDraft] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const wasLinked = useRef<string | null>(null);

  const load = useCallback(() => {
    loadAssistantPhone()
      .then((v) => {
        setView(v);
        // The code was texted: the link is here, the code card can go.
        if (v.link && v.link.phone !== wasLinked.current) setCode(null);
        wasLinked.current = v.link?.phone ?? null;
      })
      .catch(() => setError("Couldn't load the AI Operator settings. Reload the page."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // While a code waits for its text, ask every four seconds (stop when it expires).
  useEffect(() => {
    if (!code) return;
    const until = Date.parse(code.expiresAt);
    const t = window.setInterval(() => {
      if (Date.now() > until) {
        setCode(null);
        window.clearInterval(t);
        return;
      }
      load();
    }, 4000);
    return () => window.clearInterval(t);
  }, [code, load]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const link = () =>
    run(async () => {
      const r = await startAssistantLink();
      if (!r.ok) setError(r.error);
      else setCode({ code: r.code, expiresAt: r.expiresAt });
    });

  const savePrefs = (next: AssistantPrefs) => run(async () => setView(await setAssistantPrefs(next)));
  // A stored time off the list (an older value) reads and saves as the default, so a switch never fails on it.
  const briefTime = view && BRIEFING_TIMES.includes(view.prefs.briefing.time) ? view.prefs.briefing.time : "06:30";

  if (!view) {
    return (
      <section className={`${s.card} ${mobile ? s.mobile : ""}`} data-nest="">
        <p className={s.loading}>{error ?? "Loading…"}</p>
      </section>
    );
  }

  const st = view.closed ? { label: "Office only", tone: "quiet" } : !view.number ? { label: "Texting soon", tone: "quiet" } : !view.link ? { label: "Not linked", tone: "quiet" } : view.link.active ? { label: "Linked", tone: "ok" } : { label: "Paused", tone: "warn" };
  const smsHref = view.number && code ? `sms:${view.number}?&body=${code.code}` : null;

  return (
    <section className={`${s.card} ${mobile ? s.mobile : ""}`} data-nest="" aria-labelledby="assistant-settings-title">
      <header className={s.head}>
        <span className={s.mark} aria-hidden="true">
          <AudioLines />
        </span>
        <h3 className={s.title} id="assistant-settings-title">
          JobFlex AI Operator
        </h3>
        <span className={s.stamp} data-tone={st.tone}>
          {st.label}
        </span>
      </header>

      <div className={s.body}>
        <p className={s.lead}>
          Run JobFlex by talking or texting. Ask about your day, or tell it to price a job, send a proposal, schedule a job, text the crew or remind a client to pay. Pricing
          makes a draft only; anything that reaches someone else, or changes the calendar, is read back first and waits for your yes.
        </p>

        {view.closed ? <p className={s.note}>{view.closed}</p> : null}

        {view.preview ? (
          <div className={s.section}>
            <h4 className={s.h}>Who has it (platform admins only)</h4>
            <p className={s.text}>
              {view.preview.openToAll
                ? "Open to every account: every office and sales member sees the AI Operator."
                : "Only platform admins can see and use the AI Operator right now. Try it, then open it to everyone."}
            </p>
            <button
              type="button"
              className={view.preview.openToAll ? s.secondary : s.primary}
              disabled={busy}
              onClick={() => {
                const opening = !view.preview!.openToAll;
                if (opening && !window.confirm("Every JobFlex account will see the AI Operator. Open it now?")) return;
                void run(async () => setView(await setAssistantOpen(opening)));
              }}
            >
              {view.preview.openToAll ? "Back to platform admins only" : "Open the AI Operator to every account"}
            </button>
          </div>
        ) : null}

        {!view.closed ? (
          <div className={s.section}>
            <h4 className={s.h}>In the app</h4>
            <p className={s.text}>Open AI Operator at the top of the menu. Type, or tap the microphone and just talk — it answers out loud.</p>
            {!mobile ? (
              <button type="button" className={s.secondary} onClick={(e) => openAssistant(e.currentTarget)}>
                Open the AI Operator
              </button>
            ) : null}
          </div>
        ) : null}

        {!view.closed ? (
          <div className={s.section}>
            <h4 className={s.h}>PIN for money</h4>
            <p className={s.text}>
              Invoices and financing links ask for a 4-digit PIN as well as your yes — on the card in the app, as &ldquo;YES 1234&rdquo; by text.{" "}
              {view.pin.set ? "Your PIN is set." : "No PIN yet, so those two wait until you set one."}
            </p>
            {pinOpen || !view.pin.set ? (
              <form
                className={s.pinForm}
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const r = await setAssistantPin({ pin: pinDraft });
                    if (!r.ok) {
                      setError(r.error);
                      return;
                    }
                    setView(r.view);
                    setPinDraft("");
                    setPinOpen(false);
                  });
                }}
              >
                <input
                  className={s.pinField}
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  autoComplete="new-password"
                  aria-label="New 4-digit PIN"
                  placeholder="••••"
                  value={pinDraft}
                  disabled={busy}
                  onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
                />
                <button type="submit" className={s.primary} disabled={busy || pinDraft.length !== 4}>
                  {view.pin.set ? "Save new PIN" : "Save PIN"}
                </button>
                {view.pin.set ? (
                  <button
                    type="button"
                    className={s.quiet}
                    disabled={busy}
                    onClick={() => {
                      setPinOpen(false);
                      setPinDraft("");
                    }}
                  >
                    Keep the old one
                  </button>
                ) : null}
              </form>
            ) : (
              <div className={s.actions}>
                <button type="button" className={s.secondary} disabled={busy} onClick={() => setPinOpen(true)}>
                  Change PIN
                </button>
                <button
                  type="button"
                  className={s.quiet}
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm("Remove your PIN? Invoices and financing links by voice or text stop until you set a new one.")) return;
                    void run(async () => setView(await clearAssistantPin()));
                  }}
                >
                  Remove PIN
                </button>
              </div>
            )}
          </div>
        ) : null}

        {!view.closed ? (
          <div className={s.section}>
            <h4 className={s.h}>Talking to it</h4>
            <p className={s.text}>The language you speak to the AI Operator in. It listens for this one — English unless you pick another — and answers in the language you use.</p>
            <ul className={s.prefs}>
              <li>
                <div className={s.prefText}>
                  <p className={s.rowMain}>You speak</p>
                  <p className={s.rowSub}>Addresses and names are heard best in the language they are said in.</p>
                </div>
                <div className={s.prefCtl}>
                  <select
                    className={s.lang}
                    aria-label="Language you speak to the AI Operator"
                    value={view.prefs.lang}
                    disabled={busy}
                    onChange={(e) => savePrefs({ ...view.prefs, briefing: { ...view.prefs.briefing, time: briefTime }, lang: e.target.value as SpeechLang })}
                  >
                    {SPEECH_LANGS.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            </ul>
          </div>
        ) : null}

        {!view.closed ? (
          <div className={s.section}>
            <h4 className={s.h}>Morning briefing and alerts</h4>
            <p className={s.text}>
              Texts to your linked phone, and a line in the AI Operator. No texts between 9 PM and 7 AM.
              {!view.link?.active ? " Link your phone above to get them by text." : ""}
            </p>
            <ul className={s.prefs}>
              <li>
                <div className={s.prefText}>
                  <p className={s.rowMain}>Morning briefing</p>
                  <p className={s.rowSub}>Today&apos;s jobs and visits, proposals waiting, money owed and overdue, leads to call back, and the projects that need you. Mondays add the last 30 days&apos; money.</p>
                </div>
                <div className={s.prefCtl}>
                  <select
                    className={s.time}
                    aria-label="Briefing time"
                    value={briefTime}
                    disabled={busy}
                    onChange={(e) => savePrefs({ ...view.prefs, briefing: { ...view.prefs.briefing, time: e.target.value } })}
                  >
                    {BRIEFING_TIMES.map((t) => (
                      <option key={t} value={t}>
                        {clock12(t)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={view.prefs.briefing.on ? s.secondary : s.primary}
                    disabled={busy}
                    onClick={() => savePrefs({ ...view.prefs, briefing: { ...view.prefs.briefing, on: !view.prefs.briefing.on, time: briefTime } })}
                  >
                    {view.prefs.briefing.on ? "Turn off" : "Turn on"}
                  </button>
                </div>
              </li>
              <li>
                <div className={s.prefText}>
                  <p className={s.rowMain}>Projects in the briefing</p>
                  <p className={s.rowSub}>The projects that need you, worst first, from each project&apos;s Overview — with up to three next steps you answer by number (&ldquo;Reply 1 to mark Demolition done&rdquo;).</p>
                </div>
                <div className={s.prefCtl}>
                  <button
                    type="button"
                    className={view.prefs.briefing.projects ? s.secondary : s.primary}
                    disabled={busy}
                    aria-pressed={view.prefs.briefing.projects}
                    data-brief-projects=""
                    onClick={() => savePrefs({ ...view.prefs, briefing: { ...view.prefs.briefing, time: briefTime, projects: !view.prefs.briefing.projects } })}
                  >
                    {view.prefs.briefing.projects ? "Turn off" : "Turn on"}
                  </button>
                </div>
              </li>
              <li>
                <div className={s.prefText}>
                  <p className={s.rowMain}>When a client opens a proposal</p>
                  <p className={s.rowSub}>Their first look only.</p>
                </div>
                <div className={s.prefCtl}>
                  <button
                    type="button"
                    className={view.prefs.alerts.proposalOpened ? s.secondary : s.primary}
                    disabled={busy}
                    onClick={() => savePrefs({ ...view.prefs, briefing: { ...view.prefs.briefing, time: briefTime }, alerts: { ...view.prefs.alerts, proposalOpened: !view.prefs.alerts.proposalOpened } })}
                  >
                    {view.prefs.alerts.proposalOpened ? "Turn off" : "Turn on"}
                  </button>
                </div>
              </li>
              <li>
                <div className={s.prefText}>
                  <p className={s.rowMain}>When a new lead comes in</p>
                  <p className={s.rowSub}>From the website, Lead Center, a call or an ad. Not one you typed in.</p>
                </div>
                <div className={s.prefCtl}>
                  <button
                    type="button"
                    className={view.prefs.alerts.newLead ? s.secondary : s.primary}
                    disabled={busy}
                    onClick={() => savePrefs({ ...view.prefs, briefing: { ...view.prefs.briefing, time: briefTime }, alerts: { ...view.prefs.alerts, newLead: !view.prefs.alerts.newLead } })}
                  >
                    {view.prefs.alerts.newLead ? "Turn off" : "Turn on"}
                  </button>
                </div>
              </li>
              <li>
                <div className={s.prefText}>
                  <p className={s.rowMain}>When a promise to a client is due</p>
                  <p className={s.rowSub}>The morning it is due, and once more if it runs late. Promises are caught from what you write to clients — CRM → Today shows them all.</p>
                </div>
                <div className={s.prefCtl}>
                  <button
                    type="button"
                    className={view.prefs.alerts.promises ? s.secondary : s.primary}
                    disabled={busy}
                    aria-pressed={view.prefs.alerts.promises}
                    data-alert-promises=""
                    onClick={() => savePrefs({ ...view.prefs, briefing: { ...view.prefs.briefing, time: briefTime }, alerts: { ...view.prefs.alerts, promises: !view.prefs.alerts.promises } })}
                  >
                    {view.prefs.alerts.promises ? "Turn off" : "Turn on"}
                  </button>
                </div>
              </li>
            </ul>
          </div>
        ) : null}

        {!view.closed ? (
          <div className={s.section}>
            <h4 className={s.h}>From your phone, by text</h4>
            {!view.number ? (
              <p className={s.note}>Texting the AI Operator turns on when JobFlex&apos;s AI Operator number is ready. Until then, use it in the app.</p>
            ) : view.link ? (
              <>
                <div className={s.row}>
                  <span className={s.rowIcon} aria-hidden="true">
                    <Phone />
                  </span>
                  <div className={s.rowText}>
                    <p className={s.rowMain}>{view.link.phoneWords}</p>
                    <p className={s.rowSub}>
                      {view.link.active ? "Linked" : "Paused"}
                      {view.link.linkedAt ? ` · since ${since(view.link.linkedAt)}` : ""}
                    </p>
                  </div>
                </div>
                <p className={s.text}>
                  Text <b>{view.numberWords}</b> from this phone. Reply YES to a change to do it, NO to skip it. STOP pauses texts, START turns them back on.
                </p>
                <div className={s.actions}>
                  {view.contactUrl ? (
                    <a className={s.primary} href={view.contactUrl}>
                      Save to my contacts
                    </a>
                  ) : null}
                  <button type="button" className={s.secondary} disabled={busy} onClick={() => run(async () => setView(await setAssistantPhoneOn(!view.link!.active)))}>
                    {view.link.active ? "Pause texts" : "Turn texts back on"}
                  </button>
                  <button type="button" className={s.quiet} disabled={busy} onClick={() => run(async () => setView(await unlinkAssistantPhone()))}>
                    Unlink this phone
                  </button>
                </div>
              </>
            ) : code ? (
              <>
                <ol className={s.steps}>
                  <li>Open Messages on the phone you want to link.</li>
                  <li>
                    Text this code to <b>{view.numberWords}</b>:
                  </li>
                </ol>
                <div className={s.code}>
                  <span className={s.codeDigits} aria-label={`Code ${code.code.split("").join(" ")}`}>
                    {code.code}
                  </span>
                  <button
                    type="button"
                    className={s.copy}
                    onClick={() => {
                      void navigator.clipboard?.writeText(code.code).then(() => {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                  >
                    <Copy aria-hidden="true" />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                {mobile && smsHref ? (
                  <a className={s.primary} href={smsHref}>
                    <MessageSquareText aria-hidden="true" />
                    Text the code from this phone
                  </a>
                ) : null}
                <p className={s.waiting} role="status">
                  Waiting for your text… The code works for 15 minutes.
                </p>
                <p className={s.consent}>
                  By texting the code you agree to get texts from the JobFlex AI Operator about your JobFlex account and answers to what you ask. How many depends on you. Msg &amp; data
                  rates may apply. Reply STOP to stop, HELP for help. <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/assistant">How it works</a>
                </p>
              </>
            ) : (
              <>
                <p className={s.text}>
                  Link your phone once, then text <b>{view.numberWords}</b> what you need — from anywhere, no app.
                </p>
                <button type="button" className={s.primary} disabled={busy} onClick={link}>
                  Link my phone
                </button>
              </>
            )}
          </div>
        ) : null}

        {!view.closed ? (
          <div className={s.section}>
            <h4 className={s.h}>Things to say</h4>
            <ul className={s.examples}>
              {EXAMPLES.map((e) => (
                <li key={e}>“{e}”</li>
              ))}
            </ul>
            {view.usage.limit ? (
              <p className={s.usage}>
                {view.usage.used} of {view.usage.limit} requests this month
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className={s.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
