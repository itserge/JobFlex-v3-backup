// Server-only. The ONE sender for the client's review link — first ask and the
// 7-day reminder. Every path that creates a ReviewRequest (proposal completed,
// job completed, the manual "Send request" button) calls this instead of
// assembling the mail itself, so the copy, the org branding and the transport
// (the contractor's Gmail when connected, Resend with reply-to otherwise) stay
// in one place.
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { renderEmail } from "@/lib/email/renderEmail";
import { buildReviewRequest, buildReviewReminder } from "@/lib/email/build/client";

export type ReviewEmailKind = "request" | "reminder";

/**
 * Sends the review link for one request. Returns false (without throwing)
 * when there is nobody to send to — no client, or a client with no email.
 * Transport errors DO throw; callers decide whether that is fatal (it never
 * is on a completion path).
 */
export async function sendReviewRequestEmail(reviewRequestId: string, kind: ReviewEmailKind): Promise<boolean> {
  const rr = await db.reviewRequest.findUnique({
    where: { id: reviewRequestId },
    select: {
      publicToken: true,
      organizationId: true,
      clientId: true,
      client: { select: { name: true, email: true } },
      proposal: { select: { title: true } },
      job: { select: { title: true } },
      organization: {
        select: {
          name: true,
          logoUrl: true,
          phone: true,
          gmailSettingsJson: true,
          gmailTokensJson: true,
          billingEmail: true,
        },
      },
    },
  });
  if (!rr) return false;
  const to = rr.client?.email?.trim();
  if (!to) return false;

  const org = rr.organization;
  const appUrl = await appBaseUrl();
  const input = {
    org: { id: rr.organizationId, name: org.name, logoUrl: org.logoUrl, phone: org.phone },
    clientName: rr.client?.name?.trim() || "there",
    jobTitle: rr.proposal?.title?.trim() || rr.job?.title?.trim() || "work",
    href: `${appUrl}/review/${rr.publicToken}`,
  };
  const doc = kind === "reminder" ? buildReviewReminder(input) : buildReviewRequest(input);
  const { subject, html } = renderEmail(doc);
  await sendOrgEmail(org, { to, subject, html, clientId: rr.clientId, organizationId: rr.organizationId });
  return true;
}
