import "server-only";
// THE NEW PLANS ON SCREEN (Base + Tools, part 3b — owner, 2026-11-10). The one read behind the Subscription page's
// "Your plan / Your tools / Upgrade your plan" section and the welcome page: the shop's record, its people, the prices
// in force (Admin → Plans) and its subscription row, handed to the pure view (lib/toolPlans/shared
// toolsSubscriptionModel). Null for a Classic shop, so a Classic page never changes.
//
// THE WELCOME PAGE, ONCE: the first time a new-plan shop's owner opens the Overview (/dashboard) they land on
// /dashboard/welcome, which stamps SyncState `toolsWelcome:<orgId>` when it renders. After that the Subscription page
// holds the same cards.

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { countPeoplePool } from "@/lib/limitsEngine";
import { isOwnerRole, requireOrg } from "@/lib/orgContext";
import { planLapsed } from "@/lib/planStatus";
import { readAccessSubscription } from "@/lib/subscriptionAccess";
import { readToolsRecord } from "./billing";
import { readToolCatalog } from "./prices";
import { isToolsSlug, toolsSubscriptionModel, type ToolsSubscriptionModel } from "./shared";

/** The view, or null for a Classic shop (or one whose plan can't be read). */
export async function loadToolsModel(organizationId: string, now = new Date()): Promise<(ToolsSubscriptionModel & { lapsed: boolean }) | null> {
  const sub = await readAccessSubscription(organizationId).catch(() => null);
  if (!sub || !isToolsSlug(sub.plan)) return null;
  const [record, catalog, pool, org] = await Promise.all([
    readToolsRecord(organizationId),
    readToolCatalog(),
    countPeoplePool(organizationId).catch(() => 0),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }).catch(() => null),
  ]);
  const model = toolsSubscriptionModel({
    record,
    planSlug: sub.plan,
    people: pool + 1,
    catalog,
    now,
    status: sub.status,
    trialEndsAt: sub.trialEndsAt,
    hasCard: sub.provider === "STRIPE" && !!sub.externalSubId,
    timeZone: org?.timezone || undefined,
  });
  return model ? { ...model, lapsed: planLapsed(sub) } : null;
}

export const TOOLS_WELCOME_PREFIX = "toolsWelcome:";
const welcomeKey = (organizationId: string) => `${TOOLS_WELCOME_PREFIX}${organizationId}`;

/**
 * Should the Overview send this person to the welcome page? Only a new-plan shop's owner, once. A Classic shop is
 * answered from the subscription row the layout has already read in this request (no extra query); only a new-plan
 * shop's owner costs the sign-in check and one SyncState read. Never throws: any doubt is "no".
 */
export async function toolsWelcomeDue(): Promise<boolean> {
  try {
    const session = await auth();
    const hint = (session?.user as { activeOrgId?: string | null } | undefined)?.activeOrgId ?? null;
    if (hint) {
      const sub = await readAccessSubscription(hint).catch(() => null);
      if (!isToolsSlug(sub?.plan)) return false;
    }
    const ctx = await requireOrg();
    if (!isOwnerRole(ctx.role)) return false;
    const sub = await readAccessSubscription(ctx.organizationId);
    if (!sub || !isToolsSlug(sub.plan) || planLapsed(sub)) return false;
    const row = await db.syncState.findUnique({ where: { key: welcomeKey(ctx.organizationId) }, select: { key: true } });
    return !row;
  } catch {
    return false;
  }
}

/** The welcome page was shown: the Overview opens as itself from now on. */
export async function markToolsWelcomeShown(organizationId: string, now = new Date()): Promise<void> {
  const key = welcomeKey(organizationId);
  await db.syncState
    .upsert({ where: { key }, create: { key, cursor: now.toISOString() }, update: {} })
    .catch((err) => console.warn("[toolPlans] welcome stamp:", err));
}
