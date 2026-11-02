// SMARTBOOK · WHAT IT SAYS (2026-10-31). Pure.
//
// Every line SmartBook sends, to the customer and to the company, in one place so the voice stays one voice: short,
// friendly, the company's name, the times as the company's clock reads them, never a price or a promise the company
// didn't write. Texts are one line (lib/sms/format clip folds whitespace), so the times are a numbered run:
// "1) Tue Nov 4, 10am–12pm; 2) Wed Nov 5, 1–3pm". A reply in another language is translated after (understand.ts).
import type { Slot } from "@/lib/booking";
import type { DayPart } from "./offers";

const t = (d: Date, timeZone: string) =>
  d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }).replace(":00", "").replace(/\s/g, "").toLowerCase();

/** "Tue Nov 4, 10am–12pm" (the arrival window) or "Tue Nov 4, 10am" (an exact time). */
export function whenWords(startsAt: Date, timeZone: string, arrivalWindow = 0): string {
  const day = startsAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone }).replace(/,/g, "");
  if (!arrivalWindow) return `${day}, ${t(startsAt, timeZone)}`;
  const a = t(startsAt, timeZone);
  const b = t(new Date(startsAt.getTime() + arrivalWindow * 60000), timeZone);
  const sameHalf = a.slice(-2) === b.slice(-2);
  return `${day}, ${sameHalf ? a.slice(0, -2) : a}–${b}`;
}

/** "Sat Nov 8, morning" — a day the customer named without an hour. */
export function dayPartWords(day: string, part: DayPart | null, timeZone: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  const words = noon.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone }).replace(/,/g, "");
  return part ? `${words}, ${part}` : words;
}

/** "1) Tue Nov 4, 10am–12pm; 2) Wed Nov 5, 1–3pm; 3) Thu Nov 6, 8–10am" */
export function timesList(slots: readonly Slot[], timeZone: string, arrivalWindow: number): string {
  return slots.map((s, i) => `${i + 1}) ${whenWords(s.startsAt, timeZone, arrivalWindow)}`).join("; ");
}

/** "Reply 1, 2 or 3" / "Reply 1 or 2" / "Reply 1". */
export function replyNumbers(n: number): string {
  if (n <= 1) return "Reply 1";
  const xs = Array.from({ length: n }, (_, i) => String(i + 1));
  return `Reply ${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;
}

/** The first name a text greets, or nothing for a placeholder name ("Meta lead", "Caller"). */
export function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first || /^(meta|facebook|caller|lead|unknown|customer|homeowner)$/i.test(first)) return "";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export interface FirstVars {
  first: string;
  company: string;
  /** What they asked about, in their words or the form's: "roof replacement". */
  project: string | null;
  /** What the visit is, in a word: "estimate", "consultation", "visit". */
  visit: string;
  free: boolean;
  times: string;
  count: number;
  link: string;
}

/** The visit in a word, from the booking visit type's kind. */
export function visitNoun(kind: string): string {
  return kind === "estimate" ? "estimate" : kind === "consult" ? "consultation" : kind === "tune-up" ? "tune-up" : "visit";
}

/** The owner's own first message: {first name} {company} {service} {times} {link} filled; {times} added when missing. */
export function fillFirstMessage(template: string, v: FirstVars): string {
  const filled = template
    .replace(/\{\s*first\s*name\s*\}/gi, v.first || "there")
    .replace(/\{\s*company\s*\}/gi, v.company)
    .replace(/\{\s*service\s*\}/gi, v.project || `${v.visit}`)
    .replace(/\{\s*link\s*\}/gi, v.link);
  return /\{\s*times\s*\}/i.test(filled) ? filled.replace(/\{\s*times\s*\}/gi, v.times) : `${filled.trim()} ${v.times}.`;
}

const TEXT_MAX = 320; // lib/sms/format SMS_MAX — the sender clips anything longer, STOP line and all

/**
 * The first text. The owner's words when they wrote some; the link and the STOP line always, never clipped off: a
 * long company name or project is shortened first, then the owner's words are cut before the tail.
 */
export function firstText(v: FirstVars, template: string | null): string {
  const tail = ` More: ${v.link} Reply STOP to opt out.`;
  const one = (s: string) => s.replace(/\s+/g, " ").trim();
  if (template) {
    const body = one(fillFirstMessage(template, v));
    const room = TEXT_MAX - tail.length;
    return `${body.length > room ? `${body.slice(0, room - 1).trimEnd()}…` : body}${tail}`;
  }
  const visit = `${v.free ? "a free" : v.visit === "estimate" ? "an" : "a"} ${v.visit}`;
  const ask = `${replyNumbers(v.count)}, or name a time that suits you better.`;
  const company = (c: string) => (c.length > 32 ? `${c.slice(0, 31).trimEnd()}…` : c);
  const tries = [
    `Hi ${v.first || "there"}, it's ${v.company} — thanks for asking about ${v.project || "your project"}! We can come out for ${visit}: ${v.times}. ${ask}`,
    `Hi ${v.first || "there"}, it's ${v.company} — thanks for your request! We can come out for ${visit}: ${v.times}. ${ask}`,
    `Hi ${v.first || "there"}, it's ${company(v.company)} — thanks for your request! We can come out: ${v.times}. ${replyNumbers(v.count)}, or name a better time.`,
  ];
  const body = tries.find((t) => one(t).length + tail.length <= TEXT_MAX) ?? tries[tries.length - 1];
  return `${one(body)}${tail}`;
}

/** The times again when someone at the company restarts SmartBook on a lead (or offers times by hand to an old one). */
export function againText(v: FirstVars): string {
  const tail = ` More: ${v.link} Reply STOP to opt out.`;
  const one = (s: string) => s.replace(/\s+/g, " ").trim();
  const visit = `${v.free ? "a free" : v.visit === "estimate" ? "an" : "a"} ${v.visit}`;
  const company = (c: string) => (c.length > 32 ? `${c.slice(0, 31).trimEnd()}…` : c);
  const tries = [
    `Hi ${v.first || "there"}, it's ${v.company} again. We can come out for ${visit}: ${v.times}. ${replyNumbers(v.count)}, or name a time that suits you better.`,
    `Hi ${v.first || "there"}, it's ${company(v.company)} again. We can come out: ${v.times}. ${replyNumbers(v.count)}, or name a better time.`,
  ];
  const body = tries.find((t) => one(t).length + tail.length <= TEXT_MAX) ?? tries[tries.length - 1];
  return `${one(body)}${tail}`;
}

/**
 * A line written for a text, made right for an email: SmartBook can't read email replies (the Gmail grant is send-only),
 * so "Reply 1, 2 or 3" becomes the button, the link and the STOP line go (the email has the button and its own
 * unsubscribe), and "reply here" means the company's inbox.
 */
export function emailWords(text: string): string {
  return text
    .replace(/ More: \S+/g, "")
    .replace(/ Reply STOP to opt out\./g, "")
    .replace(/Reply (?:\d+, )*\d+(?: or \d+)?(?: and you're booked)?(?:, or [^.?]*)?\./g, "Choose one with the button below, or suggest a time that suits you better.")
    .replace(/Reply YES, or tell me another time\./g, "Say yes with the button below, or suggest another time.")
    .replace(/Reply here if anything changes\./g, "Reply to this email if anything changes.")
    .replace(/just text us here/g, "just reply to this email")
    .replace(/Text us any time to book again\./g, "Reply to this email any time to book again.")
    .replace(/\s+/g, " ")
    .trim();
}

/** The email's own copy of a line whose times are also its rows to tap: the run of times leaves the sentence. */
export function emailProse(text: string, times: string): string {
  const e = emailWords(text);
  if (!times || !e.includes(times)) return e;
  return e
    .replace(`: ${times}.`, ".")
    .replace(`? ${times}.`, "?")
    .replace(` ${times}.`, " one of the times below.")
    .replace(` ${times}?`, " one of the times below?")
    .replace(times, "the times below");
}

export interface CustomerWords {
  first: string;
  company: string;
}

const hi = (w: CustomerWords) => (w.first ? `, ${w.first}` : "");

export const say = {
  booked: (w: CustomerWords, when: string, street: string | null) =>
    `You're all set${hi(w)}: ${when}${street ? ` at ${street}` : ""}. ${w.company} will see you then. Reply here if anything changes.`,
  checking: (w: CustomerWords, asked: string, night: boolean) =>
    `Thanks${hi(w)}! Let me check ${asked} with the team at ${w.company} and get back to you ${night ? "first thing in the morning" : "shortly"}.`,
  stillChecking: (w: CustomerWords, asked: string) => `Still checking ${asked} with the team — thanks for your patience${hi(w)}.`,
  confirmed: (w: CustomerWords, when: string, street: string | null) =>
    `Good news${hi(w)} — ${when} works. You're all set${street ? ` at ${street}` : ""}. Reply here if anything changes.`,
  counter: (w: CustomerWords, asked: string, counter: string) =>
    `${asked} doesn't work for us${hi(w)}, but we could come ${counter}. Does that work? Reply YES, or tell me another time.`,
  declined: (w: CustomerWords, asked: string, times: string, count: number) =>
    `Sorry${hi(w)}, ${asked} doesn't work for us. We could do ${times}. ${replyNumbers(count)}, or tell me another day and time.`,
  declinedNoTimes: (w: CustomerWords, asked: string) =>
    `Sorry${hi(w)}, ${asked} doesn't work for us. Someone from ${w.company} will call you to find a time.`,
  moreTimes: (times: string, count: number) => `Here are times that fit: ${times}. ${replyNumbers(count)}, or tell me another day and time.`,
  taken: (w: CustomerWords, when: string, times: string, count: number) =>
    `Sorry${hi(w)} — ${when} was just taken. How about ${times}? ${replyNumbers(count)}.`,
  nudge: (w: CustomerWords, times: string, count: number) =>
    `Hi${w.first ? ` ${w.first}` : ""}, just checking — would any of these work? ${times}. ${replyNumbers(count)}, or tell me a time that suits you.`,
  nudgeFresh: (w: CustomerWords, times: string, count: number) =>
    `Hi${w.first ? ` ${w.first}` : ""}, it's ${w.company} again. Here are the next open times: ${times}. ${replyNumbers(count)} and you're booked. Reply STOP to opt out.`,
  notInterested: (w: CustomerWords) => `No problem${hi(w)} — thanks for letting us know. If anything changes, just text us here.`,
  handedOff: (w: CustomerWords) => `Thanks${hi(w)} — I've passed this to the team at ${w.company}, and someone will get back to you shortly.`,
  passedOn: (w: CustomerWords, steer: string | null) => `Good question — I've passed it to the team at ${w.company}.${steer ? ` ${steer}` : ""}`,
  steer: (count: number) => (count ? `Meanwhile, would one of those times work? ${replyNumbers(count)}.` : ""),
  canceled: (w: CustomerWords, when: string) => `Done${hi(w)} — your ${when} visit is canceled. Text us any time to book again.`,
  welcome: (w: CustomerWords) => `You're welcome${hi(w)}! See you then.`,
  noTimes: (w: CustomerWords) => `Thanks${hi(w)} — let me find a time with the team at ${w.company}, and we'll get back to you shortly.`,
  reoffer: (w: CustomerWords, asked: string, times: string, count: number) =>
    `Sorry for the wait${hi(w)} — the team couldn't confirm ${asked} yet. Here are open times: ${times}. ${replyNumbers(count)} and you're booked.`,
  counterNudge: (w: CustomerWords, counter: string) => `Just checking${hi(w)} — does ${counter} work for you? Reply YES, or tell me another time.`,
  whichOne: (count: number) => `Sorry, which time? ${replyNumbers(count)}, or tell me a day and time.`,
};

// ── the company ───────────────────────────────────────────────────────────────

export interface RequestFacts {
  name: string;
  source: string;
  project: string | null;
  asked: string;
  /** "Your calendar is free then" / "You have Johnson — roof 8am–12pm then" / "That's outside your booking hours". */
  calendar: string;
  /** The request's number, when more than one may be open. */
  n: number | null;
  phone: string | null;
}

const tag = (n: number | null) => (n ? ` (#${n})` : "");
const refWord = (n: number | null) => (n ? ` ${n}` : "");

export const tell = {
  request: (f: RequestFacts) =>
    `📅 ${f.name} (${[f.source, f.project].filter(Boolean).join(" · ")}) asks for ${f.asked}. ${f.calendar}. Reply YES${refWord(f.n)} to confirm, NO${refWord(f.n)} to offer other times, or another day and time${tag(f.n)}.`,
  reminder: (f: RequestFacts) => `Reminder: ${f.name} is waiting to hear about ${f.asked}. Reply YES${refWord(f.n)}, NO${refWord(f.n)}, or another day and time${tag(f.n)}.`,
  done: (name: string, when: string) => `Done — ${name} is booked ${when}. I've let them know.`,
  offeredOthers: (name: string) => `OK — I've offered ${name} other times.`,
  askedCounter: (name: string, when: string) => `OK — I've asked ${name} about ${when}.`,
  unclear: (name: string, asked: string, n: number | null) =>
    `Sorry, I didn't catch that. Reply YES${refWord(n)} to book ${name} for ${asked}, NO${refWord(n)} to offer other times, or another day and time.`,
  which: (open: Array<{ n: number; name: string; asked: string }>) =>
    `Which one? ${open.slice(0, 3).map((o) => `Reply YES ${o.n} for ${o.name} (${o.asked})`).join(", or ")}.`,
  question: (name: string, q: string, phone: string | null) => `❓ ${name} asked: "${q}" — please answer them${phone ? ` at ${phone}` : ""}.`,
  handoff: (name: string, said: string, phone: string | null) => `🙋 ${name} needs a person: "${said}"${phone ? ` — ${phone}` : ""}. SmartBook has stopped texting them.`,
  notInterested: (name: string) => `${name} isn't interested any more — SmartBook has stopped.`,
  canceled: (name: string, when: string) => `${name} canceled their ${when} visit (SmartBook).`,
  /** A day (or part of one) with no hour, or nothing open that fits: the company names the hour. */
  requestOpen: (f: RequestFacts) =>
    `📅 ${f.name} (${[f.source, f.project].filter(Boolean).join(" · ")}) asks for ${f.asked}. ${f.calendar}. Reply a time to book it (like 9am), or NO${refWord(f.n)} to offer other times${tag(f.n)}.`,
  reoffered: (name: string, asked: string) => `Nobody answered ${name}'s request for ${asked}, so SmartBook offered them open times instead.`,
  cantReach: (name: string, why: string) => `SmartBook can't reach ${name} on its own (${why}) — please call them.`,
  whatTime: (name: string, asked: string) => `What time should I book ${name} for ${asked}? Reply like 9am or 2:30pm.`,
};
