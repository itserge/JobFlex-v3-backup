// THE ASSISTANT'S MINUTE (2026-11-04): changes approved by text or voice run once
// their two-minute undo window is over; unanswered read-backs expire
// (lib/assistant/runner). Fail-closed cron auth like the other cron routes.
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { runAssistantMinute } from "@/lib/assistant/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 300 (2026-11-05): a build left to the minute job is a minute's AI estimate, a few run side by side.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await runAssistantMinute();
  return NextResponse.json(res);
}
