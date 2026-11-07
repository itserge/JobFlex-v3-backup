"use client";
// THE ASSISTANT · THE CONVERSATION (2026-11-04), one body for the desk panel and
// the handheld page. Square bubbles as SmartBook's conversation draws them — the
// person's white in ink, the Assistant's `--accent-soft` in accent. A change the
// Assistant proposes is a framed card: what it will do, in the words the code
// built, a status stamp, and Do it (the one blue action) / Cancel while it waits.
//
// TWO WAYS TO ASK (owner, 2026-11-04: "control my business from my phone just
// talking or texting … and it's gonna do it and talk to me back"):
//   · type in the box → the answer is written;
//   · Talk (the microphone) → a spoken conversation, hands-free: it listens, sends
//     each finished sentence, reads the answer out in the shop's AI desk voice
//     (api/assistant/speak; the browser's own voice when that can't answer) and
//     listens again — "yes" to a read-back does it. The ears and the voice are
//     Deck Studio's (deck-voice/use-deck-speech): the browser's speech recognition
//     where it has one, a short recording written down by the server where not
//     (api/assistant/transcribe). The microphone pauses while it talks.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, AudioLines, Mic, Square } from "lucide-react";
import { useDeckSpeech } from "@/components/v3/deck-voice/use-deck-speech";
import { isBuild, PIN_TOOLS, SCHEDULED_TOOLS, TOOL_LABEL, type ActionStatus, type FeedAction, type FeedMessage } from "@/lib/assistant/shared";
import { forSpeech, shownBody, type AssistantState } from "./use-assistant";
import s from "./assistant.module.css";

const EXAMPLES: Array<{ label: string; text: string; fill?: boolean }> = [
  { label: "What's on tomorrow?", text: "What's on tomorrow?" },
  { label: "Build a 12 × 12 deck with a roof for …", text: "Build a 12 by 12 deck with a roof for ", fill: true },
  { label: "What needs my attention today?", text: "What needs my attention today?" },
  { label: "Which proposals aren't signed?", text: "Which proposals aren't signed yet?" },
  { label: "Send the … proposal", text: "Send the ", fill: true },
  { label: "Put … on Thursday with …", text: "Put the ", fill: true },
  { label: "Tell the crew: …", text: "Tell everybody: ", fill: true },
  { label: "Remind me at 3 to …", text: "Remind me at 3 to ", fill: true },
];



/** The builds (lib/assistant/build): no undo window — queued means it is being priced. */


function stamp(a: FeedAction, waiting: boolean): { label: string; tone: "warn" | "ok" | "bad" | "quiet" | "info" } {
  const st: ActionStatus = a.status;
  if (st === "AWAITING") return waiting ? { label: "Needs you", tone: "warn" } : { label: "Expired", tone: "quiet" };
  if (st === "QUEUED") return isBuild(a.tool) ? { label: "Working", tone: "info" } : SCHEDULED_TOOLS.includes(a.tool) ? { label: "Set", tone: "info" } : { label: "In 2 min", tone: "info" };
  if (st === "RUNNING") return { label: "Working", tone: "info" };
  if (st === "DONE") return { label: "Done", tone: "ok" };
  if (st === "FAILED") return { label: "Didn't go", tone: "bad" };
  if (st === "CANCELED") return { label: "Cancelled", tone: "quiet" };
  return { label: "Expired", tone: "quiet" };
}

export function Conversation({
  state,
  prefill,
  autoFocus,
  variant,
}: {
  state: AssistantState;
  /** Text to put in the box (an example row elsewhere, a link). */
  prefill?: string | null;
  autoFocus?: boolean;
  variant: "panel" | "page";
}) {
  const { feed, pending, busy, building, landed, error, lang, ask, answer } = state;
  const [text, setText] = useState("");
  const [talk, setTalk] = useState(false);
  const [heard, setHeard] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const boxId = useId();
  const busyRef = useRef(busy);
  const talkRef = useRef(false);
  const sayRef = useRef<(words: string) => void>(() => {});

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  /** One spoken turn: what was said goes out, the answer is read back (and it listens on). */
  const talkTurn = async (said: string) => {
    const reply = await ask(said, { spoken: true });
    if (talkRef.current) sayRef.current(forSpeech(reply ?? "That didn't go through. Try again."));
  };

  const speech = useDeckSpeech({
    // The language they speak to it in (Settings → AI Operator; English unless they picked another).
    lang,
    onFinal: (alternatives) => {
      const said = alternatives[0]?.trim();
      // A sentence heard while the last one is still being answered waits for nothing: it is dropped.
      if (!said || busyRef.current) return;
      setHeard("");
      void talkTurn(said);
    },
    onInterim: (words) => setHeard(words),
    onError: (message) => {
      setVoiceError(message);
      endTalk();
    },
    speakUrl: "/api/assistant/speak",
    transcribeUrl: "/api/assistant/transcribe",
    streamSpeech: true,
  });
  useEffect(() => {
    sayRef.current = speech.say;
  });
  // A build that ran after its "On it…" lands later: in a spoken conversation it is read out when it does.
  useEffect(() => {
    if (landed && talkRef.current) sayRef.current(forSpeech(landed.text));
  }, [landed]);

  function startTalk() {
    setVoiceError(null);
    setHeard("");
    talkRef.current = true;
    setTalk(true);
    speech.start("live");
  }
  function endTalk() {
    talkRef.current = false;
    setTalk(false);
    setHeard("");
    speech.stop();
    speech.hush();
  }

  // A new prefill goes into the box (adjusted while rendering, not in an effect).
  const [seenPrefill, setSeenPrefill] = useState<string | null | undefined>(undefined);
  if (prefill !== seenPrefill) {
    setSeenPrefill(prefill);
    if (prefill) setText(prefill);
  }
  useEffect(() => {
    if (!prefill) return;
    requestAnimationFrame(() => {
      const el = boxRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }, [prefill]);

  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => boxRef.current?.focus());
  }, [autoFocus]);

  // The newest line in view, whenever the conversation grows.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed?.messages.length, pending, error]);

  // The box grows with what is typed, up to five lines.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const send = async (words?: string) => {
    const t = (words ?? text).trim();
    if (!t || busy) return;
    if (words === undefined) setText("");
    const reply = await ask(t);
    if (reply === null && words === undefined) setText(t);
  };

  const onAnswer = async (actionId: string, yes: boolean, pin?: string) => {
    const reply = await answer(actionId, yes, pin);
    if (talkRef.current && reply) sayRef.current(forSpeech(reply));
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const messages = feed?.messages ?? [];
  const waitingId = feed?.awaiting?.id ?? null;
  const empty = feed !== null && messages.length === 0 && !pending;
  const canTalk = speech.mode !== "none";
  const listening = speech.mic === "listening" || speech.mic === "recording";
  const talkLine = speech.speaking ? "Speaking…" : busy ? "Working on it…" : speech.mic === "sending" ? "Writing that down…" : heard || (listening ? "Listening — just talk." : "Starting the microphone…");

  return (
    <div className={`${s.root} ${variant === "page" ? s.onPage : s.inPanel}`} data-nest="">
      <div className={s.log} ref={logRef} aria-live="polite" aria-busy={busy}>
        {feed === null && !error ? <p className={s.loading}>Loading…</p> : null}

        {empty ? (
          <div className={s.intro}>
            <p className={s.introTitle}>Tell JobFlex what to do.</p>
            <p className={s.introSub}>
              Type it, or tap the microphone and just talk — it answers out loud. Every change is read back to you before it happens.
            </p>
            <ul className={s.examples}>
              {EXAMPLES.map((ex) => (
                <li key={ex.label}>
                  <button
                    type="button"
                    className={s.example}
                    disabled={busy}
                    onClick={() => {
                      if (ex.fill) {
                        setText(ex.text);
                        requestAnimationFrame(() => boxRef.current?.focus());
                      } else void send(ex.text);
                    }}
                  >
                    {ex.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {messages.map((m) => (
          <Line key={m.id} m={m} waiting={m.action?.id === waitingId} busy={busy} onAnswer={onAnswer} />
        ))}

        {pending ? (
          <>
            <p className={`${s.bubble} ${s.mine}`}>{pending}</p>
            <p className={s.working} role="status">
              <span className={s.workingMark} aria-hidden="true">
                <AudioLines />
              </span>
              Working on it…
            </p>
          </>
        ) : building ? (
          <p className={s.working} role="status">
            <span className={s.workingMark} aria-hidden="true">
              <AudioLines />
            </span>
            Pricing it…
          </p>
        ) : null}

        {error ? (
          <p className={s.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {talk ? (
        <p className={s.heard} data-speaking={speech.speaking ? "" : undefined} role="status">
          {talkLine}
        </p>
      ) : null}
      <form
        className={s.composer}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className={s.srOnly} htmlFor={boxId}>
          Ask or tell the AI Operator
        </label>
        <textarea
          id={boxId}
          ref={boxRef}
          className={s.box}
          rows={1}
          value={text}
          placeholder={talk ? "Or type here…" : "Ask or tell JobFlex…"}
          maxLength={1200}
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        {canTalk ? (
          <button
            type="button"
            className={`${s.mic} ${talk ? (speech.speaking ? s.micSpeaking : s.micOn) : ""}`}
            aria-pressed={talk}
            aria-label={talk ? "Stop talking" : "Talk to the AI Operator — it answers out loud"}
            title={talk ? "Stop talking" : "Talk"}
            onClick={() => (talk ? endTalk() : startTalk())}
          >
            {talk ? speech.speaking ? <AudioLines /> : <Square /> : <Mic />}
          </button>
        ) : null}
        <button type="submit" className={s.send} disabled={busy || !text.trim()} aria-label="Send">
          <ArrowUp />
        </button>
      </form>
      {voiceError ? <p className={s.micError}>{voiceError}</p> : null}
      {feed?.usage.limit ? (
        <p className={s.usage}>
          {feed.usage.used} of {feed.usage.limit} requests this month
        </p>
      ) : null}
    </div>
  );
}

function Line({ m, waiting, busy, onAnswer }: { m: FeedMessage; waiting: boolean; busy: boolean; onAnswer: (id: string, yes: boolean, pin?: string) => Promise<void> }) {
  // A money card (shared PIN_TOOLS) takes the four digits beside Do it; they go to the server once and are never shown.
  const [pin, setPin] = useState("");
  if (m.direction === "IN") return <p className={`${s.bubble} ${s.mine}`}>{m.body}</p>;
  if (!m.action) return (
    <p className={`${s.bubble} ${s.theirs}`}>
      <Words text={m.body} />
    </p>
  );
  const a = m.action;
  const st = stamp(a, waiting);
  return (
    <div className={s.card} data-tone={st.tone}>
      <div className={s.cardHead}>
        <span className={s.cardLabel}>{TOOL_LABEL[a.tool] ?? "Change"}</span>
        <span className={s.stamp} data-tone={st.tone}>
          {st.label}
        </span>
      </div>
      <p className={s.cardText}>
        <Words text={shownBody(m)} />
      </p>
      {waiting && a.status === "AWAITING" ? (
        <div className={`${s.cardActions} ${PIN_TOOLS.includes(a.tool) ? s.withPin : ""}`}>
          {PIN_TOOLS.includes(a.tool) ? (
            <input
              className={s.pin}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoComplete="off"
              placeholder="PIN"
              aria-label="Your 4-digit PIN"
              value={pin}
              disabled={busy}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          ) : null}
          <button
            type="button"
            className={s.doIt}
            disabled={busy || (PIN_TOOLS.includes(a.tool) && pin.length !== 4)}
            onClick={() => void onAnswer(a.id, true, PIN_TOOLS.includes(a.tool) ? pin : undefined)}
          >
            Do it
          </button>
          <button type="button" className={s.cancel} disabled={busy} onClick={() => void onAnswer(a.id, false)}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A reply's words with its links tappable — a build's "Open it: https://…/dashboard/proposals/…", opened beside the
 *  panel so the conversation stays where it is. */
function Words({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} className={s.link} href={part} target="_blank" rel="noopener noreferrer">
            {part.includes("/dashboard/proposals/") ? "the proposal" : part.replace(/^https?:\/\//, "")}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}
