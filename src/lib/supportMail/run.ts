import "server-only";
// SUPPORT MAIL · ONE RUN OF THE CRON (2026-10-18) — /api/cron/support-mail.
//
// Reads the platform mailbox (lib/supportMail/imap — or, for a local test, the
// folder box of lib/supportMail/mockPort), decides each letter
// (lib/supportMail/core) and adds the replies to their tickets through the one
// path every door takes (lib/support/acceptMessage). Production only
// (lib/supportMail/config); off it, or without a mailbox, it returns at once
// and says why. A failed login or a broken run is logged and kept, never
// thrown: the cron answers 200 either way, and /admin/health shows
// "Support inbox · last checked / last error" from SyncState
// `supportMail:status`. Two runs never overlap (a 2-minute lease).
import { db } from "@/lib/db";
import { supportMailConfig } from "./config";
import { processInbox, type InboxDeps, type InboxReport } from "./core";
import { withGmailInbox } from "./imap";
import { mockInboxDir, withMockInbox } from "./mockPort";
import { senderOnTicket } from "@/lib/supportThread";
import { acceptSupportMessage } from "@/lib/support/acceptMessage";
import { writeMailBlock } from "@/lib/mailBlock";
import { writeOptOut } from "@/lib/adminMail/optout";

export const SUPPORT_MAIL_STATUS_KEY = "supportMail:status";
const LEASE_KEY = "supportMail:lease";
/** The letters that are nobody's ticket and were already read for a "stop" (lib/supportMail/core stopLetter). */
const STOP_CHECKED_KEY = "supportMail:stopChecked";
const STOP_CHECKED_KEEP = 1000;
const LEASE_MS = 2 * 60_000;

export interface SupportMailStatus {
  /** The last time the box was read to the end. */
  checkedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** The last run's counts. */
  last?: { checked: number; added: number; dropped: number; unmatched: number; unsubscribed?: number };
}

export async function readSupportMailStatus(): Promise<SupportMailStatus | null> {
  const row = await db.syncState.findUnique({ where: { key: SUPPORT_MAIL_STATUS_KEY } }).catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.cursor) as SupportMailStatus;
  } catch {
    return null;
  }
}

async function writeStatus(patch: Partial<SupportMailStatus>): Promise<void> {
  const prev = (await readSupportMailStatus()) ?? { checkedAt: null, lastError: null, lastErrorAt: null };
  const cursor = JSON.stringify({ ...prev, ...patch });
  await db.syncState
    .upsert({ where: { key: SUPPORT_MAIL_STATUS_KEY }, create: { key: SUPPORT_MAIL_STATUS_KEY, cursor }, update: { cursor } })
    .catch(() => undefined);
}

/** A 2-minute lease in SyncState: a run that finds a live one steps aside. */
async function takeLease(): Promise<boolean> {
  const now = Date.now();
  const row = await db.syncState.findUnique({ where: { key: LEASE_KEY } }).catch(() => null);
  if (row && Number(row.cursor) > now) return false;
  const cursor = String(now + LEASE_MS);
  try {
    if (row) {
      const r = await db.syncState.updateMany({ where: { key: LEASE_KEY, cursor: row.cursor }, data: { cursor } });
      return r.count === 1;
    }
    await db.syncState.create({ data: { key: LEASE_KEY, cursor } });
    return true;
  } catch {
    return false;
  }
}
async function dropLease(): Promise<void> {
  await db.syncState.updateMany({ where: { key: LEASE_KEY }, data: { cursor: "0" } }).catch(() => undefined);
}

/** A login failure or a socket error, in words, with nothing secret in it. */
function errorWords(err: unknown, pass: string): string {
  const e = err as { responseText?: string; message?: string; code?: string };
  const text = (e?.responseText || e?.message || String(err)).replace(pass, "•••").slice(0, 300);
  return e?.code ? `${text} (${e.code})` : text;
}

async function readStopChecked(): Promise<string[]> {
  const row = await db.syncState.findUnique({ where: { key: STOP_CHECKED_KEY }, select: { cursor: true } }).catch(() => null);
  try {
    const v = JSON.parse(row?.cursor ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function depsFor(mailbox: string, secret: string): InboxDeps {
  const variants = (id: string) => [id, `<${id}>`];
  return {
    mailbox,
    secret,
    async ticketByRef(ref) {
      const t = await db.supportTicket.findFirst({ where: { id: { endsWith: ref.toLowerCase() } }, orderBy: { createdAt: "desc" }, select: { id: true } });
      return t?.id ?? null;
    },
    async ticketByMessageIds(ids) {
      const m = await db.supportMessage.findFirst({ where: { emailMessageId: { in: ids.flatMap(variants) } }, select: { ticketId: true } });
      return m?.ticketId ?? null;
    },
    async sender(ticketId, address) {
      if (address === mailbox) return { from: "team", authorUserId: null, authorName: "JobFlex support" };
      return senderOnTicket(ticketId, address);
    },
    async alreadyHave(messageId) {
      return Boolean(await db.supportMessage.findFirst({ where: { emailMessageId: { in: variants(messageId) } }, select: { id: true } }));
    },
    async post(input) {
      const r = await acceptSupportMessage({ ...input, channel: "email" });
      return Boolean(r);
    },
    async checked(key) {
      return (await readStopChecked()).includes(key);
    },
    async markChecked(key) {
      const list = [key, ...(await readStopChecked()).filter((k) => k !== key)].slice(0, STOP_CHECKED_KEEP);
      const cursor = JSON.stringify(list);
      await db.syncState.upsert({ where: { key: STOP_CHECKED_KEY }, create: { key: STOP_CHECKED_KEY, cursor }, update: { cursor } });
    },
    async unsubscribe(address) {
      // The do-not-email list (lib/mailBlock), and JobFlex's own letters to every account this address owns.
      await writeMailBlock(address, { source: "reply", reason: "Replied “stop” to an email from JobFlex" });
      // Accounts keep their address in lower case (the sign-up and the sign-in lower it), as emailAddressOf does.
      const owned = await db.membership.findMany({ where: { role: "OWNER", user: { email: address.toLowerCase() } }, select: { organizationId: true } });
      for (const m of owned) await writeOptOut(m.organizationId, "reply");
      console.info(`[support-mail] a reply asked to stop: …@${address.split("@")[1] ?? ""} is on the do-not-email list${owned.length ? ` (owner of ${owned.length} account${owned.length === 1 ? "" : "s"})` : ""}`);
    },
  };
}

export type SupportMailRun =
  | { ok: true; skipped: string }
  | { ok: true; report: Omit<InboxReport, "letters">; letters: InboxReport["letters"] }
  | { ok: false; error: string };

export async function runSupportMail(): Promise<SupportMailRun> {
  const cfg = supportMailConfig();
  if (!cfg.ok) {
    console.info(`[support-mail] skipped: ${cfg.why}`);
    return { ok: true, skipped: cfg.why };
  }
  if (!(await takeLease())) return { ok: true, skipped: "another run holds the box" };
  const { config } = cfg;
  const mock = mockInboxDir();
  try {
    const deps = depsFor(config.user, config.secret);
    const log = (line: string) => console.warn(`[support-mail] ${line}`);
    const report = mock
      ? await withMockInbox(mock, (port) => processInbox(port, deps, { log }))
      : await withGmailInbox(config, (port) => processInbox(port, deps, { log }));
    const { letters, ...counts } = report;
    await writeStatus({ checkedAt: new Date().toISOString(), last: counts });
    if (counts.added || counts.unmatched || counts.dropped || counts.unsubscribed) {
      console.info(`[support-mail] ${counts.checked} unread · ${counts.added} added · ${counts.dropped} dropped · ${counts.unmatched} unmatched · ${counts.unsubscribed} unsubscribed`);
    }
    return { ok: true, report: counts, letters };
  } catch (err) {
    const error = errorWords(err, config.pass);
    console.error(`[support-mail] the box could not be read: ${error}`);
    await writeStatus({ lastError: error, lastErrorAt: new Date().toISOString() });
    return { ok: false, error };
  } finally {
    await dropLease();
  }
}
