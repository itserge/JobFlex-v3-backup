// SMARTBOOK · WHERE A CONVERSATION LIVES (2026-10-31) — server only.
//
// No schema change: namespaced rows in the existing key/value store, as Meta connect and the AI desk keep theirs.
//   smartbook:c:<org>:<lead>   the conversation (below)
//   smartbook:p:<org>:<E164>   the lead a reply from that phone belongs to (the newest conversation wins)
//   smartbook:t:<token>        the pick page's token → org and lead
//   smartbook:h:<org>:<ms>:<lead> a time offered to a lead, held from the others for two hours (the expiry in the row)
//   smartbook:n:<org>          the company's request counter (#1, #2 … in the texts)
//   smartbook:rt:<token>       a request's answer page (/b/r/<token>) → org and lead
//   smartbook:lock:<org>:<lead> one step at a time per conversation (a reply and the cron never act together)
// What was said lives on the lead's timeline (ActivityEvent), not here. A test from Settings ("Send me a test") is a
// conversation with no lead row: its lead id is `test-<userId>` and the person testing plays the customer.
import crypto from "node:crypto";
import { db } from "@/lib/db";
import type { DayPart } from "./offers";

export type ConvStatus = "offered" | "asked" | "countered" | "booked" | "closed";
export type CloseWhy = "no-reply" | "not-interested" | "handed" | "paused" | "stopped" | "canceled";
export type NextStep = "first-text" | "nudge" | "call" | "remind" | "still-checking" | "reoffer" | "counter-nudge";

/** The customer asked for a time the company has to answer. */
export interface SmartRequest {
  n: number;
  /** "YYYY-MM-DD" on the company's clock; null = "any time — nothing open fit". */
  day: string | null;
  /** ISO of the exact time asked, or null when they named only a day or part of one. */
  at: string | null;
  part: DayPart | null;
  /** As the texts say it: "Sat Nov 8, 9am". */
  label: string;
  /** Their words, for the company. */
  words: string;
  askedAt: string;
  /** The answer page's link (/b/r/<token>), emailed to the company. */
  token?: string;
}

export interface Conversation {
  v: 1;
  organizationId: string;
  leadId: string;
  status: ConvStatus;
  why: CloseWhy | null;
  name: string;
  phone: string | null;
  email: string | null;
  /** May text this phone: SmartBook's Text switch, a number on the company, and the customer's yes. */
  text: boolean;
  /** May call (Batch 4): the Call switch and the customer's yes to calls. */
  call: boolean;
  serviceKey: string;
  /** The numbered times on offer, as ISO starts. */
  offers: string[];
  /** Turned down or already offered and gone by — never offered again in this conversation. */
  spent: string[];
  /** The company's other time, waiting for the customer's yes. */
  counter: string | null;
  request: SmartRequest | null;
  manageToken: string | null;
  bookedAt: string | null;
  token: string;
  nudges: number;
  called: boolean;
  aiTurns: number;
  lang: string;
  lastInAt: string | null;
  lastOutAt: string | null;
  next: { at: string; what: NextStep } | null;
  createdAt: string;
  /** "Send me a test": the user who is testing (no lead row, nothing booked, nothing held). */
  test?: string | null;
}

const convKey = (org: string, lead: string) => `smartbook:c:${org}:${lead}`;
const phoneKey = (org: string, phone: string) => `smartbook:p:${org}:${phone}`;
const tokenKey = (token: string) => `smartbook:t:${token}`;
const holdPrefix = (org: string) => `smartbook:h:${org}:`;
const seqKey = (org: string) => `smartbook:n:${org}`;
const lockKey = (org: string, lead: string) => `smartbook:lock:${org}:${lead}`;
export const CONV_PREFIX = "smartbook:c:";

function parse(cursor: string | null | undefined): Conversation | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(cursor) as Conversation;
    return v && v.v === 1 && typeof v.leadId === "string" && typeof v.organizationId === "string" ? v : null;
  } catch {
    return null;
  }
}

/** A test conversation's lead id. */
export const testLeadId = (userId: string) => `test-${userId}`;
export const isTestLead = (leadId: string) => leadId.startsWith("test-");
/** How long a test answers the tester's texts (their phone is also a team phone). */
export const TEST_MS = 2 * 3600000;
export const isLiveTest = (c: Conversation, now = new Date()) => !!c.test && c.status !== "closed" && Date.parse(c.createdAt) > now.getTime() - TEST_MS;

export function newToken(): string {
  return crypto.randomBytes(9).toString("base64url");
}

export async function readConv(organizationId: string, leadId: string): Promise<Conversation | null> {
  const row = await db.syncState.findUnique({ where: { key: convKey(organizationId, leadId) }, select: { cursor: true } });
  return parse(row?.cursor);
}

export async function saveConv(c: Conversation): Promise<void> {
  const key = convKey(c.organizationId, c.leadId);
  const cursor = JSON.stringify(c);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

/** A new conversation and its indexes. False when the lead already has one. */
export async function createConv(c: Conversation): Promise<boolean> {
  try {
    await db.syncState.create({ data: { key: convKey(c.organizationId, c.leadId), cursor: JSON.stringify(c) } });
  } catch {
    return false;
  }
  const rows = [{ key: tokenKey(c.token), cursor: JSON.stringify({ o: c.organizationId, l: c.leadId }) }, ...(c.phone ? [{ key: phoneKey(c.organizationId, c.phone), cursor: c.leadId }] : [])];
  for (const r of rows) await db.syncState.upsert({ where: { key: r.key }, create: r, update: { cursor: r.cursor } });
  return true;
}

/** A test's earlier run, gone before the next one starts. */
export async function dropConv(organizationId: string, leadId: string): Promise<void> {
  await db.syncState.deleteMany({ where: { key: convKey(organizationId, leadId) } });
  await release(organizationId, leadId);
}

export async function convByPhone(organizationId: string, phone: string): Promise<Conversation | null> {
  const row = await db.syncState.findUnique({ where: { key: phoneKey(organizationId, phone) }, select: { cursor: true } });
  return row ? readConv(organizationId, row.cursor) : null;
}

const requestKey = (token: string) => `smartbook:rt:${token}`;

export async function indexRequest(organizationId: string, leadId: string, token: string): Promise<void> {
  const key = requestKey(token);
  const cursor = JSON.stringify({ o: organizationId, l: leadId });
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

/** The conversation a request's answer page belongs to (the caller checks the request is still the one asked). */
export async function convByRequestToken(token: string): Promise<Conversation | null> {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(token)) return null;
  const row = await db.syncState.findUnique({ where: { key: requestKey(token) }, select: { cursor: true } });
  if (!row) return null;
  try {
    const v = JSON.parse(row.cursor) as { o?: string; l?: string };
    return v.o && v.l ? readConv(v.o, v.l) : null;
  } catch {
    return null;
  }
}

export async function convByToken(token: string): Promise<Conversation | null> {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(token)) return null;
  const row = await db.syncState.findUnique({ where: { key: tokenKey(token) }, select: { cursor: true } });
  if (!row) return null;
  try {
    const v = JSON.parse(row.cursor) as { o?: string; l?: string };
    return v.o && v.l ? readConv(v.o, v.l) : null;
  } catch {
    return null;
  }
}

/** Every conversation of one company (or all), touched in the last `days`. */
export async function listConvs(organizationId: string | null, days = 30): Promise<Conversation[]> {
  const rows = await db.syncState.findMany({
    where: { key: { startsWith: organizationId ? `${CONV_PREFIX}${organizationId}:` : CONV_PREFIX }, updatedAt: { gte: new Date(Date.now() - days * 86_400_000) } },
    select: { cursor: true },
    take: 2000,
  });
  return rows.map((r) => parse(r.cursor)).filter((c): c is Conversation => !!c);
}

// ── holds ───────────────────────────────────────────────────────────────────

export const HOLD_MS = 2 * 3600000;

const holdOf = (cursor: string) => {
  const [leadId, until] = cursor.split("|");
  return { leadId, until: Number(until) || 0 };
};

/**
 * Times held for other leads right now, that no more leads may be offered: as many holds as the company has crews
 * (`capacity`) fill a time.
 */
export async function heldFor(organizationId: string, exceptLead: string, now = new Date(), capacity = 1): Promise<Set<number>> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: holdPrefix(organizationId) } }, select: { key: true, cursor: true } });
  const count = new Map<number, number>();
  for (const r of rows) {
    const h = holdOf(r.cursor);
    if (h.leadId === exceptLead || h.until <= now.getTime()) continue;
    const ms = Number(r.key.slice(holdPrefix(organizationId).length).split(":")[0]);
    if (Number.isFinite(ms)) count.set(ms, (count.get(ms) ?? 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n >= Math.max(1, capacity)).map(([ms]) => ms));
}

/** One row per time and lead (`<ms>:<lead>`), so two crews' worth of leads can hold the same time. */
export async function hold(organizationId: string, leadId: string, starts: readonly string[], now = new Date()): Promise<void> {
  const cursor = `${leadId}|${now.getTime() + HOLD_MS}`;
  for (const iso of starts) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    const key = `${holdPrefix(organizationId)}${ms}:${leadId}`;
    await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
  }
}

/** This lead's holds let go (it booked, or moved on). */
export async function release(organizationId: string, leadId: string): Promise<void> {
  await db.syncState.deleteMany({ where: { key: { startsWith: holdPrefix(organizationId), endsWith: `:${leadId}` } } });
}

/** Holds past their two hours, for the cron to sweep. */
export async function sweepHolds(now = new Date()): Promise<number> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: "smartbook:h:" } }, select: { key: true, cursor: true }, take: 5000 });
  const dead = rows.filter((r) => holdOf(r.cursor).until <= now.getTime()).map((r) => r.key);
  if (!dead.length) return 0;
  const r = await db.syncState.deleteMany({ where: { key: { in: dead } } });
  return r.count;
}

// ── the request counter, the lock ───────────────────────────────────────────

export async function nextRequestNumber(organizationId: string): Promise<number> {
  const key = seqKey(organizationId);
  for (let i = 0; i < 5; i++) {
    const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
    const n = (Number(row?.cursor) || 0) + 1;
    if (!row) {
      try {
        await db.syncState.create({ data: { key, cursor: String(n) } });
        return n;
      } catch {
        continue;
      }
    }
    const won = await db.syncState.updateMany({ where: { key, cursor: row.cursor }, data: { cursor: String(n) } });
    if (won.count) return n;
  }
  return Math.floor(Date.now() / 1000) % 10000;
}

const LOCK_STALE_MS = 60_000;

/** Run `fn` holding this conversation's lock; null when another step holds it (the caller retries or lets the cron). */
export async function withConvLock<T>(organizationId: string, leadId: string, fn: () => Promise<T>): Promise<T | null> {
  const key = lockKey(organizationId, leadId);
  await db.syncState.deleteMany({ where: { key, updatedAt: { lt: new Date(Date.now() - LOCK_STALE_MS) } } });
  try {
    await db.syncState.create({ data: { key, cursor: new Date().toISOString() } });
  } catch {
    return null;
  }
  try {
    return await fn();
  } finally {
    await db.syncState.deleteMany({ where: { key } }).catch(() => null);
  }
}
