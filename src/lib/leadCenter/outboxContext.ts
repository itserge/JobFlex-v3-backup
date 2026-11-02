// THE TEST ENVIRONMENT'S OUTBOX SWITCH (owner, 2026-10-29: "a testing environment where we can send out automatic
// leads without actually sending, so we can test and debug").
//
// While a step of a test-environment lead runs (lib/leadCenter/sandbox → inLeadSandbox), this context is set, and
// the two places every message leaves the app — sendEmail (lib/sdk/resend) and sendText (lib/sms/send) — hand the
// message to `record` instead of the provider. Nothing else changes: the same code builds the same letter.
//
// No database here on purpose: lib/sdk/resend stays importable anywhere. Server only (node:async_hooks).
import { AsyncLocalStorage } from "node:async_hooks";

export type CapturedMessage = {
  channel: "email" | "sms";
  to: string;
  subject?: string | null;
  /** The letter's HTML, or the text's words. */
  body: string;
  /** Why it would or would not have gone (an SMS gate, say). */
  note?: string | null;
  /** The message's kind — the mail log's, or the text's. */
  what?: string | null;
};

export type OutboxCapture = {
  platformLeadId: string;
  record: (m: CapturedMessage) => Promise<void>;
};

const store = new AsyncLocalStorage<OutboxCapture>();

/** The capture in force for this call, if a test-environment lead's step is running. */
export function activeCapture(): OutboxCapture | undefined {
  return store.getStore();
}

export function runCaptured<T>(capture: OutboxCapture, fn: () => Promise<T>): Promise<T> {
  return store.run(capture, fn);
}
