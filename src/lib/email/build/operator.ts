// Pure (record) → EmailDoc builders for the four operator-facing emails. No
// I/O, so the gallery can render them from fixtures and the senders stay
// thin. Voice: work item, not a message — NO greeting, NO sign-off
// (principle 19, operator altitude). Trade jargon and internal IDs are
// welcome here; this is the opposite of client.ts's letter voice.
import type { BoxRow, EmailDoc, Lockup } from "../doc";
import { truncate } from "../fit";
import { formatUSD, type OrgBrand } from "./client";

const TITLE_MAX = 70;

const PLATFORM_LOCKUP: Lockup = { kind: "platform" };

function orgLockup(org: OrgBrand): Lockup {
  return { kind: "org", name: org.name, logoUrl: org.logoUrl ?? null };
}

function orgFooter(org: OrgBrand) {
  return { name: org.name, contact: org.phone ?? undefined };
}

function shortDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(d);
}

/** Reservation remaining as HH:MM. Clamps at 00:00 — never renders negative. */
export function countdown(from: Date, hours: number): string {
  const msLeft = from.getTime() + hours * 3_600_000 - Date.now();
  if (msLeft <= 0) return "00:00";
  const h = Math.floor(msLeft / 3_600_000);
  const m = Math.floor((msLeft % 3_600_000) / 60_000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface OwnerAcceptedInput {
  org: OrgBrand;
  clientName: string;
  title: string;
  acceptedAt: Date;
  total: number;
  needsScheduling: boolean;
  href: string;
}

/** Link, not CTA — there is nothing to do but know it (principle 06·a). */
export function buildOwnerAccepted(i: OwnerAcceptedInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Job", value: truncate(i.title, TITLE_MAX) },
    { type: "field", label: "Accepted", value: shortDate(i.acceptedAt) },
    { type: "anchor", label: "Value", value: formatUSD(i.total) },
  ];
  if (i.needsScheduling) {
    box.push({ type: "cond", label: "Needs scheduling", chip: "Now", tone: "warn" });
  }
  return {
    subject: `Accepted — ${i.title}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Won", tone: "ok" },
    headline: `${i.clientName} accepted`,
    box,
    link: { label: "Open proposal", href: i.href },
    footer: orgFooter(i.org),
  };
}

export interface CrewResponseInput {
  org: OrgBrand;
  workerName: string;
  title: string;
  response: "ACCEPTED" | "DECLINED";
  startsAt: Date | null;
  /** What the response did to the job — "Scheduled" / "Canceled" / null when
   *  nothing changed (other crew still on it). */
  jobStatusNow: string | null;
  href: string;
}

/** Crew answered an assignment (2026-08-22). Link, not CTA on an accept —
 *  nothing to do but know it; a DECLINE carries a warn chip because the work
 *  now needs someone else. */
export function buildCrewResponse(i: CrewResponseInput): EmailDoc {
  const accepted = i.response === "ACCEPTED";
  const box: BoxRow[] = [
    { type: "field", label: "Job", value: truncate(i.title, TITLE_MAX) },
    { type: "field", label: "Crew", value: i.workerName },
    { type: "anchor", label: "Starts", value: i.startsAt ? shortDate(i.startsAt) : "TBD" },
  ];
  if (i.jobStatusNow) {
    box.push({
      type: "cond",
      label: "Job status",
      chip: i.jobStatusNow,
      tone: accepted ? "ok" : "warn",
    });
  }
  if (!accepted) {
    box.push({ type: "cond", label: "Needs crew", chip: "Reassign", tone: "warn" });
  }
  return {
    subject: `${accepted ? "Accepted" : "Declined"} — ${truncate(i.title, TITLE_MAX)}`,
    lockup: orgLockup(i.org),
    kicker: accepted ? { text: "Confirmed", tone: "ok" } : { text: "Declined", tone: "warn" },
    headline: `${i.workerName} ${accepted ? "accepted" : "declined"} the job`,
    box,
    link: { label: "Open job", href: i.href },
    footer: orgFooter(i.org),
  };
}

export interface NewLeadInput {
  org: OrgBrand;
  leadName: string;
  phone: string | null;
  /** The lead's email, on its own row when there is one. */
  email?: string | null;
  project: string | null;
  source: string;
  enquiry?: string | null;
  href: string;
}

export function buildNewLead(i: NewLeadInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Phone", value: i.phone ?? "—" },
    ...(i.email ? [{ type: "field" as const, label: "Email", value: i.email }] : []),
    { type: "field", label: "Project", value: i.project ?? "—" },
    { type: "field", label: "Source", value: i.source },
    { type: "cond", label: "Call within", chip: "1 hour", tone: "warn" },
  ];
  return {
    subject: `New lead — ${i.leadName}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Lead" },
    headline: i.leadName,
    box,
    after: i.enquiry ? [`"${truncate(i.enquiry, 400)}"`] : undefined,
    cta: { label: "Open lead", href: i.href },
    footer: orgFooter(i.org),
  };
}

export interface LeadOfferInput {
  trade: string;
  where: string;
  createdAt: Date;
  reservedHours: number;
  nextShop: string;
  href: string;
  ref?: string;
}

/** Platform lockup — this is JobFlex marketplace mail, not the org's own. */
export function buildLeadOffer(i: LeadOfferInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Trade", value: i.trade },
    { type: "field", label: "Where", value: i.where },
    { type: "anchor", label: "Yours for", value: countdown(i.createdAt, i.reservedHours) },
    { type: "cond", label: "Then offered on", chip: i.nextShop, tone: "bad" },
  ];
  return {
    subject: `New lead for you — ${i.trade} in ${i.where}`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Lead offer" },
    headline: `${i.trade} lead in ${i.where}`,
    box,
    cta: { label: "Accept this lead", href: i.href },
    footer: { name: "JobFlex", ref: i.ref },
  };
}

export interface LeadOfferReminderInput {
  trade: string;
  where: string;
  /** When the reservation runs out — the countdown is measured to this. */
  expiresAt: Date;
  href: string;
  ref?: string;
}

/**
 * "Two hours left on that lead."
 *
 * Until 2026-09-17 an offer ran its whole 24 hours in silence and then simply
 * expired: the shop was told once, at minute zero, and the next thing that
 * happened was the lead going to somebody else. A shop that read the first mail
 * on a roof had no second prompt before losing the job. This is that prompt,
 * and it is the ONLY one — a third mail would be nagging.
 *
 * Platform lockup, like the offer it follows up.
 */
export function buildLeadOfferReminder(i: LeadOfferReminderInput): EmailDoc {
  const msLeft = i.expiresAt.getTime() - Date.now();
  const hoursLeft = Math.max(0, Math.round(msLeft / 3_600_000));
  const box: BoxRow[] = [
    { type: "field", label: "Trade", value: i.trade },
    { type: "field", label: "Where", value: i.where },
    { type: "anchor", label: "Time left", value: countdown(new Date(), hoursLeft) },
    { type: "cond", label: "After that", chip: "offered to the next shop", tone: "bad" },
  ];
  return {
    subject: `Still yours for ${hoursLeft === 1 ? "an hour" : `${hoursLeft} hours` } — ${i.trade} in ${i.where}`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Lead offer · reminder" },
    headline: `Your ${i.trade} lead is about to be passed on`,
    box,
    after: [
      "You were sent this lead yesterday and it is still unanswered. Accept it and the homeowner's details are yours; pass and it goes straight to the next shop — either answer is better for them than the clock running out.",
    ],
    cta: { label: "Accept this lead", href: i.href },
    footer: { name: "JobFlex", ref: i.ref },
  };
}

export interface SupportTicketInput {
  subject: string;
  body: string;
  category: string;
  priority: string;
  orgName: string;
  submitterEmail: string | null;
  /** Short ticket reference (src/lib/notify.ts → supportTicketRef). The same
   *  string the submitter is shown, so a reply and a row can be matched. */
  ref?: string;
  href: string;
}

/** Platform lockup — this reaches admins, never the submitting org. */
export interface AdminNewLeadInput {
  trade: string | null;
  /** "Tucson, AZ" — city and state, else the ZIP. */
  where: string;
  /** The scope written for a contractor, else the homeowner's words. */
  scope: string;
  /** "#LD-WHPK". */
  ref: string;
  /** Waiting in the manual queue for a person to place it. */
  queued: boolean;
  href: string;
  /** What happened (lib/leadCenter/alerts): a new request (default), one that
   *  came back to the queue, or one still waiting after the reminder delay. */
  event?: "new" | "back" | "reminder";
  /** One line on why — "Sarah asked for another contractor: “too pricey”",
   *  "Offered to Ridgeline Roofing automatically", "Waiting 1 h". */
  note?: string | null;
  /** The homeowner's first name, when they gave one. */
  firstName?: string | null;
  /** Requests waiting in the queue right now, this one included. */
  waiting?: number;
}

/** A homeowner request that needs (or may need) a person, to the platform
 *  admin (lib/leadCenter/alerts). The kicker says whether to act. */
export function buildAdminNewLead(i: AdminNewLeadInput): EmailDoc {
  const trade = i.trade ?? "Unclassified";
  const event = i.event ?? "new";
  const subject =
    event === "back"
      ? `Back in the queue — ${trade} · ${i.where}`
      : event === "reminder"
        ? `Still waiting — ${trade} · ${i.where}`
        : `New homeowner request — ${trade} · ${i.where}`;
  const box: BoxRow[] = [
    { type: "field", label: "Trade", value: trade },
    { type: "field", label: "Where", value: i.where },
  ];
  if (i.firstName) box.push({ type: "field", label: "Homeowner", value: i.firstName });
  box.push({ type: "field", label: "Request", value: i.ref });
  if (i.queued && i.waiting && i.waiting > 1) box.push({ type: "field", label: "In the queue", value: `${i.waiting} waiting` });
  return {
    subject,
    lockup: PLATFORM_LOCKUP,
    kicker: i.queued ? { text: "Take action", tone: "warn" } : { text: "Lead Center" },
    headline: `${trade} in ${i.where}`,
    prose: [
      ...(i.note ? [i.note] : []),
      i.queued
        ? "Nobody has this request yet. Open it in the Lead Center and send it to a shop."
        : "Nothing to do unless the shop passes — it comes back to the queue if they do.",
    ],
    box,
    after: i.scope ? [truncate(i.scope, 420)] : [],
    cta: { label: i.queued ? "Place it in the Lead Center" : "Open in Lead Center", href: i.href },
    footer: { name: "JobFlex", ref: i.ref },
  };
}

export interface AdminLeadsWaitingInput {
  /** Oldest first; the email lists at most ten. */
  leads: { trade: string | null; where: string; waited: string }[];
  href: string;
}

/** The reminder sweep's one email: every request still waiting past the
 *  reminder delay, in one list (lib/leadCenter/alerts). */
export function buildAdminLeadsWaiting(i: AdminLeadsWaitingInput): EmailDoc {
  const n = i.leads.length;
  const shown = i.leads.slice(0, 10);
  const box: BoxRow[] = shown.map((l) => ({ type: "field", label: `${l.trade ?? "Unclassified"} · ${l.where}`, value: `waiting ${l.waited}` }));
  if (n > shown.length) box.push({ type: "field", label: "And more", value: `${n - shown.length} more waiting` });
  return {
    subject: n === 1 ? `Still waiting — ${i.leads[0].trade ?? "Unclassified"} · ${i.leads[0].where}` : `${n} homeowner requests still waiting`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Take action", tone: "warn" },
    headline: n === 1 ? "A request still has no contractor" : `${n} requests still have no contractor`,
    prose: ["They are in the Lead Center queue and nobody has sent them to a shop yet. The homeowner was told a pro would reach out within 24 hours."],
    box,
    cta: { label: "Open the Lead Center", href: i.href },
    footer: { name: "JobFlex" },
  };
}

export function buildSupportTicket(i: SupportTicketInput): EmailDoc {
  const highPriority = i.priority === "high";
  const box: BoxRow[] = [
    { type: "field", label: "Category", value: i.category },
    { type: "field", label: "From", value: i.submitterEmail ? `${i.orgName} (${i.submitterEmail})` : i.orgName },
  ];
  // A "Respond within — 1 hour / 1 day" chip used to sit here. It was invented
  // in this function: there is no SLA anywhere in the product, no field behind
  // it and nothing that measures it, so the alert was quoting a promise the
  // platform had never made. The priority the submitter actually chose says the
  // same thing honestly, and only when it is not the default. `cond` must be
  // the last row (doc.ts).
  if (highPriority) box.push({ type: "cond", label: "Priority", chip: "High", tone: "bad" });
  return {
    subject: `${highPriority ? "High priority — " : ""}New support ticket — ${i.subject}`,
    lockup: PLATFORM_LOCKUP,
    kicker: highPriority ? { text: "High priority", tone: "bad" } : { text: "Support" },
    headline: truncate(i.subject, TITLE_MAX),
    box,
    after: [i.body],
    cta: { label: "Open admin inbox", href: i.href },
    footer: { name: "JobFlex", ref: i.ref },
  };
}

export interface OwnerDeclinedInput {
  org: OrgBrand;
  clientName: string;
  title: string;
  note: string;
  total: number;
  href: string;
}

/** The client said no, and why. Link, not CTA. */
export function buildOwnerDeclined(i: OwnerDeclinedInput): EmailDoc {
  return {
    subject: `Declined — ${truncate(i.title, 60)}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Declined", tone: "bad" },
    headline: `${i.clientName} declined`,
    prose: [`"${truncate(i.note, 400)}"`],
    box: [
      { type: "field", label: "Job", value: truncate(i.title, TITLE_MAX) },
      { type: "anchor", label: "Value", value: formatUSD(i.total) },
    ],
    link: { label: "Open proposal", href: i.href },
    footer: orgFooter(i.org),
  };
}

export interface OwnerChangeOrderAnsweredInput {
  org: OrgBrand;
  clientName: string;
  /** The proposal or job the change order amends. */
  contextTitle: string;
  coTitle: string;
  number: number | null;
  /** Tax-inclusive amount of the change. */
  total: number;
  approved: boolean;
  /** The client's typed name on approval, or their reason on decline. */
  note: string | null;
  /** The contract value after this answer. */
  contractTotal: number | null;
  href: string;
}

/** The client answered a change order. Approved: money is now owed (a new
 *  stage on the schedule). Declined: the scope stays as sold. Link, not CTA. */
export function buildOwnerChangeOrderAnswered(i: OwnerChangeOrderAnsweredInput): EmailDoc {
  const label = `Change order${i.number ? ` #${i.number}` : ""}`;
  const signed = `${i.total >= 0 ? "+" : "−"}${formatUSD(Math.abs(i.total))}`;
  const box: BoxRow[] = [
    { type: "field", label: "Job", value: truncate(i.contextTitle, TITLE_MAX) },
    { type: "item", name: truncate(i.coTitle, TITLE_MAX), amount: signed },
  ];
  if (i.approved && i.contractTotal != null) box.push({ type: "anchor", label: "Contract now", value: formatUSD(i.contractTotal) });
  if (!i.approved && i.note) box.push({ type: "field", label: "Reason", value: truncate(i.note, 200) });
  return {
    subject: `${i.approved ? "Approved" : "Declined"} — ${label}: ${truncate(i.coTitle, 50)}`,
    lockup: orgLockup(i.org),
    kicker: { text: i.approved ? "Change order approved" : "Change order declined", tone: i.approved ? "ok" : "bad" },
    headline: i.approved ? `${i.clientName} approved ${label.toLowerCase()}` : `${i.clientName} declined ${label.toLowerCase()}`,
    prose: [
      i.approved
        ? `Approved as "${i.note ?? i.clientName}". The amount is on the payment schedule as its own stage.`
        : "The scope and price stay as sold. Talk to the client before doing the extra work.",
    ],
    box,
    link: { label: "Open the job", href: i.href },
    footer: orgFooter(i.org),
  };
}

export interface OwnerRevertedInput {
  org: OrgBrand;
  clientName: string;
  title: string;
  /** What was taken back. */
  action: "accept" | "decline";
  total: number;
  href: string;
}

/** The client took back their accept or decline from the portal, on the same
 *  page, before closing it. Sent so the earlier "accepted" / "declined" mail
 *  does not stand as the last word. Link, not CTA. */
export function buildOwnerReverted(i: OwnerRevertedInput): EmailDoc {
  const took = i.action === "accept" ? "acceptance" : "decline";
  return {
    subject: `Reverted — ${truncate(i.title, 60)}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Reverted", tone: "bad" },
    headline: `${i.clientName} took back their ${took}`,
    prose: [
      i.action === "accept"
        ? "The proposal is open again. If a job was created from the acceptance and nothing had been added to it, it has been removed."
        : "The proposal is open again — they may still accept.",
    ],
    box: [
      { type: "field", label: "Job", value: truncate(i.title, TITLE_MAX) },
      { type: "anchor", label: "Value", value: formatUSD(i.total) },
    ],
    link: { label: "Open proposal", href: i.href },
    footer: orgFooter(i.org),
  };
}

// ── Platform payments (contractor's own Stripe / Square via JobFlex) ─────────

export interface OwnerPaymentReceivedInput {
  org: OrgBrand;
  clientName: string;
  title: string;
  stageLabel: string;
  amount: number;
  fee: number;
  net: number;
  provider: string; // "Stripe" | "Square" | "Bank transfer" | …
  remaining: number;
  paidInFull: boolean;
  href: string;
}

/** Money landed. Link, not CTA — nothing to do but know it. */
export function buildOwnerPaymentReceived(i: OwnerPaymentReceivedInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Job", value: truncate(i.title, TITLE_MAX) },
    { type: "field", label: "Stage", value: truncate(i.stageLabel, 40) },
    { type: "field", label: "Via", value: i.provider },
    { type: "item", name: "Paid", amount: formatUSD(i.amount) },
  ];
  if (i.fee > 0) {
    box.push({ type: "item", name: "JobFlex fee", amount: `−${formatUSD(i.fee)}` });
    box.push({ type: "anchor", label: "Net to you", value: formatUSD(i.net) });
  } else {
    box.push({ type: "anchor", label: "Remaining", value: formatUSD(i.remaining) });
  }
  if (i.paidInFull) box.push({ type: "cond", label: "Proposal", chip: "Paid in full", tone: "ok" });
  else if (i.fee > 0)
    box.push({ type: "cond", label: "Remaining", chip: formatUSD(i.remaining), tone: "neutral" });
  return {
    subject: `Payment received — ${formatUSD(i.amount)} from ${i.clientName}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Paid", tone: "ok" },
    headline: `${i.clientName} paid ${i.stageLabel.toLowerCase()}`,
    box,
    link: { label: "Open proposal", href: i.href },
    footer: orgFooter(i.org),
  };
}

export interface PaymentIssueInput {
  org: OrgBrand;
  title: string;
  detail: string;
  amount?: number | null;
  href: string;
}

/** Something about money needs a human: overpayment, orphaned payment,
 *  provider account restricted, token expired. */
export function buildPaymentIssue(i: PaymentIssueInput): EmailDoc {
  const box: BoxRow[] = [];
  if (typeof i.amount === "number" && i.amount > 0) {
    box.push({ type: "anchor", label: "Amount", value: formatUSD(i.amount) });
  }
  box.push({ type: "cond", label: "Action", chip: "Needs you", tone: "warn" });
  return {
    subject: `Payments — ${truncate(i.title, 60)}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Payments", tone: "warn" },
    headline: truncate(i.title, TITLE_MAX),
    prose: [i.detail],
    box,
    cta: { label: "Open settings", href: i.href },
    footer: orgFooter(i.org),
  };
}

export interface BookedOnlineInput {
  org: OrgBrand;
  name: string;
  service: string;
  when: string;
  price?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  answers: Array<{ label: string; value: string }>;
  notes?: string | null;
  /** Who they are to the company: a plan member, a new lead, or a customer on file. */
  who: "member" | "lead" | "client";
  href: string;
}

/** A customer booked a visit on the company's booking page — to the office (2026-10-28). */
export function buildBookedOnline(i: BookedOnlineInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Service", value: i.service },
    ...(i.price ? [{ type: "field" as const, label: "Price", value: i.price }] : []),
    { type: "field", label: "Phone", value: i.phone || "—" },
    { type: "field", label: "Email", value: i.email || "—" },
    ...(i.address ? [{ type: "field" as const, label: "Address", value: i.address }] : []),
    ...i.answers.filter((a) => a.value).map((a) => ({ type: "field" as const, label: truncate(a.label, 40), value: truncate(a.value, 60) })),
    { type: "cond", label: "Customer", chip: i.who === "member" ? "Plan member" : i.who === "lead" ? "New lead" : "On file", tone: i.who === "lead" ? "warn" : "ok" },
  ];
  return {
    subject: `Booked online — ${i.name}, ${i.service}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Booked online", tone: "ok" },
    headline: i.when,
    prose: [`${i.name} booked ${i.service.toLowerCase()} on your booking page. It is on your calendar.`],
    box,
    after: i.notes ? [`"${truncate(i.notes, 400)}"`] : undefined,
    cta: { label: "Open online booking", href: i.href },
    footer: orgFooter(i.org),
  };
}
