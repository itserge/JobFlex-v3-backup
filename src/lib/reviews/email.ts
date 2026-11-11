// Server-only. The ONE sender for the client's review link — first ask and the
// 7-day reminder. Every path that creates a ReviewRequest (proposal completed,
// job completed, the manual "Send request" button) calls this instead of
// assembling the mail itself, so the copy, the org branding and the transport
// (the contractor's Gmail when connected, Resend with reply-to otherwise) stay
// in one place.
//
// 2026-11-11: a client who asked this company for no more emails (ClientEmailOptOut) gets none; every one that goes
// carries the Unsubscribe link, the one-click headers and the company's postal address (lib/email/optOutFooter).
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { renderEmail } from "@/lib/email/renderEmail";
import { buildReviewRequest, buildReviewReminder } from "@/lib/email/build/client";
import { companyOptOut, withOptOut } from "@/lib/email/optOutFooter";
import { companyOptedOut } from "@/lib/winback/optout";

export type ReviewEmailKind = "request" | "reminder";

/**
 * Sends the review link for one request. Returns false (without throwing)
 * when there is nobody to send to — no client, a client with no email, or one who
 * asked for no more emails.
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
          address: true,
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
  if (await companyOptedOut(rr.organizationId, to)) return false;

  const org = rr.organization;
  const appUrl = await appBaseUrl();
  const input = {
    org: { id: rr.organizationId, name: org.name, logoUrl: org.logoUrl, phone: org.phone },
    clientName: rr.client?.name?.trim() || "there",
    jobTitle: rr.proposal?.title?.trim() || rr.job?.title?.trim() || "work",
    href: `${appUrl}/review/${rr.publicToken}`,
  };
  const foot = companyOptOut(appUrl, { id: rr.organizationId, name: org.name, address: org.address }, to);
  const doc = withOptOut(kind === "reminder" ? buildReviewReminder(input) : buildReviewRequest(input), foot);
  const { subject, html } = renderEmail(doc);
  const res = await sendOrgEmail(org, { mailClass: "marketing", to, subject, html, clientId: rr.clientId, organizationId: rr.organizationId, headers: foot.headers });
  return !res.blocked;
}
