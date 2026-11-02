import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { sweepLeadCalls } from "@/lib/aiDesk/leadCalls";

export const runtime = "nodejs";
export const maxDuration = 60;

// Every 5 minutes: the AI desk calls the new leads nobody reached, for every company that turned on
// "Call new leads" (lib/aiDesk/leadCalls sweepLeadCalls) — once a lead, inside the automatic calling hours.
// Fail-closed cron auth like the others.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await sweepLeadCalls()) });
}
