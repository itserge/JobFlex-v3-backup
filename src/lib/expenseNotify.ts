// A RECEIPT WAITING ON THE OFFICE (stage D, 2026-09-30) — server.
//
// A crew member's receipt lands SUBMITTED and counts nowhere until the owner
// or a manager approves it, so they have to hear about it. Through the
// channels that exist, nothing new: a row on the bell (ActivityEvent
// EXPENSE_SUBMITTED — not a trail-only kind, so the bell shows it and it opens
// Financials' review queue), and an email to each owner / admin / manager
// whose "Receipt on review" preference is on (quiet hours respected — the
// matrix in Settings → Notifications). No text: SMS rules are the second
// developer's, and no new one is added here.

import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { sendToMembersByPref } from "@/lib/notificationPrefs";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function notifyExpenseSubmitted(expenseId: string): Promise<void> {
  const ex = await db.jobExpense.findUnique({
    where: { id: expenseId },
    select: { id: true, amount: true, category: true, vendor: true, paidBy: true, status: true, submittedById: true, jobId: true, job: { select: { title: true, organizationId: true, proposalId: true, clientId: true, organization: { select: { name: true, logoUrl: true } } } } },
  });
  if (!ex || ex.status !== "SUBMITTED" || !ex.job) return;
  const job = ex.job;
  const who = ex.submittedById
    ? (await db.workerProfile.findUnique({ where: { userId: ex.submittedById }, select: { displayName: true } }))?.displayName ??
      (await db.user.findUnique({ where: { id: ex.submittedById }, select: { name: true, email: true } }).then((u) => u?.name || u?.email)) ??
      "A crew member"
    : "A crew member";
  const orgId = job.organizationId;
  const what = `${money(ex.amount)}${ex.vendor ? ` at ${ex.vendor}` : ""}`;
  await db.activityEvent.create({
    data: {
      organizationId: orgId,
      actorId: ex.submittedById,
      proposalId: job.proposalId,
      clientId: job.clientId,
      kind: "EXPENSE_SUBMITTED",
      summary: `${who} sent a receipt for ${job.title} — ${what}, waiting for review`,
      meta: JSON.stringify({ jobId: ex.jobId, expenseId: ex.id, amount: ex.amount, paidBy: ex.paidBy, href: "/dashboard/financials?review=1" }),
    },
  });
  const appUrl = await appBaseUrl();
  await sendToMembersByPref(orgId, "expense-submitted", {
    subject: `Receipt to review — ${job.title}`,
    lockup: { kind: "org", name: job.organization.name, logoUrl: job.organization.logoUrl, orgId },
    kicker: { text: "Waiting for review", tone: "warn" },
    headline: `${who} sent a receipt`,
    prose: [`It does not count in any total until you approve it.`],
    box: [
      { type: "field", label: "Job", value: job.title },
      { type: "field", label: "Amount", value: what },
      { type: "field", label: "Category", value: ex.category },
      { type: "field", label: "Paid by", value: ex.paidBy === "WORKER" ? `${who} (to reimburse)` : "Company card" },
    ],
    cta: { label: "Review receipts", href: `${appUrl}/dashboard/financials?review=1` },
    footer: { name: job.organization.name },
  });
}
