import "server-only";
// THE PIN FOR MONEY (2026-11-05; owner, 2026-11-04: "money also needs a PIN").
// Four digits the person sets in Settings → AI Operator. An invoice or a
// financing link is read back and waits for the yes AND the PIN — "YES 1234"
// by text, the box on the card in the app (lib/assistant/engine approve). Kept
// hashed (scrypt, its own salt) in SyncState under the person, so it works for
// someone who never linked a phone — AssistantLink.pinHash would not. Three
// wrong tries cancel the read-back; a new one asks afresh.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

export const PIN_RE = /^\d{4}$/;
export const PIN_TRIES = 3;

const pinKey = (organizationId: string, userId: string) => `assistant:pin:${organizationId}:${userId}`;
const triesKey = (actionId: string) => `assistant:pintries:${actionId}`;

/** `scrypt$<salt>$<hash>` — pure, so the checks pin it. */
export function hashPin(pin: string, salt = randomBytes(16).toString("hex")): string {
  return `scrypt$${salt}$${scryptSync(pin, salt, 32).toString("hex")}`;
}

export function pinMatches(pin: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash || !PIN_RE.test(pin)) return false;
  const a = scryptSync(pin, salt, 32);
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Too easy to guess: one digit four times, or a run (1234, 4321). */
export function weakPin(pin: string): boolean {
  if (!PIN_RE.test(pin)) return true;
  if (/^(\d)\1{3}$/.test(pin)) return true;
  const d = pin.split("").map(Number);
  const step = d[1] - d[0];
  return (step === 1 || step === -1) && d.every((n, i) => i === 0 || n - d[i - 1] === step);
}

export async function hasPin(organizationId: string, userId: string): Promise<boolean> {
  const row = await db.syncState.findUnique({ where: { key: pinKey(organizationId, userId) }, select: { cursor: true } }).catch(() => null);
  return Boolean(row?.cursor);
}

export async function setPin(organizationId: string, userId: string, pin: string): Promise<void> {
  const key = pinKey(organizationId, userId);
  const cursor = hashPin(pin);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

export async function clearPin(organizationId: string, userId: string): Promise<void> {
  await db.syncState.deleteMany({ where: { key: pinKey(organizationId, userId) } });
}

/** The PIN given for one read-back: right, wrong (and how many wrong so far), locked after PIN_TRIES, or none set. */
export async function checkPin(organizationId: string, userId: string, actionId: string, pin: string): Promise<"ok" | "wrong" | "locked" | "none"> {
  const row = await db.syncState.findUnique({ where: { key: pinKey(organizationId, userId) }, select: { cursor: true } }).catch(() => null);
  if (!row?.cursor) return "none";
  const key = triesKey(actionId);
  if (pinMatches(pin, row.cursor)) {
    await db.syncState.deleteMany({ where: { key } }).catch(() => null);
    return "ok";
  }
  const t = await db.syncState.findUnique({ where: { key }, select: { cursor: true } }).catch(() => null);
  const n = (Number(t?.cursor) || 0) + 1;
  await db.syncState.upsert({ where: { key }, create: { key, cursor: String(n) }, update: { cursor: String(n) } }).catch(() => null);
  return n >= PIN_TRIES ? "locked" : "wrong";
}
