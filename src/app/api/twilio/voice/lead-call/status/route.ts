// How the desk's call to a lead ended, by Twilio's word (no answer, busy, failed, completed) — and the one text after
// a missed call, where the company may text them (lib/aiDesk/leadCalls leadCallStatus).
import { NextResponse } from "next/server";
import { readTwilioForm } from "@/lib/sdk/twilioVoice";
import { leadCallStatus } from "@/lib/aiDesk/leadCalls";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const params = await readTwilioForm(req, `/api/twilio/voice/lead-call/status${url.search}`);
  if (!params) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  await leadCallStatus(url.searchParams.get("o") ?? "", url.searchParams.get("l") ?? "", params);
  return new NextResponse(null, { status: 204 });
}
