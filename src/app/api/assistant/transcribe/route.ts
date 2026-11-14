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
//
// 2026-11-13 (owner: "understand me better … the best voice recognition and even accents"): on the new engine
// (lib/assistant/speed — platform admins while it is tested) the take is written down by gpt-transcribe, OpenAI's
// current model, and it is GIVEN the company's own words as keywords: the person's "my words", the crew, the newest
// clients, their streets and cities, the trade's brands. A refusal of the model or of the keywords falls back a
// step at a time to the models before, so a turn is never lost to the new one.
import { NextResponse } from "next/server";
import { toFile } from "openai";
import { actorForSession, refusal } from "@/lib/assistant/actor";
import { getOpenAI, isOpenAIEnabled } from "@/lib/sdk/openai";
import { rateLimitShared, HOUR } from "@/lib/rateLimit";
import { takeTrialCap } from "@/lib/trialMeter";
import { tidySpokenAddress } from "@/lib/assistant/address";
import { operatorEngine, operatorKeywords } from "@/lib/assistant/speed";
import { newEarsParams, NEW_EARS_MODEL } from "@/lib/assistant/words";

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
const WORDS = "JobFlex words: proposal, estimate, schedule, crew, invoice, payment reminder, roof, fence, deck, HVAC, gutters, tomorrow, Thursday, send it, yes, no.";
/** How addresses are written (2026-11-07: "12103 202nd Street Southeast" came back "12103 200 seconds. Creed
 *  Southeast"): house number, numbered streets as ordinals, short street types and directions, state and ZIP. Made-up
 *  addresses, so a real one said back is never mistaken for the prompt. */
const ADDRESS_STYLE = "Addresses are written like 4518 132nd Ave NE, Bellevue, WA 98005 and 1720 W 3rd St, Tulsa, OK 74127.";
const PROMPT = `${WORDS} ${ADDRESS_STYLE}`;
/** Letters that aren't the Latin alphabet — an English word written in another script ("Президеншиал руф"). */
const OTHER_SCRIPT = /[\u0400-\u04FF\u0590-\u06FF\u0900-\u0DFF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

export async function POST(req: Request) {
  let organizationId: string;
  let userId: string;
  try {
    const actor = await actorForSession();
    const closed = await refusal(actor, "today", false);
    if (closed) return NextResponse.json({ error: closed }, { status: 403 });
    organizationId = actor.organizationId;
    userId = actor.userId;
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
    /** The new ears: gpt-transcribe with the company's words (the installed SDK's types predate `keywords` and `languages`). */
    const askNew = (keywords: readonly string[]) =>
      getOpenAI().audio.transcriptions.create({ file, ...newEarsParams(language, language === "en" ? PROMPT : null, keywords) } as unknown as Parameters<ReturnType<typeof getOpenAI>["audio"]["transcriptions"]["create"]>[0]) as Promise<{ text?: string }>;
    const refused = (err: unknown) => {
      const status = (err as { status?: unknown })?.status;
      return status === 400 || status === 403 || status === 404;
    };
    const t0 = Date.now();
    const engine = await operatorEngine(organizationId, userId);
    const keywords = engine === "new" ? await operatorKeywords(organizationId, userId) : [];
    let model = MODEL;
    let res: { text?: string } | null = null;
    let given = 0;
    if (engine === "new") {
      // The new model with the words; refused, without them; refused again, the models before.
      try {
        res = await askNew(keywords);
        model = NEW_EARS_MODEL;
        given = keywords.length;
      } catch (err) {
        if (!refused(err)) throw err;
        console.warn(`[assistant] ${NEW_EARS_MODEL} refused the take${keywords.length ? ` with ${keywords.length} keywords` : ""} (${(err as { status?: unknown })?.status}): ${err instanceof Error ? err.message.slice(0, 200) : ""}`);
        if (keywords.length) {
          res = await askNew([]).catch((again) => {
            if (!refused(again)) throw again;
            return null;
          });
          if (res) model = NEW_EARS_MODEL;
        }
      }
    }
    if (!res) {
      try {
        res = await ask(model);
      } catch (err) {
        // The newer model refused (not on this key, or the file): Whisper writes it down instead.
        if (!refused(err)) throw err;
        model = FALLBACK_MODEL;
        res = await ask(model);
      }
    }
    let text = (res.text ?? "").trim();
    // Told English and written in another script (an accent on "Presidential roof" came back in Cyrillic, 2026-11-07):
    // Whisper keeps to the language it is told.
    if (language === "en" && model !== FALLBACK_MODEL && OTHER_SCRIPT.test(text)) {
      const again = await ask(FALLBACK_MODEL).catch(() => null);
      if (again?.text?.trim() && !OTHER_SCRIPT.test(again.text)) {
        text = again.text.trim();
        model = FALLBACK_MODEL;
      }
    }
    const ms = Date.now() - t0;
    console.info(`[assistant] heard ${audio.size} bytes in ${ms} ms · ${model}${given ? ` · ${given} keywords` : ""} · ${text ? `${text.length} chars` : "nothing"}`);
    // On silence Whisper says its prompt back: six words in a row of the word list, or the address examples, is the
    // prompt, not speech.
    const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9/\s]/g, " ").split(/\s+/).filter(Boolean);
    const p = words(PROMPT).join(" ");
    const w = words(text);
    const echo = language === "en" && w.length >= 6 && w.some((_, i) => i + 6 <= w.length && p.includes(w.slice(i, i + 6).join(" ")));
    if (!text || echo || MADE_UP.test(text)) return NextResponse.json({ text: "", ms, model });
    // An address in it, put the way it is written ("12103 200 seconds. Creed Southeast" → "12103 202nd St SE").
    return NextResponse.json({ text: tidySpokenAddress(text).slice(0, 600), ms, model });
  } catch (err) {
    if (typeof (err as { status?: unknown })?.status === "number") await trial.refund();
    return NextResponse.json({ error: "Couldn't write that down — try again, or type it." }, { status: 502 });
  }
}
