// NOTIFICATION PREFERENCES — the db-backed half. Types, the event list, the
// parser and the quiet-hours math are in ./notificationPrefsShared.ts (pure,
// safe for the client bundle); this file adds what needs Prisma and mail.
import { db } from "@/lib/db";
import { renderEmail } from "@/lib/email/renderEmail";
import type { EmailDoc } from "@/lib/email/doc";
import { sendEmail } from "@/lib/sdk/resend";
import { allowsEmail, parseNotificationPrefs, type NotificationPrefs, type PrefKey } from "./notificationPrefsShared";

export * from "./notificationPrefsShared";

export async function loadPrefs(userId: string): Promise<NotificationPrefs> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { notificationPrefsJson: true } });
  return parseNotificationPrefs(u?.notificationPrefsJson);
}

// ── recipients ───────────────────────────────────────────────────────────

const OFFICE_ROLES = ["OWNER", "ADMIN", "MANAGER"] as const;

export interface RecipientOptions {
  /** Default: owner + admin + manager. */
  roles?: readonly string[];
  excludeEmails?: readonly string[];
  now?: Date;
}

/**
 * Members of the org who should get this event's email right now: the roles
 * asked for, each filtered through their own prefs + quiet hours in the org's
 * timezone. Falls back to `billingEmail` only when NO member has an address at
 * all (an invite-only org mid-setup) — a member who switched the email off is
 * a decision, not a gap.
 */
export async function resolveEmailRecipients(
  organizationId: string,
  key: PrefKey,
  opts: RecipientOptions = {},
): Promise<string[]> {
  const roles = opts.roles ?? OFFICE_ROLES;
  const [org, members] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true, billingEmail: true } }),
    db.membership.findMany({
      where: { organizationId, role: { in: [...roles] } },
      select: { user: { select: { email: true, notificationPrefsJson: true } } },
    }),
  ]);
  const tz = org?.timezone ?? "America/New_York";
  const exclude = new Set((opts.excludeEmails ?? []).map((e) => e.toLowerCase()));
  const withEmail = members.filter((m) => m.user?.email);
  if (withEmail.length === 0) {
    const fb = org?.billingEmail?.toLowerCase();
    return fb && !exclude.has(fb) ? [fb] : [];
  }
  const out = new Set<string>();
  for (const m of withEmail) {
    const email = m.user!.email!.toLowerCase();
    if (exclude.has(email)) continue;
    const prefs = parseNotificationPrefs(m.user!.notificationPrefsJson);
    if (allowsEmail(prefs, key, opts.now, tz)) out.add(email);
  }
  return [...out];
}

/** Render + send one doc to every member who wants it. */
export async function sendToMembersByPref(
  organizationId: string,
  key: PrefKey,
  doc: EmailDoc,
  opts: RecipientOptions = {},
): Promise<{ sent: number; skipped: boolean }> {
  const to = await resolveEmailRecipients(organizationId, key, opts);
  if (to.length === 0) return { sent: 0, skipped: true };
  const { subject, html } = renderEmail(doc);
  await Promise.all(to.map((email) => sendEmail({ mailClass: "transactional", to: email, subject, html }).catch(() => null)));
  return { sent: to.length, skipped: false };
}

/** One specific user (trade board replies go to the poster, not the office). */
export async function sendToUserByPref(
  userId: string,
  key: PrefKey,
  message: { subject: string; html: string },
): Promise<{ sent: boolean }> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      notificationPrefsJson: true,
      memberships: { take: 1, orderBy: { createdAt: "asc" }, select: { organization: { select: { timezone: true } } } },
    },
  });
  if (!u?.email) return { sent: false };
  const tz = u.memberships[0]?.organization.timezone ?? "America/New_York";
  if (!allowsEmail(parseNotificationPrefs(u.notificationPrefsJson), key, new Date(), tz)) return { sent: false };
  // Report what actually happened. This used to `.catch(() => null)` and then
  // return `{ sent: true }` regardless, so a rejected relay, a bad credential
  // or an unaligned From produced a silent success: the caller logged a send,
  // the recipient got nothing, and there was no trace anywhere. The throw is
  // still swallowed — a failed notification must never fail the write that
  // triggered it — but the failure is now logged and reported.
  try {
    await sendEmail({ mailClass: "transactional", to: u.email, subject: message.subject, html: message.html });
    return { sent: true };
  } catch (err) {
    console.error(`[notify] email "${key}" to ${u.email} failed:`, err);
    return { sent: false };
  }
}
