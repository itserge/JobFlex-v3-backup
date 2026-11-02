"use server";
// THE AI DESK — Settings → AI desk (2026-10-13). Managers only.
//
//   presetDeskProfile   the kind of business ("roofing, gutters") → everything callers ask that trade, from the
//                       company's details, with the sensitive parts marked to check (lib/aiDesk/tradePresets);
//                       a business no preset knows is written by the model in the same shape
//   composeDeskProfile  what the owner typed or said → the desk's profile, the questions
//                       it still has, and three sample answers (lib/aiDesk/profile)
//   saveDeskProfile     the profile as edited on the page
//   setDeskMode         who answers: the desk, or the company phone first
//   askDesk             "try it" — what the desk would say to a caller's question
//   setDeskVoice        the voice the live desk speaks with; previewDeskVoice says the greeting in it
//   startDeskTest       "test it here": a one-session key for the browser to call the desk over
//                       WebRTC (lib/aiDesk/testCall); deskTestTool runs its tools — open times for
//                       real, booking/messages/transfers only in words; endDeskTest counts the minutes
import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/orgContext";
import { appBaseUrl } from "@/lib/appUrl";
import { IntegrationDisabledError } from "@/lib/sdk/base";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { friendlyAIError, getOpenAI, isOpenAIEnabled, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { notePaidCall } from "@/lib/trialMeter";
import { readDeskSettings, saveDeskSettings } from "@/lib/aiDesk/numbers";
import { db } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { cleanLeadCalls, clock, DESK_FORWARDING, DESK_MODES, DESK_PACK, dollars, minutesLeftWords, minutesOf, validTimezone, VOICES, type DeskBalance, type DeskForwarding, type DeskLeadCalls, type DeskMode, type DeskPackRecord, type DeskVoice } from "@/lib/aiDesk/shared";
import { leadCallReadiness } from "@/lib/aiDesk/leadCalls";
import { deskBalanceFor, readDeskPacks, setAutoTopUp, settleDeskUse } from "@/lib/aiDesk/minutes";
import { chargePackOnFile, finishPackCheckout, startPackPurchase, type PackStep } from "@/lib/aiDesk/packs";
import { ASK_FORMAT, cleanCompose, cleanProfile, COMPOSE_SYSTEM, composePrompt, deskInstructions, EMPTY_PROFILE, gapQuestions, profileFromFacts, withFinancingAnswer, type DeskFaq, type DeskProfile } from "@/lib/aiDesk/profile";
import { deskFinancingAnswer } from "@/lib/financing/desk";
import { companyFacts } from "@/lib/aiDesk/facts";
import { currentForwardCheck, deskNumberFor, noteForwardCheck, startForwardTest } from "@/lib/aiDesk/forwardTest";
import type { ForwardCheck } from "@/lib/aiDesk/forwardCheck";
import { cleanPack, matchBusiness, PACK_SYSTEM, packPrompt, presetProfile, pruneReview, reviewAfterCompose, type DeskReviewItem, type TradePack } from "@/lib/aiDesk/tradePresets";
import { openTimes } from "@/lib/aiDesk/liveCall";
import { DEFAULT_VOICE_MODEL, realtimeCallsUrl, TEST_NOTE, TEST_TOOL_NAMES, testSession, timeIdWords, type RealtimeApi } from "@/lib/aiDesk/testCall";
import { noteDeskUse } from "@/lib/aiDesk/usage";

const SETTINGS_PATH = "/dashboard/settings";

export type DeskActionResult<T = object> = ({ ok: true; note?: string } & T) | { ok: false; error: string };

/** The model's reply as an object: plain JSON, or the first {...} in a chatty one. */
function replyObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(text.slice(a, b + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}

async function askJson(system: string, user: string, temperature: number): Promise<unknown> {
  const client = getOpenAI();
  const model = await resolveOpenAIModel();
  const completion = await client.chat.completions.create({
    model,
    ...(await samplingOptions(temperature)),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });
  return replyObject(completion.choices[0]?.message?.content ?? "{}");
}

const uniq = (xs: string[]) => Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));

/**
 * The owner's words about the company → the desk's profile. With nothing said, the
 * profile is the facts on file (no model call) and the questions are what is missing.
 */
export async function composeDeskProfile(briefRaw: string): Promise<DeskActionResult<{ profile: DeskProfile; questions: string[]; samples: DeskFaq[]; review: DeskReviewItem[] }>> {
  const { organizationId, user } = await requireManager();
  const brief = (briefRaw ?? "").replace(/\r/g, "").trim().slice(0, 4000);
  const facts = await companyFacts(organizationId);
  if (!facts) return { ok: false, error: "Not found." };
  const current = await readDeskSettings(organizationId);
  // The preset (or the instructions as last saved) is where the owner's words start — not a blank page.
  const base = current.profile ?? profileFromFacts(facts);
  let profile = base;
  let questions: string[] = [];
  let samples: DeskFaq[] = [];
  if (brief) {
    if (!isOpenAIEnabled()) return { ok: false, error: "Writing the desk's instructions needs the AI service, which is not set up on this workspace." };
    try {
      await enforceRateLimit(`aidesk-compose:${organizationId}`, 30, HOUR, "desk rewrites");
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Too many rewrites." };
    }
    try {
      const composed = cleanCompose(await askJson(COMPOSE_SYSTEM, composePrompt(brief, facts, current.profile ?? undefined), 0.3), base);
      profile = composed.profile;
      questions = composed.questions;
      samples = composed.samples;
    } catch (err) {
      return { ok: false, error: friendlyAIError(err, "writing the desk's instructions") };
    }
  }
  // What the model changed in a sensitive part is marked for the owner, like the preset's own marks.
  const review = brief ? reviewAfterCompose(base, profile, current.review) : pruneReview(current.review, profile);
  questions = uniq([...questions, ...gapQuestions(profile, new Set(review.map((r) => r.key)))]).slice(0, 6);
  await saveDeskSettings(organizationId, { ...current, brief, profile, review, profileUpdatedAt: new Date().toISOString(), questions });
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: brief ? "Wrote the AI desk's instructions from the company description" : "Started the AI desk's instructions from what JobFlex has on file" });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, profile, questions, samples, review, note: questions.length ? `Written. The desk still has ${questions.length} question${questions.length === 1 ? "" : "s"} for you below.` : "Written — the desk has what it needs." };
}

/**
 * The kind of business → the desk's profile, preset for the trade with the company's details, and the parts the
 * owner should check. Words no preset knows ("pool resurfacing") are written by the model in the same shape; without
 * the AI service they still get the company's details and the generic parts.
 */
export async function presetDeskProfile(businessRaw: string): Promise<DeskActionResult<{ profile: DeskProfile; review: DeskReviewItem[]; questions: string[]; business: string; trades: string[] }>> {
  const { organizationId, user } = await requireManager();
  const business = (businessRaw ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (business.length < 2) return { ok: false, error: "Type what kind of business you are — roofing, remodeling, tile…" };
  const facts = await companyFacts(organizationId);
  if (!facts) return { ok: false, error: "Not found." };
  const { packs, unknown } = matchBusiness(business);
  const written: TradePack[] = [];
  const typed: string[] = [];
  if (unknown.length && isOpenAIEnabled()) {
    try {
      await enforceRateLimit(`aidesk-preset:${organizationId}`, 30, HOUR, "desk presets");
      const made = await Promise.all(unknown.slice(0, 3).map((u) => askJson(PACK_SYSTEM, packPrompt(u, facts), 0.3).then((raw) => cleanPack(raw, u)).catch(() => null)));
      unknown.slice(0, 3).forEach((u, i) => (made[i] ? written.push(made[i]!) : typed.push(u)));
    } catch {
      typed.push(...unknown);
    }
  } else typed.push(...unknown);
  const preset = presetProfile([...packs, ...written], facts, typed);
  const { review, trades } = preset;
  const current = await readDeskSettings(organizationId);
  // A new preset never throws away what the owner described: the write-up stays.
  const profile = { ...preset.profile, knowledge: current.profile?.knowledge ?? "" };
  const questions = gapQuestions(profile, new Set(review.map((r) => r.key)));
  await saveDeskSettings(organizationId, { ...current, business, profile, review, questions, profileUpdatedAt: new Date().toISOString() });
  const named = trades.length ? trades.join(", ") : business;
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Preset the AI desk for ${named}` });
  revalidatePath(SETTINGS_PATH);
  const missed = typed.length ? ` No preset for ${typed.join(", ")} yet — check the services.` : "";
  return { ok: true, profile, review, questions, business, trades, note: `Preset for ${named.toLowerCase()}. ${review.length} part${review.length === 1 ? "" : "s"} to check — highlighted below.${missed}` };
}

/**
 * The profile as edited on the page. `stillToCheck` = the marked parts the owner has not looked at yet (their keys);
 * the page can only clear marks, never add one. Left out, the marks stay as they were.
 */
export async function saveDeskProfile(raw: unknown, stillToCheck?: unknown): Promise<DeskActionResult<{ questions: string[]; review: DeskReviewItem[] }>> {
  const { organizationId, user } = await requireManager();
  const current = await readDeskSettings(organizationId);
  const profile = cleanProfile(raw, current.profile ?? EMPTY_PROFILE);
  if (!profile.greeting.trim()) return { ok: false, error: "The desk needs a greeting." };
  const keep = Array.isArray(stillToCheck) ? new Set(stillToCheck.filter((k): k is string => typeof k === "string")) : null;
  const review = pruneReview(keep ? current.review.filter((r) => keep.has(r.key)) : current.review, profile);
  const questions = gapQuestions(profile, new Set(review.map((r) => r.key)));
  await saveDeskSettings(organizationId, { ...current, profile, review, profileUpdatedAt: new Date().toISOString(), questions });
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: review.length ? `Edited the AI desk's instructions (${review.length} still to check)` : "Checked and saved the AI desk's instructions" });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, questions, review, note: review.length ? `Saved. ${review.length} part${review.length === 1 ? "" : "s"} still to check.` : "Saved — everything checked." };
}

/** Who answers: the desk every call, or the company phone first. */
export async function setDeskMode(mode: DeskMode): Promise<DeskActionResult> {
  const { organizationId, user } = await requireManager();
  if (!(DESK_MODES as readonly string[]).includes(mode)) return { ok: false, error: "Unknown setting." };
  const current = await readDeskSettings(organizationId);
  await saveDeskSettings(organizationId, { ...current, mode });
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: mode === "ANSWER" ? "The AI desk answers every call" : "Calls ring the company phone first; the AI desk takes what is missed" });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, note: mode === "ANSWER" ? "The desk answers every call." : "Your phone rings first. The desk takes the calls nobody picks up." };
}

/** "Try it": what the desk would say to this question, from its instructions as saved. */
export async function askDesk(questionRaw: string): Promise<DeskActionResult<{ answer: string }>> {
  const { organizationId } = await requireManager();
  const question = (questionRaw ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (question.length < 2) return { ok: false, error: "Ask something a caller would." };
  if (!isOpenAIEnabled()) return { ok: false, error: "Trying the desk needs the AI service, which is not set up on this workspace." };
  try {
    await enforceRateLimit(`aidesk-ask:${organizationId}`, 60, HOUR, "desk questions");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many questions." };
  }
  const [facts, settings] = await Promise.all([companyFacts(organizationId), readDeskSettings(organizationId)]);
  if (!facts) return { ok: false, error: "Not found." };
  // An approved Wisetack company says yes to financing (lib/financing/desk).
  const profile = withFinancingAnswer(settings.profile ?? profileFromFacts(facts), await deskFinancingAnswer(organizationId));
  try {
    const o = await askJson(`${deskInstructions(profile, facts, settings.mode, settings.forwarding)}\n\n${ASK_FORMAT}`, `A caller says: «${question}»`, 0.4);
    const answer = o && typeof o === "object" && typeof (o as { answer?: unknown }).answer === "string" ? (o as { answer: string }).answer.trim().slice(0, 500) : "";
    if (!answer) return { ok: false, error: "The desk gave no answer — try again." };
    return { ok: true, answer };
  } catch (err) {
    return { ok: false, error: friendlyAIError(err, "asking the desk") };
  }
}

/* ── the voice ─────────────────────────────────────────────────────────────── */

export async function setDeskVoice(voice: DeskVoice): Promise<DeskActionResult> {
  const { organizationId, user } = await requireManager();
  if (!(VOICES as readonly string[]).includes(voice)) return { ok: false, error: "Unknown voice." };
  const current = await readDeskSettings(organizationId);
  await saveDeskSettings(organizationId, { ...current, voice });
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `The AI desk speaks with the ${voice} voice` });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, note: `The desk speaks with ${voice}.` };
}

/** The greeting said in a voice — an MP3 (base64) for the page to play. */
export async function previewDeskVoice(voice: DeskVoice): Promise<DeskActionResult<{ mp3: string }>> {
  const { organizationId } = await requireManager();
  if (!(VOICES as readonly string[]).includes(voice)) return { ok: false, error: "Unknown voice." };
  if (!isOpenAIEnabled()) return { ok: false, error: "Hearing the voices needs the AI service, which is not set up on this workspace." };
  try {
    await enforceRateLimit(`aidesk-hear:${organizationId}`, 40, HOUR, "voice previews");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many previews." };
  }
  const [facts, settings] = await Promise.all([companyFacts(organizationId), readDeskSettings(organizationId)]);
  if (!facts) return { ok: false, error: "Not found." };
  const greeting = (settings.profile ?? profileFromFacts(facts)).greeting.trim().slice(0, 300) || `Thanks for calling ${facts.name}. How can I help?`;
  try {
    const res = await getOpenAI().audio.speech.create({ model: "gpt-4o-mini-tts", voice, input: greeting, response_format: "mp3", instructions: "A friendly, unhurried receptionist answering the company phone." });
    const mp3 = Buffer.from(await res.arrayBuffer()).toString("base64");
    if (!mp3) return { ok: false, error: "No audio came back — try again." };
    void notePaidCall("openai", "tts-preview", { orgId: organizationId }).catch(() => null);
    return { ok: true, mp3 };
  } catch (err) {
    return { ok: false, error: friendlyAIError(err, "playing the voice") };
  }
}

/* ── test it here ───────────────────────────────────────────────────────────── */

export type DeskTestStart = { key: string; expiresAt: number; callsUrl: string; model: string; maxSeconds: number };

const openAIBase = () => (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
const realtimeApi = (): RealtimeApi => (process.env.REALTIME_API === "beta" ? "beta" : "ga");
/** The same variable the voice server reads on Fly — set it in both places to change the model. */
const voiceModel = () => process.env.VOICE_MODEL?.trim() || DEFAULT_VOICE_MODEL;

/** A one-session key for the browser to call the desk over WebRTC, with the desk's instructions and voice on it. */
export async function startDeskTest(): Promise<DeskActionResult<DeskTestStart>> {
  const { organizationId, user } = await requireManager();
  if (!isOpenAIEnabled()) return { ok: false, error: "Testing the desk needs the AI service, which is not set up on this workspace." };
  try {
    await enforceRateLimit(`aidesk-test:${organizationId}`, 20, HOUR, "test calls");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many test calls." };
  }
  const [facts, settings, balance] = await Promise.all([companyFacts(organizationId), readDeskSettings(organizationId), deskBalanceFor(organizationId)]);
  if (!facts) return { ok: false, error: "Not found." };
  // A test costs minutes like a call: none left, no test.
  if (balance.out) return { ok: false, error: `The desk is out of minutes — add ${DESK_PACK.minutes} minutes below, then test it.` };
  // An approved Wisetack company says yes to financing (lib/financing/desk).
  const profile = withFinancingAnswer(settings.profile ?? profileFromFacts(facts), await deskFinancingAnswer(organizationId));
  const nowWords = new Date().toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: facts.timezone });
  const instructions = [deskInstructions(profile, facts, settings.mode, settings.forwarding), "", `THIS CALL: it is ${nowWords} (${facts.timezone}). ${TEST_NOTE}`, "Offer only times that open_times returns, and book only with book_visit."].join("\n");
  const api = realtimeApi();
  const model = voiceModel();
  const session = testSession({ instructions, voice: settings.voice, model, api });
  const url = `${openAIBase()}/realtime/${api === "beta" ? "sessions" : "client_secrets"}`;
  const body = api === "beta" ? session : { expires_after: { anchor: "created_at", seconds: 600 }, session };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json", "OpenAI-Safety-Identifier": createHash("sha256").update(organizationId).digest("hex").slice(0, 40) },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("[aiDesk] test key refused", res.status, (await res.text()).slice(0, 300));
      return { ok: false, error: "The call could not be set up right now. Try again in a minute." };
    }
    const j = (await res.json()) as { value?: string; expires_at?: number; client_secret?: { value?: string; expires_at?: number } };
    const key = j.value ?? j.client_secret?.value;
    if (!key) return { ok: false, error: "The call could not be set up right now." };
    await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: "Called the AI desk from the browser to test it" });
    return { ok: true, key, expiresAt: j.expires_at ?? j.client_secret?.expires_at ?? 0, callsUrl: realtimeCallsUrl(api, model), model, maxSeconds: Math.max(60, Math.min(300, balance.remainingSeconds)) };
  } catch (err) {
    return { ok: false, error: friendlyAIError(err, "setting up the test call") };
  }
}

/** What goes back to the model, and the line the panel shows for it. */
export type DeskTestToolResult = { output: unknown; line: string | null };

/** A tool the desk called on a test: the calendar's real open times; everything else only in words. */
export async function deskTestTool(name: string, args: Record<string, unknown>): Promise<DeskActionResult<DeskTestToolResult>> {
  const { organizationId } = await requireManager();
  const a = args && typeof args === "object" ? args : {};
  const str = (k: string, max = 200) => (typeof a[k] === "string" ? (a[k] as string).trim().slice(0, max) : "");
  if (!(TEST_TOOL_NAMES as readonly string[]).includes(name)) return { ok: true, output: { error: `unknown tool ${name}` }, line: null };
  switch (name) {
    case "open_times": {
      const days = typeof a.days === "number" && Number.isFinite(a.days) ? a.days : 7;
      const r = await openTimes(organizationId, str("service") || null, days);
      return { ok: true, output: r.ok ? { times: r.times, note: r.note } : { error: r.error }, line: r.ok ? `The desk looked up open times — ${r.times.length} to offer.` : `The desk looked up open times — ${r.error}` };
    }
    case "book_visit": {
      const facts = await companyFacts(organizationId);
      const when = timeIdWords(str("time_id", 120), facts?.timezone ?? "America/New_York");
      if (!when) return { ok: true, output: { error: "Pick one of the open times first." }, line: null };
      const who = str("name", 80) || "the caller";
      return { ok: true, output: { booked: true, when, test: "This is a test call: nothing was saved. Confirm the visit to the caller as you would." }, line: `The desk would book ${who} for ${when} — a test, nothing saved.` };
    }
    case "take_message": {
      const who = str("name", 80) || "the caller";
      const about = str("about", 200);
      return { ok: true, output: { taken: true, test: "This is a test call: nothing was saved." }, line: `The desk would take a message from ${who}${about ? `: ${about}` : ""} — a test, nothing saved.` };
    }
    case "transfer_call":
      return { ok: true, output: { transferring: true, say: "Tell the caller you are putting them through now, briefly.", test: "This is a test call: no phone rings." }, line: "The desk would ring your phone now — a test, nothing rang." };
    default:
      return { ok: true, output: { ending: true, say: "Say goodbye briefly." }, line: null };
  }
}

/** The test is over: its seconds join the month's minutes. */
export async function endDeskTest(secondsRaw: number): Promise<DeskActionResult<{ minutes: number }>> {
  const { organizationId } = await requireManager();
  const seconds = Math.max(0, Math.min(3600, Math.round(Number(secondsRaw) || 0)));
  const use = await noteDeskUse(organizationId, { testSeconds: seconds, tests: 1 });
  const balance = await settleDeskUse(organizationId);
  void notePaidCall("openai", "realtime-minute", { units: Math.max(1, Math.ceil(seconds / 60)), orgId: organizationId }).catch(() => null);
  revalidatePath(SETTINGS_PATH);
  return { ok: true, minutes: minutesOf(use.callSeconds + use.testSeconds), note: `Test call · ${clock(seconds)} — counted in this month's minutes${balance ? ` · ${minutesLeftWords(balance).toLowerCase()}` : ""}.` };
}

/* ── the numbers, the forwarding, the clock, the calendar (the setup's steps 1 and 3) ── */

/** How the company's own phone reaches the desk — set at the carrier; the desk only needs to know. */
export async function setDeskForwarding(forwarding: DeskForwarding): Promise<DeskActionResult> {
  const { organizationId, user } = await requireManager();
  if (!(DESK_FORWARDING as readonly string[]).includes(forwarding)) return { ok: false, error: "Unknown setting." };
  const current = await readDeskSettings(organizationId);
  // A phone that forwards every call cannot ring first: it would forward straight back to the desk.
  const mode: DeskMode = forwarding === "all" ? "ANSWER" : current.mode;
  await saveDeskSettings(organizationId, { ...current, forwarding, mode });
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: forwarding === "none" ? "The company phone does not forward to the AI desk" : forwarding === "all" ? "The company phone forwards every call to the AI desk" : "The company phone forwards missed calls to the AI desk" });
  revalidatePath(SETTINGS_PATH);
  revalidatePath("/dashboard/phone");
  return { ok: true, note: forwarding === "all" ? "Noted: the desk takes messages instead of transferring, since a transfer would ring itself." : "Saved." };
}

/* ── does the business phone really forward? (2026-10-14) ───────────────────── */

/**
 * The forwarding test: JobFlex calls the business phone from the desk's number. Forwarding on, the call comes straight
 * back to the desk and the check says it works; forwarding off, the phone rings (lib/aiDesk/forwardTest). The page
 * then polls readDeskForwarding.
 */
export async function testDeskForwarding(): Promise<DeskActionResult<{ check: ForwardCheck }>> {
  const { organizationId, user } = await requireManager();
  try {
    await enforceRateLimit(`aidesk-fwdtest:${organizationId}`, 8, HOUR, "forwarding tests");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many tests — try again later." };
  }
  const base = (process.env.TWILIO_APP_URL ?? (await appBaseUrl())).replace(/\/$/, "");
  const r = await startForwardTest(organizationId, base);
  if (!r.ok) return r;
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: "Tested the AI desk's call forwarding" });
  return { ok: true, check: r.check };
}

/** Where the forwarding check stands (the page polls it while the test call runs). */
export async function readDeskForwarding(): Promise<{ check: ForwardCheck | null }> {
  const { organizationId } = await requireManager();
  return { check: await currentForwardCheck(organizationId) };
}

/** The owner checked it themselves: they called the business phone and the desk answered — or their phone rang. */
export async function confirmDeskForwarding(works: boolean): Promise<DeskActionResult<{ check: ForwardCheck }>> {
  const { organizationId, user } = await requireManager();
  const [desk, org, deskNumber] = await Promise.all([readDeskSettings(organizationId), db.organization.findUnique({ where: { id: organizationId }, select: { phone: true } }), deskNumberFor(organizationId)]);
  const phone = toE164(org?.phone ?? "");
  if (desk.forwarding === "none" || !phone || !deskNumber) return { ok: false, error: "Pick how your number forwards, and add your business phone, first." };
  const check = await noteForwardCheck(organizationId, desk.forwarding, phone, deskNumber, works ? "works" : "rang", "manual");
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: works ? "Confirmed the business phone forwards to the AI desk" : "Noted the business phone does not forward to the AI desk yet" });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, check, note: works ? "Noted — forwarding works." : "Noted — dial your carrier's code, then test again." };
}

/** The number customers call the company on — the one the desk rings or hands calls to (Organization.phone). */
export async function setBusinessPhone(raw: string): Promise<DeskActionResult<{ phone: string | null }>> {
  const { organizationId, user } = await requireManager();
  const typed = (raw ?? "").trim().slice(0, 40);
  if (typed && !toE164(typed)) return { ok: false, error: "That is not a phone number — digits with the area code, like (425) 555-0100." };
  await db.organization.update({ where: { id: organizationId }, data: { phone: typed || null } });
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: typed ? `The company phone for the AI desk is ${typed}` : "The company phone was removed from the AI desk" });
  revalidatePath(SETTINGS_PATH);
  revalidatePath("/dashboard/phone");
  return { ok: true, phone: typed || null, note: "Saved." };
}

/** The company's time zone — the clock the desk tells callers and books by. */
export async function setCompanyTimezone(tz: string): Promise<DeskActionResult<{ timezone: string }>> {
  const { organizationId, user } = await requireManager();
  const timezone = (tz ?? "").trim().slice(0, 80);
  if (!timezone || !validTimezone(timezone)) return { ok: false, error: "Pick a time zone from the list." };
  await db.organization.update({ where: { id: organizationId }, data: { timezone } });
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `The company's time zone is ${timezone}` });
  revalidatePath(SETTINGS_PATH);
  revalidatePath("/dashboard/calendar");
  return { ok: true, timezone, note: "Saved." };
}

/** The next open times the desk would offer a caller right now — the calendar's, in the company's zone. */
export async function previewDeskTimes(): Promise<DeskActionResult<{ enabled: boolean; times: Array<{ id: string; label: string }>; note: string | null }>> {
  const { organizationId } = await requireManager();
  const r = await openTimes(organizationId, null, 7);
  if (!r.ok) return { ok: true, enabled: !/does not book visits by phone/.test(r.error), times: [], note: r.error };
  return { ok: true, enabled: true, times: r.times.map((t) => ({ id: t.id, label: t.label })), note: r.note };
}

/* ── minutes and packs ───────────────────────────────────────────────────── */

const NO_BILLING = "Billing is not set up on this workspace, so packs can't be bought here.";
const PACK_FAILED = "The purchase could not go through. Try again in a minute.";

async function packBuyer() {
  const ctx = await requireManager();
  return { organizationId: ctx.organizationId, userId: ctx.user.id, email: ctx.user.email ?? null };
}

/** "Add 300 minutes": a card to confirm, or Stripe Checkout. */
export async function startDeskPack(): Promise<PackStep> {
  const buyer = await packBuyer();
  try {
    return await startPackPurchase(buyer, await appBaseUrl());
  } catch (err) {
    console.warn("[aiDesk] pack purchase could not start:", err);
    return { kind: "no-billing", reason: err instanceof IntegrationDisabledError ? NO_BILLING : PACK_FAILED };
  }
}

/** "Charge $29 to Visa •4242" confirmed. */
export async function chargeDeskPack(): Promise<PackStep> {
  const buyer = await packBuyer();
  try {
    const step = await chargePackOnFile(buyer, await appBaseUrl());
    if (step.kind === "added") {
      revalidatePath(SETTINGS_PATH);
      revalidatePath("/dashboard/phone");
    }
    return step;
  } catch (err) {
    console.warn("[aiDesk] pack charge failed:", err);
    return { kind: "no-billing", reason: err instanceof IntegrationDisabledError ? NO_BILLING : PACK_FAILED };
  }
}

/** Back from Stripe Checkout (`?pane=desk&pack_paid=1&session_id=…`). */
export async function finishDeskPackCheckout(sessionId: string): Promise<{ status: "added" | "pending" | "invalid" | "failed"; balance?: DeskBalance; history?: DeskPackRecord[] }> {
  const { organizationId } = await requireManager();
  try {
    const r = await finishPackCheckout(organizationId, String(sessionId ?? ""));
    if (r.status !== "added") return { status: r.status };
    revalidatePath(SETTINGS_PATH);
    revalidatePath("/dashboard/phone");
    const [balance, packs] = await Promise.all([deskBalanceFor(organizationId), readDeskPacks(organizationId)]);
    return { status: "added", balance, history: packs.history };
  } catch (err) {
    console.warn("[aiDesk] pack checkout return failed:", err);
    return { status: "failed" };
  }
}

/** When the desk runs out, buy a pack with the card on file without asking. */
export async function setDeskAutoTopUp(on: boolean): Promise<DeskActionResult<{ autoTopUp: boolean }>> {
  const { organizationId, user } = await requireManager();
  const packs = await setAutoTopUp(organizationId, on === true);
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: packs.autoTopUp ? `Auto top-up on: ${DESK_PACK.minutes} AI desk minutes (${dollars(DESK_PACK.cents)}) when the desk runs out` : "Auto top-up off for the AI desk" });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, autoTopUp: packs.autoTopUp, note: packs.autoTopUp ? "Auto top-up is on." : "Auto top-up is off." };
}

/**
 * "Call new leads" (owner, 2026-10-31; lib/aiDesk/leadCalls): on or off, and how long a new lead waits for a person
 * before the desk calls it. Turning it on asks the same things a call needs — a live desk with its number, the
 * business written, minutes — so it is never "on" for a desk that cannot dial.
 */
export async function setDeskLeadCalls(onRaw: boolean, afterMinutesRaw: number): Promise<DeskActionResult<{ leadCalls: DeskLeadCalls }>> {
  const { organizationId, user } = await requireManager();
  const leadCalls = cleanLeadCalls({ on: onRaw === true, afterMinutes: afterMinutesRaw });
  if (leadCalls.on) {
    const ready = await leadCallReadiness(organizationId);
    if (!ready.ok) return { ok: false, error: ready.why };
  }
  const current = await readDeskSettings(organizationId);
  await saveDeskSettings(organizationId, { ...current, leadCalls });
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: leadCalls.on ? `The AI desk calls new leads nobody reached within ${leadCalls.afterMinutes} minutes` : "The AI desk no longer calls new leads by itself" });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, leadCalls, note: leadCalls.on ? `On. A new lead nobody reached in ${leadCalls.afterMinutes} minutes gets one call from the desk.` : "Off. The desk calls a lead only when someone presses the button on its page." };
}
