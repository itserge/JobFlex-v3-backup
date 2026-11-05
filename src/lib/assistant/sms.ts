import "server-only";
// THE ASSISTANT BY TEXT (2026-11-04). A text to the JobFlex Assistant number
// comes in at api/twilio/assistant/sms (its own webhook — the company numbers'
// route is untouched) and is answered here, after the response.
//
// WHAT A TEXT CAN BE, in order:
//   · a carrier keyword alone — STOP / CANCEL / END / QUIT / UNSUBSCRIBE … pause
//     this phone's link (Twilio itself stops texting it and confirms; we never
//     write SmsOptOut, keyed by phone alone, which would silence every JobFlex
//     text to it). START / UNSTOP / YES on a paused link turn it back on;
//   · HELP — what it is, how to stop, where to write;
//   · a six-digit code — links this phone (lib/assistant/phone);
//   · anything else from a linked phone — one turn of the engine
//     (lib/assistant/engine), as the person, re-checked now; answered by text.
//   An unknown phone hears how to link, at most twice a day.
//
// SENDING. From the Assistant's own number (TWILIO_ASSISTANT_FROM), bare — never
// through the Messaging Service, which would route its inbound to
// /api/twilio/sms and share STOP across its pool. Its own caps; no consent
// rule (the person texted us first, from the phone they linked), no company
// allowance (these are JobFlex's texts to its own subscribers), and no
// ten-minute duplicate rule (a second "Done." is a real answer). Every text is
// an SmsMessage row, as every other.
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { toE164 } from "@/lib/phone";
import { rateLimitShared, DAY, HOUR } from "@/lib/rateLimit";
import { isTwilioEnabled, sendSMS } from "@/lib/sdk/twilio";
import { actorFor } from "@/lib/assistant/actor";
import { handleTurn } from "@/lib/assistant/engine";
import { assistantNumber, claimLink, codeIn, linkForPhone, setPhoneActive } from "@/lib/assistant/phone";
import { APPROVAL_TTL_MS, smsPlain } from "@/lib/assistant/shared";

const CAP_PER_PHONE_PER_DAY = 150;
const CAP_ALL_PER_DAY = 5000;
const IN_PER_PHONE_PER_HOUR = 60;

/** Twilio's own opt-out words, alone in the text (they stop the number at the carrier). */
export const isCarrierStop = (body: string) => /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|revoke)\s*[.!]*\s*$/i.test(body);
/** Twilio's own opt-back-in words, alone in the text. */
export const isCarrierStart = (body: string) => /^\s*(start|unstop|yes)\s*[.!]*\s*$/i.test(body);
const isHelp = (body: string) => /^\s*(help|info)\s*[.!?]*\s*$/i.test(body);

// ── the words ────────────────────────────────────────────────────────────────

export const SMS_WORDS = {
  linked: (first: string, org: string, card: string) =>
    `JobFlex AI Operator: this phone is now linked to ${first} at ${org}. Text me what you need — "what's on tomorrow?", "build a 12 by 12 deck with a roof for Sarah", "send the Smith proposal". I read every change back first. Save me to your contacts: ${card} Msg & data rates may apply. Reply HELP for help, STOP to stop.`,
  badCode: "JobFlex AI Operator: that code didn't work — it may have expired. Open JobFlex → Settings → AI Operator for a new one.",
  notLinked: "JobFlex AI Operator: this phone isn't linked to a JobFlex account. To link it, open JobFlex → Settings → AI Operator and text the code shown there. Reply STOP to stop.",
  paused: "JobFlex AI Operator is paused for this phone. Reply START to turn it back on.",
  started: "JobFlex AI Operator is back on for this phone. Text me what you need.",
  help: "JobFlex AI Operator: text me what you need in JobFlex — estimates (\"build a 12 by 12 deck with a roof\"), your schedule, proposals, crew texts, payment reminders. I read every change back; reply YES to do it or NO to skip it. Msg & data rates may apply. Reply STOP to stop. Help: support@jobflex.app",
  gone: "JobFlex AI Operator: this phone's link has ended — you're no longer on that company's team in JobFlex.",
  slow: "JobFlex AI Operator: that's a lot of texts for one hour — give me a few minutes.",
} as const;

// ── sending ─────────────────────────────────────────────────────────────────

/** One text from the Assistant's number. True when Twilio took it. */
export async function sendAssistantText(toRaw: string, body: string, kind = "jobflex-assistant"): Promise<boolean> {
  const to = toE164(toRaw);
  if (!to) return false;
  const from = await assistantNumber();
  const text = smsPlain(body).trim().slice(0, 1200);
  if (!text) return false;
  const skipped = (error: string) =>
    db.smsMessage.create({ data: { organizationId: null, direction: "OUT", to, from, body: text, kind, status: "SKIPPED", error } }).then(() => false).catch(() => false);
  if (!from) return skipped("no-number");
  try {
    const [mine, all] = await Promise.all([rateLimitShared(`sms:assistant:to:${to}`, CAP_PER_PHONE_PER_DAY, DAY), rateLimitShared("sms:assistant:all", CAP_ALL_PER_DAY, DAY)]);
    if (!mine.ok) return skipped("cap-number");
    if (!all.ok) return skipped("cap-platform");
  } catch {
    return skipped("limiter-down");
  }
  const row = await db.smsMessage.create({ data: { organizationId: null, direction: "OUT", to, from, body: text, kind, status: "QUEUED" } });
  if (!(await isTwilioEnabled())) {
    await db.smsMessage.update({ where: { id: row.id }, data: { status: "SKIPPED", error: "not-configured" } });
    return false;
  }
  try {
    const r = await sendSMS(to, text, { statusCallback: `${await appBaseUrl()}/api/twilio/sms/status`, from, bare: true });
    await db.smsMessage.update({ where: { id: row.id }, data: { status: r.skipped ? "SKIPPED" : "SENT", sid: r.skipped ? null : r.sid, error: r.skipped ? r.sid : null } });
    return !r.skipped;
  } catch (err) {
    await db.smsMessage.update({ where: { id: row.id }, data: { status: "FAILED", error: (err instanceof Error ? err.message : String(err)).slice(0, 200) } }).catch(() => null);
    return false;
  }
}

// ── receiving ───────────────────────────────────────────────────────────────

export interface InboundText {
  from: string;
  to: string;
  body: string;
  sid: string | null;
}

/** Keep the text as an SmsMessage row; false when this MessageSid was already kept (Twilio retried). */
export async function keepInbound(m: InboundText): Promise<boolean> {
  try {
    await db.smsMessage.create({ data: { organizationId: null, direction: "IN", to: m.to, from: m.from, body: m.body.slice(0, 1600), kind: "jobflex-assistant-in", status: "RECEIVED", sid: m.sid } });
    return true;
  } catch {
    return !m.sid;
  }
}

/**
 * THE SHARED NUMBER (owner, 2026-11-04: "connect it to the JobFlex admin account
 * where Twilio already exists, just to test"). While TWILIO_ASSISTANT_FROM is
 * JobFlex's own toll-free number, its texts come in through the company
 * numbers' route (/api/twilio/sms — the Messaging Service's inbound URL), and
 * that route asks here first: is this one the Assistant's? Yes for a link code,
 * and for a linked, active phone — unless it is JobFlex's own team answering a
 * task text (lib/adminTasks/textReply) while the Assistant waits on nothing from
 * them. Bare STOP / START / HELP stay that route's (it pauses and resumes the
 * link with them). On a number of its own (/api/twilio/assistant/sms) every text
 * is the Assistant's.
 */
export async function claimsSharedText(m: InboundText, now = new Date()): Promise<boolean> {
  const number = await assistantNumber();
  if (!number || toE164(m.to) !== number) return false;
  const body = m.body.trim();
  if (!body || isCarrierStop(body) || /^\s*(start|unstop)\s*[.!]*\s*$/i.test(body) || isHelp(body)) return false;
  if (codeIn(body)) return true;
  const link = await linkForPhone(m.from);
  if (!link || !link.active) return false;
  const waiting = await db.assistantAction.findFirst({
    where: { organizationId: link.organizationId, userId: link.userId, status: { in: ["AWAITING", "QUEUED"] }, createdAt: { gte: new Date(now.getTime() - APPROVAL_TTL_MS) } },
    select: { id: true },
  });
  if (waiting) return true;
  const { planTaskReply } = await import("@/lib/adminTasks/textReply");
  const task = await planTaskReply(m.from, body).catch(() => null);
  return !task?.handled;
}

/** Answer one text. Never throws: a failure is logged, the person hears nothing worse than silence. */
/** Answer a text. Returns a build left to run after the answer (a minute's estimate) — the route runs it
 *  (lib/assistant/runner runAndReport, which texts the result) — or null. Never throws. */
export async function answerAssistantText(m: InboundText): Promise<string | null> {
  try {
    return await answer(m);
  } catch (err) {
    console.error(`[assistant-sms] …${m.from.slice(-4)}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function answer(m: InboundText): Promise<string | null> {
  const phone = toE164(m.from);
  if (!phone) return null;
  const body = m.body.trim();
  if (!body) return null;

  // Twilio has stopped this phone already; the link pauses with it. Nothing is sent (Twilio confirms).
  if (isCarrierStop(body)) {
    await setPhoneActive(phone, false);
    return null;
  }
  const flood = await rateLimitShared(`assistant:in:${phone}`, IN_PER_PHONE_PER_HOUR, HOUR).catch(() => ({ ok: true }));
  if (!flood.ok) {
    const once = await rateLimitShared(`assistant:slow:${phone}`, 1, HOUR).catch(() => ({ ok: false }));
    if (once.ok) await sendAssistantText(phone, SMS_WORDS.slow, "jobflex-assistant-slow");
    return null;
  }
  if (isHelp(body)) {
    await sendAssistantText(phone, SMS_WORDS.help, "jobflex-assistant-help");
    return null;
  }

  const code = codeIn(body);
  if (code) {
    const claimed = await claimLink(phone, code);
    if (!claimed) {
      await sendAssistantText(phone, SMS_WORDS.badCode, "jobflex-assistant-link");
      return null;
    }
    const [org, user] = await Promise.all([
      db.organization.findUnique({ where: { id: claimed.organizationId }, select: { name: true } }),
      db.user.findUnique({ where: { id: claimed.userId }, select: { name: true, email: true } }),
    ]);
    const first = ((user?.name ?? "").trim().split(/\s+/)[0] || (user?.email ?? "").split("@")[0] || "you").slice(0, 40);
    await sendAssistantText(phone, SMS_WORDS.linked(first, (org?.name ?? "your company").slice(0, 60), `${await appBaseUrl()}/api/assistant/contact`), "jobflex-assistant-link");
    return null;
  }

  const link = await linkForPhone(phone);
  if (!link) {
    const twice = await rateLimitShared(`assistant:unknown:${phone}`, 2, DAY).catch(() => ({ ok: false }));
    if (twice.ok) await sendAssistantText(phone, SMS_WORDS.notLinked, "jobflex-assistant-unlinked");
    return null;
  }
  if (!link.active) {
    if (isCarrierStart(body)) {
      await setPhoneActive(phone, true);
      await sendAssistantText(phone, SMS_WORDS.started, "jobflex-assistant-start");
      return null;
    }
    const once = await rateLimitShared(`assistant:paused:${phone}`, 1, DAY).catch(() => ({ ok: false }));
    if (once.ok) await sendAssistantText(phone, SMS_WORDS.paused, "jobflex-assistant-paused");
    return null;
  }

  const actor = await actorFor(link.organizationId, link.userId, "sms");
  if (!actor) {
    await db.assistantLink.deleteMany({ where: { phone } });
    await sendAssistantText(phone, SMS_WORDS.gone, "jobflex-assistant-gone");
    return null;
  }
  const turn = await handleTurn({ actor, text: body, externalId: m.sid });
  if (turn.reply) await sendAssistantText(phone, turn.reply, "jobflex-assistant-reply");
  return turn.running ?? null;
}
