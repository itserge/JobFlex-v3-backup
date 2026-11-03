import "server-only";
// PLATFORM ALERT TEXTS to the JobFlex team (owner, 2026-10-17: "set the text messaging
// for when someone signs up … converted from free trial … anything comes from support …
// canceled his trial during the trial … live users more than 10 at the same time").
//
// The team is the /admin/tasks list (lib/adminTasks/teamShared) — names and mobiles, no
// log-ins; each member ticks which of these they want. Texts leave from JobFlex's own
// number through lib/sms/send (kind "jobflex-admin-alert"), which already honours STOP,
// drops duplicates inside ten minutes and caps the day — so a signup storm cannot run
// up the bill. Texting hours (2026-10-20/21, owner: "last two sign-ups didn't come by
// text", then "set the time to receive texts — 24 hours or a limit, default 24 hours"):
// everyone hears at any hour unless they set "only between" two hours on their card;
// an alert outside them waits until their hours start, folded into one text with any
// others (lib/sms/send holds them, the hourly sms-crew cron sends them). Night alerts
// used to be DROPPED with no trace under a quiet-nights switch that was on for
// everyone. Only the traffic surge ("busy right now") is skipped outside the hours:
// by then it is noise.
//
// The traffic surge is the one alert with its own state: /api/cron/traffic-surge counts
// the last five minutes' visitors (the live map's own "online now" window) and texts
// when the count crosses the threshold — once per surge, not once per five minutes:
// it arms again only after the crowd thins to 60% of the threshold or three hours pass.
// No schema: the threshold and the surge state live in SyncState JSON.
//
// Payments (charged / failed) are lib/adminAlertsPayments — the Stripe webhook's half.
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { sendText } from "@/lib/sms/send";
import { readMembers } from "@/lib/adminTasks/teamStore";
import { holdsOffHours, hoursOpenAt, inHours, type AlertKey } from "@/lib/adminTasks/teamShared";
import { fetchLiveEvents } from "@/lib/traffic-server";

const KIND = "jobflex-admin-alert";
const SETTINGS_KEY = "adminAlerts:settings:v1";
const SURGE_KEY = "adminAlerts:surge:v1";

export const SURGE_DEFAULT = 10;
const SURGE_MIN = 3;
const SURGE_MAX = 500;
/** The live map's own "online now" window. */
const ONLINE_WINDOW_MS = 5 * 60_000;
/** A new surge text only after the crowd thinned to this share of the threshold… */
const REARM_SHARE = 0.6;
/** …or this long passed — a crowd that never thins is still news twice a shift. */
const REARM_MS = 3 * 60 * 60_000;

async function readJson(key: string): Promise<unknown> {
  try {
    const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
    return row ? (JSON.parse(row.cursor) as unknown) : null;
  } catch {
    return null;
  }
}
async function writeJson(key: string, value: unknown): Promise<void> {
  const cursor = JSON.stringify(value);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

export type AlertSettings = { surgeThreshold: number };

export async function alertSettings(): Promise<AlertSettings> {
  const raw = (await readJson(SETTINGS_KEY)) as { surgeThreshold?: unknown } | null;
  const n = typeof raw?.surgeThreshold === "number" ? Math.round(raw.surgeThreshold) : SURGE_DEFAULT;
  return { surgeThreshold: Math.min(SURGE_MAX, Math.max(SURGE_MIN, n)) };
}

export async function setSurgeThreshold(n: number): Promise<AlertSettings> {
  const next = { surgeThreshold: Math.min(SURGE_MAX, Math.max(SURGE_MIN, Math.round(n))) };
  await writeJson(SETTINGS_KEY, next);
  return next;
}

/** Text everyone subscribed to `key` — now, or when their texting hours start. Never throws; a dead
 *  transport loses a text, not the caller. `once`: a SyncState key claimed before the first text — a webhook Stripe
 *  delivers again (a retry after a 500, a duplicate event for the same charge) texts nobody twice. Claimed only when
 *  someone is listening, so an alert nobody ticked writes nothing. Returns the texts sent now. */
export async function fireAdminAlert(key: AlertKey, body: string, once?: string): Promise<number> {
  try {
    const now = new Date();
    const list = (await readMembers()).filter((m) => m.on && (m.alerts ?? []).includes(key) && (inHours(m.hours, now) || holdsOffHours(key)));
    if (!list.length) return 0;
    if (once) {
      try {
        await db.syncState.create({ data: { key: `adminAlerts:once:${once}`, cursor: new Date().toISOString() } });
      } catch {
        return 0; // already told
      }
    }
    let sent = 0;
    let held = 0;
    for (const m of list) {
      const later = inHours(m.hours, now) ? null : hoursOpenAt(m.hours, now);
      const r = await sendText({ organizationId: null, to: m.phone, body, kind: KIND, ...(later ? { sendAfter: later } : {}) }).catch(() => null);
      if (r && r.ok && r.status === "SENT") sent += 1;
      else if (r && r.ok && r.status === "HELD") held += 1;
    }
    console.info(`[adminAlerts] ${key}: ${sent}/${list.length} texted${held ? `, ${held} held for their texting hours` : ""} — ${body.slice(0, 80)}`);
    return sent;
  } catch (err) {
    console.warn("[adminAlerts] not sent:", err instanceof Error ? err.message : err);
    return 0;
  }
}

export const short = (s: string, n = 48) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
export const admin = async (path: string) => `${await appBaseUrl()}${path}`;

/* ── the four event texts ─────────────────────────────────────────────────── */

export async function alertSignup(info: { orgName: string; flow?: string | null }): Promise<void> {
  const how = info.flow === "cardless" ? "trial, no card" : info.flow === "checkout" ? "trial, card on file" : null;
  await fireAdminAlert("signup", `JobFlex: new sign-up — ${short(info.orgName)}${how ? ` (${how})` : ""}. ${await admin("/admin/traffic/signups")}`);
}

export async function alertTrialConverted(info: { orgName: string; plan?: string | null }): Promise<void> {
  const plan = (info.plan ?? "").toString().trim();
  await fireAdminAlert("converted", `JobFlex: ${short(info.orgName)} converted from the trial${plan ? ` — ${plan.toLowerCase()}` : ""}. Paying now. ${await admin("/admin/trials")}`);
}

export async function alertTrialCanceled(info: { orgName: string; daysIn?: number | null }): Promise<void> {
  const days = typeof info.daysIn === "number" && info.daysIn >= 0 ? ` on day ${info.daysIn + 1}` : "";
  await fireAdminAlert("canceled", `JobFlex: ${short(info.orgName)} canceled their trial${days}. ${await admin("/admin/trials")}`);
}

export async function alertSupportTicket(info: { orgName: string; subject: string; ref: string }): Promise<void> {
  await fireAdminAlert("support", `JobFlex: support ${info.ref} from ${short(info.orgName)} — “${short(info.subject, 60)}”. ${await admin("/admin/support")}`);
}

/** The purge could not give a deleted company's number back to Twilio: it is still
 *  billed to JobFlex until someone releases it in the Twilio console. */
export async function alertNumberLeft(info: { orgName: string; number: string | null; numberSid: string | null }): Promise<void> {
  const which = [info.number, info.numberSid].filter(Boolean).join(" · ") || "a number";
  await fireAdminAlert("cleanup", `JobFlex: purged ${short(info.orgName)}, but its Twilio number ${which} was not released — release it in the Twilio console.`, `numberLeft:${info.numberSid ?? info.number ?? info.orgName}`);
}

/* ── the traffic surge ────────────────────────────────────────────────────── */

type SurgeState = { lastAlertAt?: string; armed?: boolean };

/** Distinct production visitors with an event in the last five minutes — the live
 *  map's "online now", with the admin pages themselves left out. */
export function onlineNowCount(events: Array<{ person: string; distinctId: string; at: number; pathname: string; environment: string }>, now = Date.now()): number {
  const since = now - ONLINE_WINDOW_MS;
  const seen = new Set<string>();
  for (const e of events) {
    if (e.at < since) continue;
    if (e.environment && e.environment !== "production") continue;
    if ((e.pathname ?? "").startsWith("/admin")) continue;
    seen.add(e.person || e.distinctId);
  }
  return seen.size;
}

export type SurgeCheck = { count: number; threshold: number; fired: boolean; armed: boolean };

/** The five-minute cron's whole job. One text per surge: fires at or above the
 *  threshold while armed; re-arms once the count thins to 60% of it, or after three hours. */
export async function checkTrafficSurge(): Promise<SurgeCheck> {
  // Up to two minutes old: with /admin/traffic open this is the minute the page already read (lib/posthog-cache).
  const [{ surgeThreshold }, events] = await Promise.all([alertSettings(), fetchLiveEvents(2 * 60_000)]);
  const count = onlineNowCount(events);
  const state = ((await readJson(SURGE_KEY)) as SurgeState | null) ?? {};
  const last = state.lastAlertAt ? Date.parse(state.lastAlertAt) : 0;
  let armed = state.armed !== false;
  if (!armed && (count <= surgeThreshold * REARM_SHARE || Date.now() - last > REARM_MS)) armed = true;

  let fired = false;
  if (armed && count >= surgeThreshold) {
    const sent = await fireAdminAlert("surge", `JobFlex: busy right now — ${count} visitors on the site at once (last 5 min). Live map: ${await admin("/admin/traffic")}`);
    fired = sent > 0;
    // Disarm even when nobody is subscribed: the cron must not knock every five minutes.
    armed = false;
    await writeJson(SURGE_KEY, { lastAlertAt: new Date().toISOString(), armed } satisfies SurgeState);
  } else if (armed !== (state.armed !== false)) {
    await writeJson(SURGE_KEY, { lastAlertAt: state.lastAlertAt, armed } satisfies SurgeState);
  }
  return { count, threshold: surgeThreshold, fired, armed };
}
