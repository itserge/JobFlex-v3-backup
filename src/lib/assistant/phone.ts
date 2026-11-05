import "server-only";
// THE ASSISTANT'S NUMBER AND THE PHONES LINKED TO IT (2026-11-04). One JobFlex
// Assistant number for every account (owner): a text or call is matched by the
// sender's linked phone, and only that person's company is opened.
//
// LINKING. Settings → Assistant shows a six-digit code; the person texts it FROM
// their phone to the Assistant number. That proves they hold the phone and is
// their yes to the Assistant's texts — never User.smsPhone, which a manager can
// type in for someone else. A phone is linked to one person in one company
// (AssistantLink.phone is unique): a new code from the same phone moves it, and a
// person keeps one phone per company. STOP pauses the link (`active`), START
// brings it back; nothing here touches SmsOptOut, which is keyed by phone alone
// and would silence every JobFlex text to it.
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { rateLimitShared, HOUR } from "@/lib/rateLimit";

/** How long a code waits for its text. */
export const LINK_TTL_MS = 15 * 60_000;
const CODE_KEY = (code: string) => `assistant:link:${code}`;
const USER_CODE_KEY = (orgId: string, userId: string) => `assistant:linkfor:${orgId}:${userId}`;

/** THE NUMBER ITSELF (owner, 2026-11-04: "set that variable in admin, instead of
 *  Vercel"): /admin/integrations/twilio → JobFlex Assistant number, kept in
 *  SyncState `assistant:number` (a phone number, nothing secret). The server's
 *  TWILIO_ASSISTANT_FROM stays the fallback. Read at most once a minute per server. */
const NUMBER_KEY = "assistant:number";
const NUMBER_TTL_MS = 60_000;
let numberCache: { at: number; value: string | null } | null = null;

/** The Assistant's number, E.164, or null when it isn't set up yet. */
export async function assistantNumber(): Promise<string | null> {
  if (numberCache && Date.now() - numberCache.at < NUMBER_TTL_MS) return numberCache.value;
  const row = await db.syncState.findUnique({ where: { key: NUMBER_KEY }, select: { cursor: true } }).catch(() => null);
  const value = toE164(row?.cursor ?? null) ?? toE164(process.env.TWILIO_ASSISTANT_FROM ?? null);
  numberCache = { at: Date.now(), value };
  return value;
}

/** What admin saved, and what the server's env says — for the admin card. */
export async function assistantNumberSources(): Promise<{ stored: string | null; env: string | null }> {
  const row = await db.syncState.findUnique({ where: { key: NUMBER_KEY }, select: { cursor: true } }).catch(() => null);
  return { stored: toE164(row?.cursor ?? null), env: toE164(process.env.TWILIO_ASSISTANT_FROM ?? null) };
}

/** Save the number from admin (null clears it, back to the env's). */
export async function setAssistantNumber(e164: string | null): Promise<void> {
  if (e164) await db.syncState.upsert({ where: { key: NUMBER_KEY }, create: { key: NUMBER_KEY, cursor: e164 }, update: { cursor: e164 } });
  else await db.syncState.deleteMany({ where: { key: NUMBER_KEY } });
  numberCache = null;
}

/** "+18665551234" → "(866) 555-1234" */
export function phoneWords(e164: string | null | undefined): string {
  const d = (e164 ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : e164 ?? "";
}

export interface LinkView {
  phone: string;
  active: boolean;
  linkedAt: string | null;
}

/** This person's linked phone in this company, if any. */
export async function linkOf(organizationId: string, userId: string): Promise<LinkView | null> {
  const l = await db.assistantLink.findFirst({
    where: { organizationId, userId, verifiedAt: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { phone: true, active: true, verifiedAt: true },
  });
  return l ? { phone: l.phone, active: l.active, linkedAt: l.verifiedAt?.toISOString() ?? null } : null;
}

/**
 * A fresh code for this person to text from their phone. The one they had
 * before stops working. At most ten an hour per person.
 */
export async function startLink(organizationId: string, userId: string, now = new Date()): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; error: string }> {
  const limit = await rateLimitShared(`assistant:linkcodes:${userId}`, 10, HOUR);
  if (!limit.ok) return { ok: false, error: "Too many codes for one hour — try again a little later." };
  const old = await db.syncState.findUnique({ where: { key: USER_CODE_KEY(organizationId, userId) }, select: { cursor: true } });
  if (old?.cursor) await db.syncState.deleteMany({ where: { key: CODE_KEY(old.cursor) } });
  let code = "";
  for (let i = 0; i < 6; i++) {
    code = String(randomInt(100000, 1000000));
    const taken = await db.syncState.findUnique({ where: { key: CODE_KEY(code) }, select: { key: true } });
    if (!taken) break;
  }
  const expiresAt = new Date(now.getTime() + LINK_TTL_MS).toISOString();
  const cursor = JSON.stringify({ organizationId, userId, expiresAt });
  await db.syncState.upsert({ where: { key: CODE_KEY(code) }, create: { key: CODE_KEY(code), cursor }, update: { cursor } });
  await db.syncState.upsert({ where: { key: USER_CODE_KEY(organizationId, userId) }, create: { key: USER_CODE_KEY(organizationId, userId), cursor: code }, update: { cursor: code } });
  return { ok: true, code, expiresAt };
}

/** A bare six-digit text (or "LINK 123456"): the code, else null. */
export function codeIn(body: string): string | null {
  const m = /^\s*(?:link\s*)?(\d{6})\s*$/i.exec(body);
  return m ? m[1] : null;
}

/**
 * The code texted from `phone`: the phone is linked to the person who asked for
 * it, or null when the code is unknown or older than fifteen minutes. A code
 * works once.
 */
export async function claimLink(phoneRaw: string, code: string, now = new Date()): Promise<{ organizationId: string; userId: string } | null> {
  const phone = toE164(phoneRaw);
  if (!phone) return null;
  const row = await db.syncState.findUnique({ where: { key: CODE_KEY(code) }, select: { cursor: true } });
  if (!row) return null;
  let v: { organizationId?: unknown; userId?: unknown; expiresAt?: unknown };
  try {
    v = JSON.parse(row.cursor) as typeof v;
  } catch {
    return null;
  }
  await db.syncState.deleteMany({ where: { key: CODE_KEY(code) } });
  if (typeof v.organizationId !== "string" || typeof v.userId !== "string" || typeof v.expiresAt !== "string") return null;
  if (Date.parse(v.expiresAt) < now.getTime()) return null;
  const seat = await db.membership.findFirst({ where: { organizationId: v.organizationId, userId: v.userId, organization: { deletedAt: null } }, select: { id: true } });
  if (!seat) return null;
  // One phone per person per company: an older one of theirs is let go.
  await db.assistantLink.deleteMany({ where: { organizationId: v.organizationId, userId: v.userId, NOT: { phone } } });
  await db.assistantLink.upsert({
    where: { phone },
    create: { phone, organizationId: v.organizationId, userId: v.userId, verifiedAt: now, active: true },
    update: { organizationId: v.organizationId, userId: v.userId, verifiedAt: now, active: true },
  });
  await db.syncState.deleteMany({ where: { key: USER_CODE_KEY(v.organizationId, v.userId) } });
  return { organizationId: v.organizationId, userId: v.userId };
}

/** The link this phone texts as, verified, or null. */
export async function linkForPhone(phoneRaw: string) {
  const phone = toE164(phoneRaw);
  if (!phone) return null;
  return db.assistantLink.findFirst({ where: { phone, verifiedAt: { not: null } } });
}

export async function setPhoneActive(phoneRaw: string, active: boolean): Promise<boolean> {
  const phone = toE164(phoneRaw);
  if (!phone) return false;
  const r = await db.assistantLink.updateMany({ where: { phone }, data: { active } });
  return r.count > 0;
}

export async function setMyPhoneActive(organizationId: string, userId: string, active: boolean): Promise<void> {
  await db.assistantLink.updateMany({ where: { organizationId, userId }, data: { active } });
}

export async function unlinkMine(organizationId: string, userId: string): Promise<void> {
  await db.assistantLink.deleteMany({ where: { organizationId, userId } });
  await db.syncState.deleteMany({ where: { key: USER_CODE_KEY(organizationId, userId) } });
}
