// POST /api/twilio/assistant/sms — a text came in on the JobFlex Assistant number
// (2026-11-04). The number's own webhook (Twilio → the number → Messaging →
// "A message comes in"), so the company numbers' route, /api/twilio/sms, is
// untouched. The signature is checked like every Twilio webhook; the text is
// kept as an SmsMessage row (its MessageSid makes a retried webhook a no-op) and
// answered after the response (lib/assistant/sms), so Twilio gets its empty
// TwiML at once.
import { after, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/appUrl";
import { verifyTwilioSignature } from "@/lib/sdk/twilioVoice";
import { answerAssistantText, keepInbound } from "@/lib/assistant/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const twiml = () => new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { status: 200, headers: { "Content-Type": "text/xml" } });

export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    params[k] = String(v);
  });
  const url = `${process.env.TWILIO_APP_URL ?? (await appBaseUrl())}/api/twilio/assistant/sms`;
  if (!(await verifyTwilioSignature(url, params, req.headers.get("x-twilio-signature")))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }
  const text = { from: (params.From ?? "").trim(), to: (params.To ?? "").trim(), body: (params.Body ?? "").trim(), sid: params.MessageSid || null };
  if (!text.from) return twiml();
  if (!(await keepInbound(text))) return twiml(); // Twilio sent this one already
  after(() => answerAssistantText(text));
  return twiml();
}
