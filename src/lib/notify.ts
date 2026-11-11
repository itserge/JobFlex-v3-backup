// Plain server module (NOT "use server") for outbound notifications. These
// senders take a bare proposalId / leadId / assignmentId and fire real emails +
// SMS (including a worker's /w/<token> magic link), so exposing them as "use
// server" actions turned them into unauthenticated spam/abuse endpoints. They
// now live here and are called only from already-guarded server actions / the
// signature-or-token-gated routes that own the resource. The one genuinely
// user-invoked sender (notifyPaymentReminder) stays a guarded action in
// src/actions/notify.ts.
import { inLeadSandbox } from "@/lib/leadCenter/sandbox";
import { activeCapture } from "@/lib/leadCenter/outboxContext";
import { db } from "@/lib/db";
import { FENCE_PLAN_EVENT } from "@/lib/fence/planSvg";
import { DECK_PLAN_EVENT } from "@/lib/deck/convertSchema";
import { contractSchedule } from "@/lib/contractTotal";
import { appBaseUrl } from "@/lib/appUrl";
import { sendEmail, isEmailEnabled } from "@/lib/sdk/resend";
import { noteGmailFallback, sendOrgEmail } from "@/lib/email/orgSend";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { toE164 } from "@/lib/phone";
import { prettyPhone } from "@/lib/aiDesk/shared";
import { leadSourceOf } from "@/lib/leads/sources";
import { metaLeadPresentation } from "@/lib/meta/leadPresentation";
import { renderTemplate, type TemplateVars } from "@/lib/email/render";
import { renderEmail } from "@/lib/email/renderEmail";
import { orderNoticeSentAt, sendOrderNotice, sendReceipt } from "@/lib/payments/clientMail";
import {
  buildProposalSent,
  buildProposalAccepted,
  formatUSD,
  isBareUrlParagraph,
} from "@/lib/email/build/client";
import {
  buildCrewResponse,
  buildLeadOffer,
  buildLeadOfferReminder,
  buildNewLead,
  type NewLeadInput,
  buildOwnerAccepted,
  buildOwnerPaymentReceived,
  buildPaymentIssue,
  buildSupportTicket,
} from "@/lib/email/build/operator";
import { parsePaymentSettings, parseLeadsSettings } from "@/lib/settings";
import { resolveSchedule, fromMinor } from "@/lib/paymentSchedule";
import { resolveEmailRecipients, sendToMembersByPref, sendToUserByPref } from "@/lib/notificationPrefs";
import { textOffice, sendText } from "@/lib/sms/send";
import { homeUrlForLead } from "@/lib/home/portal";
import { fireTextRules, jobContext, leadContext, proposalContext } from "@/lib/sms/rulesEngine";
import { acceptedLine, dayLabel, money as smsMoney, jobBackLine, jobCompletedLine, jobMediaLine, jobStartedLine, leadLine, leadOfferLine, paymentLine, workerRespondedLine } from "@/lib/sms/format";
import type { ProgressWhat } from "@/lib/jobProgressShared";
import { textAppointmentAssigned, textAssignmentCreated } from "@/lib/sms/crew";
import { textClientProposalSent } from "@/lib/sms/clients";
import { ActivityKind } from "@/lib/prismaEnums";
import { buildAppointmentAssignment, buildJobAssignment } from "@/lib/email/build/worker";
import {
  buildRequestReceived,
  buildHomeownerMatched,
  buildShopClientReroute,
  buildHomeownerRerouting,
  buildHomeownerManualQueue,
} from "@/lib/email/build/platform";
import { parseGmailSettings } from "@/lib/settings";
import { trialBlocksText } from "@/lib/trialMeter";

export { formatUSD };

// Customer-facing mail sends from the platform address but routes replies to the
// contractor: their Gmail reply-to if set, else the org billing email.
export function replyToFor(org: {
  gmailSettingsJson: string | null;
  billingEmail: string | null;
}): string | undefined {
  const rt = parseGmailSettings(org.gmailSettingsJson).replyTo?.trim();
  return rt || org.billingEmail || undefined;
}

interface NotifyProposalSentInput {
  proposalId: string;
}

// Uses an EmailTemplate matching the given category; falls back to a reasonable default body.
async function pickTemplate(organizationId: string, category: string) {
  return db.emailTemplate.findFirst({
    where: { organizationId, category },
    orderBy: { createdAt: "desc" },
  });
}

function defaultBodyFor(category: string): { subject: string; body: string } {
  switch (category) {
    case "proposal-send":
      // No {{link}} line here on purpose — buildProposalSent's CTA button
      // already carries the portal link. A prose line repeating it would
      // render the same URL twice (Task 5 fix round 1, Finding A).
      return {
        subject: "Your proposal from {{org}}",
        body: `Hi {{client_name}},

Thanks for meeting with us. Here is the proposal we put together for your project — {{total}} in total.

— {{org}}`,
      };
    case "thank-you":
      return {
        subject: "Thanks for accepting — {{org}}",
        body: `Hi {{client_name}},

We just saw your acceptance on {{title}} — thank you! We'll be in touch shortly to get the work scheduled.

— {{org}}`,
      };
    case "reminder":
      // No {{link}} line here either — same reasoning as proposal-send above.
      return {
        subject: "A quick nudge — {{title}}",
        body: `Hi {{client_name}},

Circling back on the proposal we sent. Any questions, just reply to this email.

— {{org}}`,
      };
    default:
      return { subject: "A message from {{org}}", body: "Hi {{client_name}},\n\n" };
  }
}

export async function notifyProposalSent({ proposalId }: NotifyProposalSentInput) {
  const proposal = await db.proposal.findUnique({
    where: { id: proposalId },
    include: {
      client: true,
      lineItems: { orderBy: { position: "asc" }, take: 13 },
      organization: {
        select: { id: true, name: true, billingEmail: true, gmailSettingsJson: true, gmailTokensJson: true, logoUrl: true, phone: true },
      },
    },
  });
  if (!proposal) return { skipped: true as const, reason: "not-found" };
  if (!proposal.client?.email) return { skipped: true as const, reason: "no-client-email" };

  const tpl = await pickTemplate(proposal.organizationId, "proposal-send");
  const fallback = defaultBodyFor("proposal-send");
  const body = tpl?.body ?? fallback.body;

  const appUrl = await appBaseUrl();
  const vars: TemplateVars = {
    client_name: proposal.client.name,
    total: formatUSD(proposal.total),
    link: `${appUrl}/portal/q/${proposal.publicId}`,
    org: proposal.organization.name,
    title: proposal.title,
  };

  // Contractor keeps their own words (from the template body) — the system
  // supplies the structured box. Bare-URL-only paragraphs are dropped since
  // the CTA already carries the link.
  const prose = renderTemplate(body, vars)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter((p) => p && !isBareUrlParagraph(p));

  // A fence traced on the map (2026-09-27): the client's page stands it up in
  // 3D and draws it on the lot — the email says so, so they go and look.
  let after: string[] | undefined;
  try {
    const drawn = await db.activityEvent.findFirst({ where: { proposalId: proposal.id, kind: FENCE_PLAN_EVENT }, select: { id: true } });
    if (drawn) after = ["Your fence is drawn on your lot and stands in 3D on your page — open it and drag to look around.", "Anything you'd like changed? Just reply — it comes straight to us."];
    // A deck from the Deck Studio (2026-10-04): the same promise, for the deck.
    else if (await db.activityEvent.findFirst({ where: { proposalId: proposal.id, kind: DECK_PLAN_EVENT }, select: { id: true } })) after = ["Your deck stands in 3D on your page — open it, drag to look around, and press Build it to watch it go up.", "Anything you'd like changed? Just reply — it comes straight to us."];
  } catch {
    after = undefined;
  }

  const { subject: subj, html } = renderEmail(
    buildProposalSent({
      org: {
        name: proposal.organization.name,
        id: proposal.organizationId,
        logoUrl: proposal.organization.logoUrl,
        phone: proposal.organization.phone,
      },
      clientName: proposal.client.name,
      title: proposal.title,
      lineItems: proposal.lineItems.map((li) => ({ name: li.name, total: li.total })),
      taxRate: proposal.taxRate,
      taxTotal: proposal.taxTotal,
      total: proposal.total,
      validUntil: proposal.validUntil,
      href: `${appUrl}/portal/q/${proposal.publicId}`,
      prose,
      after,
    }),
  );

  // Customer-facing: goes out FROM the contractor's connected Gmail when they
  // opted in (Settings → Integrations → Gmail), else from the platform with
  // the contractor as reply-to. sendOrgEmail owns that decision.
  const sent = await sendOrgEmail(proposal.organization, { mailClass: "transactional",
    to: proposal.client.email,
    subject: subj,
    html,
    kind: "proposal",
  });
  // Gmail meant, platform sent: the feed says so, the send is not lost.
  await noteGmailFallback(sent, {
    organizationId: proposal.organizationId,
    proposalId: proposal.id,
    clientId: proposal.clientId,
    what: "The proposal email",
  });
  // The client's phone gets the link too (2026-09-24), when the company
  // texts clients and the client has a number.
  await textClientProposalSent(proposal.id);
  await fireTextRules("proposal.sent", proposalContext(proposal.id));

  return {
    skipped: false as const,
    delivery: isEmailEnabled() ? "sent" : "disabled",
    enabled: isEmailEnabled(),
  };
}

// Sent when a proposal is accepted (portal acceptance). Thanks the client from
// the platform address with the contractor as reply-to, and pings the owner so
// they know to schedule the work.
export async function notifyProposalAccepted({ proposalId }: { proposalId: string }) {
  const proposal = await db.proposal.findUnique({
    where: { id: proposalId },
    include: {
      client: true,
      organization: {
        select: { name: true, billingEmail: true, gmailSettingsJson: true, gmailTokensJson: true, logoUrl: true, phone: true },
      },
    },
  });
  if (!proposal) return { skipped: true as const, reason: "not-found" };

  const appUrl = await appBaseUrl();

  // 1) Thank-you to the client (customer-facing → reply-to the contractor).
  //    Client half only — the internal owner heads-up below is unchanged
  //    (moves onto a builder in Task 6).
  if (proposal.client?.email) {
    const tpl = await pickTemplate(proposal.organizationId, "thank-you");
    const fallback = defaultBodyFor("thank-you");
    const vars: TemplateVars = {
      client_name: proposal.client.name,
      total: formatUSD(proposal.total),
      link: `${appUrl}/portal/q/${proposal.publicId}`,
      org: proposal.organization.name,
      title: proposal.title,
    };
    const prose = renderTemplate(tpl?.body ?? fallback.body, vars)
      .split(/\n{2,}/)
      .map((p) => p.replace(/\n/g, " ").trim())
      .filter((p) => p && !isBareUrlParagraph(p));

    const { subject: acceptedSubject, html: acceptedHtml } = renderEmail(
      buildProposalAccepted({
        org: {
          name: proposal.organization.name,
          id: proposal.organizationId,
          logoUrl: proposal.organization.logoUrl,
          phone: proposal.organization.phone,
        },
        clientName: proposal.client.name,
        title: proposal.title,
        total: proposal.total,
        callByDate: null,
        prose,
      }),
    );
    await sendOrgEmail(proposal.organization, { mailClass: "transactional",
      to: proposal.client.email,
      subject: acceptedSubject,
      html: acceptedHtml,
      kind: "proposal",
    });
  }

  // 2) Internal heads-up to the office — every owner/manager whose
  //    "Proposal accepted" email pref is on (quiet hours respected) — and
  //    the same line by text to those who ticked Text (2026-09-24).
  await textOffice(proposal.organizationId, "proposal-accepted", acceptedLine(proposal.client?.name ?? "A client", proposal.title, proposal.total, `${appUrl}/dashboard/proposals/${proposal.id}`), { alsoUserIds: [proposal.ownerId] });
  await fireTextRules("proposal.accepted", proposalContext(proposal.id));
  await sendToMembersByPref(
    proposal.organizationId,
    "proposal-accepted",
    buildOwnerAccepted({
      org: {
        name: proposal.organization.name,
        id: proposal.organizationId,
        logoUrl: proposal.organization.logoUrl,
        phone: proposal.organization.phone,
      },
      clientName: proposal.client?.name ?? "A client",
      title: proposal.title,
      acceptedAt: new Date(),
      total: proposal.total,
      needsScheduling: true,
      href: `${appUrl}/dashboard/proposals/${proposal.id}`,
    }),
  );

  return { skipped: false as const, enabled: isEmailEnabled() };
}


/**
 * WHO GETS A LEAD. The owner of the shop, and only the owner.
 *
 * Both lead mails used to go to `Organization.billingEmail`, which is whatever
 * address was typed into the billing field — on a workspace where that is a
 * shared or a stale address, a homeowner's name, phone and job description
 * reach whoever holds it, which can be a field worker. The owner's own login
 * is the one address the platform knows belongs to the person responsible for
 * the shop, so it is the one used; billingEmail is the fallback for a
 * workspace with no OWNER membership (an invite-only org mid-setup).
 *
 * Managers are NOT mailed. They can see and act on every lead in the app —
 * that is a permissions question, answered by requireSalesOrManager — but the
 * arrival notice belongs to the owner.
 */
async function ownerEmailFor(
  organizationId: string,
  billingEmail: string | null,
): Promise<string | null> {
  try {
    const owner = await db.membership.findFirst({
      where: { organizationId, role: "OWNER" },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { email: true } } },
    });
    return owner?.user.email ?? billingEmail ?? null;
  } catch {
    return billingEmail ?? null;
  }
}

/** What the new-lead mail says about a lead (lib/email/build/operator buildNewLead): a Facebook form's answers as
 *  questions and answers instead of its raw "key: value" lines, the phone as a tap to call, the source in the leads
 *  list's words, and when it came in, in the company's time. */
function newLeadFacts(
  lead: { id: string; name: string; email: string | null; phone: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; projectType: string | null; description: string | null; source: string | null; createdAt: Date },
  timezone: string | null,
): Omit<NewLeadInput, "org" | "href"> {
  const e164 = toE164(lead.phone);
  const form = metaLeadPresentation(lead);
  const src = leadSourceOf(lead.source);
  const address = [lead.address, lead.city, [lead.state, lead.zip].filter(Boolean).join(" ")].filter((x) => x && x.trim()).join(", ");
  let when: string | null = null;
  try {
    when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone ?? "America/New_York" }).format(lead.createdAt);
  } catch {
    when = null;
  }
  return {
    leadName: lead.name,
    phone: e164 ? prettyPhone(e164) : lead.phone?.trim() || null,
    phoneHref: e164 ? `tel:${e164}` : null,
    email: lead.email?.trim() || null,
    address: address || null,
    project: lead.projectType?.trim() || null,
    source: src.side === "jobflex" ? "JobFlex Lead Center" : src.label,
    when,
    // Answered questions only: an empty one is noise in a mail ("Not provided").
    answers: form ? form.answers.filter((a) => a.value !== "Not provided").map((a) => ({ question: a.label, answer: a.value })) : [],
    enquiry: form ? null : lead.description?.trim() || null,
  };
}

export async function notifyLeadCreated(leadId: string) {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      organization: { select: { name: true, phone: true, billingEmail: true, logoUrl: true, timezone: true } },
    },
  });
  if (!lead || !lead.organization) return { skipped: true as const };

  {
    // Owner only (see the privacy note above) — through their own prefs.
    const appUrl = await appBaseUrl();
    await textOffice(
      lead.organizationId,
      "lead-assigned",
      leadLine(lead.name, lead.projectType ?? null, [lead.city, lead.state].filter(Boolean).join(", ") || null, lead.phone ?? lead.email ?? null, `${appUrl}/dashboard/leads/${lead.id}`),
      { roles: ["OWNER"], alsoUserIds: [lead.assignedToId] },
    );
    await fireTextRules("lead.created", leadContext(lead.id));
    // The AI Operator's own line to the people who asked for it (2026-11-05, lib/assistant/alerts); never one typed in by hand.
    await import("@/lib/assistant/alerts").then((m) => m.alertNewLead(lead.id)).catch(() => undefined);
    await sendToMembersByPref(
      lead.organizationId,
      "lead-assigned",
      buildNewLead({
        org: {
          name: lead.organization.name,
          id: lead.organizationId,
          logoUrl: lead.organization.logoUrl,
          phone: lead.organization.phone,
        },
        ...newLeadFacts(lead, lead.organization.timezone),
        href: `${appUrl}/dashboard/leads/${lead.id}`,
      }),
      { roles: ["OWNER"] },
    );
  }

  // Optional SMS if org phone is set. Normalised and reported — see sendLeadSms.
  const sms = await sendLeadSms(
    lead.organization.phone,
    `New JobFlex lead: ${lead.name} — ${lead.projectType ?? "inquiry"}`,
    { what: "lead-created", orgId: lead.organizationId },
  );
  return { skipped: false as const, sms };
}

/**
 * Staffed on an appointment — email the worker.
 *
 * The job path has notified since it shipped; the appointment path never did.
 * A manager could put someone on a site visit and the only trace the worker had
 * was a card appearing in a calendar they might not open that week. Called with
 * the ids that were ADDED (not the whole roster), so re-saving an appointment
 * does not re-mail everyone already on it.
 *
 * Best-effort by contract: the caller wraps it, because a mail failure must
 * never roll back a booking that is already in the calendar.
 */
export async function notifyAppointmentAssigned(appointmentId: string, workerIds: string[]) {
  if (!workerIds.length) return { skipped: true as const, reason: "no-workers" };

  const apt = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      client: { select: { address: true } },
      lead: { select: { address: true } },
      organization: { select: { name: true, logoUrl: true, phone: true } },
    },
  });
  if (!apt) return { skipped: true as const, reason: "not-found" };

  const workers = await db.workerProfile.findMany({
    where: { id: { in: workerIds }, organizationId: apt.organizationId },
    select: { displayName: true, token: true, user: { select: { email: true } } },
  });

  const appUrl = await appBaseUrl();
  let sent = 0;
  for (const w of workers) {
    const email = w.user?.email;
    if (!email) continue;
    const { subject, html } = renderEmail(
      buildAppointmentAssignment({
        org: {
          name: apt.organization.name,
          id: apt.organizationId,
          logoUrl: apt.organization.logoUrl,
          phone: apt.organization.phone,
        },
        workerName: w.displayName,
        title: apt.title,
        startsAt: apt.startsAt,
        endsAt: apt.endsAt,
        address: apt.client?.address ?? apt.lead?.address ?? null,
        notes: apt.notes,
        href: `${appUrl}/w/${w.token}`,
      }),
    );
    await sendEmail({ mailClass: "transactional", to: email, subject, html });
    sent += 1;
  }
  // The crew's phones (2026-09-24): those with the schedule switch on.
  await textAppointmentAssigned(appointmentId, workerIds);
  return { skipped: false as const, sent };
}

export async function notifyAssignmentCreated(assignmentId: string) {
  const a = await db.jobAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      worker: { include: { user: { select: { email: true } } } },
      job: {
        select: {
          title: true,
          organizationId: true,
          startsAt: true,
          // Job itself has no address column — it lives on the client or,
          // failing that, the proposal the job was created from.
          client: { select: { address: true } },
          proposal: { select: { address: true } },
          // Sibling assignees for the Crew row; filtered to exclude this
          // recipient below (workerId is unique per assignment, not per row).
          assignments: {
            select: { workerId: true, worker: { select: { displayName: true } } },
          },
        },
      },
    },
  });
  if (!a) return { skipped: true as const };

  const email = a.worker.user?.email;
  if (email) {
    const appUrl = await appBaseUrl();
    const org = await db.organization.findUnique({
      where: { id: a.job.organizationId },
      select: { name: true, logoUrl: true, phone: true },
    });
    const crew = a.job.assignments
      .filter((x) => x.workerId !== a.workerId)
      .map((x) => x.worker.displayName);
    const { subject, html } = renderEmail(
      buildJobAssignment({
        org: { id: a.job.organizationId, name: org?.name ?? "Your team", logoUrl: org?.logoUrl, phone: org?.phone },
        workerName: a.worker.displayName,
        title: a.job.title,
        startsAt: a.job.startsAt,
        address: a.job.client?.address ?? a.job.proposal?.address ?? null,
        crew,
        href: `${appUrl}/w/${a.worker.token}`,
      }),
    );
    await sendEmail({ mailClass: "transactional", to: email, subject, html });
  }

  // The crew text (2026-09-24): only with the worker's schedule switch on,
  // never to a number that replied STOP, with the day and the address.
  await textAssignmentCreated(assignmentId);

  return { skipped: false as const };
}

/**
 * Crew answered an assignment (2026-08-22, owner request): the OFFICE hears it
 * by email — the org's owner(s) plus the manager who made the assignment
 * (recovered from the ASSIGNED activity row's meta; the assignment table
 * carries no assignedBy column). Recipients are deduped and the responding
 * worker's own address is excluded — answering your own mail is noise.
 */
export async function notifyAssignmentResponded(
  assignmentId: string,
  response: "ACCEPTED" | "DECLINED",
  jobStatusNow: string | null,
) {
  if (!isEmailEnabled()) return { skipped: true as const };
  const a = await db.jobAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      worker: { include: { user: { select: { email: true } } } },
      job: { select: { id: true, title: true, startsAt: true, organizationId: true } },
    },
  });
  if (!a) return { skipped: true as const };
  const organizationId = a.job.organizationId;

  const workerEmail = a.worker.user?.email?.toLowerCase() ?? null;
  // The owners' phones (2026-09-24), through their Text cell; never the worker's own.
  {
    const tzRow = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    await textOffice(
      organizationId,
      "worker-responded",
      workerRespondedLine(a.worker.displayName, response === "ACCEPTED", a.job.title, a.job.startsAt ? dayLabel(a.job.startsAt, tzRow?.timezone || "America/New_York") : null),
      { roles: ["OWNER"], excludeUserIds: [a.worker.userId] },
    );
  }
  const [org, owners, assignedEvent] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, logoUrl: true, phone: true },
    }),
    // Owners through their own "Worker responded" prefs…
    resolveEmailRecipients(organizationId, "worker-responded", {
      roles: ["OWNER"],
      excludeEmails: workerEmail ? [workerEmail] : [],
    }),
    // …plus whoever made the assignment, always (it is their question).
    db.activityEvent.findFirst({
      where: { organizationId, kind: "ASSIGNED", meta: { contains: assignmentId } },
      orderBy: { createdAt: "desc" },
      select: { actor: { select: { email: true } } },
    }),
  ]);

  const to = Array.from(
    new Set(
      [...owners, assignedEvent?.actor?.email]
        .filter((e): e is string => Boolean(e))
        .map((e) => e.toLowerCase()),
    ),
  ).filter((e) => e !== workerEmail);
  if (to.length === 0) return { skipped: true as const };

  const appUrl = await appBaseUrl();
  const { subject, html } = renderEmail(
    buildCrewResponse({
      org: { id: organizationId, name: org?.name ?? "Your team", logoUrl: org?.logoUrl, phone: org?.phone },
      workerName: a.worker.displayName,
      title: a.job.title,
      response,
      startsAt: a.job.startsAt,
      jobStatusNow,
      href: `${appUrl}/dashboard/jobs/${a.job.id}`,
    }),
  );
  await Promise.all(to.map((email) => sendEmail({ mailClass: "transactional", to: email, subject, html })));
  return { skipped: false as const };
}

// ── Lead Center ──────────────────────────────────────────────────────────────
// Platform-branded (no org exists on the lead yet, except once matched).

/**
 * One SMS on the Lead Center path — normalised, and never silent.
 *
 * TWO BUGS THIS REPLACES, both found in the 2026-09-17 test run:
 *
 *  1. The number went to `sendSMS` exactly as the shop or the homeowner typed
 *     it. `sendSMS` accepts E.164 only and THROWS on anything else, so an
 *     ordinary "(206) 555-0143" — which is what every one of these fields
 *     actually holds — could never send. The project's own `toE164`
 *     (lib/phone) was already doing this job for invoices, payment reminders
 *     and change orders; the Lead Center path just never called it.
 *  2. Every call site ended in `.catch(() => null)`. So the throw above, a dead
 *     Twilio account, a suspended number — all of it landed in the same silence.
 *     With the provider switched on in production, nothing anywhere would have
 *     said that no lead SMS had ever been delivered.
 *
 * Now: the number is normalised, every outcome is logged with the org or lead
 * it belongs to, and the result is returned for the caller to report. Still
 * best-effort — an SMS must never fail the routing it accompanies — but
 * best-effort out loud.
 *
 * NEVER logs the number or the body: these carry homeowner contact details, and
 * lead SMS bodies elsewhere in the app carry live links (see lib/sdk/twilio).
 */
type SmsOutcome = "sent" | "disabled" | "invalid-number" | "failed";

/** The lead an offer belongs to — for the test environment's switch (lib/leadCenter/sandbox). */
async function platformLeadOfOffer(offerId: string): Promise<string | null> {
  const o = await db.leadOffer.findUnique({ where: { id: offerId }, select: { platformLeadId: true } }).catch(() => null);
  return o?.platformLeadId ?? null;
}

async function sendLeadSms(
  raw: string | null | undefined,
  body: string,
  ctx: { what: string; orgId?: string | null; platformLeadId?: string | null },
): Promise<SmsOutcome> {
  const tag = [
    ctx.what,
    ctx.orgId ? `org=${ctx.orgId}` : null,
    ctx.platformLeadId ? `lead=${ctx.platformLeadId}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  // THE TEST ENVIRONMENT (lib/leadCenter/sandbox): the text is recorded with the gate that decides it — so a test
  // run shows the texts production would send AND the ones it would hold back, and why. Nothing is sent.
  const capture = activeCapture();
  if (capture) {
    const optedIn = ctx.what.startsWith("homeowner-") || !ctx.orgId
      ? false
      : parseLeadsSettings((await db.organization.findUnique({ where: { id: ctx.orgId }, select: { leadsSettingsJson: true } }).catch(() => null))?.leadsSettingsJson).instantSms;
    const note = !raw
      ? "Would not send: no phone on file"
      : ctx.what.startsWith("homeowner-")
        ? "Would not send: homeowners are not texted yet"
        : !optedIn
          ? "Would not send: the shop has not turned on lead texts"
          : !toE164(raw)
            ? "Would not send: not a usable US/CA number"
            : "Would send from JobFlex's number";
    await capture.record({ channel: "sms", to: raw ?? "(no phone)", body, what: ctx.what, note });
    return "disabled";
  }
  if (!raw) return "invalid-number";
  // Who may get JobFlex's own texts (2026-10-02, the opt-in the JobFlex number
  // is registered on): a shop that turned on "Text new leads to the company
  // phone" in Settings → Texting. Homeowners are not texted until the request
  // form asks them; their emails carry the news.
  if (ctx.what.startsWith("homeowner-")) {
    console.info(`[notify] ${tag}: SMS skipped — homeowners are not asked for texts yet`);
    return "disabled";
  }
  const optedIn = ctx.orgId
    ? parseLeadsSettings((await db.organization.findUnique({ where: { id: ctx.orgId }, select: { leadsSettingsJson: true } }).catch(() => null))?.leadsSettingsJson).instantSms
    : false;
  if (!optedIn) {
    console.info(`[notify] ${tag}: SMS skipped — the shop has not turned on lead texts`);
    return "disabled";
  }
  if (!await isTwilioEnabled()) {
    // Not a failure: the provider is off by configuration, which is the
    // documented local/dev state. Said once, quietly, so a missing text during
    // testing has an explanation in the log.
    console.info(`[notify] ${tag}: SMS skipped — Twilio is not configured`);
    return "disabled";
  }
  // The card-less trial sends no texts (lib/trialMeter); the email still goes.
  if (await trialBlocksText(ctx.orgId, "lead")) {
    console.info(`[notify] ${tag}: SMS skipped — card-less trial`);
    return "disabled";
  }

  const to = toE164(raw);
  if (!to) {
    console.warn(
      `[notify] ${tag}: SMS skipped — the phone on file is not a usable US/CA number ` +
        `(${raw.replace(/\d/g, "•")}); email was still sent`,
    );
    return "invalid-number";
  }

  try {
    // JobFlex's own text: it leaves from JobFlex's number once Twilio approved
    // it (lib/sms/jobflexSender), until then a SKIPPED row and the email.
    const r = await sendText({ organizationId: null, to, body, kind: `jobflex-${ctx.what}` });
    if (!r.ok) return r.reason === "invalid-number" ? "invalid-number" : "failed";
    return r.status === "SKIPPED" ? "disabled" : "sent";
  } catch (err) {
    console.error(`[notify] ${tag}: SMS failed`, err);
    return "failed";
  }
}

// Instant confirmation to the homeowner on submission. Email always; SMS when
// they left a phone number.
export async function notifyHomeownerRequestReceived(platformLeadId: string) {
  return inLeadSandbox(platformLeadId, () => notifyHomeownerRequestReceivedNow(platformLeadId));
}
async function notifyHomeownerRequestReceivedNow(platformLeadId: string) {
  const pl = await db.platformLead.findUnique({ where: { id: platformLeadId } });
  if (!pl) return { skipped: true as const };

  const { subject, html } = renderEmail(
    buildRequestReceived({
      name: pl.name,
      projectType: pl.projectType ?? null,
      statusUrl: await statusUrlFor(pl),
      homeUrl: await homeUrlForLead(pl),
    }),
  );
  await sendEmail({ mailClass: "transactional", to: pl.email, subject, html });

  const sms = await sendLeadSms(
    pl.phone,
    `JobFlex: we got your ${pl.projectType ?? "project"} request. We're matching you with a local pro — you'll hear from one within 24 hours.`,
    { what: "homeowner-received", platformLeadId: pl.id },
  );
  return { skipped: false as const, enabled: isEmailEnabled(), sms };
}

// Pings the offered shop: email to its OWNER (see ownerEmailFor) + optional SMS
// to the org phone.
export async function notifyLeadOfferCreated(offerId: string) {
  return inLeadSandbox(await platformLeadOfOffer(offerId), () => notifyLeadOfferCreatedNow(offerId));
}
async function notifyLeadOfferCreatedNow(offerId: string) {
  const offer = await db.leadOffer.findUnique({
    where: { id: offerId },
    include: {
      platformLead: true,
      organization: { select: { name: true, billingEmail: true, phone: true } },
    },
  });
  if (!offer) return { skipped: true as const };

  const pl = offer.platformLead;
  const appUrl = await appBaseUrl();
  const where = [pl.city, pl.state].filter(Boolean).join(", ") || pl.zip || "your area";

  await textOffice(offer.organizationId, "lead-assigned", leadOfferLine(pl.detectedTrade ?? pl.projectType ?? "project", where, null, `${appUrl}/dashboard/leads`), { roles: ["OWNER"] });
  await sendToMembersByPref(
    offer.organizationId,
    "lead-assigned",
    buildLeadOffer({
      trade: pl.detectedTrade ?? pl.projectType ?? "project",
      where,
      createdAt: offer.createdAt,
      reservedHours: 24,
      nextShop: "the next shop in line",
      href: `${appUrl}/dashboard/leads`,
    }),
    { roles: ["OWNER"] },
  );

  const sms = await sendLeadSms(
    offer.organization.phone,
    `JobFlex: new ${pl.detectedTrade ?? "project"} lead in ${where}, reserved for you for 24h. Accept it in your Leads inbox.`,
    { what: "offer-created", orgId: offer.organizationId, platformLeadId: pl.id },
  );
  return { skipped: false as const, enabled: isEmailEnabled(), sms };
}

/**
 * The one reminder before an offer lapses — see buildLeadOfferReminder.
 *
 * Same recipients and same channels as the offer itself, so a shop that gets
 * the first mail gets this one. Called from the cron sweep, which is the only
 * thing that knows the clock is nearly out (lib/leadCenter/cascade).
 */
export async function notifyLeadOfferExpiring(offerId: string) {
  return inLeadSandbox(await platformLeadOfOffer(offerId), () => notifyLeadOfferExpiringNow(offerId));
}
async function notifyLeadOfferExpiringNow(offerId: string) {
  const offer = await db.leadOffer.findUnique({
    where: { id: offerId },
    include: {
      platformLead: true,
      organization: { select: { name: true, billingEmail: true, phone: true } },
    },
  });
  // Won, passed or already lapsed between the sweep's read and this call —
  // a reminder about a lead the shop no longer holds would be worse than none.
  if (!offer || offer.status !== "OFFERED") return { skipped: true as const };

  const pl = offer.platformLead;
  const appUrl = await appBaseUrl();
  const where = [pl.city, pl.state].filter(Boolean).join(", ") || pl.zip || "your area";
  const trade = pl.detectedTrade ?? pl.projectType ?? "project";

  await textOffice(
    offer.organizationId,
    "lead-assigned",
    leadOfferLine(trade, where, Math.max(1, Math.round((offer.expiresAt.getTime() - Date.now()) / 3_600_000)), `${appUrl}/dashboard/leads`),
    { roles: ["OWNER"] },
  );
  await sendToMembersByPref(
    offer.organizationId,
    "lead-assigned",
    buildLeadOfferReminder({
      trade,
      where,
      expiresAt: offer.expiresAt,
      href: `${appUrl}/dashboard/leads`,
    }),
    { roles: ["OWNER"] },
  );

  const hoursLeft = Math.max(1, Math.round((offer.expiresAt.getTime() - Date.now()) / 3_600_000));
  const sms = await sendLeadSms(
    offer.organization.phone,
    `JobFlex: your ${trade} lead in ${where} is still unanswered — about ${hoursLeft}h left before it goes to the next shop.`,
    { what: "offer-expiring", orgId: offer.organizationId, platformLeadId: pl.id },
  );
  return { skipped: false as const, enabled: isEmailEnabled(), sms };
}

// "You're matched" to the homeowner once a contractor accepts (or an admin
// assigns). Includes the shop's name and contact so they know who's calling.
export async function notifyHomeownerMatched(platformLeadId: string) {
  return inLeadSandbox(platformLeadId, () => notifyHomeownerMatchedNow(platformLeadId));
}
async function notifyHomeownerMatchedNow(platformLeadId: string) {
  const pl = await db.platformLead.findUnique({ where: { id: platformLeadId } });
  if (!pl || !pl.matchedOrgId) return { skipped: true as const };
  const org = await db.organization.findUnique({
    where: { id: pl.matchedOrgId },
    select: { name: true, phone: true, billingEmail: true, gmailSettingsJson: true },
  });
  if (!org) return { skipped: true as const };

  // Same smoothing input Lead Center ranking reads (src/lib/leadCenter/matching.ts)
  // collapsed to a display string — a shop with no completed reviews yet reads
  // "New" rather than a misleadingly precise 0.0.
  const ratingAgg = await db.reviewRequest.aggregate({
    where: { organizationId: pl.matchedOrgId, rating: { not: null } },
    _avg: { rating: true },
    _count: { rating: true },
  });
  const rating =
    ratingAgg._count.rating > 0 && ratingAgg._avg.rating != null
      ? ratingAgg._avg.rating.toFixed(1)
      : "New";

  const { subject, html } = renderEmail(
    buildHomeownerMatched({
      name: pl.name,
      orgName: org.name,
      phone: org.phone,
      rating,
      projectType: pl.detectedTrade ?? pl.projectType ?? null,
      statusUrl: await statusUrlFor(pl),
      homeUrl: await homeUrlForLead(pl),
    }),
  );
  await sendEmail({ mailClass: "transactional",
    to: pl.email,
    subject,
    html,
    replyTo: replyToFor({ gmailSettingsJson: org.gmailSettingsJson, billingEmail: org.billingEmail }),
  });

  const sms = await sendLeadSms(
    pl.phone,
    `JobFlex: you're matched! ${org.name} will contact you about your ${pl.detectedTrade ?? "project"}${org.phone ? ` — or call them at ${org.phone}` : ""}.`,
    { what: "homeowner-matched", orgId: pl.matchedOrgId, platformLeadId: pl.id },
  );
  return { skipped: false as const, enabled: isEmailEnabled(), sms };
}

/** The homeowner's status page URL, or null for legacy rows with no token. */
async function statusUrlFor(pl: { accessToken: string | null }): Promise<string | null> {
  if (!pl.accessToken) return null;
  return `${await appBaseUrl()}/request/${pl.accessToken}`;
}

// ── "Find me another contractor" (homeowner re-route) ────────────────────────

/**
 * To the shop that HAD the lead: the client asked for another contractor.
 * Honest, with their reason when they gave one, and explicit that the shop's
 * standing is untouched (owner's rules #4–5).
 */
export async function notifyShopClientRequestedReroute(
  platformLeadId: string,
  prevOrgId: string,
  reason: string | null,
) {
  return inLeadSandbox(platformLeadId, () => notifyShopClientRequestedRerouteNow(platformLeadId, prevOrgId, reason));
}
async function notifyShopClientRequestedRerouteNow(
  platformLeadId: string,
  prevOrgId: string,
  reason: string | null,
) {
  const [pl, org] = await Promise.all([
    db.platformLead.findUnique({ where: { id: platformLeadId } }),
    db.organization.findUnique({
      where: { id: prevOrgId },
      select: { name: true, billingEmail: true },
    }),
  ]);
  if (!pl || !org) return { skipped: true as const };

  const to = await ownerEmailFor(prevOrgId, org.billingEmail);
  if (!to) return { skipped: true as const };

  const { subject, html } = renderEmail(
    buildShopClientReroute({
      orgName: org.name,
      homeownerName: pl.name,
      projectType: pl.detectedTrade ?? pl.projectType ?? null,
      reason,
    }),
  );
  await sendEmail({ mailClass: "transactional", to, subject, html });
  return { skipped: false as const, enabled: isEmailEnabled() };
}

/** To the homeowner, right after their button press: we're re-matching. */
export async function notifyHomeownerRerouting(platformLeadId: string) {
  return inLeadSandbox(platformLeadId, () => notifyHomeownerReroutingNow(platformLeadId));
}
async function notifyHomeownerReroutingNow(platformLeadId: string) {
  const pl = await db.platformLead.findUnique({ where: { id: platformLeadId } });
  if (!pl) return { skipped: true as const };

  const { subject, html } = renderEmail(
    buildHomeownerRerouting({
      name: pl.name,
      projectType: pl.detectedTrade ?? pl.projectType ?? null,
      statusUrl: await statusUrlFor(pl),
      homeUrl: await homeUrlForLead(pl),
    }),
  );
  await sendEmail({ mailClass: "transactional", to: pl.email, subject, html });

  const sms = await sendLeadSms(
    pl.phone,
    `JobFlex: got it — we're matching your ${pl.detectedTrade ?? "project"} request with another local pro. You'll hear back within 24 hours.`,
    { what: "homeowner-rerouting", platformLeadId: pl.id },
  );
  return { skipped: false as const, enabled: isEmailEnabled(), sms };
}

/**
 * To the homeowner when the automatic pool ran out: a person takes over, no
 * timeframe promised (owner's rule #3).
 */
export async function notifyHomeownerManualQueue(platformLeadId: string) {
  return inLeadSandbox(platformLeadId, () => notifyHomeownerManualQueueNow(platformLeadId));
}
async function notifyHomeownerManualQueueNow(platformLeadId: string) {
  const pl = await db.platformLead.findUnique({ where: { id: platformLeadId } });
  if (!pl) return { skipped: true as const };

  const { subject, html } = renderEmail(
    buildHomeownerManualQueue({
      name: pl.name,
      projectType: pl.detectedTrade ?? pl.projectType ?? null,
      statusUrl: await statusUrlFor(pl),
      homeUrl: await homeUrlForLead(pl),
    }),
  );
  await sendEmail({ mailClass: "transactional", to: pl.email, subject, html });
  return { skipped: false as const, enabled: isEmailEnabled() };
}

// ── New homeowner request → the platform admin (2026-10-03) ──────────────────

/**
 * Every real homeowner request, to the operator: SUPPORT_NOTIFY_EMAIL (comma-
 * separated) or support@jobflex.app. Trade, town, a short scope and the link
 * that opens the lead in the Lead Center. Test leads are not announced. Never
 * throws; one send per address, each failure logged.
 */
export async function notifyAdminNewLeadRequest(platformLeadId: string) {
  // The email and the admins' texts, with their reminders, live in one place
  // since 2026-10-03 (lib/leadCenter/alerts): who gets them is set on
  // /admin/lead-center/alerts. Test leads stay silent there too.
  const { alertNewRequest } = await import("@/lib/leadCenter/alerts");
  return alertNewRequest(platformLeadId);
}

// ── Support tickets ───────────────────────────────────────────────────────────
//
// Moved here from src/actions/support.ts, where it lived inside one
// `try { … } catch {}` with an EMPTY catch and the comment "Swallowed by
// design". Best-effort was the right contract — a dead mail transport must
// never fail a ticket that is already in the database — but silent was not:
// a broken key, an empty admin list or a render error all produced a green
// toast and no alert, and nothing anywhere recorded that the operator had not
// been told. It is still best-effort (this never throws), but every path now
// says which one it took: to the log, and to the caller through the return.

/** Short human reference for a ticket, derived from its cuid — nothing is
 *  generated or stored. Shown to the submitter and printed on the alert so a
 *  follow-up email and the admin row can be matched by eye. */
export function supportTicketRef(ticketId: string): string {
  return ticketId.slice(-6).toUpperCase();
}

export interface SupportTicketNotice {
  ticketId: string;
  ref: string;
  subject: string;
  body: string;
  category: string;
  priority: string;
  orgName: string;
  submitterEmail: string | null;
  /** The ticket's own reply address (lib/supportThread ticketReplyTo) while replies by email are on. */
  replyTo?: string | null;
}

export type SupportNotifyResult =
  | { sent: true; recipients: number }
  /** no-transport — neither Resend nor SMTP configured; no-recipient — no
   *  SUPPORT_NOTIFY_EMAIL and no user flagged isPlatformAdmin; failed — the
   *  transport was asked and refused (already logged). */
  | { sent: false; reason: "no-transport" | "no-recipient" | "failed" };

/** An address no transport can deliver to.
 *
 *  THE ONE THAT MATTERS: the platform-admin console does not use NextAuth. It
 *  mints its principal as `<ADMIN_USERNAME>@platform.jobflex.local` with
 *  isPlatformAdmin: true (src/actions/adminAuth.ts) so admin writes have a real
 *  User row to hang foreign keys on. That row is a login, not a mailbox —
 *  `.local` is reserved by RFC 6762 and resolves nowhere — and it is picked up
 *  by the isPlatformAdmin query below, which is the DOCUMENTED default when
 *  SUPPORT_NOTIFY_EMAIL is unset. Resend rejects a batch containing it as a
 *  permanent validation error, which the retry layer correctly does not retry,
 *  so a single synthetic row took the alert away from every real admin too. */
function undeliverable(email: string): boolean {
  return /@[^@]*\.local$/i.test(email.trim());
}

/** New tickets always reach the support inbox, plus configured operators.
 *  Also where the support AI copies every answer (lib/support/aiSupport). */
export async function supportRecipients(): Promise<string[]> {
  const inbox = "app@jobflex.app";
  const recipients = (extra: string[]) => [...new Set([inbox, ...extra].map((e) => e.trim().toLowerCase()).filter((e) => e && !undeliverable(e)))];
  const override = process.env.SUPPORT_NOTIFY_EMAIL?.trim();
  if (override) {
    return recipients(override.split(","));
  }
  const admins = await db.user.findMany({
    where: { isPlatformAdmin: true },
    select: { email: true },
  }).catch(() => []);
  const all = admins.map((a) => a.email).filter((e): e is string => Boolean(e));
  const real = all.filter((e) => !undeliverable(e));
  if (real.length < all.length) {
    console.warn(
      `[support] skipped ${all.length - real.length} undeliverable platform-admin address(es) — console principals are logins, not mailboxes.`,
    );
  }
  return recipients(real);
}

/** Email the operator that a ticket arrived. Never throws. */
export async function notifySupportTicket(t: SupportTicketNotice): Promise<SupportNotifyResult> {
  try {
    if (!isEmailEnabled()) {
      console.warn(
        `[support] ticket ${t.ref} filed with no mail transport configured (set RESEND_API_KEY or SMTP_*) — no operator alert sent.`,
      );
      return { sent: false, reason: "no-transport" };
    }
    const to = await supportRecipients();
    if (to.length === 0) {
      console.warn(
        `[support] ticket ${t.ref} filed with nobody reachable to alert — set SUPPORT_NOTIFY_EMAIL, or flag a user with a real mailbox isPlatformAdmin.`,
      );
      return { sent: false, reason: "no-recipient" };
    }

    const appUrl = await appBaseUrl();
    const { subject, html } = renderEmail(
      buildSupportTicket({
        subject: t.subject,
        body: t.body,
        category: t.category,
        priority: t.priority,
        orgName: t.orgName,
        submitterEmail: t.submitterEmail,
        ref: t.ref,
        href: `${appUrl}/admin/support?ticket=${t.ticketId}`,
      }),
    );
    // ONE SEND PER RECIPIENT, not one batch. A batch is a single provider call
    // and a single verdict: one address the provider dislikes and nobody on the
    // list is told, which is exactly how the console principal above took the
    // alert away from the real admins. Sent in series (the list is a handful of
    // operators, not a mailing) and each failure is logged with its address.
    let delivered = 0;
    for (const address of to) {
      try {
        await sendEmail({ mailClass: "transactional",
          to: address,
          subject,
          html,
          // The alert is FROM the platform but ABOUT a contractor's problem, so
          // a plain Reply goes to the person who raised it instead of to the
          // platform's own send-only address.
          // With replies by email on, the ticket's own address instead: the
          // answer then lands in the conversation and reaches the customer from there.
          replyTo: t.replyTo ?? t.submitterEmail ?? undefined,
          kind: "support",
        });
        delivered += 1;
      } catch (err) {
        console.error(`[support] alert to ${address} failed for ticket ${t.ref}:`, err);
      }
    }
    if (delivered === 0) return { sent: false, reason: "failed" };
    return { sent: true, recipients: delivered };
  } catch (err) {
    console.error(`[support] operator alert failed for ticket ${t.ref}:`, err);
    return { sent: false, reason: "failed" };
  }
}

// ── Trade network (Hire & Work marketplace) ─────────────────────────────────
// All three are best-effort and called behind dynamic imports from
// actions/tradeServices.ts — a mail failure never fails the write that
// triggered it. The bell reads ActivityEvent per org
// (actions/notifications.ts recentNotifications), so each notice also writes
// one there; unknown kinds fall through to the bell's default href.

const tradeEsc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

async function tradeFirstOrgId(userId: string): Promise<string | null> {
  const m = await db.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  return m?.organizationId ?? null;
}

async function tradeEmailOf(userId: string): Promise<string | null> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  return u?.email ?? null;
}

/** How the interested party is named in both halves below. */
function tradeWho(from: { fromName: string; fromCompany: string | null }) {
  return from.fromCompany && from.fromCompany !== from.fromName
    ? `${from.fromName} (${from.fromCompany})`
    : from.fromName;
}

/**
 * A hirer pressed "I'm interested" on a listed open-for-work profile.
 *
 * SPLIT IN TWO ON PURPOSE (2026-08-24). The caller awaits the bell — one
 * insert, and it is what the button's "Sent" state asserts — and defers the
 * email to `after()`, because an SMTP handshake is seconds and the person who
 * pressed the button should not be watching a spinner for it.
 */
export async function recordTalentContacted(
  userId: string,
  from: { fromName: string; fromCompany: string | null },
) {
  const orgId = await tradeFirstOrgId(userId);
  if (!orgId) return { skipped: true as const };
  await db.activityEvent.create({
    data: {
      organizationId: orgId,
      kind: "TRADE_CONTACT",
      summary: `${tradeWho(from)} is interested in your services`,
    },
  });
  return { skipped: false as const };
}

/** The mail half of the above. Safe to run after the response is sent. */
export async function emailTalentContacted(
  userId: string,
  from: { fromName: string; fromCompany: string | null },
) {
  if (!isEmailEnabled()) return { skipped: true as const };
  const email = await tradeEmailOf(userId);
  if (!email) return { skipped: true as const };
  const who = tradeWho(from);
  const appUrl = await appBaseUrl();
  await sendEmail({ mailClass: "transactional",
    to: email,
    subject: `${who} is interested in your services on JobFlex`,
    html:
      `<p>${tradeEsc(who)} saw your open-for-work profile in the JobFlex talent directory and wants to talk.</p>` +
      `<p><a href="${appUrl}/trade-services">Open Trade services</a> to follow up.</p>`,
  });
  return { skipped: false as const };
}

/** A recipient raised a hand for a posted trade job — tell its author. */
export async function notifyTradeInterest(jobId: string, recipientUserId: string) {
  const job = await db.tradeJob.findUnique({
    where: { id: jobId },
    select: { title: true, authorId: true, authorOrgId: true },
  });
  if (!job) return { skipped: true as const };
  const [rec, recOrg] = await Promise.all([
    db.user.findUnique({ where: { id: recipientUserId }, select: { name: true } }),
    db.membership.findFirst({
      where: { userId: recipientUserId },
      orderBy: { createdAt: "asc" },
      select: { organization: { select: { name: true } } },
    }),
  ]);
  const who = rec?.name ?? recOrg?.organization.name ?? "A contractor";
  await db.activityEvent.create({
    data: {
      organizationId: job.authorOrgId,
      kind: "TRADE_INTEREST",
      summary: `${who} is interested in "${job.title}"`,
    },
  });
  if (!isEmailEnabled()) return { skipped: true as const };
  const appUrl = await appBaseUrl();
  const { sent } = await sendToUserByPref(job.authorId, "trade-reply", {
    subject: `${who} raised a hand for "${job.title}"`,
    html:
      `<p>${tradeEsc(who)} is interested in your trade-network post <b>${tradeEsc(job.title)}</b>. A private chat is open with them.</p>` +
      `<p><a href="${appUrl}/trade-services">Open Trade services</a> to reply.</p>`,
  });
  return { skipped: !sent };
}

// ── Hire & Work board (rebuilt 2026-09-03) ──────────────────────────────────
// Someone pressed "I'm interested" on a post. Split like the talent-contact
// pair above: the bell is awaited by the caller, the mail runs after the
// response. The mail carries the interested party's contact details, because
// on the board the conversation continues by email, not in an in-app thread.

async function hireInterestParties(jobId: string, fromUserId: string) {
  const [job, from] = await Promise.all([
    db.tradeJob.findUnique({
      where: { id: jobId },
      select: { title: true, authorId: true, authorOrgId: true },
    }),
    db.user.findUnique({
      where: { id: fromUserId },
      select: {
        name: true,
        email: true,
        phone: true,
        memberships: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { organization: { select: { name: true, phone: true } } },
        },
      },
    }),
  ]);
  if (!job || !from) return null;
  const company = from.memberships[0]?.organization.name ?? null;
  return {
    job,
    who: tradeWho({ fromName: from.name ?? company ?? "A contractor", fromCompany: company }),
    email: from.email,
    phone: from.phone ?? from.memberships[0]?.organization.phone ?? null,
  };
}

export async function recordHireInterest(jobId: string, fromUserId: string) {
  const p = await hireInterestParties(jobId, fromUserId);
  if (!p) return { skipped: true as const };
  await db.activityEvent.create({
    data: {
      organizationId: p.job.authorOrgId,
      kind: "TRADE_INTEREST",
      summary: `${p.who} is interested in your post "${p.job.title}"`,
    },
  });
  return { skipped: false as const };
}

export async function emailHireInterest(jobId: string, fromUserId: string) {
  if (!isEmailEnabled()) return { skipped: true as const };
  const p = await hireInterestParties(jobId, fromUserId);
  if (!p) return { skipped: true as const };
  const appUrl = await appBaseUrl();
  const phoneLine = p.phone ? `<p>Phone: ${tradeEsc(p.phone)}</p>` : "";
  const { sent } = await sendToUserByPref(p.job.authorId, "trade-reply", {
    subject: `${p.who} is interested in "${p.job.title}"`,
    html:
      `<p>${tradeEsc(p.who)} pressed <b>I'm interested</b> on your Hire &amp; Work post <b>${tradeEsc(p.job.title)}</b>.</p>` +
      `<p>Email: <a href="mailto:${tradeEsc(p.email)}">${tradeEsc(p.email)}</a></p>` +
      phoneLine +
      `<p>Reply to them directly, or <a href="${appUrl}/dashboard/hire?tab=work">open your posts</a> to see everyone who has answered this one.</p>`,
  });
  return { skipped: !sent };
}

/** The poster marked a job FILLED — everyone who raised a hand hears it. The
 *  contractor they actually hired reads it as "you're hired"; the rest read it
 *  as the thread closing, which is also true. */
export async function notifyTradeFilled(jobId: string) {
  const job = await db.tradeJob.findUnique({
    where: { id: jobId },
    select: {
      title: true,
      recipients: { where: { status: "INTERESTED" }, select: { recipientId: true } },
    },
  });
  if (!job || job.recipients.length === 0) return { skipped: true as const };
  await Promise.all(
    job.recipients.map(async (r) => {
      const orgId = await tradeFirstOrgId(r.recipientId);
      if (!orgId) return;
      await db.activityEvent.create({
        data: {
          organizationId: orgId,
          kind: "TRADE_HIRED",
          summary: `"${job.title}" was filled — you were on its interested list`,
        },
      });
    }),
  );
  if (!isEmailEnabled()) return { skipped: true as const };
  const appUrl = await appBaseUrl();
  await Promise.all(
    job.recipients.map((r) =>
      sendToUserByPref(r.recipientId, "trade-reply", {
        subject: `"${job.title}" has been filled`,
        html:
          `<p>You raised a hand for <b>${tradeEsc(job.title)}</b> and the poster has marked it filled. If you agreed the work with them — congratulations, you're hired.</p>` +
          `<p><a href="${appUrl}/trade-services">Open Trade services</a> — the conversation stays available.</p>`,
      }),
    ),
  );
  return { skipped: false as const };
}


// ── Platform payments ────────────────────────────────────────────────────────

function providerLabel(provider: string, method: string | null): string {
  if (provider === "STRIPE") return method === "us_bank_account" ? "Stripe (bank debit)" : "Stripe";
  if (provider === "SQUARE") return "Square";
  if (provider === "STAX") return method === "us_bank_account" ? "Stax (bank)" : "Stax";
  if (provider === "WISETACK") return "Wisetack financing";
  switch (method) {
    case "BANK_TRANSFER":
      return "Bank transfer";
    case "CASH":
      return "Cash";
    case "CHECK":
      return "Check";
    default:
      return "Recorded manually";
  }
}

/**
 * A payment landed on a proposal (hosted checkout webhook, active verify, or
 * a manual mark). Receipt to the client when the org wants receipts; heads-up
 * to the owner always. Called AFTER the settle transaction commits.
 */
export async function notifyPaymentReceived({ paymentId }: { paymentId: string }) {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: {
      installments: { select: { label: true } },
      client: { select: { name: true, email: true } },
      proposal: {
        include: {
          installments: true,
          changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } },
          organization: {
            select: {
              name: true,
              billingEmail: true,
              gmailSettingsJson: true,
              gmailTokensJson: true,
              logoUrl: true,
              phone: true,
              paymentSettingsJson: true,
            },
          },
        },
      },
    },
  });
  if (!payment || !payment.proposal) return { skipped: true as const, reason: "not-found" };
  const proposal = payment.proposal;
  const org = proposal.organization;
  const appUrl = await appBaseUrl();
  const schedule = resolveSchedule({
    ...contractSchedule(proposal.total, proposal.changeOrders),
    currency: proposal.currency,
    installments: proposal.installments,
  });
  const remaining = fromMinor(schedule.remainingMinor);
  const paidToDate = fromMinor(schedule.paidMinor);
  const stageLabel =
    payment.installments.length === 0
      ? "Payment"
      : payment.installments.length === 1
        ? payment.installments[0].label
        : "Remaining balance";
  const clientName = payment.client?.name ?? "Your client";
  const ref = payment.id.slice(-8).toUpperCase();

  // The receipt and the "order placed" notice (2026-11-09) go through lib/payments/clientMail, the same letters the
  // Payments panel previews and resends, and each one is written to the proposal's trail.
  const paySettings = parsePaymentSettings(org.paymentSettingsJson);
  if (paySettings.receiptsOnPayment && (payment.client?.email || proposal.clientId)) {
    await sendReceipt(payment.id, { actorId: null, source: "auto" }).catch((err) => console.warn("[notifyPaymentReceived] client receipt failed", err));
  }
  if (paySettings.orderNoticeAuto && payment.proposalId && !(await orderNoticeSentAt(payment.proposalId))) {
    await sendOrderNotice(payment.proposalId, { note: null, actorId: null, source: "auto" }).catch((err) => console.warn("[notifyPaymentReceived] order notice failed", err));
  }

  await textOffice(payment.organizationId, "payment-received", paymentLine(clientName, proposal.title, payment.amount, remaining), { alsoUserIds: [payment.proposal?.ownerId] });
  if (payment.proposalId) await fireTextRules("payment.received", proposalContext(payment.proposalId, { amount: smsMoney(payment.amount) }));
  await sendToMembersByPref(
    payment.organizationId,
    "payment-received",
    buildOwnerPaymentReceived({
      org: { id: payment.organizationId, name: org.name, logoUrl: org.logoUrl, phone: org.phone },
      clientName,
      title: proposal.title,
      stageLabel,
      amount: payment.amount,
      fee: payment.feeAmount,
      net: payment.netAmount ?? payment.amount - payment.feeAmount,
      provider: providerLabel(payment.provider, payment.method),
      remaining,
      paidInFull: schedule.remainingMinor <= 0,
      href: `${appUrl}/dashboard/proposals/${proposal.id}`,
    }),
  );
  return { skipped: false as const, enabled: isEmailEnabled() };
}

/**
 * Money needs a human: overpayment to refund, an orphaned payment, a provider
 * account restricted, a token that failed to refresh. Writes a PAYMENT_ALERT
 * activity (bell) and emails the owner.
 */
export async function notifyPaymentIssue(input: {
  organizationId: string;
  proposalId?: string | null;
  title: string;
  detail: string;
  amount?: number | null;
}) {
  const org = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: { name: true, billingEmail: true, logoUrl: true, phone: true },
  });
  if (!org) return { skipped: true as const };
  await db.activityEvent.create({
    data: {
      organizationId: input.organizationId,
      proposalId: input.proposalId ?? undefined,
      kind: ActivityKind.PAYMENT_ALERT,
      summary: input.title,
      meta: JSON.stringify({ detail: input.detail, amount: input.amount ?? null }),
    },
  });
  const ownerEmail = await ownerEmailFor(input.organizationId, org.billingEmail);
  if (!ownerEmail) return { skipped: true as const };
  const appUrl = await appBaseUrl();
  const { subject, html } = renderEmail(
    buildPaymentIssue({
      org: { id: input.organizationId, name: org.name, logoUrl: org.logoUrl, phone: org.phone },
      title: input.title,
      detail: input.detail,
      amount: input.amount ?? null,
      href: input.proposalId
        ? `${appUrl}/dashboard/proposals/${input.proposalId}`
        : `${appUrl}/dashboard/settings?tab=payments`,
    }),
  );
  await sendEmail({ mailClass: "transactional", to: ownerEmail, subject, html }).catch((err) =>
    console.warn("[notifyPaymentIssue] email failed", err),
  );
  return { skipped: false as const };
}

// ── the crew on site (2026-09-27) ──────────────────────────────────────

/**
 * Work started, a crew back for another day, or the job done: one line to
 * the owner and the manager by text (their Text cell for "Crew on site" /
 * "Job completed", quiet hours honoured), never to the crew member who
 * pressed the button. The bell already has the STARTED / COMPLETED row.
 */
export async function notifyJobProgress(jobId: string, actor: { userId: string; name: string }, what: ProgressWhat, day: number) {
  // A closed day (stage A, 2026-09-30) is the trail's; its text comes with the texting stage.
  if (what === "closed") return { skipped: true as const };
  const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true, title: true, organizationId: true, proposal: { select: { ownerId: true } } } });
  if (!job) return { skipped: true as const };
  const appUrl = await appBaseUrl();
  const link = `${appUrl}/dashboard/jobs/${job.id}`;
  const line =
    what === "completed"
      ? jobCompletedLine(actor.name, job.title, day, link)
      : what === "continued"
        ? jobBackLine(actor.name, job.title, day, link)
        : jobStartedLine(actor.name, job.title, link);
  // The rep who sold it hears "completed" when they ticked it; "started" is the office's (2026-09-29).
  const r = await textOffice(job.organizationId, what === "completed" ? "job-completed" : "job-started", line, { excludeUserIds: [actor.userId], alsoUserIds: what === "completed" ? [job.proposal?.ownerId] : [] });
  // The company's own texts on the moment (a day-two restart is not a start).
  if (what !== "continued") await fireTextRules(what === "completed" ? "job.completed" : "job.started", jobContext(job.id), { actorUserId: actor.userId });
  return { skipped: false as const, ...r };
}

/** How long a run of uploads counts as one batch for the office. */
const MEDIA_BATCH_MS = 20 * 60_000;

/**
 * Photos or a video came in from the field. The first file of a batch — one
 * crew member, one job, twenty minutes — puts a MEDIA row on the bell and a
 * text on the office phones; the rest of the batch adds to the same count
 * (the job page and the trail carry every file). A crew that shoots thirty
 * pictures is not thirty texts.
 */
export async function notifyJobMedia(jobId: string, actor: { userId: string; name: string }, media: "photo" | "video") {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true, title: true, organizationId: true, proposalId: true, clientId: true } });
  if (!job) return { skipped: true as const };
  const since = new Date(Date.now() - MEDIA_BATCH_MS);
  const recent = await db.activityEvent.findFirst({
    where: { organizationId: job.organizationId, kind: "MEDIA", actorId: actor.userId, createdAt: { gte: since }, meta: { contains: `"jobId":"${job.id}"` } },
    select: { id: true },
  });
  if (recent) return { skipped: true as const, reason: "batched" };
  // What the batch has so far — the files this member added to the job in the window.
  const rows = await db.activityEvent.findMany({
    where: { organizationId: job.organizationId, kind: "PHOTO", actorId: actor.userId, createdAt: { gte: since }, meta: { contains: `"jobId":"${job.id}"` } },
    select: { meta: true },
  });
  let photos = 0;
  let videos = 0;
  for (const r of rows) {
    try {
      const m = JSON.parse(r.meta ?? "{}") as { media?: string };
      if (m.media === "video") videos++;
      else photos++;
    } catch {
      photos++;
    }
  }
  if (!photos && !videos) {
    if (media === "video") videos = 1;
    else photos = 1;
  }
  const appUrl = await appBaseUrl();
  const link = `${appUrl}/dashboard/jobs/${job.id}`;
  await db.activityEvent.create({
    data: {
      organizationId: job.organizationId,
      actorId: actor.userId,
      proposalId: job.proposalId,
      clientId: job.clientId,
      kind: "MEDIA",
      summary: `${actor.name} is adding ${videos && !photos ? "video" : "photos"} of ${job.title}`,
      meta: JSON.stringify({ jobId: job.id, photos, videos }),
    },
  });
  const r = await textOffice(job.organizationId, "job-photos", jobMediaLine(actor.name, job.title, photos, videos, link), { excludeUserIds: [actor.userId] });
  return { skipped: false as const, ...r };
}
