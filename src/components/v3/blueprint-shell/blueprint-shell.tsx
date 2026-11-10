"use client";

// Blueprint shell — the persistent chrome for every blueprint page.
//
// Mounted from src/app/dashboard/layout.tsx, so the sidebar, topbar, sprite
// and graph-paper field survive navigation: moving between /dashboard and
// /dashboard/proposals swaps ONLY the contents of `.content`, which fades up
// via the donor's reveal cascade. Previously each page owned its own copy of
// the whole shell, so every navigation tore the chrome down and replayed the
// 21-item sidebar cascade — the "screen reload" flicker this replaces.
//
// CSS: both page modules are imported here and both `.bp` classes are applied
// to the root. Every donor rule inside them is `:global(...)`, so they match
// descendants no matter which component imported them — that is what lets one
// shell serve both pages without rewriting either stylesheet. The two tokens
// the donors disagree on are arbitrated in blueprint-global.css via
// `[data-page]`.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { initBlueprintShell, type ShellHandle } from "./shell-behavior";
import { CommandPalette } from "./command-palette";
import { EstimatorPicker } from "@/components/v3/estimators-blueprint/estimator-picker";
import { RepairSheet } from "@/components/v3/repairs/repair-sheet";
import { PaymentsSheet } from "@/components/v3/payments-panel/payments-sheet";
import { ProposalMoreSheet } from "@/components/v3/proposal-more/proposal-more-sheet";
import { FilingChip } from "@/components/v3/filing-chip/filing-chip";
import { PlanLimitDialog } from "@/components/billing/PlanLimitDialog";
import { SupportWidget } from "@/components/v3/support-widget/support-widget";
import { OverlayLayer } from "./overlay-layer";
import { Sprite } from "./sprite";
import { Sidebar, type SidebarUser } from "./sidebar";
import { writeSidebarFold } from "./sidebar-fold";
import { Topbar } from "./topbar";
import proposalStyles from "@/components/v3/proposals-blueprint/proposals.module.css";
import dashboardStyles from "@/components/v3/dashboard-blueprint/blueprint.module.css";
import "@/components/v3/dashboard-blueprint/blueprint-global.css";
import calendarStyles from "@/components/v3/calendar-blueprint/calendar.module.css";
import clientsStyles from "@/components/v3/clients-blueprint/clients.module.css";
import companyStyles from "@/components/v3/company-blueprint/company.module.css";
import crmStyles from "@/components/v3/crm-blueprint/crm.module.css";
import financialsStyles from "@/components/v3/financials-blueprint/financials.module.css";
import jobsStyles from "@/components/v3/jobs-blueprint/jobs.module.css";
import leadsStyles from "@/components/v3/leads-blueprint/leads.module.css";
import projectsStyles from "@/components/v3/projects-blueprint/projects.module.css";
import workersStyles from "@/components/v3/workers-blueprint/workers.module.css";
import estimatorsStyles from "@/components/v3/estimators-blueprint/estimators.module.css";
import "@/components/v3/estimators-blueprint/estimators-global.css";
import fenceEstimatorStyles from "@/components/v3/fence-estimator-blueprint/fence-estimator.module.css";
import messagesStyles from "@/components/v3/messages-blueprint/messages.module.css";
import phoneStyles from "@/components/v3/phone-blueprint/phone.module.css";
import referralsStyles from "@/components/v3/referrals-blueprint/referrals.module.css";
import reportsStyles from "@/components/v3/reports-blueprint/reports.module.css";
import reviewsStyles from "@/components/v3/reviews-blueprint/reviews.module.css";
import roofEstimatorStyles from "@/components/v3/roof-estimator-blueprint/roof-estimator.module.css";
import settingsStyles from "@/components/v3/settings-blueprint/settings.module.css";
import tradeStyles from "@/components/v3/trade-blueprint/trade.module.css";

/**
 * Per-page stylesheets. Only the ACTIVE page's `.bp` class is applied, so the
 * donors' shared class names (.card, .kpi, …) can never collide across pages —
 * CSS-module hashing keeps each page's rules addressable only while it is the
 * one on screen. The dashboard + proposals modules stay always-on because they
 * also carry the shell chrome's own rules.
 */
const PAGE_STYLES: Record<string, string> = {
  // NOTE: no "advanced-ai" entry. The Smart Proposal · Estimate port (and the
  // job detail port at /dashboard/jobs/[id]) follow the newer convention the
  // project-detail port established: the page module declares HASHED classes
  // scoped `:global(.jf-blueprint .content) .cls`, and the page component
  // imports it directly. Nothing has to be registered here, and no page can
  // leak its rules onto a sibling that shares a pageKey.
  calendar: calendarStyles.bp,
  clients: clientsStyles.bp,
  company: companyStyles.bp,
  crm: crmStyles.bp,
  // One entry for TWO routes: pageKey() reads the first segment after
  // /dashboard, so /dashboard/estimators and /dashboard/estimators/manual both
  // land here and share a stylesheet.
  estimators: estimatorsStyles.bp,
  "fence-estimator": fenceEstimatorStyles.bp,
  financials: financialsStyles.bp,
  // NOTE: no "hire" entry — the Hire & Work board (2026-09-03) is a plain
  // stylesheet scoped `.jf-blueprint .content .hm-*`, imported by its page.
  jobs: jobsStyles.bp,
  // The Inventory page (2026-09-30) filters its tables with the Jobs status
  // strip (.jtabs / .jtab / .jtab-n) as it is, so it takes the Jobs sheet too;
  // every rule of its own is hashed, so nothing else of Jobs lands on it.
  inventory: jobsStyles.bp,
  leads: leadsStyles.bp,
  messages: messagesStyles.bp,
  phone: phoneStyles.bp,
  projects: projectsStyles.bp,
  referrals: referralsStyles.bp,
  reports: reportsStyles.bp,
  reviews: reviewsStyles.bp,
  "roof-estimator": roofEstimatorStyles.bp,
  // Only the /dashboard/settings INDEX is a blueprint page; its child routes
  // (/account, /billing, /team, …) still render on the classic (dashboard)
  // shell, which never mounts this component — so the key is safe to claim.
  settings: settingsStyles.bp,
  trade: tradeStyles.bp,
  workers: workersStyles.bp,
};

/**
 * Drives the `[data-page]` token arbitration in blueprint-global.css and the
 * PAGE_STYLES lookup above: the first path segment after `/dashboard`, or
 * "dashboard" for the index itself.
 */
function pageKey(pathname: string): string {
  const rest = pathname.replace(/^\/dashboard\/?/, "");
  if (!rest) return "dashboard";
  // A trade's inventory sits under its estimator since 2026-10-10 but is the
  // inventory page, with the inventory's styles — not the estimator's.
  if (/^[a-z]+-estimator\/inventory(?:\/|$)/.test(rest)) return "inventory";
  return rest.split("/")[0];
}

export function BlueprintShell({
  children,
  user,
  sidebarFolded = false,
}: {
  children: React.ReactNode;
  /** Signed-in identity for the sidebar's account block. Read server-side in
   *  the layout — the blueprint tree has no SessionProvider, so `useSession`
   *  is not available down here. */
  user?: SidebarUser;
  /** Start with the sidebar folded to its icon rail (the jf_sb cookie). */
  sidebarFolded?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // FOLDED SIDEBAR (owner, 2026-09-18: "more space for the estimate … an
  // arrow in the middle of the sidebar to fold it"). Desktop only — at 860px
  // and below the sidebar is already a drawer and the attribute is ignored by
  // the CSS. Remembered in a cookie so the next page load paints it folded.
  const [folded, setFolded] = useState(sidebarFolded);
  const toggleFold = useCallback(() => {
    setFolded((f) => {
      writeSidebarFold(!f);
      return !f;
    });
  }, []);
  // ⌘\ / Ctrl+\ folds and unfolds from anywhere, the editors' own shortcut
  // for the side panel. Ignored on a phone-width window, where there is
  // nothing to fold.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "\\" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (window.innerWidth <= 860) return;
      e.preventDefault();
      toggleFold();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFold]);
  const handleRef = useRef<ShellHandle | null>(null);
  const pathname = usePathname() ?? "/dashboard";
  const key = pageKey(pathname);

  useEffect(() => {
    if (!rootRef.current) return;
    const handle = initBlueprintShell(rootRef.current);
    handleRef.current = handle;
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, []);

  // React re-renders which item carries `active`; the plate follows it.
  useEffect(() => {
    handleRef.current?.syncIndicator();
  }, [pathname]);

  return (
    <div
      ref={rootRef}
      className={[proposalStyles.bp, dashboardStyles.bp, PAGE_STYLES[key], "jf-blueprint"]
        .filter(Boolean)
        .join(" ")}
      data-page={key}
      data-sb={folded ? "fold" : undefined}
    >
      <Sprite />

      {/* Mounted once, in the shell, so ⌘K works on every blueprint page
          without each one carrying its own copy. */}
      <CommandPalette />

      {/* Same reasoning: the topbar's New Estimate button is on every page, so
          the picker it opens belongs to the chrome, not to a route. It replaced
          a /dashboard/estimators page and its sidebar item — choosing an engine
          is a decision on the way somewhere, not a place you go. */}
      <EstimatorPicker />
      {/* Where the estimate on screen will be filed, when the picker was opened from a project or a client (2026-09-18). */}
      <FilingChip />
      {/* The repair sheet (2026-11-09): opened by `jf:repair` from a job, a sold proposal, a project or a client. */}
      <RepairSheet />
      {/* The payments panel (2026-11-09): opened by `jf:payments` from a sold proposal or a job. */}
      <PaymentsSheet />
      {/* A sold proposal's crew, sale, project and cancel (2026-11-10): `jf:proposal-more`. */}
      <ProposalMoreSheet />

      {/* Same reasoning, and it closes a gap six separate pages hit
          independently: the create flows call `reportPlanLimit()` when the org
          is over its plan, but the dialog that call opens was mounted ONLY in
          the classic (dashboard) layout — so on every blueprint page the limit
          was reported into a void and the user got, at best, a line of text
          with no way to upgrade. It is the existing component, mounted, not a
          blueprint re-draw: it carries the old design's visual language, which
          is the same trade the MaterialsSheet island already makes.
          Store-driven (Zustand, module-level), so it needs no provider. */}
      <PlanLimitDialog />

      {/* Same slot, same reasoning: the Help composer belongs to the chrome,
          not to any one route. It is mounted HERE rather than inside `.layout`
          on purpose — SKILL.md's responsiveness rule 6: a new node inside
          `.layout` takes a grid column on desktop and shoves `.main` off
          screen. Its LAUNCHER is the floating plate above 860px and the
          topbar's Help button at or below it, where this shell is already
          drawing a phone layout and a corner button would sit on whatever the
          page has pinned to the bottom of the screen.
          `user` is the signed-in identity the layout read; it is undefined
          when requireOrg() threw, which is the only state in which this tree
          renders without a session.

          Mounting it inside this root also puts it under FLUID SCALE: the
          shell root carries `zoom = clamp(0.78, innerWidth/1728, 1.35)`, so
          the floating plate is drawn at 48px × that factor — 37.4px at 1280,
          48 at 1728 — like every other control on the page. That is on
          purpose and is written down in support-widget.css; do not divide the
          zoom back out unless the whole shell stops scaling. */}
      <SupportWidget signedIn={Boolean(user)} />

      <div className="layout">
        <Sidebar user={user} folded={folded} onToggleFold={toggleFold} />

        <div className="sb-overlay" id="sbOverlay"></div>

        <div className="main">
          <Topbar />
          <div className="content">{children}</div>
        </div>
      </div>

      {/* Every popup that dims the app renders HERE, through <OverlayPortal>.
          Inside `.content` a scrim is painted under this sidebar and topbar,
          whatever its z-index — overlay-layer.tsx has the why. Last child of
          the root, so it stays under FLUID SCALE and the shell's tokens. */}
      <OverlayLayer />
    </div>
  );
}
