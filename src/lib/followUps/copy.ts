// Follow-up rules — the copy the client actually receives.
//
// One module, imported by BOTH sides, which is the whole point: the preview
// card in the CRM (desktop `crm-behavior.ts`, mobile `mobile-crm.tsx`) renders
// exactly what `dispatchOne()` in src/actions/followUps.ts posts to the
// transport. There is no second set of words anywhere.
//
// PURE — no I/O, no `db`, no `process.env`. It is imported into client bundles.
//
// WHY THE COPY LIVES HERE AND NOT IN AN EmailTemplate ROW. A follow-up rule
// used to carry a template id, which meant the contractor had to author (and
// keep authoring) reminder copy before a rule could say anything useful. The
// rule already knows the ONE thing that determines what to say — the proposal
// status that fired it — so the wording is derived from the trigger and the
// template field is gone. `FollowUpRule.template` now stores the rule's send
// CHANNEL instead (see `parseChannel`), which is the only per-rule choice left.

import type { EmailDoc } from "@/lib/email/doc";
import { formatUSD } from "@/lib/email/build/client";

/** How a rule reaches the client. TEXT needs a configured Twilio number; the
 *  editors offer it disabled when `isTwilioEnabled()` is false, exactly like
 *  the client message composer. */
export type FollowUpChannel = "EMAIL" | "TEXT";

export const FOLLOW_UP_CHANNELS: Array<{ value: FollowUpChannel; label: string }> = [
  { value: "EMAIL", label: "Email" },
  { value: "TEXT", label: "Text message" },
];

/** Shown wherever a rule row prints its channel. */
export function channelLabel(c: FollowUpChannel): string {
  return c === "TEXT" ? "Text" : "Email";
}

/** Shown when texting is not switched on (no Twilio settings on the platform) — same sentence the client message
 *  dialog uses, so the two surfaces explain the gap identically. It names the Texting page (/dashboard/texting),
 *  which says where texting stands and is where a company gets its number; it used to say "the Phone page", a
 *  name no menu carries (2026-11-10). */
export const TEXT_NEEDS_TWILIO = "Texting is not switched on yet — see the Texting page.";

/** A rule's longest delay — a year, in minutes. actions/followUps refuses
 *  more, and every editor checks it before sending: an unbounded delay
 *  overflowed the Int column (QA F-fd2683fc) or scheduled an Invalid Date. */
export const MAX_DELAY_MINUTES = 525_600;
export const MAX_DELAY_DAYS = MAX_DELAY_MINUTES / 1440;

/** The typed day count as whole days, or the sentence the field shows. */
export function readDelayDays(text: string): number | string {
  const t = text.trim();
  const n = Number(t);
  if (!t || !Number.isInteger(n) || n < 1 || n > MAX_DELAY_DAYS) return `Enter whole days, 1 to ${MAX_DELAY_DAYS}.`;
  return n;
}

/**
 * `FollowUpRule.template` is a free-form `String?`. Reusing it for the channel
 * keeps the rule on one row with no schema change; rows written before this
 * change hold an EmailTemplate cuid, which is not one of our tokens and so
 * reads as EMAIL — the behaviour those rules already had.
 */
export function parseChannel(stored: string | null | undefined): FollowUpChannel {
  return stored === "TEXT" ? "TEXT" : "EMAIL";
}

/** What goes back into the column. */
export function encodeChannel(c: FollowUpChannel): string {
  return c === "TEXT" ? "TEXT" : "EMAIL";
}

// ─────────────────────────────────────────────
// The queued row carries channel + trigger forward
//
// `FollowUp` has no columns of its own for either, and adding some would be a
// schema change. `FollowUp.templateId` is a free-form `String?` with no foreign
// key, so a rule stamps "<CHANNEL>|<TRIGGER>" into it when it schedules. A row
// queued before this change holds either null or a cuid; neither parses, and
// both fall back to an email carrying the generic reminder wording — which is
// what those rows were always going to send.
// ─────────────────────────────────────────────

const DISPATCH_TOKEN = /^(EMAIL|TEXT)\|([A-Z_]+)$/;

export function encodeDispatch(channel: FollowUpChannel, trigger: string): string {
  return `${encodeChannel(channel)}|${trigger}`;
}

export function parseDispatch(stored: string | null | undefined): {
  channel: FollowUpChannel;
  trigger: string | null;
} {
  const m = stored ? DISPATCH_TOKEN.exec(stored) : null;
  if (!m) return { channel: "EMAIL", trigger: null };
  return { channel: m[1] as FollowUpChannel, trigger: m[2] };
}

// ─────────────────────────────────────────────
// The copy itself
// ─────────────────────────────────────────────

/** Everything the wording can refer to. All of it is already on the proposal
 *  the follow-up hangs off, so nothing new is asked of the database. */
export interface FollowUpContext {
  orgName: string;
  orgLogoUrl?: string | null;
  /** Links the logo in the mail (lib/email/doc Lockup). */
  orgId?: string | null;
  orgPhone?: string | null;
  clientName: string;
  /** Proposal title — the headline of the original quote. */
  title: string;
  total: number;
  validUntil: Date | null;
  /** Public portal link for the proposal. */
  href: string;
  /** How long the rule waited, written out ("2 days"). Used in the prose. */
  delayLabel: string;
}

function firstName(name: string): string {
  const n = name.trim().split(/\s+/)[0] ?? "";
  // "M. Henderson" — an initial is not a first name worth greeting by.
  return /^[A-Za-z]\.$/.test(n) ? name.trim().split(/\s+/).slice(1).join(" ") || n : n;
}

function shortDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(d);
}

/** Trigger → the shape of the nudge. One entry per option the rule editors
 *  offer (TRIGGERS in both crm-data modules). Anything unrecognised falls back
 *  to the SENT wording, which is the neutral "still holding your price" nudge. */
type Voice = {
  /** Sentence-case name of the moment, for the editors' own UI. */
  moment: string;
  kicker: string;
  tone?: "ok" | "warn" | "bad";
  headline: string;
  subject: (ctx: FollowUpContext) => string;
  prose: (ctx: FollowUpContext) => string[];
  after?: (ctx: FollowUpContext) => string[];
  /** Omitted where there is nothing for the client to do. */
  cta?: string;
  /** The money box. Some moments don't want one. */
  box: "quote" | "agreed" | "none";
  sms: (ctx: FollowUpContext) => string;
};

const VOICES: Record<string, Voice> = {
  SENT: {
    moment: "Proposal sent, no answer yet",
    kicker: "Reminder",
    headline: "Still holding your price",
    subject: (c) => `Still holding your price — ${c.title}`,
    prose: (c) => [
      `Hi ${firstName(c.clientName)} — we sent this over ${c.delayLabel} ago and haven't heard back yet, so I wanted to make sure it didn't get buried.`,
      "The price below is still the price. Nothing's changed on our end.",
    ],
    after: () => ["If anything in it needs adjusting, reply here and we'll rework it."],
    cta: "Review & accept",
    box: "quote",
    sms: (c) =>
      `Hi ${firstName(c.clientName)}, ${c.orgName} here — just checking you got the quote for ${c.title} (${formatUSD(c.total)}). Still holding that price: ${c.href}`,
  },
  VIEWED: {
    moment: "Opened the proposal, no decision",
    kicker: "Reminder",
    headline: "Any questions on the quote?",
    subject: (c) => `Any questions on ${c.title}?`,
    prose: (c) => [
      `Hi ${firstName(c.clientName)} — I can see you've had a look at the quote, and it's been ${c.delayLabel} since.`,
      "If something in it isn't sitting right — the scope, the timing, the number — say the word and we'll go through it.",
    ],
    after: () => ["Happy to walk it line by line over the phone if that's easier."],
    cta: "Review & accept",
    box: "quote",
    sms: (c) =>
      `Hi ${firstName(c.clientName)}, ${c.orgName} here — saw you opened the quote for ${c.title}. Any questions, just reply. ${c.href}`,
  },
  ACCEPTED: {
    moment: "Accepted, waiting to start",
    kicker: "Confirmed",
    tone: "ok",
    headline: "We're all set to start",
    subject: (c) => `Next steps for ${c.title}`,
    prose: (c) => [
      `Thanks ${firstName(c.clientName)} — the job's confirmed our end and we're lining up the schedule.`,
      "Nothing needed from you right now. When we have a firm start date you'll hear it here first.",
    ],
    after: () => ["Anything that changes on your side in the meantime, just reply."],
    box: "agreed",
    sms: (c) =>
      `Hi ${firstName(c.clientName)}, ${c.orgName} here — you're booked in for ${c.title}. We'll confirm the start date shortly. Anything to flag, just reply.`,
  },
  PAID: {
    moment: "Paid",
    kicker: "Thank you",
    tone: "ok",
    headline: "Payment received — thank you",
    subject: (c) => `Thanks for the payment — ${c.title}`,
    prose: (c) => [
      `Thanks ${firstName(c.clientName)}, that's come through and the account's square.`,
      "If everything held up the way it should, a short review genuinely helps a small shop like ours.",
    ],
    after: () => ["And if anything isn't right, reply here first — we'd rather fix it than read about it."],
    box: "agreed",
    sms: (c) =>
      `Hi ${firstName(c.clientName)}, ${c.orgName} here — payment received for ${c.title}, thank you. Anything not right, just reply and we'll sort it.`,
  },
  DECLINED: {
    moment: "Declined",
    kicker: "One last thing",
    tone: "warn",
    headline: "Worth one more look?",
    subject: (c) => `Before we close the file on ${c.title}`,
    prose: (c) => [
      `Hi ${firstName(c.clientName)} — understood on the quote, and no hard feelings.`,
      "Before we close the file: if it was the number, there's usually a version of the job that fits a tighter budget. Tell us the figure and we'll tell you honestly whether it's doable.",
    ],
    after: () => ["Either way, thanks for asking us to price it."],
    cta: "Take another look",
    box: "quote",
    sms: (c) =>
      `Hi ${firstName(c.clientName)}, ${c.orgName} here. Understood on ${c.title}. If it was the number, tell us your budget and we'll say honestly whether it's doable.`,
  },
};

export function voiceFor(trigger: string | null | undefined): Voice {
  return VOICES[(trigger ?? "SENT").toUpperCase()] ?? VOICES.SENT;
}

/** The one-line description each editor prints under the trigger picker. */
export function triggerMoment(trigger: string): string {
  return voiceFor(trigger).moment;
}

/**
 * The email a rule sends, as an `EmailDoc`. Render it with
 * `renderEmail()` — the preview cards and `dispatchOne()` both do, so the
 * pixels a contractor approves are the pixels the homeowner opens.
 */
export function followUpEmailDoc(trigger: string, ctx: FollowUpContext, own?: { subject?: string | null; prose: string[] }): EmailDoc {
  const v = voiceFor(trigger);
  // Words written for this client (lib/followUps/agent, 2026-11-10): the frame — logo, price box, button, footer —
  // stays the standard one; only the subject and the paragraphs are theirs, and the stock closing line is dropped.
  const custom = own && own.prose.length ? own : null;

  const box: EmailDoc["box"] = [];
  if (v.box === "quote") {
    box.push({ type: "anchor", label: "Total", value: formatUSD(ctx.total) });
    if (ctx.validUntil) {
      const days = Math.ceil((ctx.validUntil.getTime() - Date.now()) / 86_400_000);
      // A rule can legitimately fire after the quote lapsed — "0 days" would
      // misreport an expired price as still live.
      if (days <= 0) box.push({ type: "cond", label: "Price held until", chip: "Expired", tone: "bad" });
      else
        box.push({
          type: "cond",
          label: "Price held until",
          chip: shortDate(ctx.validUntil),
          tone: days <= 3 ? "warn" : "neutral",
        });
    }
  } else if (v.box === "agreed") {
    box.push({ type: "field", label: "Job", value: ctx.title });
    box.push({ type: "anchor", label: "Agreed", value: formatUSD(ctx.total) });
  }

  return {
    subject: custom?.subject?.trim() || v.subject(ctx),
    lockup: { kind: "org", name: ctx.orgName, logoUrl: ctx.orgLogoUrl ?? null, orgId: ctx.orgId ?? null },
    kicker: { text: v.kicker, tone: v.tone },
    headline: v.headline,
    prose: custom ? custom.prose : v.prose(ctx),
    box: box.length ? box : undefined,
    cta: v.cta ? { label: v.cta, href: ctx.href } : undefined,
    after: custom ? undefined : v.after?.(ctx),
    footer: { name: ctx.orgName, contact: ctx.orgPhone ?? undefined },
  };
}

/** The standard words as a person reads them before saying yes: the subject and the paragraphs, no frame. */
export function followUpPlainWords(trigger: string, ctx: FollowUpContext): { subject: string; body: string } {
  const v = voiceFor(trigger);
  return { subject: v.subject(ctx), body: [...v.prose(ctx), ...(v.after?.(ctx) ?? [])].join("\n\n") };
}

/** The text-message version of the same nudge. One message, no link where the
 *  moment doesn't need one. */
export function followUpSmsText(trigger: string, ctx: FollowUpContext): string {
  return voiceFor(trigger).sms(ctx);
}

/** Minutes → the phrase the prose uses ("2 days", "6 hours", "45 minutes"). */
export function delayLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes < 60 * 24) {
    const h = Math.round(minutes / 60);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(minutes / 60 / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/**
 * Stand-in record for the preview cards. A preview must never quote a real
 * client's numbers at a colleague looking over a shoulder, and a rule is
 * authored before it has ever fired, so there is no real record to show.
 */
export function previewContext(orgName: string, delayMinutes: number): FollowUpContext {
  return {
    orgName: orgName || "Your company",
    clientName: "Dana Whitfield",
    title: "Rear deck rebuild — 320 sq ft",
    total: 14850,
    validUntil: new Date(Date.now() + 9 * 86_400_000),
    href: "https://app.jobflex.app/portal/q/preview",
    delayLabel: delayLabel(delayMinutes),
  };
}

/** When the next queued follow-up goes, as the status line says it ("in 5 h").
 *  The cron runs hourly, so a row already due goes out within the hour. */
export function nextSendLabel(runAt: number, now: number): string {
  const ms = runAt - now;
  if (ms <= 0) return "within the hour";
  const h = ms / 3_600_000;
  if (h < 1) return "in under an hour";
  if (h < 36) return `in ${Math.round(h)} h`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? "" : "s"}`;
}

/** The one status line over the rules (desk and phone CRM): whether any rule
 *  is on, how many, and when the next queued follow-up goes. */
export function followUpsStatus(
  activeRules: number,
  nextRunAt: number | null,
  now: number,
): { on: boolean; lead: string; rest: string } {
  if (!activeRules) return { on: false, lead: "Follow-ups are off", rest: "" };
  return {
    on: true,
    lead: "Follow-ups are on:",
    rest:
      `${activeRules} ${activeRules === 1 ? "rule" : "rules"} active · ` +
      (nextRunAt === null ? "nothing queued yet" : `next send ${nextSendLabel(nextRunAt, now)}`),
  };
}
