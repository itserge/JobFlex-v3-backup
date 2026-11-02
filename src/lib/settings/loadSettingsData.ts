// SETTINGS READ — the one loader behind both settings surfaces.
//
// Lifted verbatim out of src/app/dashboard/settings/page.tsx so the handheld
// route (/mobile-settings-v1) and the desktop hub (/dashboard/settings) build
// the SAME `SettingsData` object from the SAME queries. Two copies of this fold
// would drift the moment either page gained a field.
//
// THIS IS NOT A "use server" MODULE, on purpose. An exported async function in
// an action file is a public RPC endpoint; a read keyed by a caller-supplied
// org id would be a data leak. It therefore takes the ALREADY-RESOLVED org
// context (what `requireOrg()` returned to the page) as an argument and never
// resolves one itself — there is no way to call it for an org the caller has
// not already been authorised for.
//
// It also does not redirect: `null` means the org row is gone, and each page
// answers that in its own vocabulary.
//
// NOTE ON THE PATH: `src/lib/settings.ts` (the JSON blob parsers) and this
// directory coexist. Node/TS extension resolution takes the FILE for
// `@/lib/settings`, and this module is only ever reached by its full path.

import { trialExtensionOffer } from "@/lib/trialExtensionServer";
import { db } from "@/lib/db";
import { readHeldDeckAddon } from "@/lib/deckAddonBilling";
import { deckAddonHeldWords } from "@/lib/deckAddon";
import { appBaseUrl } from "@/lib/appUrl";
import { longDate } from "@/lib/format";
import { isOwnerOrManager, isOwnerRole, type requireOrg } from "@/lib/orgContext";
import { titleCaseSlug } from "@/lib/planCatalog";
import { getOrgPlanContext } from "@/lib/planCatalogServer";
import { getOrgLimitUsage } from "@/lib/limitsEngine";
import { DEFAULT_FREE_LIMITS, isUnlimited, parsePlanLimits } from "@/lib/planLimits";
import { readCustomPages } from "@/lib/customPageAccess";
import { CUSTOM_PLAN_LIMITS_SLUG, CUSTOM_PLAN_SLUG, customPriceCents } from "@/lib/customPlan";
import { planLapsed } from "@/lib/planStatus";
import { planTermState } from "@/lib/planChange";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import { subscriptionCard, trialCardLine } from "@/lib/trialCardLine";
import {
  FREE_PLAN_NAME,
  LIVE_STATUSES,
  freePlanLosses,
  freeSwitchBooked,
  freeSwitchDate,
  onFreePlan,
} from "@/lib/freePlan";
import { GMAIL_SCOPES, isGmailOAuthConfigured } from "@/lib/sdk/gmail";
import { isStripeConnectConfigured } from "@/lib/sdk/integrations";
import type { SmsRegistrationView } from "@/lib/sms/registrationShared";
import { isSecretBoxConfigured } from "@/lib/crypto/secretBox";
import { metaAllowed } from "@/lib/meta/graph";
import { metaConnectionView } from "@/lib/meta/connections";
import { rampConnectionView } from "@/lib/ramp/connection";
import { getPaymentConnectionStatus } from "@/lib/payments/connections";
import { parseNotificationPrefs } from "@/lib/notificationPrefsShared";
import { financingReadiness, orgFinancingView } from "@/lib/financing/service";
import { deskAnswerState } from "@/lib/financing/desk";
import {
  parseGmailSettings,
  parseMetaSettings,
  parsePaymentSettings,
} from "@/lib/settings";
import type { Badge, BillingData, DeskSettingsData, SettingsData, SmsRosterRow, SmsSettingsData } from "@/components/v3/settings-blueprint/settings-data";

/** Emails allowed to use the Gmail connector while the Google app is still in
 *  Testing — GMAIL_OAUTH_TEST_USERS, comma-separated, case-insensitive. */
function isGmailTestUser(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.GMAIL_OAUTH_TEST_USERS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}


/** Exactly what `requireOrg()` hands back — the page resolves it, not this. */
export type SettingsOrgContext = Awaited<ReturnType<typeof requireOrg>>;

/** "OWNER" → "Owner"; the Profile card's `.badge2` and read-only Role field. */
export function roleLabel(role: string): string {
  const clean = role.replace(/_/g, " ").toLowerCase();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/** Subscription status → the donor's `.badge2` tones. */
export function statusBadge(status: string | null): Badge | null {
  if (!status) return null;
  const label = roleLabel(status);
  if (status === "ACTIVE" || status === "TRIALING" || status === "FREE") {
    return { label, tone: "bg-ok" };
  }
  if (status === "PAST_DUE" || status === "UNPAID" || status === "CANCELED" || status === "EXPIRED") {
    return { label, tone: "bg-bad" };
  }
  return { label, tone: "bg-off" };
}

/** Everything the five panes render, from the database. `null` = no org row. */
/** `billingLive`: the page opened on the Billing pane — only then does the
 *  owner's manage window read Stripe (price term, card). Every other pane,
 *  and every other role, costs Stripe nothing. */
/** Settings → Payments → Financing (lib/financing): null while JobFlex's switch keeps the account out or Wisetack is
 *  not connected on this deployment — the tab does not exist then. */
async function loadFinancingSettings(organizationId: string, role: string): Promise<SettingsData["payments"]["financing"]> {
  const view = await orgFinancingView(organizationId);
  if (!view.letIn || !view.available) return null;
  const [readiness, deskAnswer] = await Promise.all([financingReadiness(organizationId, view.rec), deskAnswerState(organizationId)]);
  return { rec: view.rec, readiness, canManage: isOwnerOrManager(role), deskAnswer };
}

export async function loadSettingsData(ctx: SettingsOrgContext, opts: { billingLive?: boolean } = {}): Promise<SettingsData | null> {
  const { organizationId, user, role } = ctx;

  const [me, org, sub, planContext, usage, appUrl, connections, lastStripeEvt, lastSquareEvt] =
    await Promise.all([
      db.user.findUnique({
        where: { id: user.id },
        select: { name: true, email: true, phone: true, notificationPrefsJson: true, smsPhone: true, smsVerifiedAt: true, hashedPassword: true },
      }),
      db.organization.findUnique({
        where: { id: organizationId },
        select: {
          name: true,
          address: true,
          website: true,
          phone: true,
          billingEmail: true,
          paymentSettingsJson: true,
          gmailSettingsJson: true,
          gmailTokensJson: true,
          metaSettingsJson: true,
        },
      }),
      db.subscription.findUnique({ where: { organizationId } }),
      getOrgPlanContext(organizationId),
      getOrgLimitUsage(organizationId),
      appBaseUrl(),
      getPaymentConnectionStatus(organizationId),
      // Platform-level: WebhookEvent has no org column. "Last event received"
      // says the pipe is alive, not that THIS org's payment arrived.
      db.webhookEvent.findFirst({
        where: { provider: "STRIPE", type: { startsWith: "checkout.session" } },
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true },
      }),
      db.webhookEvent.findFirst({
        where: { provider: "SQUARE" },
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true },
      }),
    ]);

  if (!org) return null;

  /* ── plan + seats ── */
  const wasName = planContext.plan?.name ?? titleCaseSlug(planContext.rawPlan);
  // Ended (CANCELED) reads as the Free plan (lib/freePlan); a grant is not one.
  const granted = sub?.provider === "MANUAL";
  const onFree = onFreePlan(sub);
  const planName = onFree ? FREE_PLAN_NAME : wasName;
  const seatStatus = usage.find((u) => u.resource === "teamSeats");
  const seatsUsed = seatStatus?.used ?? 0;
  const seats =
    seatStatus && seatStatus.limit !== null ? `${seatsUsed} of ${seatStatus.limit}` : `${seatsUsed}`;
  const booked = !granted && freeSwitchBooked(sub);
  // Nothing more is billed once the switch to Free is booked, or on Free.
  const nextBillAt = onFree || booked ? null : (sub?.currentPeriodEnd ?? sub?.trialEndsAt ?? null);
  const isOwnerHere = isOwnerRole(role);
  // Lapsed access can still leave Stripe renewing: the window then cancels
  // only the renewal (the subscription page's rule, moved here 2026-10-17).
  const lapsed = planLapsed(sub);
  const stripeSub = sub?.provider === "STRIPE" && Boolean(sub.externalSubId) && isStripeEnabled();
  const cancellable =
    isOwnerHere && !granted && !booked && !!sub && (LIVE_STATUSES as readonly string[]).includes(sub.status) && (!lapsed || stripeSub);
  const [offer, manage, extension] = await Promise.all([
    cancellable && sub ? cancelOffer(organizationId, sub.plan, lapsed ? null : freeSwitchDate(sub), wasName, lapsed) : null,
    isOwnerHere ? manageView(organizationId, sub, { planDto: planContext.plan, onFree, granted, booked, lapsed, stripeSub, live: opts.billingLive === true }) : null,
    // "Request a trial extension" on Before you go (owner, 2026-10-20): on the
    // trial, or within 14 days after it (lib/trialExtension).
    cancellable && sub && !lapsed ? trialExtensionOffer(organizationId, sub) : null,
  ]);
  const cancel = offer ? { ...offer, extension } : null;

  /* ── settings blobs ── */
  const payment = parsePaymentSettings(org.paymentSettingsJson);
  const gmail = parseGmailSettings(org.gmailSettingsJson);
  const meta = await metaConnectionView(organizationId, user.id);
  const ramp = await rampConnectionView(organizationId);
  const gmailConnected = Boolean(org.gmailTokensJson);

  const isOwner = isOwnerRole(role);
  const fmtWhen = (d: Date | null | undefined) => (d ? `${longDate(d)} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : null);

  return {
    account: {
      name: me?.name ?? user.name ?? "",
      email: me?.email ?? user.email ?? "",
      phone: me?.phone ?? "",
      role: roleLabel(role),
      roleBadge: roleLabel(role),
      canEditBusiness: isOwnerOrManager(role),
      isOwner,
      business: {
        name: org.name,
        address: org.address ?? "",
        website: org.website ?? "",
        phone: org.phone ?? "",
      },
      // Whether the account has a password at all (a passwordless or Google
      // account may not) — the Password row says Set / Not set (2026-10-10).
      hasPassword: Boolean(me?.hashedPassword),
      security: {
        passwordDesc: me?.hashedPassword
          ? "Set. Sign in with it, with a code from email or with Google."
          : "Not set. You sign in with a code from email or with Google.",
        sessionsDesc: "Logs out every device, including this one.",
      },
      forgotHref: "/auth/forgot",
    },
    payments: {
      connections,
      currency: payment.currency,
      depositPct: String(payment.depositPct),
      receiptsOnPayment: payment.receiptsOnPayment,
      platformFeePct: connections.platformFeePct,
      financing: await loadFinancingSettings(organizationId, role),
    },
    billing: {
      planName,
      planBadge: onFree ? { label: FREE_PLAN_NAME, tone: "bg-off" } : statusBadge(sub?.status ?? null),
      nextBill: nextBillAt ? longDate(nextBillAt) : "",
      seats,
      billingEmail: org.billingEmail ?? "",
      isOwner,
      canEditBilling: isOwnerOrManager(role),
      subscriptionHref: "/dashboard/subscription",
      onFree,
      freeSwitch: booked ? { at: freeSwitchDate(sub)?.toISOString() ?? null, planName: wasName } : null,
      cancel,
      manage: manage ? { ...manage, noCancel: cancel || booked ? null : manage.noCancel } : null,
    },
    integrations: {
      gmail: {
        // Google keeps an app in "Testing" until it passes verification, and
        // only listed test users may consent — so the tab says "Coming soon"
        // until the operator flips GMAIL_OAUTH_PUBLIC after verification.
        // While it is in Testing, GMAIL_OAUTH_TEST_USERS (comma-separated
        // emails, the same list as the console's Audience → Test users) lets
        // those accounts see and use the connector ahead of everyone else.
        comingSoon: !(isGmailOAuthConfigured() && (process.env.GMAIL_OAUTH_PUBLIC === "true" || isGmailTestUser(me?.email ?? user.email))),
        connected: gmailConnected,
        connectedEmail: gmail.connectedEmail,
        // From address is PRE-FILLED with the company (owner's call,
        // 2026-09-03): the business name, and the billing email when the org
        // has one, else the signed-in user's address. Saving persists it.
        displayName: gmail.displayName || org.name,
        replyTo: gmail.replyTo || org.billingEmail || me?.email || user.email || "",
        sendFromUser: gmail.sendFromUser,
        revokedAt: gmail.revokedAt,
        revokedReason: gmail.revokedReason,
        displayNamePlaceholder: org.name,
        replyToPlaceholder: me?.email ?? user.email ?? "",
        scopes: gmailConnected ? GMAIL_SCOPES.map((s) => s.split("/auth/")[1] ?? s) : [],
        connectHref: "/api/integrations/gmail/connect",
      },
      meta: {
        ...meta,
        comingSoon: !metaAllowed(me?.email ?? user.email),
        canManage: isOwnerOrManager(role),
        orgName: org.name,
        defaultPage: meta.pageName,
        formCategory: "auto",
        autoImport: meta.connected && parseMetaSettings(org.metaSettingsJson).autoCreate,
      },
      ramp: { ...ramp, canManage: isOwnerOrManager(role) },
      stripe: {
        key: "stripe",
        // Usable by OAuth (Connect configured) or by a pasted key (secret box).
        comingSoon: !(isStripeConnectConfigured() || isSecretBoxConfigured()),
        webhookUrl:
          connections.stripe.auth === "key" && connections.stripe.connectionId
            ? `${appUrl}/api/webhooks/stripe-key/${connections.stripe.connectionId}`
            : `${appUrl}/api/webhooks/stripe-connect`,
        lastEventAt: fmtWhen(lastStripeEvt?.receivedAt),
      },
      square: {
        key: "square",
        // Usable by OAuth (platform app) or by a pasted access token (secret box).
        comingSoon: !isSecretBoxConfigured(),
        webhookUrl:
          connections.square.auth === "token" && connections.square.connectionId
            ? `${appUrl}/api/webhooks/square-key/${connections.square.connectionId}`
            : `${appUrl}/api/webhooks/square`,
        lastEventAt: fmtWhen(lastSquareEvt?.receivedAt),
      },
      connections,
    },
    notifications: {
      prefs: parseNotificationPrefs(me?.notificationPrefsJson),
      sms: await loadSmsSettings(organizationId, me?.smsPhone ?? null, me?.smsVerifiedAt ?? null, role, sub?.plan ?? null, user.id),
    },
    desk: await loadDeskSettings(organizationId, role),
    website: { visible: await websiteVisible() },
  };
}

/** "(206) 555-0100" for a stored E.164 number. */
function prettyPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : e164;
}

/** The Text messages card (2026-09-24): the member's mobile, the company's
 *  extra numbers, this month's count. A missing table costs the card, never
 *  the page. */
async function loadSmsSettings(organizationId: string, smsPhone: string | null, smsVerifiedAt: Date | null, role: string, plan: string | null, myUserId: string | null = null): Promise<SmsSettingsData> {
  const { isTwilioEnabled } = await import("@/lib/sdk/twilio");
  const { smsAllowanceFor } = await import("@/lib/entitlements");
  const base: SmsSettingsData = {
    configured: await isTwilioEnabled(),
    phone: smsPhone ? prettyPhone(smsPhone) : null,
    verifiedAt: smsVerifiedAt ? smsVerifiedAt.toISOString() : null,
    stopped: false,
    extras: [],
    monthCount: 0,
    allowance: smsAllowanceFor(plan),
    canManage: ["OWNER", "ADMIN", "MANAGER"].includes(role),
    clientsOn: true,
    ownNumber: null,
    registration: null,
    leadTexts: { on: false, phone: null },
    roster: [],
    rules: [],
    companyName: "",
  };
  try {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const orgSms = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, smsClientsOn: true, smsFromNumber: true, phone: true, leadsSettingsJson: true } });
    // Who gets texted (2026-09-29): every member who can be — the office,
    // sales and estimators, the crew — with their mobile, whether they typed
    // it themselves or the office did, and their own Text switches.
    const [extras, monthCount, members, workers] = await Promise.all([
      db.notificationPhone.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, phone: true, active: true } }),
      db.smsMessage.count({ where: { organizationId, direction: "OUT", status: { in: ["SENT", "DELIVERED", "QUEUED"] }, createdAt: { gte: monthStart } } }),
      db.membership.findMany({
        where: { organizationId, role: { in: ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "SALES", "ESTIMATOR", "INSTALLER"] } },
        orderBy: { createdAt: "asc" },
        select: { role: true, user: { select: { id: true, name: true, email: true, smsPhone: true, smsVerifiedAt: true, notificationPrefsJson: true } } },
      }),
      db.workerProfile.findMany({ where: { organizationId }, select: { userId: true, displayName: true, phone: true, smsOptIn: true } }),
    ]);
    // Your own texts (2026-09-29) — absent before the table reaches a database.
    const ruleRows = await db.textRule.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }).catch(() => []);
    const workerOf = new Map(workers.map((w) => [w.userId, w]));
    const { parseNotificationPrefs, smsGroupsOf, audienceForRole, textCellsFor } = await import("@/lib/notificationPrefsShared");
    const { toE164 } = await import("@/lib/phone");
    const phonesToCheck = [smsPhone ?? "", ...extras.map((x) => x.phone), ...members.map((m) => m.user?.smsPhone ?? ""), ...workers.map((w) => (w.phone ? toE164(w.phone) ?? "" : ""))].filter(Boolean);
    const stops = await db.smsOptOut.findMany({ where: { phone: { in: phonesToCheck } }, select: { phone: true } });
    const stopped = new Set(stops.map((x) => x.phone));
    const roster: SmsRosterRow[] = [];
    for (const m of members) {
      const u = m.user;
      const audience = audienceForRole(m.role);
      if (!u || !audience) continue;
      const prefs = parseNotificationPrefs(u.notificationPrefsJson, m.role);
      const w = workerOf.get(u.id) ?? null;
      // The crew's number is the one its texts go to: the worker profile's,
      // when texting is on there. Everyone else: the member's own mobile.
      const workerPhone = w?.phone ? toE164(w.phone) : null;
      // Switched off on this page (prefs.smsPaused, 2026-10-13): the number waits on file, nothing is texted.
      const live = audience === "crew" && w ? (w.smsOptIn && workerPhone && !prefs.smsPaused ? workerPhone : null) : u.smsPhone && u.smsVerifiedAt && !prefs.smsPaused ? u.smsPhone : null;
      const known = live ?? workerPhone ?? u.smsPhone ?? null;
      roster.push({
        userId: u.id,
        name: u.name?.trim() || w?.displayName?.trim() || u.email || "Member",
        role: m.role,
        audience,
        phone: live ? prettyPhone(live) : null,
        phoneOnFile: !live && known ? prettyPhone(known) : null,
        phoneBy: live ? (prefs.smsAddedBy ? "office" : audience === "crew" && w && !u.smsVerifiedAt ? "office" : "self") : null,
        stopped: Boolean(live && stopped.has(live)),
        paused: !live && Boolean(known),
        isMe: u.id === myUserId,
        cells: textCellsFor(prefs, audience) as Record<string, boolean>,
        groups: smsGroupsOf(prefs),
      });
    }
    return {
      ...base,
      stopped: Boolean(smsPhone && stopped.has(smsPhone)),
      extras: extras.map((x) => ({ id: x.id, name: x.name, phone: prettyPhone(x.phone), active: x.active, stopped: stopped.has(x.phone) })),
      monthCount,
      clientsOn: orgSms?.smsClientsOn ?? true,
      // JobFlex's own company texts from the JobFlex line (lib/sms/houseLine, 2026-10-14).
      ownNumber: orgSms?.smsFromNumber ? prettyPhone(orgSms.smsFromNumber) : await houseNumber(organizationId),
      registration: base.canManage ? await loadRegistrationView(organizationId, myUserId) : null,
      leadTexts: { on: leadTextsOn(orgSms?.leadsSettingsJson), phone: orgSms?.phone?.trim() || null },
      roster,
      companyName: orgSms?.name ?? "",
      rules: ruleRows.map((r) => {
        let toUserIds: string[] = [];
        try {
          const v: unknown = r.toUserIdsJson ? JSON.parse(r.toUserIdsJson) : [];
          if (Array.isArray(v)) toUserIds = v.filter((x): x is string => typeof x === "string");
        } catch {
          /* an unreadable list names nobody */
        }
        return { id: r.id, name: r.name, trigger: r.trigger, offset: r.offset, toClient: r.toClient, toOffice: r.toOffice, toRep: r.toRep, toCrew: r.toCrew, toUserIds, body: r.body, active: r.active };
      }),
    };
  } catch {
    return base;
  }
}

/** JobFlex's lead texts are on only when the company turned them on (instantSms, stored true). */
function leadTextsOn(json: string | null | undefined): boolean {
  try {
    return (JSON.parse(json || "{}") as { instantSms?: unknown }).instantSms === true;
  } catch {
    return false;
  }
}

/** The JobFlex line JobFlex's own company texts from, pretty — null for every other company. */
async function houseNumber(organizationId: string): Promise<string | null> {
  try {
    const { houseLineFor } = await import("@/lib/sms/houseLine");
    const n = await houseLineFor(organizationId);
    return n ? prettyPhone(n) : null;
  } catch {
    return null;
  }
}

/** The company's own texting number (2026-10-02, lib/sms/registration): its state in words, the form prefilled. */
async function loadRegistrationView(organizationId: string, myUserId: string | null): Promise<SmsRegistrationView | null> {
  try {
    const { companyIsPaying, refreshRegistration } = await import("@/lib/sms/registration");
    const { prefillDetails, smsPagesFor, isTollFree } = await import("@/lib/sms/registrationShared");
    const { settingsOf } = await import("@/lib/bookingBook");
    const { readDeskSettings, numbersAssignedTo } = await import("@/lib/aiDesk/numbers");
    const { callsGo } = await import("@/lib/aiDesk/shared");
    const { isPageLocked } = await import("@/lib/customPageAccess");
    const { toE164 } = await import("@/lib/phone");
    const { jobflexSender } = await import("@/lib/sms/jobflexSender");
    const { houseLineFor } = await import("@/lib/sms/houseLine");
    const [state, paying, org, me, desk, phoneLocked, lent, jobflexOwn] = await Promise.all([
      refreshRegistration(organizationId),
      companyIsPaying(organizationId),
      db.organization.findUnique({ where: { id: organizationId }, select: { name: true, website: true, address: true, phone: true, slug: true, smsFromNumber: true, tradeTypesJson: true, bookingSettingsJson: true } }),
      myUserId ? db.user.findUnique({ where: { id: myUserId }, select: { name: true, email: true } }) : Promise.resolve(null),
      readDeskSettings(organizationId),
      isPageLocked(organizationId, "phone"),
      numbersAssignedTo(organizationId).catch(() => [] as string[]),
      jobflexSender().catch(() => null),
    ]);
    if (!org) return null;
    // The line JobFlex lent for calls (2026-10-14) — shown as the company's number until it registers one.
    const lentLine = state.number ? null : (lent[0] ?? null);
    const isJobflexOwn = Boolean(jobflexOwn && lentLine === jobflexOwn);
    const assigned = lentLine ? { number: prettyPhone(lentLine), jobflexOwn: isJobflexOwn, registrable: isTollFree(lentLine) && lentLine !== jobflexOwn, house: isJobflexOwn && Boolean(await houseLineFor(organizationId).catch(() => null)) } : null;
    // Calls (lib/aiDesk): wired at purchase; where they go is the desk's mode and the plan.
    const companyPhone = toE164(org.phone ?? "");
    const calls = {
      on: Boolean(state.number && state.voiceOnAt),
      go: callsGo({ mode: desk.mode, assistantOnPlan: !phoneLocked, companyPhone }),
      phone: companyPhone ? prettyPhone(companyPhone) : null,
    };
    // A number from the old instant button: on the company, never registered.
    const legacy = state.stage === "none" && Boolean(org.smsFromNumber);
    const canEdit = state.stage === "rejected" && state.editAllowed !== false && (!state.editUntil || Date.parse(state.editUntil) > Date.now());
    return {
      stage: state.stage,
      number: state.number ? prettyPhone(state.number) : legacy && org.smsFromNumber ? prettyPhone(org.smsFromNumber) : null,
      reasons: (state.reasons ?? []).map((r) => (r.code ? `${r.reason} (${r.code})` : r.reason)),
      editUntil: state.editUntil ?? null,
      canEdit,
      error: state.error ?? null,
      paying,
      legacy,
      bookingOn: settingsOf(org).enabled,
      calls,
      pages: smsPagesFor(org.slug),
      details: state.details ?? prefillDetails(org, { name: me?.name ?? null, email: me?.email ?? null }),
      assigned,
    };
  } catch {
    return null;
  }
}

/** What the owner's two cancel windows say (lib/freePlan): the plan's lines
 *  Free does not keep, and the company's own numbers (proposals sent, what
 *  they quoted, clients). */
async function cancelOffer(organizationId: string, plan: string, keepsUntil: Date | null, planName: string, accessAlreadyFree: boolean): Promise<NonNullable<BillingData["cancel"]>> {
  const slug = plan.toLowerCase();
  const [pages, catalog, sent, clients, deck] = await Promise.all([
    readCustomPages(organizationId, plan).catch(() => null),
    db.pricingPlan.findMany({ select: { slug: true, limitsJson: true } }),
    db.proposal.groupBy({ by: ["currency"], where: { organizationId, sentAt: { not: null } }, _count: { _all: true }, _sum: { total: true } }),
    db.client.count({ where: { organizationId, deletedAt: null } }),
    // The Deck Studio add-on on the subscription (lib/deckAddonBilling): the cancel ends it with the plan — named at
    // the price its line bills ($49/mo for one bought before 2026-10-26).
    readHeldDeckAddon(organizationId).catch(() => null),
  ]);
  const limitsOf = (s: string) => {
    const row = catalog.find((p) => p.slug.toLowerCase() === s);
    return row ? parsePlanLimits(row.limitsJson) : null;
  };
  const cap = (n: number | null | undefined) => (isUnlimited(n) ? null : (n as number));
  const own = limitsOf(slug === CUSTOM_PLAN_SLUG ? CUSTOM_PLAN_LIMITS_SLUG : slug);
  const free = limitsOf("free") ?? DEFAULT_FREE_LIMITS;
  return {
    planName,
    keepsUntil: keepsUntil?.toISOString() ?? null,
    losses: freePlanLosses({ pages, planProposals: cap(own?.proposalsCreated), freeProposals: cap(free.proposalsCreated), deckAddon: deck ? deckAddonHeldWords(deck.cents, deck.interval, { mark: false }) : null }),
    tally: {
      proposalsSent: sent.reduce((n, g) => n + g._count._all, 0),
      quoted: sent.length === 1 ? { amount: sent[0]._sum.total ?? 0, currency: sent[0].currency.toUpperCase() } : null,
      clients,
    },
    ...(accessAlreadyFree ? { accessAlreadyFree: true } : {}),
  };
}

type SubRow = Awaited<ReturnType<typeof db.subscription.findUnique>>;

/** Stripe gets this long per read in the manage window; past it, or on an
 *  error, the line is left out and Settings opens as usual. */
const STRIPE_READ_MS = 3000;
function withinStripeTime<T>(work: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), STRIPE_READ_MS);
  });
  return Promise.race([work.catch(() => null), late]).finally(() => clearTimeout(timer));
}

/** The owner's manage window (owner, 2026-10-17): price and term, the plan's
 *  date, the card, and — when nothing can be cancelled — the one line why
 *  (the subscription page's words). Price, term and date come from the
 *  database. Stripe (the card) is read only when `live` — the page opened on
 *  Billing — within STRIPE_READ_MS; a read that is skipped, slow or fails
 *  costs the card line, never the page. */
async function manageView(
  organizationId: string,
  sub: SubRow,
  s: {
    planDto: Awaited<ReturnType<typeof getOrgPlanContext>>["plan"];
    onFree: boolean;
    granted: boolean;
    booked: boolean;
    lapsed: boolean;
    stripeSub: boolean;
    live: boolean;
  },
): Promise<NonNullable<BillingData["manage"]>> {
  const custom = (sub?.plan ?? "").toLowerCase() === CUSTOM_PLAN_SLUG;
  const priced = !!sub && !s.onFree && !s.lapsed && !s.granted;
  const [term, pages, trialCard, liveCard] = await Promise.all([
    // The term is read from the database (PlanPrice / minted-price rows), never Stripe.
    priced ? planTermState(organizationId).catch(() => null) : null,
    priced && custom ? readCustomPages(organizationId, sub!.plan).catch(() => null) : null,
    s.live && !s.onFree && !s.lapsed ? withinStripeTime(trialCardLine(organizationId)) : null,
    s.live && s.stripeSub && !s.onFree && !s.lapsed && sub?.externalSubId
      ? withinStripeTime(getStripeClient().then(({ stripe }) => subscriptionCard(stripe, sub.externalSubId!)))
      : null,
  ]);
  const yearly = term?.currentInterval === "YEAR";
  const cents = s.granted
    ? 0
    : s.onFree
      ? 0
      : !priced
        ? null
        : s.planDto
          ? yearly
            ? (s.planDto.yearlyPriceCents ?? s.planDto.priceCents)
            : s.planDto.priceCents
          : custom
            ? customPriceCents(pages, yearly ? "YEAR" : "MONTH")
            : null;
  const price = cents === null ? null : s.granted ? "$0 / mo · free of charge" : `$${Math.round(cents / 100)} / ${yearly ? "yr" : "mo"}`;

  const future = (d: Date | null | undefined) => (d && d.getTime() > Date.now() ? d : null);
  const trialEnd = sub?.status === "TRIALING" ? future(sub.trialEndsAt) : null;
  const billAt = future(sub?.currentPeriodEnd ?? sub?.trialEndsAt ?? null);
  const date = s.onFree || s.lapsed
    ? null
    : s.granted
      ? sub?.currentPeriodEnd
        ? { label: "Complimentary until", value: longDate(sub.currentPeriodEnd) }
        : null
      : s.booked
        ? { label: "Switches to Free", value: freeSwitchDate(sub) ? longDate(freeSwitchDate(sub)!) : "End of cycle" }
        : trialEnd
          ? { label: "Trial ends", value: longDate(trialEnd) }
          : billAt
            ? { label: "Next bill", value: longDate(billAt) }
            : null;

  const card = trialCard ?? (liveCard ? { value: liveCard.kind === "none" ? "No card on file" : liveCard.label, addHref: null } : null);
  const canUpdateCard =
    s.stripeSub && !!sub?.externalCustomerId && ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"].includes(sub.status) && !trialCard?.addHref;

  // Why there is no cancel button (the subscription page's words, 2026-10-17).
  const noCancel = s.granted
    ? "Your plan is a complimentary grant from JobFlex — nothing is billed, so there is nothing to cancel."
    : s.onFree
      ? "You're on the Free plan — there is no paid subscription to cancel."
      : s.lapsed || (sub && sub.status === "EXPIRED")
        ? "Your plan has ended — there is nothing to cancel."
        : "There is no paid subscription on this account to cancel. Plans set up by JobFlex are canceled through support.";

  return { live: s.live, price, date, card, canUpdateCard: canUpdateCard && card !== null, noCancel };
}

/** The AI desk (2026-10-13, lib/aiDesk): who answers and what the desk knows. A missing piece costs the pane, never the page. */
/** The AI Desk workspace reuses the same reads without loading unrelated billing/integration settings. */
export async function loadDeskWorkspace(ctx: SettingsOrgContext) {
  if (!["OWNER", "ADMIN", "MANAGER"].includes(ctx.role)) {
    return { desk: null, registration: null };
  }
  const [desk, registration] = await Promise.all([
    loadDeskSettings(ctx.organizationId, ctx.role),
    loadRegistrationView(ctx.organizationId, ctx.user.id),
  ]);
  return { desk, registration };
}

/** The Texting page (2026-10-16: texting moved out of Settings onto /dashboard/texting, desk and handheld). The same
 *  `SmsSettingsData` Settings built, from the same reads — without the billing, integration and desk reads beside it.
 *  `null` = the org row is gone; each page answers that in its own words. */
export async function loadTextingWorkspace(ctx: SettingsOrgContext): Promise<SmsSettingsData | null> {
  const { organizationId, user, role } = ctx;
  const [me, org, sub] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { smsPhone: true, smsVerifiedAt: true } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { id: true } }),
    db.subscription.findUnique({ where: { organizationId }, select: { plan: true } }),
  ]);
  if (!org) return null;
  return loadSmsSettings(organizationId, me?.smsPhone ?? null, me?.smsVerifiedAt ?? null, role, sub?.plan ?? null, user.id);
}

async function loadDeskSettings(organizationId: string, role: string): Promise<DeskSettingsData> {
  const { readDeskSettings } = await import("@/lib/aiDesk/numbers");
  const { companyFacts } = await import("@/lib/aiDesk/facts");
  const { isPageLocked } = await import("@/lib/customPageAccess");
  const { isOpenAIEnabled } = await import("@/lib/sdk/openai");
  const { factsFor } = await import("@/lib/aiDesk/profile");
  const { businessFromTrades } = await import("@/lib/aiDesk/tradePresets");
  const { forwardCheckView } = await import("@/lib/aiDesk/forwardCheck");
  const { readForwardCheck } = await import("@/lib/aiDesk/forwardTest");
  const { toE164 } = await import("@/lib/phone");
  const { readDeskUse } = await import("@/lib/aiDesk/usage");
  const { deskMinutesView } = await import("@/lib/aiDesk/packs");
  const { numbersAssignedTo } = await import("@/lib/aiDesk/numbers");
  const { readRegistration } = await import("@/lib/sms/registration");
  const { settingsOf } = await import("@/lib/bookingBook");
  const { leadCallReadiness } = await import("@/lib/aiDesk/leadCalls");
  const canManage = ["OWNER", "ADMIN", "MANAGER"].includes(role);
  const [settings, facts, phoneLocked, use, minutes, assignedNumbers, registration, orgRow, leadCallsReady] = await Promise.all([
    readDeskSettings(organizationId).catch(() => null),
    companyFacts(organizationId).catch(() => null),
    isPageLocked(organizationId, "phone").catch(() => true),
    readDeskUse(organizationId),
    deskMinutesView(organizationId),
    numbersAssignedTo(organizationId),
    readRegistration(organizationId).catch(() => null),
    db.organization.findUnique({ where: { id: organizationId }, select: { phone: true, timezone: true, tradeTypesJson: true, bookingSettingsJson: true } }).catch(() => null),
    leadCallReadiness(organizationId).catch(() => ({ ok: false as const, why: "The desk can't place calls right now." })),
  ]);
  const bookingSettings = orgRow ? settingsOf(orgRow) : null;
  const { callsGo, parseDeskSettings, prettyPhone } = await import("@/lib/aiDesk/shared");
  const d = settings ?? parseDeskSettings(null);
  // A line JobFlex assigned to this company on /admin/health: its number for calls, with no registration of its own.
  const assigned = assignedNumbers[0] ? { number: prettyPhone(assignedNumbers[0]), go: callsGo({ mode: d.mode, assistantOnPlan: !phoneLocked, companyPhone: facts?.phone ?? null }), phone: facts?.phone ?? null } : null;
  return {
    canManage,
    aiConfigured: isOpenAIEnabled(),
    assistantOnPlan: !phoneLocked,
    mode: d.mode,
    voice: d.voice,
    forwarding: d.forwarding,
    businessPhone: orgRow?.phone?.trim() || null,
    timezone: orgRow?.timezone || "America/New_York",
    booking: {
      enabled: bookingSettings?.enabled ?? false,
      hoursWords: facts?.hoursWords ?? "",
      services: facts?.services ?? [],
      url: "/dashboard/booking",
    },
    steps: {
      number: Boolean(registration?.number || assignedNumbers[0]),
      profile: Boolean(d.profile),
      booking: Boolean(bookingSettings?.enabled),
      tested: use.calls + use.tests > 0,
    },
    use,
    minutes,
    assigned,
    brief: d.brief,
    profile: d.profile,
    profileUpdatedAt: d.profileUpdatedAt,
    questions: d.questions,
    business: d.business || businessFromTrades(facts?.trades ?? []),
    review: d.profile ? d.review : [],
    forwardCheck: forwardCheckView(await readForwardCheck(organizationId).catch(() => null), { forwarding: d.forwarding, phone: toE164(orgRow?.phone ?? ""), desk: toE164(registration?.number ?? "") ?? toE164(assignedNumbers[0] ?? "") }),
    facts: facts ?? factsFor({ name: "", phone: null, address: null, website: null, trades: [], hours: [], services: [], bookingUrl: null, timezone: null }),
    leadCalls: { ...d.leadCalls, ready: leadCallsReady.ok, why: leadCallsReady.ok ? null : leadCallsReady.why },
  };
}

/** Website estimators (2026-10-27): every account once the owner opens the feature; until then platform admins only. */
async function websiteVisible(): Promise<boolean> {
  const { webEstimatorOpen } = await import("@/lib/webEstimatorServer");
  if (await webEstimatorOpen()) return true;
  try {
    const { requirePlatformAdmin } = await import("@/lib/orgContext");
    await requirePlatformAdmin();
    return true;
  } catch {
    return false;
  }
}
