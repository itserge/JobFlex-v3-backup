"use server";
import { revalidatePath } from "next/cache";
import type Stripe from "stripe";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { getStripe, isStripeEnabled } from "@/lib/sdk/stripe";
import { mirrorPeriodEnd, mirrorStatusFor } from "@/lib/stripeStatus";
import { getSubscribersData, type SubscriberRow } from "@/actions/subscribers";
import {
  LIVE_RECORD_STATUSES,
  STRIPE_MAX_PAGES,
  STRIPE_PAGE_SIZE,
} from "@/components/v3/admin-subscribers/billing-metrics";
import { planSnapshot, reportPlanChange } from "@/lib/activation-events";
import { readGrantsAndMarks, type PlanGrant, type SyncingMark } from "@/lib/planGrant";
import { accountDeletionPlan, removeUserRow, retireOrganization } from "@/lib/accountDeletion";
import { refused, type ActionResult } from "@/lib/actionResult";
import { planLine } from "@/lib/deckAddon";
import {
  phoneEndsWith,
  phoneNarrowing,
  phoneQueryDigits,
  type AdminPhoneMatch,
} from "@/lib/adminPhoneSearch";

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  isPlatformAdmin: boolean;
  orgId: string | null;
  orgName: string | null;
  /** Distinct Membership.role values the user holds (every org). */
  roles: string[];
  /** The plan on screen: Stripe's when a live subscription answers, else the record's. */
  plan: string;
  planStatus: string;
  /** Which of the two the two fields above came from. */
  planSource: "stripe" | "record" | "none";
  /** The stored Subscription row — what the edit sheet writes. "NONE" = no row. */
  recordPlan: string;
  recordStatus: string;
  /** Subscription.provider ("STRIPE" | "MANUAL"), or null when no row. */
  provider: string | null;
  /**
   * What Stripe holds for this org, whether or not it is what the row shows.
   * A live hand grant outranks a Stripe subscription and the operator still has
   * to see the one it outranks — that subscription is what the sync keeps
   * reporting as a conflict, and settling it is theirs to do.
   */
  stripePlan: string | null;
  stripeStatus: string | null;
  stripeSubId: string | null;
  externalSubId: string | null;
  /** The Stripe customer behind the row (kept through a comp) or the Stripe row's. */
  stripeCustomerId: string | null;
  /** What Stripe bills a month for the subscription it holds, or null. */
  stripeAmountCents: number | null;
  /** The standing complimentary plan (lib/planGrant), or null. */
  grant: PlanGrant | null;
  /** A change written from Stripe's reply that Stripe has not confirmed back yet. */
  syncing: SyncingMark | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  canceledAt: Date | null;
  /** How many members share this org (a plan is org-wide, not per-user). */
  orgMemberCount: number;
  createdAt: Date;
}

/**
 * Counted over the ORGANIZATIONS the table actually shows, not over
 * Subscription rows: one plan serves a whole org, and a user is listed once,
 * so counting rows put numbers on screen that no row could explain.
 */
export interface SubscriptionSummary {
  /** Distinct organizations behind the rows on this page. */
  orgs: number;
  active: number;
  trialing: number;
  pastDue: number;
  /** CANCELED + EXPIRED. */
  lapsed: number;
  free: number;
  /** [plan, count] — most common first. */
  byPlan: Array<[string, number]>;
  /**
   * Subscriptions the platform knows about that no row here shows. The four
   * fields under it are that number taken apart, because the fixes differ:
   * offNamedUnknown is a data problem, offNoLink is a checkout that stamped no
   * metadata, and the other two are organizations, not links.
   */
  offList: number;
  /** Stripe named an id this database has no record of. */
  offNamedUnknown: number;
  /** Stripe named nobody at all. */
  offNoLink: number;
  /** Linked to an organization no account on this page belongs to. */
  offOtherOrg: number;
  /** A second subscription on an organization that already shows one. */
  offSecond: number;
}

export interface AdminUsersData {
  rows: AdminUserRow[];
  summary: SubscriptionSummary;
  source: {
    stripeEnabled: boolean;
    stripeLive: boolean;
    stripeError: string | null;
    truncated: boolean;
  };
}

type MembershipShape = {
  role: string;
  organizationId: string;
  organization: { id: string; name: string };
};

/**
 * The user's primary org: OWNER membership → active org → first membership.
 * Deterministic only because every query below orders memberships; without
 * that, "first" changes between reads and so does the plan on the row.
 */
function primaryOrg(u: { activeOrgId: string | null; memberships: MembershipShape[] }) {
  const owner = u.memberships.find((m) => m.role === "OWNER");
  const active = u.memberships.find((m) => m.organizationId === u.activeOrgId);
  return (owner ?? active ?? u.memberships[0])?.organization ?? null;
}

/**
 * One org, one row on screen. Live beats lapsed; among equals the platform's
 * own record wins, because that row is the one the entitlements engine reads —
 * showing Stripe's answer while the product grants something else is exactly
 * the disagreement this page exists to surface. Newest breaks the last tie.
 * The multipliers are spaced well clear of a millisecond timestamp (~1.8e12)
 * so a recent date can never out-rank a status.
 */
function rowPrecedence(r: Pick<SubscriberRow, "status" | "source" | "createdAt">): number {
  const rank =
    r.status === "ACTIVE" ? 4 : r.status === "TRIALING" ? 3 : r.status === "PAST_DUE" ? 2 : 1;
  return rank * 1e15 + (r.source === "record" ? 1e13 : 0) + r.createdAt.getTime();
}

/**
 * Accounts, their organizations, and the subscription each one is on.
 *
 * The plan on a row is the same merged truth /admin/subscribers shows — live
 * Stripe when Stripe answers, the platform's own Subscription rows otherwise.
 * Reading the local rows alone is what made this page report zero while eight
 * subscriptions existed: without STRIPE_WEBHOOK_SECRET the webhook route
 * returns 200 and Stripe never retries, so nothing ever writes them.
 */
export async function getAdminUsersData(): Promise<AdminUsersData> {
  await requirePlatformAdmin();

  const [users, memberCounts, billing] = await Promise.all([
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        isPlatformAdmin: true,
        createdAt: true,
        activeOrgId: true,
        memberships: {
          orderBy: [{ createdAt: "asc" }, { organizationId: "asc" }],
          select: {
            role: true,
            organizationId: true,
            organization: { select: { id: true, name: true } },
          },
        },
      },
    }),
    db.membership.groupBy({ by: ["organizationId"], _count: true }),
    getSubscribersData(),
  ]);

  const orgIds = Array.from(
    new Set(users.map((u) => primaryOrg(u)?.id).filter(Boolean) as string[]),
  );
  const [records, { grants, marks }] = await Promise.all([
    orgIds.length
      ? db.subscription.findMany({
          where: { organizationId: { in: orgIds } },
          select: {
            organizationId: true,
            plan: true,
            status: true,
            provider: true,
            externalSubId: true,
            externalCustomerId: true,
            currentPeriodEnd: true,
            trialEndsAt: true,
            canceledAt: true,
          },
        })
      : Promise.resolve([]),
    readGrantsAndMarks(orgIds),
  ]);

  const recordByOrg = new Map(records.map((s) => [s.organizationId, s]));
  const countByOrg = new Map(memberCounts.map((m) => [m.organizationId, m._count]));

  // One subscription per org on screen; the rest are counted as off-list.
  // `stripeByOrg` keeps the best STRIPE-sourced one alongside, so a row whose
  // hand grant outranks a real subscription can still name what it outranks.
  const liveByOrg = new Map<string, SubscriberRow>();
  const stripeByOrg = new Map<string, SubscriberRow>();
  for (const r of billing.rows) {
    if (!r.organizationId) continue;
    const held = liveByOrg.get(r.organizationId);
    if (!held || rowPrecedence(r) > rowPrecedence(held)) liveByOrg.set(r.organizationId, r);
    if (r.source !== "stripe") continue;
    const heldStripe = stripeByOrg.get(r.organizationId);
    if (!heldStripe || rowPrecedence(r) > rowPrecedence(heldStripe)) {
      stripeByOrg.set(r.organizationId, r);
    }
  }

  const rows: AdminUserRow[] = users.map((u) => {
    const org = primaryOrg(u);
    const record = org ? recordByOrg.get(org.id) : undefined;
    const live = org ? liveByOrg.get(org.id) : undefined;
    const fromStripe = org ? stripeByOrg.get(org.id) : undefined;
    // Which source the value on the row came from — the billing row's own,
    // not the page's: an admin grant is a record row even on the live path.
    const planSource: AdminUserRow["planSource"] = live
      ? live.source === "stripe"
        ? "stripe"
        : "record"
      : record
        ? "record"
        : "none";

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      isPlatformAdmin: u.isPlatformAdmin,
      orgId: org?.id ?? null,
      orgName: org?.name ?? null,
      roles: Array.from(new Set(u.memberships.map((m) => m.role))),
      plan: live?.plan ?? record?.plan ?? "NONE",
      planStatus: live?.status ?? record?.status ?? "NONE",
      planSource,
      recordPlan: record?.plan ?? "NONE",
      recordStatus: record?.status ?? "NONE",
      provider: record?.provider ?? null,
      stripePlan: fromStripe?.plan ?? null,
      stripeStatus: fromStripe?.status ?? null,
      stripeSubId: fromStripe?.externalSubId ?? null,
      externalSubId: record?.externalSubId ?? live?.externalSubId ?? null,
      stripeCustomerId: record?.externalCustomerId ?? fromStripe?.stripeCustomerId ?? null,
      stripeAmountCents: fromStripe ? fromStripe.amountCents : null,
      grant: org ? (grants.get(org.id) ?? null) : null,
      syncing: org ? (marks.get(org.id) ?? null) : null,
      currentPeriodEnd: record?.currentPeriodEnd ?? null,
      trialEndsAt: record?.trialEndsAt ?? null,
      canceledAt: record?.canceledAt ?? null,
      orgMemberCount: org ? (countByOrg.get(org.id) ?? 1) : 0,
      createdAt: u.createdAt,
    };
  });

  // ── the strip, over exactly what the table shows ────────────────────
  const shown = new Map<string, { status: string; plan: string }>();
  for (const r of rows) {
    if (r.orgId) shown.set(r.orgId, { status: r.planStatus, plan: r.plan });
  }

  const byPlan = new Map<string, number>();
  const summary: SubscriptionSummary = {
    orgs: shown.size,
    active: 0,
    trialing: 0,
    pastDue: 0,
    lapsed: 0,
    free: 0,
    byPlan: [],
    offList: 0,
    offNamedUnknown: 0,
    offNoLink: 0,
    offOtherOrg: 0,
    offSecond: 0,
  };
  for (const { status, plan } of shown.values()) {
    // A plan nothing named is counted as an org, but not under a name. Keyed
    // case-insensitively: planLabel() on the client already treats "enterprise"
    // and "ENTERPRISE" as the same catalog plan, so grouping on the raw string
    // put one plan in the strip three times under one name.
    if (plan && plan !== "NONE") {
      const key = plan.toUpperCase();
      byPlan.set(key, (byPlan.get(key) ?? 0) + 1);
    }
    switch (status) {
      case "ACTIVE":
        summary.active += 1;
        break;
      case "TRIALING":
        summary.trialing += 1;
        break;
      case "PAST_DUE":
        summary.pastDue += 1;
        break;
      case "CANCELED":
      case "TRIAL_ENDED":
      case "EXPIRED":
      case "UNPAID":
        summary.lapsed += 1;
        break;
      case "FREE":
        summary.free += 1;
        break;
      // No default: an unrecognised status is not claimed as any of these.
    }
  }
  summary.byPlan = Array.from(byPlan.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  // Off-list, taken apart. "Zero active" is honest on a database Stripe names
  // nobody in — but only if the page can say WHICH kind of nobody.
  for (const r of billing.rows) {
    if (!r.organizationId) {
      summary.offList += 1;
      if (r.matchedBy === "stale-id") summary.offNamedUnknown += 1;
      else summary.offNoLink += 1;
    } else if (!shown.has(r.organizationId)) {
      summary.offList += 1;
      summary.offOtherOrg += 1;
    } else if (liveByOrg.get(r.organizationId) !== r) {
      summary.offList += 1;
      summary.offSecond += 1;
    }
  }

  return {
    rows,
    summary,
    source: {
      stripeEnabled: billing.stripeEnabled,
      stripeLive: billing.stripeLive,
      stripeError: billing.stripeError,
      truncated: billing.truncated,
    },
  };
}

// ─── PHONE SEARCH (2026-11-06) ──────────────────────────────────────────────
// The Users & subscriptions search field, when what is typed reads as a phone
// number (lib/adminPhoneSearch decides). Searched where phones are kept: the
// person's own (User.phone, the verified texting mobile User.smsPhone), the
// company's (Organization.phone, its claimed Twilio number smsFromNumber, the
// extra office lines in NotificationPhone).
//
// No column holds the number as digits, so the database narrows on the last
// four digits — never split by formatting — and the suffix rule decides on the
// handful of rows that come back. No index: `contains` is a scan, which on
// these tables is a few milliseconds (counts in the 2026-11-06 report).

export interface AdminPhoneSearchResult {
  /** The digits searched for — the page drops an answer for an older query. */
  digits: string | null;
  matches: AdminPhoneMatch[];
}

const PHONE_SEARCH_CAP = 200;

export async function searchAdminUsersByPhone(query: string): Promise<AdminPhoneSearchResult> {
  await requirePlatformAdmin();
  const digits = phoneQueryDigits(z.string().max(64).parse(query));
  if (!digits) return { digits: null, matches: [] };
  const tail = phoneNarrowing(digits);

  const [users, orgs, lines] = await Promise.all([
    db.user.findMany({
      where: { OR: [{ phone: { contains: tail } }, { smsPhone: { contains: tail } }] },
      take: PHONE_SEARCH_CAP,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        smsPhone: true,
        memberships: { select: { role: true, organizationId: true } },
      },
    }),
    db.organization.findMany({
      where: { OR: [{ phone: { contains: tail } }, { smsFromNumber: { contains: tail } }] },
      take: PHONE_SEARCH_CAP,
      select: { id: true, phone: true, smsFromNumber: true },
    }),
    db.notificationPhone.findMany({
      where: { phone: { contains: tail } },
      take: PHONE_SEARCH_CAP,
      select: { organizationId: true, name: true, phone: true },
    }),
  ]);

  const matches: AdminPhoneMatch[] = [];
  for (const u of users) {
    // One number per person is enough to say why the row is here.
    const phone = [u.phone, u.smsPhone].find((p) => phoneEndsWith(p, digits));
    if (!phone) continue;
    const who = u.name ?? u.email;
    if (u.memberships.length === 0) {
      matches.push({ phone, whose: "account", userId: u.id, orgId: null, who });
      continue;
    }
    for (const m of u.memberships) {
      matches.push({
        phone,
        whose: m.role === "OWNER" ? "owner" : "member",
        userId: u.id,
        orgId: m.organizationId,
        who,
      });
    }
  }
  for (const o of orgs) {
    if (phoneEndsWith(o.phone, digits)) {
      matches.push({ phone: o.phone!, whose: "company", userId: null, orgId: o.id, who: null });
    } else if (phoneEndsWith(o.smsFromNumber, digits)) {
      matches.push({ phone: o.smsFromNumber!, whose: "twilio", userId: null, orgId: o.id, who: null });
    }
  }
  for (const l of lines) {
    if (!phoneEndsWith(l.phone, digits)) continue;
    matches.push({ phone: l.phone, whose: "office", userId: null, orgId: l.organizationId, who: l.name });
  }
  return { digits, matches };
}

// The subscription itself is edited by actions/adminSubscription (two modes:
// change the billed plan on the Stripe subscription, or grant a complimentary
// plan with a term). The free-form status/date writer that lived here until
// 2026-09-22 (updateAdminSubscription) stamped a row MANUAL and let go of the
// Stripe subscription without cancelling it — the trial then billed at its
// end while the product read the row as a comp.

const updateInput = z.object({
  userId: z.string().min(1),
  email: z.string().email().optional(),
  name: z.string().nullable().optional(),
});

export async function updateAdminUser(raw: unknown) {
  await requirePlatformAdmin();
  const data = updateInput.parse(raw);

  // 1) Profile fields (email/name). Normalize email to match the auth layer,
  // which always lowercases+trims on login (auth.ts) — storing it as-typed would
  // lock the user out and could spawn a duplicate Google account.
  if (data.email !== undefined || data.name !== undefined) {
    const email = data.email !== undefined ? data.email.trim().toLowerCase() : undefined;
    if (email) {
      const clash = await db.user.findFirst({
        where: { email, NOT: { id: data.userId } },
        select: { id: true },
      });
      if (clash) throw new Error("That email is already in use by another account.");
    }
    try {
      await db.user.update({
        where: { id: data.userId },
        data: {
          ...(email !== undefined ? { email } : {}),
          ...(data.name !== undefined ? { name: data.name } : {}),
        },
      });
    } catch (err) {
      // The DB @unique is the real guard — translate a race/casing collision
      // that slipped past the pre-check into the same friendly message.
      if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
        throw new Error("That email is already in use by another account.");
      }
      throw err;
    }
  }

  revalidateAdminBilling();
}

// ── Platform-admin flag ───────────────────────────────

const adminFlagInput = z.object({ userId: z.string().min(1), on: z.boolean() });

/**
 * Grant or revoke the platform-admin flag. Revoking your OWN flag is refused —
 * the console would lock you out the moment the action returned, and the last
 * admin could strand the platform with no one able to get back in.
 */
export async function setPlatformAdmin(userId: string, on: boolean) {
  const me = await requirePlatformAdmin();
  const data = adminFlagInput.parse({ userId, on });
  if (!data.on && data.userId === me.id) {
    throw new Error("You can't remove your own platform-admin flag.");
  }
  const target = await db.user.findUnique({ where: { id: data.userId }, select: { id: true } });
  if (!target) throw new Error("User not found.");
  await db.user.update({ where: { id: data.userId }, data: { isPlatformAdmin: data.on } });
  revalidatePath("/admin/users");
}

// ── Delete account ────────────────────────────────────

/** What the confirm window lists before the admin types the email. */
export interface AdminDeletionPreview {
  email: string;
  /** Why the delete is refused (yourself, a platform admin), or null. */
  blocked: string | null;
  orgs: Array<{
    orgId: string;
    orgName: string;
    role: string;
    memberCount: number;
    otherOwners: number;
    alreadyDeleted: boolean;
    /** The company goes with the account (lib/accountDeletion's rule). */
    deletesOrg: boolean;
    subscription: { plan: string; status: string; provider: string; onStripe: boolean } | null;
    processors: string[];
  }>;
}

function deletionBlocked(meId: string, user: { id: string; email: string; isPlatformAdmin: boolean }): string | null {
  if (user.id === meId) return "You can't delete your own account from here.";
  if (user.isPlatformAdmin) {
    return `${user.email} is a platform admin. Switch Platform admin off and save, then delete the account.`;
  }
  return null;
}

/** Read for the confirm window: the account, and per company what happens to it. */
export async function previewAdminUserDeletion(userId: string): Promise<ActionResult<{ preview: AdminDeletionPreview }>> {
  const me = await requirePlatformAdmin();
  const id = z.string().min(1).parse(userId);
  const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, isPlatformAdmin: true } });
  if (!user) return refused("This account no longer exists. Refresh the page.");
  const plan = await accountDeletionPlan(id);
  return {
    ok: true,
    preview: {
      email: user.email,
      blocked: deletionBlocked(me.id, user),
      orgs: plan.map((f) => ({
        orgId: f.orgId,
        orgName: f.orgName,
        role: f.role,
        memberCount: f.memberCount,
        otherOwners: f.otherOwners,
        alreadyDeleted: f.alreadyDeleted,
        deletesOrg: f.deletesOrg,
        subscription: f.subscription
          ? { plan: f.subscription.plan, status: f.subscription.status, provider: f.subscription.provider, onStripe: !!f.subscription.externalSubId }
          : null,
        processors: f.processors,
      })),
    },
  };
}

const deleteUserInput = z.object({ userId: z.string().min(1), confirmEmail: z.string().trim().max(320) });

/**
 * Delete an account, fully. Refused for yourself and for a platform admin
 * (the flag comes off first). Every company nobody else would own goes the
 * way an owner's own delete takes it (lib/accountDeletion
 * retireOrganization): marked deleted, its Stripe subscription cancelled at
 * once, Stripe Connect / Square / Stax disconnected, the purge cron
 * hard-deleting it 30 days on. A company with another owner is left alone —
 * only the membership goes. Then the User row (removeUserRow).
 *
 * Every refusal comes back as a value: thrown, production showed the admin
 * nothing but React's error #441, in a note scrolled out of sight.
 */
export async function deleteAdminUser(
  raw: unknown,
): Promise<ActionResult<{ deletedOrgs: string[]; warnings: string[] }>> {
  const me = await requirePlatformAdmin();
  const parsed = deleteUserInput.safeParse(raw);
  if (!parsed.success) return refused("Type the account's email to confirm.");
  const { userId: id, confirmEmail } = parsed.data;

  const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, isPlatformAdmin: true } });
  if (!user) return refused("This account no longer exists. Refresh the page.");
  const blocked = deletionBlocked(me.id, user);
  if (blocked) return refused(blocked);
  if (confirmEmail.toLowerCase() !== user.email.toLowerCase()) return refused("That doesn't match the account's email.");

  const deletedOrgs: string[] = [];
  const warnings: string[] = [];
  for (const fate of await accountDeletionPlan(id)) {
    if (!fate.deletesOrg) continue;
    const w = await retireOrganization(
      { id: fate.orgId, name: fate.orgName, externalSubId: fate.subscription?.externalSubId ?? null },
      me.id,
      "deleteAdminUser",
      `Organization "${fate.orgName}" scheduled for deletion with its owner's account (${user.email}), by a platform admin`,
    );
    deletedOrgs.push(fate.orgName);
    warnings.push(...w.map((x) => `${fate.orgName}: ${x}`));
  }

  try {
    await removeUserRow(id);
  } catch (err) {
    // A required relation removeUserRow does not know about yet blocks the
    // delete at the FK — say so instead of a digest.
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2003") {
      return refused(
        `${deletedOrgs.length ? `${deletedOrgs.join(", ")} scheduled for deletion, but the` : "The"} account itself still owns records that can't be orphaned — it was not deleted.`,
      );
    }
    throw err;
  }

  revalidateAdminBilling();
  return { ok: true, deletedOrgs, warnings };
}

// ── Stripe → the platform's subscription record ───────

/**
 * What the sync did, as a partition of the Stripe set:
 *   scanned = written + unchanged + superseded + keptManual + conflicts
 *           + unnamed + unmatched
 * Every subscription read lands in exactly one bucket, so no row can go
 * missing between two reported numbers — and `truncated` says whether
 * `scanned` was the whole account or only the first pageful, because a clean
 * partition of a silently cut set reads exactly like a clean partition.
 */
export interface StripeSyncResult {
  /** Stripe subscriptions read. */
  scanned: number;
  /** The read hit the page ceiling: subscriptions past it were never seen. */
  truncated: boolean;
  /** Rows written — a field actually differed. */
  written: number;
  /** Already matched the record; nothing written, no timestamp moved. */
  unchanged: number;
  /** Lost the per-org contest to a more current subscription. */
  superseded: number;
  /** A live admin grant a lapsed Stripe row would have downgraded. Left alone. */
  keptManual: number;
  /**
   * Refused for a human to settle: the org's record points at a different
   * still-live subscription, a live admin grant would have been replaced, or
   * two organizations claim the same Stripe id so the target is a coin flip.
   */
  conflicts: number;
  /** No org record exists yet and Stripe names no plan — nothing safe to create. */
  unnamed: number;
  /** Resolves to no JobFlex organization. */
  unmatched: number;
}

/**
 * Statuses that mean a record is still live and must not be silently replaced.
 * One definition, shared with the read model and the sheet — see
 * LIVE_RECORD_STATUSES in components/v3/admin-subscribers/billing-metrics.ts.
 */
const LIVE_RECORD = LIVE_RECORD_STATUSES;

/**
 * Import the live Stripe subscriptions into the platform's own Subscription
 * table, so /admin/users keeps a record of what Stripe knows.
 *
 * A subscription is written only when it links to an organization through an
 * id Stripe itself carries — the same links src/actions/subscribers.ts uses,
 * in order of directness:
 *   1. metadata.organizationId (stamped by the checkout route), on the
 *      subscription or on its customer;
 *   2. the platform's own record, keyed by externalSubId, else externalCustomerId;
 *   3. metadata.userId → that user's OWNER membership, else their oldest.
 * Never by name or email. Order matters: the membership guess is the only step
 * that can pick the WRONG org, and Subscription.organizationId is @unique, so a
 * wrong guess overwrites whatever that org's row held.
 */
export async function syncSubscriptionsFromStripe(): Promise<StripeSyncResult> {
  await requirePlatformAdmin();
  if (!isStripeEnabled()) throw new Error("Stripe is not configured on this deployment.");

  const stripe = getStripe();
  const subs: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  // The same ceiling the subscribers read model pages to, from the same
  // constant — and, unlike before, one this function admits to hitting.
  let truncated = false;
  for (let page = 0; page < STRIPE_MAX_PAGES; page++) {
    const res = await stripe.subscriptions.list({
      status: "all",
      limit: STRIPE_PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
      expand: ["data.customer"],
    });
    subs.push(...res.data);
    if (!res.has_more || res.data.length === 0) break;
    startingAfter = res.data[res.data.length - 1].id;
    if (page === STRIPE_MAX_PAGES - 1) truncated = true;
  }
  const empty: StripeSyncResult = {
    scanned: 0,
    truncated,
    written: 0,
    unchanged: 0,
    superseded: 0,
    keptManual: 0,
    conflicts: 0,
    unnamed: 0,
    unmatched: 0,
  };
  if (subs.length === 0) return empty;

  // ── the link tables, fetched once ───────────────────
  const metaOrgIds = new Set<string>();
  const metaUserIds = new Set<string>();
  const subIds: string[] = [];
  const custIds = new Set<string>();
  const priceIds = new Set<string>();
  for (const sub of subs) {
    const orgId = stripeMeta(sub, "organizationId");
    if (orgId) metaOrgIds.add(orgId);
    const uid = stripeMeta(sub, "userId");
    if (uid) metaUserIds.add(uid);
    subIds.push(sub.id);
    custIds.add(stripeCustomerId(sub));
    const priceId = planLine(sub.items.data)?.price?.id;
    if (priceId) priceIds.add(priceId);
  }

  const [orgs, users, mirrors, planPrices, catalog] = await Promise.all([
    metaOrgIds.size
      ? db.organization.findMany({ where: { id: { in: [...metaOrgIds] } }, select: { id: true } })
      : Promise.resolve([]),
    metaUserIds.size
      ? db.user.findMany({
          where: { id: { in: [...metaUserIds] } },
          select: {
            id: true,
            activeOrgId: true,
            memberships: {
              orderBy: [{ createdAt: "asc" }, { organizationId: "asc" }],
              select: {
                role: true,
                organizationId: true,
                organization: { select: { id: true, name: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    db.subscription.findMany({
      where: {
        OR: [{ externalSubId: { in: subIds } }, { externalCustomerId: { in: [...custIds] } }],
      },
      select: { organizationId: true, externalSubId: true, externalCustomerId: true },
    }),
    priceIds.size
      ? db.planPrice.findMany({
          where: { stripePriceId: { in: [...priceIds] } },
          select: { stripePriceId: true, planSlug: true },
        })
      : Promise.resolve([]),
    db.pricingPlan.findMany({ select: { slug: true } }),
  ]);

  const knownOrg = new Set(orgs.map((o) => o.id));
  const userById = new Map(users.map((u) => [u.id, u]));
  // Neither externalSubId nor externalCustomerId is @unique in the schema,
  // while organizationId IS — so two rows holding the same `sub_…` / `cus_…`
  // mean two organizations claim the same Stripe object. A plain Map keeps
  // whichever row Prisma returned last and hands the subscription to a coin
  // flip; these maps hand it to nobody and flag the collision instead.
  const orgBySubId = orgIndex(mirrors, (m) => m.externalSubId);
  const orgByCustId = orgIndex(mirrors, (m) => m.externalCustomerId);
  const slugByPrice = new Map(planPrices.map((p) => [p.stripePriceId, p.planSlug.toUpperCase()]));
  const catalogSlugs = new Set(catalog.map((p) => p.slug.toUpperCase()));

  // ── resolve, then keep the most current subscription per org ──
  const best = new Map<string, Stripe.Subscription>();
  const result: StripeSyncResult = { ...empty, scanned: subs.length };
  for (const sub of subs) {
    const link = resolveOrgForStripeSub(sub, knownOrg, userById, orgBySubId, orgByCustId);
    if (link.ambiguous) {
      // Two organizations hold the same Stripe id. Writing to either is a
      // 50/50 chance of putting a paid plan on the wrong company.
      result.conflicts += 1;
      continue;
    }
    const organizationId = link.organizationId;
    if (!organizationId) {
      result.unmatched += 1;
      continue;
    }
    const held = best.get(organizationId);
    if (!held) {
      best.set(organizationId, sub);
      continue;
    }
    // Both belong to this org; only one can be the record. The loser is
    // reported rather than dropped between two numbers.
    result.superseded += 1;
    if (subPrecedence(sub) > subPrecedence(held)) best.set(organizationId, sub);
  }

  // The authoritative current state of every row we may touch.
  const existingRows = best.size
    ? await db.subscription.findMany({
        where: { organizationId: { in: [...best.keys()] } },
        select: {
          organizationId: true,
          plan: true,
          status: true,
          provider: true,
          externalCustomerId: true,
          externalSubId: true,
          stripePriceId: true,
          currentPeriodEnd: true,
          trialEndsAt: true,
          canceledAt: true,
        },
      })
    : [];
  const existingByOrg = new Map(existingRows.map((r) => [r.organizationId, r]));

  // ── write (sequential: one SQLite writer) ───────────
  for (const [organizationId, sub] of best) {
    const existing = existingByOrg.get(organizationId);
    // The webhook's and the cron's answer (lib/stripeStatus): a card-less trial
    // that ran out stays TRIAL_ENDED, not CANCELED.
    const status = mirrorStatusFor(sub);

    // A LIVE hand grant is never overwritten — the hand-grant rule, whatever id
    // the row happens to carry. A lapsed Stripe row would downgrade the grant
    // (and a CANCELED write drops the org to FREE limits through the lapsed-sub
    // rule); a live one would silently replace a hand-granted tier with a
    // purchased one and stamp provider STRIPE, which also moves it out of the
    // comp tally and into MRR. Neither is the sync's call.
    //
    // Matching on `externalSubId !== sub.id` used to let one case through: a
    // grant written over a Stripe-managed row kept that row's id, so the sync
    // read it as "the same subscription" and overwrote the operator's ENTERPRISE
    // comp with whatever `sub_…` said, counted as an ordinary write with no
    // conflict flagged. A grant clears the id (actions/adminSubscription), and the id
    // is no longer part of the question either way.
    //
    // The way back is the operator's, not the sync's: end the grant (Canceled /
    // Expired) and the next sync writes Stripe's truth over the dead row.
    if (existing?.provider === "MANUAL" && LIVE_RECORD.has(existing.status)) {
      if (LIVE_RECORD.has(status)) result.conflicts += 1;
      else result.keptManual += 1;
      continue;
    }

    // Subscription.organizationId is @unique: writing here REPLACES whatever
    // this org's row pointed at. Only a dead record may be replaced by a live
    // subscription (a genuine re-subscribe); anything else is for a human.
    if (existing?.externalSubId && existing.externalSubId !== sub.id) {
      const replacingDeadRecord = !LIVE_RECORD.has(existing.status) && LIVE_RECORD.has(status);
      if (!replacingDeadRecord) {
        result.conflicts += 1;
        continue;
      }
    }

    const priceId = planLine(sub.items.data)?.price?.id ?? null;
    const namedPlan = planForStripeSub(sub, priceId, slugByPrice, catalogSlugs);
    if (!existing && !namedPlan) {
      // plan "" prices at nothing behind an ACTIVE badge. Refuse, and say so.
      result.unnamed += 1;
      continue;
    }

    const next = {
      // A plan Stripe cannot name leaves the stored one as it stands.
      plan: namedPlan ?? existing?.plan ?? "",
      status,
      provider: "STRIPE",
      externalCustomerId: stripeCustomerId(sub),
      externalSubId: sub.id,
      stripePriceId: priceId,
      currentPeriodEnd: mirrorPeriodEnd(sub),
      trialEndsAt: stripeDate(sub.trial_end),
      canceledAt: stripeDate(sub.canceled_at),
    };

    // @updatedAt fires on every write, so an unconditional upsert would leave
    // every row reading "just now" after a sync that changed nothing.
    if (existing && sameRecord(existing, next)) {
      result.unchanged += 1;
      continue;
    }

    const planWas = await planSnapshot(organizationId);
    await db.subscription.upsert({
      where: { organizationId },
      update: next,
      create: { organizationId, ...next },
    });
    reportPlanChange(organizationId, "admin", planWas);
    result.written += 1;
  }

  revalidateAdminBilling();
  return result;
}

/** Every admin surface that renders a subscription figure. */
function revalidateAdminBilling() {
  revalidatePath("/admin");
  revalidatePath("/admin/users");
  revalidatePath("/admin/subscribers");
}

type RecordFields = {
  plan: string;
  status: string;
  provider: string;
  externalCustomerId: string | null;
  externalSubId: string | null;
  stripePriceId: string | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  canceledAt: Date | null;
};

function sameInstant(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function sameRecord(a: RecordFields, b: RecordFields): boolean {
  return (
    a.plan === b.plan &&
    a.status === b.status &&
    a.provider === b.provider &&
    a.externalCustomerId === b.externalCustomerId &&
    a.externalSubId === b.externalSubId &&
    a.stripePriceId === b.stripePriceId &&
    sameInstant(a.currentPeriodEnd, b.currentPeriodEnd) &&
    sameInstant(a.trialEndsAt, b.trialEndsAt) &&
    sameInstant(a.canceledAt, b.canceledAt)
  );
}

type StripeLinkedUser = {
  activeOrgId: string | null;
  memberships: MembershipShape[];
};

/** A metadata key off the subscription, falling back to its expanded customer. */
function stripeMeta(sub: Stripe.Subscription, key: string): string | null {
  const own = sub.metadata?.[key];
  if (own) return own;
  const c = sub.customer;
  if (!c || typeof c === "string" || ("deleted" in c && c.deleted)) return null;
  return (c as Stripe.Customer).metadata?.[key] ?? null;
}

function stripeCustomerId(sub: Stripe.Subscription): string {
  return typeof sub.customer === "string" ? sub.customer : sub.customer.id;
}

function stripeDate(seconds: number | null | undefined): Date | null {
  return seconds ? new Date(seconds * 1000) : null;
}

/**
 * Index the platform's record rows by a Stripe id, keeping the ids only ONE
 * organization claims. `shared` holds the rest: they resolve to no org and are
 * refused rather than written to whichever row came back last.
 */
function orgIndex<T extends { organizationId: string }>(
  rows: readonly T[],
  key: (r: T) => string | null,
): { byId: Map<string, string>; shared: Set<string> } {
  const byId = new Map<string, string>();
  const shared = new Set<string>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const held = byId.get(k);
    if (held === undefined) byId.set(k, r.organizationId);
    else if (held !== r.organizationId) shared.add(k);
  }
  for (const k of shared) byId.delete(k);
  return { byId, shared };
}

type OrgIndex = ReturnType<typeof orgIndex>;

/**
 * Which organization this subscription belongs to, or why nothing may be
 * written. `ambiguous` is NOT "unmatched": the deployment holds two rows for
 * the same Stripe id, so a write would land on one of two organizations at
 * random — the caller counts it as a conflict for a human to settle.
 */
function resolveOrgForStripeSub(
  sub: Stripe.Subscription,
  knownOrg: Set<string>,
  userById: Map<string, StripeLinkedUser>,
  orgBySubId: OrgIndex,
  orgByCustId: OrgIndex,
): { organizationId: string | null; ambiguous: boolean } {
  const metaOrg = stripeMeta(sub, "organizationId");
  if (metaOrg && knownOrg.has(metaOrg)) return { organizationId: metaOrg, ambiguous: false };

  // The platform's own record beats a membership guess: it was written from a
  // Stripe id, while a membership only says which org someone happens to be in.
  if (orgBySubId.shared.has(sub.id)) return { organizationId: null, ambiguous: true };
  const bySub = orgBySubId.byId.get(sub.id);
  if (bySub) return { organizationId: bySub, ambiguous: false };

  const custId = stripeCustomerId(sub);
  if (orgByCustId.shared.has(custId)) return { organizationId: null, ambiguous: true };
  const byCust = orgByCustId.byId.get(custId);
  if (byCust) return { organizationId: byCust, ambiguous: false };

  const uid = stripeMeta(sub, "userId");
  const user = uid ? userById.get(uid) : undefined;
  return { organizationId: (user ? primaryOrg(user)?.id : undefined) ?? null, ambiguous: false };
}

/** Live beats lapsed; among equals the newest wins. One org, one record row. */
function subPrecedence(sub: Stripe.Subscription): number {
  const rank =
    sub.status === "active" ? 4 : sub.status === "trialing" ? 3 : sub.status === "past_due" ? 2 : 1;
  return rank * 1e12 + sub.created;
}

/**
 * The purchased plan, read off Stripe: the PlanPrice ledger first (the price the
 * checkout actually charged), then a tier stamped on the subscription or its
 * price and confirmed against the catalog. Null when Stripe names none — the
 * caller then writes no plan rather than a guess.
 */
function planForStripeSub(
  sub: Stripe.Subscription,
  priceId: string | null,
  slugByPrice: Map<string, string>,
  catalogSlugs: Set<string>,
): string | null {
  if (priceId) {
    const fromLedger = slugByPrice.get(priceId);
    if (fromLedger) return fromLedger;
  }
  const price = planLine(sub.items.data)?.price;
  const candidates = [
    sub.metadata?.planTier,
    sub.metadata?.planName,
    price?.metadata?.planSlug,
    price?.metadata?.planName,
    price?.nickname,
  ];
  for (const c of candidates) {
    const upper = c?.trim().toUpperCase();
    if (upper && catalogSlugs.has(upper)) return upper;
  }
  return null;
}
