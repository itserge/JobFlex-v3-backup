// After the desk's part of a call to a lead (the <Redirect> after <Connect><Stream>): a transfer rings the company
// phone, anything else hangs up (lib/aiDesk/leadCalls leadCallAfter).
import { NextResponse } from "next/server";
import { readTwilioForm } from "@/lib/sdk/twilioVoice";
import { leadCallAfter } from "@/lib/aiDesk/leadCalls";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const params = await readTwilioForm(req, `/api/twilio/voice/lead-call/after${url.search}`);
  if (!params) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  const xml = await leadCallAfter(url.searchParams.get("o") ?? "", params.CallSid ?? null);
  return new NextResponse(xml, { headers: { "Content-Type": "text/xml" } });
}
