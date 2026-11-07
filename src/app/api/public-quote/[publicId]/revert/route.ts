import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimitShared, ipFromRequest, HOUR } from "@/lib/rateLimit";
import { verifyRevert } from "@/lib/quoteRevert";
import { appBaseUrl } from "@/lib/appUrl";
import { sendToMembersByPref } from "@/lib/notificationPrefs";
import { textOffice } from "@/lib/sms/send";
import { revertedLine } from "@/lib/sms/format";
import { buildOwnerReverted } from "@/lib/email/build/operator";

// Public proposal REVERT — the homeowner takes back a DECLINE they did not
// mean, from the same page, while it is still open.
//
// Guarded by the signed token ../decline hands back (see lib/quoteRevert.ts):
// it names the proposal, the action and the status to put back. Without a
// valid token there is nothing here to call.
//
// AN ACCEPTANCE IS FINAL FOR THE CLIENT (owner, 2026-09-23). ../accept no
// longer hands back a token, and an accept claim — however it was made, a
// token from before the change included — is refused here with 403 before
// anything is read or written. Undoing an acceptance is the contractor's
// call, in the dashboard (updateProposalStatus), with its own activity.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await ctx.params;
  const gate = await rateLimitShared(`quote-respond:${ipFromRequest(req)}`, 20, HOUR);
  if (!gate.ok) return NextResponse.json({ error: "Too many requests — try again later." }, { status: 429 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const claim = verifyRevert((body as { token?: unknown })?.token);
  if (!claim) return NextResponse.json({ error: "This change can no longer be reverted." }, { status: 403 });
  if (claim.a !== "decline") {
    return NextResponse.json({ error: "An acceptance can't be taken back from this page — contact the contractor." }, { status: 403 });
  }

  const proposal = await db.proposal.findUnique({
    where: { publicId },
    include: { client: true, organization: { select: { deletedAt: true, name: true, logoUrl: true, phone: true } } },
  });
  if (!proposal || proposal.organization.deletedAt || proposal.id !== claim.p) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The token says what was done; the row must still say the same thing.
  if (proposal.status !== "DECLINED") {
    // Already put back (double tap, two tabs): idempotent.
    if (proposal.status === claim.prev) return NextResponse.json({ ok: true, alreadyReverted: true });
    return NextResponse.json({ error: "This proposal has changed since — reload the page." }, { status: 409 });
  }

  // Only ever back to an OPEN state. `prev` is whatever the row held before the
  // click (SENT / VIEWED / …); anything settled-looking is refused outright so
  // a forged-looking claim cannot promote a proposal.
  const prev = ["SENT", "VIEWED", "DRAFT"].includes(claim.prev) ? claim.prev : "VIEWED";

  await db.proposal.update({
    where: { id: proposal.id },
    data: { status: prev, declinedAt: null },
  });

  const ip = ipFromRequest(req);
  await db.activityEvent.create({
    data: {
      organizationId: proposal.organizationId,
      proposalId: proposal.id,
      clientId: proposal.clientId,
      kind: "REVERTED",
      summary: `${proposal.client?.name ?? "Client"} took back their decline`,
      meta: JSON.stringify({ action: "decline", restored: prev, ip }),
    },
  });

  // The office already got the "declined" email; it must get this one too, or
  // the earlier one stands as the last word. Gated by the same preference as
  // the event it cancels.
  try {
    const appUrl = await appBaseUrl();
    await textOffice(proposal.organizationId, "proposal-declined", revertedLine(proposal.client?.name ?? "A client", proposal.title, "decline"), { alsoUserIds: [proposal.ownerId] });
    await sendToMembersByPref(
      proposal.organizationId,
      "proposal-declined",
      buildOwnerReverted({
        org: { id: proposal.organizationId, name: proposal.organization.name, logoUrl: proposal.organization.logoUrl, phone: proposal.organization.phone },
        clientName: proposal.client?.name ?? "A client",
        title: proposal.title,
        action: "decline",
        total: proposal.total,
        href: `${appUrl}/dashboard/proposals/${proposal.id}`,
      }),
    );
  } catch (err) {
    console.warn("[revert] office email failed", err);
  }

  return NextResponse.json({ ok: true, status: prev });
}
