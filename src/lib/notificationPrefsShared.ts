// NOTIFICATION PREFERENCES — the user's matrix, made real.
//
// Stored as `User.notificationPrefsJson`. Two channels per event: in-app
// (does the row show in the bell?) and email (does the office mail go out to
// this member?). Quiet hours and mute-weekends gate EMAIL only — the bell
// keeps a copy — and an email inside the window is DROPPED, not held: there
// is no outbox to hold it in, and the settings copy says exactly that.
//
// THIS FILE IS PURE (no db, no mail) so the settings panes can import the
// event list, the parser and the quiet-hours math into the client bundle.
// The db-backed half (loadPrefs, recipients, senders) is ./notificationPrefs.ts.

export type PrefKey =
  | "lead-assigned"
  | "proposal-viewed"
  | "proposal-accepted"
  | "proposal-declined"
  | "payment-received"
  | "financing"
  | "billing-problems"
  | "change-order"
  | "appointment-booked"
  | "booking-online"
  | "smartbook-request"
  | "appointment-moved"
  | "service-reminder"
  | "job-scheduled"
  | "job-started"
  | "job-completed"
  | "job-photos"
  | "expense-submitted"
  | "worker-responded"
  | "review-received"
  | "trade-reply"
  | "crew-assigned"
  | "crew-moved"
  | "crew-tomorrow"
  | "crew-today";

/** Who a text is for (2026-09-29): the office runs the company, sales hears
 *  about its own deals and visits, the crew hears about its own days. A
 *  member's audience follows their role (audienceForRole). */
export type TextAudience = "office" | "sales" | "crew";

export interface PrefEventMeta {
  key: PrefKey;
  name: string;
  sub: string;
  /** False when nothing in the app mails this event — the Email cell is
   *  disabled rather than lying. */
  emailAvailable: boolean;
  /** False when nothing in the app texts this event (2026-09-24) — same rule. */
  smsAvailable: boolean;
  /** False when the bell never carries this event (2026-10-21, billing problems: the payment banner is the in-app
   *  notice, always on) — the In-app cell is a tag, not a checkbox. Absent = available. */
  inAppAvailable?: boolean;
  /** Seed [inApp, email, sms] for a user who has never saved. The sms seed
   *  only matters once a mobile is verified — verifying is the opt-in. */
  seed: [boolean, boolean, boolean];
  /** Which rosters on Settings → Texting show this event, and the Text seed
   *  for each (a sales rep hears about a declined proposal; the office is
   *  seeded off it). Absent = the office only, with `seed[2]`. */
  audience?: Partial<Record<TextAudience, boolean>>;
  /** The text as it will read, with sample facts — shown under the switch. */
  example?: string;
}

/** Every key here has a real producer (an ActivityEvent kind or a notify*
 *  sender). Anything without one was cut from the matrix. */
export const PREF_EVENTS: readonly PrefEventMeta[] = [
  { key: "lead-assigned", name: "New lead", sub: "A platform or web lead lands in your pipeline", emailAvailable: true, smsAvailable: true, seed: [true, true, true], audience: { office: true, sales: true }, example: "New lead: Sarah Mitchell, roof replacement in Bothell, WA ((425) 555-0142). Open: jobflex.app/…" },
  { key: "proposal-viewed", name: "Proposal viewed", sub: "The client opened your estimate", emailAvailable: false, smsAvailable: false, seed: [true, false, false] },
  { key: "proposal-accepted", name: "Proposal accepted", sub: "Signed and ready to schedule", emailAvailable: true, smsAvailable: true, seed: [true, true, true], audience: { office: true, sales: true }, example: "Sarah Mitchell accepted \"Standing-seam metal · 18412 92nd Ave NE\" — $27,926. Schedule it: jobflex.app/…" },
  { key: "proposal-declined", name: "Proposal declined", sub: "With the reason the client gave", emailAvailable: true, smsAvailable: true, seed: [true, true, false], audience: { office: false, sales: true }, example: "Sarah Mitchell declined \"Architectural shingles · 18412 92nd Ave NE\": \"Going with a lower bid.\"" },
  { key: "payment-received", name: "Payment received", sub: "A stage was paid — card, Square or recorded by hand", emailAvailable: true, smsAvailable: true, seed: [true, true, true], audience: { office: true, sales: false }, example: "Sarah Mitchell paid $8,378 on \"Standing-seam metal · 18412 92nd Ave NE\" — $19,548 still due." },
  // Wisetack financing (2026-10-28, lib/financing): the contractor's application decided, a client approved or
  // accepting a loan, Wisetack's payout. Text + bell; nothing mails it.
  { key: "financing", name: "Financing", sub: "Wisetack decided your application, a client was approved or accepted a loan, Wisetack paid you", emailAvailable: false, smsAvailable: true, seed: [true, false, true], audience: { office: true }, example: "Sarah Mitchell was approved for $14,000 through Wisetack on \"Standing-seam metal · 18412 92nd Ave NE\" — the loan terms are next." },
  // JobFlex's own bill (owner, 2026-10-21): the company's plan payment did not go through. The Text cell gates the
  // owner's one or two texts per invoice (lib/billingProblemText). The Email cell governs only extra notices: the
  // dunning emails (lib/cardUpdate) always go, whatever it says. The in-app notice is the payment banner on every
  // page, so the In-app cell is a tag.
  { key: "billing-problems", name: "Billing problems", sub: "Your JobFlex plan payment didn't go through — sent to the account owner; the payment emails always go", emailAvailable: true, smsAvailable: true, inAppAvailable: false, seed: [false, true, true], audience: { office: true }, example: "JobFlex: payment of $95 for Professional didn't go through (insufficient funds). Update your card: jobflex.app/dashboard/subscription" },
  { key: "change-order", name: "Change order answered", sub: "The client approved or declined it", emailAvailable: true, smsAvailable: true, seed: [true, true, true], audience: { office: true, sales: false }, example: "Sarah Mitchell approved change order #2 \"Skylight flashing\" ($640) on \"Standing-seam metal · 18412 92nd Ave NE\"." },
  { key: "appointment-booked", name: "Appointment booked", sub: "A visit goes on the calendar — by the team or online", emailAvailable: false, smsAvailable: true, seed: [true, false, true], audience: { office: true, sales: true }, example: "Booked: Roof inspection · Sarah Mitchell · Tue Oct 7, 9 AM–10 AM · 18412 92nd Ave NE · online." },
  // Online booking (owner, 2026-10-28: "when somebody books online the contractor gets an email"): a customer
  // booked on the company's booking page — the bell, and the Blueprint email (notify → notifyBookedOnline).
  { key: "booking-online", name: "Booked online", sub: "A customer booked a visit on your booking page", emailAvailable: true, smsAvailable: false, seed: [true, true, false] },
  // SmartBook (owner, 2026-10-31: "if customer offers his date and time … you send this to us, and we confirm"): a new
  // lead asked for a time of their own and waits for the company's yes — answered by replying to the text
  // (lib/smartbook) or from the email's answer page (/b/r/<token>). Text, email and bell.
  { key: "smartbook-request", name: "SmartBook: a customer asks for a time", sub: "A new lead wants a day or time of their own — reply YES, NO or another time", emailAvailable: true, smsAvailable: true, seed: [true, true, true], audience: { office: true, sales: true }, example: "Ridgeline Roofing Co.: 📅 Sarah Mitchell (Facebook · roof replacement) asks for Sat Nov 8, 9am. Your calendar is free then. Reply YES to confirm, NO to offer other times, or another day and time." },
  { key: "appointment-moved", name: "Appointment moved or cancelled", sub: "A visit changes day or time, or comes off the calendar", emailAvailable: false, smsAvailable: true, seed: [true, false, true], audience: { office: true, sales: true }, example: "Moved: Roof inspection · Sarah Mitchell — was Tue Oct 7, 9 AM, now Thu Oct 9, 1 PM." },
  // HVAC services (2026-10-18): the service desk's own reminders — one digest a day, a heads-up before plan
  // visits, the contractor's own reminders on their day (lib/serviceDeskBook). In the bell for everyone;
  // texted to the office members who switch it on.
  { key: "service-reminder", name: "Service reminders", sub: "HVAC service: the day's plan visits, visits coming up, late plan bills, your own reminders", emailAvailable: false, smsAvailable: true, seed: [true, false, true], audience: { office: true }, example: "Northpeak Heating & Air: HVAC service — Today: 2 visits — 9:00 AM Mark Ellis; 11:00 AM Jenna Brooks. Thu, Oct 23: 1 visit — confirm the times. Reminder: call about the filter (Mark Ellis). jobflex.app/…" },
  { key: "job-scheduled", name: "Job scheduled", sub: "A job gets its install date", emailAvailable: false, smsAvailable: true, seed: [true, false, true], audience: { office: true, sales: true }, example: "Scheduled: \"Standing-seam metal · 18412 92nd Ave NE\" — Mon Oct 13, 8 AM at 18412 92nd Ave NE." },
  // The crew on site (2026-09-27): the office hears when work starts, when a
  // crew is back for another day, when it is done, and when photos or a
  // video of the work come in — by text to the owner and the manager.
  { key: "job-started", name: "Crew on site", sub: "Work started, or a crew back for another day", emailAvailable: false, smsAvailable: true, seed: [true, false, true], audience: { office: true }, example: "Marcus Bell started \"Standing-seam metal · 18412 92nd Ave NE\". jobflex.app/…" },
  { key: "job-completed", name: "Job completed", sub: "Crew marked the work done", emailAvailable: false, smsAvailable: true, seed: [true, false, true], audience: { office: true, sales: false }, example: "Marcus Bell marked \"Standing-seam metal · 18412 92nd Ave NE\" complete after 2 days. Photos: jobflex.app/…" },
  { key: "job-photos", name: "Photos & videos from the crew", sub: "How the job was done, as it comes in", emailAvailable: false, smsAvailable: true, seed: [true, false, true], audience: { office: true }, example: "Marcus Bell added 6 photos and 1 video of \"Standing-seam metal · 18412 92nd Ave NE\". See them: jobflex.app/…" },
  // A crew member's receipt waiting for approval (2026-09-30): the bell and mail, no text.
  { key: "expense-submitted", name: "Receipt on review", sub: "A crew member sent a receipt — it counts once you approve it", emailAvailable: true, smsAvailable: false, seed: [true, true, false] },
  { key: "worker-responded", name: "Worker responded", sub: "Accepted or declined an assignment", emailAvailable: true, smsAvailable: true, seed: [true, true, false], audience: { office: false }, example: "Marcus Bell accepted \"Standing-seam metal · 18412 92nd Ave NE\" on Mon Oct 13." },
  { key: "review-received", name: "Review received", sub: "A homeowner left a rating", emailAvailable: false, smsAvailable: false, seed: [true, false, false] },
  { key: "trade-reply", name: "Trade board reply", sub: "Someone answered your post", emailAvailable: true, smsAvailable: false, seed: [true, true, false] },
];

/** The crew's texts (2026-09-29): what a worker with a phone hears, one
 *  switch each. Text-only and never in the bell, so they stay out of the
 *  Notifications matrix (PREF_EVENTS); they ride on the worker's own
 *  account, while the phone and the consent live on WorkerProfile. */
export const CREW_TEXT_EVENTS: readonly PrefEventMeta[] = [
  { key: "crew-assigned", name: "Put on a job", sub: "A job or an appointment, with the day, the hours and the link to confirm", emailAvailable: false, smsAvailable: true, seed: [true, false, true], audience: { crew: true }, example: "Ridgeline Roofing Co.: you're on \"Standing-seam metal · 18412 92nd Ave NE\" Mon Oct 13, 8 AM–4 PM at 18412 92nd Ave NE. Details + confirm: jobflex.app/w/…" },
  { key: "crew-moved", name: "Job moved or cancelled", sub: "The day or time changed, or the job is off", emailAvailable: false, smsAvailable: true, seed: [true, false, true], audience: { crew: true }, example: "Ridgeline Roofing Co.: \"Standing-seam metal · 18412 92nd Ave NE\" moved to Tue Oct 14, 8 AM–4 PM at 18412 92nd Ave NE. Details: jobflex.app/w/…" },
  { key: "crew-tomorrow", name: "Tomorrow's list, 6 PM", sub: "The evening before: every stop for tomorrow, in order", emailAvailable: false, smsAvailable: true, seed: [true, false, true], audience: { crew: true }, example: "Ridgeline Roofing Co. — tomorrow (Mon Oct 13): 8 AM Standing-seam metal · 18412 92nd Ave NE. Details: jobflex.app/w/…" },
  { key: "crew-today", name: "Today's list, 7 AM", sub: "The morning of: the same list, in case it changed overnight", emailAvailable: false, smsAvailable: true, seed: [true, false, true], audience: { crew: true }, example: "Ridgeline Roofing Co. — today (Mon Oct 13): 8 AM Standing-seam metal · 18412 92nd Ave NE. Details: jobflex.app/w/…" },
];

/** The roster a role sits on: office, sales, crew — or none (a plain member
 *  is not texted about the company). ACCOUNTANT is office: the money lines
 *  are theirs. */
export function audienceForRole(role: string | null | undefined): TextAudience | null {
  switch (role) {
    case "OWNER":
    case "ADMIN":
    case "MANAGER":
    case "ACCOUNTANT":
      return "office";
    case "SALES":
    case "ESTIMATOR":
      return "sales";
    case "INSTALLER":
      return "crew";
    default:
      return null;
  }
}

/** Every event a member's blob can hold: the matrix and the crew's texts. */
export const ALL_PREF_EVENTS: readonly PrefEventMeta[] = [...PREF_EVENTS, ...CREW_TEXT_EVENTS];

/** The events a roster shows, in the order they are listed. */
export function textEventsFor(audience: TextAudience): readonly PrefEventMeta[] {
  return ALL_PREF_EVENTS.filter((e) => e.smsAvailable && e.audience && audience in e.audience);
}

/** The Text seed of an event for a roster: the audience's own, else `seed[2]`. */
export function smsSeedFor(e: PrefEventMeta, audience: TextAudience | null): boolean {
  if (!e.smsAvailable) return false;
  if (audience && e.audience && typeof e.audience[audience] === "boolean") return e.audience[audience]!;
  return e.seed[2];
}

/** [in-app, email, text]. The third cell came back on 2026-09-24 with the
 *  platform's own Twilio number; a stored pair from before reads as the seed. */
export type PrefCells = [inApp: boolean, email: boolean, sms: boolean];

/** Texts that never wait for the morning: a lead waits for no one. */
export const SMS_URGENT_KEYS: readonly PrefKey[] = ["lead-assigned"];

/** The three switches the owner sets per office member in Settings → Texting
 *  (2026-09-27): each one flips the Text cell of every event in its group. */
export type SmsGroupKey = "crew" | "sales" | "money";
export const SMS_GROUPS: readonly { key: SmsGroupKey; label: string; sub: string; keys: readonly PrefKey[] }[] = [
  { key: "crew", label: "Crew on site", sub: "Started, back for another day, completed, photos and videos", keys: ["job-started", "job-completed", "job-photos", "worker-responded"] },
  { key: "sales", label: "Sales & leads", sub: "A new lead, a SmartBook time to confirm, a proposal accepted or declined", keys: ["lead-assigned", "smartbook-request", "proposal-accepted", "proposal-declined"] },
  { key: "money", label: "Money", sub: "A payment, a change order answered, financing", keys: ["payment-received", "change-order", "financing"] },
];
/** Which groups a member's stored matrix has on: a group is on when any of
 *  its texting events is (the seeds leave "proposal declined" off, and a
 *  member who hears about leads and acceptances is on for Sales). */
export function smsGroupsOf(prefs: { matrix: Record<PrefKey, PrefCells> }): Record<SmsGroupKey, boolean> {
  const out = { crew: false, sales: false, money: false } as Record<SmsGroupKey, boolean>;
  for (const g of SMS_GROUPS) out[g.key] = g.keys.some((k) => prefs.matrix[k]?.[2] === true);
  return out;
}

export interface NotificationPrefs {
  matrix: Record<PrefKey, PrefCells>;
  quietFrom: string; // "20:00"
  quietTo: string; // "07:00"
  muteWeekends: boolean;
  /** The office member who typed this mobile in on Settings → Texting
   *  (2026-09-29), or null when the member verified it with a code. */
  smsAddedBy?: string | null;
  /** Texts to this member are switched off on Settings → Texting (2026-10-13): the mobile and the event choices stay,
   *  nothing is texted until the switch is on again. */
  smsPaused?: boolean;
}

export const QUIET_FROM_DEFAULT = "20:00";
export const QUIET_TO_DEFAULT = "07:00";

/** `role` picks the Text seeds (a sales rep is seeded onto its declined
 *  proposals, the office is not); without it the office seeds apply. */
export function defaultNotificationPrefs(role?: string | null): NotificationPrefs {
  const audience = audienceForRole(role);
  const matrix = {} as Record<PrefKey, PrefCells>;
  for (const e of ALL_PREF_EVENTS) matrix[e.key] = [e.seed[0], e.seed[1], smsSeedFor(e, audience)];
  return { matrix, quietFrom: QUIET_FROM_DEFAULT, quietTo: QUIET_TO_DEFAULT, muteWeekends: false, smsAddedBy: null, smsPaused: false };
}

/** Accepts the triple and the older [inApp, email] pair — a pair's text cell
 *  is the seed, since that user never had the choice. Unknown keys are
 *  ignored; missing ones seed (by `role`, see defaultNotificationPrefs). */
export function parseNotificationPrefs(json: string | null | undefined, role?: string | null): NotificationPrefs {
  const base = defaultNotificationPrefs(role);
  if (!json) return base;
  let raw: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(json);
    if (!v || typeof v !== "object") return base;
    raw = v as Record<string, unknown>;
  } catch {
    return base;
  }
  const stored = raw.matrix && typeof raw.matrix === "object" ? (raw.matrix as Record<string, unknown>) : {};
  for (const e of ALL_PREF_EVENTS) {
    const cells = stored[e.key];
    if (Array.isArray(cells) && cells.length >= 2 && typeof cells[0] === "boolean" && typeof cells[1] === "boolean") {
      const sms = typeof cells[2] === "boolean" ? cells[2] : base.matrix[e.key][2];
      base.matrix[e.key] = [cells[0], e.emailAvailable ? cells[1] : false, e.smsAvailable ? sms : false];
    }
  }
  const str = (v: unknown, fb: string) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : fb);
  return {
    matrix: base.matrix,
    quietFrom: str(raw.quietFrom, base.quietFrom),
    quietTo: str(raw.quietTo, base.quietTo),
    muteWeekends: typeof raw.muteWeekends === "boolean" ? raw.muteWeekends : false,
    smsAddedBy: typeof raw.smsAddedBy === "string" ? raw.smsAddedBy : null,
    smsPaused: raw.smsPaused === true,
  };
}

/** The Text cells of one roster, as the settings page shows them. */
export function textCellsFor(prefs: NotificationPrefs, audience: TextAudience): Partial<Record<PrefKey, boolean>> {
  const out: Partial<Record<PrefKey, boolean>> = {};
  for (const e of textEventsFor(audience)) out[e.key] = prefs.matrix[e.key]?.[2] ?? smsSeedFor(e, audience);
  return out;
}


/**
 * What a save writes (2026-09-24): the incoming cells over the stored ones.
 * A pair — the handheld settings page still saves pairs — keeps the Text cell
 * it cannot see; an unavailable channel is always off.
 */
export function mergeMatrixSave(
  incoming: Record<string, readonly boolean[]>,
  stored: NotificationPrefs,
): Record<PrefKey, PrefCells> {
  const out = {} as Record<PrefKey, PrefCells>;
  // Every key, not only the matrix's: a save from the Notifications page
  // must keep the crew's switches it does not show.
  for (const e of ALL_PREF_EVENTS) {
    const cells = incoming[e.key];
    const prev = stored.matrix[e.key] ?? [e.seed[0], e.seed[1], e.seed[2]];
    if (!cells || cells.length < 2) {
      out[e.key] = prev;
      continue;
    }
    const sms = cells.length >= 3 ? Boolean(cells[2]) : prev[2];
    out[e.key] = [Boolean(cells[0]), e.emailAvailable ? Boolean(cells[1]) : false, e.smsAvailable ? sms : false];
  }
  return out;
}

// ── kind → preference key ────────────────────────────────────────────────

export interface EventLike {
  kind: string;
  proposalId?: string | null;
  leadId?: string | null;
  meta?: string | null;
  summary?: string | null;
}

/**
 * Which matrix row governs an ActivityEvent. Derived from the real producers
 * (grep `activityEvent.create` under src/actions and src/lib). Unknown kinds
 * return null — those rows always show.
 */
export function prefKeyForEvent(e: EventLike): PrefKey | null {
  const summary = e.summary ?? "";
  const meta = e.meta ?? "";
  switch (e.kind) {
    case "VIEWED":
      return "proposal-viewed";
    case "CO_APPROVED":
    case "CO_DECLINED":
      return "change-order";
    case "ACCEPTED":
    case "DECLINED": {
      if (meta.includes("assignmentId")) return "worker-responded";
      if (/change order/i.test(summary)) return "change-order";
      if (/crew invite|marked accepted on|marked declined on/i.test(summary)) return "worker-responded";
      if (e.leadId || /platform lead/i.test(summary)) return null;
      if (e.proposalId) return e.kind === "ACCEPTED" ? "proposal-accepted" : "proposal-declined";
      return null;
    }
    case "CREATED":
      return e.leadId ? "lead-assigned" : null;
    case "SCHEDULED":
      return "job-scheduled";
    case "BOOKING_NEW":
      // A visit the AI desk booked on a call stays an appointment; one booked on the page is an online booking.
      return meta.includes('"channel":"ai-desk"') ? "appointment-booked" : "booking-online";
    case "BOOKING_MOVED":
    case "BOOKING_CANCELED":
      return "appointment-moved";
    case "SMARTBOOK_ASK":
      return "smartbook-request";
    case "STARTED":
      return "job-started";
    case "MEDIA":
      return "job-photos";
    case "COMPLETED":
      return "job-completed";
    case "EXPENSE_SUBMITTED":
      return "expense-submitted";
    case "TRADE_CONTACT":
    case "TRADE_INTEREST":
    case "TRADE_HIRED":
      return "trade-reply";
    case "REVIEW":
      return "review-received";
    case "PAYMENT_RECEIVED":
    case "PAYMENT_MARKED":
      return "payment-received";
    // The service side's own notices (2026-09-22 plans, 2026-10-18 desk): the day's digest, the heads-up,
    // the contractor's reminders, a plan visit two weeks out, a plan ending or ended.
    case "PLAN_DIGEST":
    case "PLAN_HEADS_UP":
    case "PLAN_REMINDER":
    case "PLAN_VISIT_DUE":
    case "PLAN_EXPIRING":
    case "PLAN_EXPIRED":
      return "service-reminder";
    default:
      return null;
  }
}

export function allowsInApp(prefs: NotificationPrefs, key: PrefKey | null): boolean {
  if (key === null) return true;
  return prefs.matrix[key]?.[0] ?? true;
}

// ── quiet hours (email only) ─────────────────────────────────────────────

function localParts(now: Date, tz: string): { minutes: number; weekend: boolean } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const h = Number.parseInt(get("hour"), 10) % 24;
    const m = Number.parseInt(get("minute"), 10);
    const wd = get("weekday");
    return { minutes: h * 60 + m, weekend: wd === "Sat" || wd === "Sun" };
  } catch {
    const d = now;
    return { minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6 };
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number.parseInt(x, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function inQuietHours(prefs: NotificationPrefs, now: Date, tz: string): boolean {
  const { minutes } = localParts(now, tz);
  const from = toMinutes(prefs.quietFrom);
  const to = toMinutes(prefs.quietTo);
  if (from === to) return false;
  // Window wraps midnight when from > to (20:00 → 07:00).
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/**
 * Email goes through whenever the cell is on (owner's call, 2026-09-03: the
 * Delivery card is gone, so quiet hours and the weekend mute no longer gate
 * anything). The stored `quietFrom` / `quietTo` / `muteWeekends` fields are
 * kept in the blob for older rows but are not consulted. `now` / `tz` stay in
 * the signature so the callers need not change.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `now` / `tz` kept for the callers' sake
export function allowsEmail(prefs: NotificationPrefs, key: PrefKey, now?: Date, tz?: string): boolean {
  return prefs.matrix[key]?.[1] ?? false;
}

// ── text messages (2026-09-24) ───────────────────────────────────────────

/** The Text cell alone — whether this member wants the event by text at all. */
export function allowsSms(prefs: NotificationPrefs, key: PrefKey): boolean {
  return prefs.matrix[key]?.[2] ?? false;
}

/**
 * Text now, hold it for the morning, or not at all. Quiet hours DO gate
 * texts (a phone buzzing at 2 AM is not a notification, it is a complaint):
 * a held text goes out at the end of the quiet window, folded with anything
 * else that waited into one message. A new lead never waits.
 */
export function smsDecision(prefs: NotificationPrefs, key: PrefKey, now: Date, tz: string): "send" | "hold" | "skip" {
  if (!allowsSms(prefs, key)) return "skip";
  if (SMS_URGENT_KEYS.includes(key)) return "send";
  return inQuietHours(prefs, now, tz) ? "hold" : "send";
}

/** The instant the wall clock in `tz` next reads `hh:mm` (today if still ahead, else tomorrow). */
export function nextLocalTime(hhmm: string, now: Date, tz: string): Date {
  const [h, m] = hhmm.split(":").map((x) => Number.parseInt(x, 10));
  const hour = Number.isFinite(h) ? h : 7;
  const minute = Number.isFinite(m) ? m : 0;
  const at = (day: Date) => {
    const guess = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute, 0));
    try {
      const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const p = Object.fromEntries(dtf.formatToParts(guess).map((x) => [x.type, x.value])) as Record<string, string>;
      const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      return new Date(guess.getTime() - (asUtc - guess.getTime()));
    } catch {
      return guess;
    }
  };
  // The local calendar day may differ from the UTC one; try yesterday, today, tomorrow and take the first ahead of now.
  for (const off of [-1, 0, 1]) {
    const t = at(new Date(now.getTime() + off * 86_400_000));
    if (t.getTime() > now.getTime()) return t;
  }
  return at(new Date(now.getTime() + 2 * 86_400_000));
}

/** When a held text goes out: the end of this member's quiet window. */
export function nextQuietEnd(prefs: NotificationPrefs, now: Date, tz: string): Date {
  return nextLocalTime(prefs.quietTo, now, tz);
}
