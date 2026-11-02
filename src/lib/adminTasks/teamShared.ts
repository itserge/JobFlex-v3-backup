// THE JOBFLEX TEAM, BY TEXT (owner, 2026-10-15: "add the team with their phone numbers … anybody can grab a task, I
// can assign it to Ivan, everybody gets a text"; then: "let's not do any logins — I just add their phone number; the
// team already has access to admin tasks; we just tell who's doing what by text, and they go to admin, find it and
// mark it done"). Pure, browser-safe.
//
// The team is a list the owner keeps: a name and a mobile each — no accounts, no codes (the owner adds the number;
// the person gets one welcome text that says how to stop). A task can be given to someone on it: their id rides in
// the task's assignee as "m:<id>" (lib/adminTasks/teamStore keeps the pairing; the task table is unchanged), so the
// list, the filters and the sheet treat them like anyone else. A write to a task produces TaskTexts; who gets each:
//   new       a task nobody has yet → everyone on the team
//   assigned  given to someone       → that person
//   taken     someone took it        → everyone else
//   done      it's done              → everyone but whoever had it
//   declined  they replied NO        → everyone else (it's open again)
// Replies (owner, 2026-10-15: "mark to confirm they will do it, in the SMS reply"): OK takes the task or confirms the
// one given to them, DONE finishes it, NO hands it back; anything else lands on the task as their note
// (lib/adminTasks/textReply). Not YES: Twilio keeps it as a re-subscribe word (it is still understood).
// Never a switched-off phone; nothing outside a person's texting hours (Pacific time) — unless Urgent. Texting hours
// (owner, 2026-10-21: "set the time to receive texts — 24 hours or a limit, but default 24 hours"): any time unless
// they set "only between" two hours; the old 9 PM–7 AM quiet-nights switch (on for everyone by default) is retired.

/* THE PLATFORM ALERTS a team member can subscribe to (owner, 2026-10-17: "set the
 * text messaging for when someone signs up … converted from free trial … anything
 * comes from support … canceled his trial … live users more than 10 at the same
 * time"; then "text when payment got charged in Stripe or failed"). Off for everyone
 * until ticked — an alert text costs money and attention.
 * The texts themselves: lib/adminAlerts. */
export const ALERT_KEYS = ["signup", "converted", "canceled", "paid", "failed", "dispute", "support", "investor", "surge", "cleanup", "email", "qa"] as const;
export type AlertKey = (typeof ALERT_KEYS)[number];
export const ALERT_WORDS: Record<AlertKey, { label: string; hint: string }> = {
  signup: { label: "Sign-ups", hint: "a company signs up" },
  converted: { label: "Conversions", hint: "a trial becomes a paid plan" },
  canceled: { label: "Trial cancels", hint: "a trial cancels before it ends" },
  paid: { label: "Payments", hint: "Stripe charges a company — plans, leads, minute packs" },
  failed: { label: "Failed payments", hint: "a plan charge is declined — the first try and the last" },
  // 2026-10-29 (lib/disputeWords): a company disputes a JobFlex charge with its bank — and how it ends.
  dispute: { label: "Disputes", hint: "a company disputes a charge with its bank (a chargeback) — and when it's won or lost" },
  support: { label: "Support", hint: "a support ticket arrives" },
  investor: { label: "Investor link requests", hint: "someone asks to see the investor figures — approve or decline" },
  surge: { label: "Traffic surge", hint: "the site is busy right now" },
  cleanup: { label: "Cleanup failures", hint: "a deleted company's Twilio number could not be released" },
  // 2026-10-21 (lib/emailLog): past the daily limit the mail box stops sending for the day — sign-in codes first.
  email: { label: "Email limit", hint: "today's mail passes 80% and 95% of the daily sending limit" },
  // 2026-10-22 (api/qa/alert, docs/qa-ci.md): a QA Lab run against production went red in CI.
  qa: { label: "QA failures", hint: "an automatic check of the live site failed — which tests" },
};
/** An alert outside someone's texting hours waits until their hours start; "busy right now" is stale by then. */
export const holdsOffHours = (k: AlertKey) => k !== "surge";
export const isAlertKey = (v: unknown): v is AlertKey => typeof v === "string" && (ALERT_KEYS as readonly string[]).includes(v);

export type TeamMember = {
  id: string;
  name: string;
  /** E.164. */
  phone: string;
  on: boolean;
  /** When they take texts (Pacific): absent or null = any time, the default. */
  hours?: TextHours | null;
  addedAt: string;
  /** Which platform alerts they asked to be texted about (lib/adminAlerts). */
  alerts?: AlertKey[];
};

/** A team member as a task's assignee: "m:<id>". */
export const MEMBER_PREFIX = "m:";
export const memberRef = (id: string) => `${MEMBER_PREFIX}${id}`;
export const isMemberRef = (v: string | null | undefined): v is string => typeof v === "string" && v.startsWith(MEMBER_PREFIX) && v.length > MEMBER_PREFIX.length;
export const memberIdOf = (ref: string) => ref.slice(MEMBER_PREFIX.length);

export type TextTask = { id: string; title: string; priority: string; dueDate: string | null };
export type TaskText =
  /** `by`: who posted it, when that is a person (the shared console login is nobody). */
  | { kind: "new"; task: TextTask; by: string | null }
  | { kind: "assigned"; task: TextTask; by: string | null; to: string }
  | { kind: "taken"; task: TextTask; member: string; name: string }
  | { kind: "done"; task: TextTask; member: string | null; name: string | null }
  | { kind: "declined"; task: TextTask; member: string; name: string };

export const TEAM_TZ = "America/Los_Angeles";

/** Texting hours: from `from`:00 up to `to`:00 on the team's clock, hours 0–23; `from` > `to` runs past midnight
 *  (10 PM–6 AM). */
export type TextHours = { from: number; to: number };
/** What "Only between…" starts at. */
export const DEFAULT_LIMIT: TextHours = { from: 7, to: 21 };

const hourOn = (now: Date, tz: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));

/** Inside their texting hours now (no hours: always). */
export function inHours(hours: TextHours | null | undefined, now: Date, tz = TEAM_TZ): boolean {
  if (!hours) return true;
  const h = hourOn(now, tz);
  return hours.from < hours.to ? h >= hours.from && h < hours.to : h >= hours.from || h < hours.to;
}

/** When their texting hours next start: `now` inside them, else the first full hour that is. (The team's zone is off
 *  UTC by whole hours, so UTC's hour marks are its own.) */
export function hoursOpenAt(hours: TextHours | null | undefined, now: Date, tz = TEAM_TZ): Date {
  if (inHours(hours, now, tz)) return now;
  let t = Math.floor(now.getTime() / 3_600_000) * 3_600_000 + 3_600_000;
  for (let i = 0; i < 24 && !inHours(hours, new Date(t), tz); i++) t += 3_600_000;
  return new Date(t);
}

/** "7 AM", "12 PM", "12 AM". */
export const hourWord = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

/** "Any time" / "7 AM–9 PM". */
export const hoursWords = (hours: TextHours | null | undefined) => (hours ? `${hourWord(hours.from)}–${hourWord(hours.to)}` : "Any time");

/** Hours as sent or stored: two whole hours 0–23 that differ, else null (any time). */
export function cleanHours(raw: unknown): TextHours | null {
  if (!raw || typeof raw !== "object") return null;
  const { from, to } = raw as { from?: unknown; to?: unknown };
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 23;
  return ok(from) && ok(to) && from !== to ? { from, to } : null;
}

/** Who a text goes to: member ids, in the list's order. */
export function textRecipients(t: TaskText, members: readonly TeamMember[], now: Date): string[] {
  const urgent = t.task.priority === "URGENT";
  const can = (m: TeamMember) => m.on && (urgent || inHours(m.hours, now));
  if (t.kind === "assigned") return members.filter((m) => m.id === t.to && can(m)).map((m) => m.id);
  const skip = t.kind === "taken" || t.kind === "done" || t.kind === "declined" ? t.member : null;
  return members.filter((m) => m.id !== skip && can(m)).map((m) => m.id);
}

const SHORT_TITLE = 70;
const shortTitle = (s: string) => (s.length > SHORT_TITLE ? `${s.slice(0, SHORT_TITLE - 1).trimEnd()}…` : s);
const firstName = (s: string) => s.trim().split(/\s+/)[0] || s;
const PRIORITY_WORD: Record<string, string> = { URGENT: "URGENT · ", HIGH: "High · " };

function dueWords(day: string | null): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const d = new Date(`${day}T12:00:00Z`);
  return ` · due ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

/** The text itself, with the task's link. One short line — it reads on a lock screen. */
export function taskTextBody(t: TaskText, href: string): string {
  const title = `“${shortTitle(t.task.title)}”`;
  const pri = PRIORITY_WORD[t.task.priority] ?? "";
  switch (t.kind) {
    case "new":
      return `JobFlex task${t.by ? ` from ${firstName(t.by)}` : ""}: ${pri}${title}${dueWords(t.task.dueDate)}. Nobody has it yet — reply OK to take it. ${href}`;
    case "assigned":
      return `JobFlex: a task for you${t.by ? ` from ${firstName(t.by)}` : ""} — ${pri}${title}${dueWords(t.task.dueDate)}. Reply OK if you'll do it, NO if you can't. ${href}`;
    case "declined":
      return `JobFlex: ${firstName(t.name)} can't do ${title} — it's open again. Reply OK to take it. ${href}`;
    case "taken":
      return `JobFlex: ${firstName(t.name)} took ${title}. ${href}`;
    case "done":
      return `JobFlex: ✓ ${title} is done${t.name ? ` (${firstName(t.name)})` : ""}. ${href}`;
  }
}

/** The first text a new team member gets — what these texts are, and how to stop them. */
export function welcomeTextBody(name: string, by: string | null): string {
  return `JobFlex: hi ${firstName(name)} — ${by ? `${firstName(by)} added` : "you're added"} ${by ? "you " : ""}to the JobFlex team's task texts. You'll get a text when a task is yours or needs someone: reply OK to take it, DONE when it's finished, NO if you can't. Reply STOP to stop.`;
}

/** A phone as typed → E.164 (US/Canada numbers without +1 get it), or null. */
export function phoneE164(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return /^\+[1-9]\d{7,14}$/.test(`+${digits}`) ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** "(425) 772-6587" for a US/Canada number, else the E.164 as it is. */
export function phoneWords(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export const NAME_MAX = 60;
export const TEAM_MAX = 40;

/** The list as stored, checked (a junk row never reaches a send). */
export function cleanMembers(raw: unknown): TeamMember[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TeamMember[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const id = typeof o.id === "string" && /^[A-Za-z0-9_-]{4,40}$/.test(o.id) ? o.id : null;
    const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
    const phone = typeof o.phone === "string" ? phoneE164(o.phone) : null;
    if (!id || !name || !phone || seen.has(id)) continue;
    seen.add(id);
    const alerts = Array.isArray(o.alerts) ? (ALERT_KEYS as readonly string[]).filter((k) => (o.alerts as unknown[]).includes(k)) as AlertKey[] : [];
    // The retired quiet-nights flag is dropped: a person takes texts at any hour until they set hours.
    const hours = cleanHours(o.hours);
    out.push({ id, name, phone, on: o.on !== false, ...(hours ? { hours } : {}), addedAt: typeof o.addedAt === "string" ? o.addedAt : "", ...(alerts.length ? { alerts } : {}) });
  }
  return out.slice(0, TEAM_MAX);
}

/** Can texts go at all from this server — Twilio set up, JobFlex's number approved. */
export type TextingStatus = { ready: boolean; words: string };

/** The latest task text to a number, as SmsMessage keeps it (the Twilio status callback fills in delivery). `after`: a
 *  held text's send time. */
export type LastText = { status: string; error: string | null; at: string; after?: string | null };

/** One person on the team, as the Team sheet shows them. */
export type TeamMemberView = {
  id: string;
  name: string;
  phone: string;
  on: boolean;
  /** Texting hours (null: any time). */
  hours: TextHours | null;
  /** Open tasks given to them now. */
  open: number;
  /** Did the last text reach them. */
  last: LastText | null;
  /** The last alert text to them (sent, held for 7 AM, or why not). */
  lastAlert: LastText | null;
  /** They replied STOP: nothing reaches them until they text START. */
  stopped: boolean;
  /** The platform alerts they get texts about (lib/adminAlerts). */
  alerts: AlertKey[];
};

/** The carrier's error codes a person can act on (Twilio's 2xxxx/3xxxx). */
const CARRIER_WORDS: Record<string, string> = {
  "21211": "the number isn't a valid mobile",
  "21610": "they replied STOP",
  "21614": "the number can't get texts",
  "30003": "their phone was off or out of reach",
  "30004": "the number blocks texts",
  "30005": "the number doesn't exist",
  "30006": "it's a landline",
  "30007": "the carrier filtered it",
  "30008": "the carrier didn't say why",
  "30032": "JobFlex's toll-free number isn't verified yet",
};

/** What became of the last text (or alert), in words, with a tone for the dot beside it. */
export function deliveryWords(last: LastText | null, noun: "text" | "alert" = "text"): { tone: "ok" | "wait" | "bad"; words: string } | null {
  if (!last) return null;
  const s = last.status.toUpperCase();
  const L = `Last ${noun}`;
  if (s === "DELIVERED" || s === "READ") return { tone: "ok", words: `${L} delivered` };
  if (s === "HELD") return { tone: "wait", words: `${L} waits for their texting hours${last.after ? ` — ${hourWord(hourOn(new Date(last.after), TEAM_TZ))}` : ""}` };
  if (s === "MERGED") return { tone: "wait", words: `${L} went out in a roundup when their hours started` };
  if (s === "QUEUED" || s === "SENT" || s === "SENDING" || s === "ACCEPTED" || s === "SCHEDULED") return { tone: "wait", words: `${L} sent — no delivery receipt yet` };
  if (s === "UNDELIVERED" || s === "FAILED") {
    const code = /^(\d{5})/.exec(last.error ?? "")?.[1];
    const why = code ? CARRIER_WORDS[code] ?? `carrier error ${code}` : null;
    return { tone: "bad", words: `${L} didn't arrive${why ? ` — ${why}` : ""}` };
  }
  if (s === "SKIPPED") {
    const e = last.error ?? "";
    const why =
      e === "not-configured" ? "texting isn't set up on this server" :
      e === "no-number" ? "JobFlex's number isn't approved yet" :
      e === "cap-number" ? "today's texts to this number were used up" :
      e.startsWith("cap-") ? "today's texting limit was reached" : "it was held back";
    return { tone: "bad", words: `${L} not sent — ${why}` };
  }
  return { tone: "wait", words: `${L} sent` };
}

// ── Replies to a task text ─────────────────────────────────────────

export type ReplyIntent = "ok" | "done" | "no" | "note";

const OK_WORDS = /^(ok(ay)?|k|yes|yep|yeah|y|sure|on it|will do|i'?ll do it|i will|i got it|got it|take|taking|mine|confirm(ed)?|1|👍|👌)(?=$|[\s,.!:;-])/i;
const DONE_WORDS = /^(done|finished|complete(d)?|fixed|all done|2|✅|✔️?)(?=$|[\s,.!:;-])/i;
const NO_WORDS = /^(no|nope|n|can'?t|cannot|not me|pass|busy|3|👎)(?=$|[\s,.!:;-])/i;
const REF = /\bT-([A-Z0-9]{6})\b/i;

/** "OK" → ok; "ok, on my way" → ok + that whole line as their note; "T-3G60GE done" → that task, done. */
export function parseTaskReply(raw: string): { intent: ReplyIntent; ref: string | null; note: string } {
  let s = (raw || "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  const ref = REF.exec(s)?.[1]?.toUpperCase() ?? null;
  if (ref) s = s.replace(REF, " ").replace(/\s+/g, " ").trim();
  for (const [intent, re] of [["done", DONE_WORDS], ["no", NO_WORDS], ["ok", OK_WORDS]] as const) {
    const m = re.exec(s);
    // Words beyond the command ("can't today", "ok, on my way") go on the task as they were written.
    if (m) return { intent, ref, note: s.slice(m[0].length).replace(/^[\s,.!:;-]+/, "").trim() ? s : "" };
  }
  return { intent: "note", ref, note: s };
}

export type ReplyOutcome = "took" | "confirmed" | "done" | "already" | "declined" | "passed" | "noted" | "closed" | "theirs" | "none";

/** The answer texted back, so they know what their reply did. */
export function replyTextBody(o: ReplyOutcome, title: string | null, name: string, holder?: string | null): string {
  const t = title ? `“${shortTitle(title)}”` : "the task";
  const me = firstName(name);
  switch (o) {
    case "took":
      return `JobFlex: it's yours, ${me} — ${t}. Reply DONE when it's finished.`;
    case "confirmed":
      return `JobFlex: confirmed, ${me} — ${t} is yours. Reply DONE when it's finished.`;
    case "done":
      return `JobFlex: ✓ ${t} is marked done. Thanks, ${me}!`;
    case "already":
      return `JobFlex: ${t} was already done — nothing changed.`;
    case "declined":
      return `JobFlex: OK — ${t} is open again and the team got a text.`;
    case "passed":
      return `JobFlex: OK — ${t} stays open for someone else.`;
    case "noted":
      return `JobFlex: your note is on ${t}. Reply OK to take it or confirm, DONE when it's finished.`;
    case "closed":
      return `JobFlex: ${t} is closed — nothing changed.`;
    case "theirs":
      return `JobFlex: ${holder ? firstName(holder) : "someone else"} has ${t}, so nothing changed.`;
    case "none":
      return "JobFlex: there's no task to answer. Reply OK, DONE or NO right after a task text, or open Tasks in admin.";
  }
}

/** A note texted in, as the task's comment: who wrote it rides in a first line the page reads back. */
const NOTE_MARK = /^\[by text: ([^\]\n]{1,60})\]\n/;
export const textNoteBody = (name: string, note: string) => `[by text: ${name.replace(/[\]\n]/g, " ").slice(0, 60)}]\n${note}`;
export function readTextNote(body: string): { name: string; note: string } | null {
  const m = NOTE_MARK.exec(body);
  return m ? { name: m[1], note: body.slice(m[0].length) } : null;
}

/** A task's link in a text we sent → its id (the reply's task is the last one texted). */
export function taskIdInText(body: string): string | null {
  return /\/admin\/tasks\?task=([A-Za-z0-9_-]{6,40})/.exec(body)?.[1] ?? null;
}
