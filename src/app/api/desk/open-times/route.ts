// The next open visits for the caller (lib/aiDesk/liveCall openTimes) — or, on a call about a lead SmartBook is
// scheduling, the times it sent them first (lib/smartbook/engine callTimes).
import { openTimes } from "@/lib/aiDesk/liveCall";
import { callTimes } from "@/lib/smartbook/engine";
import { leadForToken } from "@/lib/smartbook/phone";
import { deskRequest, json, str } from "../route-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  const lead = await leadForToken(r.token);
  if (lead) return json(await callTimes(r.token.organizationId, lead));
  const days = Number(r.body.days);
  return json(await openTimes(r.token.organizationId, str(r.body.service, 200) || null, Number.isFinite(days) ? days : 7));
}
