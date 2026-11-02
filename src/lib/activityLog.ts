// THE TRAIL (2026-09-24) — server module.
//
// Owner: "check all workers, managers and the others — does what they do
// reflect on the owner's side?" Before this, about six actions in ten changed
// data and wrote nothing: a manager's expense, a crew member's photo from the
// phone link, a sales rep's new client, an estimator's roof estimate. Every
// action writes here now, with the person on it, in one sentence the owner
// can read. Never throws: a trail that cannot be written must not fail the
// work it describes.
//
// `meta.jobId` ties a row to a job (ActivityEvent has no jobId column); the
// job page reads its timeline through it.

import { db } from "@/lib/db";
import type { WhoLike } from "@/lib/team/who";

/** The kinds this file adds. They are the trail, not the bell — the bell keeps its own list. */
export const TRAIL_KINDS = {
  ESTIMATE: "ESTIMATE",
  CLIENT: "CLIENT",
  APPOINTMENT: "APPOINTMENT",
  JOB: "JOB",
  PHOTO: "PHOTO",
  EXPENSE: "EXPENSE",
  MATERIALS: "MATERIALS",
  PAY: "PAY",
  STOCK: "STOCK",
  PROJECT: "PROJECT",
  TEAM: "TEAM",
  SETTINGS: "SETTINGS",
  FOLLOW_UP: "FOLLOW_UP",
  // HVAC services (2026-10-18, lib/serviceDeskBook): a reminder the contractor set (open, then done), a plan
  // tied to the proposal or project it belongs to, the desk's reminder settings. Rung later — never at once.
  SERVICE_REMINDER: "SERVICE_REMINDER",
  SERVICE_REMINDER_DONE: "SERVICE_REMINDER_DONE",
  SERVICE_LINK: "SERVICE_LINK",
  SERVICE_PREFS: "SERVICE_PREFS",
  // SmartBook (2026-10-31, lib/smartbook): every text and email it sends a lead, and every reply — the lead's
  // conversation, not the bell. What needs the company (a time to confirm, a hand-off) is SMARTBOOK_ASK, which rings.
  SMARTBOOK: "SMARTBOOK",
} as const;
export type TrailKind = (typeof TRAIL_KINDS)[keyof typeof TRAIL_KINDS];

/** Kinds that belong in the trail only, never in the notification bell. */
export const TRAIL_ONLY = new Set<string>(Object.values(TRAIL_KINDS));

export type LogActivityInput = {
  organizationId: string;
  /** The member who did it; null for the system or a client. */
  actorId: string | null | undefined;
  kind: string;
  /** One sentence, the object named: "Added a $240 expense to Roof replacement — dumpster". */
  summary: string;
  proposalId?: string | null;
  clientId?: string | null;
  leadId?: string | null;
  /** Extra facts; `jobId` ties the row to a job, `amount` to money. */
  meta?: Record<string, unknown> | null;
};

export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await db.activityEvent.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorId ?? null,
        kind: input.kind,
        summary: input.summary.slice(0, 500),
        proposalId: input.proposalId ?? null,
        clientId: input.clientId ?? null,
        leadId: input.leadId ?? null,
        meta: input.meta && Object.keys(input.meta).length ? JSON.stringify(input.meta) : null,
      },
    });
  } catch {
    /* the trail never fails the work */
  }
}

export type Actor = { id: string; name: string; role: string | null };

/** Every member of the organization by user id — name and role, for the marks. */
export async function actorsOf(organizationId: string): Promise<Map<string, Actor>> {
  try {
    const rows = await db.membership.findMany({
      where: { organizationId },
      select: { userId: true, role: true, user: { select: { id: true, name: true, email: true } } },
    });
    return new Map(rows.map((m) => [m.userId, { id: m.userId, name: m.user?.name?.trim() || m.user?.email || "Member", role: m.role }]));
  } catch {
    return new Map();
  }
}

/** `meta.jobId` of a row, when it has one. */
export function jobIdOf(meta: string | null | undefined): string | null {
  if (!meta) return null;
  try {
    const m = JSON.parse(meta) as { jobId?: unknown };
    return typeof m.jobId === "string" ? m.jobId : null;
  } catch {
    return null;
  }
}

/** Kinds a client causes from the public portal — no member on them, so the
 *  mark says "Client" rather than "System". Everything else without an actor
 *  is the system's own doing (the daily stock check, a webhook, a cron). */
const CLIENT_KINDS = new Set(["VIEWED", "ACCEPTED", "DECLINED", "CO_APPROVED", "CO_DECLINED", "PAYMENT_RECEIVED"]);

export const CLIENT_WHO: WhoLike = { id: null, name: "Client", role: null };

/**
 * Who a trail row belongs to, for the marks. A member found in `actors` is
 * that member; an actor who has since left the org keeps their color by id;
 * a portal kind with no actor is the client; anything else is null — the
 * renderer draws the System mark (or, in the bell, no mark at all).
 */
export function whoOfEvent(e: { actorId: string | null; kind: string }, actors: Map<string, Actor>): WhoLike | null {
  if (e.actorId) return actors.get(e.actorId) ?? { id: e.actorId, name: "Former member", role: null };
  return CLIENT_KINDS.has(e.kind) ? CLIENT_WHO : null;
}
