"use client";
// THE ASSISTANT · THE CONVERSATION'S STATE (2026-11-04), shared by the desk panel
// and the handheld page. The conversation lives in the database (AssistantMessage),
// so it is the same on every device: read when the surface opens, replaced by
// what each answer brings back. While a request is out, the person's words show
// at once (optimistically) with "Working on it…" under them. A build that takes
// a while (slice 3) answers "On it…" first — that reply comes back at once, to be
// spoken — then runs (/api/assistant/run) while the conversation is read every
// few seconds (the sheet's trace moves), and lands as `landed` when it is done.

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { answerAssistant, askAssistant, loadAssistantFeed, loadAssistantTasks } from "@/actions/assistant";
import { DEFAULT_SPEECH_LANG, isSpeechLang, type AssistantFeed, type FeedAction, type FeedMessage, type SpeechLang } from "@/lib/assistant/shared";

export type AssistantState = {
  feed: AssistantFeed | null;
  /** The person's words waiting for an answer (shown before the server has them). */
  pending: string | null;
  busy: boolean;
  /** Whether a request or an answer is out right now — read at the moment, not as of the last render (the ears hear
   *  between renders: a sentence heard then is queued, never sent into a refusal and lost). */
  isBusy: () => boolean;
  /** A build is running (an estimate): its answer is on the way. */
  building: boolean;
  /** The last build's words when it landed, for the voice (a new object each time). */
  landed: { id: string; text: string } | null;
  error: string | null;
  /** The Tasks sheet: the person's changes of the last week, newest first (null until read). */
  tasks: FeedAction[] | null;
  /** Spoken answers off (a loud site); remembered on this device. */
  muted: boolean;
  setMuted: (m: boolean) => void;
  /** The language they speak to it in (Settings → AI Operator), remembered on this device so the ears have it before
   *  the conversation loads; every feed that arrives refreshes it. */
  lang: SpeechLang;
  load: () => void;
  loadTasks: () => void;
  /** Sends a request; the reply's words, or null when it didn't go through. A build's first words come back at once.
   *  `spoken`: it was said aloud and the reply is read aloud — the Operator answers in a sentence. */
  ask: (text: string, opts?: { spoken?: boolean }) => Promise<string | null>;
  /** Do it / Cancel on a read-back; the reply's words, or null. `pin`: the four digits a money card asks for. */
  answer: (actionId: string, yes: boolean, pin?: string) => Promise<string | null>;
};

const FAILED = "That didn't go through. Check your connection and try again.";
const MUTED_KEY = "jf-operator-muted";

function readMuted(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}
const MUTED_EVENT = "jf-operator-muted";
function subscribeMuted(onChange: () => void) {
  window.addEventListener(MUTED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MUTED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const LANG_KEY = "jf-operator-lang";
const LANG_EVENT = "jf-operator-lang";
function readLang(): SpeechLang {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(LANG_KEY) : null;
    return isSpeechLang(v) ? v : DEFAULT_SPEECH_LANG;
  } catch {
    return DEFAULT_SPEECH_LANG;
  }
}
function subscribeLang(onChange: () => void) {
  window.addEventListener(LANG_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(LANG_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
function rememberLang(lang: SpeechLang) {
  if (readLang() === lang) return;
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* no storage here */
  }
  window.dispatchEvent(new Event(LANG_EVENT));
}

export function useAssistant(): AssistantState {
  const [feed, setFeed] = useState<AssistantFeed | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const [landed, setLanded] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<FeedAction[] | null>(null);
  const muted = useSyncExternalStore(subscribeMuted, readMuted, () => false);
  const lang = useSyncExternalStore(subscribeLang, readLang, () => DEFAULT_SPEECH_LANG);
  const loading = useRef(false);
  const runs = useRef(0);
  const out = useRef(false);
  const isBusy = useCallback(() => out.current, []);

  const setMuted = useCallback((m: boolean) => {
    try {
      window.localStorage.setItem(MUTED_KEY, m ? "1" : "0");
    } catch {
      /* no storage here */
    }
    window.dispatchEvent(new Event(MUTED_EVENT));
  }, []);

  /** A conversation that arrived: shown, and its language setting kept on the device. */
  const takeFeed = useCallback((f: AssistantFeed) => {
    setFeed(f);
    rememberLang(f.lang);
  }, []);

  const load = useCallback(() => {
    if (loading.current) return;
    loading.current = true;
    loadAssistantFeed()
      .then((f) => {
        takeFeed(f);
        setError(null);
      })
      .catch(() => setError("The AI Operator couldn't load just now. Close it and open it again."))
      .finally(() => {
        loading.current = false;
      });
  }, [takeFeed]);

  const loadTasks = useCallback(() => {
    loadAssistantTasks()
      .then(setTasks)
      .catch(() => setError("Couldn't read your tasks just now."));
  }, []);

  /** A build left to run: run it, read the conversation every few seconds meanwhile, and say when it landed. */
  const runBuild = useCallback(async (id: string, before: AssistantFeed) => {
    const run = ++runs.current;
    const newest = (f: AssistantFeed | null) => f?.messages[f.messages.length - 1]?.id ?? null;
    const seen = newest(before);
    setBuilding(true);
    let done = false;
    const call = fetch("/api/assistant/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
      .then((x) => (x.ok ? (x.json() as Promise<{ ran?: boolean }>) : null))
      .catch(() => null)
      .finally(() => {
        done = true;
      });
    // The trace moves while it runs; a build run elsewhere (the minute job) is seen the same way, a few minutes at most.
    let after: AssistantFeed | null = null;
    for (let i = 0; i < 70 && run === runs.current; i++) {
      await new Promise((res) => setTimeout(res, 2500));
      after = await loadAssistantFeed().catch(() => null);
      if (after) takeFeed(after);
      if (newest(after) !== seen) break;
      if (done) {
        const r = await call;
        if (r?.ran) {
          after = await loadAssistantFeed().catch(() => after);
          if (after) takeFeed(after);
          break;
        }
      }
    }
    if (run !== runs.current) return;
    setBuilding(false);
    const last = after?.messages[after.messages.length - 1];
    if (last && last.direction === "OUT" && last.id !== seen) setLanded({ id: last.id, text: last.body });
  }, [takeFeed]);

  const ask = useCallback(
    async (text: string, opts?: { spoken?: boolean }) => {
      const t = text.trim();
      if (!t || out.current) return null;
      out.current = true;
      setBusy(true);
      setPending(t);
      setError(null);
      try {
        const r = await askAssistant({ text: t, ...(opts?.spoken ? { spoken: true } : {}) });
        if (!r.ok) {
          setError(r.error);
          return null;
        }
        takeFeed(r.feed);
        if (r.running) void runBuild(r.running, r.feed);
        return r.reply;
      } catch {
        setError(FAILED);
        return null;
      } finally {
        out.current = false;
        setPending(null);
        setBusy(false);
      }
    },
    [runBuild, takeFeed],
  );

  const answer = useCallback(
    async (actionId: string, yes: boolean, pin?: string) => {
      if (out.current) return null;
      out.current = true;
      setBusy(true);
      setPending(yes ? "Do it" : "Cancel");
      setError(null);
      try {
        const r = await answerAssistant({ actionId, answer: yes ? "yes" : "no", ...(pin ? { pin } : {}) });
        if (r.ok) takeFeed(r.feed);
        else setError(r.error);
        return r.ok ? r.reply : null;
      } catch {
        setError(FAILED);
        return null;
      } finally {
        out.current = false;
        setPending(null);
        setBusy(false);
      }
    },
    [takeFeed],
  );

  return { feed, pending, busy, isBusy, building, landed, error, tasks, muted, setMuted, lang, load, loadTasks, ask, answer };
}

/** A reply as it is read out: the read-back's tap prompt becomes a spoken one, a dash range "to", money in whole
 *  dollars with the tax folded in (2026-11-05: "$14,968.83 ($14,121.54 + $847.29 tax)" is said "$14,969 with tax"). */
export function forSpeech(text: string): string {
  return text
    .replace(/Enter your PIN and tap Do it, or Cancel\.?/g, "Enter your PIN on the screen, then tap Do it.")
    .replace(/Tap Do it to go ahead, or Cancel\.?/g, "Say yes to do it, or no.")
    // A link is for the eyes: it is on the screen, never read out letter by letter.
    .replace(/Open it:\s*https?:\/\/\S+/g, "The link is on your screen.")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s*\(\$[\d,]+(?:\.\d{2})?\s*\+\s*\$[\d,]+(?:\.\d{2})?\s*tax\)/g, " with tax")
    .replace(/\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})/g, (_m, whole: string, cents: string) => `$${Math.round(Number(whole.replace(/,/g, "")) + Number(cents) / 100).toLocaleString("en-US")}`)
    .replace(/\s*–\s*/g, " to ")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Messages with the read-back's own prompt line taken off (the card has its buttons). */
export function shownBody(m: FeedMessage): string {
  if (!m.action) return m.body;
  return m.body.replace(/\s*(Tap Do it to go ahead, or Cancel\.|Enter your PIN and tap Do it, or Cancel\.|Reply YES to do it, or NO\.|Reply YES and your PIN \(like YES 1234\), or NO\.)\s*$/, "");
}
