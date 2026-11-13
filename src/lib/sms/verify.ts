// SIGN-IN CODES THROUGH TWILIO VERIFY (2026-10-02) — server only.
//
// Twilio would not verify a JobFlex toll-free number for JobFlex's own texts:
// the account is registered as an ISV reseller, and a reseller's own
// registration reads as "the ISV instead of the end business" (30474, twice).
// So the six-digit codes go through Twilio Verify, which sends from Twilio's
// own pre-registered senders and needs no registration (5¢ per approved code
// plus the text). Everything else goes out from each company's own registered
// number (registration.ts). The Verify service is found or made on first use —
// named "JobFlex", so the text reads "Your JobFlex verification code is …" —
// and remembered in SyncState; TWILIO_VERIFY_SERVICE_SID overrides it.

//
// QA LAB TEST MODE (2026-11-12, the sign-up by text): with QA_TEST_MODE=1 outside production a QA number (the
// fictional 555-01XX lines, lib/qaEmail isQaPhone) is texted nothing — the code is kept for the harness
// (lib/qaTestMode keepQaSmsCode) and checked against that copy, the way Twilio would.
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { twilioClient, twilioSettings } from "@/lib/sdk/twilio";
import { dropQaSmsCode, keepQaSmsCode, qaCapturesPhone, readQaSmsCode } from "@/lib/qaTestMode";

const KEY = "twilio:verify-service";
const NAME = "JobFlex";

type Client = Awaited<ReturnType<typeof twilioClient>>;

async function serviceSid(client: Client): Promise<string> {
  const fromEnv = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (fromEnv) return fromEnv;
  const kept = await db.syncState.findUnique({ where: { key: KEY }, select: { cursor: true } }).catch(() => null);
  if (kept?.cursor) return kept.cursor;
  const existing = (await client.verify.v2.services.list({ limit: 50 })).find((s) => s.friendlyName === NAME);
  const sid = existing?.sid ?? (await client.verify.v2.services.create({ friendlyName: NAME, codeLength: 6 })).sid;
  await db.syncState.upsert({ where: { key: KEY }, create: { key: KEY, cursor: sid }, update: { cursor: sid } });
  return sid;
}

function words(err: unknown): string {
  const e = err as { message?: string; code?: number };
  return `${(e.message ?? String(err)).slice(0, 160)}${e.code ? ` (${e.code})` : ""}`;
}

/** `code`: Twilio's error number when it gave one (60205 a landline, 60203 too many sends, 60410 fraud-blocked …). */
export type VerifySend = { ok: true } | { ok: false; notConfigured: boolean; error: string; code?: number };

/** Text a code to this number (E.164). `notConfigured` when the platform has no Twilio. */
export async function sendVerifyCode(phone: string): Promise<VerifySend> {
  if (qaCapturesPhone(phone)) {
    await keepQaSmsCode(phone, String(randomInt(0, 1_000_000)).padStart(6, "0"));
    console.info(`[sms] QA Lab number …${phone.slice(-4)}: code kept, nothing texted`);
    return { ok: true };
  }
  const settings = await twilioSettings();
  if (!settings) return { ok: false, notConfigured: true, error: "Texting is not set up on this server." };
  try {
    const client = await twilioClient(settings);
    const sid = await serviceSid(client);
    await client.verify.v2.services(sid).verifications.create({ to: phone, channel: "sms" });
    return { ok: true };
  } catch (err) {
    return { ok: false, notConfigured: false, error: words(err), code: (err as { code?: number }).code };
  }
}

/** `expired`: Twilio has no live code for the number (expired, used, or out of tries — its 404). */
export type VerifyCheck = { ok: true; approved: boolean } | { ok: false; error: string; expired?: boolean };

/** Does this code match the one Twilio sent to this number? */
export async function checkVerifyCode(phone: string, code: string): Promise<VerifyCheck> {
  if (qaCapturesPhone(phone)) {
    const kept = await readQaSmsCode(phone);
    if (!kept) return { ok: false, expired: true, error: "That code expired. Ask for a new one." };
    if (kept.code !== code) return { ok: true, approved: false };
    await dropQaSmsCode(phone);
    return { ok: true, approved: true };
  }
  const settings = await twilioSettings();
  if (!settings) return { ok: false, error: "Texting is not set up on this server." };
  try {
    const client = await twilioClient(settings);
    const sid = await serviceSid(client);
    const check = await client.verify.v2.services(sid).verificationChecks.create({ to: phone, code });
    return { ok: true, approved: check.status === "approved" };
  } catch (err) {
    // Twilio answers 404 once the code expired, was used, or ran out of tries.
    const status = (err as { status?: number }).status;
    return status === 404 ? { ok: false, expired: true, error: "That code expired. Ask for a new one." } : { ok: false, error: `Couldn't check the code: ${words(err)}` };
  }
}
