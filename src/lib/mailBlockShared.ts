// THE DO-NOT-EMAIL LIST — the pure half (2026-11-11). Browser-safe: the key, the record, which letters still go to a
// listed address, and the reading of a reply that asks us to stop. The database half is lib/mailBlock.
//
// One row per address, SyncState `mailBlock:<address in lower case>`, whatever asked for it: the Unsubscribe link or
// the mail app's one-click button in any of our letters ("link"), a reply that says stop ("reply"), an admin
// ("admin"), a company's "Don't email" on a client ("office"). lib/sdk/resend sendEmail and lib/email/orgSend
// sendOrgEmail (the company's own Gmail too) leave a listed address out of every MARKETING letter.
//
// WHAT IT STOPS (owner, 2026-11-11): every sender says what its letter is — `mailClass` on sendEmail / sendOrgEmail:
//   · "marketing"     — campaigns, win-back, the lead set-up and homeowner reminders, follow-ups, review requests,
//                       SmartBook's letters, the team's letters to contractors, welcome: stopped for a listed address,
//                       and stopped too when the list cannot be read.
//   · "transactional" — codes, password resets, security notices, support answers, proposals and their acceptance,
//                       change orders, invoices, receipts, payment reminders, dunning, visit and booking letters, a
//                       person's own letters from the Inbox or the client card, team invites, the team's event notices
//                       (their own switches in Settings): always go — the list is not even read for them.
// A letter with no mailClass counts as marketing, so a new sender can never slip past the list by accident.
//
// WHO WRITES IT: JobFlex's own Unsubscribe link, a "stop" reply to app@jobflex.app, an admin. A company's link and its
// "Don't email" switch are that company's alone (ClientEmailOptOut, lib/winback/optout) and never land here.

export const MAIL_BLOCK_PREFIX = "mailBlock:";

export const MAIL_BLOCK_SOURCES = ["link", "reply", "admin", "office"] as const;
export type MailBlockSource = (typeof MAIL_BLOCK_SOURCES)[number];

export interface MailBlock {
  email: string;
  /** In words, for the admin list: "Unsubscribe link in a campaign from Acme Roofing", "Replied “stop”". */
  reason: string;
  source: MailBlockSource;
  /** ISO time it was listed. */
  at: string;
  /** The company behind an "office" row (only that company may take it off), or the account a link named. */
  orgId?: string | null;
  /** Who did it, when a person in the app did: the admin's or the member's email. */
  by?: string | null;
}

export const SOURCE_LABEL: Record<MailBlockSource, string> = {
  link: "Unsubscribe link",
  reply: "Replied stop",
  admin: "Admin",
  office: "A company",
};

/** "Jane <JANE@x.com>" → "jane@x.com"; null when it is not an address. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  const inner = s.match(/<([^>]+)>/)?.[1] ?? s;
  const v = inner.trim().toLowerCase();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v) && v.length <= 254 ? v : null;
}

export const mailBlockKey = (email: string): string => `${MAIL_BLOCK_PREFIX}${email.trim().toLowerCase()}`;

/** What a letter is, for the list (see the head of this file). Absent = marketing. */
export type MailClass = "marketing" | "transactional";

export function parseMailBlock(email: string, cursor: string | null | undefined): MailBlock | null {
  try {
    const v = JSON.parse(cursor ?? "") as Partial<MailBlock>;
    const source = (MAIL_BLOCK_SOURCES as readonly string[]).includes(v.source ?? "") ? (v.source as MailBlockSource) : "admin";
    return { email, reason: typeof v.reason === "string" ? v.reason : "", source, at: typeof v.at === "string" ? v.at : "", orgId: v.orgId ?? null, by: v.by ?? null };
  } catch {
    return { email, reason: "", source: "admin", at: "", orgId: null, by: null };
  }
}

// ── A reply that asks us to stop ────────────────────────────────────────────

const GREETING = /^(hi|hello|hey|dear|good (morning|afternoon|evening)|greetings)\b[^.!?]{0,40}[,!.:]?$/i;

/** The first line that says something: blank lines and a bare greeting ("Hi Dmitriy,") are passed over. */
export function firstMeaningfulLine(text: string): string {
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/ /g, " ").trim();
    if (!line || /^[-_=*~.]+$/.test(line)) continue;
    if (GREETING.test(line)) continue;
    return line;
  }
  return "";
}

/** The ways people write "take me off": the whole line must be one of these (after "please" and "thanks" are taken
 *  off its ends) — "Thanks, stop by tomorrow at 3" and "Stop by at 3" are not. "Cancel" is not here on purpose: it is
 *  a billing word, not a mail one. */
const STOP_LINE = new RegExp(
  "^(?:" +
    [
      "stop",
      "stop it",
      "stop all",
      "stop all emails?",
      "stop (?:emailing|mailing|messaging|contacting|spamming|sending)(?: me| us)?(?: (?:emails?|mail|these|these emails|this))?(?: again)?",
      "stop sending (?:me |us )?(?:emails?|these(?: emails)?|this)",
      "no more (?:emails?|mail|messages)",
      "unsubscribe",
      "unsub",
      "unsubscribe (?:me|us)(?: from (?:this|these|your|the) (?:list|mailing list|email list|emails?|newsletter))?",
      "unsubscribe from (?:this|these|your|the) (?:list|mailing list|email list|emails?|newsletter)",
      "remove",
      "remove me",
      "remove us",
      "remove (?:me|us|my email|this email|this address) from (?:this|your|the) (?:list|mailing list|email list|emails?|database)",
      "take (?:me|us) off(?: (?:this|your|the) (?:list|mailing list|email list))?",
      "opt (?:me |us )?out",
      "optout",
      "opt out of (?:this|these|your) (?:emails?|list)",
      "(?:do not|dont|don't) (?:email|contact|mail|message) (?:me|us)(?: again| anymore| any more)?",
      "leave me alone",
    ].join("|") +
    ")$",
  "i",
);

/** Did this reply ask to stop? `text` is what the person wrote, the quoted letter already cut. */
export function isStopReply(text: string): boolean {
  const line = firstMeaningfulLine(text);
  if (!line || line.length > 90) return false;
  let w = line
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // "Please unsubscribe me, thanks." → "unsubscribe me"
  for (let i = 0; i < 3; i++) {
    w = w
      .replace(/^(?:please|pls|plz|kindly|ok|okay)\s+/, "")
      .replace(/\s+(?:please|pls|plz|thanks|thank you|thx|asap|now|immediately|right now|thank you very much)$/, "")
      .trim();
  }
  return STOP_LINE.test(w);
}
