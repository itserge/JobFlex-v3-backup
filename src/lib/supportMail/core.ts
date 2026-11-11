// SUPPORT MAIL · READING THE BOX (owner, 2026-10-18: we stay on Gmail) — pure.
//
// What the cron does with each unread letter in the platform mailbox, with the
// mailbox and the database behind two small interfaces so the decisions can be
// run against a fake box (qa/tests/logic/support-mail.check.ts) and the real
// one (lib/supportMail/imap.ts) alike. lib/supportMail/run.ts wires them.
//
// A LETTER IS OURS when it was sent to one of our plus-addresses
// (app+t-<ticket>-<signature>@…, lib/supportInbound), or — the fallback for a
// mail app that ignored Reply-To — when it answers one of our letters
// (In-Reply-To / References = a Message-ID we sent) or carries
// "[JobFlex <REF>]" in its subject. Anything else in the box is a person's
// mail and is never touched.
//
// For a letter that is ours:
//   · a broken or forged plus-address, no ticket behind it, a sender who is
//     neither the ticket's customer nor our box / an admin (lib/supportThread
//     senderOnTicket), nothing left to say → label JobFlex/Unmatched and leave
//     it UNREAD, for a person;
//   · an out-of-office / machine reply, or a letter already in the
//     conversation (its Message-ID) → dropped: read, JobFlex/Processed;
//   · otherwise its new words (the quoted letter and the signature cut,
//     HTML read as text; attachments are not carried — a note says so) are
//     added to the conversation, from the customer or from the team, by the
//     same code as a reply in the app → read, JobFlex/Processed.
// A letter FROM our own box is only ever taken through a plus-address: the
// app's own notices to the support inbox carry the ticket's ref too, and must
// not come back as "the team said".
//
// A LETTER THAT SAYS STOP (2026-11-11). A letter that is not a ticket's, from someone outside the box and not a
// machine, is read once for its first line (lib/mailBlockShared isStopReply: "stop", "unsubscribe", "remove me",
// "opt out" and their close forms — the whole line, so "Thanks, stop by tomorrow at 3" is not). Such a letter puts
// its sender on the do-not-email list (deps.unsubscribe) and is filed read under JobFlex/Unsubscribed; any other is
// remembered as looked at (deps.checked) and left exactly as it was — unread, unlabelled, a person's.

import PostalMime from "postal-mime";
import { REPLY_LIMITS, checkReply } from "@/lib/supportReply";
import { emailAddressOf, htmlToText, isAutoReply, isPlusTicketAddress, refFromSubject, ticketFromPlusAddress, trimQuoted } from "@/lib/supportInbound";
import { isStopReply } from "@/lib/mailBlockShared";

/** What the box says about a letter before its body is read. */
export interface InboxLetter {
  uid: number;
  from: string | null;
  to: string[];
  cc: string[];
  /** Delivered-To / X-Original-To — Gmail keeps the plus-address there. */
  deliveredTo: string[];
  subject: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** The few headers that say "a machine wrote this", lower-case names. */
  headers: Record<string, string>;
  /** Already filed under JobFlex/Unmatched by an earlier run: a person's now. */
  unmatchedBefore?: boolean;
}

export interface InboxPort {
  /** Unread letters, oldest first, at most `limit`. */
  unseen(limit: number): Promise<InboxLetter[]>;
  /** The whole letter (RFC 822). */
  source(uid: number): Promise<Uint8Array | string>;
  /** Read + JobFlex/Processed. */
  done(uid: number): Promise<void>;
  /** JobFlex/Unmatched; stays unread. */
  unmatched(uid: number): Promise<void>;
  /** Read + JobFlex/Unsubscribed: a letter that asked us to stop, already acted on. */
  stopped(uid: number): Promise<void>;
}

export type Sender = { from: "customer" | "team"; authorUserId: string | null; authorName: string };

export interface InboxDeps {
  /** The box itself (lower case) and the key its plus-addresses are signed with. */
  mailbox: string;
  secret: string;
  ticketByRef(ref: string): Promise<string | null>;
  ticketByMessageIds(ids: string[]): Promise<string | null>;
  sender(ticketId: string, address: string): Promise<Sender | null>;
  alreadyHave(messageId: string): Promise<boolean>;
  post(input: { ticketId: string; from: "customer" | "team"; body: string; authorUserId: string | null; authorName: string; emailMessageId: string | null }): Promise<boolean>;
  /** A letter that is not a ticket's: already read for a stop by an earlier run? (`key` = its Message-ID, else uid.) */
  checked?(key: string): Promise<boolean>;
  /** …and remember it as read for one. */
  markChecked?(key: string): Promise<void>;
  /** Put the sender on the do-not-email list (and stop JobFlex's letters to an account they own). */
  unsubscribe?(address: string): Promise<void>;
}

export type LetterOutcome =
  | { uid: number; outcome: "added"; ticketId: string; from: "customer" | "team" }
  | { uid: number; outcome: "dropped"; why: "auto-reply" | "duplicate" }
  | { uid: number; outcome: "unmatched"; why: "bad-token" | "no-ticket" | "stranger" | "empty" | "ticket-gone" }
  | { uid: number; outcome: "unsubscribed"; address: string }
  | { uid: number; outcome: "not-ours" };

export interface InboxReport {
  checked: number;
  added: number;
  dropped: number;
  unmatched: number;
  /** Letters that asked to stop: their senders are on the do-not-email list now. */
  unsubscribed: number;
  letters: LetterOutcome[];
}

/** The note that stands in for anything attached — the conversation carries words only. */
export const ATTACHMENT_NOTE = "(Attachment not carried over — see the email.)";

const bare = (id: string) => id.trim().replace(/^<|>$/g, "");

/** The ticket a letter is about, and how we know: a valid plus-address wins; a forged one is "bad-token". */
export async function ticketOf(letter: InboxLetter, deps: Pick<InboxDeps, "mailbox" | "secret" | "ticketByRef" | "ticketByMessageIds">): Promise<
  { via: "plus"; ticketId: string } | { via: "thread" | "ref"; ticketId: string } | { via: "bad-token" } | { via: "candidate-no-ticket" } | { via: "none" }
> {
  const addresses = [...letter.to, ...letter.cc, ...letter.deliveredTo];
  for (const a of addresses) {
    const id = ticketFromPlusAddress(a, { mailbox: deps.mailbox, secret: deps.secret });
    if (id) return { via: "plus", ticketId: id };
  }
  if (addresses.some((a) => isPlusTicketAddress(a, deps.mailbox))) return { via: "bad-token" };
  const ids = [letter.inReplyTo, ...letter.references].filter((x): x is string => Boolean(x)).map(bare);
  const ref = refFromSubject(letter.subject);
  if (!ids.length && !ref) return { via: "none" };
  if (ids.length) {
    const t = await deps.ticketByMessageIds(ids);
    if (t) return { via: "thread", ticketId: t };
  }
  if (ref) {
    const t = await deps.ticketByRef(ref);
    if (t) return { via: "ref", ticketId: t };
  }
  // Answers something, but nothing of ours: only a [JobFlex REF] subject makes it a candidate.
  return ref ? { via: "candidate-no-ticket" } : { via: "none" };
}

/** The letter's new words: text part (else the HTML read as text), quote and signature cut, the attachment note. */
export async function wordsOf(raw: Uint8Array | string): Promise<{ body: string; attachments: number }> {
  const parsed = await PostalMime.parse(raw);
  const text = parsed.text?.trim() ? parsed.text : parsed.html ? htmlToText(parsed.html) : "";
  const attachments = (parsed.attachments ?? []).filter((a) => a.disposition !== "inline" || Boolean(a.filename)).length;
  let body = trimQuoted(text);
  if (attachments) body = body ? `${body}\n\n${ATTACHMENT_NOTE}` : ATTACHMENT_NOTE;
  if (body.length > REPLY_LIMITS.body) body = `${body.slice(0, REPLY_LIMITS.body - 1).trimEnd()}…`;
  return { body, attachments };
}

/** A letter that is nobody's ticket: does it ask to stop? Acted on when it does (true); remembered as looked at when
 *  it doesn't, and otherwise not touched. Machines (out-of-office, bounces) are never read for one. */
async function stopLetter(port: InboxPort, deps: InboxDeps, letter: InboxLetter, sender: string): Promise<boolean> {
  if (!deps.unsubscribe || !deps.checked || !deps.markChecked) return false;
  if (isAutoReply(letter.subject, letter.headers) || /^(mailer-daemon|postmaster|no-?reply)@/i.test(sender)) return false;
  const key = letter.messageId ? bare(letter.messageId) : `uid:${letter.uid}`;
  if (await deps.checked(key)) return false;
  const parsed = await PostalMime.parse(await port.source(letter.uid));
  const text = parsed.text?.trim() ? parsed.text : parsed.html ? htmlToText(parsed.html) : "";
  const words = trimQuoted(text);
  await deps.markChecked(key);
  if (!isStopReply(words)) return false;
  await deps.unsubscribe(sender);
  await port.stopped(letter.uid);
  return true;
}

/** One pass over the box. Never throws for one letter: a failure is logged and the letter left as it was. */
export async function processInbox(port: InboxPort, deps: InboxDeps, opts: { limit?: number; log?: (line: string) => void } = {}): Promise<InboxReport> {
  const log = opts.log ?? (() => {});
  const letters = await port.unseen(opts.limit ?? 25);
  const report: InboxReport = { checked: letters.length, added: 0, dropped: 0, unmatched: 0, unsubscribed: 0, letters: [] };
  const record = (o: LetterOutcome) => {
    report.letters.push(o);
    if (o.outcome === "added") report.added += 1;
    else if (o.outcome === "dropped") report.dropped += 1;
    else if (o.outcome === "unmatched") report.unmatched += 1;
    else if (o.outcome === "unsubscribed") report.unsubscribed += 1;
  };
  const park = async (uid: number, why: Extract<LetterOutcome, { outcome: "unmatched" }>["why"]) => {
    await port.unmatched(uid);
    record({ uid, outcome: "unmatched", why });
  };

  for (const letter of letters) {
    try {
      if (letter.unmatchedBefore) {
        record({ uid: letter.uid, outcome: "not-ours" }); // a person's to deal with now
        continue;
      }
      const sender = emailAddressOf(letter.from);
      const fromUs = sender === deps.mailbox;
      const t = await ticketOf(letter, deps);
      if (t.via === "none" || (fromUs && t.via !== "plus" && t.via !== "bad-token")) {
        if (t.via === "none" && !fromUs && sender && (await stopLetter(port, deps, letter, sender))) {
          record({ uid: letter.uid, outcome: "unsubscribed", address: sender });
          continue;
        }
        record({ uid: letter.uid, outcome: "not-ours" });
        continue;
      }
      if (t.via === "bad-token") {
        await park(letter.uid, "bad-token");
        continue;
      }
      if (t.via === "candidate-no-ticket") {
        await park(letter.uid, "no-ticket");
        continue;
      }
      if (isAutoReply(letter.subject, letter.headers)) {
        await port.done(letter.uid);
        record({ uid: letter.uid, outcome: "dropped", why: "auto-reply" });
        continue;
      }
      if (letter.messageId && (await deps.alreadyHave(bare(letter.messageId)))) {
        await port.done(letter.uid);
        record({ uid: letter.uid, outcome: "dropped", why: "duplicate" });
        continue;
      }
      const who = sender ? await deps.sender(t.ticketId, sender) : null;
      if (!who) {
        await park(letter.uid, "stranger");
        continue;
      }
      const { body } = await wordsOf(await port.source(letter.uid));
      const check = checkReply(body);
      if (!check.ok) {
        await park(letter.uid, "empty");
        continue;
      }
      const kept = await deps.post({
        ticketId: t.ticketId,
        from: who.from,
        body: check.body,
        authorUserId: who.authorUserId,
        authorName: who.authorName,
        emailMessageId: letter.messageId ? bare(letter.messageId) : null,
      });
      if (!kept) {
        await park(letter.uid, "ticket-gone");
        continue;
      }
      await port.done(letter.uid);
      record({ uid: letter.uid, outcome: "added", ticketId: t.ticketId, from: who.from });
    } catch (err) {
      log(`letter ${letter.uid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return report;
}
