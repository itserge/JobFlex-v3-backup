import "server-only";
// WHO THE ASSISTANT ACTS FOR, AND WHAT THEY MAY DO (2026-11-04). The same
// rules the dashboard's own guards apply (lib/orgContext), asked of a person
// the Assistant resolved itself — from the session in the app, from a linked
// phone by text — so a phone path is never wider than the buttons. The role is
// re-read from the membership on every turn; a platform admin reads as a
// manager (lib/fullAccess), as everywhere else.
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/orgContext";
import { accessRole, hasFullAccess } from "@/lib/fullAccess";
import { isPageLocked, requirePage } from "@/lib/customPageAccess";
import { isTrialWriteLocked } from "@/lib/trialState";
import { assistantOpenFor } from "@/lib/assistant/open";
import type { AssistantChannel } from "@/lib/assistant/shared";
import { ownProposalsOnly, roleAllows, type Capability } from "@/lib/assistant/roles";

export type { Capability } from "@/lib/assistant/roles";

export interface AssistantActor {
  organizationId: string;
  userId: string;
  /** The role every rule reads (a platform admin's seat reads as a manager). */
  role: string;
  channel: AssistantChannel;
  timezone: string;
  orgName: string;
  userName: string;
}

/** The person signed in to the app, as the Assistant sees them. */
export async function actorForSession(): Promise<AssistantActor> {
  const ctx = await requireOrg();
  return withNames({ organizationId: ctx.organizationId, userId: ctx.user.id, role: ctx.role, channel: "app" });
}

/** A member of a company, by ids (the phone and voice paths) — the membership
 *  re-read now, so a removed or demoted member is refused or narrowed at once. */
export async function actorFor(organizationId: string, userId: string, channel: AssistantChannel): Promise<AssistantActor | null> {
  const seat = await db.membership.findFirst({
    where: { organizationId, userId, organization: { deletedAt: null } },
    select: { role: true },
  });
  if (!seat) return null;
  const full = await hasFullAccess(organizationId, userId);
  return withNames({ organizationId, userId, role: accessRole(seat.role, full) ?? seat.role, channel });
}

async function withNames(a: Omit<AssistantActor, "timezone" | "orgName" | "userName">): Promise<AssistantActor> {
  const [org, user] = await Promise.all([
    db.organization.findUnique({ where: { id: a.organizationId }, select: { name: true, timezone: true } }),
    db.user.findUnique({ where: { id: a.userId }, select: { name: true, email: true } }),
  ]);
  return {
    ...a,
    timezone: org?.timezone || "America/New_York",
    orgName: org?.name ?? "your company",
    userName: (user?.name ?? "").trim() || (user?.email ?? "").split("@")[0] || "there",
  };
}

/** SALES and ESTIMATOR see and send only their own proposals (requireProposalStaff). */
export function proposalScope(actor: AssistantActor): { ownerId?: string } {
  return ownProposalsOnly(actor.role) ? { ownerId: actor.userId } : {};
}

/** The plan page a capability rides on (locked page = refused); the registry shows it. */
export const PAGE_OF: Partial<Record<Capability, "calendar" | "workers">> = {
  "schedule.read": "calendar",
  "schedule.write": "calendar",
  "crew.read": "workers",
  "crew.text": "workers",
};

/** Who has the Assistant yet (lib/assistant/open), asked once per actor. */
const openFor = new WeakMap<AssistantActor, Promise<boolean>>();

/** THE AI OPERATOR IS A PAID FEATURE (owner, 2026-11-09; lib/customPlan PAID_FEATURES): every live plan and a
 *  trial open it, the Free plan pauses it. Asked as the actor's own user, so a platform admin's linked phone is
 *  open as their session is (lib/fullAccess), and a text or a cron with no session is answered by the plan. */
export const OPERATOR_PAUSED = "The AI Operator isn't on the Free plan. Choose a plan on Subscription to turn it back on — your conversations and tasks are kept.";

export async function operatorPaused(actor: Pick<AssistantActor, "organizationId" | "userId">): Promise<boolean> {
  return isPageLocked(actor.organizationId, "operator", { as: actor.userId });
}

/** For an action that changes the Operator's own settings: throws the plan's refusal (lib/customPageAccess). */
export async function requireOperator(actor: Pick<AssistantActor, "organizationId" | "userId">): Promise<void> {
  await requirePage(actor.organizationId, "operator", { as: actor.userId });
}

/** Why this person may not do it, in their words — or null when they may. */
export async function refusal(actor: AssistantActor, need: Capability, writes: boolean): Promise<string | null> {
  let open = openFor.get(actor);
  if (!open) {
    open = assistantOpenFor(actor.userId);
    openFor.set(actor, open);
  }
  if (!(await open)) return "The JobFlex AI Operator is coming soon to your account.";
  if (!roleAllows(actor.role, need)) {
    return actor.role === "INSTALLER"
      ? "The AI Operator is for the office. Your jobs and schedule are in your crew app."
      : "Your role in JobFlex doesn't allow that. Ask your owner or a manager.";
  }
  if (await operatorPaused(actor)) return OPERATOR_PAUSED;
  const page = PAGE_OF[need];
  if (page && (await isPageLocked(actor.organizationId, page, { as: actor.userId }))) {
    return `Your plan doesn't include the ${page === "calendar" ? "Calendar" : "Workers"} page.`;
  }
  if (writes && (await isTrialWriteLocked(actor.organizationId))) {
    return "Your trial has ended, so JobFlex is read-only until a card is added (Settings → Billing).";
  }
  return null;
}
