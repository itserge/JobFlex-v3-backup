// The call is over: the transcript and outcome (lib/aiDesk/liveCall finishCall).
import { finishCall, type CallOutcome } from "@/lib/aiDesk/liveCall";
import { finishLeadCall } from "@/lib/aiDesk/leadCalls";
import { finishOutreachCall } from "@/lib/outreach/server";
import { leadForToken } from "@/lib/smartbook/phone";
import { deskRequest, json, str } from "../route-helpers";

export const runtime = "nodejs";

const OUTCOMES = new Set<CallOutcome["outcome"]>(["done", "transfer", "voicemail", "failed"]);

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  const outcome = OUTCOMES.has(r.body.outcome as CallOutcome["outcome"]) ? (r.body.outcome as CallOutcome["outcome"]) : "failed";
  const transcript = (Array.isArray(r.body.transcript) ? r.body.transcript : [])
    .map((l) => (l && typeof l === "object" ? { role: str((l as Record<string, unknown>).role, 10), text: str((l as Record<string, unknown>).text, 2000) } : null))
    .filter((l): l is { role: string; text: string } => !!l && !!l.text)
    .slice(0, 400);
  // JobFlex's own outreach call: onto the contractor's record — no company, no minutes, no Phone page.
  if (r.token.kind === "outreach") {
    await finishOutreachCall(r.token, { outcome, transcript, seconds: Number(r.body.seconds) || 0, error: str(r.body.error, 300) || null });
    return json({ ok: true });
  }
  const booked = r.body.booked && typeof r.body.booked === "object" ? { appointmentId: str((r.body.booked as Record<string, unknown>).appointmentId, 60) } : null;
  const input = { outcome, transcript, seconds: Number(r.body.seconds) || 0, booked: booked?.appointmentId ? booked : null, messageTaken: r.body.messageTaken === true, error: str(r.body.error, 300) || null };
  // The desk's own call to a lead: onto that lead (never a new one), and the lead marked reached when they talked.
  if (r.token.kind === "lead") {
    await finishLeadCall(r.token, input);
    return json({ ok: true });
  }
  // A lead SmartBook is scheduling called in: their lead is on file — the transcript never makes a second one.
  const known = !!(await leadForToken(r.token).catch(() => null));
  await finishCall({ callSid: r.token.callSid, organizationId: r.token.organizationId }, input, { newLead: !known });
  return json({ ok: true });
}
