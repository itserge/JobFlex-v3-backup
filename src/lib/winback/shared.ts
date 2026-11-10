// BRING CLIENTS BACK (Smart CRM part 6, 2026-11-10) — the pure half: what a smart list is, who is on it, how it
// reads back in plain words, and the rules a campaign sends by. No database, no clock of its own, no model.
//
// A SMART LIST is a filter over the company's own clients ("bought from us, nothing for a year"). The person
// either picks a ready list or types it in their own words; the model only fills this filter in — the people on
// the list are always counted by the code below, from the company's records, and the sentence the person reads
// back is built here from the filter, never by the model.
//
// A CAMPAIGN is one email to the people on a list. Email only: a marketing text needs the client's written
// consent, which JobFlex does not collect yet.

import { z } from "zod";

// ── the filter ───────────────────────────────────────────────────────────────

/** won = bought at least once · lost = was quoted, never bought, and a quote was declined or ran out ·
 *  open = a quote is still out and nothing was bought · none = a client on file who was never quoted. */
export const HAD = ["won", "lost", "open", "none"] as const;
export type Had = (typeof HAD)[number];
export const PLAN_STATES = ["active", "ended", "never"] as const;
export type PlanState = (typeof PLAN_STATES)[number];

/** Every field is nullable, not optional: the model fills the same shape (strict function arguments). */
export const listFilter = z.object({
  had: z.enum(HAD).nullable().describe("won = bought at least once; lost = quoted but never bought, a quote was declined or expired; open = a quote is still out, nothing bought; none = never quoted. null = anyone"),
  quietMonths: z.number().int().min(1).max(120).nullable().describe("nothing new with them — no quote, job or payment, and no word from them — for at least this many months"),
  activeMonths: z.number().int().min(1).max(120).nullable().describe("a quote, job, payment or a word from them within the last this many months"),
  lastJobMinMonths: z.number().int().min(0).max(240).nullable().describe("their last bought job was at least this many months ago"),
  lastJobMaxMonths: z.number().int().min(1).max(240).nullable().describe("their last bought job was at most this many months ago"),
  minPaid: z.number().min(0).max(100_000_000).nullable().describe("paid at least this many dollars in total"),
  maxPaid: z.number().min(0).max(100_000_000).nullable().describe("paid at most this many dollars in total"),
  work: z.array(z.string().min(2).max(40)).max(6).nullable().describe("kinds of work, one or two words each ('deck', 'roof', 'water heater'); a client matches when any of their jobs or quotes mentions one"),
  places: z.array(z.string().min(2).max(60)).max(8).nullable().describe("city names or ZIP codes; a client matches any one"),
  tag: z.string().min(1).max(60).nullable().describe("a tag on the client, exactly as the company labels it"),
  plan: z.enum(PLAN_STATES).nullable().describe("service plan: active = has one now; ended = had one, none now; never = never had one"),
  minRating: z.number().int().min(1).max(5).nullable().describe("left a review with at least this many stars"),
  builtBefore: z.number().int().min(1700).max(2100).nullable().describe("house built before this year"),
  builtAfter: z.number().int().min(1700).max(2100).nullable().describe("house built in or after this year"),
  minSqft: z.number().int().min(100).max(100_000).nullable().describe("house living area of at least this many square feet"),
});
export type ListFilter = z.infer<typeof listFilter>;

export const EMPTY_FILTER: ListFilter = {
  had: null, quietMonths: null, activeMonths: null, lastJobMinMonths: null, lastJobMaxMonths: null, minPaid: null, maxPaid: null,
  work: null, places: null, tag: null, plan: null, minRating: null, builtBefore: null, builtAfter: null, minSqft: null,
};

const tidyList = (xs: string[] | null | undefined, max: number): string[] | null => {
  const out: string[] = [];
  for (const x of xs ?? []) {
    const v = x.replace(/\s+/g, " ").trim().toLowerCase();
    if (v.length >= 2 && !out.includes(v)) out.push(v);
  }
  return out.length ? out.slice(0, max) : null;
};

/** A stored or model-made filter, made safe: unknown keys dropped, lists tidied, crossed ranges put right.
 *  Anything unreadable comes back as the empty filter. */
export function tidyFilter(raw: unknown): ListFilter {
  // Field by field: one bad value (a model's "work": ["x"], a hand-edited row) costs that one rule, never the whole list.
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const f: ListFilter = { ...EMPTY_FILTER };
  for (const k of Object.keys(EMPTY_FILTER) as (keyof ListFilter)[]) {
    const v = k === "work" || k === "places" ? tidyList(Array.isArray(src[k]) ? (src[k] as unknown[]).filter((x): x is string => typeof x === "string") : null, k === "work" ? 6 : 8) : src[k];
    const got = listFilter.shape[k].safeParse(v ?? null);
    if (got.success) (f as Record<string, unknown>)[k] = got.data;
  }
  f.tag = f.tag?.trim() || null;
  if (f.lastJobMinMonths !== null && f.lastJobMaxMonths !== null && f.lastJobMinMonths > f.lastJobMaxMonths) [f.lastJobMinMonths, f.lastJobMaxMonths] = [f.lastJobMaxMonths, f.lastJobMinMonths];
  if (f.minPaid !== null && f.maxPaid !== null && f.minPaid > f.maxPaid) [f.minPaid, f.maxPaid] = [f.maxPaid, f.minPaid];
  if (f.builtAfter !== null && f.builtBefore !== null && f.builtAfter >= f.builtBefore) [f.builtAfter, f.builtBefore] = [f.builtBefore, f.builtAfter];
  if (f.quietMonths !== null && f.activeMonths !== null) f.activeMonths = null; // "quiet" and "active" can't both hold; quiet is what win-back asks for
  if (f.minPaid === 0) f.minPaid = null;
  return f;
}

export function parseFilter(json: string | null | undefined): ListFilter {
  if (!json) return { ...EMPTY_FILTER };
  try {
    return tidyFilter(JSON.parse(json));
  } catch {
    return { ...EMPTY_FILTER };
  }
}

export const isEmptyFilter = (f: ListFilter): boolean => (Object.keys(EMPTY_FILTER) as (keyof ListFilter)[]).every((k) => f[k] === null);
/** The filter asks about the house — so clients whose house facts were never looked up can't be on it. */
export const asksAboutHouse = (f: ListFilter): boolean => f.builtBefore !== null || f.builtAfter !== null || f.minSqft !== null;

// ── one client, as the filter sees them ──────────────────────────────────────

export interface ClientStats {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  zip: string | null;
  tags: string[];
  /** Dollars received from them, all time. */
  paid: number;
  /** Quotes they bought · quotes declined or run out · quotes still out · all quotes that went to them. */
  won: number;
  lost: number;
  open: number;
  quotes: number;
  /** The newest thing on record with them: a quote, a job, a payment, or a message FROM them. The company's own
   *  emails don't count — a campaign must not make a quiet client look active. Null when there is nothing. */
  lastAt: Date | null;
  /** The last job they bought: the day it finished, else the day they said yes. */
  lastJobAt: Date | null;
  /** What the last bought job was called. */
  lastJob: string | null;
  /** Every quote's and job's title and trade, lower case, for the "work" words. */
  work: string;
  plan: PlanState;
  /** Their best review, in stars. */
  rating: number | null;
  yearBuilt: number | null;
  sqft: number | null;
  createdAt: Date;
}

/** N calendar months before `now` (Jan 31 − 1 month = Dec 31; clamps to the month's last day). */
export function monthsBefore(now: Date, n: number): Date {
  const d = new Date(now.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export function matchClient(f: ListFilter, c: ClientStats, now: Date): boolean {
  if (f.had === "won" && c.won < 1) return false;
  if (f.had === "lost" && !(c.won === 0 && c.lost > 0)) return false;
  if (f.had === "open" && !(c.won === 0 && c.open > 0)) return false;
  if (f.had === "none" && c.quotes > 0) return false;
  if (f.quietMonths !== null && (c.lastAt ?? c.createdAt).getTime() > monthsBefore(now, f.quietMonths).getTime()) return false;
  if (f.activeMonths !== null && !(c.lastAt && c.lastAt.getTime() >= monthsBefore(now, f.activeMonths).getTime())) return false;
  if (f.lastJobMinMonths !== null && !(c.lastJobAt && c.lastJobAt.getTime() <= monthsBefore(now, f.lastJobMinMonths).getTime())) return false;
  if (f.lastJobMaxMonths !== null && !(c.lastJobAt && c.lastJobAt.getTime() >= monthsBefore(now, f.lastJobMaxMonths).getTime())) return false;
  if (f.minPaid !== null && c.paid < f.minPaid) return false;
  if (f.maxPaid !== null && c.paid > f.maxPaid) return false;
  if (f.work?.length && !f.work.some((w) => c.work.includes(w.toLowerCase()))) return false;
  if (f.places?.length) {
    const city = (c.city ?? "").trim().toLowerCase();
    const zip = (c.zip ?? "").trim();
    if (!f.places.some((p) => (/^\d{3,}/.test(p) ? !!zip && zip.startsWith(p.slice(0, 5)) : !!city && city === p.toLowerCase()))) return false;
  }
  if (f.tag && !c.tags.some((t) => t.toLowerCase() === f.tag!.toLowerCase())) return false;
  if (f.plan && c.plan !== f.plan) return false;
  if (f.minRating !== null && !(c.rating !== null && c.rating >= f.minRating)) return false;
  if (f.builtBefore !== null && !(c.yearBuilt !== null && c.yearBuilt < f.builtBefore)) return false;
  if (f.builtAfter !== null && !(c.yearBuilt !== null && c.yearBuilt >= f.builtAfter)) return false;
  if (f.minSqft !== null && !(c.sqft !== null && c.sqft >= f.minSqft)) return false;
  return true;
}

// ── the filter in plain words (built by code, read back to the person) ───────

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const span = (m: number) => (m % 12 === 0 && m >= 12 ? (m === 12 ? "a year" : `${m / 12} years`) : m === 1 ? "a month" : `${m} months`);
const orList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
const cap = (s: string) => s.replace(/\b[a-z]/g, (m) => m.toUpperCase());

export interface FilterPart {
  key: keyof ListFilter | "lastJob" | "paid" | "built";
  /** The filter fields this part stands for — what taking the chip off clears. */
  clears: (keyof ListFilter)[];
  text: string;
}

/** Each rule of the filter as a short phrase — the chips on the page, and the pieces of the sentence. */
export function filterParts(f: ListFilter): FilterPart[] {
  const out: FilterPart[] = [];
  if (f.had === "won") out.push({ key: "had", clears: ["had"], text: "bought from you" });
  if (f.had === "lost") out.push({ key: "had", clears: ["had"], text: "got a quote and never bought" });
  if (f.had === "open") out.push({ key: "had", clears: ["had"], text: "have a quote still out" });
  if (f.had === "none") out.push({ key: "had", clears: ["had"], text: "were never sent a quote" });
  if (f.quietMonths !== null) out.push({ key: "quietMonths", clears: ["quietMonths"], text: `nothing new with them for ${span(f.quietMonths)} or more` });
  if (f.activeMonths !== null) out.push({ key: "activeMonths", clears: ["activeMonths"], text: `in touch within the last ${span(f.activeMonths)}` });
  if (f.lastJobMinMonths !== null && f.lastJobMaxMonths !== null) out.push({ key: "lastJob", clears: ["lastJobMinMonths", "lastJobMaxMonths"], text: `last job ${f.lastJobMinMonths} to ${f.lastJobMaxMonths} months ago` });
  else if (f.lastJobMinMonths !== null) out.push({ key: "lastJob", clears: ["lastJobMinMonths"], text: `last job ${span(f.lastJobMinMonths)} ago or longer` });
  else if (f.lastJobMaxMonths !== null) out.push({ key: "lastJob", clears: ["lastJobMaxMonths"], text: `last job within ${span(f.lastJobMaxMonths)}` });
  if (f.minPaid !== null && f.maxPaid !== null) out.push({ key: "paid", clears: ["minPaid", "maxPaid"], text: `paid ${usd(f.minPaid)} to ${usd(f.maxPaid)} in total` });
  else if (f.minPaid !== null) out.push({ key: "paid", clears: ["minPaid"], text: `paid ${usd(f.minPaid)} or more in total` });
  else if (f.maxPaid !== null) out.push({ key: "paid", clears: ["maxPaid"], text: `paid ${usd(f.maxPaid)} or less in total` });
  if (f.work?.length) out.push({ key: "work", clears: ["work"], text: `work: ${orList(f.work)}` });
  if (f.places?.length) out.push({ key: "places", clears: ["places"], text: `in ${orList(f.places.map((p) => (/^\d/.test(p) ? p : cap(p))))}` });
  if (f.tag) out.push({ key: "tag", clears: ["tag"], text: `tagged "${f.tag}"` });
  if (f.plan === "active") out.push({ key: "plan", clears: ["plan"], text: "on a service plan now" });
  if (f.plan === "ended") out.push({ key: "plan", clears: ["plan"], text: "service plan ended" });
  if (f.plan === "never") out.push({ key: "plan", clears: ["plan"], text: "never had a service plan" });
  if (f.minRating !== null) out.push({ key: "minRating", clears: ["minRating"], text: f.minRating >= 5 ? "left a 5-star review" : `left a review of ${f.minRating} stars or more` });
  if (f.builtAfter !== null && f.builtBefore !== null) out.push({ key: "built", clears: ["builtAfter", "builtBefore"], text: `house built ${f.builtAfter} to ${f.builtBefore - 1}` });
  else if (f.builtBefore !== null) out.push({ key: "built", clears: ["builtBefore"], text: `house built before ${f.builtBefore}` });
  else if (f.builtAfter !== null) out.push({ key: "built", clears: ["builtAfter"], text: `house built in ${f.builtAfter} or later` });
  if (f.minSqft !== null) out.push({ key: "minSqft", clears: ["minSqft"], text: `house of ${f.minSqft.toLocaleString("en-US")} sq ft or more` });
  return out;
}

/** "Clients who bought from you · nothing with them for a year or more." — or "Every client" for the empty filter. */
export function filterWords(f: ListFilter): string {
  const parts = filterParts(f).map((p) => p.text);
  return parts.length ? `Clients: ${parts.join(" · ")}.` : "Every client on file.";
}

/** The filter without one chip. */
export function withoutPart(f: ListFilter, part: FilterPart): ListFilter {
  const next = { ...f };
  for (const k of part.clears) (next as Record<string, unknown>)[k] = null;
  return next;
}

// ── ready lists ──────────────────────────────────────────────────────────────

export interface ReadyList {
  key: string;
  name: string;
  /** One line under the name: why this list is worth a message. */
  why: string;
  filter: ListFilter;
}

export const READY_LISTS: ReadyList[] = [
  { key: "quiet-year", name: "Bought once, quiet for a year", why: "They know your work. A short hello is often enough.", filter: { ...EMPTY_FILTER, had: "won", quietMonths: 12 } },
  { key: "year-on", name: "Job finished about a year ago", why: "A good moment for a check-up or the next project.", filter: { ...EMPTY_FILTER, had: "won", lastJobMinMonths: 10, lastJobMaxMonths: 14 } },
  { key: "lost-quotes", name: "Got a quote, never bought", why: "Plans change. Some are ready now.", filter: { ...EMPTY_FILTER, had: "lost", quietMonths: 3 } },
  { key: "happy", name: "Happy clients", why: "Left 4 or 5 stars. The best people to ask for the next job or a referral.", filter: { ...EMPTY_FILTER, minRating: 4 } },
  { key: "big", name: "Biggest clients", why: "Paid $10,000 or more in total.", filter: { ...EMPTY_FILTER, minPaid: 10_000 } },
  { key: "plan-ended", name: "Service plan ended", why: "They had a plan and don't now.", filter: { ...EMPTY_FILTER, plan: "ended" } },
  { key: "older-homes", name: "Older homes", why: "Built before 1995: roofs, decks and systems are coming due.", filter: { ...EMPTY_FILTER, builtBefore: 1995 } },
];
export const readyList = (key: string): ReadyList | null => READY_LISTS.find((r) => r.key === key) ?? null;

// ── the campaign's rules ─────────────────────────────────────────────────────

/** The most people one campaign goes to. A bigger list is cut to the first of these (best clients first). */
export const MAX_PER_CAMPAIGN = 500;
/** How many leave in one go: right away on Send, then again each hour until the campaign is done. */
export const BATCH = 40;
/** The most campaign emails one company sends in a day, over all its campaigns. */
export const MAX_PER_DAY = 200;
/** A client gets at most one campaign in this many days, whichever list they are on. */
export const REST_DAYS = 30;
/** Campaign email leaves between these hours on the company's clock. */
export const SEND_FROM_HOUR = 8;
export const SEND_TO_HOUR = 20;

/** How fast a campaign of n emails goes out, in a sentence — the page's Send step and the Operator's read-back. */
export function paceWords(n: number): string {
  if (n <= BATCH) return "They all leave right away (between 8 AM and 8 PM your time).";
  if (n <= MAX_PER_DAY) return `${BATCH} leave each hour between 8 AM and 8 PM your time, so it takes about ${Math.ceil(n / BATCH)} hours.`;
  return `${BATCH} leave each hour, up to ${MAX_PER_DAY} a day, so it takes about ${Math.ceil(n / MAX_PER_DAY)} days.`;
}

export const CAMPAIGN_STATUSES = ["DRAFT", "SENDING", "SENT", "CANCELED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
/** SENDING = claimed by one sender, the email is on its way out (a row stuck here is closed as FAILED, never re-sent). */
export const RECIPIENT_STATUSES = ["QUEUED", "SENDING", "SENT", "SKIPPED", "FAILED"] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const SKIP_REASONS = ["no-email", "bad-email", "opted-out", "rested", "twice", "over", "stopped", "gone"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export const SKIP_WORDS: Record<SkipReason, string> = {
  "no-email": "no email on file",
  "bad-email": "the email on file isn't a real address",
  "opted-out": "asked not to get these emails",
  rested: `already got a campaign in the last ${REST_DAYS} days`,
  twice: "shares an email with someone already on the list",
  over: `past the ${MAX_PER_CAMPAIGN} people one campaign goes to`,
  stopped: "the campaign was stopped first",
  gone: "no longer a client on file",
};

export const emailKey = (email: string | null | undefined): string => (email ?? "").trim().toLowerCase();
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
export const looksLikeEmail = (email: string): boolean => email.length <= 254 && EMAIL_RE.test(email);

export interface SendContext {
  /** Lower-case addresses that asked this company to stop. */
  optedOut: ReadonlySet<string>;
  /** Client id → when they last got a campaign from this company. */
  lastCampaignAt: ReadonlyMap<string, Date>;
  /** Lower-case address → when that inbox last got one. Two clients can share an inbox (a couple, an office);
   *  the rest is the inbox's, or the second client's copy would land there a day after the first's. */
  lastInboxAt?: ReadonlyMap<string, Date>;
  now: Date;
}

/** Who on the list gets the email and who is left out, with the reason. The order of `people` is kept. */
export function chooseRecipients(people: ClientStats[], ctx: SendContext): { send: ClientStats[]; skip: { client: ClientStats; reason: SkipReason }[] } {
  const send: ClientStats[] = [];
  const skip: { client: ClientStats; reason: SkipReason }[] = [];
  const seen = new Set<string>();
  const restFrom = ctx.now.getTime() - REST_DAYS * 86_400_000;
  for (const c of people) {
    const key = emailKey(c.email);
    const mine = ctx.lastCampaignAt.get(c.id);
    const inbox = key ? ctx.lastInboxAt?.get(key) : undefined;
    const last = mine && inbox ? (mine.getTime() > inbox.getTime() ? mine : inbox) : mine ?? inbox;
    const reason: SkipReason | null = !key ? "no-email" : !looksLikeEmail(key) ? "bad-email" : ctx.optedOut.has(key) ? "opted-out" : last && last.getTime() > restFrom ? "rested" : seen.has(key) ? "twice" : null;
    if (reason) skip.push({ client: c, reason });
    else {
      seen.add(key);
      send.push(c);
    }
  }
  return { send, skip };
}

/** "3 have no email on file · 1 asked not to get these emails" — the left-out people, counted by reason. */
/** Why one person is left out, in a few words — beside their name on the list. */
export const SKIP_SHORT: Record<SkipReason, string> = {
  "no-email": "no email",
  "bad-email": "email isn't a real address",
  "opted-out": "unsubscribed",
  rested: `got a campaign in the last ${REST_DAYS} days`,
  twice: "shares an email with someone above",
  over: "past the limit",
  stopped: "not sent",
  gone: "no longer on file",
};

export function skipSummary(skip: { reason: SkipReason }[]): string[] {
  const n = new Map<SkipReason, number>();
  for (const s of skip) n.set(s.reason, (n.get(s.reason) ?? 0) + 1);
  return SKIP_REASONS.filter((r) => n.has(r)).map((r) => {
    const k = n.get(r)!;
    if (r === "no-email") return `${k} ${k === 1 ? "has" : "have"} no email on file`;
    if (r === "bad-email") return `${k} ${k === 1 ? "has" : "have"} an email that isn't a real address`;
    if (r === "opted-out") return `${k} asked not to get these emails`;
    if (r === "rested") return `${k} already got a campaign in the last ${REST_DAYS} days`;
    if (r === "over") return `${k} past the ${MAX_PER_CAMPAIGN} people one campaign goes to`;
    if (r === "stopped") return `${k} not sent — the campaign was stopped`;
    if (r === "gone") return `${k} no longer on file`;
    return `${k} ${k === 1 ? "shares" : "share"} an email with someone already on the list`;
  });
}

/** Best clients first: the most paid, then the most recent. The order a cut list keeps and an email batch leaves in. */
export function byWorth(a: ClientStats, b: ClientStats): number {
  return b.paid - a.paid || (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0) || a.name.localeCompare(b.name);
}

// ── the message ──────────────────────────────────────────────────────────────

export const SUBJECT_MAX = 120;
export const BODY_MAX = 3000;
export const campaignText = z.object({
  subject: z.string().trim().min(3, "Give the email a subject.").max(SUBJECT_MAX, "Keep the subject under 120 characters."),
  body: z.string().trim().min(20, "Write a few words for the email.").max(BODY_MAX, "Keep the email under 3,000 characters."),
});

/** "Dana and Lee Whitfield" → "Dana"; "WHITFIELD LLC" → null (a company has no first name). */
export function firstNameOf(name: string): string | null {
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (!/^[A-Za-zÀ-ÿ'’-]{2,}$/.test(first)) return null;
  if (/\b(llc|inc|corp|co|ltd|company|group|homes|properties|hoa|church|school)\b/i.test(name)) return null;
  return first[0].toUpperCase() + first.slice(1).toLowerCase();
}

export const MERGE_TAGS = ["{first name}", "{name}", "{company}", "{last job}"] as const;

/** The email's words for one client. Unknown {tags} are left out rather than sent as written, and a greeting whose
 *  name is missing falls back to "Hi there". */
export function fillWords(text: string, who: { name: string; company: string; lastJob?: string | null }): string {
  const first = firstNameOf(who.name);
  return text
    .replace(/\{\s*first\s*name\s*\}/gi, first ?? "there")
    .replace(/\{\s*name\s*\}/gi, who.name.trim() || "there")
    .replace(/\{\s*company\s*\}/gi, who.company.trim())
    .replace(/\{\s*last\s*job\s*\}/gi, who.lastJob?.trim() || "your project")
    .replace(/\{[^{}\n]{0,40}\}/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?])/g, "$1");
}

/** What the model may not put in a campaign: a link, an address to write to, a price or a percent off it made up. */
export function draftProblem(subject: string, body: string): string | null {
  const all = `${subject}\n${body}`;
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|app)\b/i.test(all)) return "a link";
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(all)) return "an email address";
  if (/\$\s?\d|\d\s?%|\b\d+\s?(percent|dollars)\b/i.test(all)) return "a price or a discount";
  if (/\[[^\]\n]{1,40}\]|<[^>\n]{1,40}>/.test(all)) return "a blank left to fill in";
  return null;
}

/** The standard words, used when there is no AI or its draft was thrown away. */
export function standardDraft(listName: string, company: string, filter?: ListFilter | null): { subject: string; body: string } {
  const close = `Just reply to this email and we'll set up a time.\n\n${company}`;
  // People who were quoted and never bought are not thanked for work that never happened.
  if (neverBought(filter)) {
    const opener = filter?.had === "none" ? "It's been a while since we were last in touch, and we wanted to say hello." : "A while back we put together a quote for you, and we wanted to check in.";
    return {
      subject: `Checking in from ${company}`,
      body: `Hi {first name},\n\n${opener}\n\nPlans change. If the project is back on your mind, or there's something else around the house you'd like done, we'd be glad to take a fresh look. ${close}`,
    };
  }
  return {
    subject: `A quick hello from ${company}`,
    body: `Hi {first name},\n\nIt's been a while since we worked together, and we wanted to say thank you again.\n\nIf there's anything around the house you've been meaning to get done, we'd be glad to take a look. ${close}`,
  };
}

/** Is this a list of people who never bought (quoted and lost, a quote still out, or never quoted)? */
export const neverBought = (filter?: ListFilter | null): boolean => filter?.had === "lost" || filter?.had === "open" || filter?.had === "none";

/** Words about finished work, which a draft for people who never bought must not carry. */
export function pastWorkProblem(body: string): string | null {
  if (/\{last job\}/i.test(body)) return "names a last job";
  if (/\b(since we (finished|completed|built|installed|worked)|thank you again|working with you again|the (work|job|project) we did)\b/i.test(body)) return "speaks of work that was never done";
  return null;
}

// ── what came of it ──────────────────────────────────────────────────────────

/** How long after the email a new quote or job still counts as "came back". */
export const CAME_BACK_DAYS = 60;

export interface CampaignCounts {
  queued: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Clients who wrote back after it. */
  replied: number;
  /** Clients with a new quote or job after it. */
  cameBack: number;
  /** Of those, how many bought, and for how much. */
  won: number;
  wonValue: number;
  /** Clients who used the email's unsubscribe link. */
  optedOut: number;
}

/** "Sent to 42 · 5 wrote back · 3 came back · 1 bought ($8,400)". */
export function outcomeWords(c: CampaignCounts): string {
  const bits = [`Sent to ${c.sent}`];
  if (c.queued) bits.push(`${c.queued} still to go`);
  if (c.replied) bits.push(`${c.replied} wrote back`);
  if (c.cameBack) bits.push(`${c.cameBack} came back`);
  if (c.won) bits.push(`${c.won} bought (${usd(c.wonValue)})`);
  if (c.failed) bits.push(`${c.failed} didn't go`);
  if (c.optedOut) bits.push(`${c.optedOut} unsubscribed`);
  return bits.join(" · ");
}

/** Is it an hour campaign email may leave in, on the company's clock? */
export function inSendHours(now: Date, tz: string): boolean {
  let hour: number;
  try {
    hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  } catch {
    hour = now.getUTCHours();
  }
  return hour >= SEND_FROM_HOUR && hour < SEND_TO_HOUR;
}

/** One email that left: who got it, when, from which campaign. */
export interface SentRow {
  campaignId: string;
  clientId: string;
  sentAt: Date;
}
/** Something a client did afterwards. `value` only on a quote they bought. */
export interface AfterEvent {
  clientId: string;
  at: Date;
  kind: "reply" | "quote" | "job" | "won";
  value?: number;
}

/** Which campaign gets the credit: the LAST one the client got before the event, and only inside CAME_BACK_DAYS —
 *  so a client on two campaigns is never counted for both. Counts are of clients, not of events. */
export function creditOutcomes(sent: SentRow[], events: AfterEvent[]): Map<string, { replied: number; cameBack: number; won: number; wonValue: number }> {
  const byClient = new Map<string, SentRow[]>();
  for (const r of sent) byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), r]);
  for (const rows of byClient.values()) rows.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const seen = { reply: new Set<string>(), back: new Set<string>(), won: new Set<string>() };
  const out = new Map<string, { replied: number; cameBack: number; won: number; wonValue: number }>();
  const windowMs = CAME_BACK_DAYS * 86_400_000;
  for (const e of events) {
    const rows = byClient.get(e.clientId);
    if (!rows) continue;
    let hit: SentRow | null = null;
    for (const r of rows) if (r.sentAt.getTime() <= e.at.getTime()) hit = r;
    if (!hit || e.at.getTime() - hit.sentAt.getTime() > windowMs) continue;
    const c = out.get(hit.campaignId) ?? { replied: 0, cameBack: 0, won: 0, wonValue: 0 };
    const key = `${hit.campaignId}:${e.clientId}`;
    if (e.kind === "reply") {
      if (!seen.reply.has(key)) c.replied += 1;
      seen.reply.add(key);
    } else {
      if (!seen.back.has(key)) c.cameBack += 1;
      seen.back.add(key);
      if (e.kind === "won") {
        if (!seen.won.has(key)) c.won += 1;
        seen.won.add(key);
        c.wonValue += e.value ?? 0;
      }
    }
    out.set(hit.campaignId, c);
  }
  return out;
}

// ── a list from typed words, without the model ───────────────────────────────

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, twelve: 12, eighteen: 18 };
const WORK_WORDS = ["deck", "roof", "fence", "gutter", "siding", "window", "door", "paint", "kitchen", "bath", "floor", "furnace", "heat pump", "water heater", "ac", "hvac", "lawn", "patio", "concrete", "drywall", "plumbing", "electrical", "remodel", "addition", "garage"];

/** How many months "a year", "18 months", "two years" is; null when the words name no span. */
function monthsIn(text: string): number | null {
  const m = /(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|twelve|eighteen)\s*(year|yr|month|mo)s?\b/i.exec(text);
  if (!m) return null;
  const n = NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.round(/^y/i.test(m[2]) ? n * 12 : n));
}

/** The plain rules that read a typed list when there is no AI (or it gave nothing usable). They catch the common
 *  asks — bought / never bought, how long quiet, how much paid, the kind of work, a ZIP, stars, a year built —
 *  and leave the rest: the person sees the chips and can change them. */
export function rulesFilter(words: string): ListFilter {
  const t = ` ${words.toLowerCase().replace(/\s+/g, " ")} `;
  const f: ListFilter = { ...EMPTY_FILTER };
  if (/never (bought|hired|signed|went ahead)|didn'?t (buy|sign|go ahead|hire)|declined|turned (us|it) down|lost (quote|bid|proposal)s?|said no/.test(t)) f.had = "lost";
  else if (/still (out|open|waiting)|open (quote|bid|proposal)s?|haven'?t (answered|decided)/.test(t)) f.had = "open";
  else if (/never (quoted|sent a quote|got a quote)|no (quote|proposal)s? yet/.test(t)) f.had = "none";
  else if (/\b(bought|past (client|customer)s?|hired us|worked with|did (a |work|jobs?)|we (built|did|installed|replaced|finished)|finished|completed)\b/.test(t)) f.had = "won";

  const quiet = /(quiet|silent|not heard|haven'?t heard|no contact|nothing|not (?:been )?in touch|gone cold|inactive)[^.]*?(for|in|over|since)?\s*((?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|twelve|eighteen)\s*(?:year|yr|month|mo)s?)/.exec(t);
  const ago = /((?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|twelve|eighteen)\s*(?:year|yr|month|mo)s?)\s*(ago|back)/.exec(t);
  const over = /(over|more than|at least)\s*((?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|twelve|eighteen)\s*(?:year|yr|month|mo)s?)\s*(ago|back)?/.exec(t);
  if (quiet) f.quietMonths = monthsIn(quiet[3]);
  else if (ago && /(job|project|work|finished|built|installed|replaced|did)/.test(t)) {
    const m = monthsIn(ago[1]);
    if (m) {
      if (/(about|around|roughly)/.test(t)) [f.lastJobMinMonths, f.lastJobMaxMonths] = [Math.max(0, m - 2), m + 2];
      else f.lastJobMinMonths = m;
      f.had = f.had ?? "won";
    }
  } else if (over && /(year|month)/.test(over[2]) && !/\$/.test(over[0])) f.quietMonths = monthsIn(over[2]);

  const money = /(paid|spent|worth|over|more than|at least|above)\s*(?:us\s*)?(?:over|more than|at least)?\s*\$\s?([\d,]+(?:\.\d+)?)\s*(k)?/.exec(t);
  if (money) f.minPaid = Number(money[2].replace(/,/g, "")) * (money[3] ? 1000 : 1);
  const under = /(under|less than|below)\s*\$\s?([\d,]+(?:\.\d+)?)\s*(k)?/.exec(t);
  if (under) f.maxPaid = Number(under[2].replace(/,/g, "")) * (under[3] ? 1000 : 1);

  const work = WORK_WORDS.filter((w) => new RegExp(`\\b${w}s?\\b`).test(t));
  if (work.length) f.work = work.slice(0, 6);
  const zips = [...t.matchAll(/(?<![$\d,.])\b(\d{5})\b(?![,.]?\d)/g)].map((m) => m[1]);
  if (zips.length) f.places = zips.slice(0, 8);
  const stars = /(\d)\s*[- ]?\s*stars?/.exec(t);
  if (stars) f.minRating = Math.min(5, Math.max(1, Number(stars[1])));
  else if (/happy|good review|great review|loved/.test(t)) f.minRating = 4;
  const before = /(built|homes?|houses?)[^.]*?\b(before|older than|prior to)\s*((?:19|20)\d\d)/.exec(t);
  const after = /(built|homes?|houses?)[^.]*?\b(after|since|newer than)\s*((?:19|20)\d\d)/.exec(t);
  if (before) f.builtBefore = Number(before[3]);
  if (after) f.builtAfter = Number(after[3]) + (/(after|newer than)/.test(after[2]) ? 1 : 0);
  if (/plan (ended|expired|lapsed|ran out)|(ended|expired|lapsed|old) (service |maintenance )?plan/.test(t)) f.plan = "ended";
  else if (/on a (service |maintenance )?plan|plan members?/.test(t)) f.plan = "active";
  return tidyFilter(f);
}

// ── house facts ──────────────────────────────────────────────────────────────

export const HOUSE_SOURCES = ["hand", "parcel", "county", "none"] as const;
export type HouseSource = (typeof HOUSE_SOURCES)[number];
export const HOUSE_SOURCE_WORDS: Record<HouseSource, string> = { hand: "typed in", parcel: "property records", county: "county assessor", none: "not found" };
/** How many clients one press of "Look up house facts" works through. Free public sources only. */
export const HOUSE_BATCH = 20;
/** A lookup that found nothing is tried again after this many days. */
export const HOUSE_RETRY_DAYS = 90;

export function houseWords(h: { yearBuilt: number | null; sqft: number | null; storeys?: number | null }): string | null {
  const bits: string[] = [];
  if (h.yearBuilt) bits.push(`built ${h.yearBuilt}`);
  if (h.sqft) bits.push(`${h.sqft.toLocaleString("en-US")} sq ft`);
  if (h.storeys) bits.push(h.storeys === 1 ? "1 storey" : `${h.storeys} storeys`);
  return bits.length ? bits.join(" · ") : null;
}

/** The street line of an address as typed ("412 Alder St, Bellevue, WA 98004" → "412 Alder St"). */
export const streetLineOf = (address: string): string => address.split(",")[0].replace(/\s+/g, " ").trim();
/** The five-digit ZIP in a typed address, if it carries one. */
export const zipIn = (address: string | null | undefined): string | null => /\b(\d{5})(?:-\d{4})?\s*$/.exec((address ?? "").trim())?.[1] ?? null;
/** The whole address on one line for a geocoder, without saying the city or ZIP twice. */
export function oneLineAddress(c: { address: string | null; city: string | null; state: string | null; zip: string | null }): string | null {
  const street = (c.address ?? "").replace(/\s+/g, " ").trim();
  if (street.length < 5 || !/\d/.test(street)) return null;
  const has = (v: string | null) => !!v && street.toLowerCase().includes(v.trim().toLowerCase());
  const rest = [c.city, c.state, c.zip].filter((v): v is string => !!v?.trim() && !has(v)).map((v) => v.trim());
  return [street, ...rest].join(", ");
}

export const houseFacts = z.object({
  yearBuilt: z.number().int().min(1700).max(2100).nullable(),
  livingSqft: z.number().int().min(100).max(100_000).nullable(),
});

/** The fine print under every campaign email (and in the page's preview): why they got it, and the sender's
 *  mailing address — the law (CAN-SPAM) asks for the address; the unsubscribe link sits right after it. */
export const campaignFine = (company: { name: string; address: string }): string =>
  `You're getting this because you've been in touch with ${company.name}. ${company.name} · ${company.address.replace(/\s*\n\s*/g, ", ")}.`;
