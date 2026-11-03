// THE ANALYST'S READING, server side (2026-10-04): the week's sessions from
// PostHog (lib/posthog-cache, half an hour), the owner's names for the ads
// (SyncState adname:*), analyse() over them, and what the ads' accounts are
// now (lib/traffic-money, from the database). Shared by the admin's actions —
// the panel, its exports, "Export everything" — so each of them reads the
// same week the same way. No auth here: every caller checks it.

import { countedOrgs, statsHiddenIds } from "@/lib/statsHidden";
import { db } from "./db";
import { analyse, analystWindowFrom, ANALYST_DAYS, type AnalystReport, type LandingSession } from "./traffic-analyst";
import type { StaleNote } from "./traffic-contract";
import { adNameKey, signupState } from "./traffic-live";
import { adMoney, type AdMoney } from "./traffic-money";
import { parseTrafficFilters } from "./traffic-query";
import { fetchAnalystSessions, posthogApiConfig } from "./traffic-server";
import { TRAFFIC_SINCE_MS } from "./traffic-visitor";

export interface AnalystResult {
  status: "ok" | "disabled" | "error";
  message?: string;
  /** When PostHog answered for these sessions — not when the page asked. */
  fetchedAt: string;
  /** The window read: `days` back from the read, never before the ad launch. */
  window?: { from: string; to: string };
  report: AnalystReport;
  /** Each ad's and campaign's accounts since the ad launch, and what they are now (database). */
  money?: AdMoney;
  stale?: StaleNote;
}

export interface AnalystReading { result: AnalystResult; sessions: LandingSession[]; adNames: Record<string, string>; timezone: string }

/** The owner's names for these ad and campaign ids. */
export async function adNamesForTags(tags: readonly string[]): Promise<Record<string, string>> {
  const wanted = [...new Set(tags.filter((t) => t && t.length <= 120))];
  if (!wanted.length) return {};
  const rows = await db.syncState.findMany({ where: { key: { in: wanted.map(adNameKey) } }, select: { key: true, cursor: true } }).catch(() => []);
  const names: Record<string, string> = {};
  for (const t of wanted) { const row = rows.find((r) => r.key === adNameKey(t)); if (row?.cursor) names[t] = row.cursor; }
  return names;
}

/** The accounts made since the ad launch with their tags and subscription state. */
const MONEY_LIMIT = 5000;
async function moneySignups() {
  const rows = await db.organization.findMany({
    where: { createdAt: { gte: new Date(TRAFFIC_SINCE_MS) }, ...countedOrgs(await statsHiddenIds()) },
    orderBy: { createdAt: "desc" }, take: MONEY_LIMIT,
    select: { utmCampaign: true, utmContent: true, subscription: { select: { status: true } } },
  });
  return rows.map((r) => ({ campaign: r.utmCampaign ?? "", content: r.utmContent ?? "", state: signupState(r.subscription?.status ?? "") }));
}

/** Ad → money, with the analyst window's visits beside it. A failed read costs the table, never the reading. */
async function readMoney(sessions: readonly LandingSession[], report: AnalystReport, names: Record<string, string>): Promise<{ money?: AdMoney; names: Record<string, string> }> {
  try {
    const signups = await moneySignups();
    const more = await adNamesForTags(signups.flatMap((s) => [s.campaign, s.content]).filter((t) => !(t in names)));
    const all = { ...names, ...more };
    const visits = Object.fromEntries(report.ads.map((a) => [a.key, a.n]));
    const campaignVisits: Record<string, number> = {};
    for (const s of sessions) if (s.utmCampaign && (s.landingViews > 0 || s.industry !== "")) campaignVisits[s.utmCampaign] = (campaignVisits[s.utmCampaign] ?? 0) + 1;
    return { money: adMoney(signups, { since: new Date(TRAFFIC_SINCE_MS).toISOString(), adNames: all, visits, campaignVisits }), names: all };
  } catch {
    return { names };
  }
}

export async function readAnalyst(input: { timezone?: unknown; force?: unknown } = {}): Promise<AnalystReading> {
  const now = new Date().toISOString();
  const timezone = parseTrafficFilters({ timezone: input.timezone }).timezone;
  const none = async (status: "disabled" | "error", message: string): Promise<AnalystReading> => {
    const report = analyse([], { timezone });
    // The accounts are in the database: the money table stands without PostHog.
    const { money, names } = await readMoney([], report, {});
    return { result: { status, message, fetchedAt: now, report, ...(money ? { money } : {}) }, sessions: [], adNames: names, timezone };
  };
  try {
    if (!posthogApiConfig()) return none("disabled", "Connect a PostHog personal key with query:read and a numeric project ID.");
    // PostHog down: the week as it last read, and from when.
    const { sessions, readAt, stale } = await fetchAnalystSessions(input.force === true);
    const sessionNames = await adNamesForTags(sessions.flatMap((s) => [s.utmCampaign, s.utmContent]));
    const at = Date.parse(readAt);
    const windowFrom = analystWindowFrom(at);
    // The reading as of the read, so a cached week does not drift against "now".
    const report = analyse(sessions, { timezone, adNames: sessionNames, now: at, days: ANALYST_DAYS, windowFrom });
    const { money, names } = await readMoney(sessions, report, sessionNames);
    const result: AnalystResult = {
      status: "ok", fetchedAt: readAt,
      window: { from: new Date(windowFrom).toISOString(), to: readAt },
      report, ...(money ? { money } : {}),
      ...(stale ? { stale } : {}),
    };
    return { result, sessions, adNames: names, timezone };
  } catch (err) {
    return none("error", err instanceof Error && err.name === "TimeoutError" ? "PostHog took too long. Try again shortly." : err instanceof Error ? err.message : "The analyst could not read.");
  }
}
