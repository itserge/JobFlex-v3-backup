import "server-only";
// QA LAB TEST MODE (2026-10-14; qa/README.md). With QA_TEST_MODE=1 and a
// QA_SECRET, outside production, the one-time codes for @qa.jobflex.test
// addresses are kept (SyncState `qa-otp:<email>`, ten minutes) for
// GET /api/qa/otp instead of being emailed, and no mail at all goes to those
// addresses. Off — or on Vercel production, whatever the flag says — nothing
// is kept and the endpoint answers 404.
//
// The statistics and analytics exclusions (qaOrgIds, lib/qaOrg) do not depend on
// the flag: a QA account never counts, in any environment.
import { db } from "@/lib/db";
import { QA_EMAIL_DOMAIN, isQaEmail, isQaPhone } from "@/lib/qaEmail";

export { QA_EMAIL_DOMAIN, isQaEmail, isQaPhone };

const CODE_KEY = (email: string) => `qa-otp:${email.trim().toLowerCase()}`;
const CODE_TTL_MS = 10 * 60_000;

export function qaTestModeOn(): boolean {
  return process.env.QA_TEST_MODE === "1" && !!process.env.QA_SECRET && process.env.VERCEL_ENV !== "production";
}

/** Test mode is on and the address is a QA one: keep the code, send nothing. */
export function qaCaptures(email: string | null | undefined): boolean {
  return qaTestModeOn() && isQaEmail(email);
}

export type QaCode = { email: string; kind: string; code: string | null; link: string | null; draft: string; at: number };

/** Kept only in test mode, only for a QA address (the caller checks qaCaptures). */
export async function keepQaCode(entry: QaCode): Promise<void> {
  if (!qaCaptures(entry.email)) return;
  const key = CODE_KEY(entry.email);
  const cursor = JSON.stringify(entry);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

/** The newest kept code for the address, while it is fresh; null otherwise. */
export async function readQaCode(email: string): Promise<QaCode | null> {
  if (!qaCaptures(email)) return null;
  const row = await db.syncState.findUnique({ where: { key: CODE_KEY(email) } }).catch(() => null);
  if (!row) return null;
  try {
    const entry = JSON.parse(row.cursor) as QaCode;
    return Date.now() - entry.at <= CODE_TTL_MS ? entry : null;
  } catch {
    return null;
  }
}

/* THE TEXTED CODE, IN TEST MODE (2026-11-12, the sign-up by text). Twilio Verify holds a real code; for a QA number
   (lib/qaEmail isQaPhone) nothing is texted — lib/sms/verify keeps the code here (SyncState `qa-sms:<E.164>`, ten
   minutes, gone once it matched), and a harness reads it from that row. */
const SMS_KEY = (e164: string) => `qa-sms:${e164}`;
export type QaSmsCode = { phone: string; code: string; at: number };

/** Test mode is on and the number is a QA one: keep the code, text nothing. */
export function qaCapturesPhone(e164: string | null | undefined): boolean {
  return qaTestModeOn() && isQaPhone(e164);
}

export async function keepQaSmsCode(phone: string, code: string): Promise<void> {
  if (!qaCapturesPhone(phone)) return;
  const cursor = JSON.stringify({ phone, code, at: Date.now() } satisfies QaSmsCode);
  await db.syncState.upsert({ where: { key: SMS_KEY(phone) }, create: { key: SMS_KEY(phone), cursor }, update: { cursor } });
}

/** The kept code while it is fresh, else null. */
export async function readQaSmsCode(phone: string): Promise<QaSmsCode | null> {
  if (!qaCapturesPhone(phone)) return null;
  const row = await db.syncState.findUnique({ where: { key: SMS_KEY(phone) } }).catch(() => null);
  if (!row) return null;
  try {
    const entry = JSON.parse(row.cursor) as QaSmsCode;
    return Date.now() - entry.at <= CODE_TTL_MS ? entry : null;
  } catch {
    return null;
  }
}

export async function dropQaSmsCode(phone: string): Promise<void> {
  await db.syncState.deleteMany({ where: { key: SMS_KEY(phone) } }).catch(() => {});
}

export { qaOrgIds, isQaOrg } from "@/lib/qaOrg";
