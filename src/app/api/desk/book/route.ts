// The desk books one of the open times (lib/aiDesk/liveCall bookVisit) — on a call about a lead SmartBook is
// scheduling, onto that lead and its conversation (lib/smartbook/engine bookOnCall), never a second lead.
import { db } from "@/lib/db";
import { bookVisit } from "@/lib/aiDesk/liveCall";
import { bookOnCall } from "@/lib/smartbook/engine";
import { leadForToken } from "@/lib/smartbook/phone";
import { deskRequest, json, str } from "../route-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  const lead = await leadForToken(r.token);
  if (lead) {
    const out = await bookOnCall(r.token.organizationId, lead, str(r.body.timeId, 120));
    if (out.ok) await db.aiPhoneCall.updateMany({ where: { callSid: r.token.callSid }, data: { leadId: lead, summary: `Booked ${out.serviceLabel} — ${out.when}` } }).catch(() => null);
    return json(out);
  }
  return json(await bookVisit(r.token.organizationId, r.token.callSid, { timeId: str(r.body.timeId, 120), name: str(r.body.name, 120), phone: str(r.body.phone, 40) || r.token.from, address: str(r.body.address, 300) || null, notes: str(r.body.notes, 2000) || null }));
}
