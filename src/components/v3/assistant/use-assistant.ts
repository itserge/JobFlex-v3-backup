"use client";
// THE ASSISTANT · THE CONVERSATION'S STATE (2026-11-04), shared by the desk panel
// and the handheld page. The conversation lives in the database (AssistantMessage),
// so it is the same on every device: read when the surface opens, replaced by
// what each answer brings back. While a request is out, the person's words show
// at once (optimistically) with "Working on it…" under them.

import { useCallback, useRef, useState } from "react";
import { answerAssistant, askAssistant, loadAssistantFeed } from "@/actions/assistant";
import type { AssistantFeed, FeedMessage } from "@/lib/assistant/shared";

export type AssistantState = {
  feed: AssistantFeed | null;
  /** The person's words waiting for an answer (shown before the server has them). */
  pending: string | null;
  busy: boolean;
  error: string | null;
  load: () => void;
  ask: (text: string) => Promise<boolean>;
  answer: (actionId: string, yes: boolean) => Promise<void>;
};

const FAILED = "That didn't go through. Check your connection and try again.";

export function useAssistant(): AssistantState {
  const [feed, setFeed] = useState<AssistantFeed | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      .catch(() => setError("The Assistant couldn't load just now. Close it and open it again."))
      .finally(() => {
        loading.current = false;
      });
  }, []);

  const ask = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || busy) return false;
    setBusy(true);
    setPending(t);
    setError(null);
    try {
      const r = await askAssistant({ text: t });
      if (r.ok) setFeed(r.feed);
      else setError(r.error);
      return r.ok;
    } catch {
      setError(FAILED);
      return false;
    } finally {
      setPending(null);
      setBusy(false);
    }
  }, [busy]);

  const answer = useCallback(async (actionId: string, yes: boolean) => {
    if (busy) return;
    setBusy(true);
    setPending(yes ? "Do it" : "Cancel");
    setError(null);
    try {
      const r = await answerAssistant({ actionId, answer: yes ? "yes" : "no" });
      if (r.ok) setFeed(r.feed);
      else setError(r.error);
    } catch {
      setError(FAILED);
    } finally {
      setPending(null);
      setBusy(false);
    }
  }, [busy]);

  return { feed, pending, busy, error, load, ask, answer };
}

/** Messages with the read-back's own prompt line taken off (the card has its buttons). */
export function shownBody(m: FeedMessage): string {
  if (!m.action) return m.body;
  return m.body.replace(/\s*(Tap Do it to go ahead, or Cancel\.|Reply YES to do it, or NO\.)\s*$/, "");
}
