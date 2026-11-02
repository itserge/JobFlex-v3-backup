// SMARTBOOK · WHAT THE COMPANY'S SCREENS READ (2026-10-31, Batch 3) — server only.
//
//   leadSmartBook      the lead page's card: where it stands, the conversation, what a person can do
//   smartBookRequests  the calendar's Requests: every time a customer asked for that waits on the company
//   smartBookChips     the leads list's tag per lead
//
// The writes are the engine's (pauseSmartBook, restartSmartBook, offerTimesByHand, decideRequest, the test).
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { relative } from "@/lib/format";
import { prettyPhone } from "@/lib/aiDesk/shared";
import { leadSourceOf } from "@/lib/leads/sources";
import { TRAIL_KINDS } from "@/lib/activityLog";
import { settingsOf } from "@/lib/bookingBook";
import { calendarWords, contextOf, readSmartBookSettings, whenOf } from "./engine";
import { dayKey } from "./offers";
import { smartChip, type SmartChip } from "./status";
import { isTestLead, listConvs, readConv, type Conversation } from "./store";
import { firstNameOf, whenWords } from "./words";

export interface RequestCard {
  leadId: string;
  /** "Send me a test": the tester's own, answerable like any other. */
  test: boolean;
  name: string;
  n: number;
  /** "Sat Nov 7, 9am" / "Fri Nov 6, morning". */
  asked: string;
  words: string | null;
  /** "Your calendar is free then" / "You have Johnson — roof 8–12 then". */
  calendar: string;
  source: string;
  project: string | null;
  phone: string | null;
  /** They named an exact time — Yes books it; false: a day or part of one, the company names the hour. */
  exact: boolean;
  /** YYYY-MM-DD, for the day "Suggest another time" opens on. */
  day: string | null;
  ago: string;
  askedAt: string;
}

async function cardOf(c: Conversation): Promise<RequestCard | null> {
  const req = c.request;
  if (c.status !== "asked" || !req) return null;
  const ctx = await contextOf(c.organizationId, c.leadId);
  if (!ctx) return null;
  return {
    leadId: c.leadId,
    test: !!c.test,
    name: c.name,
    n: req.n,
    asked: req.label,
    words: req.words || null,
    calendar: await calendarWords(ctx, req),
    source: c.test ? "Test" : leadSourceOf(ctx.lead.source).label,
    project: ctx.lead.projectType?.trim() || null,
    phone: c.phone ? prettyPhone(c.phone) : null,
    exact: !!req.at,
    day: req.day ?? (req.at ? dayKey(new Date(req.at), ctx.tz) : null),
    ago: relative(req.askedAt),
    askedAt: req.askedAt,
  };
}

/**
 * The requests waiting on the company, oldest first. `visible` narrows them to the leads a sales rep may open (the
 * lead page's own rule); a test shows only to the person testing.
 */
export async function smartBookRequests(organizationId: string, opts: { userId: string; visible?: (leadIds: string[]) => Promise<Set<string>> }): Promise<RequestCard[]> {
  const asked = (await listConvs(organizationId, 14)).filter((c) => c.status === "asked" && c.request && (c.test ? c.test === opts.userId : true));
  const real = asked.filter((c) => !c.test).map((c) => c.leadId);
  const allowed = opts.visible ? await opts.visible(real) : new Set(real);
  const mine = asked.filter((c) => (c.test ? true : allowed.has(c.leadId))).sort((a, b) => Date.parse(a.request!.askedAt) - Date.parse(b.request!.askedAt));
  return (await Promise.all(mine.slice(0, 20).map(cardOf))).filter((x): x is RequestCard => !!x);
}

/** The leads list's tag for each lead SmartBook talked with lately. */
export async function smartBookChips(organizationId: string): Promise<Map<string, SmartChip>> {
  const out = new Map<string, SmartChip>();
  for (const c of await listConvs(organizationId, 90)) if (!c.test) out.set(c.leadId, smartChip(c));
  return out;
}

export interface SmartLine {
  id: string;
  at: string;
  /** "Oct 31, 2:14pm" on the company's clock. */
  when: string;
  /** in: the customer · out: SmartBook · note: what happened (booked, paused, the company's answer). */
  dir: "in" | "out" | "note";
  channel: "text" | "email" | "page" | "call" | null;
  text: string;
}

export interface LeadSmartBook {
  /** SmartBook's own switch — the card still offers "Offer times" when it is off. */
  on: boolean;
  /** There is a conversation (else the card is the Offer times button). */
  started: boolean;
  chip: SmartChip | null;
  /** One line: where it stands, in words. */
  headline: string;
  /** How SmartBook reaches them now. */
  channel: "text" | "email" | null;
  offers: string[];
  counter: string | null;
  booked: string | null;
  request: RequestCard | null;
  /** "A follow-up text Tue Nov 3, 10am". */
  next: string | null;
  lines: SmartLine[];
  can: { pause: boolean; restart: boolean; offer: boolean };
  /** Why Offer times can't go (no phone or email, the lead is closed, Online booking off) — shown, button off. */
  blocked: string | null;
  /** The customer's page, to see what they see. */
  page: string | null;
}

const TIME = (d: Date, tz: string) =>
  `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).replace(/\s/g, "").toLowerCase()}`;

function nextWords(c: Conversation, tz: string): string | null {
  if (!c.next) return null;
  const at = whenWords(new Date(c.next.at), tz, 0);
  const first = firstNameOf(c.name) || "They";
  switch (c.next.what) {
    case "first-text":
      return `the first text goes ${at} (after quiet hours)`;
    case "nudge":
      return c.nudges >= 2 ? `SmartBook stops ${at} if there's no answer` : `a follow-up ${c.text ? "text" : "email"} ${at}`;
    case "call":
      return `one call ${at} if there's no answer`;
    case "remind":
      return `a reminder to you ${at}`;
    case "still-checking":
      return `${first} hears "still checking" ${at}`;
    case "reoffer":
      return `if nobody answers, ${first} gets open times ${at}`;
    case "counter-nudge":
      return `a reminder about your time ${at}`;
  }
}

function headlineOf(c: Conversation, card: RequestCard | null, when: (iso: string) => string): string {
  const first = firstNameOf(c.name) || c.name;
  switch (c.status) {
    case "offered":
      return `${c.offers.length} time${c.offers.length === 1 ? "" : "s"} sent — waiting for ${first} to pick`;
    case "countered":
      return c.counter ? `You offered ${when(c.counter)} — waiting for ${first}` : `Waiting for ${first}`;
    case "asked":
      return card ? `${first} asks for ${card.asked} — answer below` : `${first} is waiting to hear from you`;
    case "booked":
      return c.bookedAt ? `Booked for ${when(c.bookedAt)}` : "Booked";
    default:
      return c.why === "no-reply"
        ? `${first} didn't answer — SmartBook stopped`
        : c.why === "not-interested"
          ? `${first} isn't interested`
          : c.why === "handed"
            ? `${first} needs a person — SmartBook stopped`
            : c.why === "stopped"
              ? `${first} replied STOP to texts`
              : c.why === "canceled"
                ? `${first} canceled the visit`
                : `Paused — a person has it from here`;
  }
}

export async function leadSmartBook(organizationId: string, leadId: string): Promise<LeadSmartBook | null> {
  if (isTestLead(leadId)) return null;
  const [conv, smart, lead, org] = await Promise.all([
    readConv(organizationId, leadId),
    readSmartBookSettings(organizationId),
    db.lead.findFirst({ where: { id: leadId, organizationId }, select: { phone: true, email: true, status: true } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true, bookingSettingsJson: true, tradeTypesJson: true } }),
  ]);
  if (!lead || !org) return null;
  const tz = org.timezone || "America/New_York";
  const bookingOn = settingsOf(org).enabled;
  if (!conv) {
    const upcoming = await db.appointment.findFirst({ where: { organizationId, leadId, status: "SCHEDULED", startsAt: { gte: new Date() } }, select: { id: true } });
    const blocked = !lead.phone && !lead.email ? "Add a phone or an email to offer times." : ["WON", "LOST", "ARCHIVED"].includes(lead.status) ? "This lead is closed." : !bookingOn ? "Turn on Online booking first — SmartBook offers its open hours." : upcoming ? "They already have a visit on the calendar." : null;
    return { on: smart.on, started: false, chip: null, headline: "SmartBook hasn't contacted this lead.", channel: null, offers: [], counter: null, booked: null, request: null, next: null, lines: [], can: { pause: false, restart: false, offer: true }, blocked, page: null };
  }
  const ctx = await contextOf(organizationId, leadId);
  const when = (iso: string) => (ctx ? whenOf(ctx, iso) : whenWords(new Date(iso), tz, 0));
  const card = await cardOf(conv);
  const rows = await db.activityEvent.findMany({
    where: { organizationId, leadId, kind: { in: [TRAIL_KINDS.SMARTBOOK, "SMARTBOOK_ASK"] } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, kind: true, summary: true, meta: true, createdAt: true },
  });
  const lines: SmartLine[] = rows.reverse().map((r) => {
    let meta: { dir?: string; channel?: string; body?: string } = {};
    try {
      meta = r.meta ? JSON.parse(r.meta) : {};
    } catch {
      /* a line without its meta reads as a note */
    }
    const dir = r.kind === "SMARTBOOK_ASK" ? "note" : meta.dir === "in" ? "in" : meta.dir === "out" ? "out" : "note";
    const channel = meta.channel === "text" || meta.channel === "email" || meta.channel === "page" || meta.channel === "call" ? meta.channel : null;
    // The bell's own words end with what to do ("— confirm, decline …"); the history keeps what happened.
    const said = r.summary.replace(/ — (confirm, decline or offer another time|please answer them)$/, "");
    return { id: r.id, at: r.createdAt.toISOString(), when: TIME(r.createdAt, tz), dir, channel, text: (dir !== "note" && meta.body) || said };
  });
  const live = conv.status === "offered" || conv.status === "asked" || conv.status === "countered";
  return {
    on: smart.on,
    started: true,
    chip: smartChip(conv),
    headline: headlineOf(conv, card, when),
    channel: conv.text ? "text" : conv.email ? "email" : null,
    offers: conv.status === "offered" ? conv.offers.map(when) : [],
    counter: conv.status === "countered" && conv.counter ? when(conv.counter) : null,
    booked: conv.status === "booked" && conv.bookedAt ? when(conv.bookedAt) : null,
    request: card,
    next: nextWords(conv, tz),
    lines,
    can: { pause: live, restart: conv.status === "closed", offer: false },
    blocked: null,
    page: `${await appBaseUrl()}/b/${conv.token}`,
  };
}
