// THE LEAD SET-UP REMINDER (owner, 2026-10-07: "remind them every day to set
// up address and specialties for leads"). Since 2026-11-11 at most three —
// days 1, 3 and 7 — while either is missing (lib/leadSetupReminders).
import type { BoxRow, EmailDoc, Lockup } from "../doc";

const PLATFORM_LOCKUP: Lockup = { kind: "platform" };
const PLATFORM_FOOTER = { name: "JobFlex" };

export interface LeadSetupReminderInput {
  name: string | null;
  business: string;
  needsAddress: boolean;
  needsTrades: boolean;
  /** The company name is still the owner's own name (lib/orgName, 2026-10-10). */
  needsName?: boolean;
  /** The company page, where the address and the trades are set. */
  href: string;
  /** The nth reminder, from 1. */
  nth: number;
}

export function buildLeadSetupReminder(i: LeadSetupReminderInput): EmailDoc {
  if (i.needsName && !i.needsAddress && !i.needsTrades) return buildNameReminder(i);
  const first = i.name?.trim().split(/\s+/)[0] || "there";
  const what = i.needsAddress && i.needsTrades ? "your address and specialties" : i.needsAddress ? "your address" : "your specialties";
  const box: BoxRow[] = [
    { type: "cond", label: "Address", chip: i.needsAddress ? "Missing" : "Set", tone: i.needsAddress ? "warn" : "ok" },
    { type: "cond", label: "Specialties", chip: i.needsTrades ? "Missing" : "Set", tone: i.needsTrades ? "warn" : "ok" },
    ...(i.needsName ? [{ type: "cond" as const, label: "Company name", chip: "Not set", tone: "warn" as const }] : []),
  ];
  return {
    subject: i.nth === 1 ? "Add your address and specialties to start receiving leads" : `Still no leads for ${i.business}: ${what} missing`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Free leads", tone: "warn" },
    headline: i.nth === 1 ? "Leads need two things from you" : "Your leads are waiting on one step",
    prose: [
      `Hi ${first} — homeowner jobs are matched to ${i.business} by distance and by trade. Right now ${what} ${i.needsAddress && i.needsTrades ? "are" : "is"} not set, so there is nothing to match yet.`,
      "It takes about two minutes on your company page: type the company address, pick the trades you want jobs for, save. Matching starts the same day.",
      ...(i.needsName ? ["While you are there, name your company — clients see the name on proposals, emails and texts, and right now it is your own."] : []),
    ],
    box,
    cta: { label: "Complete your profile", href: i.href },
    after: ["This reminder stops as soon as both are set — three at most. Reply to this email if anything is unclear."],
    footer: PLATFORM_FOOTER,
  };
}

/** Only the company name is missing (the passwordless sign-up names the shop
 *  after its owner): the same daily mail, about the name. */
function buildNameReminder(i: LeadSetupReminderInput): EmailDoc {
  const first = i.name?.trim().split(/\s+/)[0] || "there";
  return {
    subject: "Name your company on JobFlex",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Company", tone: "warn" },
    headline: "Your company has no name yet",
    prose: [
      `Hi ${first} — your proposals, emails and texts to clients go out under ${i.business}, your own name. Add your company name and every one of them carries it.`,
    ],
    box: [{ type: "cond", label: "Company name", chip: "Not set", tone: "warn" }],
    cta: { label: "Name your company", href: i.href },
    after: ["Trading under your own name? Open the page and press Keep this name — this reminder stops."],
    footer: PLATFORM_FOOTER,
  };
}
