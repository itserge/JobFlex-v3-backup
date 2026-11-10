// MORE TRIAL DAYS (owner, 2026-10-20; lib/trialExtension). Three emails, pure, no I/O:
//   · to the platform admins when an owner asks from the cancel questions — a work item, no greeting
//     (operator altitude, like build/operator.ts), with the one button to the request;
//   · to the owner when an admin approves — the new trial end, the button to the app;
//   · to the owner when an admin denies — the reason when there is one, the button to the plans.
import type { BoxRow, EmailDoc, Lockup } from "../doc";
import { truncate } from "../fit";

const PLATFORM_LOCKUP: Lockup = { kind: "platform" };
const PLATFORM_FOOTER = { name: "JobFlex" };
const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
const NOTE_MAX = 400;

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || "there";

export interface TrialExtensionAskedInput {
  orgName: string;
  ownerEmail: string;
  planName: string;
  trialEndsAt: Date | null;
  /** The trial is already over (it ended at most 14 days ago). */
  ended: boolean;
  days: number;
  note: string | null;
  /** Absolute link to /admin/trial-requests?request=<id>. */
  href: string;
}

export function buildTrialExtensionAsked(i: TrialExtensionAskedInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Company", value: i.orgName },
    { type: "field", label: "Owner", value: i.ownerEmail },
    { type: "field", label: "Plan", value: i.planName },
    { type: "field", label: i.ended ? "Trial ended" : "Trial ends", value: i.trialEndsAt ? DATE_FMT.format(i.trialEndsAt) : "—" },
    { type: "cond", label: "Asked for", chip: `${i.days} more days`, tone: "warn" },
  ];
  return {
    subject: `Trial extension request — ${i.orgName} (+${i.days} days)`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Trial extension", tone: "warn" },
    headline: `${i.orgName} asks for ${i.days} more trial days`,
    prose: [
      `Asked from the cancel questions ("I didn't have enough time"), on the way to cancelling ${i.planName}. The subscription was not cancelled.`,
      i.note ? `What they still want to try: “${truncate(i.note, NOTE_MAX)}”` : "They left no note.",
    ],
    box,
    cta: { label: "Open the request", href: i.href },
    after: ["Approve 7 or 14 days, or deny with a short reason — the owner is emailed either way. They were told to expect an answer within one business day."],
    footer: PLATFORM_FOOTER,
  };
}

export interface TrialExtendedInput {
  name: string | null;
  planName: string;
  until: Date;
  days: number;
  /** Absolute link to /dashboard. */
  href: string;
}

export function buildTrialExtended(i: TrialExtendedInput): EmailDoc {
  const until = DATE_FMT.format(i.until);
  return {
    subject: `Your trial is extended until ${until}`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Trial extended", tone: "ok" },
    headline: `Your trial is extended until ${until}`,
    prose: [
      `Hi ${firstName(i.name)} — you asked for more time, and you have it: ${i.days} more days of ${i.planName}, with everything on it.`,
      "Nothing is charged before then. Your proposals, clients and settings are exactly where you left them.",
    ],
    box: [
      { type: "field", label: "Plan", value: i.planName },
      { type: "cond", label: "Trial ends", chip: until, tone: "ok" },
    ],
    cta: { label: "Open JobFlex", href: i.href },
    after: ["Questions, or something you'd like a hand with while you try it? Reply to this email."],
    footer: PLATFORM_FOOTER,
  };
}

export interface TrialExtensionDeniedInput {
  name: string | null;
  planName: string;
  reason: string | null;
  /** Absolute link to /dashboard/subscription. */
  href: string;
}

export function buildTrialExtensionDenied(i: TrialExtensionDeniedInput): EmailDoc {
  return {
    subject: "We couldn't extend your trial this time",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Trial extension", tone: "warn" },
    headline: "We couldn't extend your trial this time",
    prose: [
      `Hi ${firstName(i.name)} — thank you for asking. We can't add more days to your ${i.planName} trial this time.`,
      ...(i.reason ? [`The reason: ${truncate(i.reason, NOTE_MAX)}`] : []),
      "Your account and everything in it stay as they are. You can pick the plan that fits from the plans page whenever you're ready.",
    ],
    cta: { label: "See the plans", href: i.href },
    after: ["Questions? Reply to this email."],
    footer: PLATFORM_FOOTER,
  };
}
