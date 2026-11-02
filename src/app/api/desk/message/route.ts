// The desk takes a message (lib/aiDesk/liveCall takeMessage) — on the desk's own call to a lead, onto that lead
// (lib/aiDesk/leadCalls leadCallMessage); from a caller SmartBook is scheduling, onto theirs (lib/smartbook/engine
// messageOnCall). Never a second lead.
import { db } from "@/lib/db";
import { takeMessage } from "@/lib/aiDesk/liveCall";
import { messageOnCall } from "@/lib/smartbook/engine";
import { leadForToken } from "@/lib/smartbook/phone";
import { leadCallMessage } from "@/lib/aiDesk/leadCalls";
import { deskRequest, json, str } from "../route-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  // On the desk's own call to a lead the message joins that lead (lib/aiDesk/leadCalls) — never a second lead.
  if (r.token.kind === "lead") return json(await leadCallMessage(r.token, { name: str(r.body.name, 120), phone: str(r.body.phone, 40) || r.token.from, about: str(r.body.about, 2000) }));
  const lead = await leadForToken(r.token);
  if (lead) {
    const about = str(r.body.about, 2000);
    if (!about) return json({ ok: false, error: "What is the message about?" });
    const ok = await messageOnCall(r.token.organizationId, lead, about);
    if (ok) await db.aiPhoneCall.updateMany({ where: { callSid: r.token.callSid }, data: { leadId: lead, summary: `Message: ${about.slice(0, 100)}` } }).catch(() => null);
    return json(ok ? { ok: true } : { ok: false, error: "The message couldn't be saved — say someone will call back." });
  }
  return json(await takeMessage(r.token.organizationId, r.token.callSid, { name: str(r.body.name, 120), phone: str(r.body.phone, 40) || r.token.from, about: str(r.body.about, 2000) }));
}
