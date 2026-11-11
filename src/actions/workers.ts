"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { isOwnerRole, requireManager, requireOrg } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { enforcePlanLimit, isManagerEquivalentRole } from "@/lib/limitsEngine";
import { appBaseUrl } from "@/lib/appUrl";
import { AssignmentStatus, Role, roleLabel } from "@/lib/prismaEnums";
import { auth, signIn } from "@/lib/auth";
import { enforceRateLimit, clientIp, HOUR } from "@/lib/rateLimit";
import { afterResponse } from "@/lib/server-events";
import { sendText } from "@/lib/sms/send";
import { welcomeText } from "@/lib/sms/format";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { requirePage } from "@/lib/customPageAccess";

const inviteInput = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  // Field worker vs office staff. Drives the org membership role (and thus the
  // restricted-vs-full dashboard via isWorkerRole). Defaults to INSTALLER.
  role: z.enum(["INSTALLER", "SALES", "ESTIMATOR", "MANAGER"]).default("INSTALLER"),
  phone: z.string().optional().nullable(),
  /** Text their schedule to that phone (2026-09-24). */
  smsOptIn: z.boolean().optional(),
  specialties: z.array(z.string()).default([]),
  hourlyRate: z.number().optional().nullable(),
});

/** The welcome text with the STOP line — the consent a work number gets. */
async function welcomeByText(organizationId: string, phone: string | null | undefined): Promise<void> {
  if (!phone) return;
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  await sendText({ organizationId, to: phone, body: welcomeText(org?.name ?? null), kind: "welcome" });
}

/** A refusal the manager must read: thrown inside the invite, returned to the
 *  page by createWorkerInvite. A thrown server-action message is redacted in
 *  production (a generic 500 in the browser), so these never leave as throws. */
class InviteRefusal extends Error {}

export type WorkerInviteResult =
  | { ok: true; id: string; token: string; emailSent: boolean; emailError: string | null }
  | { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: string };

/**
 * Invite a crew member. Refusals (your own email, an already-joined worker, an
 * office account, crew of another company) and a reached plan limit come back
 * as `{ ok: false }` with the words to show — in production a throw reached the
 * browser as a bare 500 and the manager never learned why (2026-09-26).
 */
export async function createWorkerInvite(raw: unknown): Promise<WorkerInviteResult> {
  try {
    return { ok: true, ...(await inviteWorker(raw)) };
  } catch (err) {
    if (err instanceof InviteRefusal) return { ok: false, error: err.message };
    if (err instanceof Error && (err as { code?: string }).code === "PLAN_LIMIT_REACHED") {
      return { ok: false, code: "PLAN_LIMIT_REACHED", error: err.message, resource: (err as { resource?: string }).resource };
    }
    throw err;
  }
}

async function inviteWorker(raw: unknown) {
  const { organizationId, user: inviter } = await requireManager();
  await requirePage(organizationId, "workers");
  const data = inviteInput.parse(raw);

  // Manager seats are plan-metered (owner's call, 2026-08-31): the crew flow
  // writes the membership at invite time, so the seat is charged here.
  if (isManagerEquivalentRole(data.role)) {
    await enforcePlanLimit(organizationId, "managers");
  }

  // Gate on the absolute "workers" seat limit. Only count it against the plan
  // when this invite would add a NEW seat (re-inviting an existing worker in
  // this org must not be blocked just because the org is at its cap).
  const existingUserForLimit = await db.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  const alreadyAWorker = existingUserForLimit
    ? await db.workerProfile.findFirst({
        where: { organizationId, userId: existingUserForLimit.id },
        select: { id: true, inviteStatus: true },
      })
    : null;
  // Never let a re-invite clobber an already-onboarded worker: re-sending would
  // reset them to PENDING and allow acceptWorkerInvite to set a NEW password —
  // an account-takeover path. Managers must Edit or Remove instead.
  if (alreadyAWorker?.inviteStatus === "ACCEPTED") {
    throw new InviteRefusal("That worker has already joined. Use Edit or Remove instead.");
  }
  // The absolute "workers" seat cap, charged only when this invite adds a
  // seat. The comment above promised this since 2026-07; the call was missing
  // and the ledger's client-side pre-flight was the only thing holding it.
  if (!alreadyAWorker) {
    await enforcePlanLimit(organizationId, "workers");
  }

  // SELF / OFFICE-STAFF GUARD. The membership upsert below takes its UPDATE
  // branch for any user who already holds a seat in this org — and that update
  // OVERWRITES their role with the invited one. A manager who typed their own
  // email (or an office teammate's) demoted that OWNER/MANAGER seat to
  // INSTALLER on the spot: the very next request resolved the session against
  // the rewritten membership and locked them into the restricted worker
  // dashboard. It also left a live PENDING invite token that could re-set the
  // account's password via acceptWorkerInvite. Only a user with no existing
  // seat here — or an existing crew member being re-invited — may pass.
  // The self-check sits OUTSIDE the `!alreadyAWorker` narrowing on purpose: a
  // manager who already carries a PENDING crew record here (left behind by the
  // old buggy path, or by a seed) would otherwise skip both guards and demote
  // their own seat by re-inviting themselves.
  if (existingUserForLimit?.id === inviter.id) {
    throw new InviteRefusal("That's your own email address — you can't invite yourself to the crew.");
  }
  if (existingUserForLimit && !alreadyAWorker) {
    const officeSeat = await db.membership.findUnique({
      where: {
        userId_organizationId: { userId: existingUserForLimit.id, organizationId },
      },
      select: { role: true },
    });
    if (officeSeat) {
      throw new InviteRefusal(
        `${data.email} already has a ${roleLabel(officeSeat.role)} account in this company. ` +
          "Inviting them as a crew member would overwrite that access — change their role instead.",
      );
    }
  }

  // CROSS-TENANT GUARD. `WorkerProfile.userId` is @unique — one crew record per
  // PERSON, not per person-per-company — and the upsert below keys on userId
  // alone. So inviting someone who already crews for a different contractor
  // took the UPDATE branch: it overwrote that company's displayName, phone,
  // rate and specialties, reset their accepted status to PENDING, and left
  // `organizationId` pointing at the OLD org. The invitee then vanished from
  // the inviting company's roster (which filters by organizationId) while
  // quietly corrupting the other company's record, and accepting the invite
  // set their activeOrgId back to the old org — so they signed in and saw
  // someone else's jobs.
  //
  // Refusing is the honest answer until WorkerProfile is keyed on
  // (userId, organizationId); a person who genuinely crews for two contractors
  // needs that composite key, not this upsert.
  if (existingUserForLimit && !alreadyAWorker) {
    const elsewhere = await db.workerProfile.findFirst({
      where: { userId: existingUserForLimit.id, organizationId: { not: organizationId } },
      select: { organization: { select: { name: true } } },
    });
    if (elsewhere) {
      throw new InviteRefusal(
        `${data.email} is already on the crew at ${elsewhere.organization.name}. ` +
          "A person can only be a crew member of one company right now — remove them there first, " +
          "or invite them from a different email address.",
      );
    }
  }

  // Upsert a lightweight User (no password yet). The worker sets a password when
  // they accept the invite (see acceptWorkerInvite).
  const existing = await db.user.findUnique({ where: { email: data.email } });
  const user =
    existing ??
    (await db.user.create({
      data: {
        email: data.email,
        name: data.name,
      },
    }));

  // Membership — the org seat + permission level. The chosen role decides whether
  // this person is a field worker (INSTALLER → restricted) or office staff.
  await db.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId } },
    update: { role: data.role },
    create: { userId: user.id, organizationId, role: data.role },
  });

  // WorkerProfile (unique per user). Every invite — new or re-sent — starts
  // PENDING so the roster shows "in progress" and the magic link lands on the
  // accept/decline gate until the worker responds.
  const profile = await db.workerProfile.upsert({
    where: { userId: user.id },
    update: {
      displayName: data.name,
      phone: data.phone ?? null,
      specialties: JSON.stringify(data.specialties),
      hourlyRate: data.hourlyRate ?? null,
      smsOptIn: data.smsOptIn ?? undefined,
      ...(data.smsOptIn ? { smsOptedInAt: new Date() } : {}),
      inviteStatus: "PENDING",
      respondedAt: null,
    },
    create: {
      userId: user.id,
      organizationId,
      displayName: data.name,
      phone: data.phone ?? null,
      specialties: JSON.stringify(data.specialties),
      hourlyRate: data.hourlyRate ?? null,
      smsOptIn: data.smsOptIn ?? false,
      smsOptedInAt: data.smsOptIn ? new Date() : null,
      token: randomUUID(),
      inviteStatus: "PENDING",
    },
  });
  if (data.smsOptIn && data.phone) afterResponse(() => welcomeByText(organizationId, data.phone));

  // Invite email (the link doubles as the manual shareable link).
  //
  // The send used to be swallowed by a bare `console.warn` and the action
  // returned success either way, so a manager saw "invited" for a worker whose
  // invite never left the building. The outcome is reported back instead: the
  // profile is created regardless (the link still works by hand), but the UI
  // is told, in words, that the email did not go.
  let emailSent = false;
  let emailError: string | null = null;
  try {
    const { sendEmail, isEmailEnabled } = await import("@/lib/sdk/resend");
    const { renderEmail } = await import("@/lib/email/renderEmail");
    const { buildWorkerInvite } = await import("@/lib/email/build/worker");
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, logoUrl: true, phone: true },
    });
    const appUrl = await appBaseUrl();
    const orgName = org?.name ?? "JobFlex";
    // Reflect the role the manager actually assigned (not a generic "crew member").
    const roleName = roleLabel(data.role).toLowerCase();
    const article = /^[aeiou]/i.test(roleName) ? "an" : "a";
    const { subject, html } = renderEmail(
      buildWorkerInvite({
        org: { id: organizationId, name: orgName, logoUrl: org?.logoUrl, phone: org?.phone },
        workerName: data.name,
        inviterName: inviter.name ?? null,
        roleLabel: `${article} ${roleName}`,
        href: `${appUrl}/w/${profile.token}`,
      }),
    );
    const res = await sendEmail({ mailClass: "transactional", to: data.email, subject, html });
    if (res?.skipped) {
      // No transport at all — sendEmail logs and returns a stub. Name the exact
      // variables, because the person reading this message is the one who can
      // set them.
      emailError = isEmailEnabled()
        ? "The invite email was not sent."
        : "No email transport is configured on this server, so the invite email was not sent. Set RESEND_API_KEY, or SMTP_HOST + SMTP_USER + SMTP_PASSWORD, then invite again.";
    } else {
      emailSent = true;
    }
  } catch (err) {
    console.warn("[createWorkerInvite] invite email failed:", err);
    const msg = err instanceof Error ? err.message.trim() : "";
    emailError = msg
      ? `The invite email could not be sent: ${msg}`
      : "The invite email could not be sent.";
  }

  revalidatePath("/dashboard/workers");
  await logActivity({
    organizationId,
    actorId: inviter.id,
    kind: TRAIL_KINDS.TEAM,
    summary: `Invited ${data.name} (${data.email}) to the crew as ${roleLabel(data.role).toLowerCase()}`,
    meta: { workerId: profile.id, email: data.email, role: data.role, emailSent },
  });
  return { id: profile.id, token: profile.token, emailSent, emailError };
}

// ── Worker invite response (token-gated, no session) ────────────────────────
// These run before the worker has a login, so they authenticate by the
// WorkerProfile.token carried in the magic link — never by session/role.

const acceptInput = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function acceptWorkerInvite(raw: unknown) {
  const { token, password } = acceptInput.parse(raw);
  await enforceRateLimit(`invite-accept:${await clientIp()}`, 20, HOUR, "attempts");
  const profile = await db.workerProfile.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true, hashedPassword: true } } },
  });
  // Require a still-open invite. One constant message for missing/declined/
  // already-accepted so a random token can't be probed for its state, and so a
  // stale link can never re-set the password of an onboarded worker.
  if (!profile || profile.inviteStatus !== "PENDING") {
    throw new Error("This invite link is no longer valid.");
  }

  // ACCOUNT-TAKEOVER GUARD. The invite token proves the inviter typed this
  // email — it does NOT prove the acceptor owns the account behind it. If the
  // user already has a password (an owner/manager of another company, or any
  // self-registered user), a manager elsewhere could invite that address, read
  // the token off their own roster, and "accept" with a new password: full
  // takeover of the victim's login and every org they belong to. So a
  // password-bearing account is only joined by its own signed-in session; the
  // token alone never rewrites a password.
  const hasPassword = Boolean(profile.user?.hashedPassword);
  if (hasPassword) {
    const session = await auth();
    if (!session?.user?.id || session.user.id !== profile.userId) {
      throw new Error(
        `This email already has a JobFlex account. Sign in as ${profile.user?.email ?? "that account"} first, then open the invite link again.`,
      );
    }
    await db.user.update({
      where: { id: profile.userId },
      data: { activeOrgId: profile.organizationId },
    });
  } else {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.user.update({
      where: { id: profile.userId },
      data: {
        hashedPassword,
        // Make their company the active org so the session resolves correctly.
        activeOrgId: profile.organizationId,
        // New credential epoch: any token issued before this password existed
        // is invalidated (same rule as the password-reset flow).
        credentialVersion: { increment: 1 },
      },
    });
  }
  await db.workerProfile.update({
    where: { id: profile.id },
    data: { inviteStatus: "ACCEPTED", respondedAt: new Date() },
  });

  // Heads-up for the office (drives the activity feed + notification bell).
  await db.activityEvent.create({
    data: {
      organizationId: profile.organizationId,
      actorId: profile.userId,
      kind: "ACCEPTED",
      summary: `${profile.displayName} accepted your crew invite`,
    },
  });

  revalidatePath("/dashboard/workers");

  // Auto-authorize: establish the session and land on the dashboard in THIS same
  // server step (right after the password write, one request). Signing in here —
  // instead of having the client do a separate sign-in afterward — avoids the
  // worker being bounced to the login screen for a second sign-in. On success
  // NextAuth redirects; on failure it throws (the client shows the error and the
  // already-created account can still log in normally).
  const email = profile.user?.email;
  if (email && !hasPassword) {
    await signIn("credentials", { email, password, redirectTo: "/dashboard/jobs" });
  }
  return { email: email ?? null };
}

export async function declineWorkerInvite(token: string) {
  const profile = await db.workerProfile.findUnique({ where: { token } });
  if (!profile) return { ok: true };
  if (profile.inviteStatus === "ACCEPTED") {
    // Already onboarded — don't let a stale link revoke an active worker.
    return { ok: true };
  }
  await db.workerProfile.update({
    where: { id: profile.id },
    data: { inviteStatus: "DECLINED", respondedAt: new Date() },
  });
  await db.activityEvent.create({
    data: {
      organizationId: profile.organizationId,
      actorId: profile.userId,
      kind: "UPDATED",
      summary: `${profile.displayName} declined your crew invite`,
    },
  });
  revalidatePath("/dashboard/workers");
  return { ok: true };
}

const updateWorkerInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(["INSTALLER", "SALES", "ESTIMATOR", "MANAGER"]).optional(),
  phone: z.string().optional().nullable(),
  smsOptIn: z.boolean().optional(),
  specialties: z.array(z.string()).default([]),
  hourlyRate: z.number().optional().nullable(),
});

// Edit an existing worker's profile (name, phone, specialties, rate). Email is
// the worker's login identity and is intentionally not editable here.
export async function updateWorker(raw: unknown) {
  const { organizationId, user, role: actorRole } = await requireManager();
  await requirePage(organizationId, "workers");
  let previousRole: string | null | undefined;
  const data = updateWorkerInput.parse(raw);
  const w = await db.workerProfile.findUnique({ where: { id: data.id } });
  if (!w || w.organizationId !== organizationId) throw new Error("Not found");
  await db.workerProfile.update({
    where: { id: data.id },
    data: {
      displayName: data.name,
      phone: data.phone ?? null,
      specialties: JSON.stringify(data.specialties),
      hourlyRate: data.hourlyRate ?? null,
      smsOptIn: data.smsOptIn ?? undefined,
      ...(data.smsOptIn && !w.smsOptIn ? { smsOptedInAt: new Date() } : {}),
    },
  });
  // Turned on, or a new phone with it on: the welcome text with the STOP line.
  if (data.smsOptIn && data.phone && (!w.smsOptIn || w.phone !== data.phone)) afterResponse(() => welcomeByText(organizationId, data.phone));
  // A role change writes to the membership (the org seat / permission level).
  // Guard the last owner so a role edit can't lock an org out of its own admin.
  if (data.role) {
    const current = await db.membership.findUnique({
      where: { userId_organizationId: { userId: w.userId, organizationId } },
    });
    // data.role is always a worker role (never OWNER), so changing an owner here
    // is always a demotion — only an owner may do that (mirrors team.ts), and
    // never to the last one.
    previousRole = current?.role;
    if (current?.role === Role.OWNER) {
      if (!isOwnerRole(actorRole)) {
        throw new Error("Only the owner can change an owner's role.");
      }
      const owners = await db.membership.count({ where: { organizationId, role: Role.OWNER } });
      if (owners <= 1) throw new Error("Can't change the last owner's role.");
    }
    // Promoting into a manager seat consumes one from the plan's meter.
    if (isManagerEquivalentRole(data.role) && !isManagerEquivalentRole(current?.role)) {
      await enforcePlanLimit(organizationId, "managers");
    }
    await db.membership.updateMany({
      where: { userId: w.userId, organizationId },
      data: { role: data.role },
    });
  }
  revalidatePath("/dashboard/workers");
  revalidatePath(`/dashboard/workers/${data.id}`);
  {
    const changes: string[] = [];
    if (data.name !== w.displayName) changes.push(`renamed to ${data.name}`);
    if ((data.phone ?? null) !== (w.phone ?? null)) changes.push("phone");
    if ((data.hourlyRate ?? null) !== (w.hourlyRate ?? null)) changes.push(data.hourlyRate != null ? `rate $${data.hourlyRate}/hr` : "rate cleared");
    if (JSON.stringify(data.specialties) !== (w.specialties ?? "[]")) changes.push("specialties");
    if (data.smsOptIn !== undefined && data.smsOptIn !== w.smsOptIn) changes.push(data.smsOptIn ? "texts on" : "texts off");
    if (data.role && data.role !== previousRole) changes.push(`role ${roleLabel(data.role)}`);
    await logActivity({
      organizationId,
      actorId: user.id,
      kind: TRAIL_KINDS.TEAM,
      summary:
        data.role && data.role !== previousRole && changes.length === 1
          ? `Changed ${w.displayName}'s role to ${roleLabel(data.role)}`
          : `Updated ${w.displayName}'s crew profile${changes.length ? ` — ${changes.join(", ")}` : ""}`,
      meta: { workerId: data.id, memberUserId: w.userId, changes, role: data.role ?? undefined, previousRole: previousRole ?? undefined },
    });
  }
  return { id: data.id };
}

export async function revokeWorker(workerId: string) {
  const { organizationId, user } = await requireManager();
  await requirePage(organizationId, "workers");
  const w = await db.workerProfile.findUnique({ where: { id: workerId } });
  if (!w || w.organizationId !== organizationId) throw new Error("Not found");

  // Rotate the magic-link token so the previous one is invalidated immediately
  await db.workerProfile.update({
    where: { id: workerId },
    data: { token: randomUUID() },
  });
  revalidatePath("/dashboard/workers");
  revalidatePath(`/dashboard/workers/${workerId}`);
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.TEAM,
    summary: `Revoked ${w.displayName}'s portal link (a new one was issued)`,
    meta: { workerId, memberUserId: w.userId },
  });
}

// Fully remove a worker from the company: delete their roster profile (which
// cascades their JobAssignments via the schema relation) and drop the org seat.
// We only delete the INSTALLER membership so an owner/admin who also happens to
// hold a worker profile is never locked out of their own org. The shared User
// record is left intact — they may belong to other organizations.
export async function removeWorker(workerId: string) {
  const { organizationId, user, role: actorRole } = await requireManager();
  await requirePage(organizationId, "workers");
  const w = await db.workerProfile.findUnique({ where: { id: workerId } });
  if (!w || w.organizationId !== organizationId) throw new Error("Not found");

  // Owner seats are owner-only to remove (mirrors team.ts removeMember), and
  // the last one is never removable.
  const membership = await db.membership.findUnique({
    where: { userId_organizationId: { userId: w.userId, organizationId } },
  });
  if (membership?.role === Role.OWNER) {
    if (!isOwnerRole(actorRole)) throw new Error("Only the owner can remove an owner.");
    const owners = await db.membership.count({ where: { organizationId, role: Role.OWNER } });
    if (owners <= 1) throw new Error("Can't remove the last owner.");
  }

  await db.workerProfile.delete({ where: { id: workerId } });
  // Drop the org seat regardless of role (the roster now holds any role).
  await db.membership.deleteMany({ where: { userId: w.userId, organizationId } });
  // A removed member must not keep pointing at this org from their JWT/DB.
  await db.user.updateMany({
    where: { id: w.userId, activeOrgId: organizationId },
    data: { activeOrgId: null },
  });

  revalidatePath("/dashboard/workers");
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.TEAM,
    summary: `Removed ${w.displayName} from the crew${membership ? ` (${roleLabel(membership.role).toLowerCase()})` : ""}`,
    meta: { workerId, memberUserId: w.userId, role: membership?.role ?? undefined },
  });
}

export async function assignWorker(jobId: string, workerId: string) {
  const { organizationId, user } = await requireManager();
  const [job, worker] = await Promise.all([
    db.job.findUnique({ where: { id: jobId } }),
    db.workerProfile.findUnique({ where: { id: workerId } }),
  ]);
  if (
    !job ||
    !worker ||
    job.organizationId !== organizationId ||
    worker.organizationId !== organizationId
  )
    throw new Error("Not found");

  // Re-assigning is a FRESH ASK (2026-08-22). The upsert used to no-op on an
  // existing row, so putting someone back on a job kept their old answer:
  // an earlier accept meant no new confirmation ever appeared (the owner
  // scheduled new work and the crew "didn't receive" anything), and an
  // earlier DECLINE made the worker permanently un-askable. Every call to
  // this action is a manager deliberately (re)adding someone — the ask
  // restarts: PENDING, stamped now, so the offers popup, the jobs badge and
  // the crew-confirmation ledger all treat it as new.
  const assignment = await db.jobAssignment.upsert({
    where: { jobId_workerId: { jobId, workerId } },
    update: { status: AssignmentStatus.PENDING, assignedAt: new Date(), pingedAt: null },
    create: {
      jobId,
      workerId,
      status: AssignmentStatus.PENDING,
    },
  });

  // Best-effort email + SMS notify to the worker
  try {
    const { notifyAssignmentCreated } = await import("@/lib/notify");
    await notifyAssignmentCreated(assignment.id);
  } catch (err) {
    console.warn("[assignWorker] notify failed:", err);
  }

  // The in-app trace. Assigning someone used to leave NONE — only the tray drop
  // and the team-view drop wrote one — so an assignment made from the calendar
  // sheet or the job record existed in the worker's inbox and in their email
  // and nowhere the office could see it afterwards. The bell feed reads
  // ActivityEvent, so without this row the assignment was invisible there.
  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      kind: "ASSIGNED",
      summary: `${worker.displayName} was assigned to "${job.title}"`,
      meta: JSON.stringify({ jobId, workerId, assignmentId: assignment.id }),
    },
  });

  // Keep the job's group chat in sync — add the newly-assigned worker (and the
  // manager) so they can message about this job.
  try {
    const { ensureJobConversation } = await import("@/lib/jobConversation");
    await ensureJobConversation({
      jobId,
      organizationId,
      title: job.title,
      userIds: [user.id, worker.userId],
    });
  } catch (err) {
    console.warn("[assignWorker] job chat sync failed:", err);
  }

  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath(`/dashboard/workers/${workerId}`);
}

export async function unassignWorker(assignmentId: string) {
  const { organizationId, user } = await requireManager();
  const a = await db.jobAssignment.findUnique({
    where: { id: assignmentId },
    include: { job: true, worker: { select: { displayName: true } } },
  });
  if (!a || a.job.organizationId !== organizationId) throw new Error("Not found");
  await db.jobAssignment.delete({ where: { id: assignmentId } });
  revalidatePath(`/dashboard/jobs/${a.jobId}`);
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.TEAM,
    summary: `Took ${a.worker.displayName} off ${a.job.title}`,
    proposalId: a.job.proposalId,
    clientId: a.job.clientId,
    meta: { jobId: a.jobId, workerId: a.workerId, assignmentId },
  });
}

// (removed) updateAssignmentStatus — was an unguarded "use server" export with
// no auth and no org scope, reachable as a POST endpoint to set an arbitrary
// status on any org's assignment. It had no callers; the worker-portal status
// change goes through /api/worker/assignment/[assignmentId], which validates the
// worker token binds to the assignment before writing. Deleted rather than
// guarded to remove the endpoint entirely.

// ── Inbox actions (owner-side) ──────────────────────────

export async function pingAssignment(assignmentId: string) {
  const { organizationId, user } = await requireManager();
  const a = await db.jobAssignment.findUnique({
    where: { id: assignmentId },
    include: { job: true, worker: { include: { user: { select: { email: true } } } } },
  });
  if (!a || a.job.organizationId !== organizationId) throw new Error("Not found");

  await db.jobAssignment.update({
    where: { id: assignmentId },
    data: { pingedAt: new Date() },
  });

  // Best-effort re-notify (email + SMS where configured)
  try {
    const { notifyAssignmentCreated } = await import("@/lib/notify");
    await notifyAssignmentCreated(assignmentId);
  } catch (err) {
    console.warn("[pingAssignment] notify failed:", err);
  }

  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      kind: "NOTE",
      summary: `Pinged ${a.worker.displayName} about "${a.job.title}"`,
    },
  });

  revalidatePath("/dashboard/calendar");
  revalidatePath(`/dashboard/jobs/${a.jobId}`);
}

export async function markAssignmentAccepted(assignmentId: string) {
  const { organizationId, user } = await requireManager();
  const a = await db.jobAssignment.findUnique({
    where: { id: assignmentId },
    include: { job: true, worker: true },
  });
  if (!a || a.job.organizationId !== organizationId) throw new Error("Not found");
  await db.jobAssignment.update({
    where: { id: assignmentId },
    data: { status: "ACCEPTED" },
  });
  // Same revive rule as a real accept: a job that fell to CANCELED because
  // everyone declined comes back to the schedule when someone is confirmed.
  // No office email here — the office is the one clicking.
  if (a.job.status === "CANCELED") {
    await db.job.update({ where: { id: a.job.id }, data: { status: "SCHEDULED" } });
  }
  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      kind: "ACCEPTED",
      summary: `${a.worker.displayName} marked accepted on "${a.job.title}"`,
    },
  });
  revalidatePath("/dashboard/calendar");
  revalidatePath(`/dashboard/jobs/${a.jobId}`);
}

export async function unassignAssignment(assignmentId: string) {
  const { organizationId, user } = await requireManager();
  const a = await db.jobAssignment.findUnique({
    where: { id: assignmentId },
    include: { job: true, worker: true },
  });
  if (!a || a.job.organizationId !== organizationId) throw new Error("Not found");
  await db.jobAssignment.delete({ where: { id: assignmentId } });
  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      kind: "UPDATED",
      summary: `Removed ${a.worker.displayName} from "${a.job.title}"`,
    },
  });
  revalidatePath("/dashboard/calendar");
  revalidatePath(`/dashboard/jobs/${a.jobId}`);
}

// ── Logged-in worker: job offers (2026-08-21) ────────────────────────────────
// The token portal (/w/[token]) already lets a link-only worker accept or
// decline, but a worker WITH a password is redirected off that portal to
// /dashboard/jobs — which until now had no way to answer an offer, so the
// email's "Confirm or decline" ended in a dead click. These two run on the
// session instead of the token: the offers feed drives the jobs page's offer
// popup (and its poll), and the response writes the same JobAssignment status
// the portal endpoints write.

export interface JobOffer {
  assignmentId: string;
  jobId: string;
  title: string;
  client: string | null;
  startsAt: string | null;
  endsAt: string | null;
  scope: string | null;
  assignedAt: string;
}

export async function myJobOffers(): Promise<JobOffer[]> {
  const { organizationId, user } = await requireOrg();
  const wp = await db.workerProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!wp) return [];
  const rows = await db.jobAssignment.findMany({
    where: {
      workerId: wp.id,
      status: "PENDING",
      job: { organizationId, status: { not: "CANCELED" } },
    },
    orderBy: { assignedAt: "desc" },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          scopeOfWork: true,
          client: { select: { name: true } },
        },
      },
    },
  });
  return rows.map((a) => ({
    assignmentId: a.id,
    jobId: a.jobId,
    title: a.job.title,
    client: a.job.client?.name ?? null,
    startsAt: a.job.startsAt?.toISOString() ?? null,
    endsAt: a.job.endsAt?.toISOString() ?? null,
    scope: a.job.scopeOfWork,
    assignedAt: a.assignedAt.toISOString(),
  }));
}

export async function respondToAssignment(assignmentId: string, response: "ACCEPTED" | "DECLINED") {
  if (response !== "ACCEPTED" && response !== "DECLINED") throw new Error("Invalid response");
  const { organizationId, user } = await requireOrg();
  const wp = await db.workerProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, displayName: true },
  });
  if (!wp) throw new Error("No crew profile on this account");
  const a = await db.jobAssignment.findUnique({
    where: { id: assignmentId },
    include: { job: { select: { id: true, title: true, status: true, organizationId: true } } },
  });
  // Own-assignment gate: the id arrives over the action wire, so ownership is
  // proven against the caller's worker profile, never trusted.
  if (!a || a.workerId !== wp.id || a.job.organizationId !== organizationId) {
    throw new Error("Not found");
  }
  if (a.status !== "PENDING") return { ok: true, status: a.status };
  await db.jobAssignment.update({ where: { id: a.id }, data: { status: response } });
  // Job transition + bell + office email — one shared consequence path for
  // every door an answer can come through (lib/assignmentResponse.ts).
  const { applyAssignmentResponse } = await import("@/lib/assignmentResponse");
  await applyAssignmentResponse({
    assignmentId: a.id,
    response,
    organizationId,
    actorUserId: user.id,
    workerDisplayName: wp.displayName,
    job: a.job,
  });
  revalidatePath("/dashboard/jobs");
  revalidatePath(`/dashboard/jobs/${a.job.id}`);
  revalidatePath("/dashboard/calendar");
  return { ok: true, status: response };
}
