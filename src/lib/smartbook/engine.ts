// SMARTBOOK · THE ENGINE (owner, 2026-10-31: "offer availability by text or email … when customer agrees to the
// schedule, then you let us know … if customer offers his date and time … 'let me check on that, and we'll get back
// to you shortly' … we confirm if we can or not, or we need to reschedule … then you go back to the client") —
// server only.
//
//   startSmartBook   a new lead: the times (lib/smartbook/offers over the desk's hours), the first text and email
//   onCustomerText   the customer's reply: book the pick, ask the company about their own time, offer times that
//                    fit what they said, answer from the desk's facts or pass it on, stop when they say no
//   onContractorText the company's YES / NO / another time to a waiting request, by text
//   decideRequest    the same answer from the app or the request email (Batch 2–3)
//   runSmartBook     the cron: the steps that are due — the morning text, the nudges, the call, the reminders, the
//                    "still checking". Facebook's new leads reach startSmartBook from the Meta sweep (lib/meta/autoImport).
//
// One step at a time per conversation (store withConvLock). The state is saved before anything is sent, so a step
// that fails half-way never sends twice; every message is on the lead's timeline (activityLog SMARTBOOK).
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { toE164 } from "@/lib/phone";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { sendText, textOffice, textOfficeNow } from "@/lib/sms/send";
import { clip, replyForwardLine } from "@/lib/sms/format";
import { hasTextConsent, isTeamPhone, recordTextConsent, type ConsentSource } from "@/lib/sms/consent";
import { leadSourceOf } from "@/lib/leads/sources";
import { markLeadContacted } from "@/lib/leads/contacted";
import { cancelBooking, createBooking, deskAvailabilityFor, emailCustomer, rescheduleBooking, settingsOf } from "@/lib/bookingBook";
import { zonedParts, type BookingService, type BookingSettings, type Slot } from "@/lib/booking";
import { readDeskSettings } from "@/lib/aiDesk/numbers";
import { prettyPhone } from "@/lib/aiDesk/shared";
import { sendToMembersByPref } from "@/lib/notificationPrefs";
import { buildSmartBookRequest } from "@/lib/email/build/operator";
import type { BoxRow } from "@/lib/email/doc";
import { renderEmail } from "@/lib/email/renderEmail";
import { sendEmail } from "@/lib/sdk/resend";
import { businessAfter, isQuiet, nextMorning, nowWords } from "./clock";
import { dayKey, matchesPreference, pickOffers, proposalInstant, quickRead, quickTime, slotAt, type Preference } from "./offers";
import { parseSmartBookSettings, smartBookSettingsKey, sourceAllowed, type SmartBookSettings, type SmartBookSources } from "./settings";
import { convByPhone, convByRequestToken, convByToken, createConv, dropConv, heldFor, hold, indexRequest, isLiveTest, isTestLead, listConvs, newToken, nextRequestNumber, readConv, release, saveConv, sweepHolds, testLeadId, withConvLock, type Conversation, type SmartRequest } from "./store";
import { inLanguage, knowledgeOf, readContractor, readCustomer, type CustomerRead } from "./understand";
import { againText, dayPartWords, emailProse, emailWords, firstNameOf, firstText, say, tell, timesList, visitNoun, whenWords, type CustomerWords, type RequestFacts } from "./words";

const ORG_SELECT = { id: true, name: true, slug: true, timezone: true, logoUrl: true, phone: true, billingEmail: true, gmailSettingsJson: true, gmailTokensJson: true, tradeTypesJson: true, bookingSettingsJson: true, smsFromNumber: true } as const;
const LEAD_SELECT = { id: true, organizationId: true, name: true, email: true, phone: true, address: true, city: true, state: true, zip: true, projectType: true, description: true, source: true, status: true, assignedToId: true, createdAt: true } as const;

type OrgRow = { id: string; name: string | null; slug: string; timezone: string; logoUrl: string | null; phone: string | null; billingEmail: string | null; gmailSettingsJson: string | null; gmailTokensJson: string | null; tradeTypesJson: string | null; bookingSettingsJson: string | null; smsFromNumber: string | null };
type LeadRow = { id: string; organizationId: string; name: string; email: string | null; phone: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; projectType: string | null; description: string | null; source: string | null; status: string; assignedToId: string | null; createdAt: Date };

interface Ctx {
  org: OrgRow;
  lead: LeadRow;
  booking: BookingSettings;
  smart: SmartBookSettings;
  service: BookingService;
  tz: string;
  /** "Send me a test": no lead row — nothing is booked, held, rung or put on a timeline; the tester hears everything. */
  test: boolean;
}

/** The longest a conversation is answered by the model before a person takes it (the spec's "past 12 AI replies"). */
const MAX_TURNS = 12;
/** New conversations a company starts in a day — a runaway import never texts a thousand people. */
const MAX_NEW_PER_DAY = 200;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** "(425) 555-0142" for the company's texts and pages. */
const shown = (phone: string | null) => (phone ? prettyPhone(phone) : null);

// ── settings ────────────────────────────────────────────────────────────────

export async function readSmartBookSettings(organizationId: string): Promise<SmartBookSettings> {
  const row = await db.syncState.findUnique({ where: { key: smartBookSettingsKey(organizationId) }, select: { cursor: true } }).catch(() => null);
  return parseSmartBookSettings(row?.cursor);
}

/** Saved healed; `onSince` is stamped when it goes from off to on. */
export async function saveSmartBookSettings(organizationId: string, next: SmartBookSettings, now = new Date()): Promise<SmartBookSettings> {
  const cur = await readSmartBookSettings(organizationId);
  const healed = parseSmartBookSettings(JSON.stringify({ ...next, onSince: next.on ? (cur.on && cur.onSince ? cur.onSince : now.toISOString()) : cur.onSince }));
  const key = smartBookSettingsKey(organizationId);
  await db.syncState.upsert({ where: { key }, create: { key, cursor: JSON.stringify(healed) }, update: { cursor: JSON.stringify(healed) } });
  return healed;
}

/** Settings' live preview: the times a lead would get now, the words around them, a sample link. */
export interface SmartBookPreview {
  company: string;
  visit: string;
  visitNoun: string;
  free: boolean;
  times: string;
  count: number;
  link: string;
  /** The booking visit types SmartBook may offer, the default first. */
  visits: Array<{ key: string; label: string }>;
  defaultVisit: string | null;
  bookingOn: boolean;
  horizonDays: number;
  textingNumber: boolean;
}

export async function smartBookPreview(organizationId: string, now = new Date()): Promise<SmartBookPreview | null> {
  const [org, smart] = await Promise.all([db.organization.findFirst({ where: { id: organizationId, deletedAt: null }, select: ORG_SELECT }) as Promise<OrgRow | null>, readSmartBookSettings(organizationId)]);
  if (!org) return null;
  const booking = settingsOf(org);
  const service = visitFor(booking, smart.serviceKey);
  const tz = org.timezone || "America/New_York";
  const slots = service && booking.enabled ? (await deskAvailabilityFor(org, service, now)).days.flatMap((d) => d.slots) : [];
  const picks = pickOffers({ slots, count: smart.offers, timeZone: tz });
  return {
    company: org.name?.trim() || "Your company",
    visit: service?.label ?? "Estimate",
    visitNoun: visitNoun(service?.kind ?? "estimate"),
    free: /^free\b/i.test(service?.priceText.trim() ?? ""),
    times: timesList(picks, tz, booking.arrivalWindow),
    count: picks.length,
    link: `${await appBaseUrl()}/b/x7Kp2QmR9a`,
    visits: booking.services.filter((x) => x.kind !== "other" && x.kind !== "emergency").map((x) => ({ key: x.key, label: x.label })),
    defaultVisit: visitFor(booking, null)?.key ?? null,
    bookingOn: booking.enabled,
    horizonDays: booking.horizonDays,
    textingNumber: !!org.smsFromNumber,
  };
}

// ── context ─────────────────────────────────────────────────────────────────

/** The visit SmartBook offers: the one chosen in its settings, else the first estimate (or consult) visit. */
export function visitFor(booking: BookingSettings, key: string | null): BookingService | null {
  const s = booking.services;
  return (key ? s.find((x) => x.key === key) : undefined) ?? s.find((x) => x.kind === "estimate") ?? s.find((x) => x.kind === "consult") ?? s.find((x) => x.kind !== "other") ?? s[0] ?? null;
}

export async function contextOf(organizationId: string, leadId: string): Promise<Ctx | null> {
  const test = isTestLead(leadId);
  const [org, lead, smart] = await Promise.all([
    db.organization.findFirst({ where: { id: organizationId, deletedAt: null }, select: ORG_SELECT }) as Promise<OrgRow | null>,
    test ? testLeadOf(organizationId, leadId) : (db.lead.findFirst({ where: { id: leadId, organizationId }, select: LEAD_SELECT }) as Promise<LeadRow | null>),
    readSmartBookSettings(organizationId),
  ]);
  if (!org || !lead) return null;
  const booking = settingsOf(org);
  const service = visitFor(booking, smart.serviceKey);
  if (!service) return null;
  return { org, lead, booking, smart, service, tz: org.timezone || "America/New_York", test };
}

/** A test's stand-in lead, from its conversation: the tester's name, phone and email. */
async function testLeadOf(organizationId: string, leadId: string): Promise<LeadRow | null> {
  const c = await readConv(organizationId, leadId);
  if (!c) return null;
  return { id: leadId, organizationId, name: c.name, email: c.email, phone: c.phone, address: null, city: null, state: null, zip: null, projectType: null, description: null, source: "FACEBOOK", status: "NEW", assignedToId: null, createdAt: new Date(c.createdAt) };
}

async function openSlots(ctx: Ctx, now: Date): Promise<Slot[]> {
  const { days } = await deskAvailabilityFor(ctx.org, ctx.service, now);
  return days.flatMap((d) => d.slots);
}

const wordsOf = (ctx: Ctx, conv: Conversation): CustomerWords => ({ first: firstNameOf(conv.name), company: ctx.org.name?.trim() || "us" });
export const whenOf = (ctx: Ctx, iso: string) => whenWords(new Date(iso), ctx.tz, ctx.booking.arrivalWindow);
const listOf = (ctx: Ctx, isos: readonly string[]) => timesList(isos.map((x) => ({ startsAt: new Date(x), endsAt: new Date(x) })), ctx.tz, ctx.booking.arrivalWindow);
const addressOf = (lead: LeadRow) => [lead.address, lead.city, [lead.state, lead.zip].filter(Boolean).join(" ")].filter((x) => x && x.trim()).join(", ") || null;
const streetOfLead = (lead: LeadRow) => lead.address?.split(",")[0]?.trim() || null;

export async function pickLink(token: string): Promise<string> {
  return `${await appBaseUrl()}/b/${token}`;
}

// ── sending ─────────────────────────────────────────────────────────────────

async function trail(ctx: Ctx, summary: string, meta: Record<string, unknown>, actorId: string | null = null): Promise<void> {
  if (ctx.test) return;
  await logActivity({ organizationId: ctx.org.id, actorId, kind: TRAIL_KINDS.SMARTBOOK, summary: clip(summary, 480), leadId: ctx.lead.id, meta: { smartbook: true, ...meta } });
  // They answered SmartBook: the lead was reached (lib/leads/contacted, the time only). The AI desk's automatic call
  // to new leads (lib/aiDesk/leadCalls sweepLeadCalls) leaves a reached lead alone.
  if (meta.dir === "in") await markLeadContacted(ctx.org.id, ctx.lead.id).catch(() => null);
}

/**
 * One line to the customer: a text when SmartBook may text them (their yes, the company's number), else the email.
 * A text the company's number may not send (no yes on file, the trial, the month's allowance) goes by email instead;
 * STOP closes the conversation. `noEmail`: the booking machinery already mailed them (the confirmation).
 */
async function toCustomer(ctx: Ctx, conv: Conversation, text: string, opts: { subject: string; noEmail?: boolean }): Promise<"text" | "email" | "none"> {
  const body = await inLanguage(text, conv.lang);
  if (conv.text && conv.phone) {
    const r = await sendText({ organizationId: ctx.org.id, to: conv.phone, body, kind: "smartbook" });
    // Twilio off (the local stand): a SKIPPED row that shows what would go — the conversation carries on as texted.
    if (r.ok && (r.status !== "SKIPPED" || r.why === "not-configured" || r.why === "test-environment")) {
      conv.lastOutAt = new Date().toISOString();
      await trail(ctx, `SmartBook texted ${conv.name}: "${body}"`, { dir: "out", channel: "text", body });
      return "text";
    }
    if (!r.ok && r.reason === "opted-out") {
      conv.status = "closed";
      conv.why = "stopped";
      conv.next = null;
      await trail(ctx, `SmartBook stopped: ${conv.name} replied STOP to texts`, { dir: "none" });
      return "none";
    }
    if (!r.ok && r.reason === "duplicate") return "text";
  }
  if (conv.email && ctx.smart.email && !opts.noEmail) {
    const link = await pickLink(conv.token);
    // Each time is its own row to tap: the pick page opens on it and books it with one more tap (a mail scanner
    // opening links books nothing). The company's other time, the same.
    const choices: BoxRow[] =
      conv.status === "countered" && conv.counter
        ? [{ type: "choice", label: whenOf(ctx, conv.counter), action: "Yes, book it", href: `${link}?t=${Date.parse(conv.counter)}` }]
        : conv.status === "offered"
          ? conv.offers.map((x) => ({ type: "choice" as const, label: whenOf(ctx, x), action: "Book", href: `${link}?t=${Date.parse(x)}` }))
          : [];
    const offerTexts = !conv.text && !!conv.phone && !!ctx.org.smsFromNumber && ctx.smart.text;
    const sent = await emailCustomer(ctx.org, conv.email, {
      subject: opts.subject,
      kicker: { text: "Your visit" },
      headline: opts.subject,
      prose: [conv.status === "offered" && conv.offers.length ? emailProse(body, listOf(ctx, conv.offers)) : emailWords(body)],
      ...(choices.length ? { box: choices } : {}),
      ...(conv.status === "offered" || conv.status === "countered" || conv.status === "asked" ? { cta: { label: conv.status === "asked" ? "See your request" : "See all open times", href: link } } : {}),
      ...(offerTexts ? { after: ["Prefer texts? Open the page and tap \"Text me about this visit\" — answering is quicker that way."] } : {}),
    });
    if (sent) {
      conv.lastOutAt = new Date().toISOString();
      await trail(ctx, `SmartBook emailed ${conv.name}: "${emailWords(body)}"`, { dir: "out", channel: "email", body: emailWords(body) });
      return "email";
    }
  }
  return "none";
}

/** A line to the company: the members who keep SmartBook requests on by text, plus the rep on the lead. */
async function toCompany(ctx: Ctx, line: string, urgent = false): Promise<void> {
  // A test: the person testing is the company too — nobody else on the team hears it.
  if (ctx.test) {
    if (ctx.lead.phone) await sendText({ organizationId: ctx.org.id, to: ctx.lead.phone, body: `(Test) ${line}`, kind: "smartbook-office" });
    return;
  }
  if (urgent) await textOfficeNow(ctx.org.id, line, { kind: "smartbook-office" });
  else await textOffice(ctx.org.id, "smartbook-request", line, { alsoUserIds: [ctx.lead.assignedToId] });
}

/** What the company must act on rings the bell (SMARTBOOK_ASK → the smartbook-request setting). */
async function ring(ctx: Ctx, summary: string, meta: Record<string, unknown> = {}): Promise<void> {
  if (ctx.test) return;
  await logActivity({ organizationId: ctx.org.id, actorId: null, kind: "SMARTBOOK_ASK", summary: clip(summary, 480), leadId: ctx.lead.id, meta: { href: `/dashboard/leads/${ctx.lead.id}`, ...meta } });
}

/** Offered times held from the other leads for two hours (a test holds nothing). */
async function keep(ctx: Ctx, starts: readonly string[], now: Date): Promise<void> {
  if (!ctx.test) await hold(ctx.org.id, ctx.lead.id, starts, now);
}

function scheduleNudge(ctx: Ctx, conv: Conversation, from: Date): void {
  // A test answers the tester and stops; it never nudges them for days.
  if (ctx.test) {
    conv.next = null;
    return;
  }
  // With calls on (Batch 4) the first follow-up is the call, after 2 business hours; else a text after 4.
  conv.next = conv.call && !conv.called ? { at: businessAfter(from, 2, ctx.tz).toISOString(), what: "call" } : { at: businessAfter(from, 4, ctx.tz).toISOString(), what: "nudge" };
}

/** The next quarter hour, within two days, that `ok` allows (the AI desk's automatic calling hours). */
function nextCallHour(now: Date, ok: (at: Date) => boolean): Date | null {
  const end = now.getTime() + 2 * 86_400_000;
  for (let at = Math.ceil(now.getTime() / 900_000) * 900_000; at <= end; at += 900_000) if (ok(new Date(at))) return new Date(at);
  return null;
}

// ── start ───────────────────────────────────────────────────────────────────

export type StartResult = { started: true } | { started: false; why: "off" | "source" | "before" | "closed" | "exists" | "booked" | "no-contact" | "no-consent" | "booking-off" | "no-service" | "limit" | "no-lead" | "no-times" };

/**
 * A new lead. `group` is the path that made it (a lead typed in with "Phone" as its source is not a desk message).
 * `consent.text`: where the customer said yes to texts, kept before anything is sent. `trustEmail`: false when the
 * email was heard on a call, not typed (the desk) — SmartBook never mails a stranger. `byHand`: someone pressed
 * "Offer times" on the lead page — the switch, the sources and the start date don't apply, and a lead SmartBook could
 * only fail to reach is refused up front instead of handed back.
 */
export async function startSmartBook(leadId: string, group: keyof SmartBookSources, opts: { now?: Date; consent?: { text?: ConsentSource | null; call?: boolean }; trustEmail?: boolean; byHand?: { actorId: string | null; who: string } } = {}): Promise<StartResult> {
  const now = opts.now ?? new Date();
  const found = await db.lead.findUnique({ where: { id: leadId }, select: { organizationId: true } });
  if (!found) return { started: false, why: "no-lead" };
  const ctx = await contextOf(found.organizationId, leadId);
  if (!ctx) return { started: false, why: "no-service" };
  const { smart, lead, org } = ctx;
  if (!opts.byHand) {
    if (!smart.on) return { started: false, why: "off" };
    if (!sourceAllowed(smart, group)) return { started: false, why: "source" };
    if (smart.onSince && lead.createdAt.getTime() < Date.parse(smart.onSince) - 60_000) return { started: false, why: "before" };
  }
  if (["WON", "LOST", "ARCHIVED"].includes(lead.status)) return { started: false, why: "closed" };
  if (!ctx.booking.enabled) return { started: false, why: "booking-off" };
  if (await readConv(org.id, lead.id)) return { started: false, why: "exists" };
  const upcoming = await db.appointment.findFirst({ where: { organizationId: org.id, leadId: lead.id, status: "SCHEDULED", startsAt: { gte: now } }, select: { id: true } });
  if (upcoming) return { started: false, why: "booked" };
  const startedToday = (await listConvs(org.id, 1)).filter((c) => Date.parse(c.createdAt) > now.getTime() - 86_400_000).length;
  if (startedToday >= MAX_NEW_PER_DAY) return { started: false, why: "limit" };

  const phone = toE164(lead.phone ?? "");
  const email = opts.trustEmail !== false && lead.email && EMAIL_RE.test(lead.email.trim()) ? lead.email.trim().toLowerCase() : null;
  if (!phone && !email) return { started: false, why: "no-contact" };
  if (phone && opts.consent?.text) await recordTextConsent(org.id, phone, { source: opts.consent.text, name: lead.name, leadId: lead.id });
  const mayText = smart.text && !!phone && !!org.smsFromNumber && (await hasTextConsent(org.id, phone));
  if (opts.byHand && !mayText && !(email && smart.email)) return { started: false, why: "no-consent" };

  const [slots, held] = await Promise.all([openSlots(ctx, now), heldFor(org.id, lead.id, now, ctx.booking.crews)]);
  const picks = pickOffers({ slots, count: smart.offers, timeZone: ctx.tz, held });
  if (opts.byHand && !picks.length) return { started: false, why: "no-times" };
  const conv = newConv(ctx, { phone, email, text: mayText, call: smart.call && !!phone && opts.consent?.call === true, offers: picks.map((x) => x.startsAt.toISOString()) }, now);
  if (!(await createConv(conv))) return { started: false, why: "exists" };
  await keep(ctx, conv.offers, now);
  await withConvLock(org.id, lead.id, async () => {
    const c = (await readConv(org.id, lead.id)) ?? conv;
    if (opts.byHand) await trail(ctx, `${opts.byHand.who} offered ${lead.name} times through SmartBook`, { dir: "none" }, opts.byHand.actorId);
    await firstContact(ctx, c, now, { again: !!opts.byHand && lead.createdAt.getTime() < now.getTime() - 3 * 86_400_000 });
    await saveConv(c);
  });
  return { started: true };
}

function newConv(ctx: Ctx, x: { phone: string | null; email: string | null; text: boolean; call: boolean; offers: string[]; test?: string }, now: Date): Conversation {
  return {
    v: 1,
    organizationId: ctx.org.id,
    leadId: ctx.lead.id,
    status: x.offers.length ? "offered" : "asked",
    why: null,
    name: ctx.lead.name,
    phone: x.phone,
    email: x.email,
    text: x.text,
    call: x.call,
    serviceKey: ctx.service.key,
    offers: x.offers,
    spent: [],
    counter: null,
    request: null,
    manageToken: null,
    bookedAt: null,
    token: newToken(),
    nudges: 0,
    called: false,
    aiTurns: 0,
    lang: "en",
    lastInAt: null,
    lastOutAt: null,
    next: null,
    createdAt: now.toISOString(),
    ...(x.test ? { test: x.test } : {}),
  };
}

async function firstContact(ctx: Ctx, conv: Conversation, now: Date, opts: { again?: boolean } = {}): Promise<void> {
  const w = wordsOf(ctx, conv);
  const link = await pickLink(conv.token);
  const free = /^free\b/i.test(ctx.service.priceText.trim());
  const label = ctx.service.label.toLowerCase();
  const subject = `${free ? `Free ${label}` : label.replace(/^\w/, (x) => x.toUpperCase())} — pick a time`;
  const vars = { first: w.first, company: w.company, project: ctx.lead.projectType?.trim().toLowerCase() || null, visit: visitNoun(ctx.service.kind), free, times: listOf(ctx, conv.offers), count: conv.offers.length, link };
  // An old lead someone offered times by hand: "it's … again", not "thanks for asking".
  const first = conv.offers.length ? (opts.again ? againText(vars) : firstText(vars, ctx.smart.firstMessage)) : say.noTimes(w);
  // The tester pressed the button just now: their test goes at once, quiet hours or not.
  const quiet = !ctx.test && isQuiet(now, ctx.tz);
  let reached: "text" | "email" | "none" = "none";
  if (conv.text && quiet) {
    // The text waits for 8 AM; the email goes now.
    conv.next = { at: nextMorning(now, ctx.tz).toISOString(), what: "first-text" };
    const wasText = conv.text;
    conv.text = false;
    reached = await toCustomer(ctx, conv, first, { subject });
    conv.text = wasText;
    if (reached === "none") reached = "text";
  } else {
    reached = await toCustomer(ctx, conv, first, { subject });
    // Texted: the email with the buttons goes too (owner's flow: "a text and an email").
    if (reached === "text" && conv.email && ctx.smart.email) {
      const wasText = conv.text;
      conv.text = false;
      await toCustomer(ctx, conv, first, { subject });
      conv.text = wasText;
    }
  }
  if (reached === "none") {
    conv.status = "closed";
    conv.why = "handed";
    conv.next = null;
    const why = !conv.phone ? "no phone, and email is off" : !ctx.org.smsFromNumber ? "no texting number yet, and no email on the lead" : "no yes to texts on file, and no email on the lead";
    await toCompany(ctx, tell.cantReach(ctx.lead.name, why), true);
    await ring(ctx, `SmartBook can't reach ${ctx.lead.name} on its own (${why})`);
    return;
  }
  if (!conv.offers.length) {
    await askCompany(ctx, conv, { day: null, at: null, part: null, label: "a visit" }, ctx.lead.description?.slice(0, 200) || "", now, { quiet: true });
    return;
  }
  if (!conv.next) scheduleNudge(ctx, conv, now);
}

// ── the customer ────────────────────────────────────────────────────────────

/** A reply from a phone SmartBook is talking with. False: not SmartBook's (the text goes the usual way). */
export async function onCustomerText(organizationId: string, phone: string, body: string, now = new Date()): Promise<boolean> {
  const e164 = toE164(phone);
  if (!e164) return false;
  const conv0 = await convByPhone(organizationId, e164);
  if (!conv0) return false;
  if (conv0.status === "closed" && conv0.why !== "no-reply") return false;
  for (let i = 0; i < 4; i++) {
    const done = await withConvLock(organizationId, conv0.leadId, async () => {
      const conv = await readConv(organizationId, conv0.leadId);
      const ctx = conv ? await contextOf(organizationId, conv.leadId) : null;
      if (!conv || !ctx) return false;
      const handled = await handleCustomer(ctx, conv, body, now);
      await saveConv(conv);
      return handled;
    });
    if (done !== null) return done;
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

async function handleCustomer(ctx: Ctx, conv: Conversation, body: string, now: Date): Promise<boolean> {
  if (conv.status === "closed" && conv.why !== "no-reply") return false;
  await trail(ctx, `${conv.name} wrote to SmartBook: "${body}"`, { dir: "in", channel: "text", body });
  conv.lastInAt = now.toISOString();
  // They answered: no more nudges or the call. A waiting request keeps its reminders.
  if (conv.next && ["first-text", "nudge", "call", "counter-nudge"].includes(conv.next.what)) conv.next = null;
  if (conv.status === "closed") {
    // A late answer after the nudges stopped: the conversation picks up again.
    conv.status = "offered";
    conv.why = null;
  }
  if (conv.aiTurns >= MAX_TURNS) {
    await handOff(ctx, conv, body);
    return true;
  }
  conv.aiTurns++;
  const offered = conv.status === "offered" ? conv.offers.length : 0;
  const quick = quickRead(body, offered);
  let read: CustomerRead | null = null;
  if (quick?.kind === "pick") read = bare({ intent: "pick", pick: quick.n });
  else if (quick && conv.status === "countered") read = bare({ intent: quick.kind === "yes" ? "pick" : "prefer", pick: quick.kind === "yes" ? 1 : null });
  else if (quick?.kind === "yes" && conv.status === "offered" && conv.offers.length === 1) read = bare({ intent: "pick", pick: 1 });
  else if (quick?.kind === "no" && conv.status === "offered") read = bare({ intent: "prefer" });
  else if (quick?.kind === "yes" && conv.status === "offered" && conv.offers.length > 1) {
    // "Yes" to three times: which one.
    await toCustomer(ctx, conv, say.whichOne(conv.offers.length), { subject: `${ctx.service.label} with ${ctx.org.name ?? "us"}` });
    return true;
  }
  else {
    const history = await historyOf(ctx);
    read = await readCustomer(
      body,
      {
        company: ctx.org.name ?? "the company",
        nowWords: nowWords(now, ctx.tz),
        timeZone: ctx.tz,
        offered: conv.status === "countered" && conv.counter ? [whenOf(ctx, conv.counter)] : conv.status === "offered" ? conv.offers.map((x) => `${whenOf(ctx, x)} (${x})`) : [],
        booked: conv.status === "booked" && conv.bookedAt ? whenOf(ctx, conv.bookedAt) : null,
        asked: conv.status === "asked" && conv.request ? conv.request.label : null,
        knowledge: knowledgeOf((await readDeskSettings(ctx.org.id).catch(() => null))?.profile ?? null),
      },
      history,
    );
  }
  if (!read) {
    // No model, and not a short reply SmartBook reads itself: the company reads it, the conversation stays.
    await textOfficeNow(ctx.org.id, replyForwardLine(ctx.lead.name, "lead", body), { kind: "reply-forward" });
    return true;
  }
  if (read.lang && read.lang.toLowerCase() !== "en") conv.lang = read.lang.toLowerCase().slice(0, 2);
  if (read.angry || read.intent === "human") {
    await handOff(ctx, conv, body);
    return true;
  }
  await act(ctx, conv, read, body, now);
  return true;
}

const bare = (x: Partial<CustomerRead>): CustomerRead => ({ intent: "other", pick: null, proposal: null, prefer: null, question: null, answer: null, lang: "en", angry: false, ...x });

async function historyOf(ctx: Ctx): Promise<string[]> {
  const rows = await db.activityEvent.findMany({ where: { organizationId: ctx.org.id, leadId: ctx.lead.id, kind: TRAIL_KINDS.SMARTBOOK }, orderBy: { createdAt: "desc" }, take: 8, select: { summary: true } });
  return rows.reverse().map((r) => r.summary);
}

async function act(ctx: Ctx, conv: Conversation, read: CustomerRead, body: string, now: Date): Promise<void> {
  const w = wordsOf(ctx, conv);
  const subject = `${ctx.service.label} with ${w.company}`;
  switch (read.intent) {
    case "pick": {
      if (conv.status === "countered" && conv.counter) {
        const counter = conv.counter;
        // The company hears it from the booking's own "Booked: … by SmartBook" text.
        await book(ctx, conv, counter, { confirmed: true }, now);
        return;
      }
      const iso = read.pick ? conv.offers[read.pick - 1] : undefined;
      if (!iso || conv.status !== "offered") {
        await toCustomer(ctx, conv, conv.offers.length ? say.whichOne(conv.offers.length) : say.noTimes(w), { subject });
        return;
      }
      await book(ctx, conv, iso, { confirmed: false }, now);
      return;
    }
    case "propose":
      if (read.proposal) await proposal(ctx, conv, read.proposal, body, now);
      else await offerMatching(ctx, conv, null, body, now);
      return;
    case "prefer":
      await offerMatching(ctx, conv, read.prefer ?? null, body, now, { declined: conv.status === "countered" || !read.prefer });
      return;
    case "question": {
      const steer = conv.status === "offered" ? say.steer(conv.offers.length) : "";
      if (read.answer) {
        await toCustomer(ctx, conv, `${read.answer.trim()}${steer ? ` ${steer}` : ""}`, { subject });
        return;
      }
      await toCustomer(ctx, conv, say.passedOn(w, steer || null), { subject });
      await toCompany(ctx, tell.question(ctx.lead.name, read.question || clip(body, 140), shown(conv.phone)));
      await ring(ctx, `${ctx.lead.name} asked SmartBook: "${clip(read.question || body, 140)}" — please answer them`);
      return;
    }
    case "not-interested":
      conv.status = "closed";
      conv.why = "not-interested";
      conv.next = null;
      await release(ctx.org.id, ctx.lead.id);
      await toCustomer(ctx, conv, say.notInterested(w), { subject });
      await toCompany(ctx, tell.notInterested(ctx.lead.name));
      return;
    case "cancel":
      if (conv.status === "booked" && conv.manageToken) {
        const when = conv.bookedAt ? whenOf(ctx, conv.bookedAt) : "your";
        const r = await cancelBooking(conv.manageToken);
        if (r.ok) {
          conv.status = "closed";
          conv.why = "canceled";
          conv.next = null;
          await toCustomer(ctx, conv, say.canceled(w, when), { subject, noEmail: true });
          await toCompany(ctx, tell.canceled(ctx.lead.name, when));
        }
        return;
      }
      return act(ctx, conv, { ...read, intent: "not-interested" }, body, now);
    case "reschedule":
      await offerMatching(ctx, conv, null, body, now);
      return;
    case "thanks":
      if (conv.status === "booked") await toCustomer(ctx, conv, say.welcome(w), { subject, noEmail: true });
      return;
    default:
      if (conv.status === "asked" && conv.request) {
        await toCustomer(ctx, conv, say.stillChecking(w, conv.request.label), { subject });
        return;
      }
      // Something SmartBook can't place: the company reads it as today, the conversation stays open.
      await textOfficeNow(ctx.org.id, replyForwardLine(ctx.lead.name, "lead", body), { kind: "reply-forward" });
  }
}

/** Book (or move) the visit. False when the time went meanwhile — the customer has new times then. */
async function book(ctx: Ctx, conv: Conversation, iso: string, opts: { confirmed: boolean }, now: Date): Promise<boolean> {
  const w = wordsOf(ctx, conv);
  const subject = `${ctx.service.label} with ${w.company}`;
  if (!opts.confirmed) {
    const open = slotAt(await openSlots(ctx, now), new Date(iso));
    if (!open) return taken(ctx, conv, iso, now);
  }
  // A test books nothing: the tester hears the same "you're all set", with a note.
  if (ctx.test) return booked(ctx, conv, iso, opts.confirmed, subject, false);
  if (conv.manageToken) {
    const live = await db.booking.findUnique({ where: { manageToken: conv.manageToken }, select: { status: true } });
    if (live && live.status !== "CANCELED") {
      const r = await rescheduleBooking(conv.manageToken, iso, now, { checked: true });
      if (!r.ok) return taken(ctx, conv, iso, now);
      return booked(ctx, conv, iso, opts.confirmed, subject, true);
    }
  }
  const r = await createBooking(ctx.org, {
    serviceKey: conv.serviceKey,
    startsAtISO: iso,
    name: ctx.lead.name,
    email: conv.email,
    phone: conv.phone ?? ctx.lead.phone,
    address: addressOf(ctx.lead),
    notes: conv.request?.words ? `Asked SmartBook for ${conv.request.label}: "${conv.request.words}"` : null,
    answers: [],
    channel: "smartbook",
    leadId: ctx.lead.id,
    confirmed: opts.confirmed,
  }, now);
  if (!r.ok) return taken(ctx, conv, iso, now);
  conv.manageToken = r.manageToken;
  return booked(ctx, conv, iso, opts.confirmed, subject, false);
}

async function booked(ctx: Ctx, conv: Conversation, iso: string, confirmed: boolean, subject: string, moved: boolean): Promise<true> {
  const w = wordsOf(ctx, conv);
  conv.status = "booked";
  conv.bookedAt = iso;
  conv.offers = [];
  conv.counter = null;
  conv.request = null;
  conv.next = null;
  await release(ctx.org.id, ctx.lead.id);
  // A visit booked for the lead moves it on to CONTACTED, as one booked on the calendar does (actions/appointments).
  if (!ctx.test) await markLeadContacted(ctx.org.id, ctx.lead.id, { status: true }).catch(() => null);
  const when = whenOf(ctx, iso);
  // The booking machinery mailed the confirmation with the manage link (or the move); the text says it in one line.
  const line = confirmed ? say.confirmed(w, when, streetOfLead(ctx.lead)) : say.booked(w, when, streetOfLead(ctx.lead));
  await toCustomer(ctx, conv, ctx.test ? `${line} (Test — nothing went on your calendar.)` : line, { subject, noEmail: !ctx.test });
  await trail(ctx, `SmartBook ${moved ? "moved" : "booked"} ${ctx.lead.name}'s visit to ${when}`, { dir: "none", bookedAt: iso });
  if (!ctx.test && ctx.lead.status === "NEW") await db.lead.update({ where: { id: ctx.lead.id }, data: { status: "CONTACTED", contactedAt: new Date() } }).catch(() => null);
  return true;
}

async function taken(ctx: Ctx, conv: Conversation, iso: string, now: Date): Promise<false> {
  const w = wordsOf(ctx, conv);
  conv.spent = [...new Set([...conv.spent, iso])];
  const picks = await freshOffers(ctx, conv, now, null);
  if (picks.length) {
    conv.status = "offered";
    conv.offers = picks;
    await keep(ctx, picks, now);
    await toCustomer(ctx, conv, say.taken(w, whenOf(ctx, iso), listOf(ctx, picks), picks.length), { subject: `${ctx.service.label} with ${w.company}` });
    scheduleNudge(ctx, conv, now);
  } else {
    await askCompany(ctx, conv, { day: null, at: null, part: null, label: "a visit" }, "", now);
  }
  return false;
}

async function freshOffers(ctx: Ctx, conv: Conversation, now: Date, prefer: Preference | null, exclude: readonly string[] = []): Promise<string[]> {
  const [slots, held] = await Promise.all([openSlots(ctx, now), heldFor(ctx.org.id, ctx.lead.id, now, ctx.booking.crews)]);
  const ex = new Set([...conv.spent, ...exclude].map((x) => Date.parse(x)));
  return pickOffers({ slots, count: ctx.smart.offers, timeZone: ctx.tz, held, exclude: ex, prefer }).map((s) => s.startsAt.toISOString());
}

/** "Saturday 9?" — open and the company lets SmartBook book it: booked; else the company is asked. A day without an hour: that day's open times, or the company. */
async function proposal(ctx: Ctx, conv: Conversation, p: NonNullable<CustomerRead["proposal"]>, body: string, now: Date): Promise<void> {
  const at = p.time ? proposalInstant(p.day, p.time, ctx.tz) : null;
  if (at && at.getTime() < now.getTime() + 30 * 60000) {
    await offerMatching(ctx, conv, null, body, now);
    return;
  }
  const slots = await openSlots(ctx, now);
  if (at) {
    const free = slotAt(slots, at);
    if (free && ctx.smart.ownTime === "auto") {
      await book(ctx, conv, at.toISOString(), { confirmed: false }, now);
      return;
    }
    await askCompany(ctx, conv, { day: p.day, at: at.toISOString(), part: null, label: whenWords(at, ctx.tz, 0) }, body, now);
    return;
  }
  const pref: Preference = { from: p.day, to: p.day, part: p.part ?? null };
  const held = await heldFor(ctx.org.id, ctx.lead.id, now, ctx.booking.crews);
  const picks = pickOffers({ slots: slots.filter((s) => matchesPreference(s, pref, ctx.tz)), count: ctx.smart.offers, timeZone: ctx.tz, held }).map((s) => s.startsAt.toISOString());
  if (picks.length) {
    conv.status = "offered";
    conv.offers = picks;
    conv.counter = null;
    await keep(ctx, picks, now);
    await toCustomer(ctx, conv, say.moreTimes(listOf(ctx, picks), picks.length), { subject: `${ctx.service.label} — times that fit` });
    scheduleNudge(ctx, conv, now);
    return;
  }
  await askCompany(ctx, conv, { day: p.day, at: null, part: p.part ?? null, label: dayPartWords(p.day, p.part ?? null, ctx.tz) }, body, now);
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function preferenceWords(p: Preference | null): string {
  if (!p) return "another time";
  const bits = [p.days?.length ? p.days.map((d) => DAY_NAMES[d]).join(" or ") : "", p.part ? `${p.part}s` : "", p.after ? `after ${p.after}` : "", p.before ? `before ${p.before}` : "", p.from && p.to && p.from === p.to ? p.from : p.from ? `from ${p.from}` : ""].filter(Boolean);
  return bits.join(", ") || "another time";
}

/** Times that fit what they said ("mornings", "Friday", or simply "not these") — or the company, when nothing open fits. */
async function offerMatching(ctx: Ctx, conv: Conversation, prefer: Preference | null, body: string, now: Date, opts: { declined?: boolean } = {}): Promise<void> {
  const w = wordsOf(ctx, conv);
  const turnedDown = opts.declined ? [...conv.offers, ...(conv.counter ? [conv.counter] : [])] : [];
  conv.spent = [...new Set([...conv.spent, ...turnedDown])];
  const picks = await freshOffers(ctx, conv, now, prefer);
  if (picks.length) {
    // A booked visit being moved keeps its manage token: the pick moves it (book → rescheduleBooking).
    conv.status = "offered";
    conv.offers = picks;
    conv.counter = null;
    await release(ctx.org.id, ctx.lead.id);
    await keep(ctx, picks, now);
    await toCustomer(ctx, conv, say.moreTimes(listOf(ctx, picks), picks.length), { subject: `${ctx.service.label} with ${w.company}` });
    scheduleNudge(ctx, conv, now);
    return;
  }
  const day = prefer?.from && prefer.from === prefer.to ? prefer.from : null;
  await askCompany(ctx, conv, { day, at: null, part: prefer?.part ?? null, label: preferenceWords(prefer) }, body, now);
}

/** What the company sees beside the request: free, what's there, or outside the hours. */
export async function calendarWords(ctx: Ctx, req: Pick<SmartRequest, "day" | "at" | "part">): Promise<string> {
  if (!req.day && !req.at) return `Nothing fits in the next ${ctx.booking.horizonDays} days on your calendar`;
  if (req.at) {
    const start = new Date(req.at);
    const end = new Date(start.getTime() + ctx.service.minutes * 60000);
    const [appt, job] = await Promise.all([
      db.appointment.findFirst({ where: { organizationId: ctx.org.id, status: { notIn: ["CANCELED", "NO_SHOW"] }, startsAt: { lt: end }, endsAt: { gt: start } }, select: { title: true, startsAt: true, endsAt: true } }),
      db.job.findFirst({ where: { organizationId: ctx.org.id, status: { notIn: ["CANCELED", "DONE", "COMPLETED"] }, startsAt: { not: null, lt: end }, endsAt: { not: null, gt: start } }, select: { title: true, startsAt: true, endsAt: true } }),
    ]);
    const hit = appt ?? job;
    if (hit) return `You have ${clip(hit.title, 50)} ${whenWords(hit.startsAt!, ctx.tz, 0).split(", ").pop()}–${whenWords(hit.endsAt!, ctx.tz, 0).split(", ").pop()} then`;
    const p = zonedParts(start, ctx.tz);
    const hours = ctx.booking.hours[p.dow];
    const at = p.h * 60 + p.min;
    const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
    if (!hours || at < mins(hours.open) || at >= mins(hours.close)) return "That's outside your booking hours, but your calendar is clear then";
    return "Your calendar is free then";
  }
  const [y, m, d] = req.day!.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  const closed = !ctx.booking.hours[dow];
  const dayStart = new Date(Date.UTC(y, m - 1, d, 0) - 14 * 3600000);
  const dayEnd = new Date(Date.UTC(y, m - 1, d, 0) + 38 * 3600000);
  const visits = (await db.appointment.findMany({ where: { organizationId: ctx.org.id, status: { notIn: ["CANCELED", "NO_SHOW"] }, startsAt: { gte: dayStart, lt: dayEnd } }, select: { startsAt: true } })).filter((a) => dayKey(a.startsAt, ctx.tz) === req.day).length;
  return `${visits ? `You have ${visits} visit${visits === 1 ? "" : "s"} that day` : "Your calendar is clear that day"}${closed ? " (you're normally closed)" : ", but nothing open fits"}`;
}

/** The customer waits; the company is asked. */
async function askCompany(ctx: Ctx, conv: Conversation, req: Pick<SmartRequest, "day" | "at" | "part" | "label">, words: string, now: Date, opts: { quiet?: boolean } = {}): Promise<void> {
  const w = wordsOf(ctx, conv);
  const n = await nextRequestNumber(ctx.org.id);
  const others = ctx.test ? 0 : (await listConvs(ctx.org.id, 14)).filter((c) => c.status === "asked" && c.leadId !== conv.leadId && !c.test).length;
  conv.status = "asked";
  conv.counter = null;
  const token = newToken();
  conv.request = { n, day: req.day, at: req.at, part: req.part, label: req.label, words: clip(words, 300), askedAt: now.toISOString(), token };
  await indexRequest(ctx.org.id, ctx.lead.id, token);
  const facts: RequestFacts = { name: ctx.lead.name, source: leadSourceOf(ctx.lead.source).label, project: ctx.lead.projectType?.trim() || null, asked: req.label, calendar: await calendarWords(ctx, req), n: others ? n : null, phone: shown(conv.phone) };
  await toCompany(ctx, req.at ? tell.request(facts) : tell.requestOpen(facts));
  // And by email (owner: "let us know by text, email"): one button to the answer page.
  const doc = buildSmartBookRequest({ org: { name: ctx.org.name ?? "Your company", logoUrl: ctx.org.logoUrl, phone: ctx.org.phone }, name: ctx.lead.name, asked: req.label, calendar: facts.calendar, source: facts.source, project: facts.project, phone: shown(conv.phone), words: words || null, href: `${await appBaseUrl()}/b/r/${token}` });
  const mailed = ctx.test
    ? ctx.lead.email
      ? sendEmail({ to: ctx.lead.email, subject: `(Test) ${renderEmail(doc).subject}`, html: renderEmail(doc).html })
      : Promise.resolve(null)
    : sendToMembersByPref(ctx.org.id, "smartbook-request", doc);
  await mailed.catch((err: unknown) => console.warn(`[smartbook] request email: ${err instanceof Error ? err.message : String(err)}`));
  await ring(ctx, `${ctx.lead.name} asks SmartBook for ${req.label} — confirm, decline or offer another time`, { request: n });
  if (!opts.quiet) await toCustomer(ctx, conv, say.checking(w, req.label, !ctx.test && isQuiet(now, ctx.tz)), { subject: `${ctx.service.label} with ${w.company}` });
  conv.next = ctx.test ? null : { at: businessAfter(now, 1, ctx.tz).toISOString(), what: "remind" };
}

async function handOff(ctx: Ctx, conv: Conversation, body: string): Promise<void> {
  const w = wordsOf(ctx, conv);
  conv.status = "closed";
  conv.why = "handed";
  conv.next = null;
  await release(ctx.org.id, ctx.lead.id);
  await toCustomer(ctx, conv, say.handedOff(w), { subject: `${ctx.service.label} with ${w.company}` });
  await toCompany(ctx, tell.handoff(ctx.lead.name, clip(body, 140), shown(conv.phone)), true);
  await ring(ctx, `${ctx.lead.name} needs a person: "${clip(body, 140)}" — SmartBook stopped`);
}

// ── the company ─────────────────────────────────────────────────────────────

export type Decision = { decision: "yes" } | { decision: "no" } | { decision: "other"; day: string | null; time: string };

/** A reply from someone on the company's team. False: no request is waiting (the text goes the usual way). */
export async function onContractorText(organizationId: string, fromPhone: string, body: string, now = new Date()): Promise<boolean> {
  const from = toE164(fromPhone);
  if (!from || !(await isTeamPhone(organizationId, from))) return false;
  // Someone testing answers their own test's request and nothing else (their phone plays both sides).
  const mine = await convByPhone(organizationId, from);
  const open = mine && isLiveTest(mine, now) ? (mine.status === "asked" && mine.request ? [mine] : []) : (await listConvs(organizationId, 14)).filter((c) => c.status === "asked" && c.request && !c.test);
  if (!open.length) return false;
  const reply = async (line: string) => {
    await sendText({ organizationId, to: from, body: line, kind: "smartbook-office" });
  };
  const q = quickRead(body, 0);
  const quick = q && q.kind !== "pick" ? q : null;
  const qt = quick ? null : quickTime(body);
  let ref = quick?.ref ?? qt?.ref ?? null;
  let decision: Decision | "unclear" | null = quick ? (quick.kind === "yes" ? { decision: "yes" } : { decision: "no" }) : null;
  let day: string | null = null;
  if (!decision && qt) decision = { decision: "other", day: null, time: qt.time };
  if (!decision) {
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const tz = org?.timezone || "America/New_York";
    const read = await readContractor(body, { nowWords: nowWords(now, tz), timeZone: tz, open: open.map((c) => ({ n: c.request!.n, name: c.name, asked: c.request!.label })) });
    ref = read?.ref ?? ref;
    day = read?.day ?? null;
    decision = !read || read.decision === "unclear" ? "unclear" : read.decision === "other" ? (read.time ? { decision: "other", day, time: read.time } : "unclear") : { decision: read.decision };
  }
  const target = ref ? open.find((c) => c.request!.n === ref) : open.length === 1 ? open[0] : null;
  if (!target) {
    await reply(tell.which(open.map((c) => ({ n: c.request!.n, name: c.name, asked: c.request!.label }))));
    return true;
  }
  if (!decision || decision === "unclear") {
    await reply(tell.unclear(target.name, target.request!.label, open.length > 1 ? target.request!.n : null));
    return true;
  }
  const actor = await db.membership.findFirst({ where: { organizationId, user: { smsPhone: from } }, select: { userId: true } });
  const line = await decideRequest(organizationId, target.leadId, decision, { actorId: actor?.userId ?? null, now });
  if (line) await reply(target.test ? `(Test) ${line}` : line);
  return true;
}

/**
 * The company's answer to a waiting request — by text (above), from the app or the request email (Batches 2–3).
 * Returns the line that tells the company what happened, or null when nothing was waiting.
 */
export async function decideRequest(organizationId: string, leadId: string, d: Decision, opts: { actorId?: string | null; now?: Date } = {}): Promise<string | null> {
  const now = opts.now ?? new Date();
  const out = await withConvLock(organizationId, leadId, async () => {
    const conv = await readConv(organizationId, leadId);
    const ctx = conv ? await contextOf(organizationId, leadId) : null;
    if (!conv || !ctx || conv.status !== "asked" || !conv.request) return null;
    const req = conv.request;
    const w = wordsOf(ctx, conv);
    const subject = `${ctx.service.label} with ${w.company}`;
    let line: string;
    if (d.decision === "yes") {
      if (!req.at) {
        line = tell.whatTime(ctx.lead.name, req.label);
      } else {
        const ok = await book(ctx, conv, req.at, { confirmed: true }, now);
        line = ok ? tell.done(ctx.lead.name, whenOf(ctx, req.at)) : `${ctx.lead.name}'s time couldn't be booked — SmartBook offered them open times.`;
        await trail(ctx, `${ok ? "The company confirmed" : "The company's yes couldn't book"} ${req.label}`, { dir: "none" }, opts.actorId ?? null);
      }
    } else if (d.decision === "no") {
      const picks = await freshOffers(ctx, conv, now, null, req.at ? [req.at] : []);
      if (picks.length) {
        conv.status = "offered";
        conv.offers = picks;
        conv.request = null;
        await keep(ctx, picks, now);
        await toCustomer(ctx, conv, say.declined(w, req.label, listOf(ctx, picks), picks.length), { subject });
        scheduleNudge(ctx, conv, now);
        line = tell.offeredOthers(ctx.lead.name);
      } else {
        conv.status = "closed";
        conv.why = "handed";
        conv.request = null;
        conv.next = null;
        await toCustomer(ctx, conv, say.declinedNoTimes(w, req.label), { subject });
        line = `Nothing else is open for ${ctx.lead.name} — please call them${conv.phone ? ` at ${shown(conv.phone)}` : ""}.`;
      }
      await trail(ctx, `The company said no to ${req.label}`, { dir: "none" }, opts.actorId ?? null);
    } else {
      const day = d.day ?? req.day;
      const at = day ? proposalInstant(day, d.time, ctx.tz) : null;
      if (!at || at.getTime() < now.getTime()) {
        line = tell.whatTime(ctx.lead.name, req.label);
      } else if (!req.at && req.day && dayKey(at, ctx.tz) === req.day && (!req.part || matchesPreference({ startsAt: at, endsAt: at }, { part: req.part }, ctx.tz))) {
        // They asked for a day (or a morning) and the company named the hour inside it: that is a yes.
        const ok = await book(ctx, conv, at.toISOString(), { confirmed: true }, now);
        line = ok ? tell.done(ctx.lead.name, whenOf(ctx, at.toISOString())) : `${ctx.lead.name}'s time couldn't be booked — SmartBook offered them open times.`;
      } else {
        conv.status = "countered";
        conv.counter = at.toISOString();
        await toCustomer(ctx, conv, say.counter(w, req.label, whenOf(ctx, conv.counter)), { subject });
        conv.next = { at: businessAfter(now, 4, ctx.tz).toISOString(), what: "counter-nudge" };
        line = tell.askedCounter(ctx.lead.name, whenOf(ctx, conv.counter));
      }
      await trail(ctx, `The company offered ${whenWords(at ?? now, ctx.tz, 0)} instead of ${req.label}`, { dir: "none" }, opts.actorId ?? null);
    }
    await saveConv(conv);
    return line;
  });
  return out ?? null;
}

// ── the company steps in (Batch 3: the lead page, Settings, the client record) ───────────────────────────────

export type By = { actorId: string | null; who: string };
type Done = { ok: true } | { ok: false; error: string };

/** One step under the conversation's lock, a few tries while a reply or the cron holds it. */
async function locked<T>(organizationId: string, leadId: string, fn: () => Promise<T>): Promise<T | null> {
  for (let i = 0; i < 4; i++) {
    const out = await withConvLock(organizationId, leadId, fn);
    if (out !== null) return out;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

const LIVE = new Set(["offered", "asked", "countered"]);

/**
 * "Pause SmartBook": a person takes the lead from here. Nothing is said to the customer; their replies go to the
 * office as any reply does. `line` is what the timeline says (the client record's own message pauses it too).
 */
export async function pauseSmartBook(organizationId: string, leadId: string, by: By & { line?: string }): Promise<boolean> {
  const out = await locked(organizationId, leadId, async () => {
    const conv = await readConv(organizationId, leadId);
    if (!conv || !LIVE.has(conv.status)) return false;
    const ctx = await contextOf(organizationId, leadId);
    if (!ctx) return false;
    conv.status = "closed";
    conv.why = "paused";
    conv.next = null;
    await release(organizationId, leadId);
    await trail(ctx, by.line ?? `${by.who} paused SmartBook — a person took over`, { dir: "none" }, by.actorId);
    await saveConv(conv);
    return true;
  });
  return out ?? false;
}

/** Someone on the team texted or emailed this person from the app: a person took over, so SmartBook steps back. */
export async function pauseForPerson(organizationId: string, to: { phone?: string | null; email?: string | null }, by: By): Promise<boolean> {
  const phone = to.phone ? toE164(to.phone) : null;
  const email = to.email?.trim().toLowerCase() || null;
  let conv = phone ? await convByPhone(organizationId, phone) : null;
  if (!conv && email) conv = (await listConvs(organizationId, 30)).find((c) => c.email === email && LIVE.has(c.status) && !c.test) ?? null;
  if (!conv || conv.test || !LIVE.has(conv.status)) return false;
  return pauseSmartBook(organizationId, conv.leadId, { ...by, line: `${by.who} messaged ${conv.name} — SmartBook paused so a person can take it from here` });
}

/** "Restart": a stopped conversation offers fresh times again (the first text's shape, "it's … again"). */
export async function restartSmartBook(organizationId: string, leadId: string, by: By, now = new Date()): Promise<Done> {
  const out = await locked(organizationId, leadId, async (): Promise<Done> => {
    const conv = await readConv(organizationId, leadId);
    const ctx = conv ? await contextOf(organizationId, leadId) : null;
    if (!conv || !ctx) return { ok: false, error: "SmartBook hasn't talked with this lead yet." };
    if (conv.status !== "closed") return { ok: false, error: "SmartBook is already talking with them." };
    if (!ctx.booking.enabled) return { ok: false, error: "Online booking is off — SmartBook offers its open hours. Turn it on in Online booking." };
    // They texted STOP: never texted again, email only. A yes given since (the page's "Text me") turns texts on.
    if (conv.why === "stopped") conv.text = false;
    else if (!conv.text && conv.phone && ctx.smart.text && ctx.org.smsFromNumber && (await hasTextConsent(organizationId, conv.phone))) conv.text = true;
    if (!conv.text && !(conv.email && ctx.smart.email)) return { ok: false, error: conv.why === "stopped" ? `${conv.name} replied STOP to texts and has no email — please call them.` : `${conv.name} hasn't said yes to texts and has no email — please call them.` };
    conv.spent = [];
    const picks = await freshOffers(ctx, conv, now, null);
    if (!picks.length) return { ok: false, error: `Nothing is open in the next ${ctx.booking.horizonDays} days — add hours in Online booking.` };
    conv.status = "offered";
    conv.why = null;
    conv.offers = picks;
    conv.counter = null;
    conv.request = null;
    conv.nudges = 0;
    conv.aiTurns = 0;
    conv.called = false;
    conv.next = null;
    await keep(ctx, picks, now);
    await trail(ctx, `${by.who} restarted SmartBook for ${conv.name}`, { dir: "none" }, by.actorId);
    await firstContact(ctx, conv, now, { again: true });
    await saveConv(conv);
    // firstContact closes it when nothing reached them
    return (conv.status as Conversation["status"]) === "closed" ? { ok: false, error: `The times couldn't reach ${conv.name} — please call them.` } : { ok: true };
  });
  return out ?? { ok: false, error: "Busy for a moment — try again." };
}

const START_WORDS: Record<Exclude<StartResult, { started: true }>["why"], string> = {
  off: "SmartBook is off.",
  source: "SmartBook doesn't answer this kind of lead.",
  before: "This lead came in before SmartBook was on.",
  closed: "This lead is closed — open it again first.",
  exists: "SmartBook already has a conversation with this lead.",
  booked: "They already have a visit on the calendar.",
  "no-contact": "There's no phone or email on this lead.",
  "no-consent": "They haven't said yes to texts and there's no email — please call them.",
  "booking-off": "Online booking is off — SmartBook offers its open hours. Turn it on in Online booking.",
  "no-service": "Add a visit type in Online booking first.",
  limit: "SmartBook started 200 conversations today — try again tomorrow.",
  "no-lead": "This lead is gone.",
  "no-times": "Nothing is open on your calendar soon — add hours in Online booking.",
};

/** "Offer times" on a lead SmartBook didn't start by itself (added by hand, imported, before it was on). */
export async function offerTimesByHand(leadId: string, by: By, now = new Date()): Promise<Done> {
  const r = await startSmartBook(leadId, "other", { now, byHand: by });
  return r.started ? { ok: true } : { ok: false, error: START_WORDS[r.why] };
}

/**
 * "Send me a test" (Settings): the whole conversation with the person testing as the customer — the first text and
 * email with real open times, their replies read, a time of their own asked of them as the company. Nothing is
 * booked or held, nobody else hears of it, and their texts are SmartBook's for two hours (store TEST_MS).
 */
export async function startSmartBookTest(organizationId: string, user: { id: string; name: string | null; email: string | null; smsPhone: string | null; smsVerifiedAt: Date | null }, now = new Date()): Promise<{ ok: true; by: "text" | "email" | "both" } | { ok: false; error: string }> {
  const leadId = testLeadId(user.id);
  await dropConv(organizationId, leadId);
  const phone = user.smsVerifiedAt && user.smsPhone ? toE164(user.smsPhone) : null;
  const email = user.email && EMAIL_RE.test(user.email.trim()) ? user.email.trim().toLowerCase() : null;
  // The stand-in lead is read from the conversation, so a bare one is written first.
  const draft: Conversation = { v: 1, organizationId, leadId, status: "offered", why: null, name: user.name?.trim() || "Test customer", phone, email, text: false, call: false, serviceKey: "", offers: [], spent: [], counter: null, request: null, manageToken: null, bookedAt: null, token: newToken(), nudges: 0, called: false, aiTurns: 0, lang: "en", lastInAt: null, lastOutAt: null, next: null, createdAt: now.toISOString(), test: user.id };
  if (!(await createConv(draft))) return { ok: false, error: "A test is starting — try again in a moment." };
  const fail = async (error: string) => {
    await dropConv(organizationId, leadId);
    return { ok: false as const, error };
  };
  const ctx = await contextOf(organizationId, leadId);
  if (!ctx) return fail("Add a visit type in Online booking first.");
  if (!ctx.booking.enabled) return fail("Turn on Online booking first — SmartBook offers its open hours.");
  const text = ctx.smart.text && !!phone && !!ctx.org.smsFromNumber;
  const mail = ctx.smart.email && !!email;
  if (!text && !mail) return fail(!ctx.org.smsFromNumber ? "There's no texting number yet, and Email is off — turn Email on to test by email." : "Verify your mobile in Settings → Notifications to get the test by text, or turn Email on.");
  const [slots, held] = await Promise.all([openSlots(ctx, now), heldFor(organizationId, leadId, now, ctx.booking.crews)]);
  const picks = pickOffers({ slots, count: ctx.smart.offers, timeZone: ctx.tz, held }).map((x) => x.startsAt.toISOString());
  const conv: Conversation = { ...draft, serviceKey: ctx.service.key, text, email: mail ? email : null, offers: picks, status: picks.length ? "offered" : "asked" };
  await locked(organizationId, leadId, async () => {
    await firstContact(ctx, conv, now);
    await saveConv(conv);
  });
  return { ok: true, by: text && mail ? "both" : text ? "text" : "email" };
}

// ── on the phone (Batch 4: the desk's calls and SmartBook's own, lib/smartbook/phone) ─────────────────────────

export type CallTime = { id: string; label: string; startsAt: string };

/** What the desk says about this lead on a call: who, what for, and where SmartBook stands. */
export async function callContext(organizationId: string, leadId: string, now = new Date()): Promise<{ first: string; name: string; company: string; visit: string; price: string; project: string | null; status: Conversation["status"]; offers: CallTime[]; asked: string | null; counter: string | null; booked: string | null; channel: "text" | "email" | null } | null> {
  const [conv, ctx] = await Promise.all([readConv(organizationId, leadId), contextOf(organizationId, leadId)]);
  if (!conv || !ctx) return null;
  const open = conv.status === "offered" ? await openSlots(ctx, now) : [];
  return {
    first: firstNameOf(conv.name),
    name: conv.name,
    company: ctx.org.name?.trim() || "the company",
    visit: ctx.service.label,
    price: ctx.service.priceText,
    project: ctx.lead.projectType?.trim() || null,
    status: conv.status,
    offers: conv.offers.filter((x) => slotAt(open, new Date(x))).map((x) => ({ id: `${conv.serviceKey}|${x}`, label: whenOf(ctx, x), startsAt: x })),
    asked: conv.status === "asked" && conv.request ? conv.request.label : null,
    counter: conv.status === "countered" && conv.counter ? whenOf(ctx, conv.counter) : null,
    booked: conv.status === "booked" && conv.bookedAt ? whenOf(ctx, conv.bookedAt) : null,
    channel: conv.text ? "text" : conv.email ? "email" : null,
  };
}

/** open_times on a call with this lead: the times they were offered (still open) first, then the next open ones. */
export async function callTimes(organizationId: string, leadId: string, now = new Date()): Promise<{ ok: true; times: CallTime[]; note: string } | { ok: false; error: string }> {
  const [conv, ctx] = await Promise.all([readConv(organizationId, leadId), contextOf(organizationId, leadId)]);
  if (!conv || !ctx) return { ok: false, error: "Their request isn't on file — take a message instead." };
  if (!ctx.booking.enabled) return { ok: false, error: "The company isn't booking visits by phone right now — take a message instead." };
  const [slots, held] = await Promise.all([openSlots(ctx, now), heldFor(organizationId, leadId, now, ctx.booking.crews)]);
  const offered = conv.status === "offered" ? conv.offers.filter((x) => slotAt(slots, new Date(x))) : [];
  const more = pickOffers({ slots, count: 4, timeZone: ctx.tz, held, exclude: new Set(offered.map((x) => Date.parse(x))) }).map((x) => x.startsAt.toISOString());
  const times = [...offered, ...more].slice(0, 6).map((x) => ({ id: `${ctx.service.key}|${x}`, label: whenOf(ctx, x), startsAt: x }));
  if (!times.length) return { ok: false, error: "Nothing is open soon — use request_time for the time they want, and the team will confirm." };
  return { ok: true, times, note: `${ctx.service.label} — ${ctx.service.priceText}${ctx.booking.arrivalWindow ? `, a ${ctx.booking.arrivalWindow / 60}-hour arrival window` : ""}.${offered.length ? ` The first ${offered.length} are the times SmartBook already sent them.` : ""}` };
}

/** book_visit on a call with this lead: on their own lead and conversation; a time that went meanwhile is said, not texted. */
export async function bookOnCall(organizationId: string, leadId: string, timeId: string, now = new Date()): Promise<{ ok: true; when: string; serviceLabel: string; appointmentId: string } | { ok: false; error: string }> {
  const iso = (timeId ?? "").split("|")[1] ?? "";
  if (!Number.isFinite(Date.parse(iso))) return { ok: false, error: "Pick one of the open times first." };
  const out = await locked(organizationId, leadId, async () => {
    const conv = await readConv(organizationId, leadId);
    const ctx = conv ? await contextOf(organizationId, leadId) : null;
    if (!conv || !ctx) return { ok: false as const, error: "Their request isn't on file — take a message instead." };
    if (!slotAt(await openSlots(ctx, now), new Date(iso))) return { ok: false as const, error: "That time was just taken — offer another from open_times." };
    if (conv.status === "closed") {
      conv.status = "offered";
      conv.why = null;
    }
    conv.lastInAt = now.toISOString();
    conv.next = conv.status === "asked" ? conv.next : null;
    const ok = await book(ctx, conv, iso, { confirmed: false }, now);
    await saveConv(conv);
    if (!ok) return { ok: false as const, error: "That time was just taken — offer another from open_times." };
    const appt = conv.manageToken ? await db.booking.findUnique({ where: { manageToken: conv.manageToken }, select: { appointmentId: true } }) : null;
    return { ok: true as const, when: whenOf(ctx, iso), serviceLabel: ctx.service.label, appointmentId: appt?.appointmentId ?? "" };
  });
  return out ?? { ok: false, error: "One moment — try booking it again." };
}

/**
 * request_time on a call: the customer's own time (or a day, or part of one) goes the way a text does — booked when the
 * company lets SmartBook book a free time, else the company is asked and the customer hears back. A day with open
 * times that fit comes back as those times, for the desk to offer.
 */
export async function requestOnCall(organizationId: string, leadId: string, p: { day: string; time: string | null; part: "morning" | "afternoon" | "evening" | null }, words: string, now = new Date()): Promise<{ ok: true; outcome: "booked" | "asked" | "times"; say: string; times?: string[] } | { ok: false; error: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.day)) return { ok: false, error: "Ask which day, then try again." };
  if (p.time && !/^\d{2}:\d{2}$/.test(p.time)) return { ok: false, error: "Ask what time, like 9am, then try again." };
  const out = await locked(organizationId, leadId, async () => {
    const conv = await readConv(organizationId, leadId);
    const ctx = conv ? await contextOf(organizationId, leadId) : null;
    if (!conv || !ctx) return { ok: false as const, error: "Their request isn't on file — take a message instead." };
    if (conv.status === "closed") {
      conv.status = "offered";
      conv.why = null;
    }
    conv.lastInAt = now.toISOString();
    if (conv.next && ["first-text", "nudge", "call", "counter-nudge"].includes(conv.next.what)) conv.next = null;
    await trail(ctx, `${conv.name} asked on the phone for ${p.time ? whenWords(proposalInstant(p.day, p.time, ctx.tz) ?? now, ctx.tz, 0) : dayPartWords(p.day, p.part, ctx.tz)}`, { dir: "in", channel: "call", body: words || undefined });
    await proposal(ctx, conv, { day: p.day, time: p.time, part: p.time ? null : p.part }, words || "Asked on the phone", now);
    await saveConv(conv);
    const status = conv.status as Conversation["status"];
    if (status === "booked" && conv.bookedAt) return { ok: true as const, outcome: "booked" as const, say: `Booked for ${whenOf(ctx, conv.bookedAt)} — tell them they're all set and a text confirms it.` };
    if (status === "offered") return { ok: true as const, outcome: "times" as const, times: conv.offers.map((x) => whenOf(ctx, x)), say: "Those are open that day — offer them; book the one they pick with book_visit after calling open_times." };
    return { ok: true as const, outcome: "asked" as const, say: `Tell them you'll check ${conv.request?.label ?? "that time"} with the team and they'll hear back by ${conv.text ? "text" : "email"} shortly.` };
  });
  return out ?? { ok: false, error: "One moment — try again." };
}

/** not_interested on a call: SmartBook stops, the company hears it; nothing more is sent (they heard it on the call). */
export async function notInterestedOnCall(organizationId: string, leadId: string, said: string): Promise<boolean> {
  const out = await locked(organizationId, leadId, async () => {
    const conv = await readConv(organizationId, leadId);
    const ctx = conv ? await contextOf(organizationId, leadId) : null;
    if (!conv || !ctx || conv.status === "booked") return false;
    conv.status = "closed";
    conv.why = "not-interested";
    conv.next = null;
    await release(organizationId, leadId);
    await trail(ctx, `${conv.name} said on the phone they're not interested${said ? `: "${clip(said, 140)}"` : ""}`, { dir: "in", channel: "call" });
    await toCompany(ctx, tell.notInterested(ctx.lead.name));
    await saveConv(conv);
    return true;
  });
  return out ?? false;
}

/** take_message on a call with this lead: onto their lead (never a second one), the company told. */
export async function messageOnCall(organizationId: string, leadId: string, about: string): Promise<boolean> {
  const ctx = await contextOf(organizationId, leadId);
  if (!ctx) return false;
  const words = clip(about, 300);
  await trail(ctx, `${ctx.lead.name} left a message on the phone: "${words}"`, { dir: "in", channel: "call", body: words });
  await toCompany(ctx, `📞 ${ctx.lead.name} left a message with the AI desk: "${clip(about, 160)}"${ctx.lead.phone ? ` — ${shown(toE164(ctx.lead.phone) ?? ctx.lead.phone)}` : ""}.`);
  await ring(ctx, `${ctx.lead.name} left a message with the AI desk: "${clip(about, 140)}" — please call them back`);
  return true;
}

/** A line on the lead's timeline about a call (placed, a voicemail, how it went). */
export async function noteOnCall(organizationId: string, leadId: string, summary: string, meta: Record<string, unknown> = {}): Promise<void> {
  const ctx = await contextOf(organizationId, leadId);
  if (ctx) await trail(ctx, summary, { dir: "none", channel: "call", ...meta });
}

// ── the cron ────────────────────────────────────────────────────────────────

/** Every 2 minutes (vercel.json): whatever is due. Never throws. */
export async function runSmartBook(now = new Date()): Promise<{ steps: number; swept: number }> {
  const swept = await sweepHolds(now).catch(() => 0);
  let steps = 0;
  const due = (await listConvs(null, 30)).filter((c) => c.next && Date.parse(c.next.at) <= now.getTime());
  for (const c of due.slice(0, 200)) {
    try {
      const ran = await withConvLock(c.organizationId, c.leadId, async () => {
        const conv = await readConv(c.organizationId, c.leadId);
        const ctx = conv ? await contextOf(c.organizationId, c.leadId) : null;
        if (!conv || !ctx || !conv.next || Date.parse(conv.next.at) > now.getTime()) return false;
        await step(ctx, conv, now);
        await saveConv(conv);
        return true;
      });
      if (ran) steps++;
    } catch (err) {
      console.error(`[smartbook] step ${c.leadId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { steps, swept };
}

async function step(ctx: Ctx, conv: Conversation, now: Date): Promise<void> {
  const what = conv.next!.what;
  conv.next = null;
  const w = wordsOf(ctx, conv);
  const subject = `${ctx.service.label} with ${w.company}`;
  if (conv.status === "closed" || conv.status === "booked") return;
  // Times that went by or were taken since they were offered are replaced before anything is said.
  const keepOpen = async () => {
    const slots = await openSlots(ctx, now);
    const still = conv.offers.filter((x) => slotAt(slots, new Date(x)));
    if (still.length >= Math.min(2, ctx.smart.offers)) return still;
    const picks = await freshOffers(ctx, conv, now, null);
    await keep(ctx, picks, now);
    return picks;
  };
  switch (what) {
    case "first-text": {
      if (conv.status !== "offered") return;
      conv.offers = await keepOpen();
      if (!conv.offers.length) return askCompany(ctx, conv, { day: null, at: null, part: null, label: "a visit" }, "", now);
      const link = await pickLink(conv.token);
      const free = /^free\b/i.test(ctx.service.priceText.trim());
      const text = firstText({ first: w.first, company: w.company, project: ctx.lead.projectType?.trim().toLowerCase() || null, visit: visitNoun(ctx.service.kind), free, times: listOf(ctx, conv.offers), count: conv.offers.length, link }, ctx.smart.firstMessage);
      const keepEmail = conv.email;
      conv.email = null; // the email went last night
      await toCustomer(ctx, conv, text, { subject });
      conv.email = keepEmail;
      scheduleNudge(ctx, conv, now);
      return;
    }
    case "call": {
      // The one AI call (owner, 2026-10-31): only to a lead who agreed to calls. It is the AI desk's own call to a lead
      // (lib/aiDesk/leadCalls callLead, the automatic kind): the desk live with minutes, its checks and caps, its
      // calling hours — and never when the desk already called them (its "Call new leads", or a person's press). The
      // brief knows what SmartBook sent (lib/smartbook/phone leadCallExtras). The text nudge follows 2 business hours on.
      const nudge = { at: businessAfter(now, 2, ctx.tz).toISOString(), what: "nudge" as const };
      if (conv.status !== "offered" || !conv.phone || !ctx.smart.call) {
        conv.called = true;
        conv.next = nudge;
        return;
      }
      const { callLead, inCallingHours } = await import("@/lib/aiDesk/leadCalls");
      if (!inCallingHours(now, ctx.tz, true)) {
        // Outside the desk's automatic hours (9 AM–7 PM, Monday to Saturday): the call waits for them, unless that is
        // more than 16 hours away (a Sunday) — then the text and email carry on alone.
        const at = nextCallHour(now, (d) => inCallingHours(d, ctx.tz, true));
        if (at && at.getTime() - now.getTime() <= 16 * 3600_000) {
          conv.next = { at: at.toISOString(), what: "call" };
          return;
        }
        conv.called = true;
        conv.next = nudge;
        await trail(ctx, `SmartBook didn't call ${conv.name} — outside the AI desk's calling hours`, { dir: "none", channel: "call" });
        return;
      }
      conv.called = true;
      conv.next = nudge;
      const r = await callLead(ctx.org.id, conv.leadId, { by: null, auto: true, now, why: "smartbook" });
      if (!r.ok) await trail(ctx, `SmartBook didn't call ${conv.name} — ${r.error.charAt(0).toLowerCase()}${r.error.slice(1)}`, { dir: "none", channel: "call" });
      return;
    }
    case "nudge": {
      if (conv.status !== "offered") return;
      if (conv.nudges >= 2) {
        conv.status = "closed";
        conv.why = "no-reply";
        await release(ctx.org.id, ctx.lead.id);
        await trail(ctx, `SmartBook stopped: ${conv.name} didn't answer`, { dir: "none" });
        return;
      }
      if (conv.nudges === 0) {
        conv.offers = await keepOpen();
        if (!conv.offers.length) return;
        await toCustomer(ctx, conv, say.nudge(w, listOf(ctx, conv.offers), conv.offers.length), { subject });
        conv.nudges = 1;
        // The next morning at 10, the company's clock.
        conv.next = { at: new Date(nextMorning(new Date(now.getTime() + 3600000), ctx.tz).getTime() + 2 * 3600000).toISOString(), what: "nudge" };
        return;
      }
      conv.spent = [...new Set([...conv.spent, ...conv.offers])];
      conv.offers = await freshOffers(ctx, conv, now, null);
      if (!conv.offers.length) return;
      await keep(ctx, conv.offers, now);
      await toCustomer(ctx, conv, say.nudgeFresh(w, listOf(ctx, conv.offers), conv.offers.length), { subject });
      conv.nudges = 2;
      conv.next = { at: new Date(now.getTime() + 2 * 86_400_000).toISOString(), what: "nudge" };
      return;
    }
    case "remind": {
      if (conv.status !== "asked" || !conv.request) return;
      const facts: RequestFacts = { name: ctx.lead.name, source: leadSourceOf(ctx.lead.source).label, project: ctx.lead.projectType?.trim() || null, asked: conv.request.label, calendar: "", n: conv.request.n, phone: shown(conv.phone) };
      await toCompany(ctx, tell.reminder(facts));
      conv.next = { at: businessAfter(new Date(conv.request.askedAt), 3, ctx.tz).toISOString(), what: "still-checking" };
      return;
    }
    case "still-checking": {
      if (conv.status !== "asked" || !conv.request) return;
      await toCustomer(ctx, conv, say.stillChecking(w, conv.request.label), { subject });
      conv.next = { at: new Date(Date.parse(conv.request.askedAt) + 86_400_000).toISOString(), what: "reoffer" };
      return;
    }
    case "reoffer": {
      if (conv.status !== "asked" || !conv.request) return;
      const asked = conv.request.label;
      const picks = await freshOffers(ctx, conv, now, null, conv.request.at ? [conv.request.at] : []);
      if (!picks.length) return;
      conv.status = "offered";
      conv.offers = picks;
      conv.request = null;
      await keep(ctx, picks, now);
      await toCustomer(ctx, conv, say.reoffer(w, asked, listOf(ctx, picks), picks.length), { subject });
      await toCompany(ctx, tell.reoffered(ctx.lead.name, asked));
      scheduleNudge(ctx, conv, now);
      return;
    }
    case "counter-nudge":
      if (conv.status !== "countered" || !conv.counter) return;
      await toCustomer(ctx, conv, say.counterNudge(w, whenOf(ctx, conv.counter)), { subject });
      return;
  }
}

// ── the customer's page (/b/<token>) and the company's answer page (/b/r/<token>) ─────────────────────────────────

export interface PickDay {
  day: string;
  weekday: string;
  slots: Array<{ iso: string; label: string }>;
}

export interface PickView {
  company: string;
  phone: string | null;
  first: string;
  visit: string;
  price: string;
  status: "offered" | "asked" | "countered" | "booked" | "closed";
  /** The numbered times on offer that are still open. */
  offers: Array<{ iso: string; label: string }>;
  counter: { iso: string; label: string } | null;
  asked: string | null;
  booked: { when: string; manage: string | null } | null;
  /** "on": SmartBook texts them; "can": a phone and a company number, no yes yet; "no": neither. */
  texts: "on" | "can" | "no";
  /** "(•••) •••-0142" */
  phoneShown: string | null;
  /** How the customer hears back: their text or their email. */
  channel: "text" | "email";
}

const slotWords = (ctx: Ctx, d: Date) => {
  const t = (x: Date) => x.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ctx.tz });
  return ctx.booking.arrivalWindow ? `${t(d)}–${t(new Date(d.getTime() + ctx.booking.arrivalWindow * 60000))}` : t(d);
};

async function viewOf(ctx: Ctx, conv: Conversation, now: Date): Promise<PickView> {
  const open = conv.status === "offered" || (conv.status === "closed" && conv.why === "no-reply") || conv.status === "asked" ? await openSlots(ctx, now) : [];
  const offers = conv.offers.filter((x) => slotAt(open, new Date(x))).map((x) => ({ iso: x, label: whenOf(ctx, x) }));
  const status: PickView["status"] = conv.status === "closed" ? (conv.why === "no-reply" ? "offered" : "closed") : conv.status;
  const tail = conv.phone ? conv.phone.slice(-4) : null;
  return {
    company: ctx.org.name?.trim() || "Your contractor",
    phone: ctx.org.phone,
    first: firstNameOf(conv.name),
    visit: ctx.service.label,
    price: ctx.service.priceText,
    status,
    offers,
    counter: conv.status === "countered" && conv.counter ? { iso: conv.counter, label: whenOf(ctx, conv.counter) } : null,
    asked: conv.status === "asked" && conv.request ? conv.request.label : null,
    booked: conv.status === "booked" && conv.bookedAt ? { when: whenOf(ctx, conv.bookedAt), manage: conv.manageToken ? `/book/manage/${conv.manageToken}` : null } : null,
    texts: conv.text ? "on" : conv.phone && ctx.org.smsFromNumber && ctx.smart.text ? "can" : "no",
    phoneShown: tail ? `(•••) •••-${tail}` : null,
    channel: conv.text ? "text" : "email",
  };
}

async function byToken(token: string): Promise<{ ctx: Ctx; conv: Conversation } | null> {
  const conv = await convByToken(String(token ?? "").slice(0, 40));
  const ctx = conv ? await contextOf(conv.organizationId, conv.leadId) : null;
  return conv && ctx ? { ctx, conv } : null;
}

/** What the customer's page shows. Null: no such link. */
export async function pickView(token: string, now = new Date()): Promise<PickView | null> {
  const found = await byToken(token);
  return found ? viewOf(found.ctx, found.conv, now) : null;
}

/** Every open time, by day, as the booking page lays them out — less the ones held for other leads. */
export async function pickTimes(token: string, now = new Date()): Promise<PickDay[] | null> {
  const found = await byToken(token);
  if (!found) return null;
  const { ctx, conv } = found;
  const [slots, held] = await Promise.all([openSlots(ctx, now), heldFor(ctx.org.id, conv.leadId, now, ctx.booking.crews)]);
  const days = new Map<string, PickDay>();
  for (const s of slots) {
    if (held.has(s.startsAt.getTime())) continue;
    const key = dayKey(s.startsAt, ctx.tz);
    const day = days.get(key) ?? { day: key, weekday: s.startsAt.toLocaleDateString("en-US", { weekday: "long", timeZone: ctx.tz }), slots: [] };
    day.slots.push({ iso: s.startsAt.toISOString(), label: slotWords(ctx, s.startsAt) });
    days.set(key, day);
  }
  return [...days.values()];
}

type PageResult = { ok: true; view: PickView } | { ok: false; error: string; view?: PickView };

async function onPage(token: string, now: Date, fn: (ctx: Ctx, conv: Conversation) => Promise<string | null>): Promise<PageResult> {
  const found = await byToken(token);
  if (!found) return { ok: false, error: "This link is not active." };
  for (let i = 0; i < 4; i++) {
    const out = await withConvLock(found.conv.organizationId, found.conv.leadId, async () => {
      const conv = await readConv(found.conv.organizationId, found.conv.leadId);
      const ctx = conv ? await contextOf(conv.organizationId, conv.leadId) : null;
      if (!conv || !ctx) return { ok: false as const, error: "This link is not active." };
      const error = await fn(ctx, conv);
      await saveConv(conv);
      const view = await viewOf(ctx, conv, now);
      return error ? { ok: false as const, error, view } : { ok: true as const, view };
    });
    if (out) return out;
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, error: "Busy for a moment — please try again." };
}

/** The customer books a time from their page: one on offer, any open time, the company's other time, or a move. */
export async function pickAt(token: string, iso: string, now = new Date()): Promise<PageResult> {
  return onPage(token, now, async (ctx, conv) => {
    const at = new Date(iso);
    if (!Number.isFinite(at.getTime())) return "Pick a time.";
    if (conv.status === "closed" && conv.why !== "no-reply") return `This link is closed — please call ${ctx.org.name ?? "the company"}${ctx.org.phone ? ` at ${ctx.org.phone}` : ""}.`;
    if (conv.status === "closed") {
      conv.status = "offered";
      conv.why = null;
    }
    const counter = conv.status === "countered" && conv.counter && Date.parse(conv.counter) === at.getTime();
    if (!counter && conv.status === "booked" && conv.bookedAt && Date.parse(conv.bookedAt) === at.getTime()) return null;
    if (!counter && !slotAt(await openSlots(ctx, now), at)) return "That time was just taken — please pick another.";
    await trail(ctx, `${conv.name} picked ${whenOf(ctx, at.toISOString())} on the SmartBook page`, { dir: "in", channel: "page" });
    conv.lastInAt = now.toISOString();
    conv.next = conv.status === "asked" ? conv.next : null;
    const ok = await book(ctx, conv, at.toISOString(), { confirmed: !!counter }, now);
    return ok ? null : "That time was just taken — please pick another.";
  });
}

/** The customer names their own day (and hour, or part of the day) on the page — the same as in a text. */
export async function proposeAt(token: string, input: { day: string; time: string | null; part: "morning" | "afternoon" | "evening" | null; note: string }, now = new Date()): Promise<PageResult> {
  return onPage(token, now, async (ctx, conv) => {
    if (conv.status === "closed" && conv.why !== "no-reply") return `This link is closed — please call ${ctx.org.name ?? "the company"}.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) return "Pick a day.";
    const today = dayKey(now, ctx.tz);
    const [y, m, d] = today.split("-").map(Number);
    const last = dayKey(new Date(Date.UTC(y, m - 1, d) + 90 * 86_400_000), ctx.tz);
    if (input.day < today || input.day > last) return "Pick a day in the next three months.";
    if (input.time && !/^\d{2}:\d{2}$/.test(input.time)) return "Pick a time, or leave it empty.";
    if (conv.status === "closed") {
      conv.status = "offered";
      conv.why = null;
    }
    const note = input.note.trim().slice(0, 500);
    await trail(ctx, `${conv.name} asked on the SmartBook page for ${input.time ? whenWords(proposalInstant(input.day, input.time, ctx.tz) ?? now, ctx.tz, 0) : dayPartWords(input.day, input.part, ctx.tz)}${note ? `: "${note}"` : ""}`, { dir: "in", channel: "page" });
    conv.lastInAt = now.toISOString();
    if (conv.next && ["first-text", "nudge", "call", "counter-nudge"].includes(conv.next.what)) conv.next = null;
    await proposal(ctx, conv, { day: input.day, time: input.time, part: input.time ? null : input.part }, note || "Asked on the SmartBook page", now);
    return null;
  });
}

/** "Text me about this visit": the customer's own yes to texts, from the page (the email's link brings them here). */
export async function textMe(token: string, now = new Date()): Promise<PageResult> {
  return onPage(token, now, async (ctx, conv) => {
    if (!conv.phone || !ctx.org.smsFromNumber || !ctx.smart.text) return "Texts aren't available for this visit — we'll keep you posted by email.";
    if (conv.text) return null;
    await recordTextConsent(ctx.org.id, conv.phone, { source: "email-tap", name: conv.name, leadId: conv.leadId });
    conv.text = true;
    const w = wordsOf(ctx, conv);
    await toCustomer(ctx, conv, `Thanks${w.first ? `, ${w.first}` : ""} — ${w.company} will text you here about your visit. Reply STOP to opt out.`, { subject: "Texts are on", noEmail: true });
    return null;
  });
}

export interface RequestView {
  company: string;
  name: string;
  asked: string;
  calendar: string;
  source: string;
  project: string | null;
  phone: string | null;
  words: string | null;
  /** The customer named an exact time (YES books it); false: a day or part of one (the company names the hour). */
  exact: boolean;
  day: string | null;
  open: boolean;
  /** Where the conversation stands when the request was already answered. */
  now: string | null;
}

async function requestOf(token: string): Promise<{ ctx: Ctx; conv: Conversation } | null> {
  const conv = await convByRequestToken(String(token ?? "").slice(0, 40));
  const ctx = conv ? await contextOf(conv.organizationId, conv.leadId) : null;
  return conv && ctx ? { ctx, conv } : null;
}

const standing = (ctx: Ctx, c: Conversation): string =>
  c.status === "booked" && c.bookedAt ? `Booked for ${whenOf(ctx, c.bookedAt)}.` : c.status === "countered" && c.counter ? `Waiting for ${c.name} to say yes to ${whenOf(ctx, c.counter)}.` : c.status === "offered" ? `${c.name} has been offered open times.` : c.status === "asked" && c.request ? `${c.name} now asks for ${c.request.label}.` : "SmartBook has stopped on this lead.";

export async function requestView(token: string): Promise<RequestView | null> {
  const found = await requestOf(token);
  if (!found) return null;
  const { ctx, conv } = found;
  const req = conv.request;
  const open = conv.status === "asked" && !!req && req.token === token;
  return {
    company: ctx.org.name?.trim() || "Your company",
    name: conv.name,
    asked: req?.label ?? "a visit",
    calendar: req && open ? await calendarWords(ctx, req) : "",
    source: leadSourceOf(ctx.lead.source).label,
    project: ctx.lead.projectType?.trim() || null,
    phone: shown(conv.phone),
    words: req?.words || null,
    exact: !!req?.at,
    day: req?.day ?? null,
    open,
    now: open ? null : standing(ctx, conv),
  };
}

/** The company answers from the email's page. The request must still be the one the email was about. */
export async function requestDecide(token: string, d: Decision, now = new Date()): Promise<{ ok: true; line: string } | { ok: false; error: string }> {
  const found = await requestOf(token);
  if (!found) return { ok: false, error: "This link is not active." };
  const { conv } = found;
  if (conv.status !== "asked" || conv.request?.token !== token) return { ok: false, error: `Already answered — ${standing(found.ctx, conv)}` };
  const line = await decideRequest(conv.organizationId, conv.leadId, d, { now });
  return line ? { ok: true, line } : { ok: false, error: "Busy for a moment — please try again." };
}
