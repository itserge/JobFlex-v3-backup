// GET /api/cron/ramp-sync — every hour (vercel.json): each connected business's card spend read onto the jobs, the
// safety net under the webhook (2026-10-29). The cron secret guards it like the other crons.
import { NextResponse } from "next/server";
import { connectedRampOrgs } from "@/lib/ramp/connection";
import { syncRamp } from "@/lib/ramp/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgs = await connectedRampOrgs();
  const out: Array<{ organizationId: string; ok: boolean; booked?: number; needsJob?: number; updated?: number; error?: string }> = [];
  for (const organizationId of orgs) {
    const r = await syncRamp(organizationId).catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : "failed" }));
    out.push(r.ok ? { organizationId, ok: true, booked: r.booked, needsJob: r.needsJob, updated: r.updated } : { organizationId, ok: false, error: r.error });
  }
  return NextResponse.json({ ok: true, synced: out.length, results: out });
}
