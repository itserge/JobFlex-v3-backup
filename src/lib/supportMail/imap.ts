import "server-only";
// SUPPORT MAIL · THE GMAIL BOX OVER IMAP (2026-10-18) — the real InboxPort
// (lib/supportMail/core) on imapflow. INBOX, unread letters of the last two
// weeks, oldest first; "done" = \Seen + the Gmail label JobFlex/Processed,
// "unmatched" = the label JobFlex/Unmatched and nothing else (it stays unread
// for a person, and later runs pass over it). Labels are created on first use.
// Gmail's IMAP needs IMAP enabled on the box (Settings → Forwarding and
// POP/IMAP) and, with 2-step verification, an app password — the same one SMTP
// already uses.
import { ImapFlow, type FetchMessageObject } from "imapflow";
import type { InboxLetter, InboxPort } from "./core";
import type { SupportMailConfig } from "./config";

export const PROCESSED_LABEL = "JobFlex/Processed";
export const UNMATCHED_LABEL = "JobFlex/Unmatched";
/** A letter that asked us to stop (lib/supportMail/core stopLetter): read, its sender on the do-not-email list. */
export const UNSUBSCRIBED_LABEL = "JobFlex/Unsubscribed";
const LOOKBACK_DAYS = 14;
const HEADER_KEYS = ["delivered-to", "x-original-to", "references", "auto-submitted", "x-autoreply", "x-autorespond", "x-auto-response-suppress", "precedence"];

/** "Name: value" lines (folded lines joined) → lower-case name → values. */
function headerMap(raw: Buffer | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw) return out;
  const text = raw.toString("utf8").replace(/\r?\n[ \t]+/g, " ");
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    (out[k] ??= []).push(line.slice(i + 1).trim());
  }
  return out;
}

const addr = (list?: Array<{ name?: string; address?: string }>) =>
  (list ?? []).map((a) => a.address ?? "").filter(Boolean);

function letterOf(m: FetchMessageObject): InboxLetter {
  const h = headerMap(m.headers as Buffer | undefined);
  const env = m.envelope;
  const from = env?.from?.[0];
  return {
    uid: m.uid,
    from: from?.address ? (from.name ? `${from.name} <${from.address}>` : from.address) : null,
    to: addr(env?.to),
    cc: addr(env?.cc),
    deliveredTo: [...(h["delivered-to"] ?? []), ...(h["x-original-to"] ?? [])],
    subject: env?.subject ?? "",
    messageId: env?.messageId ?? null,
    inReplyTo: env?.inReplyTo ?? null,
    references: (h["references"] ?? []).join(" ").split(/\s+/).filter(Boolean),
    headers: Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v.join(", ")])),
    unmatchedBefore: m.labels ? [...m.labels].some((l) => l === UNMATCHED_LABEL) : false,
  };
}

/** Open the box, hand `run` the port, always log out. */
export async function withGmailInbox<T>(cfg: SupportMailConfig, run: (port: InboxPort) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    socketTimeout: 45_000,
  });
  await client.connect();
  try {
    for (const label of [PROCESSED_LABEL, UNMATCHED_LABEL, UNSUBSCRIBED_LABEL]) {
      await client.mailboxCreate(label.split("/")).catch(() => undefined); // exists already: fine
    }
    const lock = await client.getMailboxLock("INBOX");
    try {
      const port: InboxPort = {
        async unseen(limit) {
          const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
          const found = await client.search({ seen: false, since }, { uid: true });
          const uids = (found || []).sort((a, b) => a - b).slice(-limit);
          if (!uids.length) return [];
          const letters: InboxLetter[] = [];
          for await (const m of client.fetch(uids, { uid: true, envelope: true, labels: true, headers: HEADER_KEYS }, { uid: true })) {
            letters.push(letterOf(m));
          }
          return letters.sort((a, b) => a.uid - b.uid);
        },
        async source(uid) {
          const m = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!m || !m.source) throw new Error("the letter's source could not be read");
          return m.source;
        },
        async done(uid) {
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
          await client.messageFlagsAdd(String(uid), [PROCESSED_LABEL], { uid: true, useLabels: true });
        },
        async unmatched(uid) {
          await client.messageFlagsAdd(String(uid), [UNMATCHED_LABEL], { uid: true, useLabels: true });
        },
        async stopped(uid) {
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
          await client.messageFlagsAdd(String(uid), [UNSUBSCRIBED_LABEL], { uid: true, useLabels: true });
        },
      };
      return await run(port);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}
