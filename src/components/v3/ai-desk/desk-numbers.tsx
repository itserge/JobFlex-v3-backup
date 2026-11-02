"use client";
// STEP 1 · YOUR NUMBERS (2026-10-14): the desk's number, the business phone customers
// already call, how the two meet (give out the desk's number, or forward the business
// phone at the carrier — all calls, or only the missed ones), and who picks up.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";

import { confirmDeskForwarding, readDeskForwarding, setBusinessPhone, setDeskForwarding, setDeskMode, testDeskForwarding } from "@/actions/aiDesk";
import type { ForwardCheck, ForwardStatus } from "@/lib/aiDesk/forwardCheck";
import { callsGo, forwardingCodes, type DeskForwarding, type DeskMode } from "@/lib/aiDesk/shared";
import type { SmsRegistrationView } from "@/lib/sms/registrationShared";
import { DESK_COPY as C, type DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import s from "./ai-desk.module.css";

const TEXTING_NUMBER = "/dashboard/texting#texting-own-number";

/** Copy the desk's number — a secondary button in the number's row. */
function CopyWords({ number }: { number: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={s.btn}
      aria-label={copied ? C.copied : `${C.copy} ${number}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(number);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      data-desk-copy-number
    >
      {copied ? C.copied : C.copy}
    </button>
  );
}

const whenWords = (at: number) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * IS IT REALLY FORWARDING? (2026-10-14) — JobFlex calls the business phone from the desk's number; forwarding on, the
 * call comes straight back to the desk and this says so. Or the owner checks it by hand. Polls while the test runs.
 */
function ForwardCheckBox({ initial, kind, phone, canManage, onStatus }: { initial: ForwardCheck | null; kind: "all" | "missed"; phone: string; canManage: boolean; onStatus: (s: ForwardStatus | null) => void }) {
  const router = useRouter();
  const [check, setCheck] = useState<ForwardCheck | null>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const calling = check?.status === "calling";

  useEffect(() => {
    if (!calling) return;
    const started = Date.now();
    const id = window.setInterval(async () => {
      try {
        const r = await readDeskForwarding();
        if (r.check && r.check.status !== "calling") {
          setCheck(r.check);
          onStatus(r.check.status);
          router.refresh();
        } else if (Date.now() - started > 130_000) {
          setCheck((c) => (c ? { ...c, status: "noanswer" } : c));
          onStatus("noanswer");
        }
      } catch {
        /* the next poll tries again */
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [calling, onStatus, router]);

  const test = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await testDeskForwarding();
      if (r.ok) {
        setCheck(r.check);
        onStatus("calling");
      } else {
        // A call Twilio would not place is a result (with its reason), not a stray error under the last one.
        const now = await readDeskForwarding().catch(() => null);
        if (now?.check?.status === "failed") {
          setCheck(now.check);
          onStatus("failed");
        } else setErr(r.error);
      }
    } catch {
      setErr("Couldn't reach JobFlex. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const manual = async (works: boolean) => {
    setBusy(true);
    setErr("");
    try {
      const r = await confirmDeskForwarding(works);
      if (r.ok) {
        setCheck(r.check);
        onStatus(r.check.status);
        router.refresh();
      } else setErr(r.error);
    } catch {
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const status = check?.status ?? null;
  const line = !phone
    ? C.fwdNeedPhone
    : status === "works"
      ? C.fwdWorks(check!.how, whenWords(check!.at))
      : status === "calling"
        ? kind === "all"
          ? C.fwdCallingAll(phone)
          : C.fwdCallingMissed(phone)
        : status === "rang"
          ? C.fwdRang
          : status === "noanswer"
            ? kind === "all"
              ? C.fwdNoAnswerAll
              : C.fwdNoAnswerMissed
            : status === "failed"
              ? C.fwdFailed(check?.error ? `${check.error.replace(/\.?$/, ".")}` : "")
              : C.fwdUnknown(phone);
  return (
    <div className={s.fwd} data-fwd-status={status ?? "unknown"}>
      <div className={s.row}>
        <div className={s.rowMain}>
          <div className={s.h}>{C.fwdTitle}</div>
          <p className={s.fwdLine} role="status" suppressHydrationWarning>
            <span className={s.fwdDot} aria-hidden />
            {line}
          </p>
        </div>
        {phone ? (
          <button type="button" className={`${s.btn} ${status === "works" ? "" : s.btnPrimary}`} disabled={!canManage || busy || calling} onClick={() => void test()} data-fwd-test>
            {calling ? "Calling…" : status ? C.fwdTestAgain : C.fwdTest}
          </button>
        ) : null}
      </div>
      {phone && status !== "works" && !calling ? (
        <div className={`${s.row} ${s.fwdManual}`}>
          <span className={s.note}>{C.fwdManualAsk}</span>
          <span className={s.rowActs}>
            <button type="button" className={s.fix} disabled={!canManage || busy} onClick={() => void manual(true)} data-fwd-manual="yes">
              {C.fwdManualYes}
            </button>
            <button type="button" className={s.fix} disabled={!canManage || busy} onClick={() => void manual(false)} data-fwd-manual="no">
              {C.fwdManualNo}
            </button>
          </span>
        </div>
      ) : null}
      {err ? (
        <p className={`${s.note} ${s.noteErr}`} role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}

/** The codes for the contractor's carrier, a copy button each, the test, and what to do when it doesn't take. */
function ForwardCodes({ number, kind, phone }: { number: string; kind: "all" | "missed"; phone: string }) {
  const [copied, setCopied] = useState("");
  const codes = forwardingCodes(number, kind);
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied((c) => (c === code ? "" : c)), 1600);
    } catch {
      setCopied("");
    }
  };
  return (
    <div className={s.codes} data-forward-codes={kind}>
      <div className={s.h}>{C.codesTitle}</div>
      <p className={s.note}>{C.codesHow(phone)}</p>
      {codes.length ? (
        <div className={s.codeTable} role="table" aria-label={C.codesTitle}>
          {codes.map((c) => (
            <div key={c.carrier} className={s.codeRow} role="row" data-carrier={c.carrier}>
              <span className={s.codeCarrier} role="cell">
                {c.carrier}
              </span>
              <span className={s.codeOn} role="cell">
                <small>{C.codesOn}</small>
                <code data-code-on>{c.on}</code>
              </span>
              <span className={s.codeOff} role="cell">
                <small>{C.codesOff}</small>
                <code>{c.off}</code>
              </span>
              <span className={s.codeAct} role="cell">
                <button type="button" className={s.codeCopy} onClick={() => void copy(c.on)} aria-label={`${C.codesCopy} ${c.on}`}>
                  {copied === c.on ? C.codesCopied : C.codesCopy}
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <ul className={s.codeNotes}>
        <li>{C.codesOther(number)}</li>
        <li>{kind === "all" ? C.codesIphone : C.codesLiveVoicemail}</li>
        <li>
          <b>{C.codesTest(phone)}</b>
        </li>
        <li>{C.codesTrouble}</li>
      </ul>
    </div>
  );
}

export function DeskNumbers({ desk, registration, onNumber }: { desk: DeskSettingsData; registration: SmsRegistrationView | null; onNumber?: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<DeskMode>(desk.mode);
  const [forwarding, setForwarding] = useState<DeskForwarding>(desk.forwarding);
  const [phone, setPhone] = useState(desk.businessPhone ?? "");
  const [savedPhone, setSavedPhone] = useState(desk.businessPhone ?? "");
  // The forwarding check's state, for folding the codes away once it works.
  const [fwdStatus, setFwdStatus] = useState<ForwardStatus | null>(desk.forwardCheck?.status ?? null);
  const [showCodes, setShowCodes] = useState(false);
  const [busy, setBusy] = useState<null | "mode" | "forward" | "phone">(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  // The number it bought, else the line JobFlex assigned to it (calls only; texting keeps its own).
  const number = registration?.number ?? desk.assigned?.number ?? null;
  const callsOn = registration?.number ? Boolean(registration.calls?.on) : Boolean(desk.assigned);
  const go = callsGo({ mode, assistantOnPlan: desk.assistantOnPlan, companyPhone: forwarding === "all" ? null : savedPhone || null });
  const callsWords = !number ? C.noNumber : !callsOn ? C.callsOff : go === "assistant" ? C.callsDesk : go === "phone" ? C.callsPhone(savedPhone) : C.callsNone;

  const flip = async (next: DeskMode) => {
    if (next === mode || busy) return;
    setBusy("mode");
    setErr("");
    setNote("");
    try {
      const r = await setDeskMode(next);
      if (r.ok) {
        setMode(next);
        setNote(r.note ?? "");
        router.refresh();
      } else setErr(r.error);
    } catch {
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const pickForwarding = async (next: DeskForwarding) => {
    if (next === forwarding || busy) return;
    const prev = forwarding;
    setForwarding(next);
    setBusy("forward");
    setErr("");
    setNote("");
    try {
      const r = await setDeskForwarding(next);
      if (r.ok) {
        if (next === "all") setMode("ANSWER");
        setNote(r.note ?? "");
        router.refresh();
      } else {
        setForwarding(prev);
        setErr(r.error);
      }
    } catch {
      setForwarding(prev);
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const savePhone = async () => {
    if (busy) return;
    setBusy("phone");
    setErr("");
    setNote("");
    try {
      const r = await setBusinessPhone(phone);
      if (r.ok) {
        setSavedPhone(r.phone ?? "");
        setPhone(r.phone ?? "");
        setNote(r.note ?? "");
        router.refresh();
      } else setErr(r.error);
    } catch {
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const opts: Array<{ key: DeskForwarding; title: string; sub: string }> = [
    { key: "none", title: C.forwardNone, sub: C.forwardNoneSub(number ?? "the desk's number") },
    { key: "missed", title: C.forwardMissed, sub: C.forwardMissedSub(number ?? "the desk's number") },
    { key: "all", title: C.forwardAll, sub: C.forwardAllSub(number ?? "the desk's number") },
  ];

  return (
    <div className={`${s.root} ${s.status}`} data-desk-status data-mode={mode} data-forwarding={forwarding}>
      {/* the desk's number */}
      <div className={s.sec}>
        <div className={s.h}>{C.deskNumberTitle}</div>
        {number ? (
          <div className={s.row} data-desk-number-row>
            <div className={s.rowMain}>
              <b className={s.numBig}>{number}</b>
              <span className={s.note}>{callsWords}</span>
              {!registration?.number && desk.assigned ? (
                <span className={s.note} data-desk-lent>
                  {registration?.assigned?.house ? C.lentLineHouse : C.lentLine}{" "}
                  {onNumber ? (
                    <button type="button" className={s.link} onClick={onNumber}>
                      {C.lentGo}
                    </button>
                  ) : (
                    <a className={s.link} href={TEXTING_NUMBER}>
                      {C.lentGo}
                    </a>
                  )}
                </span>
              ) : null}
            </div>
            <span className={s.rowActs}>
              <CopyWords number={number} />
              {onNumber ? (
                <button type="button" className={s.btn} onClick={onNumber} data-desk-change-number>
                  {C.changeNumber}
                </button>
              ) : (
                <a className={s.btn} href={TEXTING_NUMBER} data-desk-change-number>
                  {C.changeNumber}
                </a>
              )}
            </span>
          </div>
        ) : (
          <div className={`${s.row} ${s.empty}`} data-desk-number-empty>
            <span className={s.emptyText}>
              <Phone size={17} strokeWidth={2.2} aria-hidden />
              {C.noNumber}
            </span>
            {onNumber ? (
              <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onNumber} data-desk-get-number>
                {C.getNumber}
              </button>
            ) : (
              <a className={`${s.btn} ${s.btnPrimary}`} href={TEXTING_NUMBER} data-desk-get-number>
                {C.getNumber}
              </a>
            )}
          </div>
        )}
        {!desk.assistantOnPlan ? <p className={s.banner}>{C.notOnPlan}</p> : null}
      </div>

      {/* the business phone */}
      <div className={s.sec}>
        <div className={s.h}>{C.businessTitle}</div>
        <p className={s.note}>{C.businessSub}</p>
        <div className={s.tryRow}>
          <input className={s.in} value={phone} placeholder={C.businessPlaceholder} aria-label={C.businessTitle} inputMode="tel" disabled={!desk.canManage || busy === "phone"} onChange={(e) => setPhone(e.target.value)} data-desk-business-phone />
          <button type="button" className={s.btn} disabled={!desk.canManage || busy !== null || phone.trim() === savedPhone} onClick={() => void savePhone()} data-desk-business-save>
            {busy === "phone" ? C.saving : C.businessSave}
          </button>
        </div>
      </div>

      {/* how customers reach the desk */}
      <div className={s.sec} role="radiogroup" aria-label={C.forwardTitle} data-tour="ai-desk:forwarding">
        <div className={s.h}>{C.forwardTitle}</div>
        {!number ? <p className={s.note}>{C.forwardNeedsNumber}</p> : null}
        <div className={s.radios}>
          {opts.map((o) => (
            <label key={o.key} className={`${s.radio} ${forwarding === o.key ? s.radioOn : ""}`} data-forward-opt={o.key}>
              <input type="radio" name="desk-forwarding" value={o.key} checked={forwarding === o.key} disabled={!desk.canManage || !number || busy !== null} onChange={() => void pickForwarding(o.key)} />
              <span>
                <b>{o.title}</b>
                <span className={s.note}>{o.sub}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* forwarding: is it really on (the test), and how to turn it on at the carrier — JobFlex can't */}
      {number && forwarding !== "none" ? (
        <div className={s.sec} id="desk-forward" data-desk-forward>
          <ForwardCheckBox
            key={`${forwarding}|${savedPhone}`}
            initial={desk.forwardCheck && desk.forwardCheck.kind === forwarding ? desk.forwardCheck : null}
            kind={forwarding}
            phone={savedPhone}
            canManage={desk.canManage}
            onStatus={setFwdStatus}
          />
          {fwdStatus === "works" && !showCodes ? (
            <div className={s.acts}>
              <button type="button" className={s.btn} onClick={() => setShowCodes(true)} data-fwd-show-codes>
                {C.fwdShowCodes}
              </button>
            </div>
          ) : (
            <ForwardCodes number={number} kind={forwarding} phone={savedPhone} />
          )}
        </div>
      ) : null}

      {/* who answers */}
      <div className={s.sec}>
        <div className={s.h}>{C.whoAnswers}</div>
        <div className={s.modes} role="group" aria-label={C.whoAnswers}>
          <button type="button" className={s.mode} aria-pressed={mode === "ANSWER"} disabled={busy !== null || !desk.canManage} onClick={() => void flip("ANSWER")} data-mode-btn="ANSWER">
            <b>{C.modeAnswer}</b>
            <span>{C.modeAnswerSub}</span>
          </button>
          <button type="button" className={s.mode} aria-pressed={mode === "FORWARD"} disabled={busy !== null || !desk.canManage || forwarding === "all" || !savedPhone} onClick={() => void flip("FORWARD")} data-mode-btn="FORWARD">
            <b>{C.modeForward}</b>
            <span>{forwarding === "all" ? C.modeForwardOff : C.modeForwardSub(savedPhone)}</span>
          </button>
        </div>
      </div>

      {note ? (
        <p className={`${s.note} ${s.noteOk}`} role="status">
          {note}
        </p>
      ) : null}
      {err ? (
        <p className={`${s.note} ${s.noteErr}`} role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
