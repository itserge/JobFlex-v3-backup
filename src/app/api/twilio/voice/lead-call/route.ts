// The AI desk's call to a lead is answered (lib/aiDesk/leadCalls callLead → this Url): a person gets the live desk on
// the company's own setup; a machine, after its beep, the short voicemail; a fax, a hang-up.
import { NextResponse } from "next/server";
import { readTwilioForm } from "@/lib/sdk/twilioVoice";
import { callbackBase, leadCallAnswered } from "@/lib/aiDesk/leadCalls";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  // Twilio signs the URL it was given, query and all.
  const params = await readTwilioForm(req, `/api/twilio/voice/lead-call${url.search}`);
  if (!params) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  const xml = await leadCallAnswered(url.searchParams.get("o") ?? "", url.searchParams.get("l") ?? "", params, await callbackBase());
  return new NextResponse(xml, { headers: { "Content-Type": "text/xml" } });
}
