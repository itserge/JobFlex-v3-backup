// UNSUBSCRIBE (owner, 2026-10-08: "make it not go to spam"). Every email the
// team sends a contractor by hand — and the win-back mails — carries a link
// and the one-click List-Unsubscribe header (RFC 8058) that Gmail and Yahoo
// show as an "Unsubscribe" button beside the sender: a reader who can leave
// in one click does not press "Report spam", and spam reports are what sink
// a sending domain. The answer is kept per account in SyncState
// `mailOptOut:<orgId>` and honoured by every sender that reads it.
//
// The link carries the account and an HMAC of it (the platform's
// NEXTAUTH_SECRET), so nobody can unsubscribe somebody else by guessing.
//
// 2026-11-11: the link may also name the address the letter went to (`e`, signed with the account): pressing it then
// puts that address on the do-not-email list (lib/mailBlock) as well. A link without `e` (sent before) lists the
// account owner's address. Besides an account: `prospect_<id>` (lib/outreach, a contractor with no account) and
// `home_<id>` (a homeowner's dashboard, lib/home).
import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

const KEY = (orgId: string) => `mailOptOut:${orgId}`;

function secret(): string | null {
  return process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? null;
}

/** The signature: of the account alone (the first links), or of the account and the address. */
export function unsubscribeToken(orgId: string, email?: string | null): string | null {
  const s = secret();
  const what = email ? `mailOptOut:${orgId}:${email.trim().toLowerCase()}` : `mailOptOut:${orgId}`;
  return s ? createHmac("sha256", s).update(what).digest("hex").slice(0, 32) : null;
}

export function verifyUnsubscribe(orgId: string, token: string, email?: string | null): boolean {
  const want = unsubscribeToken(orgId, email);
  if (!want || typeof token !== "string" || token.length !== want.length) return false;
  try { return timingSafeEqual(Buffer.from(want), Buffer.from(token)); } catch { return false; }
}

/** The unsubscribe link for one account — and, when given, the address the letter goes to. */
export function unsubscribeUrl(base: string, orgId: string, email?: string | null): string {
  const e = email?.trim().toLowerCase() || null;
  return `${base.replace(/\/$/, "")}/api/email/unsubscribe?o=${encodeURIComponent(orgId)}${e ? `&e=${encodeURIComponent(e)}` : ""}&t=${unsubscribeToken(orgId, e) ?? ""}`;
}

/** The headers that put the mail client's own Unsubscribe button beside the sender. */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

export async function readOptOut(orgId: string): Promise<{ at: string } | null> {
  const row = await db.syncState.findUnique({ where: { key: KEY(orgId) }, select: { cursor: true } }).catch(() => null);
  try {
    const v = row?.cursor ? (JSON.parse(row.cursor) as { at?: string }) : null;
    return v?.at ? { at: v.at } : null;
  } catch {
    return null;
  }
}

export async function writeOptOut(orgId: string, via: "one-click" | "page" | "reply" | "admin"): Promise<void> {
  const cursor = JSON.stringify({ at: new Date().toISOString(), via });
  await db.syncState.upsert({ where: { key: KEY(orgId) }, create: { key: KEY(orgId), cursor }, update: { cursor } });
}

/** The account's owners' addresses — who an account's link stands for when it names no address. */
export async function ownerEmails(orgId: string): Promise<string[]> {
  const rows = await db.membership.findMany({ where: { organizationId: orgId, role: "OWNER" }, select: { user: { select: { email: true } } } }).catch(() => []);
  return [...new Set(rows.map((r) => r.user?.email?.trim().toLowerCase()).filter((e): e is string => !!e))];
}
