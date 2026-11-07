// Follow-up scheduling + dispatch engine. Plain server module — NOT a
// "use server" file. These used to be exported from src/actions/followUps.ts,
// which made them public POST endpoints: anyone holding a proposal id could
// enqueue follow-up email/SMS to that org's client and fire the dispatcher
// without the cron secret. Only server code (proposal status changes, the
// cron route, the CRM "send now" action) may call these.
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { renderEmail } from "@/lib/email/renderEmail";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { sendText } from "@/lib/sms/send";
import {
  delayLabel,
  encodeDispatch,
  followUpEmailDoc,
  followUpSmsText,
  parseChannel,
  parseDispatch,
} from "@/lib/followUps/copy";
import { trialBlocksText } from "@/lib/trialMeter";
import { ProposalStatus } from "@/lib/prismaEnums";

/** Appended to the note of a queued row that was closed without sending, so
 *  the row says why it never went. */
export const SKIPPED_MARK = " · skipped: ";

/** The statuses in which a queued follow-up still makes sense, by the trigger
 *  that queued it. "Haven't heard back" is wrong once the client accepted,
 *  declined or paid, so the row is closed unsent instead. A client opening the
 *  quote (VIEWED) is still no answer. Any trigger not listed must still be the
 *  proposal's status. */
const STILL_CURRENT: Record<string, readonly string[]> = {
  [ProposalStatus.SENT]: [ProposalStatus.SENT, ProposalStatus.VIEWED],
  [ProposalStatus.PAID]: [ProposalStatus.PAID, ProposalStatus.COMPLETED],
};
function stillCurrent(trigger: string, status: string): boolean {
  return (STILL_CURRENT[trigger] ?? [trigger]).includes(status);
}

// Called from sendProposal / updateProposalStatus when a status changes — schedules any matching rule.
export async function scheduleFollowUpsFor(proposalId: string, newStatus: string) {
  const proposal = await db.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return { scheduled: 0 };

  const rules = await db.followUpRule.findMany({
    where: {
      organizationId: proposal.organizationId,
      triggerStatus: newStatus,
      enabled: true,
    },
  });

  // A re-send restarts the clock: what the last send queued under the same
  // status is closed, or every re-send would add one more set of reminders.
  if (rules.length) {
    const queued = await db.followUp.findMany({
      where: { proposalId: proposal.id, completedAt: null },
      select: { id: true, templateId: true, note: true },
    });
    for (const q of queued) {
      if ((parseDispatch(q.templateId).trigger ?? ProposalStatus.SENT) !== newStatus) continue;
      await db.followUp.update({
        where: { id: q.id },
        data: { completedAt: new Date(), note: `${q.note ?? ""}${SKIPPED_MARK}re-${newStatus.toLowerCase()}` },
      });
    }
  }

  let scheduled = 0;
  for (const r of rules) {
    const runAt = new Date(Date.now() + r.delayMinutes * 60 * 1000);
    await db.followUp.create({
      data: {
        organizationId: proposal.organizationId,
        proposalId: proposal.id,
        runAt,
        note: `${r.name} · ${r.triggerStatus} + ${r.delayMinutes}m`,
        // The queued row has to survive the rule being edited or deleted before
        // it fires, so it carries its own copy of what to send and how.
        // `templateId` is a free-form String? with no foreign key — see
        // src/lib/followUps/copy.ts.
        templateId: encodeDispatch(parseChannel(r.template), r.triggerStatus),
      },
    });
    scheduled++;
  }
  return { scheduled };
}

// Cron: dispatch any follow-ups whose runAt is in the past.
export async function runDueFollowUps(): Promise<{ processed: number; delivered: number }> {
  const due = await db.followUp.findMany({
    where: { completedAt: null, runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
    take: 50,
  });

  let delivered = 0;
  for (const fu of due) {
    const delivered_ = await dispatchOne(fu.id).catch(() => false);
    if (delivered_) delivered++;
  }
  return { processed: due.length, delivered };
}

/** `scheduleFollowUpsFor` writes the delay into the note as "… + 2880m", which
 *  is the only record of how long the rule waited once the row is queued. The
 *  prose says it out loud ("we sent this over 2 days ago"), so it is read back
 *  here rather than guessed. A row from before this change, or a hand-made one,
 *  just gets the neutral fallback. */
function delayFromNote(note: string | null): string {
  const m = note ? /\+\s*(\d+)m\s*$/.exec(note) : null;
  return m ? delayLabel(Number(m[1])) : "a few days";
}

export async function dispatchOne(id: string): Promise<boolean> {
  const fu = await db.followUp.findUnique({
    where: { id },
    include: {
      organization: { select: { name: true } },
    },
  });
  if (!fu) return false;

  // What to say and how to send it were both stamped onto the row when the rule
  // scheduled it, so editing or deleting the rule afterwards cannot change a
  // follow-up that is already in the queue.
  const { channel, trigger } = parseDispatch(fu.templateId);

  const proposal = fu.proposalId
    ? await db.proposal.findUnique({
        where: { id: fu.proposalId },
        include: {
          client: true,
          organization: {
            select: {
              name: true,
              gmailSettingsJson: true,
              gmailTokensJson: true,
              billingEmail: true,
              logoUrl: true,
              phone: true,
            },
          },
        },
      })
    : null;

  // Checked when it goes, not when it was queued: the client may have
  // accepted, declined or paid since. Closed unsent, so it never fires later.
  if (proposal && !stillCurrent(trigger ?? ProposalStatus.SENT, proposal.status)) {
    await db.followUp.update({
      where: { id },
      data: { completedAt: new Date(), note: `${fu.note ?? ""}${SKIPPED_MARK}${proposal.status}` },
    });
    return false;
  }

  /** What actually left the building, for the activity log. */
  let outcome: { kind: "EMAIL" | "TEXT"; to: string } | null = null;

  if (proposal) {
    const appUrl = await appBaseUrl();
    const ctx = {
      orgName: proposal.organization.name,
      orgLogoUrl: proposal.organization.logoUrl,
      orgId: proposal.organizationId,
      orgPhone: proposal.organization.phone,
      clientName: proposal.client?.name ?? "there",
      title: proposal.title,
      total: proposal.total,
      validUntil: proposal.validUntil,
      href: `${appUrl}/portal/q/${proposal.publicId}`,
      delayLabel: delayFromNote(fu.note),
    };

    // TEXT falls back to email when the number was removed after the rule was
    // written — a follow-up that goes nowhere is worse than one that arrives on
    // the other channel.
    // The card-less trial sends no texts (lib/trialMeter): a TEXT follow-up
    // goes by email instead, the same fallback as a removed number.
    const canText = channel === "TEXT" && await isTwilioEnabled() && Boolean(proposal.client?.phone) && !(await trialBlocksText(proposal.organizationId, "follow-up"));

    if (canText && proposal.client?.phone) {
      // From the company's own number to a client who said yes; a text that
      // cannot leave falls back to the email below (lib/sms/send, 2026-10-02).
      const res = await sendText({ organizationId: proposal.organizationId, to: proposal.client.phone, body: followUpSmsText(trigger ?? "SENT", ctx), kind: "follow-up" });
      if (res.ok && res.status !== "SKIPPED") outcome = { kind: "TEXT", to: proposal.client.phone };
    }
    if (!outcome && proposal.client?.email) {
      const { subject: subj, html } = renderEmail(followUpEmailDoc(trigger ?? "SENT", ctx));
      // Sends via the org's connected Gmail when opted in, else Resend/SMTP with
      // the contractor as reply-to.
      await sendOrgEmail(proposal.organization, {
        to: proposal.client.email,
        subject: subj,
        html,
        kind: "follow-up",
      });
      outcome = { kind: "EMAIL", to: proposal.client.email };
    }
  }

  await db.followUp.update({
    where: { id },
    data: { completedAt: new Date() },
  });

  await db.activityEvent.create({
    data: {
      organizationId: fu.organizationId,
      proposalId: fu.proposalId,
      kind: outcome?.kind ?? "EMAIL",
      summary: outcome
        ? `Follow-up ${outcome.kind === "TEXT" ? "texted" : "emailed"} to ${outcome.to}`
        : "Follow-up closed — no reachable contact",
    },
  });

  return true;
}
