"use client";
// THE ASSISTANT · THE CONVERSATION'S STATE (2026-11-04), shared by the desk panel
// and the handheld page. The conversation lives in the database (AssistantMessage),
// so it is the same on every device: read when the surface opens, replaced by
// what each answer brings back. While a request is out, the person's words show
// at once (optimistically) with "Working on it…" under them. A build that takes
// a minute (slice 3) answers "On it…" first, then runs (/api/assistant/run) with
// "Pricing it…" showing, and the conversation is read again when it lands.

import { useCallback, useRef, useState } from "react";
import { answerAssistant, askAssistant, loadAssistantFeed } from "@/actions/assistant";
import type { AssistantFeed, FeedMessage } from "@/lib/assistant/shared";

export type AssistantState = {
  feed: AssistantFeed | null;
  /** The person's words waiting for an answer (shown before the server has them). */
  pending: string | null;
  busy: boolean;
  /** A build is running (a minute's estimate): its answer is on the way. */
  building: boolean;
  error: string | null;
  load: () => void;
  /** Sends a request; the reply's words, or null when it didn't go through. */
  ask: (text: string) => Promise<string | null>;
  /** Do it / Cancel on a read-back; the reply's words, or null. */
  answer: (actionId: string, yes: boolean) => Promise<string | null>;
};

const FAILED = "That didn't go through. Check your connection and try again.";

export function useAssistant(): AssistantState {
  const [feed, setFeed] = useState<AssistantFeed | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);

  const load = useCallback(() => {
    if (loading.current) return;
    loading.current = true;
    loadAssistantFeed()
      .then((f) => {
        setFeed(f);
        setError(null);
      })
      .catch(() => setError("The AI Operator couldn't load just now. Close it and open it again."))
      .finally(() => {
        loading.current = false;
      });
  }, []);

  const ask = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || busy) return null;
    setBusy(true);
    setPending(t);
    setError(null);
    try {
      const r = await askAssistant({ text: t });
      if (!r.ok) {
        setError(r.error);
        return null;
      }
      setFeed(r.feed);
      if (!r.running) return r.reply;
      // A build left to run: "On it…" is on screen; run it, then show what it made (the price, the link, the send).
      setPending(null);
      setBuilding(true);
      const seen = r.feed.messages[r.feed.messages.length - 1]?.id ?? null;
      const ran = await fetch("/api/assistant/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.running }) })
        .then((x) => (x.ok ? (x.json() as Promise<{ ran?: boolean }>) : null))
        .catch(() => null);
      // Run elsewhere (the minute job got it first) or the call was cut off: watch for its answer, a few minutes at most.
      let after = await loadAssistantFeed().catch(() => null);
      const newest = (f: AssistantFeed | null) => f?.messages[f.messages.length - 1]?.id ?? null;
      for (let i = 0; !ran?.ran && i < 45 && newest(after) === seen; i++) {
        await new Promise((res) => setTimeout(res, 4000));
        after = await loadAssistantFeed().catch(() => null);
      }
      if (!after) return r.reply;
      setFeed(after);
      const last = after.messages[after.messages.length - 1];
      return last && last.direction === "OUT" ? last.body : r.reply;
    } catch {
      setError(FAILED);
      return null;
    } finally {
      setPending(null);
      setBuilding(false);
      setBusy(false);
    }
  }, [busy]);

  const answer = useCallback(async (actionId: string, yes: boolean) => {
    if (busy) return null;
    setBusy(true);
    setPending(yes ? "Do it" : "Cancel");
    setError(null);
    try {
      const r = await answerAssistant({ actionId, answer: yes ? "yes" : "no" });
      if (r.ok) setFeed(r.feed);
      else setError(r.error);
      return r.ok ? r.reply : null;
    } catch {
      setError(FAILED);
      return null;
    } finally {
      setPending(null);
      setBusy(false);
    }
  }, [busy]);

  return { feed, pending, busy, building, error, load, ask, answer };
}

/** A reply as it is read out: the read-back's tap prompt becomes a spoken one, a dash range "to". */
export function forSpeech(text: string): string {
  return text
    .replace(/Tap Do it to go ahead, or Cancel\.?/g, "Say yes to do it, or no.")
    // A link is for the eyes: it is on the screen, never read out letter by letter.
    .replace(/Open it:\s*https?:\/\/\S+/g, "The link is on your screen.")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s*–\s*/g, " to ")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Messages with the read-back's own prompt line taken off (the card has its buttons). */
export function shownBody(m: FeedMessage): string {
  if (!m.action) return m.body;
  return m.body.replace(/\s*(Tap Do it to go ahead, or Cancel\.|Reply YES to do it, or NO\.)\s*$/, "");
}
