// Sending a change order to the client (email + SMS) and telling the office
// how the client answered. Plain module: the action and the public routes
// both call it. Every send is best-effort and reports what it did — a
// missing email or a phone Twilio cannot dial is a skip with a reason, never
// a throw that leaves the row SENT with nobody told.
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { renderEmail } from "@/lib/email/renderEmail";
import { buildChangeOrder } from "@/lib/email/build/client";
import { buildOwnerChangeOrderAnswered } from "@/lib/email/build/operator";
import { sendToMembersByPref } from "@/lib/notificationPrefs";
import { textOffice } from "@/lib/sms/send";
import { fireTextRules, jobContext, proposalContext } from "@/lib/sms/rulesEngine";
import { money } from "@/lib/sms/format";
import { changeOrderLine } from "@/lib/sms/format";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { sendText } from "@/lib/sms/send";
import { toE164 } from "@/lib/phone";
import { contractTotal, type ContractCo } from "@/lib/contractTotal";
import { parseCoLines, parseCoPhotos } from "./parse";
import { trialBlocksText } from "@/lib/trialMeter";

export interface SendReport {
  email: "sent" | "no-email" | "failed" | "disabled";
  sms: "sent" | "no-phone" | "failed" | "disabled";
}

const ORG_SELECT = { name: true, billingEmail: true, gmailSettingsJson: true, gmailTokensJson: true, logoUrl: true, phone: true } as const;

async function loadForSend(coId: string) {
  return db.changeOrder.findUnique({
    where: { id: coId },
    include: {
      organization: { select: ORG_SELECT },
      job: { include: { client: true, proposal: { select: { id: true, title: true, total: true, ownerId: true, changeOrders: { where: { status: "APPROVED" }, select: { id: true, status: true, total: true } } } } } },
      proposal: { select: { id: true, title: true, total: true, ownerId: true, client: true, changeOrders: { where: { status: "APPROVED" }, select: { id: true, status: true, total: true } } } },
    },
  });
}

/** The contract before this change: the proposal's total plus every change approved so far, this one excluded. */
function contractBefore(coId: string, proposal: { total: number; changeOrders: Array<ContractCo & { id: string }> } | null | undefined) {
  if (!proposal) return { original: null as number | null, approved: null as number | null, before: null as number | null };
  const others = proposal.changeOrders.filter((c) => c.id !== coId);
  const before = contractTotal(proposal.total, others);
  return { original: proposal.total, approved: Math.round((before - proposal.total) * 100) / 100, before };
}

export async function sendChangeOrderToClient(coId: string): Promise<SendReport> {
  const co = await loadForSend(coId);
  if (!co) return { email: "failed", sms: "failed" };
  const proposal = co.proposal ?? co.job?.proposal ?? null;
  const client = co.proposal?.client ?? co.job?.client ?? null;
  const contextTitle = co.proposal?.title ?? co.job?.title ?? "your project";
  const appUrl = await appBaseUrl();
  const href = `${appUrl}/co/${co.publicToken}`;
  const lines = parseCoLines(co.linesJson);
  const photos = parseCoPhotos(co.photosJson);
  const { original, approved, before } = contractBefore(co.id, proposal);

  const report: SendReport = { email: "no-email", sms: "no-phone" };

  if (client?.email) {
    try {
      const { subject, html } = renderEmail(
        buildChangeOrder({
          org: { id: co.organizationId, name: co.organization.name, logoUrl: co.organization.logoUrl, phone: co.organization.phone },
          clientName: client.name,
          contextTitle,
          coTitle: co.title,
          description: co.reason ?? co.description,
          amount: co.amount,
          previousTotal: before,
          href,
          number: co.number,
          lines: lines.length ? lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, total: Math.round(l.quantity * l.unitPrice * 100) / 100 })) : undefined,
          originalTotal: original,
          approvedChangesTotal: approved,
          taxTotal: co.taxTotal,
          total: co.total,
          photoCount: photos.length,
        }),
      );
      // The contractor's own sender (connected Gmail, else the platform with
      // the contractor as reply-to) — the same path the proposal itself took.
      await sendOrgEmail(co.organization, { to: client.email, subject, html, clientId: client.id, organizationId: co.organizationId });
      report.email = "sent";
    } catch (err) {
      console.warn("[changeOrders] email failed:", err);
      report.email = "failed";
    }
  }

  const phone = toE164(client?.phone);
  if (phone) {
    if (!await isTwilioEnabled()) {
      report.sms = "disabled";
    } else if (await trialBlocksText(co.organizationId, "change-order")) {
      // The card-less trial sends no texts (lib/trialMeter); the email went.
      report.sms = "disabled";
    } else {
      try {
        const amount = co.total ?? co.amount;
        const body = `${co.organization.name}: a change order${co.number ? ` #${co.number}` : ""} for ${contextTitle} needs your approval — ${co.title}, ${amount >= 0 ? "+" : "−"}$${Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}. Review and approve: ${href}`;
        // From the company's own number to a client who said yes (lib/sms/send, 2026-10-02).
        const sent = await sendText({ organizationId: co.organizationId, to: phone, body, kind: "change-order" });
        report.sms = !sent.ok ? "failed" : sent.status === "SKIPPED" ? "disabled" : "sent";
      } catch (err) {
        console.warn("[changeOrders] sms failed:", err);
        report.sms = "failed";
      }
    }
  }
  return report;
}

/** The client answered: tell the office by its notification prefs (push + email). */
export async function notifyOfficeChangeOrderAnswered(coId: string, approved: boolean): Promise<void> {
  const co = await loadForSend(coId);
  if (!co) return;
  const proposal = co.proposal ?? co.job?.proposal ?? null;
  const client = co.proposal?.client ?? co.job?.client ?? null;
  const appUrl = await appBaseUrl();
  const href = co.jobId ? `${appUrl}/dashboard/jobs/${co.jobId}` : `${appUrl}/dashboard/proposals`;
  const after = proposal ? contractTotal(proposal.total, proposal.changeOrders) : null;
  await textOffice(
    co.organizationId,
    "change-order",
    changeOrderLine(client?.name ?? "Your client", approved, co.number ?? null, co.title, co.total ?? co.amount, co.proposal?.title ?? co.job?.title ?? "the job"),
    // …and the rep who sold the job, when they ticked it (2026-09-29).
    { alsoUserIds: [proposal?.ownerId] },
  );
  {
    // The company's own texts (2026-09-29): the deal's facts, the change order's amount.
    const amount = money(co.total ?? co.amount);
    const ctx = co.proposalId ? await proposalContext(co.proposalId, { amount }) : co.jobId ? await jobContext(co.jobId) : null;
    if (ctx) {
      ctx.vars.amount = amount;
      await fireTextRules("change_order.answered", ctx);
    }
  }
  await sendToMembersByPref(
    co.organizationId,
    "change-order",
    buildOwnerChangeOrderAnswered({
      org: { id: co.organizationId, name: co.organization.name, logoUrl: co.organization.logoUrl, phone: co.organization.phone },
      clientName: client?.name ?? "Your client",
      contextTitle: co.proposal?.title ?? co.job?.title ?? "the job",
      coTitle: co.title,
      number: co.number,
      total: co.total ?? co.amount,
      approved,
      note: approved ? co.approvedName : co.declineReason,
      contractTotal: after,
      href,
    }),
  );
}
