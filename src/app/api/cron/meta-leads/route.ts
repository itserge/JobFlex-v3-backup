import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { sweepMetaAutoImport } from "@/lib/meta/autoImport";

export const runtime = "nodejs";
export const maxDuration = 60;

// Every 5 minutes: new Facebook lead-form submissions into Leads for every
// workspace that turned on "New leads come in by themselves" (lib/meta/autoImport).
// Fail-closed cron auth like the others.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await sweepMetaAutoImport());
}
