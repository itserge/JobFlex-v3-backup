import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimitShared, ipFromRequest, HOUR } from "@/lib/rateLimit";
import { appBaseUrl } from "@/lib/appUrl";
import { sendToMembersByPref } from "@/lib/notificationPrefs";
import { textOffice } from "@/lib/sms/send";
import { fireTextRules, proposalContext } from "@/lib/sms/rulesEngine";
import { declinedLine } from "@/lib/sms/format";
import { buildOwnerDeclined } from "@/lib/email/build/operator";
import { signRevert } from "@/lib/quoteRevert";

// Public proposal decline. Mirrors ../accept, but a short note is REQUIRED so
// the contractor learns why. The note is recorded on the DECLINED ActivityEvent
// (no schema field — the activity trail is the record of record for this).
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
  const rawNote = (body as { note?: unknown })?.note;
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (!note) {
    return NextResponse.json({ error: "A note is required to decline." }, { status: 400 });
  }
  // Cap length defensively — this is an unauthenticated, public endpoint.
  const safeNote = note.slice(0, 2000);

  const proposal = await db.proposal.findUnique({
    where: { publicId },
    include: { client: true, organization: { select: { deletedAt: true, name: true, logoUrl: true, phone: true } } },
  });
  if (!proposal || proposal.organization.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Don't let a settled deal be flipped. Already-declined is idempotent.
  if (proposal.status === "ACCEPTED" || proposal.status === "PAID" || proposal.status === "COMPLETED") {
    return NextResponse.json(
      { error: "This proposal has already been accepted." },
      { status: 409 },
    );
  }
  if (proposal.status === "DECLINED") {
    return NextResponse.json({ ok: true, alreadyDeclined: true });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;

  // What the row said BEFORE, so a revert can put it back exactly.
  const prev = proposal.status;

  await db.proposal.update({
    where: { id: proposal.id },
    data: { status: "DECLINED", declinedAt: new Date() },
  });

  await db.activityEvent.create({
    data: {
      organizationId: proposal.organizationId,
      proposalId: proposal.id,
      clientId: proposal.clientId,
      kind: "DECLINED",
      summary: `${proposal.client?.name ?? "Client"} declined: ${safeNote}`,
      meta: JSON.stringify({ note: safeNote, ip }),
    },
  });

  // Office heads-up, gated by each member's "Proposal declined" email pref.
  try {
    const appUrl = await appBaseUrl();
    await textOffice(proposal.organizationId, "proposal-declined", declinedLine(proposal.client?.name ?? "A client", proposal.title, safeNote || null), { alsoUserIds: [proposal.ownerId] });
    await fireTextRules("proposal.declined", proposalContext(proposal.id, { note: safeNote }));
    await sendToMembersByPref(
      proposal.organizationId,
      "proposal-declined",
      buildOwnerDeclined({
        org: { id: proposal.organizationId, name: proposal.organization.name, logoUrl: proposal.organization.logoUrl, phone: proposal.organization.phone },
        clientName: proposal.client?.name ?? "A client",
        title: proposal.title,
        note: safeNote,
        total: proposal.total,
        href: `${appUrl}/dashboard/proposals/${proposal.id}`,
      }),
    );
  } catch (err) {
    console.warn("[decline] office email failed", err);
  }

  // The way back, for as long as the page stays open — see lib/quoteRevert.ts
  // and ../revert.
  const revertToken = signRevert({ p: proposal.id, a: "decline", prev, j: null });

  return NextResponse.json({ ok: true, revertToken });
}
