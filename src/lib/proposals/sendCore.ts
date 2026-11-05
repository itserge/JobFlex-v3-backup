import "server-only";
// SENDING A PROPOSAL TO THE CLIENT, WITHOUT A BROWSER SESSION (2026-11-04).
// The body of actions/proposals sendProposal, moved here so the JobFlex
// Assistant (lib/assistant) sends exactly what the Send button sends. The
// action keeps its guard (requireProposalStaff) and passes who it is; the
// Assistant passes the person it acts for. Nothing here reads a cookie or the
// session: limits are asked with the actor, and revalidatePath — which throws
// outside a request (a cron, an after()) — is best-effort.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { trackActivation } from "@/lib/activation-events";
import { logServerError } from "@/lib/server-events";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { findClientForLead } from "@/lib/leadClient";
import { snapshotProposal } from "@/lib/proposals/snapshot";

/** Who a send goes to, typed at the send (owner, 2026-10-13). Both optional: a
 *  send with neither mails the client record's address, as it always did. */
export const sendToInput = z
  .object({
    email: z.string().trim().max(200).optional(),
    name: z.string().trim().max(120).optional(),
  })
  .optional();

export type SendTo = z.infer<typeof sendToInput>;

/** The person a send is made for. `proposalScope` narrows SALES / ESTIMATOR to
 *  their own proposals (lib/orgContext requireProposalStaff). */
export interface SendActor {
  organizationId: string;
  userId: string;
  proposalScope: { ownerId?: string };
}

/** Where it went: `to` null = marked sent, nothing mailed (no email on file, or
 *  email not configured here). */
export interface SendResult {
  ok: true;
  to: string | null;
  clientId: string | null;
  client: string | null;
}

function revalidate(paths: Array<string | null>) {
  for (const p of paths) {
    if (!p) continue;
    try {
      revalidatePath(p);
    } catch {
      /* outside a request: the next page load reads fresh anyway */
    }
  }
}

/**
 * THE ADDRESS TYPED AT THE SEND BECOMES THE CLIENT'S (owner, 2026-10-13: a roof
 * proposal had the email typed in, and Send said "no email on the client record"
 * with the box locked). The proposal email reads the CLIENT RECORD, so the typed
 * address is written there first:
 *   · a client on the proposal → its email is set (or corrected) to this one;
 *   · no client ("Unassigned") → the client the shop already has under this email,
 *     or a new one by the typed name — and the proposal is filed under it.
 * Returns the address the send now goes to.
 */
async function settleRecipient(
  ctx: { organizationId: string; userId: string },
  p: { id: string; title: string; address: string | null; client: { id: string; name: string; email: string | null; deletedAt: Date | null } | null },
  to: { email: string; name: string },
): Promise<{ clientId: string; name: string }> {
  const email = to.email.trim();
  if (!z.string().email().safeParse(email).success) {
    throw new Error("That email address doesn't look right — check it and send again.");
  }
  if (p.client && !p.client.deletedAt) {
    if ((p.client.email ?? "").trim().toLowerCase() !== email.toLowerCase()) {
      await db.client.update({ where: { id: p.client.id }, data: { email } });
      await logActivity({
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        kind: TRAIL_KINDS.CLIENT,
        summary: `Set ${p.client.name}'s email to ${email} (sending "${p.title}")`,
        clientId: p.client.id,
        meta: { field: "email", from: "proposal-send" },
      });
    }
    return { clientId: p.client.id, name: p.client.name };
  }
  const known = await findClientForLead(ctx.organizationId, { email, phone: null });
  let client: { id: string; name: string };
  if (known) {
    client = { id: known.id, name: known.name };
  } else {
    const name = to.name.trim();
    if (!name) throw new Error("Add the client's name — this proposal has no client yet.");
    await enforcePlanLimit(ctx.organizationId, "clients", 1, { actorId: ctx.userId });
    client = await db.client.create({
      data: { organizationId: ctx.organizationId, name, email, address: p.address?.trim() || null },
      select: { id: true, name: true },
    });
    await logActivity({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      kind: TRAIL_KINDS.CLIENT,
      summary: `Added client ${client.name} (${email}) while sending "${p.title}"`,
      clientId: client.id,
      meta: { from: "proposal-send" },
    });
  }
  await db.proposal.update({ where: { id: p.id }, data: { clientId: client.id } });
  return { clientId: client.id, name: client.name };
}

export async function sendProposalAs(actor: SendActor, id: string, to?: SendTo): Promise<SendResult> {
  const { organizationId, userId, proposalScope } = actor;
  let p = await db.proposal.findFirst({
    where: { id, organizationId, ...proposalScope },
    include: { client: true },
  });
  if (!p) throw new Error("Not found");
  if (to?.email?.trim()) {
    await settleRecipient({ organizationId, userId }, p, { email: to.email, name: to.name ?? "" });
    p = await db.proposal.findFirst({ where: { id, organizationId }, include: { client: true } });
    if (!p) throw new Error("Not found");
  }

  // Send the client email FIRST — only record the proposal as SENT if it
  // actually went out (with the transport retry from emailRetry.ts). If the
  // provider fails after retries, notifyProposalSent throws: we surface a clear
  // error to the contractor and never write a false "Sent" status/activity.
  // Note: when email is not configured, or the client has no email on file,
  // notifyProposalSent returns { skipped } instead of throwing, so dev/no-email
  // setups still mark the proposal SENT exactly as before.
  try {
    const { notifyProposalSent } = await import("@/lib/notify");
    await notifyProposalSent({ proposalId: id });
  } catch (err) {
    // Not marking SENT. The contractor gets the friendly line; the cause goes to the log.
    logServerError("proposals.sendProposal:email", err, { kind: "action", organizationId });
    throw new Error(
      "Couldn't send the proposal email. Please check the client's email address and try again.",
    );
  }

  // A send again never undoes what the client did (2026-10-23): one they have opened stays VIEWED, and a signed
  // contract keeps its status — the menu's Send to client used to turn an accepted proposal back into SENT.
  const signed = p.status === "ACCEPTED" || p.status === "COMPLETED" || p.status === "PAID";
  const keep = signed || p.status === "VIEWED";
  await db.proposal.update({
    where: { id },
    data: keep ? { sentAt: new Date() } : { status: "SENT", sentAt: new Date() },
  });
  await snapshotProposal(id, "sent");
  // A re-send of an already sent proposal is not a second activation.
  if (!p.sentAt) trackActivation("proposal_sent", organizationId);
  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: userId,
      proposalId: id,
      clientId: p.clientId,
      kind: "SENT",
      summary: `Sent "${p.title}" to ${p.client?.name ?? p.client?.email ?? "client"}`,
    },
  });

  // Follow-up scheduling stays best-effort — it must never undo a confirmed send. A signed contract sent
  // again is a copy for the client's records, not an offer to chase.
  if (!signed) {
    try {
      const { scheduleFollowUpsFor } = await import("@/lib/followUps/engine");
      await scheduleFollowUpsFor(id, "SENT");
    } catch (err) {
      console.warn("[sendProposal] schedule failed:", err);
    }
  }

  revalidate(["/dashboard/proposals", `/dashboard/proposals/${id}`, p.clientId ? `/dashboard/clients/${p.clientId}` : null]);
  // Where it went, so the screen can say it: null = marked sent, nothing mailed.
  return { ok: true, to: p.client?.email ?? null, clientId: p.clientId, client: p.client?.name ?? null };
}
