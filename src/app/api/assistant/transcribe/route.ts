// TALKING TO THE ASSISTANT — what was said, written down, where the browser cannot
// (2026-11-04). Chrome, Edge and Safari hear speech themselves (the Web Speech
// API); Firefox and some in-app browsers do not. There the Assistant's Talk mode
// records a few seconds and posts them here; Whisper writes them down, biased
// toward a contractor's words, as Deck Studio's route does
// (api/deck/voice/transcribe). A route handler, not a server action, because the
// audio is a file upload. It carries its own auth — the middleware does not match /api.
//
// 2026-11-07: an iPhone talks to the Operator through here on every turn now (Safari's own recogniser went deaf after
// the first reply — components/v3/deck-voice/use-deck-speech). So it writes down with gpt-4o-mini-transcribe — quicker
// and closer on accents and street addresses — and falls back to Whisper when that model is not there; and the lines
// these models make up out of a quiet room ("Thank you.", "Thanks for watching!") are not sent on as requests.
import { NextResponse } from "next/server";
import { toFile } from "openai";
import { actorForSession, refusal } from "@/lib/assistant/actor";
import { getOpenAI, isOpenAIEnabled } from "@/lib/sdk/openai";
import { rateLimitShared, HOUR } from "@/lib/rateLimit";
import { takeTrialCap } from "@/lib/trialMeter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A sentence or two of speech is far below this; anything larger is not a request. */
const MAX_BYTES = 2 * 1024 * 1024;
/** The model that writes it down, and the one used when that one is not there for this key. */
const MODEL = "gpt-4o-mini-transcribe";
const FALLBACK_MODEL = "whisper-1";
/** What a speech model says to a room with nobody talking in it — never a request. ("Okay" and "bye" are left
 *  alone: one says yes to a read-back, the other ends a live conversation.) */
const MADE_UP = /^(thank you( (so much|very much))?|thanks( for watching)?|thank you for watching|you|hmm+|uh+|um+|please subscribe|subtitles by .*|\.+|♪+)[.!?\s]*$/i;
/** Biases the decoder toward the words it will hear. Not a transcript — Whisper takes it as style. */
const PROMPT = "JobFlex words: proposal, estimate, schedule, crew, invoice, payment reminder, roof, fence, deck, HVAC, gutters, tomorrow, Thursday, send it, yes, no.";

export async function POST(req: Request) {
  let organizationId: string;
  try {
    const actor = await actorForSession();
    const closed = await refusal(actor, "today", false);
    if (closed) return NextResponse.json({ error: closed }, { status: 403 });
    organizationId = actor.organizationId;
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 403 });
  }
  if (!isOpenAIEnabled()) return NextResponse.json({ error: "Speech needs the AI set up on this server." }, { status: 503 });
  const limit = await rateLimitShared(`assistant-hear:${organizationId}`, 200, HOUR);
  if (!limit.ok) return NextResponse.json({ error: "Too much talking for one hour — type it instead." }, { status: 429 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected the recording." }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: "Nothing was recorded." }, { status: 400 });
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: "That recording is too long — say one thing at a time." }, { status: 413 });
  // The language they speak to it in (2026-11-06; the page sends the setting's first two letters): Whisper is told,
  // and the English word list is left out for any other, where it would only mislead it.
  const said = form.get("language");
  const language = typeof said === "string" && /^[a-z]{2}$/.test(said) ? said : "en";
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return NextResponse.json({ error: "The trial's AI allowance is used up — type it instead." }, { status: 402 });
  try {
    const type = audio.type || "audio/webm";
    const ext = /ogg/.test(type) ? "ogg" : /mp4|m4a|aac/.test(type) ? "m4a" : /wav/.test(type) ? "wav" : "webm";
    const file = await toFile(Buffer.from(await audio.arrayBuffer()), `voice.${ext}`, { type });
    const ask = (model: string) => getOpenAI().audio.transcriptions.create({ file, model, language, ...(language === "en" ? { prompt: PROMPT } : {}) });
    const t0 = Date.now();
    let model = MODEL;
    let res;
    try {
      res = await ask(model);
    } catch (err) {
      // The newer model refused (not on this key, or the file): Whisper writes it down instead.
      const status = (err as { status?: unknown })?.status;
      if (status !== 400 && status !== 403 && status !== 404) throw err;
      model = FALLBACK_MODEL;
      res = await ask(model);
    }
    const text = (res.text ?? "").trim();
    console.info(`[assistant] heard ${audio.size} bytes in ${Date.now() - t0} ms · ${model} · ${text ? `${text.length} chars` : "nothing"}`);
    // On silence Whisper says its prompt back: six words in a row of it is the prompt, not speech.
    const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9/\s]/g, " ").split(/\s+/).filter(Boolean);
    const p = words(PROMPT).join(" ");
    const w = words(text);
    const echo = language === "en" && w.length >= 6 && w.some((_, i) => i + 6 <= w.length && p.includes(w.slice(i, i + 6).join(" ")));
    if (!text || echo || MADE_UP.test(text)) return NextResponse.json({ text: "" });
    return NextResponse.json({ text: text.slice(0, 600) });
  } catch (err) {
    if (typeof (err as { status?: unknown })?.status === "number") await trial.refund();
    return NextResponse.json({ error: "Couldn't write that down — try again, or type it." }, { status: 502 });
  }
}
