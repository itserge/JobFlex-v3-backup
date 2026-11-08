import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { runSubsSweep } from "@/lib/subQuotes/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Up to five estimate reads (a model call each), the expiries, the reminders.
export const maxDuration = 60;

// Every 10 minutes (vercel.json): the subcontractors sweep (lib/subQuotes/sweep, 2026-11-08, the subcontractors
// plan, part 2) — the queued AI reads of estimates, the request links past their expiry, the one "reply by tomorrow"
// reminder to subs who have not answered. Always 200 for an authorised call; the run's figures and any error sit in
// SyncState for /admin/health.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await runSubsSweep();
  return NextResponse.json(res);
}
