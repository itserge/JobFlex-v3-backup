"use client";
import { isCustomBlockedPath } from "@/lib/customPlan";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  FileText,
  Hammer,
  LayoutDashboard,
  CircleHelp,
  LogOut,
  MoreHorizontal,
  Plus,
  Settings,
  Sparkles,
  Users,
  Inbox,
  BarChart3,
  HardHat,
  MessagesSquare,
  Folder,
} from "lucide-react";
import { logOutEverywhere } from "@/components/v3/blueprint-shell/sign-out";
import { cn } from "@/lib/cn";
import { MobileDrawer } from "@/components/ui/MobileDrawer";
import { openSupportComposer } from "@/components/v3/support-widget/support-widget";
import { SmartHelpRow } from "@/components/v3/smarthelp/smarthelp-row";
import { NavBadge } from "./NavBadge";

type TabKey = "dashboard" | "proposals" | "schedule" | "jobs" | "leads" | "clients" | "smart" | "more";

interface Tab {
  key: TabKey;
  label: string;
  href: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard className="h-5 w-5" /> },
  { key: "proposals", label: "Proposals", href: "/dashboard/proposals", icon: <FileText className="h-5 w-5" /> },
  { key: "schedule", label: "Schedule", href: "/dashboard/calendar", icon: <Calendar className="h-5 w-5" /> },
  { key: "jobs", label: "Jobs", href: "/dashboard/jobs", icon: <Hammer className="h-5 w-5" /> },
  { key: "more", label: "More", href: "#more", icon: <MoreHorizontal className="h-5 w-5" /> },
];

interface MoreNavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const MORE_NAV: MoreNavItem[] = [
  { label: "Clients", href: "/dashboard/clients", icon: <Users className="h-4 w-4" /> },
  { label: "Leads", href: "/dashboard/leads", icon: <Inbox className="h-4 w-4" /> },
  { label: "Workers", href: "/dashboard/workers", icon: <HardHat className="h-4 w-4" /> },
  { label: "Reports", href: "/dashboard/reports", icon: <BarChart3 className="h-4 w-4" /> },
  { label: "Settings", href: "/dashboard/settings", icon: <Settings className="h-4 w-4" /> },
];

// Workers get Messages in their "More" drawer; their primary tabs stay Schedule
// + Jobs, and sign-out renders below this list unconditionally.
const WORKER_MORE_NAV: MoreNavItem[] = [
  { label: "Messages", href: "/dashboard/messages", icon: <MessagesSquare className="h-4 w-4" /> },
];

// Field workers (INSTALLER) get only their two surfaces; "More" holds Messages
// plus sign-out (rendered unconditionally below the drawer list).
const WORKER_TABS: Tab[] = [
  { key: "schedule", label: "Schedule", href: "/dashboard/calendar", icon: <Calendar className="h-5 w-5" /> },
  { key: "jobs", label: "Jobs", href: "/dashboard/jobs", icon: <Hammer className="h-5 w-5" /> },
  { key: "more", label: "More", href: "#more", icon: <MoreHorizontal className="h-5 w-5" /> },
];

// Sales reps: the pipeline slice. "More" holds CRM, phone, and messages.
const SALES_TABS: Tab[] = [
  { key: "leads", label: "Leads", href: "/dashboard/leads", icon: <Inbox className="h-5 w-5" /> },
  { key: "clients", label: "Clients", href: "/dashboard/clients", icon: <Users className="h-5 w-5" /> },
  { key: "proposals", label: "Proposals", href: "/dashboard/proposals", icon: <FileText className="h-5 w-5" /> },
  { key: "schedule", label: "Schedule", href: "/dashboard/calendar", icon: <Calendar className="h-5 w-5" /> },
  { key: "more", label: "More", href: "#more", icon: <MoreHorizontal className="h-5 w-5" /> },
];

const SALES_MORE_NAV: MoreNavItem[] = [
  { label: "CRM", href: "/dashboard/crm", icon: <BarChart3 className="h-4 w-4" /> },
  { label: "Messages", href: "/dashboard/messages", icon: <MessagesSquare className="h-4 w-4" /> },
];

// Estimators: proposals plus the AI estimators. "More" holds messages.
const ESTIMATOR_TABS: Tab[] = [
  { key: "proposals", label: "Proposals", href: "/dashboard/proposals", icon: <FileText className="h-5 w-5" /> },
  { key: "smart", label: "Smart AI", href: "/dashboard/advanced-ai", icon: <Sparkles className="h-5 w-5" /> },
  { key: "more", label: "More", href: "#more", icon: <MoreHorizontal className="h-5 w-5" /> },
];

const ESTIMATOR_MORE_NAV: MoreNavItem[] = [
  { label: "Projects", href: "/dashboard/projects", icon: <Folder className="h-4 w-4" /> },
  { label: "Messages", href: "/dashboard/messages", icon: <MessagesSquare className="h-4 w-4" /> },
];

function getActiveKey(pathname: string): TabKey {
  if (pathname === "/dashboard") return "dashboard";
  if (pathname.startsWith("/dashboard/proposals")) return "proposals";
  if (pathname.startsWith("/dashboard/calendar")) return "schedule";
  if (pathname.startsWith("/dashboard/jobs")) return "jobs";
  if (pathname.startsWith("/dashboard/leads")) return "leads";
  if (pathname.startsWith("/dashboard/clients")) return "clients";
  if (pathname.startsWith("/dashboard/advanced-ai")) return "smart";
  return "more";
}

interface FabConfig {
  href: string;
  icon: React.ReactNode;
  label: string;
}

function fabFor(active: TabKey, role?: string | null): FabConfig | null {
  if (active === "more") return null;
  // Sales / estimators can't create jobs — their FAB always drafts a proposal.
  if (role === "SALES" || role === "ESTIMATOR") {
    return { href: "/dashboard/proposals/create", icon: <Sparkles className="h-5 w-5" />, label: "Create proposal" };
  }
  if (active === "dashboard" || active === "proposals") {
    return { href: "/dashboard/proposals/create", icon: <Sparkles className="h-5 w-5" />, label: "Create proposal" };
  }
  return { href: "/dashboard/jobs/new", icon: <Plus className="h-5 w-5" />, label: "New job" };
}

export function MobileTabBar({
  role,
  badges,
  lockedHrefs,
}: {
  role?: string | null;
  /** Unread / pending counts keyed by nav href. Populated by the layout. */
  badges?: Record<string, number>;
  /** Custom-plan blocked hrefs (lib/customPageAccess) — tabs and More rows
   *  under one of these prefixes are not drawn. Empty/undefined = no lock. */
  lockedHrefs?: string[];
}) {
  const pathname = usePathname();
  const isWorker = role === "INSTALLER";
  const isSales = role === "SALES";
  const isEstimator = role === "ESTIMATOR";
  const active = getActiveKey(pathname ?? "");
  const lockedOut = React.useCallback(
    (href: string) => isCustomBlockedPath(lockedHrefs, href.split("?")[0]),
    [lockedHrefs],
  );
  const tabs = (
    isWorker ? WORKER_TABS : isSales ? SALES_TABS : isEstimator ? ESTIMATOR_TABS : TABS
  ).filter((t) => t.href.startsWith("#") || !lockedOut(t.href));
  const moreNav: MoreNavItem[] = (
    isWorker
      ? WORKER_MORE_NAV
      : isSales
        ? SALES_MORE_NAV
        : isEstimator
          ? ESTIMATOR_MORE_NAV
          : MORE_NAV
  ).filter((item) => !lockedOut(item.href));
  const fab = isWorker ? null : fabFor(active, role);
  const [moreOpen, setMoreOpen] = React.useState(false);
  /** The "More" tab itself — the one control that is still on screen after the
   *  drawer it opens has closed. The Help row hands it to the composer as the
   *  element focus returns to. */
  const moreTabRef = React.useRef<HTMLButtonElement>(null);

  // The "More" tab hides several surfaces behind a drawer — surface their
  // combined count on the tab itself so nothing goes unnoticed at a glance.
  const moreCount = moreNav.reduce((sum, item) => sum + (badges?.[item.href] ?? 0), 0);

  return (
    <>
      {fab && (
        <Link
          href={fab.href as never}
          aria-label={fab.label}
          className={cn(
            "fixed right-4 z-40 grid place-items-center",
            "h-14 w-14 rounded-full",
            "bg-[color:var(--ink)] text-[color:var(--paper)]",
            "shadow-[0_8px_24px_-8px_rgba(17,17,19,0.35)]",
            "active:translate-y-[1px] transition-transform",
            "focus-ring",
          )}
          style={{ bottom: "calc(56px + env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          {fab.icon}
        </Link>
      )}

      <nav
        aria-label="Primary"
        className={cn(
          "fixed inset-x-0 bottom-0 z-30",
          "border-t border-[color:var(--ink-line)]",
          "bg-[color:var(--paper)]/95 backdrop-blur-md",
          "pb-safe",
        )}
      >
        <ul className="flex items-stretch h-14">
          {tabs.map((tab) => {
            const isActive = tab.key === active;
            const isMoreTab = tab.key === "more";
            const itemClass = cn(
              "relative flex-1 flex flex-col items-center justify-center gap-1",
              "min-h-[44px] select-none",
              isActive ? "text-[color:var(--ink)]" : "text-[color:var(--ink-muted)]",
              "transition-colors",
            );
            const indicator = isActive ? (
              <span
                aria-hidden="true"
                className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-6 rounded-full bg-[color:var(--accent)]"
              />
            ) : null;
            const count = isMoreTab ? moreCount : badges?.[tab.href] ?? 0;
            const body = (
              <>
                {indicator}
                <span className={cn("relative opacity-90", isActive && "opacity-100")}>
                  {tab.icon}
                  <NavBadge
                    count={count}
                    size="sm"
                    className="absolute -top-2 -right-2.5 ring-2 ring-[color:var(--paper)]"
                  />
                </span>
                <span className="text-[10px] font-medium tracking-[0.01em] leading-none">{tab.label}</span>
              </>
            );

            if (isMoreTab) {
              return (
                <li key={tab.key} className="flex-1">
                  <button
                    ref={moreTabRef}
                    type="button"
                    onClick={() => setMoreOpen(true)}
                    className={cn(itemClass, "w-full")}
                    aria-expanded={moreOpen}
                  >
                    {body}
                  </button>
                </li>
              );
            }

            return (
              <li key={tab.key} className="flex-1">
                <Link href={tab.href as never} className={itemClass}>
                  {body}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <MobileDrawer
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        side="right"
        title="More"
      >
        <nav className="space-y-1">
          {moreNav.map((item) => (
            <Link
              key={item.href}
              href={item.href as never}
              onClick={() => setMoreOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] text-[color:var(--ink-soft)] hover:bg-black/[0.04] focus-ring"
            >
              <span className="text-[color:var(--ink-muted)]">{item.icon}</span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <NavBadge count={badges?.[item.href] ?? 0} className="shrink-0" />
            </Link>
          ))}
          {/* SmartHelp (components/v3/smarthelp), above Help: like Help, opened on the next frame after the drawer
              closes, with focus handed back to the More tab. */}
          <SmartHelpRow variant="more" onBeforeOpen={() => setMoreOpen(false)} opener={() => moreTabRef.current} />
          {/* Help — this group's handheld launcher for the support composer
              the layout mounts. It is a row in the drawer, not a corner
              button: below 768 the bottom-right of every page in this group is
              already the create button standing over the tab bar. */}
          <button
            type="button"
            onClick={() => {
              // Read BEFORE the close, and handed over explicitly. The drawer
              // restores focus to its trigger from an effect cleanup, and a
              // requestAnimationFrame is not guaranteed to run after that
              // cleanup — so at the moment the composer opens, focus can still
              // be on this row, which is unmounting. Every fallback the
              // composer has is unrendered below 768: the floating plate is
              // display:none under 860 and the classic topbar that carries the
              // docked button is `hidden md:flex`. Focus went to <body>.
              // The "More" tab is on screen at this width by definition — it is
              // what opened the drawer.
              const opener = moreTabRef.current;
              setMoreOpen(false);
              // Still next frame: opening in this tick would put the composer
              // up while the drawer is still animating out over it.
              requestAnimationFrame(() => openSupportComposer(opener));
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] text-[color:var(--ink-soft)] hover:bg-black/[0.04] focus-ring text-left"
          >
            <span className="text-[color:var(--ink-muted)]">
              <CircleHelp className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 truncate">Help</span>
          </button>
          <div className="pt-3 mt-3 border-t border-[color:var(--ink-line)]">
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                void logOutEverywhere("/");
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] text-[color:var(--rose)] hover:bg-rose-50 focus-ring text-left"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </button>
          </div>
        </nav>
      </MobileDrawer>
    </>
  );
}
