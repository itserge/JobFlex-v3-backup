// Pure (record) → EmailDoc builders for the three worker-facing emails. No
// I/O, so the gallery can render them from fixtures and the senders stay
// thin. Voice: contractor lockup, read one-handed on a jobsite — action
// first. NO money anywhere: a worker never sees what a job is worth.
import type { BoxRow, EmailDoc, Lockup } from "../doc";
import { truncate } from "../fit";
import type { OrgBrand } from "./client";

const TITLE_MAX = 70;

function orgLockup(org: OrgBrand): Lockup {
  return { kind: "org", name: org.name, logoUrl: org.logoUrl ?? null, orgId: org.id ?? null };
}

function orgFooter(org: OrgBrand) {
  return { name: org.name, contact: org.phone ?? undefined };
}

function formatTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d);
}

/** The moment is the anchor (principle 18) — never a dollar figure. */
function formatStartDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" }).format(d);
}

export interface JobAssignmentInput {
  org: OrgBrand;
  workerName: string;
  title: string;
  startsAt: Date | null;
  address: string | null;
  /** Display names of the OTHER workers on this job — never the recipient. */
  crew: string[];
  href: string;
}

/**
 * Box: Time, Address, Crew, then the start date as the anchor — the moment
 * is the anchor, not a total (principle 18). NO money anywhere. If you find
 * yourself passing a total into this builder, stop: workers don't see job
 * value.
 */
export function buildJobAssignment(i: JobAssignmentInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Time", value: i.startsAt ? formatTime(i.startsAt) : "TBD" },
    { type: "field", label: "Address", value: i.address ?? "See job for details" },
    { type: "field", label: "Crew", value: i.crew.length ? i.crew.join(", ") : "Just you" },
    { type: "anchor", label: "Starts", value: i.startsAt ? formatStartDate(i.startsAt) : "TBD" },
    { type: "cond", label: "Confirm by", chip: "24 hours", tone: "warn" },
  ];
  return {
    subject: `New job assignment — ${truncate(i.title, TITLE_MAX)}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Assignment" },
    headline: truncate(i.title, TITLE_MAX),
    prose: [`Hi ${i.workerName.split(" ")[0]} — you've got a new job assignment.`],
    box,
    cta: { label: "Confirm or decline", href: i.href },
    footer: orgFooter(i.org),
  };
}

export interface AppointmentAssignmentInput {
  org: OrgBrand;
  workerName: string;
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  /** Where it happens, when the appointment carries a linked record. */
  address: string | null;
  notes: string | null;
  href: string;
}

/**
 * Staffed on an APPOINTMENT — a site visit, a walkthrough, an estimate call.
 *
 * Distinct from buildJobAssignment on purpose: an appointment is not a job, so
 * there is nothing to accept or decline and no crew list to read. The CTA opens
 * their schedule rather than a confirm/decline gate, and the box carries the
 * notes, which for a visit are usually the whole brief.
 */
export function buildAppointmentAssignment(i: AppointmentAssignmentInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Time", value: i.startsAt ? formatTime(i.startsAt) : "TBD" },
    { type: "field", label: "Where", value: i.address ?? "See your schedule" },
    { type: "anchor", label: "Date", value: i.startsAt ? formatStartDate(i.startsAt) : "TBD" },
  ];
  if (i.notes) box.push({ type: "field", label: "Notes", value: truncate(i.notes, 120) });
  return {
    subject: `You're scheduled — ${truncate(i.title, TITLE_MAX)}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Schedule" },
    headline: truncate(i.title, TITLE_MAX),
    prose: [`Hi ${i.workerName.split(" ")[0]} — you've been put on the schedule.`],
    box,
    cta: { label: "Open my schedule", href: i.href },
    footer: orgFooter(i.org),
  };
}

export interface WorkerInviteInput {
  org: OrgBrand;
  workerName: string;
  inviterName: string | null;
  /** Already articled, e.g. "an installer". */
  roleLabel: string;
  href: string;
}

/**
 * Nothing worth boxing for an invite, so a one-row box holds only the
 * condition. This is what keeps "the condition is part of the grid" true
 * when there is no grid (principle 21).
 */
export function buildWorkerInvite(i: WorkerInviteInput): EmailDoc {
  const box: BoxRow[] = [{ type: "cond", label: "Link expires", chip: "In 7 days" }];
  return {
    subject: `${i.inviterName ?? i.org.name} invited you to join ${i.org.name}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Invite" },
    headline: `Join ${i.org.name}`,
    prose: [
      `Hi ${i.workerName.split(" ")[0]} — ${i.inviterName ?? "your team"} has invited you to join ${i.org.name} on JobFlex as ${i.roleLabel}.`,
      "Accept and you'll set a password and see the jobs assigned to you.",
    ],
    box,
    cta: { label: "Accept invite", href: i.href },
    footer: orgFooter(i.org),
  };
}

export interface TeamInviteInput {
  org: OrgBrand;
  inviterName: string | null;
  /** Lower-cased office role, e.g. "manager". */
  roleLabel: string;
  href: string;
}

/** Same shape as buildWorkerInvite — office role wording instead of a crew role. */
export function buildTeamInvite(i: TeamInviteInput): EmailDoc {
  const box: BoxRow[] = [{ type: "cond", label: "Link expires", chip: "In 7 days" }];
  return {
    subject: `Invitation to ${i.org.name}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Invite" },
    headline: `Join ${i.org.name}`,
    prose: [
      `${i.inviterName ?? "Your team"} has invited you to join ${i.org.name} on JobFlex as ${i.roleLabel}.`,
    ],
    box,
    cta: { label: "Accept invite", href: i.href },
    footer: orgFooter(i.org),
  };
}
