// THE AI DESK CALLS A LEAD (owner, 2026-10-31: "the AI desk will also contact those leads when needed with the
// preset up we have") — server only.
//
//   leadCallReadiness  can the desk place a call for this company now: the live desk, Twilio, the desk's number, the
//                      assistant on the plan, the desk's business details written, minutes left
//   callLead           one call to one lead — the "Have the AI desk call" button, or the automatic call (this file's
//                      sweep, or SmartBook's one call to a lead who hasn't answered its times): the lead's checks (a
//                      US/Canadian phone, contacts open, not STOP, not "don't call"), the hours, the caps, then
//                      Twilio's REST call from the desk's number and the Phone page's OUTBOUND row
//   leadCallAnswered   the TwiML when the call connects: a person → the live desk on the media stream (token kind
//                      "lead"); a machine, after its beep → a short voicemail in the company's name
//   leadCallBrief      the desk's own instructions (the profile with its trade preset, the open times, booking) with
//                      the greeting and THIS CALL turned around: the desk placed this call, about their request
//   leadCallTool       do_not_call, the one tool a lead call brings beside the desk's own
//   leadCallMessage    take_message on a lead call: onto this lead, never a new one
//   finishLeadCall     the transcript and outcome onto the lead's own row, the minutes, and — when they talked —
//                      the lead marked contacted (lib/leads/contacted: the time only, no person took it)
//   leadCallAfter      after the stream: a transfer rings the company phone; anything else hangs up
//   leadCallStatus     Twilio's word on how it ended; no answer, busy or a voicemail → the one text, if allowed
//   sweepLeadCalls     the automatic calls (the cron, every 5 minutes): new leads nobody reached within the
//                      company's minutes, once each, inside the automatic hours
//
// A lead SmartBook is scheduling (lib/smartbook/phone leadCallExtras): the brief adds what SmartBook sent them and its
// request_time / not_interested tools, the voicemail points at those times, no text follows a missed call (they have
// the times), and "don't call" stops SmartBook too.
//
// The text after a missed call goes through the one texting chokepoint (lib/sms/send): a company's number texts
// someone off the team only after they said yes on the booking page (lib/sms/consent) — the opt-in its carrier
// registration was approved on — so most new leads get the voicemail alone. STOP always wins, for calls too.
//
// State: SyncState `leadcall:<leadId>` — the desk's last call to that lead (no schema change); a "don't call" is also
// kept per company and phone (`deskdnc:<orgId>:<E.164>`), so a second lead from the same person is not called. The
// call itself is an AiPhoneCall row (direction OUTBOUND, the lead's id) beside the `callout:<callSid>` outcome every
// desk call keeps, so the Phone page and the lead page both read it.
import "server-only";
import { db } from "@/lib/db";
import { isUsCanadaNumber, toE164 } from "@/lib/phone";
import { twilioSettings } from "@/lib/sdk/twilio";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { isPageLocked } from "@/lib/customPageAccess";
import { appBaseUrl } from "@/lib/appUrl";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { sendText } from "@/lib/sms/send";
import { contactsLocked } from "@/lib/leadCenter/contacts";
import { markLeadContacted } from "@/lib/leads/contacted";
import { leadSourceOf } from "@/lib/leads/sources";
import { metaLeadPresentation } from "@/lib/meta/leadPresentation";
import { deskFinancingAnswer } from "@/lib/financing/desk";
import { companyFacts } from "./facts";
import { deskNumberFor } from "./forwardTest";
import { finishCall, readCallOutcome, type CallOutcome } from "./liveCall";
import { deskBalanceFor } from "./minutes";
import { readDeskSettings } from "./numbers";
import { deskInstructions, profileFromFacts, withFinancingAnswer } from "./profile";
import { parseDeskSettings, prettyPhone } from "./shared";
import { DESK_TOOLS } from "./testCall";
import { signCallToken, voiceServerConfigured, voiceStreamUrl, type CallToken } from "./voiceToken";

export type LeadCallStatus = "calling" | "talking" | "done" | "voicemail" | "no-answer" | "busy" | "failed";

export type LeadCall = {
  sid: string | null;
  /** When the call was placed (ISO). */
  at: string;
  /** Who pressed "Have the AI desk call"; null for the automatic call. */
  by: string | null;
  auto: boolean;
  status: LeadCallStatus;
  /** What the desk got done on a call it talked on. */
  result: "booked" | "message" | "transfer" | "talked" | null;
  seconds: number;
  /** The text after a voicemail or no answer: sent, held for the morning, not allowed (no yes to texts), failed. */
  texted: "sent" | "held" | "not-allowed" | "failed" | null;
  error: string | null;
  /** They told the desk not to call again. */
  dnc: boolean;
  /** When each desk call to this lead was placed, newest last — the caps read it. */
  times: string[];
};

const KEY = (leadId: string) => `leadcall:${leadId}`;
const DNC_KEY = (organizationId: string, phone: string) => `deskdnc:${organizationId}:${phone}`;
const STATUSES: LeadCallStatus[] = ["calling", "talking", "done", "voicemail", "no-answer", "busy", "failed"];
const IN_CALL_MS = 15 * 60_000;
const DAY_MS = 24 * 3600_000;
/** Desk calls to one lead in 24 hours, the button's and the automatic one together. */
const PER_DAY = 3;
/** The automatic call reaches back this far: a lead that came in on a Saturday night is still called on Monday. */
const AUTO_WINDOW_MS = 48 * 3600_000;
/** Sources that already talked with the company — the desk took the call, they booked online, they phoned. */
const NO_AUTO_SOURCES = new Set(["ai-desk", "booking", "phone"]);
const CLOSED = new Set(["WON", "LOST", "ARCHIVED"]);
const HANGUP = `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;

const LEAD_SELECT = { id: true, organizationId: true, name: true, phone: true, email: true, address: true, city: true, state: true, zip: true, status: true, source: true, projectType: true, aiCategory: true, description: true, scope: true, contactedAt: true } as const;
type LeadForCall = { id: string; organizationId: string; name: string; phone: string | null; email: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; status: string; source: string | null; projectType: string | null; aiCategory: string | null; description: string | null; scope: string | null; contactedAt: Date | null };

const xmlEsc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c);
const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";
/** "(555) 123-4567" → "555-123-4567": read out digit by digit, not as one big number. */
const spokenPhone = (e164: string) => e164.replace(/^\+1/, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");

/* ── State ────────────────────────────────────────────────────────────── */

function parseCall(raw: string): LeadCall | null {
  try {
    const o = JSON.parse(raw) as Partial<LeadCall>;
    if (typeof o.at !== "string" || !STATUSES.includes(o.status as LeadCallStatus)) return null;
    return {
      sid: typeof o.sid === "string" ? o.sid : null,
      at: o.at,
      by: typeof o.by === "string" ? o.by : null,
      auto: o.auto === true,
      status: o.status as LeadCallStatus,
      result: o.result === "booked" || o.result === "message" || o.result === "transfer" || o.result === "talked" ? o.result : null,
      seconds: Number.isFinite(o.seconds) ? Math.max(0, Math.round(Number(o.seconds))) : 0,
      texted: o.texted === "sent" || o.texted === "held" || o.texted === "not-allowed" || o.texted === "failed" ? o.texted : null,
      error: typeof o.error === "string" ? o.error.slice(0, 300) : null,
      dnc: o.dnc === true,
      times: Array.isArray(o.times) ? o.times.filter((t): t is string => typeof t === "string").slice(-10) : [],
    };
  } catch {
    return null;
  }
}

export async function readLeadCall(leadId: string): Promise<LeadCall | null> {
  const row = await db.syncState.findUnique({ where: { key: KEY(leadId) }, select: { cursor: true } }).catch(() => null);
  return row ? parseCall(row.cursor) : null;
}

/** Several leads' calls at once (the CRM brief). */
export async function readLeadCalls(leadIds: string[]): Promise<Map<string, LeadCall>> {
  const out = new Map<string, LeadCall>();
  if (!leadIds.length) return out;
  const rows = await db.syncState.findMany({ where: { key: { in: leadIds.map(KEY) } }, select: { key: true, cursor: true } }).catch(() => []);
  for (const r of rows) {
    const c = parseCall(r.cursor);
    if (c) out.set(r.key.slice("leadcall:".length), c);
  }
  return out;
}

async function writeLeadCall(leadId: string, call: LeadCall): Promise<void> {
  const cursor = JSON.stringify(call);
  await db.syncState.upsert({ where: { key: KEY(leadId) }, create: { key: KEY(leadId), cursor }, update: { cursor } });
}

/** Change the lead's call — only while it is still the call this event is about. */
async function patchLeadCall(leadId: string, callSid: string | null | undefined, change: Partial<LeadCall>): Promise<LeadCall | null> {
  const cur = await readLeadCall(leadId);
  if (!cur || (cur.sid && callSid && cur.sid !== callSid)) return null;
  const next = { ...cur, ...change };
  await writeLeadCall(leadId, next);
  return next;
}

/** The desk is on the line with them, or still ringing them. */
export function callInProgress(call: LeadCall | null, now = new Date()): boolean {
  return !!call && (call.status === "calling" || call.status === "talking") && now.getTime() - Date.parse(call.at) < IN_CALL_MS;
}

/* ── May the desk call ────────────────────────────────────────────────── */

export type LeadCallReady = { ok: true; from: string } | { ok: false; why: string };

/** The company's side: everything a call from its desk needs, in the order the owner would fix it. */
export async function leadCallReadiness(organizationId: string): Promise<LeadCallReady> {
  if (!voiceServerConfigured() || !voiceStreamUrl()) return { ok: false, why: "The live AI desk isn't switched on yet." };
  const [twilio, from, desk, quota, locked, balance] = await Promise.all([
    twilioSettings().catch(() => null),
    deskNumberFor(organizationId).catch(() => null),
    readDeskSettings(organizationId),
    checkPlanLimit(organizationId, "aiPhoneCalls").catch(() => null),
    isPageLocked(organizationId, "phone").catch(() => true),
    deskBalanceFor(organizationId).catch(() => null),
  ]);
  if (!twilio) return { ok: false, why: "Phone calls aren't connected yet." };
  if (locked || !quota) return { ok: false, why: "The AI desk isn't on your plan." };
  if (!quota.allowed) return { ok: false, why: "The AI desk has used this month's calls." };
  if (!from) return { ok: false, why: "The desk needs its phone number first (AI desk → Phone & forwarding)." };
  if (!desk.profile) return { ok: false, why: "Set up what the desk knows about your business first (AI desk → Your business)." };
  if (balance?.out) return { ok: false, why: "The desk is out of minutes — add minutes on the AI desk page." };
  return { ok: true, from };
}

/** The company's clock: day of the week (0 = Sunday) and minutes past midnight. */
function clock(now: Date, timeZone: string): { day: number; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    return { day: day < 0 ? now.getUTCDay() : day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
  } catch {
    return { day: now.getUTCDay(), minutes: now.getUTCHours() * 60 + now.getUTCMinutes() };
  }
}

/** When the desk calls, in the company's time: a person's press 8 AM–8 PM any day; the automatic call 9 AM–7 PM,
 *  Monday to Saturday — inside the stricter state calling-hour rules, and never a Sunday surprise. */
export const CALL_HOURS = { button: { from: 8 * 60, to: 20 * 60, sunday: true }, auto: { from: 9 * 60, to: 19 * 60, sunday: false } } as const;

export function inCallingHours(now: Date, timeZone: string, auto: boolean): boolean {
  const h = auto ? CALL_HOURS.auto : CALL_HOURS.button;
  const c = clock(now, timeZone);
  if (c.day === 0 && !h.sunday) return false;
  return c.minutes >= h.from && c.minutes < h.to;
}

/** Why this lead cannot be called by the desk, or null. */
async function leadBlock(lead: LeadForCall, call: LeadCall | null, now: Date): Promise<string | null> {
  const phone = toE164(lead.phone ?? "");
  if (contactsLocked(lead)) return "Accept the lead first — its phone number opens then.";
  if (!phone || !isUsCanadaNumber(phone)) return "This lead has no US or Canadian phone number to call.";
  if (CLOSED.has(lead.status)) return "This lead is closed.";
  const [optedOut, dnc] = await Promise.all([
    db.smsOptOut.findUnique({ where: { phone }, select: { phone: true } }).catch(() => null),
    db.syncState.findUnique({ where: { key: DNC_KEY(lead.organizationId, phone) }, select: { key: true } }).catch(() => null),
  ]);
  if (optedOut) return "They texted STOP to your number, so the desk won't call them.";
  if (dnc || call?.dnc) return "They asked the desk not to call them again.";
  if (callInProgress(call, now)) return "The desk is calling them now.";
  if ((call?.times ?? []).filter((t) => now.getTime() - Date.parse(t) < DAY_MS).length >= PER_DAY) return "The desk has called them three times today — a person should try next.";
  return null;
}

const OUT_OF_HOURS = "The desk calls leads between 8 AM and 8 PM your time — try again then.";

/** For the lead page: may the desk call this lead now — and if not, why (null when it may). */
export async function leadCallBlocker(organizationId: string, leadId: string, timeZone: string, now = new Date()): Promise<string | null> {
  const lead = (await db.lead.findFirst({ where: { id: leadId, organizationId }, select: LEAD_SELECT })) as LeadForCall | null;
  if (!lead) return "That lead isn't here any more.";
  const ready = await leadCallReadiness(organizationId);
  if (!ready.ok) return ready.why;
  const blocked = await leadBlock(lead, await readLeadCall(leadId), now);
  if (blocked) return blocked;
  return inCallingHours(now, timeZone, false) ? null : OUT_OF_HOURS;
}

/* ── Placing the call ─────────────────────────────────────────────────── */

/** The public origin Twilio calls back to — the one its signatures are checked against (lib/sdk/twilioVoice). */
export async function callbackBase(): Promise<string> {
  return (process.env.TWILIO_APP_URL ?? (await appBaseUrl())).replace(/\/$/, "");
}

function twilioWords(message: string): string {
  if (/not.*(verified|permitted)|geo.?permission|international/i.test(message)) return "Twilio won't call that number from this account.";
  if (/invalid.*(to|phone)|not a valid/i.test(message)) return "That phone number can't be called.";
  return "The call couldn't be placed. Try again in a minute.";
}

async function placeCall(input: { to: string; from: string; url: string; statusCallback: string }): Promise<string> {
  const s = await twilioSettings();
  if (!s) throw new Error("Twilio isn't connected.");
  const base = (process.env.NODE_ENV !== "production" && process.env.TWILIO_API_BASE?.trim()) || "https://api.twilio.com";
  // DetectMessageEnd: a person is told apart in a second or two; a machine is answered after its beep.
  const body = new URLSearchParams({ To: input.to, From: input.from, Url: input.url, Method: "POST", StatusCallback: input.statusCallback, StatusCallbackMethod: "POST", Timeout: "25", MachineDetection: "DetectMessageEnd" });
  body.append("StatusCallbackEvent", "completed");
  const res = await fetch(`${base.replace(/\/$/, "")}/2010-04-01/Accounts/${s.accountSid}/Calls.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${s.accountSid}:${s.authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok || !j.sid) throw new Error(j.message ? `Twilio: ${j.message}` : `Twilio refused the call (HTTP ${res.status}).`);
  return j.sid;
}

/** One desk call to one lead. `by`: the member who pressed the button; null for the automatic call. `why: "smartbook"`:
 *  SmartBook's one call (lib/smartbook/engine) — the automatic kind, in SmartBook's words on the trail. */
export async function callLead(
  organizationId: string,
  leadId: string,
  opts: { by: string | null; auto: boolean; now?: Date; why?: "smartbook" },
): Promise<{ ok: true; call: LeadCall } | { ok: false; error: string }> {
  const now = opts.now ?? new Date();
  const lead = (await db.lead.findFirst({ where: { id: leadId, organizationId }, select: LEAD_SELECT })) as LeadForCall | null;
  if (!lead) return { ok: false, error: "That lead isn't here any more." };
  const [ready, prior, facts] = await Promise.all([leadCallReadiness(organizationId), readLeadCall(leadId), companyFacts(organizationId).catch(() => null)]);
  if (!ready.ok) return { ok: false, error: ready.why };
  if (opts.auto && prior) return { ok: false, error: "The desk already called this lead." };
  const blocked = await leadBlock(lead, prior, now);
  if (blocked) return { ok: false, error: blocked };
  const tz = facts?.timezone || "America/New_York";
  if (!inCallingHours(now, tz, opts.auto)) return { ok: false, error: OUT_OF_HOURS };

  const phone = toE164(lead.phone ?? "")!;
  const times = [...(prior?.times ?? []).filter((t) => now.getTime() - Date.parse(t) < DAY_MS), now.toISOString()];
  const call: LeadCall = { sid: null, at: now.toISOString(), by: opts.by, auto: opts.auto, status: "calling", result: null, seconds: 0, texted: null, error: null, dnc: false, times };
  // Written before the call is placed: the answer can reach the app before Twilio's reply to the REST call does.
  await writeLeadCall(leadId, call);
  const base = await callbackBase();
  const q = `?l=${encodeURIComponent(leadId)}&o=${encodeURIComponent(organizationId)}`;
  let sid: string;
  try {
    sid = await placeCall({ to: phone, from: ready.from, url: `${base}/api/twilio/voice/lead-call${q}`, statusCallback: `${base}/api/twilio/voice/lead-call/status${q}` });
  } catch (err) {
    const error = twilioWords(err instanceof Error ? err.message : "");
    console.warn("[leadCalls] call not placed:", err instanceof Error ? err.message : err);
    await writeLeadCall(leadId, { ...call, status: "failed", error });
    return { ok: false, error };
  }
  const placed = (await patchLeadCall(leadId, null, { sid })) ?? { ...call, sid };
  // The Phone page's row (OUTBOUND, the lead's id) — finishLeadCall and the status callback fill it in.
  await db.aiPhoneCall
    .create({ data: { organizationId, direction: "OUTBOUND", fromNumber: ready.from, toNumber: phone, status: "IN_PROGRESS", callSid: sid, leadId, summary: opts.why === "smartbook" ? "SmartBook's call about a time" : opts.auto ? "The AI desk called a new lead" : "The AI desk called the lead" } })
    .catch((err) => console.warn("[leadCalls] call row not written:", err instanceof Error ? err.message : err));
  await logActivity({ organizationId, actorId: opts.by, kind: TRAIL_KINDS.CLIENT, summary: opts.why === "smartbook" ? `The AI desk called ${lead.name} about the times SmartBook sent` : opts.auto ? `The AI desk called ${lead.name}, a new lead nobody had reached yet` : `The AI desk is calling ${lead.name}`, leadId, meta: { callSid: sid, auto: opts.auto, ...(opts.why ? { why: opts.why } : {}) } });
  return { ok: true, call: placed };
}

/** What SmartBook has told this lead, when it is scheduling them (lib/smartbook/phone) — null otherwise. */
const smartBookExtras = (organizationId: string, leadId: string) =>
  import("@/lib/smartbook/phone").then((m) => m.leadCallExtras(organizationId, leadId)).catch(() => null);

/* ── Twilio's webhooks ────────────────────────────────────────────────── */

/** "the roof replacement request" / "the request" — what the lead asked about, in the desk's words. */
function aboutWords(lead: Pick<LeadForCall, "projectType" | "aiCategory">): string {
  const what = (lead.projectType || lead.aiCategory || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return what && what.length <= 60 ? `${what} request` : "request";
}

/** " on Facebook" — where the request came from, when that is worth saying. */
function viaWords(source: string | null): string {
  const k = leadSourceOf(source).key;
  if (k === "facebook") return " on Facebook";
  if (k === "instagram") return " on Instagram";
  if (k === "website") return " through our website";
  if (k === "google") return " through Google";
  return "";
}

/** `said`: SmartBook's words for a lead it sent times to (where the times are). */
function voicemailTwiml(lead: LeadForCall, company: string, callBack: string | null, said: string | null = null): string {
  const say = said ?? `Hi ${firstName(lead.name)}, this is the virtual assistant for ${company}, returning the ${aboutWords(lead)} you sent us. Sorry we missed you.${callBack ? ` Please call us back at ${spokenPhone(callBack)}.` : " We'll try you again soon."} Thank you, and have a good day.`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Say voice="Polly.Joanna">${xmlEsc(say)}</Say><Hangup/></Response>`;
}

/** The call connected: a person gets the live desk; a machine, after its beep, the voicemail. */
export async function leadCallAnswered(organizationId: string, leadId: string, params: Record<string, string>, base: string): Promise<string> {
  const call = await readLeadCall(leadId);
  if (!call || (call.sid && params.CallSid && call.sid !== params.CallSid)) return HANGUP;
  const lead = (await db.lead.findFirst({ where: { id: leadId, organizationId }, select: LEAD_SELECT })) as LeadForCall | null;
  if (!lead) return HANGUP;
  const answeredBy = (params.AnsweredBy ?? "").slice(0, 40);
  if (/^machine_end/.test(answeredBy)) {
    const [facts, from, smart] = await Promise.all([companyFacts(organizationId).catch(() => null), deskNumberFor(organizationId).catch(() => null), smartBookExtras(organizationId, leadId)]);
    await patchLeadCall(leadId, params.CallSid, { status: "voicemail" });
    return voicemailTwiml(lead, facts?.name || "our company", from ?? toE164(facts?.phone ?? ""), smart?.voicemail ?? null);
  }
  if (/^machine/.test(answeredBy) || answeredBy === "fax") {
    await patchLeadCall(leadId, params.CallSid, { status: "no-answer" });
    return HANGUP;
  }
  const ws = voiceStreamUrl();
  if (!ws || !voiceServerConfigured()) {
    await patchLeadCall(leadId, params.CallSid, { status: "failed", error: "The live desk was off when they answered." });
    return HANGUP;
  }
  await patchLeadCall(leadId, params.CallSid, { status: "talking" });
  const token = signCallToken({ callSid: params.CallSid ?? call.sid ?? "", organizationId, from: toE164(lead.phone ?? "") ?? "", kind: "lead", ref: leadId }, 30 * 60_000);
  const q = `?l=${encodeURIComponent(leadId)}&o=${encodeURIComponent(organizationId)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${xmlEsc(ws)}">
      <Parameter name="token" value="${xmlEsc(token)}"/>
    </Stream>
  </Connect>
  <Redirect method="POST">${xmlEsc(`${base}/api/twilio/voice/lead-call/after${q}`)}</Redirect>
</Response>`;
}

/** After the desk's part: a transfer rings the company phone (never one that forwards every call back to the desk). */
export async function leadCallAfter(organizationId: string, callSid: string | null): Promise<string> {
  if (!callSid) return HANGUP;
  const outcome = await readCallOutcome(callSid);
  if (outcome?.outcome !== "transfer") return HANGUP;
  const [org, desk] = await Promise.all([db.organization.findUnique({ where: { id: organizationId }, select: { phone: true } }), readDeskSettings(organizationId)]);
  const phone = desk.forwarding === "all" ? null : toE164(org?.phone ?? "");
  return phone ? `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="25">${xmlEsc(phone)}</Dial></Response>` : HANGUP;
}

/** The text after a missed call: the booking link or the number to call — sent only where the company may text them. */
async function textAfterMissedCall(organizationId: string, leadId: string, callSid: string | null): Promise<void> {
  const lead = (await db.lead.findFirst({ where: { id: leadId, organizationId }, select: LEAD_SELECT })) as LeadForCall | null;
  const phone = toE164(lead?.phone ?? "");
  if (!lead || !phone) return;
  // SmartBook already sent them its times by text or email: no second message about the same visit.
  if (await smartBookExtras(organizationId, leadId)) return;
  const [facts, from] = await Promise.all([companyFacts(organizationId).catch(() => null), deskNumberFor(organizationId).catch(() => null)]);
  const back = from ?? toE164(facts?.phone ?? "");
  const company = facts?.name || "our company";
  const body = `Hi ${firstName(lead.name)}, this is ${company}. We just tried calling about the ${aboutWords(lead)} you sent us.${facts?.bookingUrl ? ` Pick a time for a visit here: ${facts.bookingUrl}` : ""}${back ? `${facts?.bookingUrl ? " — or call" : " Call"} us back at ${prettyPhone(back)}.` : ""}`;
  const r = await sendText({ organizationId, to: phone, body, kind: "lead-desk-call" });
  const texted: LeadCall["texted"] = r.ok ? (r.status === "SENT" ? "sent" : r.status === "HELD" ? "held" : "not-allowed") : r.reason === "opted-out" ? "not-allowed" : "failed";
  await patchLeadCall(leadId, callSid, { texted });
}

/** Twilio's last word on the call (StatusCallback, "completed"). */
export async function leadCallStatus(organizationId: string, leadId: string, params: Record<string, string>): Promise<void> {
  const status = (params.CallStatus ?? "").toLowerCase();
  const sid = params.CallSid || null;
  const cur = await readLeadCall(leadId);
  if (!cur || (cur.sid && sid && cur.sid !== sid)) return;
  const seconds = Number(params.CallDuration) || 0;
  let change: Partial<LeadCall> = { seconds: Math.max(cur.seconds, seconds) };
  if (status === "no-answer" || status === "canceled") change = { ...change, status: "no-answer" };
  else if (status === "busy") change = { ...change, status: "busy" };
  else if (status === "failed") change = { ...change, status: "failed", error: cur.error ?? "The call didn't connect." };
  // Completed while still "calling": no person ever reached the desk (a machine Twilio hung up on).
  else if (status === "completed" && cur.status === "calling") change = { ...change, status: "no-answer" };
  else if (status === "completed" && cur.status === "talking") change = { ...change, status: "done" };
  const next = await patchLeadCall(leadId, sid, change);
  if (!next) return;
  if (next.status === "no-answer" || next.status === "busy" || next.status === "voicemail" || next.status === "failed") {
    const summary = next.status === "voicemail" ? "Voicemail left for the lead" : next.status === "busy" ? "The lead's line was busy" : next.status === "failed" ? "The call to the lead didn't connect" : "The lead didn't answer";
    if (sid) await db.aiPhoneCall.updateMany({ where: { callSid: sid, organizationId }, data: { status: next.status === "failed" ? "FAILED" : "COMPLETED", endedAt: new Date(), durationSeconds: seconds, summary } }).catch(() => null);
  }
  if ((next.status === "no-answer" || next.status === "busy" || next.status === "voicemail") && !next.texted) {
    await textAfterMissedCall(organizationId, leadId, sid).catch((err) => console.warn("[leadCalls] text after a missed call failed:", err instanceof Error ? err.message : err));
  }
}

/* ── What the voice server asks while the desk talks ─────────────────── */

const DO_NOT_CALL_TOOL = {
  type: "function",
  name: "do_not_call",
  description: "They asked not to be called again, or said they never sent a request. Note it once, say you're sorry for the bother and that the company won't call again, then say goodbye and call end_call.",
  parameters: { type: "object", properties: { reason: { type: "string", description: "In their words, short" } }, required: [] },
} as const;

/** What they told the company — the scope, else the form's answers, else their words — with the contact lines left out. */
function requestWords(lead: LeadForCall): string {
  if (lead.scope?.trim()) return lead.scope.trim();
  const meta = metaLeadPresentation(lead);
  if (meta) return meta.answers.map((a) => `${a.label}: ${a.value}`).join("\n");
  return (lead.description ?? "").trim();
}

export async function leadCallBrief(t: CallToken): Promise<{ ok: true; instructions: string; voice: string; maxSeconds: number; callSid: string; tools: unknown[] } | { ok: false; error: string }> {
  const lead = t.ref ? ((await db.lead.findFirst({ where: { id: t.ref, organizationId: t.organizationId }, select: LEAD_SELECT })) as LeadForCall | null) : null;
  if (!lead) return { ok: false, error: "no such lead" };
  const [facts, settings, balance, call, smart] = await Promise.all([companyFacts(t.organizationId), readDeskSettings(t.organizationId), deskBalanceFor(t.organizationId).catch(() => null), readLeadCall(lead.id), smartBookExtras(t.organizationId, lead.id)]);
  if (!facts) return { ok: false, error: "no such company" };
  if (balance?.out) return { ok: false, error: "out of minutes" };
  if (call?.dnc) return { ok: false, error: "asked not to be called" };
  const first = firstName(lead.name);
  const via = viaWords(lead.source);
  const greeting = `Hi, this is the virtual assistant for ${facts.name}, calling about the ${aboutWords(lead)} you sent us${via}. This call is recorded. Am I speaking with ${first}?`;
  const profile = withFinancingAnswer({ ...(settings.profile ?? profileFromFacts(facts)), greeting }, await deskFinancingAnswer(t.organizationId).catch(() => null));
  const nowWords = new Date().toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: facts.timezone });
  const request = requestWords(lead).slice(0, 1500);
  const where = [lead.address, lead.city, [lead.state, lead.zip].filter(Boolean).join(" ")].filter((x) => x && x.trim()).join(", ");
  const extras = [
    `THIS CALL IS DIFFERENT: you are not answering the company's line. You placed this call to ${lead.name}, who sent the company a ${aboutWords(lead)}${via}. It is ${nowWords} (${facts.timezone}). Their number is ${t.from}${lead.email ? `, their email ${lead.email}` : ""}${where ? `, the job address ${where}` : ""}.`,
    request ? `WHAT THEY TOLD THE COMPANY:\n${request}` : "",
    `HOW THIS CALL GOES: first make sure you are speaking with ${first}. If someone else answers, ask whether ${first} is there; if not, say the company will try again, say goodbye and call end_call. With ${first}: thank them for reaching out, say in one sentence what you understood they need, ask only the intake questions they have not already answered, then offer a visit — call open_times, offer what it returns, and book with book_visit once they pick a time, using the name, number and address above unless they give others. If now is a bad time, offer to have the office call back and take a message with take_message. If they ask not to be called, or say they never sent a request, call do_not_call. Never argue or push; one offer of a visit is enough.`,
    smart?.lines ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const maxSeconds = balance ? Math.max(60, Math.min(600, balance.remainingSeconds)) : 600;
  // "ANSWER", whatever the desk's mode: FORWARD's words ("the company phone rang first…") describe a call coming in.
  return { ok: true, instructions: `${deskInstructions(profile, facts, "ANSWER", settings.forwarding)}\n\n${extras}`, voice: settings.voice, maxSeconds, callSid: t.callSid, tools: [...DESK_TOOLS, DO_NOT_CALL_TOOL, ...(smart?.tools ?? [])] };
}

/** A tool the lead call's brief brought (voice/call.mjs posts it to /api/desk/tool). */
export async function leadCallTool(t: CallToken, name: string, args: Record<string, unknown>): Promise<{ ok: true; output: unknown; outcome?: "done" } | { ok: false; error: string }> {
  if (name !== "do_not_call" || !t.ref) return { ok: false, error: "no such tool on this call" };
  const lead = (await db.lead.findFirst({ where: { id: t.ref, organizationId: t.organizationId }, select: LEAD_SELECT })) as LeadForCall | null;
  if (!lead) return { ok: false, error: "no such lead" };
  const phone = toE164(lead.phone ?? "");
  if (phone) await db.syncState.upsert({ where: { key: DNC_KEY(t.organizationId, phone) }, create: { key: DNC_KEY(t.organizationId, phone), cursor: new Date().toISOString() }, update: { cursor: new Date().toISOString() } });
  await patchLeadCall(lead.id, t.callSid, { dnc: true });
  const reason = typeof args.reason === "string" ? args.reason.trim().slice(0, 200) : "";
  await logActivity({ organizationId: t.organizationId, actorId: null, kind: "CALL", summary: `${lead.name} asked the AI desk not to call again${reason ? `: "${reason}"` : ""}`, leadId: lead.id });
  // SmartBook stops too: no more times by text or email to someone who asked not to be called, or never asked.
  await import("@/lib/smartbook/phone").then((m) => m.smartBookStop(t.organizationId, lead.id, reason)).catch(() => null);
  return { ok: true, output: { noted: true, say: "Apologise briefly, say the company won't call again, say goodbye, then call end_call." }, outcome: "done" };
}

/** take_message on a lead call: the message joins this lead's trail — a lead call never makes a second lead. */
export async function leadCallMessage(t: CallToken, input: { name: string; phone: string; about: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const lead = t.ref ? await db.lead.findFirst({ where: { id: t.ref, organizationId: t.organizationId }, select: { id: true, name: true } }) : null;
  if (!lead) return { ok: false, error: "no such lead" };
  const about = input.about.trim().slice(0, 2000);
  const phone = toE164(input.phone) ?? input.phone.trim().slice(0, 30);
  await db.aiPhoneCall.updateMany({ where: { callSid: t.callSid, organizationId: t.organizationId }, data: { leadId: lead.id, summary: `Message from ${lead.name}: ${about.slice(0, 100)}` } });
  await logActivity({ organizationId: t.organizationId, actorId: null, kind: "CALL", summary: `The AI desk took a message from ${lead.name}${phone && phone !== t.from ? ` (call back on ${phone})` : ""}: ${about.slice(0, 160)}`, leadId: lead.id });
  return { ok: true };
}

/** The call is over: the desk's usual bookkeeping onto this lead's row, then the lead's own state. */
export async function finishLeadCall(
  t: CallToken,
  input: { outcome: CallOutcome["outcome"]; transcript: Array<{ role: string; text: string }>; seconds: number; booked: { appointmentId: string } | null; messageTaken: boolean; error?: string | null },
): Promise<void> {
  const leadId = t.ref ?? "";
  // The transcript and summary go on the call's own row — a lead call never makes a new lead.
  await finishCall({ callSid: t.callSid, organizationId: t.organizationId }, input, { newLead: false });
  if (!leadId) return;
  await db.aiPhoneCall.updateMany({ where: { callSid: t.callSid, organizationId: t.organizationId }, data: { leadId } });
  const spoke = input.transcript.some((l) => l.role === "caller");
  const result: LeadCall["result"] = input.booked ? "booked" : input.messageTaken ? "message" : input.outcome === "transfer" ? "transfer" : spoke ? "talked" : null;
  await patchLeadCall(leadId, t.callSid, { status: input.outcome === "failed" && !spoke ? "failed" : "done", result, seconds: Math.max(0, Math.round(input.seconds)), error: input.error ? input.error.slice(0, 300) : null });
  if (!spoke) return;
  // They talked with the desk: the lead was reached (the time only — no person took it, so status and owner stay).
  await markLeadContacted(t.organizationId, leadId);
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: t.organizationId }, select: { name: true } });
  const what = result === "booked" ? "booked a visit" : result === "message" ? "took a message" : result === "transfer" ? "put them through to the office" : "talked with them";
  await logActivity({ organizationId: t.organizationId, actorId: null, kind: "CALL", summary: `The AI desk reached ${lead?.name ?? "the lead"} and ${what}`, leadId, meta: { callSid: t.callSid, seconds: Math.round(input.seconds) } });
}

/* ── The automatic calls ──────────────────────────────────────────────── */

/** Every company with "Call new leads" on: its new leads nobody reached within its minutes, once each. */
export async function sweepLeadCalls(now = new Date(), budgetMs = 45_000): Promise<{ companies: number; placed: number; skipped: number; failed: number }> {
  const out = { companies: 0, placed: 0, skipped: 0, failed: 0 };
  if (!voiceServerConfigured()) return out;
  const until = Date.now() + budgetMs;
  const rows = await db.syncState.findMany({ where: { key: { startsWith: "aidesk:" }, cursor: { contains: '"leadCalls"' } }, select: { key: true, cursor: true }, take: 500 });
  for (const row of rows) {
    if (Date.now() > until) break;
    const organizationId = row.key.slice("aidesk:".length);
    const desk = parseDeskSettings(row.cursor);
    if (!desk.leadCalls.on) continue;
    out.companies++;
    const facts = await companyFacts(organizationId).catch(() => null);
    if (!facts || !inCallingHours(now, facts.timezone || "America/New_York", true)) continue;
    if (!(await leadCallReadiness(organizationId)).ok) continue;
    const leads = await db.lead.findMany({
      where: {
        organizationId,
        status: { in: ["NEW", "ROUTED", "CLAIMED"] },
        contactedAt: null,
        phone: { not: null },
        createdAt: { gte: new Date(now.getTime() - AUTO_WINDOW_MS), lte: new Date(now.getTime() - desk.leadCalls.afterMinutes * 60_000) },
        appointments: { none: {} },
        phoneCalls: { none: {} },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, source: true, status: true },
      take: 10,
    });
    const fresh = leads.filter((l) => !NO_AUTO_SOURCES.has(leadSourceOf(l.source).key) && !contactsLocked(l));
    const called = await readLeadCalls(fresh.map((l) => l.id));
    // Two calls a company a sweep — the next sweep is five minutes away.
    let placedHere = 0;
    for (const l of fresh) {
      if (placedHere >= 2 || Date.now() > until) break;
      if (called.has(l.id)) continue;
      const r = await callLead(organizationId, l.id, { by: null, auto: true, now });
      if (r.ok) {
        out.placed++;
        placedHere++;
      } else {
        out.skipped++;
        if (/couldn't be placed|won't call|can't be called/.test(r.error)) out.failed++;
      }
    }
  }
  return out;
}
