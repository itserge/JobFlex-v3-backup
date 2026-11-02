// The voice server asks what the desk needs for this call (lib/aiDesk/liveCall callBrief).
import { callBrief } from "@/lib/aiDesk/liveCall";
import { leadCallBrief } from "@/lib/aiDesk/leadCalls";
import { outreachBrief } from "@/lib/outreach/server";
import { deskRequest, json } from "../route-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  // JobFlex's own outreach call to a contractor (lib/outreach): its own script and tools. The company's desk calling
  // one of its leads (lib/aiDesk/leadCalls): the desk's own setup, the call turned around —
  // with what SmartBook has said to them when it is scheduling that lead.
  const brief =
    r.token.kind === "outreach"
      ? await outreachBrief(r.token)
      : r.token.kind === "lead"
        ? await leadCallBrief(r.token)
        : await callBrief({ callSid: r.token.callSid, organizationId: r.token.organizationId, from: r.token.from });
  return json(brief, brief.ok ? 200 : 404);
}
