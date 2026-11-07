// THE LEAD FOLLOW-UP (owner, 2026-11-07: "make a reminder to the contractor to create the proposal and send it, or
// contact the client"). A shop accepted a homeowner's lead and nothing has gone out: one mail at a day ("call them"),
// one at three days ("send the proposal"), one at a week. Three stages, one builder (lib/leadFollowUps).
import type { BoxRow, EmailDoc, Lockup } from "../doc";

const PLATFORM_LOCKUP: Lockup = { kind: "platform" };
const PLATFORM_FOOTER = { name: "JobFlex" };

export type LeadFollowUpStage = "contact" | "proposal" | "final";

export interface LeadFollowUpInput {
  stage: LeadFollowUpStage;
  homeowner: string;
  phone: string | null;
  email: string | null;
  project: string;
  where: string;
  acceptedAt: Date;
  daysSince: number;
  /** A visit on the calendar for this lead, when there is one. */
  visitAt: Date | null;
  /** The lead on the shop's Leads page. */
  href: string;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || "the homeowner";
const dayWords = (n: number) => (n <= 1 ? "yesterday" : n < 14 ? `${n} days ago` : `${Math.round(n / 7)} weeks ago`);
const when = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function buildLeadFollowUp(i: LeadFollowUpInput): EmailDoc {
  const next = i.stage === "contact" ? "Call them" : "Send the proposal";
  const box: BoxRow[] = [
    { type: "field", label: "Homeowner", value: i.homeowner },
    ...(i.phone ? [{ type: "field" as const, label: "Phone", value: i.phone }] : []),
    ...(i.email ? [{ type: "field" as const, label: "Email", value: i.email }] : []),
    { type: "field", label: "Project", value: `${i.project} · ${i.where}` },
    { type: "anchor", label: "Accepted", value: `${when(i.acceptedAt)} — ${dayWords(i.daysSince)}` },
    ...(i.visitAt ? [{ type: "field" as const, label: "Visit", value: i.visitAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) }] : []),
    { type: "cond", label: "Next", chip: next, tone: "warn" },
  ];
  const subject =
    i.stage === "contact"
      ? `${i.homeowner} is waiting — call them or send the proposal`
      : i.stage === "proposal"
        ? `Send ${first(i.homeowner)} the proposal — accepted ${dayWords(i.daysSince)}`
        : `${i.homeowner} still has no proposal, a week on`;
  const headline = i.stage === "contact" ? `${first(i.homeowner)} hasn't heard from you` : i.stage === "proposal" ? "The proposal is the next step" : "A week in, nothing sent";
  const prose =
    i.stage === "contact"
      ? [
          `You accepted ${i.homeowner}'s ${i.project.toLowerCase()} lead ${dayWords(i.daysSince)}, and nothing has gone out to them yet — no call, no visit, no proposal.`,
          "A homeowner who hears nothing for two days books someone else. A call today keeps the job.",
        ]
      : i.stage === "proposal"
        ? [
            i.visitAt
              ? `You saw ${first(i.homeowner)} on ${when(i.visitAt)}. The proposal hasn't gone out yet.`
              : `You accepted ${i.homeowner}'s ${i.project.toLowerCase()} lead ${dayWords(i.daysSince)}. The proposal hasn't gone out yet.`,
            "Open the lead and build it — the estimator has what they asked for. Sending it from JobFlex puts it on their page with a button to accept.",
          ]
        : [
            `${i.homeowner}'s ${i.project.toLowerCase()} lead has been yours for a week with no proposal sent.`,
            "If the job is off, mark the lead lost so it stops asking. If it's on, send the proposal today — this is the last reminder.",
          ];
  return {
    subject,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Lead follow-up", tone: "warn" },
    headline,
    prose,
    box,
    cta: { label: i.stage === "contact" ? "Open the lead" : "Build the proposal", href: i.href },
    footer: PLATFORM_FOOTER,
  };
}

/** The office text, one line. */
export function leadFollowUpLine(i: LeadFollowUpInput): string {
  const ask = i.stage === "contact" ? (i.phone ? `Call ${i.phone} or book a visit` : "Call them or book a visit") : "Send the proposal";
  return `${i.homeowner} (${i.project.toLowerCase()}, ${i.where}) is waiting: you accepted the lead ${dayWords(i.daysSince)} and nothing has gone out. ${ask}: ${i.href}`;
}
