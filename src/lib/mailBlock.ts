// THE DO-NOT-EMAIL LIST — the database half (2026-11-11; the words and the rules are lib/mailBlockShared).
//
// SyncState `mailBlock:<address>` = { reason, source, at, orgId?, by? } (no schema change). Read by the two senders
// (lib/sdk/resend sendEmail, lib/email/orgSend sendOrgEmail) before every letter; written by every way out — the
// Unsubscribe links (/api/email/unsubscribe, /api/email/stop), a reply that says stop (lib/supportMail), an admin
// (/admin/mail/blocked, the user's card) and a company's "Don't email" on a client. The older answers (mailOptOut,
// ClientEmailOptOut, an outreach prospect's dnc) stay as they were; each new one is written here as well.
//
// No "server-only" import: lib/sdk/resend loads this lazily and stays importable from scripts.
import { MAIL_BLOCK_PREFIX, mailBlockKey, normalizeEmail, parseMailBlock, type MailBlock, type MailBlockSource } from "./mailBlockShared";

async function database() {
  return (await import("@/lib/db")).db;
}

/** The listed addresses among these (lower case). Throws when the list cannot be read — a sender then stops. */
export async function blockedAmong(addresses: readonly string[]): Promise<Set<string>> {
  const emails = [...new Set(addresses.map((a) => normalizeEmail(a)).filter((a): a is string => !!a))];
  if (!emails.length) return new Set();
  const db = await database();
  const rows = await db.syncState.findMany({ where: { key: { in: emails.map(mailBlockKey) } }, select: { key: true } });
  return new Set(rows.map((r) => r.key.slice(MAIL_BLOCK_PREFIX.length)));
}

export async function readMailBlock(address: string): Promise<MailBlock | null> {
  const email = normalizeEmail(address);
  if (!email) return null;
  const db = await database();
  const row = await db.syncState.findUnique({ where: { key: mailBlockKey(email) }, select: { cursor: true } });
  return row ? parseMailBlock(email, row.cursor) : null;
}

/** Put an address on the list. An address already on it keeps its first record — so a company's "Don't email" never
 *  turns the person's own unsubscribe into one that company could take back. False when it is not an address. */
export async function writeMailBlock(address: string, how: { source: MailBlockSource; reason: string; orgId?: string | null; by?: string | null }): Promise<boolean> {
  const email = normalizeEmail(address);
  if (!email) return false;
  const db = await database();
  const record: Omit<MailBlock, "email"> = { reason: how.reason.slice(0, 300), source: how.source, at: new Date().toISOString(), orgId: how.orgId ?? null, by: how.by ?? null };
  await db.syncState.upsert({ where: { key: mailBlockKey(email) }, create: { key: mailBlockKey(email), cursor: JSON.stringify(record) }, update: {} });
  return true;
}

/** Take an address off. `asCompany`: a company may take off only the row it put there itself. */
export async function removeMailBlock(address: string, opts: { asCompany?: string } = {}): Promise<"removed" | "absent" | "not-yours"> {
  const email = normalizeEmail(address);
  if (!email) return "absent";
  const row = await readMailBlock(email);
  if (!row) return "absent";
  if (opts.asCompany && !(row.source === "office" && row.orgId === opts.asCompany)) return "not-yours";
  const db = await database();
  await db.syncState.deleteMany({ where: { key: mailBlockKey(email) } });
  return "removed";
}

/** The list, newest first; `q` narrows by part of the address. */
export async function listMailBlocks(opts: { q?: string; take?: number } = {}): Promise<{ rows: MailBlock[]; total: number }> {
  const db = await database();
  const q = (opts.q ?? "").trim().toLowerCase();
  const where = { key: q ? { startsWith: MAIL_BLOCK_PREFIX, contains: q } : { startsWith: MAIL_BLOCK_PREFIX } };
  const [rows, total] = await Promise.all([
    db.syncState.findMany({ where, orderBy: { updatedAt: "desc" }, take: Math.min(opts.take ?? 500, 2000), select: { key: true, cursor: true } }),
    db.syncState.count({ where: { key: { startsWith: MAIL_BLOCK_PREFIX } } }),
  ]);
  return { rows: rows.map((r) => parseMailBlock(r.key.slice(MAIL_BLOCK_PREFIX.length), r.cursor)!), total };
}
