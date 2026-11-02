// A CALL TO A COMPANY'S NUMBER — server only (the Twilio webhooks are its callers).
//
// Which company: the number dialed (lib/aiDesk/numbers). What happens: the desk's mode
// and the plan — the phone assistant answers, or the company's own phone rings first and
// the assistant takes the call nobody picked up. A plan without the assistant (or one
// out of calls this month) still gets its calls: they ring the company phone. A company
// out of desk minutes (lib/aiDesk/minutes) keeps its calls too: the company phone, or a
// message — never the live desk, until a pack is added.
import { db } from "@/lib/db";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { isPageLocked } from "@/lib/customPageAccess";
import { toE164 } from "@/lib/phone";
import { startInboundCall } from "@/lib/aiPhoneCalls";
import { forwardTwiml, hangupTwiml, recordingTwiml, streamTwiml, unavailableTwiml } from "@/lib/sdk/twilioVoice";
import { organizationForCall, readDeskSettings } from "./numbers";
import { callsGo, greetingFor } from "./shared";
import { readCallOutcome } from "./liveCall";
import { deskBalanceFor } from "./minutes";
import { signCallToken, voiceServerConfigured, voiceStreamUrl } from "./voiceToken";
import { samePhone } from "./forwardCheck";
import { forwardingOnInbound } from "./forwardTest";

type Company = { id: string; name: string; phone: string | null };

/** The public origin Twilio calls back to. */
export function twilioBase(reqUrl: string): string {
  return process.env.TWILIO_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(reqUrl).origin;
}

/**
 * The company a call is for: the one whose number was dialed. A number no company
 * registered — JobFlex's own line — is answered for the first company, as it was
 * before 2026-10-13.
 */
export async function companyForCall(to: string): Promise<Company | null> {
  const select = { id: true, name: true, phone: true } as const;
  const byNumber = await organizationForCall(to);
  if (byNumber) return db.organization.findUnique({ where: { id: byNumber }, select });
  const first = await db.organization.findFirst({ orderBy: { createdAt: "asc" }, select });
  if (first) console.info(`[aiDesk] ${to} is not a company's number — answered for ${first.name} (the platform's own line)`);
  return first;
}

/**
 * The assistant answers: a row for the Phone page, then — with the voice server set up —
 * the live desk on a media stream, else the greeting and a recording. `live: false` is
 * for the call that already rang the company phone: never the live desk again from there
 * (a desk that transfers to a phone nobody answers must not loop back to itself).
 */
async function assistantTwiml(org: Company, input: { callSid: string; from: string; to: string; base: string }, live = true): Promise<string> {
  try {
    await startInboundCall(input.callSid, input.from, input.to, org.id);
  } catch (err) {
    console.warn("[aiDesk] startInboundCall failed:", err);
  }
  const wsUrl = voiceStreamUrl();
  if (live && wsUrl && voiceServerConfigured()) {
    return streamTwiml({ baseUrl: input.base, wsUrl, token: signCallToken({ callSid: input.callSid, organizationId: org.id, from: input.from }) });
  }
  return recordingTwiml({ baseUrl: input.base, greeting: greetingFor(org.name), maxLengthSec: 180 });
}

/** After the live desk's stream ended: how the call went says what Twilio does next. */
export async function afterStreamTwiml(input: { to: string; from: string; callSid: string; base: string }): Promise<string> {
  const outcome = await readCallOutcome(input.callSid);
  if (outcome?.outcome === "done") return hangupTwiml();
  const org = await companyForCall(input.to);
  if (!org) return hangupTwiml();
  if (outcome?.outcome === "transfer") {
    // Never to a phone that forwards every call back here.
    const desk = await readDeskSettings(org.id);
    const phone = desk.forwarding === "all" ? null : toE164(org.phone ?? "");
    if (phone) return forwardTwiml({ baseUrl: input.base, number: phone });
  }
  // The desk never got going (or asked to transfer with no phone to ring): a message, the old way.
  return recordingTwiml({ baseUrl: input.base, greeting: `${greetingFor(org.name).replace(/^Thanks for calling ([^.]+)\./, "Thanks for calling $1. Our assistant can't take the call right now.")}`, maxLengthSec: 180 });
}

export async function assistantOnPlan(organizationId: string): Promise<boolean> {
  const [quota, locked] = await Promise.all([checkPlanLimit(organizationId, "aiPhoneCalls"), isPageLocked(organizationId, "phone")]);
  return quota.allowed && !locked;
}

/** Minutes left for the live desk. A failed read never silences it. */
async function deskHasMinutes(organizationId: string): Promise<boolean> {
  try {
    return !(await deskBalanceFor(organizationId)).out;
  } catch {
    return true;
  }
}

/** What a call to a company's number gets. `forwardedFrom`: the number the carrier says forwarded it, when it says. */
export async function inboundTwiml(input: { to: string; from: string; callSid: string; base: string; forwardedFrom?: string | null }): Promise<string> {
  const org = await companyForCall(input.to);
  if (!org) return unavailableTwiml();
  // The forwarding check (lib/aiDesk/forwardTest): our own test call back at the desk is answered as the test, not by it.
  const test = await forwardingOnInbound(org, { from: input.from, to: input.to, forwardedFrom: input.forwardedFrom ?? null });
  if (test) return test;
  // A number calling itself is only ever a forwarding loop — never a customer.
  if (samePhone(input.from, input.to)) return hangupTwiml();
  const [onPlan, desk, minutes] = await Promise.all([assistantOnPlan(org.id), readDeskSettings(org.id), deskHasMinutes(org.id)]);
  // A company phone that forwards every call to the desk cannot be rung from here (it would ring the desk again).
  const phone = desk.forwarding === "all" ? null : toE164(org.phone ?? "");
  const go = callsGo({ mode: desk.mode, assistantOnPlan: onPlan, companyPhone: phone });
  if (go === "phone" && phone) return forwardTwiml({ baseUrl: input.base, number: phone });
  if (go === "assistant") {
    // Out of minutes: the company phone when there is one, else a message — never the live desk.
    if (!minutes) return phone ? forwardTwiml({ baseUrl: input.base, number: phone }) : assistantTwiml(org, input, false);
    return assistantTwiml(org, input);
  }
  return unavailableTwiml();
}

/**
 * After the company phone rang: a conversation ends the call; no answer goes to the
 * assistant — the live desk for a call that rang the phone first (FORWARD), a recording
 * when it was the desk itself that sent the call to the phone (no loop back) or the
 * minutes are out.
 */
export async function afterDialTwiml(input: { to: string; from: string; callSid: string; base: string; dialStatus: string }): Promise<string> {
  if (input.dialStatus === "completed" || input.dialStatus === "answered") return hangupTwiml();
  const org = await companyForCall(input.to);
  if (!org || !(await assistantOnPlan(org.id))) return unavailableTwiml();
  const [outcome, minutes] = await Promise.all([readCallOutcome(input.callSid), deskHasMinutes(org.id)]);
  return assistantTwiml(org, input, outcome?.outcome !== "transfer" && minutes);
}
