// TWILIO — the platform's one texting identity (2026-09-24).
//
// The settings come from /admin/integrations/twilio first (PlatformIntegration
// row "twilio", encrypted with the secret box), then from the env
// (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_MESSAGING_SERVICE_SID or
// TWILIO_PHONE_NUMBER). The admin sets it up once for every contractor; the
// env is what a fresh deploy or the local stand falls back to.
//
// A Messaging Service (MG…) is preferred over a bare number: US carriers only
// honor an A2P registration for traffic sent through its service — a bare
// From reads as unregistered and comes back undelivered (error 30034).
//
// The resolved settings are cached in the process for a minute; a save from
// the admin page clears the cache in its own process, and every other
// lambda picks the row up within the minute.

import { IntegrationDisabledError } from "./base";

export type TwilioSettings = {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string | null;
  fromNumber: string | null;
  /** Where the settings came from. */
  source: "admin" | "env";
};

const CACHE_MS = 60_000;
let cached: { at: number; value: TwilioSettings | null } | null = null;

function fromEnv(): TwilioSettings | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || null;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER || null;
  if (!accountSid || !authToken || !(messagingServiceSid || fromNumber)) return null;
  return { accountSid, authToken, messagingServiceSid, fromNumber, source: "env" };
}

/** The settings texting runs on right now, or null when nothing is set up. */
export async function twilioSettings(): Promise<TwilioSettings | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  let value: TwilioSettings | null = null;
  try {
    const { getTwilioIntegration } = await import("@/lib/platformIntegrations");
    const row = await getTwilioIntegration();
    if (row && row.enabled && row.accountSid && row.authToken && (row.messagingServiceSid || row.fromNumber)) {
      value = { accountSid: row.accountSid, authToken: row.authToken, messagingServiceSid: row.messagingServiceSid || null, fromNumber: row.fromNumber || null, source: "admin" };
    }
  } catch (err) {
    // A missing table or key must not stop texting from the env.
    console.warn(`[twilio] admin settings unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!value) value = fromEnv();
  cached = { at: Date.now(), value };
  return value;
}

/** After a save from the admin page. */
export function invalidateTwilioSettings(): void {
  cached = null;
}

export async function isTwilioEnabled(): Promise<boolean> {
  return (await twilioSettings()) !== null;
}

/** The auth token the webhooks verify signatures with. */
export async function twilioAuthToken(): Promise<string | null> {
  return (await twilioSettings())?.authToken ?? null;
}

export async function twilioClient(settings?: TwilioSettings | null) {
  const s = settings ?? (await twilioSettings());
  if (!s) throw new IntegrationDisabledError("Twilio", "TWILIO_ACCOUNT_SID");
  const twilio = (await import("twilio")).default;
  return twilio(s.accountSid, s.authToken);
}

export async function sendSMS(
  to: string,
  body: string,
  opts: {
    statusCallback?: string;
    from?: string | null;
    /** The bare From, never the Messaging Service (2026-11-04: the JobFlex Assistant's number stands outside the
     *  service — the service would send its inbound texts to /api/twilio/sms and share STOP across its pool). */
    bare?: boolean;
  } = {},
) {
  const s = await twilioSettings();
  if (!s) {
    // Never log the body: SMS bodies carry worker magic links and quote links,
    // which are live bearer credentials in the server logs.
    console.warn(`[sms] Twilio disabled — would send ${body.length} chars → …${to.slice(-4)}`);
    return { sid: "disabled", skipped: true as const };
  }
  if (!/^\+[1-9]\d{6,14}$/.test(to)) {
    throw new Error("SMS destination must be an E.164 number");
  }
  // Every text names its number (2026-10-02): the company's own registered
  // number (lib/sms/registration). Without one, the Messaging Service would
  // pick any number in its pool — another company's — so nothing is sent.
  if (!opts.from) {
    console.warn(`[sms] no sending number — a text leaves only from the company's own number (…${to.slice(-4)})`);
    return { sid: "no-number", skipped: true as const };
  }
  const client = await twilioClient(s);
  // The company's number rides inside the Messaging Service when there is one
  // (it was added to the service's pool when bought); without a service it is
  // the bare From.
  const msg = await client.messages.create({
    ...(s.messagingServiceSid && !opts.bare ? { messagingServiceSid: s.messagingServiceSid, from: opts.from } : { from: opts.from }),
    to,
    body,
    ...(opts.statusCallback ? { statusCallback: opts.statusCallback } : {}),
  });
  // Billed per segment (160 characters, 153 each once split) — lib/trialMeter.
  try {
    const { notePaidCall } = await import("@/lib/trialMeter");
    await notePaidCall("twilio", "sms", { units: body.length <= 160 ? 1 : Math.ceil(body.length / 153) });
  } catch {
    /* recording never stops a text */
  }
  try {
    const { db } = await import("@/lib/db");
    const at = new Date().toISOString();
    await db.syncState.upsert({
      where: { key: "sms:last-sent" },
      update: { cursor: at },
      create: { key: "sms:last-sent", cursor: at },
    });
  } catch {
    /* bookkeeping for the integrations-health panel; never fails a send */
  }
  return { sid: msg.sid, skipped: false as const };
}

export async function requireTwilio() {
  if (!(await isTwilioEnabled())) throw new IntegrationDisabledError("Twilio", "TWILIO_ACCOUNT_SID");
}
