"use client";

// Viewport switch for the promoted blueprint routes.
//
// /dashboard and /dashboard/proposals now serve BOTH designs from one URL: the
// desktop blueprint shell above 768px, the handheld rebuild at or below it.
// The switch is a MEDIA QUERY, never the user agent — the mobile-first rule
// forbids UA detection, and a query is also the only thing that makes DevTools'
// device toolbar work: drag the viewport under 768px and the surface swaps
// live, no reload and no second URL to remember.
//
// Exactly one tree is mounted, never both. That matters more than it looks.
// The mobile shell is `position: fixed; inset: 0` and its mount effect sets
// `body { overflow: hidden }` — rendering it on top of a live desktop shell
// would strand the desktop page's scroll and leave twenty-odd sidebar links
// sitting in the tab order underneath an opaque overlay.
//
// Routes with no handheld build yet (/dashboard/leads, /jobs, /crm, /calendar,
// …) fall through to the desktop shell at every width, deliberately: a page
// you have to pan around beats a half-built mobile one.

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import "@/components/v3/who/who.css";
import { useEffect, useSyncExternalStore } from "react";
import { bindSmoothWheel } from "@/lib/smooth-wheel";
import { BlueprintShell } from "@/components/v3/blueprint-shell/blueprint-shell";
import { BlueprintHandheldFrame } from "./blueprint-handheld-frame";
import { type NavLimit, NavRoleProvider, type NavIdentity } from "@/components/v3/blueprint-shell/nav-role";
import { CustomGateSwap } from "@/components/v3/upgrade-gate/custom-gate-swap";
import { ChunkRecoveryBoundary } from "@/components/v3/shared/chunk-recovery-boundary";
import { SupportWidget } from "@/components/v3/support-widget/support-widget";
import { MarkNavSeen } from "@/components/layout/MarkNavSeen";
import { LeadOfferPopup } from "@/components/leads/LeadOfferPopup";
import type { SeenKey } from "@/lib/badgeCounts";

/** CLAUDE.md's handheld target: ≤768px. Matches the mobile modules' own scale. */
const HANDHELD = "(max-width: 768px)";

// Paper-coloured full-bleed hold for the one chunk fetch that happens when the
// viewport first crosses 768px. Without it `dynamic` renders null and the swap
// blinks through to whatever is behind the app — reads as a crash rather than
// a load. Inline styles on purpose: this has to paint before any CSS module
// for the tree it is standing in for has been fetched, which is also why the
// #f2f0eb drafting cream is written out rather than read from --paper.
const MobileHold = () => (
  <div style={{ position: "fixed", inset: 0, zIndex: 20, background: "#f2f0eb" }} />
);

// The mobile route components, imported out of the (mobile) group rather than
// copied, so /mobile-v2 and /dashboard cannot drift apart — there is one
// implementation with two entry points. Lazy so a desktop visitor never
// downloads either bundle; /dashboard is the app's busiest page and should not
// carry a handheld build it will not render.
const MobileDashboard = dynamic(
  () => import("@/app/(mobile)/mobile-v2/mobile-dashboard").then((m) => m.MobileDashboard),
  { ssr: false, loading: MobileHold },
);
const MobileProposals = dynamic(
  () => import("@/app/(mobile)/mobile-proposals-v2/mobile-proposals").then((m) => m.MobileProposals),
  { ssr: false, loading: MobileHold },
);
const MobileClients = dynamic(
  () => import("@/app/(mobile)/mobile-clients-v2/mobile-clients").then((m) => m.MobileClients),
  { ssr: false, loading: MobileHold },
);
// Batch of nine, 2026-07-29: one agent per page, all on the shared MobileNav.
const MobileLeads = dynamic(
  () => import("@/app/(mobile)/mobile-leads-v2/mobile-leads").then((m) => m.MobileLeads),
  { ssr: false, loading: MobileHold },
);
const MobileProjects = dynamic(
  () => import("@/app/(mobile)/mobile-projects-v2/mobile-projects").then((m) => m.MobileProjects),
  { ssr: false, loading: MobileHold },
);
const MobileCrm = dynamic(
  () => import("@/app/(mobile)/mobile-crm-v2/mobile-crm").then((m) => m.MobileCrm),
  { ssr: false, loading: MobileHold },
);
const MobileCalendar = dynamic(
  () => import("@/app/(mobile)/mobile-calendar-v2/mobile-calendar").then((m) => m.MobileCalendar),
  { ssr: false, loading: MobileHold },
);
const MobileJobs = dynamic(
  () => import("@/app/(mobile)/mobile-jobs-v2/mobile-jobs").then((m) => m.MobileJobs),
  { ssr: false, loading: MobileHold },
);
const MobileWorkers = dynamic(
  () => import("@/app/(mobile)/mobile-workers-v2/mobile-workers").then((m) => m.MobileWorkers),
  { ssr: false, loading: MobileHold },
);
const MobileCompany = dynamic(
  () => import("@/app/(mobile)/mobile-company-v2/mobile-company").then((m) => m.MobileCompany),
  { ssr: false, loading: MobileHold },
);
const MobileFinancials = dynamic(
  () => import("@/app/(mobile)/mobile-financials-v2/mobile-financials").then((m) => m.MobileFinancials),
  { ssr: false, loading: MobileHold },
);
// The Automation section, 2026-07-30: the ten remaining drawer surfaces. Mostly
// NOT ledgers — a composer, two drawing tools, a dialer, a thread view, three
// feeds, a board and a charts page — so these vary far more in shape than the
// list pages above, while sharing the same nav, tokens and motion.
const MobileSmartProposal = dynamic(
  () => import("@/app/(mobile)/mobile-advanced-ai-v2/mobile-advanced-ai").then((m) => m.MobileSmartProposal),
  { ssr: false, loading: MobileHold },
);
// NOT here either — the roof and fence estimators (2026-09-08). Their handheld
// builds (/mobile-roof-estimator-v2, /mobile-fence-estimator-v2) are still the
// donor FIXTURES: the roof one "measures" any address with canned numbers and
// its "Convert to proposal" only flips a label, the fence one has no map and so
// no property lines. A tester on a phone was told a proposal existed that did
// not. Until those two get their data layer, the phone gets the real blueprint
// pages, which carry their own ≤860px rules.
const MobileMessages = dynamic(
  () => import("@/app/(mobile)/mobile-messages-v2/mobile-messages").then((m) => m.MobileMessages),
  { ssr: false, loading: MobileHold },
);
// NOT here — five handheld builds whose data is the PAGE's, so each route sits
// in PAGE_OWNED_STATIC below and its own page owns the switch (2026-09-03):
// referrals, reports, trade, reviews and phone. Before that they were mounted
// from this map with no props at all and drew donor fixtures on a phone while
// the desk drew the org's real rows.
// The manual builder, 2026-07-30. Its estimator PICKER has no handheld page of
// its own — it is a dialog mounted in MobileNav, reachable from every mobile
// surface — so only the builder needs a route here.
const MobileManualBuilder = dynamic(
  () =>
    import("@/app/(mobile)/mobile-manual-builder-v2/mobile-manual-builder").then(
      (m) => m.MobileManualBuilder,
    ),
  { ssr: false, loading: MobileHold },
);

/** Add a route here the day its handheld build lands. */
const HANDHELD_SURFACES: Record<string, React.ComponentType> = {
  "/dashboard": MobileDashboard,
  "/dashboard/proposals": MobileProposals,
  "/dashboard/clients": MobileClients,
  "/dashboard/leads": MobileLeads,
  "/dashboard/projects": MobileProjects,
  "/dashboard/crm": MobileCrm,
  "/dashboard/calendar": MobileCalendar,
  "/dashboard/jobs": MobileJobs,
  "/dashboard/workers": MobileWorkers,
  "/dashboard/company": MobileCompany,
  "/dashboard/financials": MobileFinancials,
  // Automation. The route slug /dashboard/advanced-ai is historical; the
  // surface is called Smart Proposal everywhere a user can see it.
  "/dashboard/advanced-ai": MobileSmartProposal,
  // /dashboard/roof-estimator and /dashboard/fence-estimator: real pages on
  // every viewport — see the note above the dynamic imports.
  "/dashboard/messages": MobileMessages,
  "/dashboard/estimators/manual": MobileManualBuilder,
};

/** Routes whose PAGE owns the handheld switch because the map above cannot:
 *  a dynamic pathname, and a handheld build that needs the page's server data.
 *  Deliberately anchored and single-segment — see the guard's comment below.
 *
 *  · /dashboard/projects/<id> — mobile-project-detail/project-detail-viewport-switch
 *  · /dashboard/jobs/<id>     — mobile-job-detail/job-detail-viewport-switch
 *
 *  Single-segment anchoring is what keeps the static siblings out: /dashboard/
 *  projects/new and /dashboard/jobs/new match neither branch, and the list
 *  pages /dashboard/projects and /dashboard/jobs are handled by the map above,
 *  which returns before this line. */
const PAGE_OWNED_HANDHELD = /^\/dashboard\/(projects|jobs)\/[^/]+$/;

/** Static routes whose PAGE owns the switch for the other reason: the handheld
 *  build needs the page's server data, so it cannot be a props-less component
 *  mounted from this layout.
 *
 *  · /dashboard/subscription — the URL the sidebar's Subscription button
 *    points at (the promoted route; its handheld half was folded in
 *    2026-08-18). The handheld half is the real-data
 *    components/v3/mobile-subscription build, fed by the page's own loader; see
 *    app/dashboard/subscription/subscription-responsive.tsx.
 *  · /dashboard/subscription-blueprint — the responsive staging route; it
 *    renders the SAME switch through a re-export, so it needs the same
 *    exemption for as long as it stands.
 *  · /dashboard/client-detail — the record the handheld clients book opens
 *    (2026-08-15). It was the one surface reachable from a mobile page with no
 *    mobile chrome: the desktop topbar was clipped off the right edge of a
 *    390px viewport and there was no hamburger, so there was no way back into
 *    the app. Its handheld half is the SAME ClientDetailContent — the page body
 *    already collapses — wrapped in the fleet's MobileNav by
 *    components/v3/client-detail-blueprint/client-detail-viewport-switch.tsx,
 *    which needs the `?client=` row the page's own loader read. */
const PAGE_OWNED_STATIC = new Set([
  "/dashboard/subscription",
  // Plans & upgrade: its page-level switch (dashboard/upgrade/upgrade-responsive.tsx)
  // carries the server-read catalog + plan into both editions (2026-09-02).
  "/dashboard/upgrade",
  "/dashboard/subscription-blueprint",
  "/dashboard/client-detail",
  // Both editions need the org's next ticket number and whether the estimator
  // key is configured — server facts — so the switch lives with the page
  // (video-estimator-blueprint/video-estimator-viewport-switch.tsx) rather than
  // in the props-less map above. Added 2026-08-22 with the wired estimator;
  // before it, a phone on this URL got the desktop page and no handheld nav.
  "/dashboard/video-estimator",
  // The 2026-09-03 sweep. Each of these five handheld builds used to be
  // mounted props-less from the map above and drew the donor's demo fixture on
  // a phone while the desk drew the org's real rows: BELL-4T9K and eight
  // Seattle roofers on Referrals, $221,250 collected on Reports, a seven-post
  // board on Trade, an 11-record book on Reviews, a ten-call log on Phone.
  // Every one now reads its page's own loader through that page's switch
  // (app/dashboard/<route>/<route>-responsive.tsx), and every control that
  // only mutated local state is either wired to the real server action or
  // gone.
  "/dashboard/referrals",
  "/dashboard/reports",
  "/dashboard/trade",
  "/dashboard/reviews",
  "/dashboard/phone",
  // Hire & Work, rebuilt 2026-09-03. Both editions need the open board, the
  // caller's own posts and who the caller is — all server reads — so the
  // switch lives with the page (hire-blueprint/hire-viewport-switch.tsx). The
  // old page's handheld twin was mounted props-less from the map above and was
  // deleted with it; until this entry, a phone following the sidebar's Hire
  // link got the desktop board.
  "/dashboard/hire",
  // Settings, wired 2026-09-03. Both editions need the one SettingsData read
  // (src/lib/settings/loadSettingsData.ts) plus the resolved `?pane=` deep
  // link, so the switch lives with the page
  // (app/dashboard/settings/settings-responsive.tsx). Until this entry, a phone
  // following the sidebar's Settings link got the desktop hub.
  "/dashboard/settings",
  // Texting, its own page since 2026-10-16 (it was Settings → Texting): both
  // editions take the page's one sms read (app/dashboard/texting/texting-responsive.tsx).
  "/dashboard/texting",
  // Support, moved into the blueprint tree 2026-10-17: both editions take the
  // page's read of the viewer's own tickets (app/dashboard/support/support-responsive.tsx);
  // the handheld build brings BlueprintHandheldFrame as its chrome.
  "/dashboard/support",
]);

/** Mapped handheld surfaces that do NOT render <MobileNav />.
 *
 *  /dashboard (mobile-v2) is the fleet's oldest handheld page and the only one
 *  that kept its own inline topbar, drawer and bottom bar when the other 21
 *  moved onto the shared nav. Anything MobileNav mounts for every surface — the
 *  estimator picker, the support widget — therefore has to be mounted for this
 *  one from here. Verified by grep, not assumed: every other entry in
 *  HANDHELD_SURFACES and every PAGE_OWNED branch imports mobile-shell/mobile-nav.
 *  The day mobile-v2 adopts MobileNav, this set empties and goes. */
const NO_MOBILE_NAV = new Set(["/dashboard"]);

/** Seen-stamps for the HANDHELD branch. The desktop edition stamps from each
 *  server page.tsx (<MarkNavSeen /> in the returned tree), but at ≤768px this
 *  shell renders the mapped mobile component INSTEAD of the page's children —
 *  the stamp in the page never mounts, and a badge a phone visit should clear
 *  would survive the visit. So the handheld branch stamps here, keyed by
 *  route. Deliberately absent:
 *  · /dashboard/jobs — the offers popup stamps it (owner request 2026-08-21),
 *    on both viewports; a route-level stamp would clear it on mere arrival.
 *  · /dashboard/messages — clears per-thread via markConversationRead. */
const HANDHELD_SEEN: Record<string, SeenKey> = {
  "/dashboard/leads": "leads",
  "/dashboard/proposals": "proposals",
  "/dashboard/calendar": "calendar",
  "/dashboard/workers": "workers",
  // Gone with the 2026-09-03 sweep: referrals, trade, phone and reviews are
  // page-owned now, so each page's own <MarkNavSeen /> mounts on BOTH
  // viewports and a stamp here would be a second, duplicate one.
};

// Module-scope so the identities are stable across renders — a fresh
// `subscribe` on every render makes useSyncExternalStore re-subscribe each
// time, which on a resize-driven store means tearing down the listener in the
// middle of the resize that triggered the render.
function subscribe(onStoreChange: () => void) {
  const mq = window.matchMedia(HANDHELD);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}
const getSnapshot = () => window.matchMedia(HANDHELD).matches;
// The server cannot know the viewport, so it renders desktop and the client
// corrects during hydration. A phone therefore shows desktop for one frame;
// the alternative — render nothing until mounted — flashes blank for every
// visitor on every route, which is a worse trade.
const getServerSnapshot = () => false;

/** Blueprint routes with NO handheld build of their own that should still get
 *  the handheld chrome rather than the desk shell. The page's own markup is
 *  kept; only the frame around it changes (BlueprintHandheldFrame).
 *
 *  /dashboard/manual-blueprint is here because it is where the mobile "New
 *  Proposal" button now lands, and on a phone it was arriving inside the desk
 *  sidebar's chrome with no bottom nav — the one page you could not navigate
 *  out of with a thumb. There is no mobile-manual-builder BLUEPRINT page yet;
 *  the /mobile-manual-builder-v2 build is the older design. When a real
 *  handheld build lands, move the route to HANDHELD_SURFACES above. */
const BLUEPRINT_HANDHELD = new Set([
  "/dashboard/manual-blueprint",
  // The three inventory dashboards (2026-09-20): one responsive component
  // (trade-board) whose stylesheet collapses to a single column at ≤768px, so
  // a phone keeps the page and gets the handheld nav around it.
  // …since 2026-09-29 one page for all three, /dashboard/inventory: the book
  // becomes a list of rows that open, the sheet fills the width, and the
  // stock tab is the same responsive workspace it always was.
  "/dashboard/inventory",
  // …and since 2026-10-10 each trade's own, under its estimator.
  "/dashboard/roof-estimator/inventory",
  "/dashboard/fence-estimator/inventory",
  "/dashboard/hvac-estimator/inventory",
  // HVAC services (2026-10-18): the service desk is one responsive page — tabs, then single-column cards.
  "/dashboard/hvac-estimator/service-desk",
  // The three estimators (2026-10-02). Their pages already carry ≤860px
  // rules and read fine on a phone; what a phone was getting around them was
  // the DESK chrome — the sidebar's topbar with its search box clipped to
  // "Search clients, p…", no product mark, no drawer — because their old
  // handheld twins were fixtures (see the note above the dynamic imports) and
  // the fall-through was the lesser evil. The frame is the middle path that
  // note was waiting for: the real page, the handheld nav around it.
  "/dashboard/roof-estimator",
  "/dashboard/fence-estimator",
  "/dashboard/hvac-estimator",
  // The Deck Studio (2026-10-04): one responsive page, its steps a single
  // column and the 3D on top at ≤768px.
  "/dashboard/deck-estimator",
  // The blueprint estimator (2026-10-13): one responsive page — upload, ask,
  // the answer — a single column at ≤768px.
  "/dashboard/blueprint-estimator",
  // Online booking (2026-10-28): one responsive page; its stylesheet restacks every section for a phone at <=768px.
  "/dashboard/booking",
  // Tutorials (2026-11-11): one responsive page — the cards in one column, the player over its chapters at <=768px.
  "/dashboard/tutorials",
]);

export function ResponsiveDashboardShell({
  children,
  sidebarFolded,
  user,
  identity,
  badges,
  locked,
  limits,
  limitsExempt,
  handheldBanner,
  overviewNotice,
}: {
  children: React.ReactNode;
  /** A banner the layout passes inside `children` (the card-less trial's
   *  ribbon) — repeated here for the mapped handheld surfaces, which render
   *  their own component INSTEAD of children and would drop it. */
  handheldBanner?: React.ReactNode;
  /** The mobile Overview replaces children; keep announcements in its scroller. */
  overviewNotice?: React.ReactNode;
  /** Signed-in identity, read in the server layout and handed to the desktop
   *  sidebar. The handheld shell draws its own account row. */
  user?: { name: string; role: string };
  /** The same identity with the RAW role, published to every client piece that
   *  filters by it — the desktop sidebar, the handheld drawer mounted deep
   *  inside a mobile page, and the command palette. It wraps BOTH branches
   *  below, because the drawer is inside the handheld one. */
  identity?: NavIdentity;
  /** Unread/pending counts by nav href, read server-side in the layout
   *  (getBadgeCounts). Published through the same provider the identity rides,
   *  for the same reason: the two nav shells sit at very different depths. */
  badges?: Record<string, number>;
  /** Custom-plan blocked hrefs (lib/customPageAccess), same provider, same
   *  reason: every nav filter at every depth reads one list. */
  locked?: string[];
  /** Remaining plan quota by nav href (lib/navLimits) for the sidebar pills. */
  limits?: Record<string, NavLimit>;
  /** The caps do not apply to this user here (getNavLimitState). */
  limitsExempt?: boolean;
  /** The desktop sidebar starts folded (the jf_sb cookie, read in the layout). */
  sidebarFolded?: boolean;
}) {
  const isHandheld = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const pathname = usePathname();
  useEffect(() => {
    if (pathname !== "/dashboard/phone" && pathname !== "/dashboard/texting") return;
    return bindSmoothWheel(document);
  }, [pathname]);

  const Handheld = HANDHELD_SURFACES[pathname ?? ""];
  // Wrapped because every entry in the map above is a `dynamic(…, { ssr:false })`
  // chunk fetched at navigation time. When a deploy lands under a tab that is
  // already open, that fetch 404s and React surfaces the dead import as the
  // generic client-side exception; the boundary spends one reload picking up
  // the new build instead. Keyed on the pathname so navigating off a surface
  // whose chunk is missing clears the panel rather than carrying it along.
  if (isHandheld && Handheld) {
    const seenSurface = HANDHELD_SEEN[pathname ?? ""];
    return (
      <NavRoleProvider identity={identity} badges={badges} locked={locked} limits={limits} limitsExempt={limitsExempt}>
        {/* Keyed: this shell persists across navigation, and MarkNavSeen only
            stamps once per mount — a new key remounts it for the new surface. */}
        {seenSurface && <MarkNavSeen key={seenSurface} surface={seenSurface} />}
        {handheldBanner}
        <ChunkRecoveryBoundary resetKey={pathname ?? ""}>
          <CustomGateSwap handheld>
            {pathname === "/dashboard" ? <MobileDashboard notice={overviewNotice} /> : <Handheld />}
          </CustomGateSwap>
        </ChunkRecoveryBoundary>
        {/* The support composer. Every other handheld surface gets it from
            <MobileNav />; /dashboard is the one mapped surface that kept its
            own topbar and drawer instead of the shared nav, so its copy is
            mounted from out here. Its LAUNCHER is the Help button in that
            page's own topbar (mobile-v2/mobile-dashboard.tsx) — nothing floats
            at this width, which is what keeps the button off the error toast's
            only dismiss control. Mounted last so the sheet paints over the
            page, which is `position: fixed; z-index: 20`. */}
        {NO_MOBILE_NAV.has(pathname ?? "") && (
          <SupportWidget signedIn={Boolean(identity?.name)} />
        )}
        {/* THE LEAD POP-UP, ON A PHONE.
            This branch renders the mapped handheld surface INSTEAD of
            `children`, and the layout passes <LeadOfferPopup /> inside
            `children` — so on every handheld route of the dashboard, the
            "a lead is reserved for your shop" interrupt was dropped on the
            floor. Found in the 2026-09-17 Lead Center run: the offer card
            showed in the Leads inbox at 390px, the pop-up appeared at 1440px,
            and nothing at all announced a routed lead to someone holding a
            phone — which is most of this fleet's audience.
            Mounted here rather than in the layout because this is the one
            branch that discards children; the page-owned branches below keep
            them and already carry it. Same OWNER gate the layout applies (see
            its canHandleLeads note), read off the published identity. Its own
            stylesheet already had the ≤768px rules — it was only ever missing
            a mount. */}
        {identity?.role === "OWNER" && <LeadOfferPopup />}
      </NavRoleProvider>
    );
  }

  // Project detail (2026-08-12) and job detail (2026-08-13) — the two routes
  // the map above cannot express. Both are DYNAMIC (/dashboard/projects/<cuid>,
  // /dashboard/jobs/<id>), so no literal key matches them. So the PAGE owns the
  // switch, on the same (max-width: 768px) query, and this guard is the other
  // half of it: at handheld width the shell renders the page bare rather than
  // wrapping a self-contained fixed-position tree in the desktop chrome, which
  // would put both trees in the DOM at once. Above 768px nothing changes.
  //
  // Scope of the pattern, checked for BOTH branches: the list pages
  // /dashboard/projects and /dashboard/jobs are matched by the map above and
  // return before this line; /dashboard/projects/new and /dashboard/jobs/new
  // both live in the (dashboard) route group, a different layout that never
  // mounts this shell, so the single-segment pattern matching them is inert;
  // no other route under this layout has a second path segment.
  // Page-owned handheld branches render their own chrome (which reaches for
  // MobileNav), so they need the provider just as much as the mapped ones.
  if (isHandheld && PAGE_OWNED_HANDHELD.test(pathname ?? "")) {
    return (
      <NavRoleProvider identity={identity} badges={badges} locked={locked} limits={limits} limitsExempt={limitsExempt}>
        <CustomGateSwap handheld>{children}</CustomGateSwap>
      </NavRoleProvider>
    );
  }
  if (isHandheld && PAGE_OWNED_STATIC.has(pathname ?? "")) {
    return (
      <NavRoleProvider identity={identity} badges={badges} locked={locked} limits={limits} limitsExempt={limitsExempt}>
        <CustomGateSwap handheld>{children}</CustomGateSwap>
      </NavRoleProvider>
    );
  }
  if (isHandheld && BLUEPRINT_HANDHELD.has(pathname ?? "")) {
    return (
      <NavRoleProvider identity={identity} badges={badges} locked={locked} limits={limits} limitsExempt={limitsExempt}>
        <BlueprintHandheldFrame>
          <CustomGateSwap>{children}</CustomGateSwap>
        </BlueprintHandheldFrame>
      </NavRoleProvider>
    );
  }

  // THE DESK SHELL, AND WHETHER A PHONE MAY SEE IT. The server renders this
  // branch for every route (it cannot know the viewport), so on a phone the
  // desk layout is what the streamed HTML PAINTS while the client bundle is
  // still loading — the sidebar, the fluid-scaled column, the desk topbar — and
  // hydration then swaps it for the handheld tree. On a reload that read as
  // "some other design for a second, then the real one". For a route that HAS
  // a handheld branch above, the desk paint is never what a phone should see,
  // so the shell is marked and a global rule hides it at handheld width until
  // the swap (app/globals.css, `[data-desk-fallback]`). Routes with no
  // handheld build stay unmarked: the desk shell IS their phone layout.
  const switchable =
    Boolean(Handheld) ||
    BLUEPRINT_HANDHELD.has(pathname ?? "") ||
    PAGE_OWNED_STATIC.has(pathname ?? "") ||
    PAGE_OWNED_HANDHELD.test(pathname ?? "");
  const desk = (
    <BlueprintShell user={user} sidebarFolded={sidebarFolded}>
      <CustomGateSwap>{children}</CustomGateSwap>
    </BlueprintShell>
  );
  // The wrapper is ALWAYS there and only its mark comes and goes (2026-10-11):
  // a desk drawn bare on one route and inside the wrapper on the next is a
  // different tree to React, which remounted the whole shell between them —
  // the sidebar replayed its entry cascade and the plate appeared on its row
  // without sliding (Deck inventory, Online booking, Service plans and back).
  return (
    <NavRoleProvider identity={identity} badges={badges} locked={locked} limits={limits} limitsExempt={limitsExempt}>
      <div data-desk-fallback={switchable ? "" : undefined} style={{ display: "contents" }}>
        {desk}
      </div>
    </NavRoleProvider>
  );
}
