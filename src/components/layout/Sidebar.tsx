"use client";
import { isCustomBlockedPath } from "@/lib/customPlan";
import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Users,
  Inbox,
  Calendar,
  Hammer,
  Sparkles,
  HardHat,
  MessagesSquare,
  Megaphone,
  BarChart3,
  Settings,
  Star,
  Gift,
  MessageSquare,
  Phone,
  Home,
  Fence,
  Folder,
  UserPlus,
  Wallet,
  Building2,
  CreditCard,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { NavBadge } from "./NavBadge";
import { NavLimitCounter } from "./NavLimitCounter";
import { SmartHelpRow } from "@/components/v3/smarthelp/smarthelp-row";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  // Override the active-highlight prefix when the nav target is a sub-page but
  // the item should stay lit across the whole section (e.g. Hire → /hire/hub).
  match?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const groups: NavGroup[] = [
  {
    title: "Work",
    items: [
      { href: "/dashboard", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
      { href: "/dashboard/proposals", label: "Proposals", icon: <FileText className="h-4 w-4" /> },
      { href: "/dashboard/clients", label: "Clients", icon: <Users className="h-4 w-4" /> },
      { href: "/dashboard/leads", label: "Leads", icon: <Inbox className="h-4 w-4" /> },
      { href: "/dashboard/projects", label: "Projects", icon: <Folder className="h-4 w-4" /> },
      { href: "/dashboard/crm", label: "CRM", icon: <Workflow className="h-4 w-4" /> },
    ],
  },
  {
    title: "Delivery",
    items: [
      { href: "/dashboard/calendar", label: "Calendar", icon: <Calendar className="h-4 w-4" /> },
      { href: "/dashboard/jobs", label: "Jobs", icon: <Hammer className="h-4 w-4" /> },
      { href: "/dashboard/workers", label: "Workers", icon: <HardHat className="h-4 w-4" /> },
      { href: "/dashboard/hire/hub", label: "Hire", icon: <UserPlus className="h-4 w-4" />, match: "/dashboard/hire" },
      { href: "/dashboard/company", label: "Company", icon: <Building2 className="h-4 w-4" />, match: "/dashboard/company" },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/dashboard/financials", label: "Financials", icon: <Wallet className="h-4 w-4" /> },
    ],
  },
  {
    title: "Automation",
    items: [
      { href: "/dashboard/advanced-ai", label: "Smart Proposal", icon: <Sparkles className="h-4 w-4" /> },
      // The Blueprint estimators (2026-10-09); the classic /advanced-ai/roof
      // and /advanced-ai/fence/studio are no longer linked from anywhere.
      { href: "/dashboard/roof-estimator", label: "Roof estimator", icon: <Home className="h-4 w-4" /> },
      { href: "/dashboard/fence-estimator", label: "Fence estimator", icon: <Fence className="h-4 w-4" /> },
      { href: "/dashboard/phone", label: "AI desk", icon: <Phone className="h-4 w-4" /> },
      { href: "/dashboard/messages", label: "Messages", icon: <MessagesSquare className="h-4 w-4" /> },
      { href: "/dashboard/reviews", label: "Reviews", icon: <Star className="h-4 w-4" /> },
      { href: "/dashboard/trade", label: "Trade board", icon: <MessageSquare className="h-4 w-4" /> },
      { href: "/dashboard/referrals", label: "Referrals", icon: <Gift className="h-4 w-4" /> },
      { href: "/dashboard/reports", label: "Reports", icon: <BarChart3 className="h-4 w-4" /> },
    ],
  },
  {
    title: "Account",
    items: [
      // Repointed 2026-08-13 to the NEW design (blueprint above 768px, the
      // handheld build below). The old view still answers /dashboard/subscription.
      { href: "/dashboard/subscription-blueprint", label: "Subscription", icon: <CreditCard className="h-4 w-4" /> },
      { href: "/dashboard/settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
    ],
  },
];

// Field workers (INSTALLER) get a read-only slice of the dashboard: their jobs
// and their schedule. This matches the middleware allow-list so the nav never
// shows a link the route-gate would bounce.
const WORKER_GROUPS: NavGroup[] = [
  {
    title: "Your work",
    items: [
      { href: "/dashboard/jobs", label: "Jobs", icon: <Hammer className="h-4 w-4" /> },
      { href: "/dashboard/calendar", label: "Schedule", icon: <Calendar className="h-4 w-4" /> },
      { href: "/dashboard/messages", label: "Messages", icon: <MessagesSquare className="h-4 w-4" /> },
    ],
  },
];

// Sales reps: the pipeline slice — leads through proposals, plus their own
// calendar and the comms surfaces. Matches ROLE_ROUTE_GATES.SALES.
const SALES_GROUPS: NavGroup[] = [
  {
    title: "Pipeline",
    items: [
      { href: "/dashboard/leads", label: "Leads", icon: <Inbox className="h-4 w-4" /> },
      { href: "/dashboard/clients", label: "Clients", icon: <Users className="h-4 w-4" /> },
      { href: "/dashboard/proposals", label: "Proposals", icon: <FileText className="h-4 w-4" /> },
      { href: "/dashboard/crm", label: "CRM", icon: <Workflow className="h-4 w-4" /> },
    ],
  },
  {
    title: "Day to day",
    items: [
      { href: "/dashboard/calendar", label: "Calendar", icon: <Calendar className="h-4 w-4" /> },
      { href: "/dashboard/messages", label: "Messages", icon: <MessagesSquare className="h-4 w-4" /> },
      { href: "/dashboard/phone", label: "AI desk", icon: <Phone className="h-4 w-4" /> },
    ],
  },
];

// Estimators: proposals plus the AI estimators. Matches ROLE_ROUTE_GATES.ESTIMATOR.
const ESTIMATOR_GROUPS: NavGroup[] = [
  {
    title: "Estimating",
    items: [
      { href: "/dashboard/proposals", label: "Proposals", icon: <FileText className="h-4 w-4" /> },
      { href: "/dashboard/projects", label: "Projects", icon: <Folder className="h-4 w-4" /> },
    ],
  },
  {
    title: "Automation",
    items: [
      { href: "/dashboard/advanced-ai", label: "Smart Proposal", icon: <Sparkles className="h-4 w-4" /> },
      // The Blueprint estimators (2026-10-09); the classic /advanced-ai/roof
      // and /advanced-ai/fence/studio are no longer linked from anywhere.
      { href: "/dashboard/roof-estimator", label: "Roof estimator", icon: <Home className="h-4 w-4" /> },
      { href: "/dashboard/fence-estimator", label: "Fence estimator", icon: <Fence className="h-4 w-4" /> },
      { href: "/dashboard/messages", label: "Messages", icon: <MessagesSquare className="h-4 w-4" /> },
    ],
  },
];

// Nav for the caller's role. Office roles get the full tree; the owner-only
// Subscription entry is dropped for everyone who isn't the org owner.
function navGroupsFor(role: string | null | undefined): NavGroup[] {
  if (role === "INSTALLER") return WORKER_GROUPS;
  if (role === "SALES") return SALES_GROUPS;
  if (role === "ESTIMATOR") return ESTIMATOR_GROUPS;
  if (role === "OWNER") return groups;
  return groups.map((g) =>
    g.title === "Account"
      ? { ...g, items: g.items.filter((i) => i.href !== "/dashboard/subscription-blueprint") }
      : g,
  );
}

export function Sidebar({
  role,
  badges,
  limits,
  plan,
  lockedHrefs,
}: {
  role?: string | null;
  /** Unread / pending counts keyed by nav href. Populated by the layout. */
  badges?: Record<string, number>;
  /** Remaining-quota counters keyed by nav href (limited resources only). */
  limits?: Record<string, { remaining: number; limit: number; cappedBy?: string }>;
  /** Active plan slug ("PROFESSIONAL") for the counter's upsell copy. */
  plan?: string;
  /** Custom-plan blocked hrefs (lib/customPageAccess) — items whose href sits
   *  under one of these prefixes are not drawn. Empty/undefined = no lock. */
  lockedHrefs?: string[];
}) {
  const pathname = usePathname();
  const navGroups = React.useMemo(() => {
    const base = navGroupsFor(role);
    if (!lockedHrefs?.length) return base;
    // Resolved to the page each href opens (lib/customPlan): the legacy
    // estimator paths under /dashboard/advanced-ai are the roof and fence
    // estimators, not Smart Proposal.
    const blocked = (href: string) => isCustomBlockedPath(lockedHrefs, href.split("?")[0]);
    return base
      .map((g) => ({ ...g, items: g.items.filter((i) => !blocked(i.href)) }))
      .filter((g) => g.items.length > 0);
  }, [role, lockedHrefs]);

  // Single source of truth for the active item: the nav target that is the
  // LONGEST prefix of the current path wins. Without this, the index route
  // ("/dashboard") and section parents ("/dashboard/advanced-ai") stay lit
  // alongside the deeper page actually being viewed — two active links.
  const activeBase = React.useMemo(() => {
    let best = "";
    for (const g of navGroups) {
      for (const item of g.items) {
        const base = item.match ?? item.href;
        const matches = pathname === base || pathname.startsWith(base + "/");
        if (matches && base.length > best.length) best = base;
      }
    }
    return best;
  }, [pathname, navGroups]);

  return (
    <aside className="hidden lg:flex flex-col w-[252px] shrink-0 h-dvh sticky top-0 border-r border-[color:var(--ink-line)] bg-white shadow-[1px_0_2px_rgba(20,24,31,0.03)]">
      <Link
        href="/dashboard"
        className="flex items-center gap-1.5 px-6 h-16 border-b border-[color:var(--ink-line)]"
      >
        <Image
          src="/jobflex-mark.png"
          alt="JobFlex"
          width={52}
          height={52}
          priority
          className="h-[52px] w-[52px] -ml-1.5 object-contain"
        />
        <div className="flex flex-col leading-none">
          <span className="font-display text-[20px] tracking-[-0.015em]">JobFlex</span>
          <span className="text-[10px] text-[color:var(--ink-muted)] mt-0.5 tracking-[0.14em] uppercase">
            Contractor OS
          </span>
        </div>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 pb-5 pt-4 space-y-5">
        {/* SmartHelp (components/v3/smarthelp): the first row, above the groups. */}
        <SmartHelpRow variant="desk" />
        {navGroups.map((g) => (
          <div key={g.title} className="space-y-1">
            <div className="quiet-caps px-3 mb-1.5">{g.title}</div>
            {g.items.map((item) => {
              const active = (item.match ?? item.href) === activeBase;
              return (
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                <Link key={item.href} href={item.href as any}
                  className={cn(
                    "group flex items-center gap-2.5 px-3 h-9 rounded-[var(--r-md)] text-[13px] transition-colors duration-150 ease-[var(--ease)]",
                    active
                      ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-ink)] font-semibold shadow-[inset_0_0_0_1px_rgba(31,122,82,0.14)]"
                      : "text-[color:var(--ink)] hover:bg-[color:var(--paper-deep)] hover:text-[color:var(--accent-ink)]",
                  )}
                >
                  <span
                    className={cn(
                      "transition-opacity duration-150 ease-[var(--ease)]",
                      active ? "opacity-100" : "opacity-60 group-hover:opacity-100",
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <NavBadge count={badges?.[item.href] ?? 0} className="shrink-0" />
                  {limits?.[item.href] && (
                    <span className="shrink-0">
                      <NavLimitCounter
                        remaining={limits[item.href].remaining}
                        limit={limits[item.href].limit}
                        plan={plan ?? ""}
                        cappedBy={limits[item.href].cappedBy}
                      />
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
