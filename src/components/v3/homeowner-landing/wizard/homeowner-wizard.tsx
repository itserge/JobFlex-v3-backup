"use client";

// HOMEOWNER LANDING — the intake wizard. Donor `mountWizard(root, uid)`.
//
// ── WHY THIS FILE IS A REWRITE AND NOTHING ELSE IN THE PORT IS ──────────────
// The donor builds every pane by concatenating an HTML STRING and assigning it
// to `host.innerHTML`, with a hand-rolled `esc()` in front of every
// interpolation. That pipeline is not carried across: this page takes free-text
// and file names from the public, and an `innerHTML` sink fed by public input
// is an XSS surface the app has no reason to own. The panes are real JSX, React
// escapes for us, and `esc()` is gone — every one of its call sites is now an
// ordinary `{expression}` child or attribute, which React escapes identically.
//
// ── WHAT IS PRESERVED, EXACTLY ─────────────────────────────────────────────
// Same panes, same order, same triggers, same copy, same timings:
//   describe → (thinking 850ms) → clarify → (thinking 850ms) → scope →
//   contact → done, with `‹ Back` jumps to 0 / 1 / 2 and `restart` back to 0.
//   `canRefine()` is `desc.trim().length > 0` (was `> 12`); `detect()` walks KEYWORDS in
//   order and only fires past 8 characters; `go()` collapses its delay to 0
//   under reduced motion.
//
// ── THE ONE NON-OBVIOUS FIDELITY DEVICE: `paneKey` ─────────────────────────
// `.pane`, `.q`, `.sl`, `.up` and `.guess` all carry CSS entrance animations.
// In the donor they replay whenever `render()` runs, because `render()` throws
// the old DOM away. A React tree that merely updates in place would never
// replay them, and the page would feel materially different. So `paneKey`
// increments at EXACTLY the donor's `render()` call sites and keys the pane —
// remounting the subtree and replaying the animations on the same events, and
// only on those events. Consequently:
//   · typing in `.desc` does NOT rebuild the pane (the category guess/menu are
//     appears or disappears, which is the one case the donor rebuilds on, and
//     the one case it restores focus and caret afterwards. Both survive.
//   · typing in a `.q-in` does NOT rebuild the pane, so answers are kept twice:
//     `answers` (a ref) is the live store the donor calls `S.answers` and
//     mutates on every keystroke, and `shown` is the snapshot the JSX reads,
//     taken inside `bump()` — i.e. at exactly the moments the donor's `render()`
//     would have re-read `S.answers`. That is also why a `.chip` stays lit until
//     the next rebuild even after you type over it: donor behavior, preserved
//     rather than "fixed".
//     gone since 2026-09-04 — the AI detects the trade at submit; the donor only
//     toggles a class), so `.cats.open`'s slide-in plays and nothing else does.
//
// ── FILES ──────────────────────────────────────────────────────────────────
// The donor's `addFiles` / `pump` only simulated an upload, so the picker was
// hidden. Since 2026-10-23 the files are listed while the homeowner writes and
// go into the request's job folder for real once it is sent
// (use-request-attachments → lib/home/uploadClient, through the door
// lib/home/freshRequest opens to the request just sent). The CONTACT step: it calls `submitHomeownerRequest`,
// which writes the request, starts the cascade and emails the homeowner. The
// donor read none of those fields and jumped straight to "on its way", so a
// project sent from this page reached nobody.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DictateButton, MicIcon, setTextareaValue } from "@/components/estimator/DictateButton";
import {
  categoryOf,
  CONTACT_FIELDS,
  CONTACT_INPUTS,
  QUESTIONS,
  STEP_NAMES,
  type Question,
} from "../homeowner-data";
import { needsAddressFor } from "@/lib/leadRules";

/** The street address is CONTACT_FIELDS[4]; required only when lib/leadRules says the job is measured at the property. */
const ADDRESS_FIELD = 4;
import { submitHomeownerRequest, suggestHomeownerQuestions, suggestHomeownerScope } from "@/actions/homeowner";
import { LEAD_CONSENT_MISSING, LEAD_CONSENT_TEXT, consentPageFromLocation } from "@/lib/leadConsent";
import { browserTimeZone, type WizardPrefill } from "@/lib/home/prefill";
import { prefersReducedMotion, referralCodeFromUrl, testKeyFromUrl } from "../use-homeowner-behavior";
import { usePlaceholderCycle } from "./use-placeholder-cycle";
import { attachmentsLine, useRequestAttachments } from "./use-request-attachments";
import { PriceChoice, PriceNudge } from "@/components/v3/price-my-project/price-here";

/** How long the thinking pane waits for the adaptive questions before going
 *  on with the static set. */
const AI_WAIT_MS = 6500;

/** Enough to catch a typo, not enough to argue with a real address. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** useLayoutEffect warns during SSR; useEffect is inert there, so it stands in. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;


/** `house`: the house estimators are on (lib/publicEstimate/store houseOrgId) — deck, fence, heating & cooling and
 *  any project are priced in the portal too, not only the roof. */
export function HomeownerWizard({ uid, prefill = null, house = false }: { uid: string; prefill?: WizardPrefill | null; house?: boolean }) {
  /* donor `S` */
  const [step, setStep] = useState(0);
  const [desc, setDesc] = useState(prefill?.description ?? "");
  /* The photos, videos and PDFs picked — sent into the request's folder once it exists. */
  const att = useRequestAttachments();
  const { add: addAttachments, clear: clearAttachments, send: sendAttachments } = att;
  const [thinking, setThinking] = useState(false);
  /* not donor state — `root.classList.add('drag')`, expressed as a class */
  const [dragging, setDragging] = useState(false);
  /* the donor's `render()`, counted (see the header note) */
  const [paneKey, setPaneKey] = useState(0);
  /* what the last render read out of `answers` — see the header note */
  const [shown, setShown] = useState<string[]>([]);

  const answers = useRef<string[]>([]);
  /* Questions written from THIS description (server, OpenAI); null means keep
     the static set from homeowner-data.ts. */
  const [aiQs, setAiQs] = useState<Question[] | null>(null);
  /* The scope a contractor prices from, written by the server from the
     description and the answers when "Generate my scope" is pressed; the
     scope step shows it (the homeowner's own words until it lands, or if
     it fails) and it is sent with the request. */
  const [scope, setScope] = useState<string | null>(null);
  const [scopeBusy, setScopeBusy] = useState(false);
  /* The submission. The donor's "Send to contractors" jumped straight to the
     done pane and read none of the fields, so this page collected a project,
     wrote nothing, and told the homeowner it was on its way — no lead, no
     confirmation email, nothing in the Lead Center. */
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");
  /* The TCPA box under "Send my project" (lib/leadConsent): nothing is sent unticked. */
  const [consent, setConsent] = useState(false);
  const consentRef = useRef<HTMLInputElement | null>(null);
  /* The status page (/request/[token]) the submission hands back — the done
     pane links it, as the confirmation email does. */
  const [statusPath, setStatusPath] = useState<string | null>(null);
  /* The home dashboard (lib/home/portal): its path when the done pane may show
     it, or a note that the link went by email. */
  const [homePath, setHomePath] = useState<string | null>(null);
  const [homeEmailed, setHomeEmailed] = useState(false);
  /* The request's own token, for sending a file again. */
  const [requestToken, setRequestToken] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);
  const goTimer = useRef<number | null>(null);
  /* the step and the thinking pane, read from handlers that outlive a render (the drop zone) */
  const live = useRef({ step: 0, thinking: false });

  const descRef = usePlaceholderCycle();

  useIsomorphicLayoutEffect(() => {
    live.current = { step, thinking };
  }, [step, thinking]);

  /* donor `render()`. Takes the answers snapshot at the same instant it
     replays the pane, because the donor's render did both in one pass. */
  const bump = useCallback(() => {
    setShown(answers.current.slice());
    setPaneKey((k) => k + 1);
  }, []);

  /* donor `questions()` / `canRefine()`. The category picker is gone (owner,
     2026-09-04): the description is the one source, and the TRADE is detected
     server-side by AI at submit — see submitHomeownerRequest. */
  // The model's questions; without them, the set the words point at (kitchen, roof…), then the general one (2026-10-14).
  const questions: Question[] = aiQs ?? QUESTIONS[categoryOf(desc)] ?? QUESTIONS["default"];
  /* One character wakes "Continue" — the donor's `> 12` read as a broken
     button (owner's call on the retired portal wizard, carried here). */
  const canRefine = desc.trim().length > 0;

  /* donor `renderHead()` */
  const headLabel = step < 4 ? STEP_NAMES[step] : "Done";
  const tickClass = (i: number) => "tick" + (i < step ? " past" : i === step ? " now" : "");

  /* ── attachments ───────────────────────────────────────────────────── */

  /* A file picked or dropped appears as a chip — the donor rebuilt the pane, so its entrance plays. */
  const addFiles = useCallback(
    (list: FileList) => {
      addAttachments(list);
      bump();
    },
    [addAttachments, bump]
  );

  /* ── navigation ────────────────────────────────────────────────────── */

  /* donor `go(n)`: thinking pane, then the target step. 850ms, or 0 when the
     visitor has asked for reduced motion. */
  const go = useCallback(
    (n: number, work?: Promise<unknown>) => {
      setThinking(true);
      bump();
      // The thinking pane already says "Reading your description…" — when the
      // questions are being written from that description, this is the wait it
      // was describing. Capped, so a slow model cannot strand anyone.
      const beat = new Promise<void>((r) => {
        goTimer.current = window.setTimeout(() => {
          goTimer.current = null;
          r();
        }, prefersReducedMotion() ? 0 : 850);
      });
      const capped = work
        ? Promise.race([work, new Promise((r) => window.setTimeout(r, AI_WAIT_MS))])
        : null;
      void Promise.all([beat, capped]).then(() => {
        setThinking(false);
        setStep(n);
        bump();
      });
    },
    [bump]
  );

  // A tester's ?test=<key> is read now and held for the whole walk.
  useEffect(() => {
    testKeyFromUrl();
  }, []);

  /* ── teardown: nothing outlives the page ───────────────────────────── */
  useEffect(() => {
    return () => {
      if (goTimer.current) window.clearTimeout(goTimer.current);
      goTimer.current = null;
    };
  }, []);

  /* donor, on the one render that happens mid-typing:
     `nd.focus(); nd.setSelectionRange(pos, pos);` */
  useIsomorphicLayoutEffect(() => {
    if (caret.current === null) return;
    const pos = caret.current;
    caret.current = null;
    const el = descRef.current;
    if (!el) return;
    el.focus();
    try {
      el.setSelectionRange(pos, pos);
    } catch {
      /* donor swallows this too — some engines refuse on a detached node */
    }
  }, [paneKey]);

  /* ── handlers ──────────────────────────────────────────────────────── */

  const onDescInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDesc(e.currentTarget.value);
  };

  const onRefine = () => {
    if (!canRefine) return;
    setAiQs(null);
    answers.current = [];
    setShown([]);
    const work = suggestHomeownerQuestions({ description: desc, category: null })
      .then((res) => {
        if (res.questions && res.questions.length) setAiQs(res.questions);
      })
      .catch(() => {});
    go(1, work);
  };

  /**
   * Picking a chip fills that one answer. It does NOT `bump()`.
   *
   * The donor's render() threw the pane away on every state change, and
   * `paneKey` reproduces that — which meant tapping "Medium" replayed the
   * entrance animation of every question on the step. Reading a form that
   * re-animates under your hands is the thing the fidelity was costing, so this
   * one call site diverges: the answer is written into its own input directly
   * (the fields are uncontrolled) and `shown` lights the chip.
   */
  const onChip = (i: number, value: string) => {
    answers.current[i] = value;
    setShown(answers.current.slice());
    const el = document.getElementById(uid + "q" + i) as HTMLInputElement | null;
    if (el) el.value = value;
  };

  const onBack = (to: number) => {
    setStep(to);
    bump();
  };

  /** The contact fields are uncontrolled (donor shape), so they are read from
   *  the DOM at send time by the same ids the inputs carry. */
  const contactValue = (i: number): string =>
    (document.getElementById(uid + "c" + i) as HTMLInputElement | null)?.value.trim() ?? "";

  /* CONTACT_FIELDS is ["Full name", "Email", "Phone (optional)", "ZIP code"],
     so the four fields map positionally. The clarify answers ride along in the
     description because `submitHomeownerRequest` takes one free-text body.
     Attachments are NOT sent: the uploader never leaves the browser. */
  /* "Generate my scope": the description and the answers go to the server,
     which writes the scope a contractor prices from (lib/leadScope). */
  const writeScope = () => {
    const answered = questions
      .map((q, i) => ({ q: q.q, a: (answers.current[i] ?? "").trim() }))
      .filter((x) => x.a);
    setScope(null);
    setScopeBusy(true);
    const work = suggestHomeownerScope({ description: desc.trim(), answers: answered })
      .then((res) => {
        if (res.scope) setScope(res.scope);
      })
      .catch(() => {})
      .finally(() => setScopeBusy(false));
    go(2, work);
  };

  /* The street address (CONTACT_FIELDS[4]) is required only when the job is
     measured at the property — lib/leadRules decides from the description. */
  const needsAddress = needsAddressFor(desc);

  const onSend = async () => {
    if (sending) return;
    const [name, email, phone, zip, address] = [0, 1, 2, 3, 4].map(contactValue);
    if (!name || !email || !zip) {
      setSendErr("Name, email and ZIP code are needed to send this to contractors.");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setSendErr("That email address does not look right.");
      return;
    }
    const extra = questions
      .map((q, i) => {
        const a = (answers.current[i] ?? "").trim();
        return a ? q.q + " " + a : "";
      })
      .filter(Boolean)
      .join("\n");
    const description = extra ? desc.trim() + "\n\n" + extra : desc.trim();
    // The answers can reveal a roof or a fence the first words did not: the
    // same rule the server applies, said here first.
    if (needsAddressFor(description) && address.length < 5) {
      setSendErr("This job is measured at the property — please add the street address.");
      return;
    }
    if (!consent) {
      setSendErr(LEAD_CONSENT_MISSING);
      consentRef.current?.focus();
      return;
    }
    setSendErr("");
    setSending(true);
    try {
      const res = await submitHomeownerRequest({
        name,
        email,
        phone: phone || undefined,
        zip,
        address: address || undefined,
        scope: scope ?? undefined,
        description,
        // A shared link's ?ref=CODE — recorded as a referral conversion.
        referralCode: referralCodeFromUrl(),
        // A tester's ?test=<key>, held since the first render (lib/leadCenter/testLeads).
        testKey: testKeyFromUrl(),
        // From the home dashboard: the request joins it, and fulfils the plan.
        homeKey: prefill?.homeKey,
        planId: prefill?.planId ?? undefined,
        // Started on a cost guide (/cost): the guide, kept with the lead.
        source: prefill?.source,
        // The ticked TCPA box and where it was ticked; the server keeps its own copy of the words.
        consent,
        page: consentPageFromLocation(),
        // The browser's zone, for a new home's reminders.
        timezone: browserTimeZone() || undefined,
      });
      if (!res.ok) {
        setSendErr(res.error);
        return;
      }
      setStatusPath(res.statusPath ?? null);
      setHomePath(res.homePath ?? null);
      setHomeEmailed(Boolean(res.homeEmailed));
      setRequestToken(res.requestToken ?? null);
      setStep(4);
      bump();
      // The files now go into the request's folder; the Done screen follows them.
      if (res.requestToken) void sendAttachments(res.requestToken);
    } catch (err) {
      setSendErr(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't send that. Check your connection and try again.",
      );
    } finally {
      setSending(false);
    }
  };

  const onRestart = () => {
    setStep(0);
    setStatusPath(null);
    setSendErr("");
    setConsent(false);
    setDesc("");
    clearAttachments();
    answers.current = [];
    bump();
  };

  /* ── panes ─────────────────────────────────────────────────────────── */

  /** The files as chips: removable while writing; on the Done screen, each one's way into the folder. */
  const chips = (removable: boolean) =>
    att.items.length ? (
      <div className="ups">
        {att.items.map((u) => (
          <span className={u.state === "failed" ? "up up-fail" : "up"} key={u.id} title={u.error} data-wizard-file={u.state}>
            <svg className="ic">
              <use href={u.kind === "pdf" ? "#i-doc" : "#i-img"} />
            </svg>
            {u.name}
            {u.state === "sent" ? (
              <span className="up-ok">✓</span>
            ) : u.state === "sending" ? (
              <span className="up-bar">
                <span style={{ width: u.progress + "%" }}></span>
              </span>
            ) : u.state === "failed" ? (
              <span className="up-no">!</span>
            ) : removable ? (
              <button type="button" className="up-x" aria-label={`Remove ${u.file.name}`} onClick={() => att.remove(u.id)}>
                ×
              </button>
            ) : null}
          </span>
        ))}
      </div>
    ) : null;

  const paneThinking = (
    <div className="pane think" key={paneKey}>
      <span className="think-dots">
        <i></i>
        <i></i>
        <i></i>
      </span>
      <span className="think-t">
        {step === 0 ? "Reading your description…" : "Writing your scope of work…"}
      </span>
    </div>
  );

  const paneDescribe = (
    <div className="pane" key={paneKey}>

      <div className="desc-wrap">
        <textarea
          className="desc"
          rows={3}
          aria-label="Describe your project"
          ref={descRef}
          defaultValue={desc}
          onChange={onDescInput}
        />
      </div>
      {chips(true)}
      {/* ONE PORTAL (2026-10-28): once the words point at an estimator, the way into it (lib/home/portalPrice). */}
      <PriceNudge desc={desc} house={house} />
      <div className="tools">
        <input
          type="file"
          className="file"
          multiple
          accept="image/*,video/*,.pdf"
          style={{ display: "none" }}
          ref={fileRef}
          data-wizard-file-input
          onChange={(e) => {
            const files = e.currentTarget.files;
            if (files && files.length) addFiles(files);
            e.currentTarget.value = "";
          }}
        />
        <button className="tool tool-photo" type="button" onClick={() => fileRef.current?.click()}>
          <svg className="ic">
            <use href="#i-img" />
          </svg>
          Photos &amp; video
        </button>
        {/* Press and speak — the words land in the field as they are recognised,
            as on the Smart Proposal (owner, 2026-09-21). The field is uncontrolled,
            so the text goes in the way typing would and onDescInput still runs.
            In the footer beside Photos since 2026-10-31, so the whole box fits the first screen. */}
        <DictateButton value={desc} onChange={(next) => setTextareaValue(descRef.current, next)} icon={<MicIcon />} label="Speak your project"
          wrapClassName="dictate" buttonClassName="mic" onClassName="on" noteClassName="dictate-note" />
        <button className="go go-refine" type="button" disabled={!canRefine} onClick={onRefine}>
          Continue
          <svg className="ic">
            <use href="#i-arrow-r" />
          </svg>
        </button>
      </div>
    </div>
  );

  const paneClarify = (
    <div className="pane qs" key={paneKey}>
      <div className="qs-h">A few quick questions — twenty seconds, promise</div>
      {questions.map((it, i) => {
        const id = uid + "q" + i;
        return (
          <div className="q" key={i} style={{ animationDelay: i * 0.09 + "s" }}>
            <label className="q-l" htmlFor={id}>
              {i + 1}. {it.q}
            </label>
            <input
              className="q-in"
              id={id}
              data-q={i}
              placeholder={it.hint}
              defaultValue={shown[i] || ""}
              onChange={(e) => {
                answers.current[i] = e.currentTarget.value;
              }}
            />
            {it.chips ? (
              <div className="chips">
                {it.chips.map((v) => (
                  <button
                    key={v}
                    className={shown[i] === v ? "chip on" : "chip"}
                    type="button"
                    data-q={i}
                    data-v={v}
                    onClick={() => onChip(i, v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="pane-foot">
        <button className="back" type="button" data-to="0" onClick={() => onBack(0)}>
          ‹ Back
        </button>
        <button className="go go-scope" type="button" onClick={writeScope}>
          Generate my scope
        </button>
      </div>
    </div>
  );

  const scopeRows = () => {
    const rows: React.ReactNode[] = [];
    let d = 0;
    questions.forEach((it, i) => {
      const answer = shown[i];
      if (!answer) return;
      rows.push(
        <div className="sl" key={"q" + i} style={{ animationDelay: 0.12 + d * 0.1 + "s" }}>
          <i>✓</i>
          <span>
            <b>{it.q}</b>
            {" "}
            {answer}
          </span>
        </div>
      );
      d++;
    });
    if (att.items.length) {
      rows.push(
        <div className="sl" key="attachments" style={{ animationDelay: 0.12 + d * 0.1 + "s" }}>
          <i>✓</i>
          <span>
            <b>Attachments:</b>
            {" "}
            {att.items.length} file{att.items.length > 1 ? "s" : ""} — they go into the project&rsquo;s folder when you send it
          </span>
        </div>
      );
    }
    return rows;
  };

  const paneScope = (
    <div className="pane qs" key={paneKey}>
      <div className="scope-head">
        <span className="qs-h">Your Scope of Work</span>
        <span className="scope-stamp">Structured by JobFlex</span>
      </div>
      <div className="sheet">
        <div className="sheet-n">Scope of work</div>
        <p className="sheet-p" data-scope-text>{scope ?? (scopeBusy ? "Writing your scope of work…" : desc.trim() || "Homeowner project description.")}</p>
        <div className="sheet-list">{scopeRows()}</div>
      </div>
      <div className="pane-foot">
        <button className="back" type="button" data-to="1" onClick={() => onBack(1)}>
          ‹ Back
        </button>
        <button
          className="go go-contact"
          type="button"
          onClick={() => {
            setStep(3);
            bump();
          }}
        >
          Looks right — get quotes
        </button>
      </div>
    </div>
  );

  const paneContact = (
    <div className="pane qs" key={paneKey}>
      <div className="qs-h">Where should the quotes go?</div>
      <p className="pane-lede">
        Your scope goes to a local pro on JobFlex, who will contact you to talk it through. Not the right fit? You can ask for another.
      </p>
      <div className="cform">
        {CONTACT_FIELDS.map((field, i) => {
          const id = uid + "c" + i;
          const label = i === ADDRESS_FIELD ? (needsAddress ? field + " — needed to measure this job" : field + " (optional)") : field;
          return (
            <div key={field}>
              <label className="fld-l" htmlFor={id}>
                {label}
              </label>
              <input className="q-in c-in" id={id} placeholder={label} {...CONTACT_INPUTS[i]} defaultValue={prefill ? [prefill.name, prefill.email, prefill.phone, prefill.zip, prefill.address][i] : undefined}
                  aria-required={i === ADDRESS_FIELD ? needsAddress : !/\(optional\)/i.test(field)} />
            </div>
          );
        })}
      </div>
      {sendErr ? (
        <div className="send-err" role="alert">
          {sendErr}
        </div>
      ) : null}
      <div className="pane-foot">
        <button className="back" type="button" data-to="2" onClick={() => onBack(2)}>
          ‹ Back
        </button>
        <button
          className="go go-send"
          type="button"
          disabled={sending}
          onClick={() => {
            void onSend();
          }}
        >
          {sending ? "Sending…" : "Send my project"}
          <svg className="ic">
            <use href="#i-arrow-r" />
          </svg>
        </button>
      </div>
      <label className="consent">
        <input
          ref={consentRef}
          className="consent-box"
          type="checkbox"
          checked={consent}
          aria-required="true"
          onChange={(e) => {
            setConsent(e.target.checked);
            if (e.target.checked && sendErr === LEAD_CONSENT_MISSING) setSendErr("");
          }}
        />
        <span>{LEAD_CONSENT_TEXT}</span>
      </label>
    </div>
  );

  const paneDone = (
    <div className="pane done" key={paneKey}>
      <span className="done-mark">
        <svg className="ic">
          <use href="#i-check" />
        </svg>
      </span>
      <div className="done-h">{homePath ? "Sent — and your home dashboard is ready." : "Your project is on its way."}</div>
      <p className="done-p">
        {homePath
          ? "We’re matching your scope with a local pro on JobFlex. Your home dashboard holds this project, the proposal when it comes, your contractor and the next jobs you plan — no account, no password. The link is in your email too."
          : homeEmailed
            ? "We’re matching your scope with a local pro on JobFlex. Your home dashboard — this project with your earlier ones, the proposals and your contractors — is in your email: we sent its link to the address you gave."
            : "We’re matching your scope with a local pro on JobFlex. We’ve emailed you a link to follow your request — and if the pro isn’t the right fit, you can ask for another."}
      </p>
      {/* The dashboard, when it may be shown here (lib/home/portal: a first-timer,
          or a request made from the dashboard); else the request page, as the
          confirmation email links it. Plain anchors: runtime tokens, no literal
          route for typedRoutes. */}
      {att.items.length ? (
        <div className="done-files" data-wizard-files={att.sending ? "sending" : att.failed ? "failed" : "sent"}>
          {chips(false)}
          <p className="done-p" aria-live="polite">{attachmentsLine(att)}</p>
          {att.failed && !att.sending && requestToken ? (
            <button className="restart" type="button" onClick={() => void sendAttachments(requestToken)}>
              Try the {att.failed === 1 ? "file" : "files"} again
            </button>
          ) : null}
        </div>
      ) : null}
      {homePath ? (
        <a className="done-link" href={homePath}>
          Open your home dashboard →
        </a>
      ) : statusPath ? (
        <a className="done-link" href={statusPath}>
          Track your request →
        </a>
      ) : null}
      <button className="restart" type="button" onClick={onRestart}>
        Start another project
      </button>
    </div>
  );

  const pane = thinking
    ? paneThinking
    : step === 0
      ? paneDescribe
      : step === 1
        ? paneClarify
        : step === 2
          ? paneScope
          : step === 3
            ? paneContact
            : paneDone;

  return (
    <div id="plan" className="win-wrap anim a4">
      {/* "What are you planning?" (owner, 2026-10-30): the estimators as a plain choice over the box while it asks for words. */}
      {step === 0 && !thinking ? <PriceChoice desc={desc} house={house} /> : null}
      <div
        className={dragging ? "win drag" : "win"}
        ref={rootRef}
        onDragOver={(e) => {
          if (live.current.step >= 4) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          const root = rootRef.current;
          if (!root) return;
          if (e.target === root || !root.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          if (live.current.step >= 4) return;
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
            addFiles(e.dataTransfer.files);
          }
        }}
      >
        <div className="drop-veil">
          <span>Drop photos, video, or blueprint PDFs</span>
        </div>
        <div className="win-head">
          <div className="win-step">{headLabel}</div>
          <div className="win-ticks">
            <span className={tickClass(0)}></span>
            <span className={tickClass(1)}></span>
            <span className={tickClass(2)}></span>
            <span className={tickClass(3)}></span>
          </div>
        </div>
        <div className="pane-host">{pane}</div>
      </div>
    </div>
  );
}
