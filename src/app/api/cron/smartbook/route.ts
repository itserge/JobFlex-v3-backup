import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { runSmartBook } from "@/lib/smartbook/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The steps that are due (a text, a reminder, the call) — a model call at most.
export const maxDuration = 120;

// Every 2 minutes (vercel.json): SmartBook does what is due — the morning text, the nudges, the call, the reminders to
// the company, the "still checking" (lib/smartbook/engine). Facebook's new leads come in through the Meta sweep
// (/api/cron/meta-leads, lib/meta/autoImport), which hands them to SmartBook. Always 200 for an authorised call; a
// failure is logged, not retried by Vercel.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await runSmartBook();
  return NextResponse.json(res);
}
