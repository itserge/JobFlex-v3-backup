// JOBFLEX'S OUTREACH CALLS, SERVER SIDE (2026-10-23) — server only. The list (lib/outreach/store), the line check
// (Twilio's lookup: landline or not), the call itself (Twilio's REST API from JobFlex's number, its answering-machine
// check; a person gets the AI desk's voice server on JobFlex's own script, a machine a short voicemail), what the call
// may do (email the trial link, note how it went, never call again), how it ended, the one email to the contractors
// the AI may not call, and the "Have the AI desk call me" request that is their consent. Who may be called when is
// lib/outreach/rules; the words are lib/outreach/script and ./letter.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { toE164, isUsCanadaNumber } from "@/lib/phone";
import { twilioSettings } from "@/lib/sdk/twilio";
import { jobflexSender } from "@/lib/sms/jobflexSender";
import { getPlanCatalog } from "@/lib/planCatalogServer";
import { formatPlanPrice } from "@/lib/planCatalog";
import { storedTrialOffer } from "@/lib/trialOffer";
import { signCallToken, voiceServerConfigured, voiceStreamUrl, type CallToken } from "@/lib/aiDesk/voiceToken";
import { isEmailEnabled, platformMailbox, sendEmail } from "@/lib/sdk/resend";
import { readOptOut, unsubscribeHeaders, unsubscribeUrl } from "@/lib/adminMail/optout";
import { fromLine } from "@/lib/adminMail/server";
import { logServerError } from "@/lib/server-events";
import {
  type ListRow,
  OUTREACH_CONSENT_TEXT,
  callableNow,
  lineTypeOf,
  parseProspectList,
  stateCode,
  tradeKey,
  emailDue,
  emailFirst,
  textDue,
  textableNow,
  twilioWords,
  type CallStatus,
  type LineType,
  type Outcome,
  type OutreachCall,
  type Prospect,
} from "./rules";
import { outreachInstructions, outreachText, outreachTools, outreachVoicemail, type ScriptFacts } from "./script";
import { sendText } from "@/lib/sms/send";
import { appBaseUrl } from "@/lib/appUrl";
import { OUTREACH_SENDER, outreachLetter } from "./letter";
import { listProspects, newProspectId, optOutId, readProspect, updateProspect, writeProspect } from "./store";

/** The company a call token names for these calls: none — JobFlex itself. */
export const OUTREACH_ORG = "jobflex-outreach";
/** Emails a day at most: a first email to a stranger is judged by how few go out at once. */
export const EMAILS_PER_DAY = 40;
const nowIso = () => new Date().toISOString();
const SITE = "jobflex.app";

/** The caller id: TWILIO_SALES_FROM (a local number answers better), else JobFlex's own line. */
export async function outreachFrom(): Promise<string | null> {
  const env = process.env.TWILIO_SALES_FROM?.trim();
  if (env) return toE164(env) ?? env;
  return jobflexSender().catch(() => null);
}
const transferTo = () => toE164(process.env.OUTREACH_TRANSFER_TO ?? "");
const postal = () => process.env.JOBFLEX_POSTAL_ADDRESS?.trim() || null;

export interface OutreachReadiness {
  calls: boolean;
  emails: boolean;
  /** JobFlex's own number is approved for texts (the one text after a call a contractor asked for). */
  texts: boolean;
  /** Twilio lets the account call US numbers: true / false as Twilio says, null when it couldn't be asked. */
  usCalls: boolean | null;
  /** What is missing, in words, for the page. */
  missing: string[];
  from: string | null;
  transfer: boolean;
}

/**
 * Does Twilio let this account call US numbers (its Voice geo permissions)? Asked of Twilio's dialing-permissions API
 * (2026-10-24: the owner's first test calls were refused — "Account not authorized to call +1…" — and the setting had
 * to be found in the right account). True / false as Twilio says; null when it couldn't be asked.
 */
async function usCallsAllowed(s: { accountSid: string; authToken: string }): Promise<boolean | null> {
  const base = (process.env.NODE_ENV !== "production" && process.env.TWILIO_VOICE_BASE?.trim()) || "https://voice.twilio.com";
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/v1/DialingPermissions/Countries/US`, {
      headers: { Authorization: `Basic ${Buffer.from(`${s.accountSid}:${s.authToken}`).toString("base64")}` },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => ({}))) as { low_risk_numbers_enabled?: unknown };
    return typeof j.low_risk_numbers_enabled === "boolean" ? j.low_risk_numbers_enabled : null;
  } catch {
    return null;
  }
}

/**
 * "Allow US calls" (owner, 2026-10-24: "you can go and do it"): the Voice geo permission turned on through Twilio's
 * own API on JobFlex's account — low-risk US & Canada numbers only, nothing premium or high-risk — then asked again.
 */
export async function allowUsCalls(): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await twilioSettings().catch(() => null);
  if (!s) return { ok: false, error: "Twilio isn't connected." };
  const base = (process.env.NODE_ENV !== "production" && process.env.TWILIO_VOICE_BASE?.trim()) || "https://voice.twilio.com";
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/v1/DialingPermissions/BulkCountryUpdates`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${s.accountSid}:${s.authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      // Twilio wants all three switches, as strings ("unable to parse the updateRequest" otherwise); the high-risk two stay off.
      body: new URLSearchParams({ UpdateRequest: JSON.stringify([{ iso_code: "US", low_risk_numbers_enabled: "true", high_risk_special_numbers_enabled: "false", high_risk_tollfraud_numbers_enabled: "false" }]) }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { message?: string; update_count?: number };
    if (!res.ok) return { ok: false, error: j.message ? `Twilio: ${j.message}` : `Twilio answered ${res.status}.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Twilio couldn't be reached." };
  }
  const now = await usCallsAllowed(s);
  return now === false ? { ok: false, error: "Twilio took the change but still says no — this may be a subaccount whose parent account holds the setting; set it there (Voice → Settings → Geo permissions)." } : { ok: true };
}

export async function outreachReadiness(): Promise<OutreachReadiness> {
  const [tw, from, textFrom] = await Promise.all([twilioSettings().catch(() => null), outreachFrom(), jobflexSender().catch(() => null)]);
  const missing: string[] = [];
  if (!tw) missing.push("Twilio isn't connected (Admin → Texting).");
  // Only Twilio's own "no" holds the calls back; a check that couldn't be made doesn't.
  const usOk = tw ? await usCallsAllowed(tw) : null;
  if (tw && usOk === false) missing.push(`Twilio won't call US numbers from JobFlex's account (${tw.accountSid.slice(0, 6)}…${tw.accountSid.slice(-4)}). In the Twilio Console, switch to that account, then Voice → Settings → Geo permissions → tick United States & Canada → Save.`);
  if (!voiceServerConfigured()) missing.push("The AI desk's voice server isn't connected (VOICE_SERVER_URL and VOICE_SERVER_SECRET).");
  if (!from) missing.push("No number to call from: set TWILIO_SALES_FROM to a JobFlex Twilio number (a local one answers best).");
  const emailsOk = isEmailEnabled() && !!postal();
  if (!isEmailEnabled()) missing.push("Email isn't set up on this server.");
  if (!postal()) missing.push("Emails need JobFlex's postal address in their footer — the email law asks for it in every email like this. Set JOBFLEX_POSTAL_ADDRESS (a street address or a PO box).");
  if (!textFrom) missing.push("Texts need JobFlex's own number approved by Twilio for texting — until then the text after a call isn't sent.");
  return { calls: !!tw && voiceServerConfigured() && !!from && usOk !== false, emails: emailsOk, texts: !!tw && !!textFrom, usCalls: usOk, missing, from, transfer: !!transferTo() };
}

/* ── The list ─────────────────────────────────────────────────────────── */

function blank(row: Partial<Prospect>, source: Prospect["source"]): Prospect {
  const at = nowIso();
  return {
    id: newProspectId(),
    name: row.name ?? "",
    business: row.business ?? "",
    phone: row.phone ?? null,
    email: row.email ?? null,
    trade: row.trade ?? null,
    state: row.state ?? null,
    city: row.city ?? null,
    source,
    line: null,
    consent: null,
    dnc: null,
    calls: [],
    emailedAt: null,
    interest: null,
    linkSentAt: null,
    linkSentTo: null,
    createdAt: at,
    updatedAt: at,
  };
}

/** A pasted list in: new contractors added, ones already on it filled in, ones already on JobFlex left out. */
export async function importProspects(text: string): Promise<{ added: number; merged: number; skipped: number; onJobflex: number }> {
  const { rows, skipped } = parseProspectList(text);
  const r = await importRows(rows, "list", {});
  return { ...r, skipped };
}

/** Rows into the list: the same phone or email already there fills in what it lacked; a company already on JobFlex is
 *  left out; the rest are new prospects of the given source (a pasted list, or found online by a hunt — 2026-10-25). */
export async function importRows(rows: ReadonlyArray<ListRow & { website?: string | null }>, source: Prospect["source"], extra: { huntId?: string | null }): Promise<{ added: number; merged: number; onJobflex: number }> {
  const list = await listProspects();
  const byPhone = new Map(list.filter((p) => p.phone).map((p) => [p.phone!, p]));
  const byEmail = new Map(list.filter((p) => p.email).map((p) => [p.email!, p]));
  // Already a JobFlex customer: a user with that email, or a company with that phone.
  const emails = rows.map((r) => r.email).filter((e): e is string => !!e);
  const phones = rows.map((r) => r.phone).filter((p): p is string => !!p);
  const [users, orgs] = await Promise.all([
    emails.length ? db.user.findMany({ where: { email: { in: emails } }, select: { email: true } }) : Promise.resolve([]),
    phones.length ? db.organization.findMany({ where: { phone: { in: [...phones, ...phones.map((p) => p.slice(2))] } }, select: { phone: true } }) : Promise.resolve([]),
  ]);
  const customerEmails = new Set(users.map((u) => u.email.toLowerCase()));
  const customerPhones = new Set(orgs.map((o) => toE164(o.phone ?? "")).filter(Boolean));
  let added = 0;
  let merged = 0;
  let onJobflex = 0;
  const fresh: Prospect[] = [];
  for (const r of rows) {
    if ((r.email && customerEmails.has(r.email)) || (r.phone && customerPhones.has(r.phone))) {
      onJobflex++;
      continue;
    }
    if (!r.phone && !r.email && !r.website) continue;
    const had = (r.phone && byPhone.get(r.phone)) || (r.email && byEmail.get(r.email)) || null;
    if (had) {
      await writeProspect({ ...had, name: had.name || r.name, business: had.business || r.business, email: had.email ?? r.email, phone: had.phone ?? r.phone, trade: had.trade ?? r.trade, state: had.state ?? r.state, website: had.website ?? r.website ?? null, city: had.city ?? r.city });
      merged++;
      continue;
    }
    fresh.push({ ...blank(r, source), ...(r.website ? { website: r.website } : {}), ...(extra.huntId ? { huntId: extra.huntId } : {}) });
    added++;
  }
  if (fresh.length) await db.syncState.createMany({ data: fresh.map((p) => ({ key: `outreach:p:${p.id}`, cursor: JSON.stringify(p) })) });
  return { added, merged, onJobflex };
}

/* ── The line check ──────────────────────────────────────────────────── */

async function lookupLine(e164: string): Promise<{ type: LineType; carrier: string | null }> {
  const s = await twilioSettings();
  if (!s) throw new Error("Twilio isn't connected.");
  const base = (process.env.NODE_ENV !== "production" && process.env.TWILIO_LOOKUP_BASE?.trim()) || "https://lookups.twilio.com";
  const res = await fetch(`${base.replace(/\/$/, "")}/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`, {
    headers: { Authorization: `Basic ${Buffer.from(`${s.accountSid}:${s.authToken}`).toString("base64")}` },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { line_type_intelligence?: { type?: string; carrier_name?: string } | null; message?: string };
  if (!res.ok) throw new Error(j.message ? `Twilio: ${j.message}` : `Twilio's lookup answered ${res.status}.`);
  return { type: lineTypeOf(j.line_type_intelligence?.type), carrier: j.line_type_intelligence?.carrier_name?.slice(0, 80) ?? null };
}

/** Which numbers are landlines: `limit` unchecked numbers at a time (each lookup is a fraction of a cent). */
export async function checkLines(limit = 50): Promise<{ checked: number; failed: number; left: number; error: string | null }> {
  const todo = (await listProspects()).filter((p) => p.phone && !p.line && !p.dnc && isUsCanadaNumber(p.phone));
  let checked = 0;
  let failed = 0;
  let error: string | null = null;
  for (const p of todo.slice(0, Math.max(1, Math.min(200, limit)))) {
    try {
      const line = await lookupLine(p.phone!);
      await writeProspect({ ...p, line: { ...line, at: nowIso() } });
      checked++;
    } catch (err) {
      failed++;
      error = err instanceof Error ? err.message : String(err);
      if (failed >= 3 && !checked) break;
    }
  }
  return { checked, failed, left: Math.max(0, todo.length - checked), error };
}

/* ── The call ─────────────────────────────────────────────────────────── */

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

const lastCall = (p: Prospect): OutreachCall | null => p.calls[p.calls.length - 1] ?? null;
function withLastCall(p: Prospect, change: Partial<OutreachCall>): Prospect {
  const calls = p.calls.slice();
  if (calls.length) calls[calls.length - 1] = { ...calls[calls.length - 1], ...change };
  return { ...p, calls };
}

/** Call one contractor now — if the rules allow it. */
export async function callProspect(id: string, base: string): Promise<{ ok: true; sid: string } | { ok: false; error: string }> {
  const p = await readProspect(id);
  if (!p) return { ok: false, error: "That contractor isn't on the list." };
  const may = callableNow(p, new Date());
  if (!may.ok) return { ok: false, error: may.why };
  const ready = await outreachReadiness();
  if (!ready.calls || !ready.from) return { ok: false, error: ready.missing.find((m) => !/mail|postal/i.test(m)) ?? "Calls aren't set up." };
  const call: OutreachCall = { sid: null, at: nowIso(), status: "calling", seconds: 0, answeredBy: null, outcome: null, summary: null, transcript: null, error: null };
  await writeProspect({ ...p, calls: [...p.calls, call] });
  const q = `?p=${encodeURIComponent(id)}`;
  try {
    const sid = await placeCall({ to: p.phone!, from: ready.from, url: `${base}/api/twilio/voice/outreach${q}`, statusCallback: `${base}/api/twilio/voice/outreach/status${q}` });
    await updateProspect(id, (x) => withLastCall(x, { sid }));
    return { ok: true, sid };
  } catch (err) {
    const error = twilioWords(err instanceof Error ? err.message : "The call could not be placed.");
    await updateProspect(id, (x) => withLastCall(x, { status: "failed", outcome: "failed", error }));
    return { ok: false, error };
  }
}

/** The next `n` the AI may call now: who asked for a call first, then the landlines in the order they came in. */
export async function callNext(n: number, base: string, opts: { emailsOn?: boolean } = {}): Promise<{ placed: number; failed: number; waiting: number; errors: string[] }> {
  const now = new Date();
  // The email goes first: a landline that has one is called two days after it (lib/outreach/rules emailFirst) — unless
  // the schedule sends no emails (calls only, 2026-10-25): then there is nothing to wait for.
  const emailsOn = opts.emailsOn ?? (await outreachReadiness()).emails;
  const list = (await listProspects()).filter((p) => callableNow(p, now).ok && emailFirst(p, now, emailsOn).ok);
  list.sort((a, b) => Number(!!b.consent) - Number(!!a.consent) || a.createdAt.localeCompare(b.createdAt));
  let placed = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const p of list.slice(0, Math.max(1, Math.min(25, n)))) {
    const r = await callProspect(p.id, base);
    if (r.ok) placed++;
    else {
      failed++;
      if (!errors.includes(r.error)) errors.push(r.error);
      if (failed >= 3 && !placed) break;
    }
  }
  return { placed, failed, waiting: Math.max(0, list.length - placed - failed), errors };
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const HANGUP = `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;

/** The call is answered: a person gets the AI on JobFlex's script; a machine, after its beep, the short voicemail. */
export async function outreachAnswered(id: string, params: Record<string, string>, base: string): Promise<string> {
  const p = await readProspect(id);
  const call = p ? lastCall(p) : null;
  if (!p || !call || (call.sid && params.CallSid && call.sid !== params.CallSid)) return HANGUP;
  const answeredBy = (params.AnsweredBy ?? "").slice(0, 40) || null;
  if (answeredBy && /^machine_end/.test(answeredBy)) {
    await updateProspect(id, (x) => withLastCall(x, { status: "voicemail", outcome: "voicemail", answeredBy }));
    const say = outreachVoicemail(p, await outreachFrom(), SITE);
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Say voice="Polly.Joanna">${xmlEsc(say)}</Say><Hangup/></Response>`;
  }
  if (answeredBy && (/^machine/.test(answeredBy) || answeredBy === "fax")) {
    await updateProspect(id, (x) => withLastCall(x, { status: "no-answer", outcome: "no-answer", answeredBy }));
    return HANGUP;
  }
  const ws = voiceStreamUrl();
  if (!ws || !voiceServerConfigured()) return HANGUP;
  await updateProspect(id, (x) => withLastCall(x, { status: "answered", answeredBy }));
  const token = signCallToken({ callSid: params.CallSid ?? call.sid ?? "", organizationId: OUTREACH_ORG, from: p.phone ?? "", kind: "outreach", ref: id }, 30 * 60_000);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${xmlEsc(ws)}">
      <Parameter name="token" value="${xmlEsc(token)}"/>
    </Stream>
  </Connect>
  <Redirect method="POST">${xmlEsc(`${base}/api/twilio/voice/outreach/after?p=${encodeURIComponent(id)}`)}</Redirect>
</Response>`;
}

/** After the AI's part: put the contractor through to a person at JobFlex if that is how it ended; else hang up. */
export async function outreachAfter(id: string): Promise<string> {
  const p = await readProspect(id);
  const to = transferTo();
  if (p && to && lastCall(p)?.summary === "transfer") return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="25">${xmlEsc(to)}</Dial></Response>`;
  return HANGUP;
}

/** Twilio's word on how the call ended: a call nobody (or no machine) picked up. */
export async function outreachStatus(id: string, params: Record<string, string>): Promise<void> {
  const status = (params.CallStatus ?? "").toLowerCase();
  const after = await updateProspect(id, (p) => {
    const c = lastCall(p);
    if (!c || (c.sid && params.CallSid && c.sid !== params.CallSid)) return p;
    const seconds = Number(params.CallDuration) || c.seconds;
    if (status === "no-answer" || status === "busy" || status === "canceled") return withLastCall(p, { status: status === "busy" ? "busy" : "no-answer", outcome: c.outcome ?? "no-answer", seconds });
    if (status === "failed") return withLastCall(p, { status: "failed", outcome: c.outcome ?? "failed", seconds, error: c.error ?? "The call didn't connect." });
    // Completed: still "calling" means the answer never reached us (a machine Twilio hung up on).
    if (c.status === "calling") return withLastCall(p, { status: "no-answer", outcome: c.outcome ?? "no-answer", seconds });
    return withLastCall(p, { seconds: Math.max(c.seconds, seconds) });
  });
  // A call they asked for that didn't talk (no answer, busy, a voicemail): the text with the link instead.
  const c = after ? lastCall(after) : null;
  if (c && (c.status === "no-answer" || c.status === "busy" || c.status === "voicemail")) await textAfterCall(id, false).catch((err) => logServerError("outreach-text", err, { kind: "action" }));
}

/* ── What the voice server asks while the AI talks ───────────────────── */

async function scriptFacts(): Promise<ScriptFacts> {
  const plans = await getPlanCatalog().catch(() => []);
  const onSale = plans.filter((x) => x.active && !x.isFree).sort((a, b) => a.order - b.order);
  // The trial is the sign-up's offer (lib/trialOffer), never the unused PricingPlan.trialDays (2026-10-26).
  return { plans: onSale.map((x) => ({ name: x.name, price: formatPlanPrice(x.priceCents) })), trialDays: storedTrialOffer().days, canTransfer: !!transferTo(), site: SITE };
}

export async function outreachBrief(t: CallToken): Promise<{ ok: true; instructions: string; voice: string; maxSeconds: number; callSid: string; tools: ReturnType<typeof outreachTools> } | { ok: false; error: string }> {
  const p = t.ref ? await readProspect(t.ref) : null;
  if (!p) return { ok: false, error: "no such contractor" };
  if (p.dnc) return { ok: false, error: "asked not to be called" };
  const facts = await scriptFacts();
  return { ok: true, instructions: outreachInstructions(p, facts, new Date()), voice: "marin", maxSeconds: 300, callSid: t.callSid, tools: outreachTools(facts.canTransfer) };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** The trial's sign-up page, marked as coming from this call. */
const trialUrl = (base: string, p: Prospect, medium: "ai-desk" | "sms" = "ai-desk") => `${base}/auth/register?utm_source=jobflex-call&utm_medium=${medium}${p.trade ? `&utm_campaign=${encodeURIComponent(p.trade)}` : ""}`;

/**
 * The one text after a call they asked for (lib/outreach/rules textDue): from JobFlex's own number through the one
 * texting chokepoint (lib/sms/send — a number that replied STOP is never texted, caps, the log). Sent or held, it is
 * marked; a STOP on record marks them "don't call" too.
 */
async function textAfterCall(id: string, answered: boolean): Promise<void> {
  await sendOutreachText(id, { answered });
}

/** One outreach text, if it is due (they agreed to texts; none since): sent or held, it is marked; a STOP on record marks
 *  them "don't call" too. The reason it did not go, else null. */
async function sendOutreachText(id: string, how: { answered: boolean; noCall?: boolean }): Promise<string | null> {
  const p = await readProspect(id);
  if (!p || !textDue(p) || !p.phone) return "not due";
  const base = (await appBaseUrl()).replace(/\/$/, "");
  const { trialDays } = await scriptFacts();
  const r = await sendText({ organizationId: null, to: p.phone, body: outreachText({ p, answered: how.answered, noCall: how.noCall, link: trialUrl(base, p, "sms"), trialDays }), kind: "jobflex-outreach" });
  if (r.ok && (r.status === "SENT" || r.status === "HELD")) {
    await updateProspect(id, (x) => ({ ...x, textedAt: nowIso() }));
    return null;
  }
  if (!r.ok && r.reason === "opted-out") await updateProspect(id, (x) => ({ ...x, dnc: x.dnc ?? { at: nowIso(), via: "sms" } }));
  return r.ok ? `held: ${r.status}` : r.reason;
}

/**
 * THE SCHEDULE'S TEXTS (owner, 2026-10-25: "text only, or call only, or email only, or all together — put it on the
 * schedule and it keeps texting them"). The next `n` contractors whose text is due — they agreed to calls and texts on
 * the call-me page, no text since — in their daytime hours (lib/outreach/rules textableNow), each through the one
 * texting chokepoint (lib/sms/send: STOP honoured, caps, the log). Never a number that did not agree: the law (TCPA;
 * Washington bans unsolicited commercial texts) and the carriers ask for that consent.
 */
export async function textNext(n: number): Promise<{ sent: number; waiting: number; later: number; errors: string[] }> {
  const now = new Date();
  const all = await listProspects();
  const list = all.filter((p) => textableNow(p, now));
  // Due, but night or Sunday on their clock: they wait for their daytime (said in the hour's summary).
  const later = all.filter((p) => textDue(p) && !textableNow(p, now)).length;
  list.sort((a, b) => (a.consent?.at ?? a.createdAt).localeCompare(b.consent?.at ?? b.createdAt));
  let sent = 0;
  const errors: string[] = [];
  for (const p of list.slice(0, Math.max(1, Math.min(50, n)))) {
    const why = await sendOutreachText(p.id, { answered: false, noCall: !p.calls.length });
    if (why === null) sent++;
    else if (why === "held: SKIPPED") {
      // Texting is switched off (the Twilio integration): stop here instead of logging a skipped text for each.
      errors.push("texting is switched off");
      break;
    } else if (!errors.includes(why)) errors.push(why);
  }
  return { sent, waiting: Math.max(0, list.length - sent), later, errors };
}

export async function outreachTool(t: CallToken, name: string, args: Record<string, unknown>, base: string): Promise<{ ok: true; outcome?: "done"; output: Record<string, unknown> } | { ok: false; error: string }> {
  const id = t.ref ?? "";
  const p = await readProspect(id);
  if (!p) return { ok: false, error: "no such contractor" };
  switch (name) {
    case "email_trial_link": {
      const email = String(args.email ?? "").trim().toLowerCase().slice(0, 160);
      if (!EMAIL_RE.test(email)) return { ok: false, error: "That doesn't look like an email address — ask them to spell it." };
      if (!isEmailEnabled()) return { ok: false, error: "Email isn't working right now — give them the site, jobflex.app, instead." };
      const first = p.name.trim().split(/\s+/)[0] || "";
      const link = trialUrl(base, p);
      const text = `${first ? `Hi ${first},` : "Hi,"}\n\nThanks for taking the call just now. Here is the link to start your free JobFlex trial:\n${link}\n\nIt takes a couple of minutes; the AI desk, the estimates and the proposals are all in it.\n\nJobFlex · jobflex.app`;
      const html = `<div style="max-width:560px;margin:0 auto;padding:24px 18px;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;"><p>${first ? `Hi ${xmlEsc(first)},` : "Hi,"}</p><p>Thanks for taking the call just now. Here is the link to start your free JobFlex trial:</p><p><a href="${xmlEsc(link)}" style="color:#1854a0;font-weight:600;">Start my JobFlex trial</a></p><p>It takes a couple of minutes; the AI desk, the estimates and the proposals are all in it.</p><p style="color:#6a6a6a;">JobFlex · jobflex.app</p></div>`;
      try {
        await sendEmail({ mailClass: "transactional", to: email, subject: "Your JobFlex trial link", html, text, from: fromLine("JobFlex") });
      } catch (err) {
        logServerError("outreach-email-link", err, { kind: "action" });
        return { ok: false, error: "The email didn't go out — give them the site, jobflex.app, instead." };
      }
      await writeProspect({ ...p, email: p.email ?? email, linkSentAt: nowIso(), linkSentTo: email });
      return { ok: true, outcome: "done", output: { sent: true, to: email, say: "Tell them it's on its way to that address." } };
    }
    case "note_interest": {
      const level = args.level === "hot" || args.level === "warm" ? args.level : "cold";
      const note = String(args.note ?? "").trim().slice(0, 400);
      const callBack = String(args.call_back ?? "").trim().slice(0, 120) || null;
      await writeProspect({ ...p, interest: { level, note, callBack, at: nowIso() } });
      return { ok: true, outcome: "done", output: { noted: true } };
    }
    case "do_not_call": {
      await writeProspect({ ...p, dnc: { at: nowIso(), via: "call" } });
      return { ok: true, outcome: "done", output: { done: true, say: "Tell them they won't be called again, apologise for the interruption, say goodbye and call end_call." } };
    }
    default:
      return { ok: false, error: `unknown tool ${name}` };
  }
}

/** The AI's part is over: the transcript and how it went, on the contractor's record. */
export async function finishOutreachCall(t: CallToken, input: { outcome: string; transcript: Array<{ role: string; text: string }>; seconds: number; error: string | null }): Promise<void> {
  const id = t.ref ?? "";
  await updateProspect(id, (p) => {
    const c = lastCall(p);
    if (!c) return p;
    const text = input.transcript.map((l) => `${l.role === "desk" ? "JobFlex" : "Contractor"}: ${l.text}`).join("\n").slice(0, 20_000);
    const spoke = input.transcript.some((l) => l.role === "caller");
    const outcome: Outcome = p.dnc
      ? "do-not-call"
      : p.linkSentAt && (!c.at || p.linkSentAt >= c.at)
        ? "link-sent"
        : p.interest && p.interest.at >= c.at
          ? p.interest.level === "cold"
            ? /someone else|receptionist|not (in|here|available)|left a message/i.test(p.interest.note)
              ? "gatekeeper"
              : "not-interested"
            : p.interest.callBack
              ? "call-back"
              : "interested"
          : input.outcome === "failed"
            ? "failed"
            : spoke
              ? "not-interested"
              : "no-answer";
    const status: CallStatus = input.outcome === "failed" ? "failed" : "done";
    return withLastCall(p, { status, seconds: Math.max(c.seconds, Math.round(input.seconds)), outcome, transcript: text || null, summary: input.outcome === "transfer" ? "transfer" : (p.interest?.note ?? null), error: input.error });
  });
  // The text with the trial link — not to one who just asked never to hear from us (do_not_call marked them).
  if (input.transcript.some((l) => l.role === "caller")) await textAfterCall(id, true).catch((err) => logServerError("outreach-text", err, { kind: "action" }));
}

/* ── The email, and the call-me page it links to ─────────────────────── */

function secret(): string | null {
  return process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? null;
}
const sign = (id: string) => {
  const s = secret();
  return s ? createHmac("sha256", s).update(`outreach-callme:${id}`).digest("base64url").slice(0, 22) : null;
};
/** The token in a contractor's call-me link: their record, signed. */
export function callMeToken(id: string): string | null {
  const s = sign(id);
  return s ? `${id}.${s}` : null;
}
export function readCallMeToken(token: string | null | undefined): string | null {
  const [id, sig] = String(token ?? "").split(".");
  const want = id ? sign(id) : null;
  if (!want || !sig || sig.length !== want.length) return null;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? id : null;
  } catch {
    return null;
  }
}

/** The one email, to `n` contractors the AI may not call and who were not written to yet (at most EMAILS_PER_DAY a day). */
export async function emailProspects(n: number, base: string, admin: { name: string | null; email: string }): Promise<{ sent: number; skipped: number; error: string | null }> {
  const addr = postal();
  if (!addr) return { sent: 0, skipped: 0, error: "Set JOBFLEX_POSTAL_ADDRESS first — the email law asks for a postal address in every email like this." };
  if (!isEmailEnabled()) return { sent: 0, skipped: 0, error: "Email isn't set up on this server." };
  const list = await listProspects();
  const today = new Date().toISOString().slice(0, 10);
  const sentToday = list.filter((p) => p.emailedAt?.startsWith(today)).length;
  const room = Math.max(0, EMAILS_PER_DAY - sentToday);
  if (!room) return { sent: 0, skipped: 0, error: `${EMAILS_PER_DAY} emails went out today already — the rest go tomorrow.` };
  // Everyone with an address who wasn't written to — a landline too, before its call (lib/outreach/rules emailDue).
  const todo = list.filter(emailDue).slice(0, Math.min(room, Math.max(1, n)));
  // From "JobFlex Team <app@jobflex.app>" — never an admin's own name; replies still reach the admin (reply-to).
  const sender = OUTREACH_SENDER;
  let sent = 0;
  let skipped = 0;
  let error: string | null = null;
  for (const p of todo) {
    if (await readOptOut(optOutId(p.id))) {
      skipped++;
      continue;
    }
    const token = callMeToken(p.id);
    if (!token) return { sent, skipped, error: "The server has no signing secret (NEXTAUTH_SECRET)." };
    const unsub = unsubscribeUrl(base, optOutId(p.id), p.email);
    const letter = outreachLetter({ p, callMeUrl: `${base}/call-me/${token}`, siteUrl: `${base}/?utm_source=jobflex-email&utm_medium=outreach`, unsubscribeUrl: unsub, postal: addr });
    try {
      // Replies reach the admin and the platform mailbox, where a "stop" is read (lib/supportMail, 2026-11-11).
      const box = platformMailbox();
      const replyTo = box && box !== admin.email.toLowerCase() ? `${admin.email}, ${box}` : admin.email;
      const left = await sendEmail({ mailClass: "marketing", to: p.email!, subject: letter.subject, html: letter.html, text: letter.text, from: fromLine(sender), replyTo, headers: unsubscribeHeaders(unsub) });
      // On the do-not-email list (lib/mailBlock): not sent, and never called either.
      if (left.skipped && left.id.startsWith("mail-block")) {
        await writeProspect({ ...p, dnc: p.dnc ?? { at: nowIso(), via: "email" } });
        skipped++;
        continue;
      }
      await writeProspect({ ...p, emailedAt: nowIso() });
      sent++;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      break;
    }
  }
  return { sent, skipped, error };
}

/** "Have the AI desk call me", from the email's page or the open one: their consent kept, and the call placed now. */
export async function requestCallMe(
  input: { token: string | null; name: string; business: string; phone: string; email: string | null; trade: string | null; state: string | null; consent: boolean; ip: string | null; ua: string | null },
  base: string,
): Promise<{ ok: true; calling: boolean; note: string } | { ok: false; error: string }> {
  if (!input.consent) return { ok: false, error: "Tick the box so we may call you." };
  const phone = toE164(input.phone);
  if (!phone || !isUsCanadaNumber(phone)) return { ok: false, error: "That phone number doesn't look right — a US or Canadian number, with its area code." };
  const fromToken = readCallMeToken(input.token);
  const list = fromToken ? [] : await listProspects();
  const had = fromToken ? await readProspect(fromToken) : (list.find((p) => p.phone === phone) ?? null);
  const at = nowIso();
  const consent = { text: OUTREACH_CONSENT_TEXT, at, ip: input.ip?.slice(0, 64) ?? null, ua: input.ua?.slice(0, 200) ?? null, page: fromToken ? `call-me:${fromToken}` : "call-me" };
  const base0 = had ?? blank({}, "call-me");
  const p: Prospect = {
    ...base0,
    name: input.name.trim().slice(0, 120) || base0.name,
    business: input.business.trim().slice(0, 120) || base0.business,
    phone,
    email: input.email?.trim().toLowerCase().slice(0, 160) || base0.email,
    trade: tradeKey(input.trade) ?? base0.trade,
    state: stateCode(input.state) ?? base0.state,
    consent,
    // Asking for the call now is the newest word: an earlier "don't call" gives way to it. (The calls before it stay
    // on the record; the rules count only the ones since this consent.)
    dnc: null,
  };
  await writeProspect(p);
  const r = await callProspect(p.id, base);
  if (r.ok) return { ok: true, calling: true, note: "Calling you now — pick up in about half a minute." };
  // Nothing calls again by itself: say so. The admin's test call shows Twilio's reason; a contractor gets plain words.
  return { ok: true, calling: false, note: input.ua?.startsWith("admin test") ? `The call didn't go out: ${r.error}` : "We have your request, but the call couldn't go out just now — please try again in a few minutes." };
}

/** A test call to the admin's own phone: the admin's own consent, the script as a contractor hears it. */
export async function testCallToAdmin(input: { phone: string; name: string; business: string; trade: string | null; adminEmail: string }, base: string) {
  return requestCallMe({ token: null, name: input.name, business: input.business, phone: input.phone, email: input.adminEmail, trade: input.trade, state: null, consent: true, ip: null, ua: `admin test by ${input.adminEmail}` }, base);
}
