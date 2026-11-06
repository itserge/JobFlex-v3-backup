"use client";
// THE OPERATOR SHEET (2026-11-05, batch 4 — Rev 2, the owner's pick): the phone's
// AI Operator as a blueprint. White lines on blueprint blue while the operator
// has the sheet: a stamp (Listening / Working / Needs you / Ready), a line of
// what else is running, the conversation as lines and cards — a card shows what
// was understood (the facts), the build's trace at its real pace, the deck's own
// plan drawn on when it lands, Do it / Cancel (and the PIN) while it waits — and
// the dial at the foot: hold it and talk, let go to send, slide off to cancel;
// tap for one sentence; Hands-free keeps listening. "Stop" or "wait" while it
// talks hushes it; "change that" calls off the read-back. The same state as the
// desk panel (use-assistant) and the same ears and voice (deck-voice).
// As a page (/mobile-assistant-v1) it carries Talk and Tasks; as an overlay
// (the dial button on every phone page, ./operator-fab) it opens listening.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import { AudioLines, Headphones, Keyboard, Mic, Pencil, Send, Square, Volume2, VolumeX, X } from "lucide-react";
import { useDeckSpeech } from "@/components/v3/deck-voice/use-deck-speech";
import { BUILD_STEPS, PIN_TOOLS, stepIndex, type FeedAction, type FeedMessage } from "@/lib/assistant/shared";
import { forSpeech, shownBody, type AssistantState } from "./use-assistant";
import { Dial, type DialMode } from "./dial";
import { TaskList, TOOL_LABEL, stampOf, type Tone } from "./task-list";
import "./operator.css";

export interface OperatorHandle {
  /** The dial button elsewhere was let go: send what was heard. */
  release(): void;
  /** Slid off: throw away what was heard. */
  cancel(): void;
}

type Props = {
  state: AssistantState;
  variant: "page" | "overlay";
  /** Start listening as it opens: a tap (one sentence) or a hold (until release()). */
  start?: "tap" | "hold" | null;
  onClose?: () => void;
};

type DeckDrawingData = { kind?: "deck"; viewBox: string; faces: { d: string; rank: number }[] };
type FenceDrawingData = { kind: "fence"; lots: { x: number; y: number }[][]; houses: { ring: { x: number; y: number }[]; subject: boolean }[]; fence: { x: number; y: number; gap?: boolean }[]; gates: { x: number; y: number; widthFt: number }[] };
/** A roof (2026-11-05): the aerial photo centred on the pin — never a drawn outline (the owner's rule). */
type RoofDrawingData = { kind: "roof"; photo: string | null; squares: number | null; pitch: string | null };
type Drawing = DeckDrawingData | FenceDrawingData | RoofDrawingData;

const STAMP: Record<Tone, string> = { warn: "yel", ok: "mnt", bad: "red", quiet: "dim", info: "wht" };

export const OperatorSheet = forwardRef<OperatorHandle, Props>(function OperatorSheet({ state, variant, start = null, onClose }, ref) {
  const { feed, pending, busy, building, landed, error, tasks, muted, setMuted, load, loadTasks, ask, answer } = state;
  const [tab, setTab] = useState<"talk" | "tasks">("talk");
  const [hands, setHands] = useState(false);
  const [heard, setHeard] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [doneFlash, setDoneFlash] = useState(false);
  const [secs, setSecs] = useState(0);
  const [drawings, setDrawings] = useState<Record<string, Drawing | null>>({});
  const [isHolding, setIsHolding] = useState(false);
  const holding = useRef(false);
  const drop = useRef(false);
  const downAt = useRef<{ x: number; y: number; t: number } | null>(null);
  const busyRef = useRef(busy);
  const mutedRef = useRef(muted);
  const feedRef = useRef(feed);
  const logRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const coreRef = useRef<HTMLButtonElement>(null);
  const speakRef = useRef<(t: string) => void>(() => {});
  const hushRef = useRef<() => void>(() => {});
  const speakingRef = useRef(false);

  const talkTurn = useCallback(
    async (said: string) => {
      const reply = await ask(said);
      if (reply && !mutedRef.current) speakRef.current(forSpeech(reply));
    },
    [ask],
  );

  const speech = useDeckSpeech({
    // The phone's own language (spec §2): a Russian phone is heard in Russian; the replies already follow the person.
    lang: typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US",
    onFinal: (alternatives) => {
      const said = alternatives[0]?.trim();
      if (!said) return;
      if (drop.current) {
        drop.current = false;
        return;
      }
      if (/^(stop|wait|hold on|quiet|enough)\b/i.test(said)) {
        hushRef.current();
        return;
      }
      if (/^(change that|cancel that|never mind|scratch that)\b/i.test(said)) {
        hushRef.current();
        const w = feedRef.current?.awaiting;
        if (w) void answer(w.id, false);
        return;
      }
      // A sentence heard while the last one is still being answered waits for nothing: it is dropped.
      if (busyRef.current) return;
      setHeard("");
      void talkTurn(said);
    },
    onInterim: (words) => {
      setHeard(words);
      if (speakingRef.current && /\b(stop|wait)\b/i.test(words)) hushRef.current();
    },
    onError: (message) => {
      setVoiceError(message);
      setHands(false);
    },
    speakUrl: "/api/assistant/speak",
    transcribeUrl: "/api/assistant/transcribe",
  });
  // What the ears' handlers read, kept current after every render (never during one).
  useEffect(() => {
    busyRef.current = busy;
    mutedRef.current = muted;
    feedRef.current = feed;
    speakRef.current = speech.say;
    hushRef.current = speech.hush;
    speakingRef.current = speech.speaking;
  });
  const listening = speech.mic === "listening" || speech.mic === "recording";
  const canTalk = speech.mode !== "none";

  // The conversation, read as the sheet opens; listening at once when asked to.
  const startRef = useRef(start);
  useEffect(() => {
    load();
    const how = startRef.current;
    if (!how || speech.mode === "none") return;
    if (how === "hold") {
      holding.current = true;
      setIsHolding(true);
      drop.current = false;
    }
    const t = setTimeout(() => speech.start(false), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      release() {
        if (!holding.current) return;
        holding.current = false;
        setIsHolding(false);
        speech.stop();
      },
      cancel() {
        holding.current = false;
        setIsHolding(false);
        drop.current = true;
        setHeard("");
        speech.stop();
        speech.hush();
      },
    }),
    [speech],
  );

  // A build landed: say it, and the dial turns green for a moment.
  useEffect(() => {
    if (!landed) return;
    const on = setTimeout(() => setDoneFlash(true), 0);
    const off = setTimeout(() => setDoneFlash(false), 3000);
    if (!mutedRef.current) speakRef.current(forSpeech(landed.text));
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [landed]);

  // The REC clock, from the moment it listens.
  useEffect(() => {
    if (!listening) return;
    const t0 = Date.now();
    const tick = () => setSecs(Math.floor((Date.now() - t0) / 1000));
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [listening]);

  // The newest line in view, whenever the conversation grows.
  const messages = useMemo(() => feed?.messages ?? [], [feed]);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending, heard, listening, building]);

  // The deck's own plan for a card that made or offers a proposal — drawn when it lands; a 404 means not a deck.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const ids = new Set<string>();
    for (const m of messages.slice(-6)) {
      if (!m.action) continue;
      const id = /\/dashboard\/proposals\/([A-Za-z0-9_-]+)/.exec(m.action.link ?? m.body)?.[1];
      if (id && !asked.current.has(id)) ids.add(id);
    }
    for (const id of ids) {
      asked.current.add(id);
      void fetch(`/api/assistant/drawing/${id}`)
        .then((r) => (r.ok ? (r.json() as Promise<Drawing>) : null))
        .then((d) => {
          if (d) setDrawings((all) => ({ ...all, [id]: d }));
        })
        .catch(() => undefined);
    }
  }, [messages]);

  useEffect(() => {
    if (tab === "tasks") loadTasks();
  }, [tab, loadTasks]);

  const send = async (words?: string) => {
    const t = (words ?? text).trim();
    if (!t || busy) return;
    if (words === undefined) setText("");
    const reply = await ask(t);
    if (reply === null && words === undefined) setText(t);
  };
  const onAnswer = async (id: string, yes: boolean, pin?: string) => {
    const reply = await answer(id, yes, pin);
    if (reply && !mutedRef.current && (hands || listening)) speakRef.current(forSpeech(reply));
    if (tab === "tasks") loadTasks();
  };

  // The dial: hold to talk (let go to send, slide off to cancel); a tap listens for one sentence; a tap while it
  // listens sends; hands-free keeps listening.
  const onCoreDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      coreRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
    if (!canTalk) return;
    setVoiceError(null);
    if (listening) {
      speech.stop();
      return;
    }
    if (speech.speaking) speech.hush();
    downAt.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    holding.current = true;
    setIsHolding(true);
    drop.current = false;
    speech.start(false);
  };
  const onCoreMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = downAt.current;
    if (!holding.current || !d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 60) {
      holding.current = false;
      setIsHolding(false);
      downAt.current = null;
      drop.current = true;
      setHeard("");
      speech.stop();
    }
  };
  const onCoreUp = () => {
    const d = downAt.current;
    downAt.current = null;
    if (!holding.current) return;
    holding.current = false;
    setIsHolding(false);
    // A short press is a tap: it keeps listening for the sentence; a hold ends when the finger lifts.
    if (d && Date.now() - d.t >= 350) speech.stop();
  };
  const toggleHands = () => {
    if (hands) {
      setHands(false);
      speech.stop();
      speech.hush();
    } else {
      setVoiceError(null);
      setHands(true);
      speech.start(true);
    }
  };
  const cancelListening = () => {
    drop.current = true;
    holding.current = false;
    setIsHolding(false);
    setHeard("");
    speech.stop();
    if (hands) setHands(false);
  };

  const awaiting = feed?.awaiting ?? null;
  const dial: DialMode = listening ? "listen" : busy || building ? "work" : awaiting ? "need" : doneFlash ? "done" : "idle";
  const stamp = listening ? { t: "Listening", c: "red" } : busy || building ? { t: "Working", c: "wht" } : awaiting ? { t: "Needs you", c: "yel" } : doneFlash ? { t: "Ready", c: "mnt" } : { t: "Ready", c: "dim" };
  const others = messages.map((m) => m.action).filter((a): a is FeedAction => Boolean(a && (a.status === "QUEUED" || a.status === "RUNNING")));
  const ticker = others.length ? `Background · ${others.map((a) => `${TOOL_LABEL[a.tool] ?? "Change"} · ${a.status === "RUNNING" ? (a.progress ?? "working") : "queued"}`).join(" · ")}` : "Background · nothing else running";
  const coreLabel = listening ? "Listening" : dial === "work" ? "Working" : dial === "need" ? "Say yes" : dial === "done" ? "Ready" : "Hold to talk";
  const needsCount = awaiting ? 1 : 0;
  const clock = `00:${String(Math.min(secs, 59)).padStart(2, "0")}`;

  return (
    <section className={`jf-operator ${variant === "overlay" ? "is-overlay" : "is-page"}`} data-nest="" aria-label="AI Operator">
      <header className="op-head">
        <span className="op-mark" aria-hidden="true">
          <AudioLines />
        </span>
        <div className="op-headText">
          <b>AI Operator</b>
          <i>{listening ? "Let go to send" : hands ? "Hands-free · say 'stop' to end" : dial === "need" ? "Say yes, or tap Do it" : "Hold to talk · tap for one sentence"}</i>
        </div>
        <span className={`op-stp ${stamp.c}`}>{stamp.t}</span>
        <button type="button" className={`op-sq ${muted ? "off" : ""}`} aria-pressed={muted} aria-label={muted ? "Spoken answers off — turn on" : "Spoken answers on — turn off"} onClick={() => setMuted(!muted)}>
          {muted ? <VolumeX /> : <Volume2 />}
        </button>
        {variant === "overlay" ? (
          <button type="button" className="op-sq" aria-label="Close the AI Operator" onClick={() => onClose?.()}>
            <X />
          </button>
        ) : null}
      </header>
      <p className="op-tk" role="status">
        {ticker}
      </p>
      {variant === "page" ? (
        <div className="op-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "talk"} className={tab === "talk" ? "on" : ""} onClick={() => setTab("talk")}>
            Talk
          </button>
          <button type="button" role="tab" aria-selected={tab === "tasks"} className={tab === "tasks" ? "on" : ""} onClick={() => setTab("tasks")}>
            Tasks{needsCount ? <em>{needsCount}</em> : null}
          </button>
        </div>
      ) : null}

      {tab === "tasks" ? (
        <div className="op-main op-tasks">
          <TaskList tasks={tasks} waitingId={awaiting?.id ?? null} busy={busy} onAnswer={onAnswer} />
        </div>
      ) : (
        <div className="op-main" ref={logRef} aria-live="polite" aria-busy={busy}>
          {feed === null && !error ? <p className="op-dim">Loading…</p> : null}
          {feed !== null && messages.length === 0 && !pending && !listening ? (
            <div className="op-intro">
              <p className="op-say">Say what you need.</p>
              <p className="op-lbl">Try saying</p>
              {["Build a 20 by 16 composite deck for John Smith", "What's on tomorrow?", "Book a visit with Sarah tomorrow at 10", "Remind me at 3 to call the inspector"].map((t) => (
                <button key={t} type="button" className="op-ex" disabled={busy} onClick={() => void send(t)}>
                  {t}
                </button>
              ))}
            </div>
          ) : null}
          {messages.map((m) => (
            <Line key={m.id} m={m} waiting={m.action?.id === awaiting?.id} busy={busy} onAnswer={onAnswer} drawing={drawingFor(m, drawings)} />
          ))}
          {pending ? <p className="op-me">{pending}</p> : null}
          {pending || (busy && !listening) ? (
            <p className="op-it op-working">
              <AudioLines /> Working on it…
            </p>
          ) : null}
          {listening || heard ? (
            <div className="op-listen">
              <div className="op-rec">
                <span className="op-stp red">● Rec</span>
                <span className="op-clock">{clock}</span>
              </div>
              <p className="op-tx">{heard || "Listening — just talk."}</p>
              <p className="op-under">{isHolding ? "Let go to send · slide off to cancel" : hands ? "Say 'stop' when you're done" : "It sends when you pause"}</p>
            </div>
          ) : null}
          {error ? (
            <p className="op-error" role="alert">
              {error}
            </p>
          ) : null}
          {voiceError ? (
            <p className="op-error" role="alert">
              {voiceError}
            </p>
          ) : null}
        </div>
      )}

      {typing ? (
        <form
          className="op-type"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea ref={boxRef} className="op-box" rows={1} value={text} placeholder="Type it…" maxLength={1200} enterKeyHint="send" aria-label="Ask or tell the AI Operator" onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="op-sendBtn" disabled={busy || !text.trim()} aria-label="Send">
            <Send />
          </button>
        </form>
      ) : null}

      <div className="op-foot">
        {listening ? (
          <Hint icon={<X />} label="Cancel" onClick={cancelListening} />
        ) : dial === "work" ? (
          <Hint icon={<Keyboard />} label="Type" onClick={() => setTyping((t) => !t)} pressed={typing} />
        ) : dial === "need" ? (
          <Hint icon={<Pencil />} label="Change" onClick={() => setTyping(true)} />
        ) : (
          <Hint icon={<Keyboard />} label="Type" onClick={() => setTyping((t) => !t)} pressed={typing} />
        )}
        <div className="op-dialWrap">
          <div className="op-dial">
            <Dial mode={dial} />
            <button
              ref={coreRef}
              type="button"
              className={`op-core ${dial}`}
              aria-label={listening ? "Send what I said" : dial === "need" ? "Hold to talk — or say yes" : "Hold to talk"}
              disabled={!canTalk}
              onPointerDown={onCoreDown}
              onPointerMove={onCoreMove}
              onPointerUp={onCoreUp}
              onPointerCancel={onCoreUp}
            >
              {listening ? <Square className="fill" /> : dial === "work" ? <AudioLines /> : <Mic />}
            </button>
          </div>
          <span className="op-coreLbl">{canTalk ? coreLabel : "No microphone here"}</span>
        </div>
        {listening ? (
          <Hint icon={<Square className="fill" />} label="Send" tone="red" onClick={() => speech.stop()} />
        ) : dial === "work" ? (
          <Hint icon={<X />} label="Stop" onClick={() => speech.hush()} />
        ) : dial === "need" && awaiting && !PIN_TOOLS.includes(awaiting.tool) ? (
          <Hint icon={<Send />} label="Send" onClick={() => void onAnswer(awaiting.id, true)} />
        ) : (
          <Hint icon={<Headphones />} label="Hands-free" pressed={hands} onClick={toggleHands} />
        )}
      </div>
    </section>
  );
});

function drawingFor(m: FeedMessage, drawings: Record<string, Drawing | null>): Drawing | null {
  if (!m.action) return null;
  const id = /\/dashboard\/proposals\/([A-Za-z0-9_-]+)/.exec(m.action.link ?? m.body)?.[1];
  return id ? (drawings[id] ?? null) : null;
}

function Hint({ icon, label, onClick, pressed, tone }: { icon: React.ReactNode; label: string; onClick: () => void; pressed?: boolean; tone?: "red" }) {
  return (
    <button type="button" className={`op-hint ${tone ?? ""} ${pressed ? "on" : ""}`} aria-pressed={pressed} onClick={onClick}>
      <span className="op-hintSq">{icon}</span>
      <i>{label}</i>
    </button>
  );
}

function Line({ m, waiting, busy, onAnswer, drawing }: { m: FeedMessage; waiting: boolean; busy: boolean; onAnswer: (id: string, yes: boolean, pin?: string) => Promise<void>; drawing: Drawing | null }) {
  if (m.direction === "IN") return <p className="op-me">{m.body}</p>;
  if (!m.action)
    return (
      <p className="op-it">
        <Words text={m.body} />
      </p>
    );
  return <Card a={m.action} body={shownBody(m)} waiting={waiting} busy={busy} onAnswer={onAnswer} drawing={drawing} />;
}

function Card({ a, body, waiting, busy, onAnswer, drawing }: { a: FeedAction; body: string; waiting: boolean; busy: boolean; onAnswer: (id: string, yes: boolean, pin?: string) => Promise<void>; drawing: Drawing | null }) {
  const [pin, setPin] = useState("");
  const st = stampOf(a, waiting);
  const running = a.status === "QUEUED" || a.status === "RUNNING";
  const steps = BUILD_STEPS[a.tool];
  const idx = stepIndex(a.tool, a.progress);
  const needPin = PIN_TOOLS.includes(a.tool);
  const price = /\$[\d,]+(?:\.\d{2})?/.exec(body)?.[0] ?? null;
  const built = /^Built\b/.test(body) || (a.tool.startsWith("build_") || a.tool.startsWith("change_")) && a.status === "DONE";
  return (
    <div className="op-card" data-tone={st.tone}>
      <div className="op-ch">
        <b>{TOOL_LABEL[a.tool] ?? "Change"}</b>
        <span className={`op-stp ${STAMP[st.tone]}`}>{st.label}</span>
      </div>
      {a.facts.length && (running || a.status === "FAILED") ? (
        <dl className="op-kv">
          {a.facts.map((f) => (
            <div key={f.k}>
              <dt>{f.k}</dt>
              <dd>{f.v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {steps && running ? (
        <ol className="op-steps">
          {steps.map((s, i) => (
            <li key={s} className={i < idx ? "done" : i === idx ? "now" : ""}>
              {s}
            </li>
          ))}
        </ol>
      ) : null}
      {steps && running ? <p className="op-note">You can close JobFlex. It keeps going, and your linked phone gets a text when it&apos;s ready.</p> : null}
      {drawing ? drawing.kind === "fence" ? <FenceDrawing d={drawing} /> : drawing.kind === "roof" ? <RoofPhoto d={drawing} /> : <DeckDrawing d={drawing} /> : null}
      {built && price ? <p className="op-big">{price}</p> : null}
      <p className="op-text">
        <Words text={body} />
      </p>
      {waiting && a.status === "AWAITING" ? (
        <div className={`op-acts ${needPin ? "withPin" : ""}`}>
          {needPin ? (
            <input className="op-pin" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="off" placeholder="PIN" aria-label="Your 4-digit PIN" value={pin} disabled={busy} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} />
          ) : null}
          <button type="button" className="op-b pri" disabled={busy || (needPin && pin.length !== 4)} onClick={() => void onAnswer(a.id, true, needPin ? pin : undefined)}>
            Do it
          </button>
          <button type="button" className="op-b" disabled={busy} onClick={() => void onAnswer(a.id, false)}>
            Cancel
          </button>
        </div>
      ) : null}
      {a.link ? (
        <Link className="op-open" href={a.link as Route} target="_blank" rel="noopener noreferrer">
          Open it →
        </Link>
      ) : null}
    </div>
  );
}

/** Draw the paths on in rank order, each line from nothing to its length (none under reduced motion). */
function useDrawOn(ref: React.RefObject<SVGSVGElement | null>, key: unknown) {
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const paths = Array.from(svg.querySelectorAll<SVGPathElement>("path"));
    const ranks = [...new Set(paths.map((p) => Number(p.dataset.rank)))].sort((a, b) => a - b);
    for (const p of paths) {
      const L = p.getTotalLength();
      p.style.transition = "none";
      p.style.strokeDasharray = `${L}`;
      p.style.strokeDashoffset = `${L}`;
    }
    void svg.getBoundingClientRect();
    for (const p of paths) {
      const r = ranks.indexOf(Number(p.dataset.rank));
      p.style.transition = still ? "none" : `stroke-dashoffset 420ms linear ${Math.max(0, r) * 320}ms`;
      p.style.strokeDashoffset = "0";
    }
  }, [ref, key]);
}

/** The deck's own plan, its lines drawn on in the real build order (the ranks the Deck Studio builds in). */
function DeckDrawing({ d }: { d: DeckDrawingData }) {
  const ref = useRef<SVGSVGElement>(null);
  useDrawOn(ref, d);
  return (
    <div className="op-draw">
      <span className="op-cap">Deck Studio · plan</span>
      <svg ref={ref} viewBox={d.viewBox} className="op-deck" role="img" aria-label="The deck's drawing">
        {d.faces.map((f, i) => (
          <path key={i} d={f.d} data-rank={f.rank} />
        ))}
      </svg>
    </div>
  );
}

/** The fence on its lot (feet, north up): the lot lines, the house, then the fence and its gates, drawn on in that
 *  order — the fence estimator's own plan (lib/fence/planSvg's data), in the sheet's lines. */
function FenceDrawing({ d }: { d: FenceDrawingData }) {
  const ref = useRef<SVGSVGElement>(null);
  useDrawOn(ref, d);
  const all = [...d.lots.flat(), ...d.houses.flatMap((h) => h.ring), ...d.fence];
  if (!all.length) return null;
  const minX = Math.min(...all.map((p) => p.x)) - 8;
  const maxX = Math.max(...all.map((p) => p.x)) + 8;
  const minY = Math.min(...all.map((p) => p.y)) - 8;
  const maxY = Math.max(...all.map((p) => p.y)) + 8;
  const X = (x: number) => (x - minX).toFixed(1);
  const Y = (y: number) => (maxY - y).toFixed(1);
  const ring = (pts: { x: number; y: number }[]) => `M ${pts.map((p) => `${X(p.x)} ${Y(p.y)}`).join(" L ")} Z`;
  const line = (pts: { x: number; y: number; gap?: boolean }[]) => pts.map((p, i) => `${i === 0 || p.gap ? "M" : "L"} ${X(p.x)} ${Y(p.y)}`).join(" ");
  return (
    <div className="op-draw">
      <span className="op-cap">Fence · plan</span>
      <svg ref={ref} viewBox={`0 0 ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}`} className="op-deck op-fence" role="img" aria-label="The fence on its lot">
        {d.lots.map((lot, i) => (
          <path key={`l${i}`} className="lot" d={ring(lot)} data-rank={0} />
        ))}
        {d.houses.map((h, i) => (
          <path key={`h${i}`} className={h.subject ? "house" : "neighbor"} d={ring(h.ring)} data-rank={1} />
        ))}
        <path className="run" d={line(d.fence)} data-rank={2} />
        {d.gates.map((g, i) => (
          <path key={`g${i}`} className="gate" d={`M ${(g.x - minX - g.widthFt / 2).toFixed(1)} ${Y(g.y)} l ${g.widthFt.toFixed(1)} 0`} data-rank={3} />
        ))}
      </svg>
    </div>
  );
}

/** The roof from the air: the satellite photo centred on the measurement's pin (api/assistant/photo), the pin a red
 *  dot at the centre, the squares and pitch in the caption. No photo (no key here, no pin): nothing is shown. */
function RoofPhoto({ d }: { d: RoofDrawingData }) {
  // The frame and the pin show once the photo is there; a photo that can't be had (no key, no coverage) shows nothing.
  const [got, setGot] = useState<"loading" | "ok" | "bad">("loading");
  if (!d.photo || got === "bad") return null;
  const cap = ["Roof · aerial", d.squares ? `${d.squares} sq` : "", d.pitch ? `${d.pitch} pitch` : ""].filter(Boolean).join(" · ");
  return (
    <div className="op-draw op-roof" data-state={got}>
      <span className="op-cap">{cap}</span>
      {/* eslint-disable-next-line @next/next/no-img-element -- a same-origin PNG streamed by the photo route, not an optimisable asset */}
      <img src={d.photo} alt="The roof from the air, the pin on it" onLoad={() => setGot("ok")} onError={() => setGot("bad")} />
      <span className="op-pin" aria-hidden="true" />
    </div>
  );
}

/** A reply's words with its links tappable — "Open it: https://…/dashboard/proposals/…" as "the proposal". */
function Words({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} className="op-link" href={part} target="_blank" rel="noopener noreferrer">
            {part.includes("/dashboard/proposals/") ? "the proposal" : part.replace(/^https?:\/\//, "")}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}
