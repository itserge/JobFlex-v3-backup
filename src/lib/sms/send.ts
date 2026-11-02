// EVERY TEXT GOES THROUGH HERE (2026-09-24) — server only.
//
// JobFlex owns the Twilio account (src/lib/sdk/twilio); a contractor only
// adds numbers. This is the one chokepoint, and it decides what SmartSpace's
// texting learned the hard way:
//   - a number that replied STOP is never texted again (SmsOptOut);
//   - the same words to the same number twice in ten minutes is once;
//   - caps per number, per company and platform-wide, per day, fail-closed —
//     every text costs money, so a limiter outage pauses texting;
//   - the plan's monthly allowance (entitlements SMS_ALLOWANCE) is a soft
//     stop: past it a company's texts are SKIPPED "allowance" until the
//     next month, nothing is billed (owner, 2026-10-26); JobFlex's own texts
//     (billing, codes, HELP — format isSystemText) are never stopped;
//   - quiet hours hold a text until the morning, folded with the others;
//   - Twilio off (the local stand, a fresh deploy) is a SKIPPED row, not an
//     error — the app works the same, and the log shows what would have gone;
//   - a company's text goes out only from its own registered number
//     (registration.ts, 2026-10-02); sign-in codes go through Twilio Verify
//     (verify.ts). JobFlex's own texts (kind "jobflex-…": the lead alerts a
//     company turned on, HELP on JobFlex's number) leave from JobFlex's number
//     once Twilio approved it (jobflexSender.ts). No number: a SKIPPED row
//     "no-number". A company's number texts its team, and anyone else only
//     after they said yes on the booking page (consent.ts), else "no-consent".
// Every text is a row in SmsMessage: the usage counter, the delivery status
// from Twilio's callback, the thing a support question is answered from.

import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { toE164 } from "@/lib/phone";
import { DAY, rateLimitShared } from "@/lib/rateLimit";
import { isTwilioEnabled, sendSMS } from "@/lib/sdk/twilio";
import {
  defaultNotificationPrefs,
  inQuietHours,
  nextQuietEnd,
  parseNotificationPrefs,
  SMS_URGENT_KEYS,
  smsDecision,
  type PrefKey, allowsSms, audienceForRole, textEventsFor } from "@/lib/notificationPrefsShared";
import { brand, clip, heldDigestText, isSystemText, jobflexRoundupText, SMS_MAX, unbrand } from "./format";
import { trialBlocksText } from "@/lib/trialMeter";
import { hasTextConsent, isTeamPhone } from "./consent";
import { jobflexSender } from "./jobflexSender";
import { houseLineFor } from "./houseLine";
import { orgMayText } from "@/lib/paidCaps";
import { smsAllowanceFor } from "@/lib/entitlements";
import { getOrgPlanById } from "@/lib/orgPlan";
import { activeCapture } from "@/lib/leadCenter/outboxContext";

const CAP_PER_NUMBER_PER_DAY = 25;
const CAP_PER_ORG_PER_DAY = 500;
const CAP_PLATFORM_PER_DAY = 5000;
const DUPLICATE_WINDOW_MS = 10 * 60_000;
const OFFICE_ROLES = ["OWNER", "ADMIN", "MANAGER"] as const;

export type SendTextInput = {
  organizationId: string | null;
  to: string;
  body: string;
  /** A preference key, or "crew-assigned", "verify", "welcome", "test", "reply", … */
  kind: string;
  /** Hold until then (quiet hours); the hourly cron sends it. */
  sendAfter?: Date | null;
};
export type SendTextResult =
  | { ok: true; id: string; status: "SENT" | "HELD" }
  /** `why`: "no-number" (the company has no registered number), "no-consent", "not-configured" (no Twilio here). */
  | { ok: true; id: string; status: "SKIPPED"; why: string }
  | { ok: false; reason: "invalid-number" | "opted-out" | "duplicate" | "cap" | "trial" | "plan-ended" | "allowance" | "limiter-down" | "failed" };

/** What a member reads when the card-less trial held a text back (lib/trialCaps). */
export const TRIAL_TEXT_MESSAGE = "The free trial without a card sends no texts except the verification code. Add a card to unlock full limits.";

/** What a member reads when the company's plan has ended (lib/paidCaps). */
export const PLAN_ENDED_TEXT_MESSAGE = "Your plan has ended, so texts from your company's number are paused. Choose a plan on Subscription to send them again.";

/** Send one text (or hold it). Never throws. */
export async function sendText(input: SendTextInput): Promise<SendTextResult> {
  const to = toE164(input.to);
  if (!to) return { ok: false, reason: "invalid-number" };
  const body = clip(input.body, SMS_MAX);
  // THE LEAD CENTER TEST ENVIRONMENT (lib/leadCenter/sandbox, 2026-10-29): recorded on the Lead Center, never sent,
  // no SmsMessage row (it would count against the company's allowance).
  const capture = activeCapture();
  if (capture) {
    await capture.record({ channel: "sms", to, body, what: input.kind, note: input.organizationId ? "From the company's number" : "From JobFlex's number" });
    return { ok: true, id: "lead-test:captured", status: "SKIPPED", why: "test-environment" };
  }
  try {
    if (await db.smsOptOut.findUnique({ where: { phone: to }, select: { phone: true } })) return { ok: false, reason: "opted-out" };
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
    const dup = await db.smsMessage.findFirst({ where: { to, body, direction: "OUT", createdAt: { gte: since } }, select: { id: true } });
    if (dup) return { ok: false, reason: "duplicate" };
  } catch (err) {
    console.error(`[sms] pre-send check failed: ${msg(err)}`);
    return { ok: false, reason: "failed" };
  }
  if (input.sendAfter && input.sendAfter.getTime() > Date.now()) {
    const row = await db.smsMessage.create({
      data: { organizationId: input.organizationId, direction: "OUT", to, body, kind: input.kind, status: "HELD", sendAfter: input.sendAfter },
    });
    return { ok: true, id: row.id, status: "HELD" };
  }
  return dispatch({ organizationId: input.organizationId, to, body, kind: input.kind });
}

async function dispatch(m: { organizationId: string | null; to: string; body: string; kind: string }): Promise<SendTextResult> {
  // The card-less trial sends nothing but the verification code (lib/trialMeter):
  // a SKIPPED row says so, and the per-number allowance is not spent on it.
  // A held text is checked here too, when the morning sends it.
  if (await trialBlocksText(m.organizationId, m.kind).catch(() => true)) {
    await capped(m, "trial");
    return { ok: false, reason: "trial" };
  }
  // Which number: the company's own, once Twilio approved it (registration.ts
  // sets smsFromNumber then). There is no JobFlex number to fall back on —
  // except for JobFlex's own company (houseLine.ts), which IS the business the
  // JobFlex number is registered to. The
  // company's number texts its team, and anyone else only after they said yes
  // on the booking page (consent.ts): the opt-in its registration was approved
  // on. The answer to HELP always goes. Asked before the caps, so a text that
  // may not go spends none.
  let own: string | null = null;
  try {
    const jobflexOwn = !m.organizationId && m.kind.startsWith("jobflex-");
    const org = !jobflexOwn && m.organizationId ? await db.organization.findUnique({ where: { id: m.organizationId }, select: { smsFromNumber: true } }) : null;
    own = jobflexOwn ? await jobflexSender() : org?.smsFromNumber ?? (m.organizationId ? await houseLineFor(m.organizationId) : null);
    // A company whose plan has ended sends nothing from its own number
    // (2026-10-12, money audit P1-8): every text costs JobFlex money.
    if (!jobflexOwn && m.organizationId && own && !(await orgMayText(m.organizationId))) {
      await db.smsMessage.create({ data: { organizationId: m.organizationId, direction: "OUT", to: m.to, body: m.body, kind: m.kind, status: "SKIPPED", error: "plan-ended" } }).catch(() => null);
      return { ok: false, reason: "plan-ended" };
    }
    // The month's allowance is used: a soft stop, nothing billed (2026-10-26). JobFlex's own texts — billing,
    // codes, HELP — always go (format isSystemText).
    if (!jobflexOwn && m.organizationId && own && !isSystemText(m.kind) && (await smsAllowanceUsed(m.organizationId))) {
      await db.smsMessage.create({ data: { organizationId: m.organizationId, direction: "OUT", to: m.to, body: m.body, kind: m.kind, status: "SKIPPED", error: "allowance" } }).catch(() => null);
      return { ok: false, reason: "allowance" };
    }
    let blocked: string | null = null;
    if (!own) blocked = "no-number";
    else if (!jobflexOwn && m.kind !== "help" && m.organizationId && !(await isTeamPhone(m.organizationId, m.to)) && !(await hasTextConsent(m.organizationId, m.to))) blocked = "no-consent";
    if (blocked) {
      const skipped = await db.smsMessage.create({ data: { organizationId: m.organizationId, direction: "OUT", to: m.to, body: m.body, kind: m.kind, status: "SKIPPED", error: blocked } });
      return { ok: true, id: skipped.id, status: "SKIPPED", why: blocked };
    }
  } catch (err) {
    console.error(`[sms] sender check failed, text not sent: ${msg(err)}`);
    return { ok: false, reason: "failed" };
  }
  // Caps, fail-closed: a limiter that cannot answer pauses texting.
  try {
    const perNumber = await rateLimitShared(`sms:to:${m.to}`, CAP_PER_NUMBER_PER_DAY, DAY);
    if (!perNumber.ok) return capped(m, "number");
    if (m.organizationId) {
      const perOrg = await rateLimitShared(`sms:org:${m.organizationId}`, CAP_PER_ORG_PER_DAY, DAY);
      if (!perOrg.ok) return capped(m, "company");
    }
    const all = await rateLimitShared("sms:all", CAP_PLATFORM_PER_DAY, DAY);
    if (!all.ok) return capped(m, "platform");
  } catch (err) {
    console.error(`[sms] limiter down, text not sent: ${msg(err)}`);
    return { ok: false, reason: "limiter-down" };
  }
  const row = await db.smsMessage.create({ data: { organizationId: m.organizationId, direction: "OUT", to: m.to, body: m.body, kind: m.kind, status: "QUEUED" } });
  if (!await isTwilioEnabled()) {
    await db.smsMessage.update({ where: { id: row.id }, data: { status: "SKIPPED", error: "not-configured" } });
    return { ok: true, id: row.id, status: "SKIPPED", why: "not-configured" };
  }
  try {
    const statusCallback = `${await appBaseUrl()}/api/twilio/sms/status`;
    const r = await sendSMS(m.to, m.body, { statusCallback, from: own });
    await db.smsMessage.update({ where: { id: row.id }, data: { status: "SENT", sid: r.skipped ? null : r.sid } });
    return { ok: true, id: row.id, status: "SENT" };
  } catch (err) {
    await db.smsMessage.update({ where: { id: row.id }, data: { status: "FAILED", error: msg(err).slice(0, 200) } }).catch(() => null);
    console.error(`[sms] send failed (${m.kind} → …${m.to.slice(-4)}): ${msg(err)}`);
    return { ok: false, reason: "failed" };
  }
}

async function capped(m: { organizationId: string | null; to: string; body: string; kind: string }, which: string): Promise<SendTextResult> {
  await db.smsMessage
    .create({ data: { organizationId: m.organizationId, direction: "OUT", to: m.to, body: m.body, kind: m.kind, status: "SKIPPED", error: `cap-${which}` } })
    .catch(() => null);
  console.warn(`[sms] ${which} cap reached, text skipped (${m.kind})`);
  return { ok: false, reason: "cap" };
}

/** The company's texts this calendar month (UTC) — the count Settings and Subscription show — against its plan's allowance. */
export async function smsAllowanceUsed(organizationId: string): Promise<boolean> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [tier, sent] = await Promise.all([
    getOrgPlanById(organizationId),
    db.smsMessage.count({ where: { organizationId, direction: "OUT", status: { in: ["SENT", "DELIVERED", "QUEUED"] }, createdAt: { gte: monthStart } } }),
  ]);
  return sent >= smsAllowanceFor(tier);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── the office ────────────────────────────────────────────────────────────

export type OfficeTextOptions = {
  /** Default: owner + admin + manager. An empty list: nobody by role. */
  roles?: readonly string[];
  /** Members texted whatever their role — the rep whose proposal it is, the
   *  one who booked the visit — through their own Text cells (2026-09-29). */
  alsoUserIds?: readonly (string | null | undefined)[];
  /** Members who must not get it (the actor, the worker who answered). */
  excludeUserIds?: readonly string[];
  now?: Date;
};

/**
 * One line to every office member who wants this event by text — through
 * their own Text cell and quiet hours — plus the company's extra numbers
 * (every office event, the company's default quiet hours). The company's
 * name leads the text; numbers are deduped.
 */
export async function textOffice(organizationId: string, key: PrefKey, line: string, opts: OfficeTextOptions = {}): Promise<{ sent: number; held: number }> {
  const now = opts.now ?? new Date();
  const roles = opts.roles ?? OFFICE_ROLES;
  const also = [...new Set((opts.alsoUserIds ?? []).filter((x): x is string => Boolean(x)))];
  const exclude = new Set(opts.excludeUserIds ?? []);
  let sent = 0;
  let held = 0;
  try {
    const [org, members, extras] = await Promise.all([
      db.organization.findUnique({ where: { id: organizationId }, select: { name: true, timezone: true } }),
      db.membership.findMany({
        where: { organizationId, OR: [{ role: { in: [...roles] } }, ...(also.length ? [{ userId: { in: also } }] : [])] },
        select: { role: true, user: { select: { id: true, smsPhone: true, smsVerifiedAt: true, notificationPrefsJson: true } } },
      }),
      db.notificationPhone.findMany({ where: { organizationId, active: true }, select: { phone: true } }),
    ]);
    if (!org) return { sent, held };
    const tz = org.timezone || "America/New_York";
    const body = brand(org.name, line);
    const seen = new Set<string>();
    const go = async (to: string, sendAfter: Date | null) => {
      const r = await sendText({ organizationId, to, body, kind: key, sendAfter });
      if (r.ok && r.status === "HELD") held++;
      else if (r.ok) sent++;
    };
    for (const m of members) {
      const u = m.user;
      if (!u?.smsPhone || !u.smsVerifiedAt || exclude.has(u.id)) continue;
      // A member only ever hears the events their own roster lists: a crew
      // member staffed on a visit gets the crew's text, not the office's.
      const audience = audienceForRole(m.role);
      if (!audience || !textEventsFor(audience).some((e) => e.key === key)) continue;
      const to = toE164(u.smsPhone);
      if (!to || seen.has(to)) continue;
      const prefs = parseNotificationPrefs(u.notificationPrefsJson, m.role);
      // Texts to this member switched off on Settings → Texting (2026-10-13): their number and choices wait.
      if (prefs.smsPaused) continue;
      const decision = smsDecision(prefs, key, now, tz);
      if (decision === "skip") continue;
      seen.add(to);
      await go(to, decision === "hold" ? nextQuietEnd(prefs, now, tz) : null);
    }
    const defaults = defaultNotificationPrefs();
    for (const x of extras) {
      const to = toE164(x.phone);
      if (!to || seen.has(to)) continue;
      seen.add(to);
      const hold = !SMS_URGENT_KEYS.includes(key) && inQuietHours(defaults, now, tz);
      await go(to, hold ? nextQuietEnd(defaults, now, tz) : null);
    }
  } catch (err) {
    console.error(`[sms] office text "${key}" failed: ${msg(err)}`);
  }
  return { sent, held };
}

/**
 * A text to every office number right now, no preference gate — a reply
 * from the field is forwarded whatever the hour.
 */
export async function textOfficeNow(organizationId: string, line: string, opts: { excludePhones?: readonly string[]; kind?: string } = {}): Promise<number> {
  let sent = 0;
  try {
    const [org, members, extras] = await Promise.all([
      db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      db.membership.findMany({ where: { organizationId, role: { in: [...OFFICE_ROLES] } }, select: { user: { select: { smsPhone: true, smsVerifiedAt: true, notificationPrefsJson: true } } } }),
      db.notificationPhone.findMany({ where: { organizationId, active: true }, select: { phone: true } }),
    ]);
    const skip = new Set((opts.excludePhones ?? []).map((p) => toE164(p)).filter(Boolean));
    const seen = new Set<string>();
    const body = brand(org?.name, line);
    // A member whose texts are switched off gets no forwards either (2026-10-13).
    const numbers = [...members.map((m) => (m.user?.smsVerifiedAt && !parseNotificationPrefs(m.user.notificationPrefsJson).smsPaused ? m.user.smsPhone : null)), ...extras.map((x) => x.phone)];
    for (const raw of numbers) {
      const to = toE164(raw);
      if (!to || seen.has(to) || skip.has(to)) continue;
      seen.add(to);
      const r = await sendText({ organizationId, to, body, kind: opts.kind ?? "reply" });
      if (r.ok) sent++;
    }
  } catch (err) {
    console.error(`[sms] office forward failed: ${msg(err)}`);
  }
  return sent;
}

// ── a worker ──────────────────────────────────────────────────────────────

export type WorkerLike = { phone: string | null; smsOptIn: boolean; organizationId: string; user?: { notificationPrefsJson: string | null } | null };

/** A text to one worker who has a phone and the schedule switch on — and,
 *  when the text has a key, that switch on in their own Text cells
 *  (Settings → Texting, 2026-09-29). */
export async function textWorker(w: WorkerLike, body: string, kind: string, key?: PrefKey): Promise<SendTextResult | null> {
  if (!w.phone || !w.smsOptIn) return null;
  if (key && !allowsSms(parseNotificationPrefs(w.user?.notificationPrefsJson ?? null, "INSTALLER"), key)) return null;
  return sendText({ organizationId: w.organizationId, to: w.phone, body, kind });
}

// ── the morning after ─────────────────────────────────────────────────────

/**
 * Texts held through the quiet hours go out now, one message per number:
 * a single held text as it was, several folded into one "overnight" line.
 * The held rows are marked MERGED; the text that went out is its own row.
 */
export async function flushHeldTexts(now = new Date()): Promise<number> {
  const due = await db.smsMessage.findMany({
    where: { status: "HELD", sendAfter: { lte: now } },
    orderBy: { createdAt: "asc" },
    select: { id: true, organizationId: true, to: true, body: true, kind: true },
  });
  if (!due.length) return 0;
  const orgIds = [...new Set(due.map((r) => r.organizationId).filter((x): x is string => Boolean(x)))];
  const orgs = new Map((await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
  const groups = new Map<string, typeof due>();
  for (const r of due) {
    // A company's own text (kind "rule:…") stands alone: it may be for a client.
    const k = r.kind?.startsWith("rule:") ? `rule|${r.id}` : `${r.organizationId ?? "-"}|${r.to}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  let out = 0;
  for (const rows of groups.values()) {
    const orgName = rows[0].organizationId ? (orgs.get(rows[0].organizationId) ?? null) : null;
    // JobFlex's own texts (the team's alerts, no company) fold into one roundup and keep their "jobflex-" kind — the
    // kind is what lets them leave from JobFlex's number at all (dispatch).
    const jobflex = !rows[0].organizationId && rows.every((r) => r.kind?.startsWith("jobflex-"));
    const body = rows.length === 1 ? rows[0].body : jobflex ? jobflexRoundupText(rows.map((r) => r.body)) : heldDigestText(orgName, rows.map((r) => unbrand(orgName, r.body)));
    await db.smsMessage.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "MERGED" } });
    const r = await dispatch({ organizationId: rows[0].organizationId, to: rows[0].to, body, kind: rows.length === 1 ? (rows[0].kind ?? "held") : jobflex ? "jobflex-overnight" : "overnight" });
    if (r.ok) out++;
  }
  return out;
}
