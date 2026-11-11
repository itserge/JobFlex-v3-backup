import "server-only";
// THE SIGN-UP FORM'S ALARM (owner, 2026-10-14: "whether the problem is on our side") — every fifteen minutes the cron
// (api/cron/signup-watch) reads the last hour's problems on the form by reason. Three visitors on one reason, or two
// on a hard fault of ours (lib/signup-dropoff: signupAlertsOf), is a pattern, not one person's typo: the platform
// admins are emailed, and the office screen shows it under "Needs you" while it lasts. One reason is emailed at most
// every six hours. The state is one SyncState row (no schema change): what was emailed when, and the last check.
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/sdk/resend";
import { renderEmail } from "@/lib/email/renderEmail";
import { appBaseUrl } from "@/lib/appUrl";
import { platformAlertRecipients } from "@/lib/integrationsAlertRecipients";
import { runTrafficQuery } from "@/lib/traffic-server";
import { ALERT_REPEAT_MS, alertLine, alertsToSend, buildAlertQuery, problemGroupFromRow, signupAlertsOf, type SignupAlert, type SignupProblemGroup } from "@/lib/signup-dropoff";
import { screenName } from "@/lib/signup-watch-shared";
import type { VisitorScope } from "@/lib/traffic-visitor";

const STATE_KEY = "signupAlerts";
export const ALERT_WINDOW_MINUTES = 60;
/** The office screen shows the last check's alerts while the check is this fresh (the cron runs every 15 min). */
const SHOW_FOR_MS = 40 * 60_000;

interface AlertState {
  /** reason → when it was last emailed (ms). */
  sent: Record<string, number>;
  /** The last check's alerts. */
  current: SignupAlert[];
  checkedAt: number;
}

/** Production reads production visitors; a local stand reads its own too. */
export const signupWatchScope = (): VisitorScope => (process.env.NODE_ENV === "production" ? "production" : "with-local");

async function readState(): Promise<AlertState> {
  const row = await db.syncState.findUnique({ where: { key: STATE_KEY } }).catch(() => null);
  try {
    const v = row ? (JSON.parse(row.cursor) as Partial<AlertState>) : {};
    return { sent: v.sent && typeof v.sent === "object" ? v.sent : {}, current: Array.isArray(v.current) ? v.current : [], checkedAt: Number(v.checkedAt) || 0 };
  } catch {
    return { sent: {}, current: [], checkedAt: 0 };
  }
}
async function writeState(state: AlertState): Promise<void> {
  // Forget reasons emailed long ago, so the row stays small.
  const sent = Object.fromEntries(Object.entries(state.sent).filter(([, at]) => state.checkedAt - at < 4 * ALERT_REPEAT_MS));
  const cursor = JSON.stringify({ ...state, sent });
  await db.syncState.upsert({ where: { key: STATE_KEY }, create: { key: STATE_KEY, cursor }, update: { cursor } });
}

/** The alerts the office screen should show now: the last check's, while it is fresh. */
export async function readSignupAlerts(now = Date.now()): Promise<SignupAlert[]> {
  const s = await readState();
  return now - s.checkedAt < SHOW_FOR_MS ? s.current : [];
}

async function emailAlerts(alerts: SignupAlert[]): Promise<{ sent: number; error?: string }> {
  const to = await platformAlertRecipients();
  if (!to.length) return { sent: 0, error: "no recipients" };
  const base = (await appBaseUrl()).replace(/\/$/, "");
  const ours = alerts.some((a) => a.side === "ours");
  const first = alerts[0];
  const { subject, html } = renderEmail({
    subject: ours ? `Sign-up form: ${first.words.toLowerCase()} — ${first.visits} visitors in the last hour` : `Sign-up form: ${first.visits} visitors hit "${first.words}"`,
    lockup: { kind: "platform" },
    kicker: { text: ours ? "Sign-up form · our side" : "Sign-up form", tone: ours ? "bad" : "warn" },
    headline: ours ? "People are failing to sign up — on our side" : "Several people hit the same wall on the sign-up",
    prose: [
      ...alerts.map((a) => alertLine(a, ALERT_WINDOW_MINUTES) + "."),
      ours ? "A fault of ours means the visitor did nothing wrong — the server, the code email, or the page failed them." : "The form refused what they gave it. Several in an hour usually means the box or its message is unclear.",
    ],
    box: alerts.flatMap((a) => [
      { type: "field" as const, label: a.words, value: `${a.visits} visitors · ${a.times} times${a.screen ? ` · ${screenName(a.screen)}` : ""}` },
      ...(a.message ? [{ type: "field" as const, label: "What they saw", value: a.message }] : []),
    ]),
    cta: { label: "Watch them live", href: `${base}/admin/traffic#signup-stops` },
    footer: { name: "JobFlex" },
  });
  let sent = 0;
  for (const address of to) {
    try {
      await sendEmail({ mailClass: "transactional", to: address, subject, html });
      sent += 1;
    } catch (err) {
      console.error("[signup-alerts] email failed:", err instanceof Error ? err.message : err);
    }
  }
  return { sent };
}

export interface SignupAlertRun { checked: number; alerts: SignupAlert[]; emailed: SignupAlert[]; email?: { sent: number; error?: string } }

/** One check: read the last hour, keep what is worth showing, email what was not emailed lately. */
export async function runSignupAlertCheck(now = Date.now()): Promise<SignupAlertRun> {
  const rows = await runTrafficQuery(buildAlertQuery(ALERT_WINDOW_MINUTES, signupWatchScope()), "signup alerts");
  const groups = rows.map(problemGroupFromRow).filter((g): g is SignupProblemGroup => !!g);
  const alerts = signupAlertsOf(groups);
  const state = await readState();
  const toSend = alertsToSend(alerts, state.sent, now);
  let email: SignupAlertRun["email"];
  if (toSend.length) {
    email = await emailAlerts(toSend);
    if (email.sent > 0) for (const a of toSend) state.sent[a.reason] = now;
  }
  await writeState({ sent: state.sent, current: alerts, checkedAt: now });
  return { checked: groups.length, alerts, emailed: email?.sent ? toSend : [], email };
}
