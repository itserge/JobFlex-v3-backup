// THE MOVE TO FREE ON STRIPE — the booking, its undo and the owner's letter
// (owner, 2026-09-20; lib/freePlan). Moved out of actions/billing on
// 2026-11-01 so the owner's own cancel (Settings → Billing) and the platform
// admin's (lib/adminCancel) book it the same way. Not a server action file:
// nothing here is callable from a browser.

import type Stripe from "stripe";
import { db } from "@/lib/db";
import { FREE_SWITCH_META } from "@/lib/freePlan";
import {
  readScheduledSwitch,
  rebookScheduledSwitch,
  releaseScheduledSwitch,
  type PlanChangeDeps,
  type ScheduledSwitch,
} from "@/lib/planChange";

/** The booked switch the move to Free let go of, for "Keep" (SyncState). */
export const heldSwitchKey = (orgId: string) => `freeHeldSwitch:${orgId}`;

/** cancel_at_period_end on Stripe. A booked YEAR → MONTH switch holds the
 *  subscription on a schedule, which refuses cancel_at_period_end: the
 *  switch goes first, and is remembered for "Keep". */
export async function bookFreeSwitch(organizationId: string, subId: string, stripe: Stripe): Promise<Stripe.Subscription> {
  const held = await readScheduledSwitch(organizationId).catch(() => null);
  if (held) {
    const cursor = JSON.stringify(held);
    await db.syncState.upsert({ where: { key: heldSwitchKey(organizationId) }, update: { cursor }, create: { key: heldSwitchKey(organizationId), cursor } });
  }
  await releaseScheduledSwitch(organizationId, stripe);
  return stripe.subscriptions.update(subId, {
    cancel_at_period_end: true,
    metadata: { [FREE_SWITCH_META]: "1" },
  });
}

/** Clears the booking on Stripe; null when Stripe has already ended the
 *  subscription — the company is on Free and there is nothing to keep. */
export async function keepFreeSwitch(subId: string, stripe: Stripe): Promise<Stripe.Subscription | null> {
  const current = await stripe.subscriptions.retrieve(subId);
  if (current.status === "canceled" || current.status === "incomplete_expired") return null;
  return stripe.subscriptions.update(subId, {
    cancel_at_period_end: false,
    metadata: { [FREE_SWITCH_META]: "" },
  });
}

/** Everything as it was: a YEAR → MONTH switch the cancel let go of is booked
 *  again. Best effort — a failure is logged, never the Keep's. */
export async function rebookHeldSwitch(organizationId: string, subId: string, deps: PlanChangeDeps): Promise<void> {
  const row = await db.syncState.findUnique({ where: { key: heldSwitchKey(organizationId) } }).catch(() => null);
  if (!row) return;
  try {
    const held = JSON.parse(row.cursor) as ScheduledSwitch;
    if (held.subId === subId && !(await rebookScheduledSwitch(organizationId, held, deps))) {
      console.warn(`[billing] ${subId}: the booked switch could not be put back after Keep`);
    }
  } catch (err) {
    console.warn("[billing] resumeSubscription: the booked switch could not be put back:", err);
  }
}

/** "Your plan switches to Free on <date>" — to the owner, after the booking,
 *  with the way back ("Keep <plan>") one tap away in Settings → Billing.
 *  `byJobflex`: support cancelled it, not the owner; `endedNow`: it ended
 *  today (an admin's immediate cancel) and there is nothing left to keep. */
export async function sendFreeSwitchEmail(
  organizationId: string,
  plan: string,
  endsAt: Date | null,
  opts: { byJobflex?: boolean; endedNow?: boolean } = {},
): Promise<void> {
  const owner = await db.membership.findFirst({
    where: { organizationId, role: "OWNER", organization: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { email: true, name: true } }, organization: { select: { billingEmail: true } } },
  });
  const email = owner?.organization.billingEmail || owner?.user.email;
  if (!email) return;
  const [{ appBaseUrl }, { renderEmail }, { sendEmail }, { buildFreeSwitchBooked }, { getPlanDisplayName }] = await Promise.all([
    import("@/lib/appUrl"),
    import("@/lib/email/renderEmail"),
    import("@/lib/sdk/resend"),
    import("@/lib/email/build/billing"),
    import("@/lib/planCatalogServer"),
  ]);
  const base = (await appBaseUrl()).replace(/\/$/, "");
  const planName = await getPlanDisplayName(plan).catch(() => plan);
  const { subject, html } = renderEmail(
    buildFreeSwitchBooked({ name: owner?.user.name ?? null, planName, switchAt: endsAt, href: `${base}/dashboard/settings?tab=billing`, ...opts }),
  );
  await sendEmail({ to: email, subject, html });
}
