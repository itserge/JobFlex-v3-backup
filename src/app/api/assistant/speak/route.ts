// THE ASSISTANT TALKS BACK (2026-11-04; owner: "will it talk back as well, and you
// can talk to him"). In the Assistant's Talk mode its replies are read out in a
// natural voice — the voice the shop picked for its AI desk (Settings → AI desk;
// "marin" until one is picked), made by OpenAI's speech model, as Deck Studio's
// are (api/deck/voice/speak). Any failure answers an error and the page reads
// the reply in the browser's own voice instead. It carries its own auth — the
// middleware does not match /api.
// A GET (2026-11-06, ?t=the words) streams the audio as it is made, so the page's
// one audio element starts playing after the first moments; the POST answers the
// whole file, for the panels that fetch it.
import { NextResponse } from "next/server";
import { actorForSession, refusal } from "@/lib/assistant/actor";
import { readDeskSettings } from "@/lib/aiDesk/numbers";
import { VOICES } from "@/lib/aiDesk/shared";
import { getOpenAI, isOpenAIEnabled } from "@/lib/sdk/openai";
import { rateLimitShared, HOUR } from "@/lib/rateLimit";
import { notePaidCall } from "@/lib/trialMeter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A spoken reply is a few sentences; anything longer is cut at a sentence, never read for a minute. */
const MAX_CHARS = 600;

const HOW =
  "A capable office assistant for a contracting business, talking to the owner. Natural, clear and friendly — short confident sentences, a quick professional pace, no filler.";

function cut(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= MAX_CHARS) return t;
  const head = t.slice(0, MAX_CHARS);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  return end > 200 ? head.slice(0, end + 1) : head;
}

export async function GET(req: Request) {
  const text = cut(new URL(req.url).searchParams.get("t") ?? "");
  if (!text) return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
  return speak(text, true);
}

export async function POST(req: Request) {
  let body: { text?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
  }
  const text = typeof body.text === "string" ? cut(body.text) : "";
  if (!text) return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
  return speak(text, false);
}

async function speak(text: string, stream: boolean): Promise<Response> {
  let actor: Awaited<ReturnType<typeof actorForSession>>;
  try {
    actor = await actorForSession();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 403 });
  }
  if (!isOpenAIEnabled()) return NextResponse.json({ error: "The voice needs the AI set up on this server." }, { status: 503 });
  const organizationId = actor.organizationId;
  // The checks and the shop's voice read together, not one after another (2026-11-07): the reply sounds sooner.
  const [closed, limit, desk] = await Promise.all([
    refusal(actor, "today", false).catch(() => "Not signed in."),
    rateLimitShared(`assistant-speak:${organizationId}`, 200, HOUR),
    readDeskSettings(organizationId).catch(() => null),
  ]);
  if (closed) return NextResponse.json({ error: closed }, { status: 403 });
  if (!limit.ok) return NextResponse.json({ error: "Too much talking for one hour." }, { status: 429 });
  const voice = desk?.voice && (VOICES as readonly string[]).includes(desk.voice) ? desk.voice : "marin";
  try {
    const res = await getOpenAI().audio.speech.create({ model: "gpt-4o-mini-tts", voice, input: text, response_format: "mp3", instructions: HOW });
    if (stream && res.body) {
      void notePaidCall("openai", "tts-assistant", { orgId: organizationId }).catch(() => null);
      return new Response(res.body, { status: 200, headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
    }
    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) return NextResponse.json({ error: "No audio came back." }, { status: 502 });
    void notePaidCall("openai", "tts-assistant", { orgId: organizationId }).catch(() => null);
    return new NextResponse(new Uint8Array(audio), { status: 200, headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The voice couldn't be made — the page reads it instead." }, { status: 502 });
  }
}
