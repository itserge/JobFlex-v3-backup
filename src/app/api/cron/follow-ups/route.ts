import { NextResponse } from "next/server";
import { runDueFollowUps } from "@/lib/followUps/engine";
import { runLeadFollowUpSweep } from "@/lib/leadFollowUps";
import { runOrgTimezoneSweep } from "@/lib/orgTimezoneSweep";
import { isCronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // Shared fail-closed cron auth (header / Bearer only, constant-time).
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await runDueFollowUps();
  // The shops' own follow-ups on accepted homeowner leads (2026-11-07, lib/leadFollowUps): a day, three days, a week.
  const leads = await runLeadFollowUpSweep().catch((err) => {
    console.warn("[follow-ups] lead sweep failed:", err instanceof Error ? err.message : err);
    return null;
  });
  // Every company's time zone on auto (2026-11-07, lib/orgTimezoneSweep): the default moves to what the address or
  // phone says. Before the lead sweep would be nicer, but the lead sweep reads the zone itself each run, so next hour.
  const timezones = await runOrgTimezoneSweep().catch((err) => {
    console.warn("[follow-ups] time-zone sweep failed:", err instanceof Error ? err.message : err);
    return null;
  });
  // The promise tracker (2026-11-10, lib/promises): a promise a later event proves kept is closed, and its owner is
  // reminded the morning it is due and once more when it is late.
  const promises = await import("@/lib/promises/server")
    .then((m) => m.sweepPromises())
    .catch((err) => {
      console.warn("[follow-ups] promise sweep failed:", err instanceof Error ? err.message : err);
      return null;
    });
  // Campaigns still going out (2026-11-10, lib/winback): each sends its next batch, inside the company's own hours.
  const campaigns = await Promise.all([import("@/lib/winback/server"), import("@/lib/appUrl")])
    .then(async ([m, u]) => m.drainCampaigns(await u.appBaseUrl()))
    .catch((err) => {
      console.warn("[follow-ups] campaign drain failed:", err instanceof Error ? err.message : err);
      return null;
    });
  return NextResponse.json({ ok: true, ...res, leadFollowUps: leads, orgTimezones: timezones, promises, campaigns });
}
