// LEAD ALERTS (2026-10-03) — who hears that a homeowner request needs a
// person, and when. Server only.
//
// Owner, launching the homeowner portal with ads: "if any lead comes in, email
// the admins that it came into the Lead Center and say take an action — and
// text the admins; we will set up which phone numbers. Make it smart." Manual
// routing is the default (routingMode.ts), so a request that nobody notices is
// a homeowner who never hears from a contractor.
//
// What alerts:
//   new       every real request, the moment it lands (intake → notify.ts
//             notifyAdminNewLeadRequest), saying whether it waits for a person
//             or was offered to a shop automatically.
//   back      a request returns to the queue — the homeowner asked for another
//             contractor, a shop passed, an offer's 24 hours ran out, the
//             automatic pool ran dry (cascade.ts parkInManualQueue).
//   reminder  still in the queue after the reminder delay: once per stay, all
//             of them folded into one email and one text (the 15-minute
//             lead-offers cron).
//   morning   a phone with quiet nights gets no text 9 PM–7 AM on the page's
//             clock; at 7 AM, one summary of whatever is still waiting.
// Test leads never alert — they rehearse the routing (testLeads.ts); "Send a
// test alert" on the page rehearses the alert itself.
//
// Email always goes: to the page's addresses, else SUPPORT_NOTIFY_EMAIL, else
// support@jobflex.app. Texts go only to numbers confirmed with a code, and only
// while the page's texting switch is on: they leave from JobFlex's own number
// (send.ts → jobflexSender.ts), whose Twilio application describes lead texts
// to subscribing shops, not texts to JobFlex's own team — so the switch starts
// off and turning it on is the owner's call. Until Twilio approves that number
// a text is a SKIPPED row "no-number", and the page says so.
//
// Everything lives in SyncState — the settings as one JSON row, a marker per
// waiting request, one per morning — so this is a code change, no migration.

import { createHash, randomInt } from "node:crypto";
import { guessTrade } from "@/lib/tradeGuess";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { sendEmail } from "@/lib/sdk/resend";
import { renderEmail } from "@/lib/email/renderEmail";
import type { EmailDoc } from "@/lib/email/doc";
import { buildAdminLeadsWaiting, buildAdminNewLead } from "@/lib/email/build/operator";
import { sendText, type SendTextResult } from "@/lib/sms/send";
import { clip, SMS_MAX } from "@/lib/sms/format";
import { checkVerifyCode, sendVerifyCode } from "@/lib/sms/verify";

// ── settings ──────────────────────────────────────────────────────────────

export type AlertPhone = {
  id: string;
  name: string;
  /** E.164. */
  phone: string;
  /** Set when the code texted to it came back; an unconfirmed number gets nothing. */
  verifiedAt: string | null;
  on: boolean;
  /** No texts 9 PM–7 AM on the page's clock; a 7 AM summary instead. */
  quietNights: boolean;
};

export type LeadAlertSettings = {
  /** The alert email's addresses; empty = SUPPORT_NOTIFY_EMAIL, else support@jobflex.app. */
  emails: string[];
  phones: AlertPhone[];
  /** Texts at all (see the header). Off until an admin turns it on. */
  textsOn: boolean;
  /** Remind once a request has waited this long in the queue; 0 = never. */
  remindAfterMin: number;
  /** The clock quiet nights and the morning summary keep. */
  timeZone: string;
};

export const REMIND_CHOICES = [0, 30, 60, 120, 240] as const;
export const ALERT_TIME_ZONES = [
  ["America/Los_Angeles", "Pacific"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Chicago", "Central"],
  ["America/New_York", "Eastern"],
] as const;
export const MAX_ALERT_PHONES = 10;
export const MAX_ALERT_EMAILS = 10;

const DEFAULTS: LeadAlertSettings = { emails: [], phones: [], textsOn: false, remindAfterMin: 60, timeZone: "America/Los_Angeles" };
const SETTINGS_KEY = "leadAlerts:settings:v1";
const LEAD_PREFIX = "leadAlerts:lead:";
const MORNING_PREFIX = "leadAlerts:morning:";
const CODE_PREFIX = "leadAlerts:code:";
const QUIET_FROM = 21;
const QUIET_TO = 7;
/** 7–10 AM: a cron run that misses 7:00 still sends the morning summary. */
const MORNING_WINDOW_H = 3;

function parseSettings(raw: string | null | undefined): LeadAlertSettings {
  if (!raw) return { ...DEFAULTS };
  try {
    const j = JSON.parse(raw) as Partial<LeadAlertSettings>;
    const phones = (Array.isArray(j.phones) ? j.phones : [])
      .filter((p): p is AlertPhone => Boolean(p) && typeof p.id === "string" && typeof p.phone === "string")
      .slice(0, MAX_ALERT_PHONES)
      .map((p) => ({
        id: p.id,
        name: typeof p.name === "string" ? p.name.slice(0, 60) : "",
        phone: p.phone,
        verifiedAt: typeof p.verifiedAt === "string" ? p.verifiedAt : null,
        on: p.on !== false,
        quietNights: p.quietNights !== false,
      }));
    return {
      emails: (Array.isArray(j.emails) ? j.emails : []).filter((e): e is string => typeof e === "string" && e.includes("@")).slice(0, MAX_ALERT_EMAILS),
      phones,
      textsOn: j.textsOn === true,
      remindAfterMin: (REMIND_CHOICES as readonly number[]).includes(Number(j.remindAfterMin)) ? Number(j.remindAfterMin) : DEFAULTS.remindAfterMin,
      timeZone: ALERT_TIME_ZONES.some(([z]) => z === j.timeZone) ? (j.timeZone as string) : DEFAULTS.timeZone,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function readLeadAlertSettings(): Promise<LeadAlertSettings> {
  const row = await db.syncState.findUnique({ where: { key: SETTINGS_KEY } }).catch(() => null);
  return parseSettings(row?.cursor);
}

export async function writeLeadAlertSettings(next: LeadAlertSettings): Promise<void> {
  const cursor = JSON.stringify(parseSettings(JSON.stringify(next)));
  await db.syncState.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, cursor }, update: { cursor } });
}

/** support@jobflex.app unless SUPPORT_NOTIFY_EMAIL says otherwise. */
export function fallbackAlertEmails(): string[] {
  return (process.env.SUPPORT_NOTIFY_EMAIL?.trim() || "support@jobflex.app")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Where the alert email goes. A `.local` address is the admin console's
 *  synthetic login, not a mailbox (notify.ts `undeliverable`). */
export function alertEmailsFor(settings: LeadAlertSettings): string[] {
  return (settings.emails.length ? settings.emails : fallbackAlertEmails()).filter((e) => !/@[^@]*\.local$/i.test(e.trim()));
}

// ── clocks ────────────────────────────────────────────────────────────────

function localHour(tz: string, now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now)) % 24;
}

function localDay(tz: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isQuietHour(tz: string, now = new Date()): boolean {
  const h = localHour(tz, now);
  return h >= QUIET_FROM || h < QUIET_TO;
}

/** "35 min", "2 h", "3 days". */
export function waitedWords(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

/** Confirmed, switched-on phones — none while texting is off. */
function livePhones(s: LeadAlertSettings): AlertPhone[] {
  return s.textsOn ? s.phones.filter((p) => p.on && p.verifiedAt) : [];
}

/** The phones a text may go to right now (quiet nights keep theirs till 7 AM). */
function phonesNow(s: LeadAlertSettings, now: Date): AlertPhone[] {
  const quiet = isQuietHour(s.timeZone, now);
  return livePhones(s).filter((p) => !(p.quietNights && quiet));
}

// ── the request ───────────────────────────────────────────────────────────

const LEAD_INCLUDE = { offers: { orderBy: { createdAt: "desc" as const }, include: { organization: { select: { name: true } } } } };
type LoadedLead = NonNullable<Awaited<ReturnType<typeof loadLead>>>;

function loadLead(id: string) {
  return db.platformLead.findUnique({ where: { id }, include: LEAD_INCLUDE });
}

type Facts = { trade: string | null; where: string; firstName: string | null; scope: string; ref: string };

function factsOf(pl: { id: string; detectedTrade: string | null; projectType: string | null; city: string | null; state: string | null; zip: string | null; name: string; scope: string | null; description: string | null }): Facts {
  return {
    // Unclassified for routing, but the admin sees what it reads like (lib/tradeGuess, 2026-10-14) — the "?" says it is a guess.
    trade: pl.detectedTrade ?? pl.projectType ?? (guessTrade(pl.description) ? `${guessTrade(pl.description)}?` : null),
    where: [pl.city, pl.state].filter(Boolean).join(", ") || pl.zip || "no location",
    firstName: (pl.name || "").trim().split(/\s+/)[0] || null,
    scope: pl.scope ?? pl.description ?? "",
    ref: "#LD-" + pl.id.slice(-4).toUpperCase(),
  };
}

/** "roofing request in Bothell, WA". */
function requestWords(f: Pick<Facts, "trade" | "where">): string {
  return `${f.trade ? f.trade.toLowerCase() : "new"} request in ${f.where}`;
}

/** "roofing Bothell (2 h)" — one entry of a folded text. */
function shortEntry(f: Pick<Facts, "trade" | "where">, waited: string): string {
  return `${f.trade ? f.trade.toLowerCase() : "request"} ${f.where.split(",")[0]} (${waited})`;
}

async function leadHref(id: string): Promise<string> {
  return `${await appBaseUrl()}/admin/lead-center?lead=${encodeURIComponent(id)}`;
}

async function centerHref(): Promise<string> {
  return `${await appBaseUrl()}/admin/lead-center`;
}

function waitingCount(): Promise<number> {
  return db.platformLead.count({ where: { status: "MANUAL_QUEUE", isTest: false } }).catch(() => 0);
}

// A marker per request in the queue: when its current wait began, and
// whether it has been reminded. The sweep deletes the markers of requests
// that left the queue, so nothing accumulates.
type Marker = { since: string; reminded: boolean };
const leadKey = (id: string) => `${LEAD_PREFIX}${id}`;

function parseMarker(raw: string): Marker | null {
  try {
    const m = JSON.parse(raw) as Partial<Marker>;
    return typeof m.since === "string" ? { since: m.since, reminded: m.reminded === true } : null;
  } catch {
    return null;
  }
}

async function setMarker(id: string, m: Marker): Promise<void> {
  const cursor = JSON.stringify(m);
  await db.syncState.upsert({ where: { key: leadKey(id) }, create: { key: leadKey(id), cursor }, update: { cursor } }).catch(() => null);
}

// ── sending ───────────────────────────────────────────────────────────────

async function emailAll(to: string[], doc: EmailDoc): Promise<number> {
  if (!to.length) return 0;
  const { subject, html } = renderEmail(doc);
  let delivered = 0;
  for (const address of to) {
    try {
      await sendEmail({ mailClass: "transactional", to: address, subject, html });
      delivered += 1;
    } catch (err) {
      console.error(`[lead-alerts] email to ${address} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return delivered;
}

/** The words cut to fit, the link whole at the end — a clipped link is a dead one. */
function withLink(words: string, link: string): string {
  return `${clip(words, SMS_MAX - link.length - 1)} ${link}`;
}

/** Kinds start "jobflex-": send.ts sends those from JobFlex's own number. */
async function textAll(phones: AlertPhone[], body: string, kind: string): Promise<Array<{ phone: AlertPhone; result: SendTextResult }>> {
  const out: Array<{ phone: AlertPhone; result: SendTextResult }> = [];
  for (const phone of phones) out.push({ phone, result: await sendText({ organizationId: null, to: phone.phone, body, kind }) });
  return out;
}

export type AlertOutcome = { skipped: true } | { skipped: false; emailed: number; texted: number };

// ── new ───────────────────────────────────────────────────────────────────

/** Why a brand-new request waits, when it is more than manual mode (cascade.ts, intake.ts). */
function queuedWhy(reason: string | null): string | null {
  const r = (reason ?? "").trim();
  if (!r || r.startsWith("MANUAL_MODE")) return null;
  if (r.startsWith("NO_CANDIDATES")) return "No shop on JobFlex covers this trade and area yet.";
  if (r.startsWith("TRADE_UNDETERMINED")) return "The trade couldn't be worked out from what the homeowner wrote.";
  const said = r.includes(": ") ? r.slice(r.indexOf(": ") + 2).trim() : "";
  return said ? `${said.replace(/\.$/, "")}.` : null;
}

/** Every real request, once, right after the intake routed it. */
export async function alertNewRequest(platformLeadId: string, now = new Date()): Promise<AlertOutcome> {
  const pl = await loadLead(platformLeadId);
  if (!pl || pl.isTest) return { skipped: true };
  const settings = await readLeadAlertSettings();
  const f = factsOf(pl);
  const queued = pl.status === "MANUAL_QUEUE";
  if (queued) await setMarker(pl.id, { since: pl.createdAt.toISOString(), reminded: false });
  const waiting = queued ? await waitingCount() : 0;
  const offeredTo = pl.status === "OFFERED" ? (pl.offers.find((o) => o.status === "OFFERED")?.organization.name ?? null) : null;
  const href = await leadHref(pl.id);
  const note = queued ? queuedWhy(pl.queueReason) : offeredTo ? `Offered to ${offeredTo} automatically.` : "Being matched with a shop now.";
  const emailed = await emailAll(
    alertEmailsFor(settings),
    buildAdminNewLead({ ...f, queued, href, event: "new", note, waiting }),
  );
  const text = withLink(
    queued
      ? `JobFlex: new ${requestWords(f)} — waiting for you to place it.${waiting > 1 ? ` ${waiting} in the queue.` : ""}`
      : offeredTo
        ? `JobFlex: new ${requestWords(f)} — offered to ${offeredTo} automatically.`
        : `JobFlex: new ${requestWords(f)} — being matched with a shop now.`,
    href,
  );
  const texted = await textAll(phonesNow(settings, now), text, "jobflex-admin-lead");
  return { skipped: false, emailed, texted: texted.length };
}

// ── back in the queue ─────────────────────────────────────────────────────

/** Why the request came back, from the offer that just ended. */
function backReason(pl: LoadedLead, f: Facts): string {
  const at = (o: LoadedLead["offers"][number]) => (o.respondedAt ?? (o.status === "EXPIRED" ? o.expiresAt : o.createdAt)).getTime();
  const last = [...pl.offers].filter((o) => o.status !== "OFFERED").sort((a, b) => at(b) - at(a))[0];
  const org = last?.organization.name ?? "The shop";
  switch (last?.status) {
    case "REJECTED_BY_CLIENT":
      return `${f.firstName ?? "The homeowner"} asked for another contractor instead of ${org}${last.declineReason ? `: “${clip(last.declineReason, 80)}”` : ""}`;
    case "DECLINED":
      return `${org} passed on it`;
    case "EXPIRED":
      return `${org} didn't answer within 24 hours`;
    default:
      return "No shop is left to offer it to";
  }
}

/** A request that had been offered or matched is back in the queue. */
export async function alertBackInQueue(platformLeadId: string, now = new Date()): Promise<AlertOutcome> {
  const pl = await loadLead(platformLeadId);
  // No offers yet = the intake parking a brand-new request; alertNewRequest has it.
  if (!pl || pl.isTest || pl.status !== "MANUAL_QUEUE" || pl.offers.length === 0) return { skipped: true };
  const settings = await readLeadAlertSettings();
  const f = factsOf(pl);
  await setMarker(pl.id, { since: now.toISOString(), reminded: false });
  const reason = backReason(pl, f);
  const waiting = await waitingCount();
  const href = await leadHref(pl.id);
  const emailed = await emailAll(
    alertEmailsFor(settings),
    buildAdminNewLead({ ...f, queued: true, href, event: "back", note: `${reason}.`, waiting }),
  );
  const texted = await textAll(phonesNow(settings, now), withLink(`JobFlex: ${reason} — the ${requestWords(f)} is back in the queue. Place it:`, href), "jobflex-admin-lead");
  return { skipped: false, emailed, texted: texted.length };
}

// ── the sweep: reminders and the morning summary ──────────────────────────

/** Every 15 minutes (cron lead-offers). Never throws. */
export async function runLeadAlertSweep(now = new Date()): Promise<{ reminded: number; morning: number }> {
  let reminded = 0;
  let morning = 0;
  try {
    const settings = await readLeadAlertSettings();
    const queued = await db.platformLead.findMany({
      where: { status: "MANUAL_QUEUE", isTest: false },
      orderBy: { createdAt: "asc" },
      take: 300,
      select: { id: true, detectedTrade: true, projectType: true, city: true, state: true, zip: true, name: true, scope: true, description: true, createdAt: true },
    });
    const keys = queued.map((q) => leadKey(q.id));
    const markers = new Map(
      (keys.length ? await db.syncState.findMany({ where: { key: { in: keys } } }) : []).map((r) => [r.key, parseMarker(r.cursor)] as const),
    );

    const overdue: Array<{ q: (typeof queued)[number]; since: Date }> = [];
    const waits = new Map<string, number>();
    for (const q of queued) {
      const m = markers.get(leadKey(q.id));
      // Waiting since before alerts existed (or parked by a path that does
      // not alert): the clock starts now, so it is reminded once, later.
      if (!m) {
        await setMarker(q.id, { since: now.toISOString(), reminded: false });
        waits.set(q.id, now.getTime() - q.createdAt.getTime());
        continue;
      }
      const since = new Date(m.since);
      waits.set(q.id, now.getTime() - Math.min(since.getTime(), now.getTime()));
      if (settings.remindAfterMin > 0 && !m.reminded && now.getTime() - since.getTime() >= settings.remindAfterMin * 60_000) overdue.push({ q, since });
    }

    if (overdue.length) {
      // Claimed before sending, so an overlapping run cannot remind twice.
      for (const o of overdue) await setMarker(o.q.id, { since: o.since.toISOString(), reminded: true });
      const items = overdue.map((o) => ({ f: factsOf(o.q), waited: waitedWords(now.getTime() - o.since.getTime()), id: o.q.id }));
      await emailAll(alertEmailsFor(settings), buildAdminLeadsWaiting({ leads: items.map((x) => ({ trade: x.f.trade, where: x.f.where, waited: x.waited })), href: await centerHref() }));
      const text =
        items.length === 1
          ? withLink(`JobFlex: still waiting ${items[0].waited} — the ${requestWords(items[0].f)} has no contractor yet.`, await leadHref(items[0].id))
          : withLink(`JobFlex: ${items.length} requests still waiting — ${items.slice(0, 3).map((x) => shortEntry(x.f, x.waited)).join(", ")}${items.length > 3 ? ` +${items.length - 3} more` : ""}.`, await centerHref());
      await textAll(phonesNow(settings, now), text, "jobflex-admin-reminder");
      reminded = overdue.length;
    }

    // The morning summary, to the phones that kept quiet overnight.
    const sleepers = livePhones(settings).filter((p) => p.quietNights);
    const hour = localHour(settings.timeZone, now);
    const day = localDay(settings.timeZone, now);
    const morningKey = `${MORNING_PREFIX}${day}`;
    if (sleepers.length && queued.length && hour >= QUIET_TO && hour < QUIET_TO + MORNING_WINDOW_H && !(await db.syncState.findUnique({ where: { key: morningKey } }))) {
      // Claimed by creating the day's row: of two overlapping runs, one wins.
      let claimed = false;
      try {
        await db.syncState.create({ data: { key: morningKey, cursor: now.toISOString() } });
        claimed = true;
      } catch {
        claimed = false;
      }
      if (claimed) {
        const list = queued.slice(0, 3).map((q) => shortEntry(factsOf(q), waitedWords(waits.get(q.id) ?? 0)));
        const n = queued.length;
        await textAll(
          sleepers,
          withLink(`JobFlex — good morning: ${n} request${n === 1 ? "" : "s"} waiting in the Lead Center — ${list.join(", ")}${n > 3 ? ` +${n - 3} more` : ""}.`, await centerHref()),
          "jobflex-admin-morning",
        );
        morning = sleepers.length;
      }
    }

    // Markers of requests that left the queue; mornings other than today.
    await db.syncState.deleteMany({ where: { AND: [{ key: { startsWith: LEAD_PREFIX } }, { key: { notIn: keys } }] } }).catch(() => null);
    await db.syncState.deleteMany({ where: { AND: [{ key: { startsWith: MORNING_PREFIX } }, { key: { not: morningKey } }] } }).catch(() => null);
  } catch (err) {
    console.error("[lead-alerts] sweep failed:", err instanceof Error ? err.message : err);
  }
  return { reminded, morning };
}

// ── the page's test ───────────────────────────────────────────────────────

export type TestAlertReport = {
  emails: string[];
  emailed: number;
  textsOn: boolean;
  texts: Array<{ name: string; phone: string; outcome: string }>;
};

/** What a text's result means, in the admin's words. */
export function textOutcomeWords(r: SendTextResult): string {
  if (r.ok && r.status === "SENT") return "sent";
  if (r.ok && r.status === "HELD") return "held for the morning";
  if (r.ok && r.status === "SKIPPED") {
    if (r.why === "no-number") return "not sent — JobFlex's texting number isn't approved by Twilio yet";
    if (r.why === "not-configured") return "not sent — texting isn't set up on this server";
    return `not sent — ${r.why}`;
  }
  if (!r.ok) {
    if (r.reason === "duplicate") return "not sent — the same text went to this phone in the last 10 minutes";
    if (r.reason === "opted-out") return "not sent — this phone replied STOP to JobFlex";
    if (r.reason === "cap") return "not sent — this phone reached today's limit of 25 JobFlex texts";
    return `not sent — ${r.reason}`;
  }
  return "not sent";
}

/** A sample email to every address and a text to every confirmed phone that is on. */
export async function sendTestLeadAlert(): Promise<TestAlertReport> {
  const settings = await readLeadAlertSettings();
  const emails = alertEmailsFor(settings);
  const center = await centerHref();
  const sample = buildAdminNewLead({
    trade: "Roofing",
    where: "Bothell, WA",
    scope: "Full roof replacement — about 24 squares, one layer of asphalt shingles.",
    ref: "#LD-TEST",
    queued: true,
    href: center,
    event: "new",
    note: "This is a test from the Lead alerts page — not a real request. A real alert looks like this.",
    firstName: "Sarah",
    waiting: 1,
  });
  const emailed = await emailAll(emails, { ...sample, subject: "Test — this is how a Lead Center alert looks" });
  const texts = settings.textsOn
    ? (await textAll(settings.phones.filter((p) => p.on && p.verifiedAt), withLink("JobFlex: test alert — this phone gets Lead Center alerts.", center), "jobflex-admin-test")).map((t) => ({
        name: t.phone.name,
        phone: t.phone.phone,
        outcome: textOutcomeWords(t.result),
      }))
    : [];
  return { emails, emailed, textsOn: settings.textsOn, texts };
}

// ── confirming a phone ────────────────────────────────────────────────────
//
// Twilio Verify texts the code (verify.ts); a server with no Twilio (a local
// copy) keeps its own code, in the server log and only there, like
// actions/sms.ts does for a member's mobile.

const CODE_TTL_MS = 10 * 60_000;
const CODE_TRIES = 5;
type LocalCode = { hash: string; expiresAt: string; attempts: number };
const hashCode = (code: string, phone: string) => createHash("sha256").update(`${phone}:${code}`).digest("hex");

/** `via: "log"` — no Twilio here; the code is in the server log. */
export async function sendAlertPhoneCode(phone: string): Promise<{ ok: true; via: "twilio" | "log" } | { ok: false; error: string }> {
  await db.syncState.delete({ where: { key: `${CODE_PREFIX}${phone}` } }).catch(() => null);
  const sent = await sendVerifyCode(phone);
  if (sent.ok) return { ok: true, via: "twilio" };
  if (!sent.notConfigured) return { ok: false, error: `Couldn't send the code: ${sent.error}` };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const local: LocalCode = { hash: hashCode(code, phone), expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(), attempts: 0 };
  await db.syncState.upsert({
    where: { key: `${CODE_PREFIX}${phone}` },
    create: { key: `${CODE_PREFIX}${phone}`, cursor: JSON.stringify(local) },
    update: { cursor: JSON.stringify(local) },
  });
  if (process.env.NODE_ENV !== "production") console.info(`[lead-alerts] verification code for …${phone.slice(-4)}: ${code}`);
  return { ok: true, via: "log" };
}

export async function checkAlertPhoneCode(phone: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = `${CODE_PREFIX}${phone}`;
  const row = await db.syncState.findUnique({ where: { key } }).catch(() => null);
  if (!row) {
    const check = await checkVerifyCode(phone, code);
    if (!check.ok) return { ok: false, error: check.error };
    return check.approved ? { ok: true } : { ok: false, error: "That's not the code." };
  }
  let local: LocalCode;
  try {
    local = JSON.parse(row.cursor) as LocalCode;
  } catch {
    await db.syncState.delete({ where: { key } }).catch(() => null);
    return { ok: false, error: "Ask for a new code." };
  }
  if (new Date(local.expiresAt).getTime() < Date.now() || local.attempts >= CODE_TRIES) {
    await db.syncState.delete({ where: { key } }).catch(() => null);
    return { ok: false, error: "That code expired. Ask for a new one." };
  }
  if (local.hash !== hashCode(code, phone)) {
    await db.syncState.update({ where: { key }, data: { cursor: JSON.stringify({ ...local, attempts: local.attempts + 1 }) } }).catch(() => null);
    return { ok: false, error: `That's not the code. ${CODE_TRIES - local.attempts - 1} tries left.` };
  }
  await db.syncState.delete({ where: { key } }).catch(() => null);
  return { ok: true };
}
