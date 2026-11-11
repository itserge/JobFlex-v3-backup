"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireManager, requireUser, isOwnerRole, UnauthorizedError } from "@/lib/orgContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";

const roleLabel = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();
import { db } from "@/lib/db";
import { enforcePlanLimit, isManagerEquivalentRole } from "@/lib/limitsEngine";
import { appBaseUrl } from "@/lib/appUrl";
import { Role } from "@/lib/prismaEnums";
import { hashToken } from "@/lib/tokens";
import { enforceRateLimit, clientIp, HOUR } from "@/lib/rateLimit";
import { requireTeamRoles } from "@/lib/toolPlans/gates";

// Emails an invite magic link. The RAW token goes in the URL; only its hash is
// stored (see createInvite / resendInvite), so a DB leak yields no usable links.
async function sendInviteEmail(
  organizationId: string,
  email: string,
  role: string,
  rawToken: string,
  inviterLabel: string,
) {
  try {
    const { sendEmail } = await import("@/lib/sdk/resend");
    const { renderEmail } = await import("@/lib/email/renderEmail");
    const { buildTeamInvite } = await import("@/lib/email/build/worker");
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, logoUrl: true, phone: true },
    });
    const appUrl = await appBaseUrl();
    const orgName = org?.name ?? "JobFlex";
    const { subject, html } = renderEmail(
      buildTeamInvite({
        org: { id: organizationId, name: orgName, logoUrl: org?.logoUrl, phone: org?.phone },
        inviterName: inviterLabel,
        roleLabel: role.toLowerCase(),
        href: `${appUrl}/auth/invite/${rawToken}`,
      }),
    );
    await sendEmail({ to: email, subject, html });
  } catch (err) {
    console.warn("[invite] email failed:", err);
  }
}

const TEAM_ROLES = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "SALES",
  "ESTIMATOR",
  "INSTALLER",
  "ACCOUNTANT",
  "USER",
] as const;

const inviteInput = z.object({
  email: z.string().email(),
  role: z.enum(TEAM_ROLES),
});

export async function createInvite(raw: unknown) {
  const { organizationId, user, role: actorRole } = await requireManager();
  // Team roles are a size's on the new plans (Professional and up — lib/toolPlans/gates); open on every Classic plan.
  await requireTeamRoles(organizationId);
  const data = inviteInput.parse(raw);
  // Only an owner can mint another owner.
  if (data.role === "OWNER" && !isOwnerRole(actorRole)) {
    throw new UnauthorizedError("Only the owner can invite another owner");
  }
  // Manager seats are plan-metered (some plans sell none, others 1+). The
  // pending invite reserves the seat — see the "managers" counter. ADMIN /
  // ACCOUNTANT / USER are manager-equivalent and pay the same seat.
  if (isManagerEquivalentRole(data.role)) {
    await enforcePlanLimit(organizationId, "managers");
  }

  const email = data.email.toLowerCase().trim();

  // If the user already has a membership here, error
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    const m = await db.membership.findFirst({
      where: { userId: existing.id, organizationId },
    });
    if (m) throw new Error("That person is already on your team.");
  }
  // Office seats are plan-metered too (members + pending invites); the invite
  // reserves the seat, same as the manager meter above.
  await enforcePlanLimit(organizationId, "teamSeats");

  // The raw token lives only in the email/URL and the one-time return below; the
  // DB stores its sha256 hash (mirrors the password-reset flow).
  const rawToken = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

  const invite = await db.invite.create({
    data: {
      organizationId,
      email,
      role: data.role,
      token: hashToken(rawToken),
      invitedById: user.id,
      expiresAt,
    },
  });

  await sendInviteEmail(organizationId, email, data.role, rawToken, user.name ?? user.email ?? "A teammate");

  revalidatePath("/dashboard/settings/team");
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.TEAM,
    summary: `Invited ${email} to the team as ${roleLabel(data.role)}`,
    meta: { inviteId: invite.id, email, role: data.role },
  });
  // rawToken is returned once so the UI can show/copy the link right after
  // creation — it can never be recovered from the DB afterward (use resendInvite).
  return { id: invite.id, token: rawToken };
}

// Rotate + re-email an existing pending invite, returning a fresh raw link. This
// is how the team UI re-copies a link: the stored hash can't be turned back into
// a URL, so "copy" mints a new token (invalidating the previous one).
export async function resendInvite(inviteId: string) {
  const { organizationId, user } = await requireManager();
  const invite = await db.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.organizationId !== organizationId) throw new Error("Not found");
  if (invite.acceptedAt) throw new Error("This invite was already accepted.");

  const rawToken = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  await db.invite.update({
    where: { id: invite.id },
    data: { token: hashToken(rawToken), expiresAt },
  });

  await sendInviteEmail(organizationId, invite.email, invite.role, rawToken, user.name ?? user.email ?? "A teammate");

  revalidatePath("/dashboard/settings/team");
  return { token: rawToken };
}

export async function revokeInvite(id: string) {
  const { organizationId } = await requireManager();
  const invite = await db.invite.findUnique({ where: { id } });
  if (!invite || invite.organizationId !== organizationId) throw new Error("Not found");
  await db.invite.delete({ where: { id } });
  revalidatePath("/dashboard/settings/team");
}

export async function acceptInvite(token: string) {
  await enforceRateLimit(`invite-accept:${await clientIp()}`, 20, HOUR, "attempts");
  const invite = await db.invite.findUnique({ where: { token: hashToken(token) } });
  if (!invite) throw new Error("This invite doesn't exist or was revoked.");
  if (invite.acceptedAt) throw new Error("This invite was already accepted.");
  if (invite.expiresAt < new Date()) throw new Error("This invite has expired.");

  // Find or create the user
  let user = await db.user.findUnique({ where: { email: invite.email } });
  let requiresLogin = false;
  if (!user) {
    user = await db.user.create({
      data: {
        email: invite.email,
        name: invite.email.split("@")[0],
      },
    });
    requiresLogin = true;
  }

  // Create membership
  await db.membership.upsert({
    where: {
      userId_organizationId: { userId: user.id, organizationId: invite.organizationId },
    },
    update: { role: invite.role },
    create: {
      userId: user.id,
      organizationId: invite.organizationId,
      role: invite.role,
    },
  });

  await db.invite.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date() },
  });

  // Set active org if user doesn't have one
  if (!user.activeOrgId) {
    await db.user.update({
      where: { id: user.id },
      data: { activeOrgId: invite.organizationId },
    });
  }

  await db.activityEvent.create({
    data: {
      organizationId: invite.organizationId,
      actorId: user.id,
      kind: "CREATED",
      summary: `${user.name ?? user.email} joined the team as ${invite.role.toLowerCase()}`,
    },
  });

  revalidatePath("/dashboard/settings/team");
  return { ok: true, requiresLogin };
}

export async function declineInvite(token: string) {
  const invite = await db.invite.findUnique({ where: { token: hashToken(token) } });
  if (!invite) return { ok: true };
  await db.invite.delete({ where: { id: invite.id } });
  return { ok: true };
}

export async function updateMembershipRole(membershipId: string, role: string) {
  const { organizationId, user, role: actorRole } = await requireManager();
  const m = await db.membership.findUnique({ where: { id: membershipId }, include: { user: { select: { name: true, email: true } } } });
  if (!m || m.organizationId !== organizationId) throw new Error("Not found");
  if (!(TEAM_ROLES as readonly string[]).includes(role)) throw new Error("Invalid role");
  // A role change is a size's on the new plans (Professional and up — lib/toolPlans/gates); open on every Classic plan.
  if (m.role !== role) await requireTeamRoles(organizationId);
  // Owner seats are owner-managed: a manager can neither demote an owner nor
  // promote anyone into the owner role.
  if ((m.role === Role.OWNER || role === "OWNER") && !isOwnerRole(actorRole)) {
    throw new UnauthorizedError("Only the owner can change owner roles");
  }
  // Promoting INTO a manager-equivalent seat consumes one — same meter the
  // invite pays.
  if (isManagerEquivalentRole(role) && !isManagerEquivalentRole(m.role)) {
    await enforcePlanLimit(organizationId, "managers");
  }
  await db.membership.update({ where: { id: membershipId }, data: { role } });
  revalidatePath("/dashboard/settings/team");
  if (m.role !== role) {
    await logActivity({
      organizationId,
      actorId: user.id,
      kind: TRAIL_KINDS.TEAM,
      summary: `Changed ${m.user?.name?.trim() || m.user?.email || "a member"}'s role to ${roleLabel(role)}`,
      meta: { membershipId, memberUserId: m.userId, from: m.role, to: role },
    });
  }
}

export async function removeMember(membershipId: string) {
  const { organizationId, user, role: actorRole } = await requireManager();
  const m = await db.membership.findUnique({ where: { id: membershipId }, include: { user: { select: { name: true, email: true } } } });
  if (!m || m.organizationId !== organizationId) throw new Error("Not found");
  if (m.role === Role.OWNER && !isOwnerRole(actorRole)) {
    throw new UnauthorizedError("Only the owner can remove an owner");
  }
  // Prevent removing the last OWNER
  if (m.role === Role.OWNER) {
    const owners = await db.membership.count({
      where: { organizationId, role: Role.OWNER },
    });
    if (owners <= 1) throw new Error("Can't remove the last owner.");
  }
  await db.membership.delete({ where: { id: membershipId } });
  // A removed member must not keep this org as their active workspace — the
  // classic layout reads announcements/plan by activeOrgId straight off the
  // session, so a stale pointer leaked org-scoped chrome after removal.
  await db.user.updateMany({
    where: { id: m.userId, activeOrgId: organizationId },
    data: { activeOrgId: null },
  });
  revalidatePath("/dashboard/settings/team");
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.TEAM,
    summary: `Removed ${m.user?.name?.trim() || m.user?.email || "a member"} (${roleLabel(m.role)}) from the team`,
    meta: { membershipId, memberUserId: m.userId, role: m.role },
  });
}

export async function switchActiveOrg(organizationId: string) {
  const user = await requireUser();
  const m = await db.membership.findFirst({
    where: { userId: user.id, organizationId },
  });
  if (!m) throw new Error("You're not a member of that organization.");
  await db.user.update({
    where: { id: user.id },
    data: { activeOrgId: organizationId },
  });
  revalidatePath("/dashboard");
  return { ok: true };
}
