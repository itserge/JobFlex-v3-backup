// Blueprint layout — wraps the promoted blueprint pages (/dashboard and
// /dashboard/proposals) in the shared donor shell, so the sidebar and topbar
// mount once and persist across navigation between them.
//
// Scope: this layout only covers routes under src/app/dashboard/. The
// classic-shell children (/dashboard/proposals/new, /create, /[id], /ai,
// /templates and the rest) live under the (dashboard) route group, a separate
// branch of the tree, and keep their own layout untouched.
//
// The shell is wrapped in ResponsiveDashboardShell rather than mounted
// directly (owner's call, 2026-07-29): at ≤768px the two routes that have a
// handheld build serve it from this same URL, so the mobile design is reachable
// by resizing /dashboard into iPhone view instead of navigating to /mobile-v2.
// The switch lives at the LAYOUT, not in the pages, because the handheld build
// brings its own complete chrome — it replaces the shell, it does not render
// inside it.

// The sidebar's account block used to print the donor's demo identity — the
// literal strings "Ivan" / "Owner" — to every signed-in user. The real identity
// is read HERE, in the server layout, because the blueprint tree has no
// SessionProvider: `useSession()` inside the shell would return null. The read
// is deliberately non-fatal — an unauthenticated visitor is redirected by the
// PAGE, and a layout that threw would break that redirect before it ran.

// ROLE GATE (added 2026-08-17). This layout also carries the fail-CLOSED
// limited-role route gate that its sibling (dashboard)/layout.tsx has had since
// the RBAC rollout. The blueprint tree is a separate branch of app/, so it never
// inherited that layout — and the blueprint pages themselves only call
// requireOrg (authenticated + in an org), never a role guard. That left the
// middleware as the ONLY thing keeping an installer off /dashboard/financials,
// and the middleware is fail-OPEN by design: it decodes the JWT and, on any
// error, lets the request through. Same list, same helpers, same redirect as
// the classic tree — role from the DB, path from the middleware-set header.

import { redirect } from "next/navigation";
import type { Route } from "next";
import { cookies, headers } from "next/headers";
import { isLimitedRole, requireOrg } from "@/lib/orgContext";
import { hiddenPagesFor } from "@/lib/earlyAccess";
import { db } from "@/lib/db";
import { SETUP_PATH, needsCompanySetup } from "@/lib/orgSetup";
import { ROLE_ROUTE_GATES, isPathAllowed } from "@/lib/roleRoutes";
import { getBlockedCustomPages } from "@/lib/customPageAccess";
import { workspaceOf } from "@/lib/editionAccess";
import { unlockedByEdition } from "@/lib/editions";
import { canUseDesignStudio } from "@/lib/design/access";
import type { NavView } from "@/components/v3/blueprint-shell/nav-role";
import { UpgradeGate } from "@/components/v3/upgrade-gate/upgrade-gate";
import { isCustomBlockedPath } from "@/lib/customPlan";
import { getBadgeCounts } from "@/lib/badgeCounts";
import { getNavLimitState, type NavLimitInfo } from "@/lib/navLimits";
import { ResponsiveDashboardShell } from "@/components/v3/responsive-shell/responsive-dashboard-shell";
import { SIDEBAR_FOLD_COOKIE } from "@/components/v3/blueprint-shell/sidebar-fold";
import { LeadOfferPopup } from "@/components/leads/LeadOfferPopup";
import { DashboardAnnouncementDismiss } from "@/app/(dashboard)/announcement-dismiss";
import { AutoPlanWelcome } from "@/components/dashboard/AutoPlanWelcome";
import { autoPlanWelcomeView, type AutoPlanWelcomeView } from "@/lib/autoPlanWelcome";
import { metaStartTrialEvent, type MetaStartTrialEvent } from "@/lib/metaStartTrial";
import { MetaStartTrial } from "@/components/dashboard/MetaStartTrial";
import { metaCompleteRegistrationEvent, type MetaCompleteRegistrationEvent } from "@/lib/metaCompleteRegistration";
import { MetaPixelOnce } from "@/components/dashboard/MetaPixelOnce";
import { TrafficContext } from "@/components/providers/traffic-context";
import { TrialWatchMount } from "@/components/v3/trial-watch/trial-watch-mount";
import { trialView, type TrialView } from "@/lib/cardlessTrial";
import { trialDismissCookie, trialNoticeDismissed } from "@/lib/trialNotice";
import { TrialRibbon } from "@/components/v3/trial-card/trial-card";
import { PaymentRibbon } from "@/components/v3/payment-ribbon/payment-ribbon";
import { tourView, type TourView } from "@/lib/onboarding/progress";
import { OnboardingTour } from "@/components/v3/onboarding-tour/onboarding-tour";

/** Membership.role is a raw enum-ish string ("OWNER", "INSTALLER"). The
 *  sidebar shows it to a human, so title-case it. */
function humanRole(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export default async function DashboardBlueprintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user: { name: string; role: string } | undefined;
  // The RAW role, kept beside the humanised one: the nav filter matches on the
  // enum value ("INSTALLER"), the account block prints the pretty one.
  let role: string | null = null;
  let name: string | null = null;
  // Early-access pages (lib/earlyAccess) this account may not see — every page
  // on that list until the account is the allowlisted one. Hidden by default,
  // so a failed identity read never draws them.
  let hidden: string[] = hiddenPagesFor(null);
  // Unread / pending-action counts by nav href, for the sidebar and the
  // handheld drawer. Read HERE for the same reason the identity is: the badge
  // module is server-only (raw tenant ids, never client-invokable) and the
  // shell below is a client tree. Stale-until-refresh is by design — the
  // MarkNavSeen stamp on each surface calls router.refresh() when a badge was
  // actually showing, which re-renders this layout with fresh counts.
  let badges: Record<string, number> | undefined;
  // The custom plan's page locks: hrefs this org did not buy, or null on every
  // other plan. Read beside the identity because both come from the same ctx.
  let lockedPages: string[] | null = null;
  // THE EDITION'S VIEW (2026-10-11, lib/editions): the workspace, the deck rows unlocked, the switch.
  let navView: NavView = { workspace: "platform", unlocked: [], switchable: false };
  // Platform announcements — published from /admin/announcements, shown as a
  // banner on every organization's dashboard. Read HERE because the shell is a
  // client tree; a failed read costs the banner, never the page.
  let announcements: Array<{
    id: string;
    title: string;
    body: string;
    priority: number;
    createdAt: Date;
    expiresAt: Date | null;
  }> = [];
  // What is left of each metered page, for the sidebar's quota pills. Same
  // failure story as the badges: cosmetic, may fail quietly.
  let navLimits: Record<string, NavLimitInfo> | undefined;
  let navLimitsExempt = false;
  // Decided inside the try, acted on OUTSIDE it: redirect() throws, and the
  // catch below would swallow it.
  let needsSetup = false;
  // For the error reporter ($exception): which org and plan hit the error.
  // The plan slug as stored; a failed read costs the label, never the page.
  let organizationId: string | null = null;
  // Who is in the app, for the admin's live view (ids only; names are looked
  // up server-side when an admin asks).
  let userId: string | null = null;
  let plan: string | null = null;
  // The card-less trial's ribbon (lib/cardlessTrial): days left and the card
  // button, or "Trial ended" while the workspace is read-only. Null on every
  // other subscription; a failed read costs the ribbon, never the page.
  let trial: TrialView | null = null;
  // A declined renewal Stripe is retrying (PAST_DUE): "Payment failed ·
  // Update your card" over every page (components/v3/payment-ribbon).
  let paymentFailed = false;
  // Came in by the short sign-up (lib/signupAutoPlan): "you're on Professional — change it any time", for the owner.
  let autoWelcome: AutoPlanWelcomeView | null = null;
  // Meta's StartTrial, due on the live site in the first hour of a Stripe trial (lib/metaStartTrial).
  let startTrial: MetaStartTrialEvent | null = null;
  // Meta's CompleteRegistration, due on the live site in the first hour of a company (lib/metaCompleteRegistration).
  let registered: MetaCompleteRegistrationEvent | null = null;
  // The first-estimate tour (lib/onboarding/progress): its path, step and whether it offers itself.
  let tour: TourView | null = null;
  try {
    const ctx = await requireOrg();
    role = ctx.role;
    organizationId = ctx.organizationId;
    userId = ctx.user.id;
    name = ctx.user.name || ctx.user.email || "Account";
    hidden = hiddenPagesFor(ctx.user.email);
    // A Google signup lands here with a placeholder org. The owner finishes
    // the company step (address + trades) before the app opens — the same
    // step 2 a password signup cannot skip.
    if (ctx.role === "OWNER") {
      const org = await db.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { id: true, address: true, tradeTypesJson: true, name: true, createdAt: true, isInternal: true },
      });
      needsSetup = Boolean(org && needsCompanySetup(org));
      // Registered = the company step done; a Google sign-up still on its placeholder company is not yet.
      if (org && !needsSetup) registered = metaCompleteRegistrationEvent(org);
      autoWelcome = await autoPlanWelcomeView(ctx.organizationId);
    }
    user = { name, role: humanRole(ctx.role) };
    // SEPARATE awaits, each with its own failure story. Bundled in one
    // Promise.all, a transient badge-count failure (SQLite "database is
    // locked" under the dashboard's burst of parallel reads) rejected the
    // whole bundle, the outer catch swallowed it, and lockedPages stayed null
    // — the plan gate silently FAILING OPEN because unread counts hiccuped.
    // Badges may fail quietly (a missing badge is cosmetic); the gate read
    // retries once and is never allowed to take the badges down with it.
    badges = await getBadgeCounts(ctx.organizationId, ctx.user.id, ctx.role).catch(
      () => undefined,
    );
    lockedPages = await getBlockedCustomPages(ctx.organizationId).catch(() =>
      getBlockedCustomPages(ctx.organizationId),
    );
    // The Home Design Studio (lib/design/access): its sidebar row is drawn only for the accounts it opens to.
    const [ws, designPreview] = await Promise.all([
      workspaceOf(ctx.organizationId).catch(() => null),
      isLimitedRole(ctx.role) ? Promise.resolve(false) : canUseDesignStudio({ id: ctx.user.id, email: ctx.user.email }).catch(() => false),
    ]);
    // The studio opens to its preview too (owner, 2026-10-19): the row and the New estimate card open for every
    // account; the studio itself says what the add-on opens. A platform admin holds it (lib/editions, hasFullAccess).
    if (ws) navView = { workspace: ws.workspace, unlocked: ws.deckLevel !== "none" ? [...unlockedByEdition("deck")] : [], switchable: ws.switchable };
    // The lawn estimator (lib/lawn/access) opens to the same accounts as the studio.
    if (designPreview) navView = { ...navView, tools: ["/dashboard/design-studio", "/dashboard/lawn-estimator"] };
    announcements = await db.announcement
      .findMany({
        where: {
          scope: "PLATFORM",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        take: 6,
        select: { id: true, title: true, body: true, priority: true, createdAt: true, expiresAt: true },
      })
      .catch(() => []);
    const limitState = await getNavLimitState(ctx.organizationId).catch(() => undefined);
    navLimits = limitState?.counters;
    navLimitsExempt = limitState?.exempt ?? false;
    trial = await trialView(ctx.organizationId).catch(() => null);
    const planRow = await db.subscription
      .findUnique({ where: { organizationId: ctx.organizationId }, select: { plan: true, status: true } })
      .catch(() => undefined);
    plan = planRow === undefined ? null : (planRow?.plan ?? "FREE");
    paymentFailed = ["PAST_DUE", "UNPAID"].includes(planRow?.status ?? "");
    if (planRow?.status === "TRIALING") startTrial = await metaStartTrialEvent(ctx.organizationId);
    tour = await tourView({ user: ctx.user, organizationId: ctx.organizationId, role: ctx.role }).catch(() => null);
  } catch {
    // Signed out, or no membership yet. The page decides what happens next.
  }

  if (needsSetup) redirect(SETUP_PATH as Route);

  // Fail-closed: an unreadable path is not a pass. Only a role WITH a gate is
  // restricted, so office roles are untouched, and a signed-out visitor (role
  // null) still falls through to the page's own redirect-to-login.
  const gate = role ? ROLE_ROUTE_GATES[role] : undefined;
  if (gate) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (pathname && !isPathAllowed(gate, pathname)) redirect(gate.home as Route);
  }

  // THE CUSTOM PLAN'S PAGE GATE — same inputs as the role gate above (plan
  // from the DB, path from the middleware-set header, fail-closed), but it
  // RENDERS the upgrade offer at the blocked URL instead of redirecting
  // (owner's call, 2026-08-31): the nav draws locked pages as dimmed padlocked
  // rows that still navigate, and this is what they open onto. The children —
  // the page's own server component — are never rendered for a blocked path,
  // so the gate is the boundary, not a curtain.
  let customGate: React.ReactNode = null;
  if (lockedPages?.length) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (pathname && isCustomBlockedPath(lockedPages, pathname)) {
      customGate = <UpgradeGate pathname={pathname} locked={lockedPages} isOwner={role === "OWNER"} />;
    }
  }

  // The lead pop-up was mounted only in the CLASSIC layout, so on the blueprint
  // tree — which is where the app actually lives now — a lead routed to a shop
  // announced itself nowhere.
  //
  // OWNER ONLY. A lead carries a homeowner's name, phone and job description,
  // and it is the owner who answers for the shop: the arrival announces itself
  // to them and to nobody else. Everyone who can work a lead still SEES it —
  // managers and sales open the Leads page and act there — but the interruption
  // belongs to one person (owner's call, 2026-08-27; same rule as the email,
  // see lib/notify's ownerEmailFor).
  const canHandleLeads = role === "OWNER";

  // The folded sidebar is remembered in a cookie (not localStorage) so the
  // server paints it folded — a stored flag read after hydration would flash
  // the wide sidebar on every page load.
  const sidebarFolded = (await cookies()).get(SIDEBAR_FOLD_COOKIE)?.value === "1";
  // Not over the trial's own page, which says the same thing at full size.
  const onTrialPage = trial ? ((await headers()).get("x-pathname") ?? "").startsWith("/dashboard/trial") : false;
  // Nor once dismissed on this step (lib/trialNotice) — read here, so a
  // dismissed ribbon is never painted and then taken away.
  const trialDismissed =
    trial && organizationId ? trialNoticeDismissed(trial, (await cookies()).get(trialDismissCookie(organizationId))?.value) : false;

  return (
    <>
      {/* Outside the shell: on a phone the mapped handheld pages replace `children`, and this must mount on both. */}
      {startTrial ? <MetaStartTrial event={startTrial} /> : null}
      {registered ? <MetaPixelOnce name="CompleteRegistration" organizationId={registered.organizationId} /> : null}
      {/* Outside the shell for the same reason: the desk and the handheld trees both carry the tour. */}
      {tour ? <OnboardingTour view={tour} /> : null}
      <ResponsiveDashboardShell
        sidebarFolded={sidebarFolded}
        user={user}
        identity={{ role, name, hidden, view: navView }}
        badges={badges}
        locked={lockedPages ?? undefined}
        limits={navLimits}
        limitsExempt={navLimitsExempt}
        handheldBanner={
          trial && !onTrialPage ? (
            trialDismissed ? null : <TrialRibbon view={trial} isOwner={role === "OWNER"} orgId={organizationId ?? ""} only="dock" />
          ) : paymentFailed ? (
            <PaymentRibbon isOwner={role === "OWNER"} only="dock" />
          ) : null
        }
        overviewNotice={
          autoWelcome || announcements.length > 0 ? (
            <>
              {autoWelcome ? <AutoPlanWelcome view={autoWelcome} /> : null}
              {announcements.length > 0 ? <DashboardAnnouncementDismiss announcements={announcements} /> : null}
            </>
          ) : null
        }
      >
        <TrafficContext role={role} plan={plan} organizationId={organizationId} userId={userId} />
        {organizationId && <TrialWatchMount />}
        {trial && !onTrialPage && !trialDismissed && <TrialRibbon view={trial} isOwner={role === "OWNER"} orgId={organizationId ?? ""} />}
        {paymentFailed && !trial && <PaymentRibbon isOwner={role === "OWNER"} />}
        {autoWelcome && <AutoPlanWelcome view={autoWelcome} />}
        {announcements.length > 0 && <DashboardAnnouncementDismiss announcements={announcements} />}
        {customGate ?? children}
        {canHandleLeads ? <LeadOfferPopup /> : null}
      </ResponsiveDashboardShell>
    </>
  );
}
